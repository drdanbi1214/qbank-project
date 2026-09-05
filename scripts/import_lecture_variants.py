"""강의록 대체본(후배 필기본 등)을 R2 에 올리고 lecture_document_variants 에 등록한다.

원본 강의록(lecture_documents)은 그대로 두고, "같은 강의록의 필기가 되어 있는
다른 PDF" 를 한 건 더 붙인다. 화면에서는 권한(기본 study_legendob = 레옵스)이
있는 사람에게만 원본/대체본 토글이 뜨고, 대체본 파일도 그 사람에게만 서명 URL 이
발급된다.

원본 등록 스크립트(import_lecture_documents.py)와 다른 점:
  * 압축하지 않는다. 필기본은 손글씨가 뭉개지면 안 되므로 항상 원본 바이트를 올린다.
  * 본문 텍스트를 뽑지 않는다. 검색·페이지색인·개인필기·정리본은 전부 원본을
    계속 가리킨다. 대체본은 화면에서 "대신 그리는 파일" 일 뿐이다.
  * 어느 원본에 붙일지 사람이 지정해야 한다. --lecture(id 또는 제목 일부) 또는
    manifest 로 파일마다 대상 강의록을 준다.

기본은 시늉 모드다. 실제로 올리려면 --apply 를 준다.

    # 파일 하나를 특정 강의록에 붙이기 (제목 일부로 찾기)
    python3 scripts/import_lecture_variants.py ~/필기본/심부전_후배필기.pdf \\
        --lecture "심부전의 진단" --label "후배 필기본"

    # id 로 정확히 지정
    python3 scripts/import_lecture_variants.py ~/필기본/심부전_후배필기.pdf \\
        --lecture 3f1c2b90-... --label "후배 필기본" --apply

    # 폴더 전체를 manifest 로 (파일마다 대상·이름 지정)
    python3 scripts/import_lecture_variants.py ~/필기본/순환기 \\
        --manifest scripts/lecture_document_manifests/2026_cardio_variants.json --apply

manifest 는 파일명을 키로 하는 JSON 이다. label·kind·permission 은 생략하면
명령행 기본값을 쓴다.

    {
      "심부전_후배필기.pdf": {"lecture": "심부전의 진단", "label": "후배 필기본"},
      "부정맥_후배필기.pdf": {"lecture": "5a2d...-uuid", "kind": "annotated"},
      "안올릴파일.pdf": {"skip": true}
    }
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
import unicodedata
import urllib.parse

import fitz

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from import_lecture_documents import BUCKET, rest, safe_key  # noqa: E402
from object_storage import R2Backend  # noqa: E402
from supabase_credentials import load_supabase_credentials  # noqa: E402

DEFAULT_KIND = "annotated"
DEFAULT_PERMISSION = "study_legendob"
DEFAULT_LABEL = "후배 필기본"
UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def nfc(value: str) -> str:
    return unicodedata.normalize("NFC", value)


def page_count(data: bytes) -> int:
    document = fitz.open(stream=data, filetype="pdf")
    try:
        return len(document)
    finally:
        document.close()


def variant_object_path(lecture_id: str, filename: str, digest: str) -> str:
    """같은 강의록에 동명 파일을 더 올려도 기존 객체를 덮지 않는 R2 키."""
    return f"variants/{lecture_id}/{digest}-{safe_key(filename)}"


def resolve_lecture(base: str, key: str, term: str) -> dict:
    """제목 일부 또는 id 로 원본 강의록 한 건을 찾는다. 하나로 못 좁히면 멈춘다."""
    term = term.strip()
    if UUID_RE.match(term):
        rows = json.loads(
            rest(
                base,
                key,
                "GET",
                f"/rest/v1/lecture_documents?select=id,title,professor&id=eq.{term}",
            )
        )
        if not rows:
            raise RuntimeError(f"그 id 의 강의록이 없습니다: {term}")
        return rows[0]

    encoded = urllib.parse.quote(f"*{term}*")
    rows = json.loads(
        rest(
            base,
            key,
            "GET",
            "/rest/v1/lecture_documents"
            f"?select=id,title,professor&title=ilike.{encoded}&limit=20",
        )
    )
    if not rows:
        raise RuntimeError(f"제목에 '{term}' 가 들어간 강의록이 없습니다.")
    if len(rows) > 1:
        listing = "\n     ".join(
            f"{row['title']}  ({row.get('professor') or '교수 미상'})  {row['id']}"
            for row in rows
        )
        raise RuntimeError(
            f"'{term}' 로 강의록이 {len(rows)}건 잡힙니다. id 로 지정하세요:\n     {listing}"
        )
    return rows[0]


def main() -> int:
    parser = argparse.ArgumentParser(description="강의록 대체본(후배 필기본) 등록")
    parser.add_argument("path", type=pathlib.Path, help="PDF 파일 하나 또는 PDF 가 든 폴더")
    parser.add_argument(
        "--lecture",
        default=None,
        help="붙일 원본 강의록. id(uuid) 또는 제목 일부. 파일이 하나일 때 쓴다.",
    )
    parser.add_argument("--label", default=DEFAULT_LABEL, help=f"토글 버튼 이름 (기본: {DEFAULT_LABEL})")
    parser.add_argument("--kind", default=DEFAULT_KIND, help=f"대체본 종류 키 (기본: {DEFAULT_KIND})")
    parser.add_argument(
        "--permission",
        default=DEFAULT_PERMISSION,
        help=f"열람 권한 키 (기본: {DEFAULT_PERMISSION})",
    )
    parser.add_argument(
        "--manifest",
        type=pathlib.Path,
        default=None,
        help="파일명별 대상·이름 JSON. 폴더를 올릴 때는 필수.",
    )
    parser.add_argument("--apply", action="store_true", help="실제로 올리고 등록한다")
    args = parser.parse_args()

    target = args.path.expanduser()
    if target.is_dir():
        pdfs = sorted(p for p in target.rglob("*.pdf") if p.is_file())
        if not args.manifest:
            parser.error("폴더를 올릴 때는 --manifest 로 파일마다 대상 강의록을 지정해야 합니다.")
    elif target.is_file() and target.suffix.lower() == ".pdf":
        pdfs = [target]
    else:
        parser.error(f"PDF 파일이나 폴더가 아닙니다: {target}")

    if not pdfs:
        print("PDF 를 찾지 못했습니다.")
        return 1

    manifest: dict[str, dict] = {}
    if args.manifest:
        raw = json.loads(args.manifest.expanduser().read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            parser.error("manifest 최상위 값은 파일명을 키로 하는 JSON 객체여야 합니다.")
        invalid_entries = [
            name
            for name, override in raw.items()
            if not isinstance(name, str) or not isinstance(override, dict)
        ]
        if invalid_entries:
            parser.error(f"manifest 항목 값은 JSON 객체여야 합니다: {invalid_entries[0]}")
        manifest = {nfc(name): override for name, override in raw.items()}

    if not args.manifest and not args.lecture:
        parser.error("--lecture 또는 --manifest 중 하나는 있어야 합니다.")

    base, key = load_supabase_credentials()

    # 권한 키가 실제로 있는지 먼저 본다. 없으면 FK 오류로 죽기 전에 알려 준다.
    perms_seen: set[str] = set()

    def check_permission(perm: str) -> None:
        if perm in perms_seen:
            return
        rows = json.loads(
            rest(base, key, "GET", f"/rest/v1/access_permissions?select=key&key=eq.{perm}")
        )
        if not rows:
            raise RuntimeError(f"권한 키가 없습니다: {perm} (access_permissions 확인)")
        perms_seen.add(perm)

    admins = json.loads(
        rest(base, key, "GET", "/rest/v1/profiles?select=id&role=eq.admin&order=created_at&limit=1")
    )
    created_by = admins[0]["id"] if admins else None

    backend = R2Backend() if args.apply else None
    registered = skipped = failed = 0

    print(
        f"{len(pdfs)}개 PDF · 원본 그대로(압축 안 함)"
        + ("" if args.apply else " · 시늉 모드(--apply 없음)")
    )
    print()

    for pdf in pdfs:
        try:
            override = manifest.get(nfc(pdf.name), {})
            if override.get("skip"):
                print(f"  건너뜀  {pdf.name}\n           manifest 에서 제외")
                skipped += 1
                continue

            lecture_term = override.get("lecture") or args.lecture
            label = nfc(str(override.get("label") or args.label)).strip()
            kind = str(override.get("kind") or args.kind).strip()
            permission = str(override.get("permission") or args.permission).strip()

            if not lecture_term:
                raise RuntimeError("대상 강의록이 없습니다 (manifest 의 lecture 또는 --lecture)")
            if not label:
                raise RuntimeError("토글 버튼 이름(label)이 비어 있습니다.")
            if not kind:
                raise RuntimeError("대체본 종류(kind)가 비어 있습니다.")

            check_permission(permission)
            lecture = resolve_lecture(base, key, str(lecture_term))
            data = pdf.read_bytes()
            digest = hashlib.sha256(data).hexdigest()

            existing = json.loads(
                rest(
                    base,
                    key,
                    "GET",
                    f"/rest/v1/lecture_document_variants?select=id,label,lecture_id&content_hash=eq.{digest}",
                )
            )
            if existing:
                print(
                    f"  건너뜀  {pdf.name}\n"
                    f"           이미 등록됨: {existing[0]['label']} ({existing[0]['id']})"
                )
                skipped += 1
                continue

            siblings = json.loads(
                rest(
                    base,
                    key,
                    "GET",
                    "/rest/v1/lecture_document_variants"
                    f"?select=id,sort_order&lecture_id=eq.{lecture['id']}"
                    "&order=sort_order.desc&limit=1",
                )
            )
            sort_order = (siblings[0]["sort_order"] + 1) if siblings else 0

            pages = page_count(data)
            object_path = variant_object_path(lecture["id"], pdf.name, digest)
            size_note = f"{len(data) / 1024 / 1024:.1f}MB · {pages}쪽"

            print(f"  {'등록' if args.apply else '등록 예정'}  {label}  ←  {lecture['title']}")
            print(f"           {size_note} · {kind} · {permission}")
            print(f"           {BUCKET}/{object_path}")

            if not args.apply:
                registered += 1
                continue

            # 파일을 먼저 올리고 성공한 뒤에만 행을 만든다.
            assert backend is not None
            backend.upload(BUCKET, object_path, data, "application/pdf", sha256=digest)
            body = json.dumps(
                {
                    "lecture_id": lecture["id"],
                    "kind": kind,
                    "label": label,
                    "file_path": f"{BUCKET}/{object_path}",
                    "content_hash": digest,
                    "byte_size": len(data),
                    "page_count": pages,
                    "required_permission": permission,
                    "sort_order": sort_order,
                    "created_by": created_by,
                }
            ).encode()
            rest(base, key, "POST", "/rest/v1/lecture_document_variants", body)
            registered += 1
        except Exception as exc:  # noqa: BLE001 - 한 건 실패가 나머지를 막지 않게 한다
            print(f"  실패  {pdf.name}\n           {exc}")
            failed += 1

    print()
    print(f"등록 {registered} · 건너뜀 {skipped} · 실패 {failed}")
    if not args.apply:
        print("시늉 모드였습니다. 실제로 올리려면 --apply 를 붙이세요.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
