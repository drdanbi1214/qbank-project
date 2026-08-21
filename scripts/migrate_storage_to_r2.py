"""Supabase Storage 객체를 동일한 논리 키로 Cloudflare R2에 복사·검증한다.

기본은 목록과 용량만 읽는 dry-run이다. ``--apply``가 있어야 R2에 쓰며,
Supabase 원본은 어떤 옵션에서도 삭제하지 않는다. JSONL manifest 덕분에 중간에
끊겨도 같은 명령을 재실행할 수 있다.

예시:
    python3 scripts/migrate_storage_to_r2.py --bucket topic-images
    python3 scripts/migrate_storage_to_r2.py --bucket topic-images --apply --verify
    python3 scripts/migrate_storage_to_r2.py --apply --verify
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import mimetypes
import pathlib
import sys
import urllib.parse
from dataclasses import asdict, dataclass

import requests

from object_storage import R2Backend
from supabase_credentials import load_supabase_credentials

BUCKETS = (
    "topic-images",
    "avatars",
    "question-images",
    "solution-images",
    "theory-images",
    "ai-solution-images",
    "senior-solution-images",
    "solution-lecture-files",
    "exam-sources",
)


@dataclass(frozen=True)
class SourceObject:
    bucket: str
    name: str
    size_bytes: int
    mime_type: str
    updated_at: str

    @property
    def storage_path(self) -> str:
        return f"{self.bucket}/{self.name}"


class SupabaseStorageSource:
    def __init__(self, url: str, secret_key: str):
        self.url = url.rstrip("/")
        # New sb_secret keys belong only in apikey, never Bearer.
        self.headers = {"apikey": secret_key}

    def list_objects(self, bucket: str):
        after = ""
        while True:
            response = requests.post(
                f"{self.url}/rest/v1/rpc/admin_list_storage_objects",
                headers={**self.headers, "Content-Type": "application/json"},
                json={"p_bucket": bucket, "p_after": after, "p_limit": 1000},
                timeout=60,
            )
            if not response.ok:
                raise RuntimeError(
                    f"{bucket} manifest 조회 실패 {response.status_code}: {response.text[:300]}"
                )
            rows = response.json()
            if not rows:
                return
            for row in rows:
                mime = row.get("mime_type") or mimetypes.guess_type(row["object_name"])[0]
                yield SourceObject(
                    bucket=bucket,
                    name=row["object_name"],
                    size_bytes=int(row.get("size_bytes") or 0),
                    mime_type=mime or "application/octet-stream",
                    updated_at=row.get("updated_at") or "",
                )
            if len(rows) < 1000:
                return
            after = rows[-1]["object_name"]

    def download(self, item: SourceObject) -> bytes:
        encoded = urllib.parse.quote(item.name, safe="/")
        response = requests.get(
            f"{self.url}/storage/v1/object/{item.bucket}/{encoded}",
            headers=self.headers,
            timeout=(15, 180),
        )
        if not response.ok:
            raise RuntimeError(
                f"{item.storage_path} 다운로드 실패 {response.status_code}: {response.text[:200]}"
            )
        return response.content


def load_completed(path: pathlib.Path) -> dict[str, dict]:
    completed: dict[str, dict] = {}
    if not path.exists():
        return completed
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("status") in {"uploaded", "verified", "already_present"}:
            completed[row.get("storage_path", "")] = row
    return completed


def append_manifest(path: pathlib.Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        file.flush()


def main() -> None:
    parser = argparse.ArgumentParser(description="Supabase Storage -> Cloudflare R2 안전 이전")
    parser.add_argument("--bucket", action="append", choices=BUCKETS, help="반복 가능. 생략하면 전 버킷")
    parser.add_argument("--apply", action="store_true", help="R2에 실제 업로드")
    parser.add_argument("--verify", action="store_true", help="R2에서 다시 받아 SHA-256 전수 검증")
    parser.add_argument("--force", action="store_true", help="완료 manifest와 같은 객체도 다시 처리")
    parser.add_argument(
        "--workers",
        type=int,
        default=6,
        help="동시 복사 수(기본 6, 1~16). manifest 기록은 메인 스레드에서 직렬 처리",
    )
    parser.add_argument("--manifest", default="tmp/r2-migration-manifest.jsonl")
    args = parser.parse_args()
    if not 1 <= args.workers <= 16:
        parser.error("--workers는 1~16 사이여야 합니다.")

    selected = tuple(args.bucket or BUCKETS)
    manifest_path = pathlib.Path(args.manifest)
    url, secret_key = load_supabase_credentials()
    source = SupabaseStorageSource(url, secret_key)

    inventory: list[SourceObject] = []
    for bucket in selected:
        rows = list(source.list_objects(bucket))
        inventory.extend(rows)
        print(f"{bucket}: {len(rows):,}개 / {sum(row.size_bytes for row in rows) / 1024 / 1024:.1f} MiB")
    print(f"합계: {len(inventory):,}개 / {sum(row.size_bytes for row in inventory) / 1024 / 1024:.1f} MiB")

    if not args.apply and not args.verify:
        print("dry-run 완료. R2에 쓰려면 --apply, 재다운로드 검증까지 하려면 --verify를 붙이세요.")
        return

    r2 = R2Backend()
    completed = load_completed(manifest_path)
    counts = {"skipped": 0, "uploaded": 0, "verified": 0, "failed": 0}
    pending: list[tuple[int, SourceObject]] = []

    for index, item in enumerate(inventory, 1):
        previous = completed.get(item.storage_path)
        if (
            previous
            and not args.force
            and previous.get("source_updated_at") == item.updated_at
            and int(previous.get("source_size_bytes") or -1) == item.size_bytes
            and (not args.verify or previous.get("status") == "verified")
        ):
            counts["skipped"] += 1
            continue
        pending.append((index, item))

    def copy_one(index_and_item: tuple[int, SourceObject]) -> tuple[int, SourceObject, dict, bool]:
        index, item = index_and_item
        try:
            data = source.download(item)
            if item.size_bytes and len(data) != item.size_bytes:
                raise RuntimeError(f"원본 크기 불일치: DB {item.size_bytes}, 다운로드 {len(data)}")
            digest = hashlib.sha256(data).hexdigest()
            head = r2.head(item.bucket, item.name)
            already_present = bool(
                head
                and int(head.get("ContentLength") or -1) == len(data)
                and (head.get("Metadata") or {}).get("sha256") == digest
            )

            if args.apply and not already_present:
                r2.upload(item.bucket, item.name, data, item.mime_type, sha256=digest)
                status = "uploaded"
                uploaded = True
            else:
                status = "already_present"
                uploaded = False

            if args.verify:
                copied = r2.download(item.bucket, item.name)
                copied_digest = hashlib.sha256(copied).hexdigest()
                if copied_digest != digest:
                    raise RuntimeError("R2 SHA-256 불일치")
                status = "verified"

            return (
                index,
                item,
                {
                    "status": status,
                    "storage_path": item.storage_path,
                    "source_size_bytes": len(data),
                    "source_updated_at": item.updated_at,
                    "sha256": digest,
                    "mime_type": item.mime_type,
                },
                uploaded,
            )
        except Exception as exc:
            return (
                index,
                item,
                {
                    **asdict(item),
                    "storage_path": item.storage_path,
                    "status": "failed",
                    "error": str(exc)[:500],
                },
                False,
            )

    print(f"처리 예정: {len(pending):,}개 (건너뜀 {counts['skipped']:,}개, workers={args.workers})")
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(copy_one, entry) for entry in pending]
        for future in concurrent.futures.as_completed(futures):
            index, item, row, uploaded = future.result()
            append_manifest(manifest_path, row)
            status = row["status"]
            if status == "failed":
                counts["failed"] += 1
                print(
                    f"[{index}/{len(inventory)}] 실패: {item.storage_path}: {row['error']}",
                    file=sys.stderr,
                )
                continue
            if uploaded:
                counts["uploaded"] += 1
            if status == "verified":
                counts["verified"] += 1
            print(f"[{index}/{len(inventory)}] {status}: {item.storage_path}")

    print("결과:", ", ".join(f"{key}={value}" for key, value in counts.items()))
    if counts["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
