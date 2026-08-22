"""R2 강의록 PDF에서 페이지별 검색 색인을 안전하게 다시 만든다.

lecture_page_texts는 원본이 아니라 파생 색인이다. 이 스크립트는 PDF와
lecture_documents를 수정하거나 삭제하지 않고, 페이지 텍스트만 upsert한다.
기본은 읽기 전용 점검이며 --apply를 붙여야 DB에 쓴다.

    python3 scripts/backfill_lecture_page_texts.py
    python3 scripts/backfill_lecture_page_texts.py --apply
    python3 scripts/backfill_lecture_page_texts.py --lecture-id <uuid> --apply
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.parse
import urllib.request

import fitz

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from object_storage import R2Backend  # noqa: E402
from supabase_credentials import load_supabase_credentials  # noqa: E402

BUCKET = "lecture-documents"
BATCH_SIZE = 200


def request_json(
    base: str,
    key: str,
    method: str,
    path: str,
    body: object | None = None,
    *,
    prefer: str | None = None,
) -> object:
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    request = urllib.request.Request(
        f"{base}{path}",
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = response.read()
    return json.loads(payload) if payload else None


def page_texts(data: bytes) -> list[str]:
    document = fitz.open(stream=data, filetype="pdf")
    try:
        return [page.get_text("text", sort=True).strip() for page in document]
    finally:
        document.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="강의록 페이지별 검색 색인 백필")
    parser.add_argument("--lecture-id", default=None, help="한 강의록만 시험할 때")
    parser.add_argument("--force", action="store_true", help="이미 쪽수가 맞아도 다시 추출")
    parser.add_argument("--apply", action="store_true", help="실제로 페이지 색인을 upsert")
    args = parser.parse_args()

    base, key = load_supabase_credentials()
    backend = R2Backend()
    query = "/rest/v1/lecture_documents?select=id,title,file_path,page_count&order=title"
    if args.lecture_id:
        query += f"&id=eq.{urllib.parse.quote(args.lecture_id)}"
    documents = request_json(base, key, "GET", query)
    if not isinstance(documents, list):
        raise RuntimeError("강의록 목록 응답이 배열이 아닙니다.")

    written = skipped = failed = 0
    print(f"강의록 {len(documents)}개" + (" · 실제 반영" if args.apply else " · 읽기 전용 점검"))

    for index, lecture in enumerate(documents, 1):
        lecture_id = lecture["id"]
        expected = int(lecture.get("page_count") or 0)
        count_path = (
            "/rest/v1/lecture_page_texts?select=page_number"
            f"&lecture_id=eq.{urllib.parse.quote(lecture_id)}"
        )
        existing = request_json(base, key, "GET", count_path)
        existing_count = len(existing) if isinstance(existing, list) else 0

        if not args.force and expected > 0 and existing_count == expected:
            print(f"[{index}/{len(documents)}] 건너뜀 {lecture['title']} · {existing_count}쪽")
            skipped += 1
            continue

        try:
            file_path = str(lecture["file_path"])
            bucket, separator, object_name = file_path.partition("/")
            if not separator or bucket != BUCKET or not object_name:
                raise RuntimeError(f"잘못된 파일 경로: {file_path}")

            pages = page_texts(backend.download(bucket, object_name))
            if expected and len(pages) != expected:
                raise RuntimeError(f"DB {expected}쪽, PDF {len(pages)}쪽으로 다릅니다.")

            print(
                f"[{index}/{len(documents)}] {'반영' if args.apply else '예정'} "
                f"{lecture['title']} · {len(pages)}쪽 · {sum(map(len, pages)):,}자"
            )
            if args.apply:
                rows = [
                    {
                        "lecture_id": lecture_id,
                        "page_number": page_number,
                        "text_content": text,
                    }
                    for page_number, text in enumerate(pages, 1)
                ]
                for offset in range(0, len(rows), BATCH_SIZE):
                    request_json(
                        base,
                        key,
                        "POST",
                        "/rest/v1/lecture_page_texts?on_conflict=lecture_id,page_number",
                        rows[offset : offset + BATCH_SIZE],
                        prefer="return=minimal,resolution=merge-duplicates",
                    )
            written += 1
        except Exception as caught:
            print(f"[{index}/{len(documents)}] 실패 {lecture['title']}: {caught}")
            failed += 1

    print(f"완료: 대상 {written} · 건너뜀 {skipped} · 실패 {failed}")
    if not args.apply:
        print("읽기 전용 점검입니다. 실제 반영은 --apply를 붙이세요.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
