"""AI 풀이를 문제코드 CSV로 일괄 입력한다.

AI 풀이 탭 권한이 있는 사용자에게만 보이는 별도 트랙(ai_solutions 테이블)에
넣는다. 권한 없는 사용자 화면에는 탭과 데이터가 모두 노출되지 않는다.

CSV 형식 (UTF-8, 헤더 필수):
    question_code,content
    2607044,"...풀이 본문..."

- question_code 는 '학번2자리+과목코드2자리+문항번호3자리' 7자리다.
  예: 2607044 = 26학번 정형외과 44번. 문제 상세 화면 URL 이나 관리자 화면에서
  확인할 수 있다.
- content 는 일반 텍스트다. **빈 줄로 문단을 구분**하고, 문단 안의 줄바꿈은
  그대로 줄바꿈으로 남는다. CSV 셀 안에 실제 줄바꿈이 들어가야 하므로 반드시
  큰따옴표로 감싸야 한다 (엑셀/구글시트에서 내보내면 자동으로 그렇게 된다).

이미지 넣는 법:
    본문 중 이미지가 들어갈 자리에 그 줄만 단독으로 아래처럼 적는다.

        [[img:파일명.png]]

    그리고 --images 로 준 폴더 안에 정확히 그 파일명으로 이미지 파일을
    넣어둔다 (하위 폴더 없이 평평하게, 여러 문제가 같은 폴더를 공유해도 된다 —
    파일명만 겹치지 않으면 된다). 이미지 표시는 한 줄 전체를 사용하며 앞뒤에
    빈 줄이 없어도 된다. 파일명에는 / 또는 \ 를 쓰지 않는다.

기본은 dry-run이다. 문제코드 매칭 결과와 이미지 파일 존재 여부만 보여주고
DB/스토리지에는 아무것도 쓰지 않는다. 확인 후 --apply 를 붙인다.

같은 문제코드로 다시 돌리면 그 문제의 AI 풀이를 덮어쓴다(upsert).

사용법:
    python3 import_ai_solutions.py ai_solutions.csv --images ./ai_images
    python3 import_ai_solutions.py ai_solutions.csv --images ./ai_images --apply
"""

from __future__ import annotations

import argparse
import csv
import mimetypes
import os
import re
import sys
import uuid

try:
    import requests
except ImportError:
    sys.exit("requests 가 필요하다. pip install -r requirements.txt")

IMG_MARKER = re.compile(r"^\[\[img:(.+?)\]\]$")
BUCKET = "ai-solution-images"
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def load_env() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    # 프로젝트 루트에서 `python3 scripts/...`로 실행해도 scripts/.env를 찾는다.
    script_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    for env_path in (".env", script_env):
        if url and key:
            break
        if not os.path.exists(env_path):
            continue
        with open(env_path, encoding="utf-8") as fh:
            for line in fh:
                if "=" in line and not line.strip().startswith("#"):
                    name, value = line.strip().split("=", 1)
                    os.environ.setdefault(name, value)
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not url or not key:
        sys.exit("SUPABASE_URL 과 SUPABASE_SERVICE_KEY 를 .env 에 넣어야 한다")
    return url.rstrip("/"), key


class Client:
    """PostgREST + Storage 얇은 래퍼. service_role 키를 쓰므로 RLS 를
    우회한다 — 사람이 터미널에서 직접 돌리는 용도로만 쓴다."""

    def __init__(self, base_url: str, key: str):
        self.base_url = base_url
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def get(self, path: str, params: dict) -> list[dict]:
        r = requests.get(f"{self.base_url}/rest/v1/{path}", headers=self.headers, params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def upsert(self, path: str, rows: list[dict], on_conflict: str) -> None:
        headers = {
            **self.headers,
            "Prefer": "return=minimal,resolution=merge-duplicates",
        }
        r = requests.post(
            f"{self.base_url}/rest/v1/{path}",
            headers=headers,
            params={"on_conflict": on_conflict},
            json=rows,
            timeout=120,
        )
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"POST {path} 실패 {r.status_code}: {r.text[:500]}")

    def upload_storage(self, bucket: str, path: str, data: bytes, content_type: str) -> bool:
        r = requests.post(
            f"{self.base_url}/storage/v1/object/{bucket}/{path}",
            data=data,
            headers={**self.headers, "Content-Type": content_type, "x-upsert": "true"},
            timeout=120,
        )
        return r.status_code in (200, 201)


def text_to_doc(text: str) -> dict:
    """일반 텍스트 -> Tiptap RichDoc JSON.

    빈 줄로 문단을 나눈다. `[[img:파일명]]`만 있는 줄은 앞뒤의 빈 줄 여부와
    무관하게 이미지 블록이 된다. 이미지 블록은 실제 업로드 경로로 나중에
    채워 넣는다(placeholder로 파일명만 먼저 넣어둔다).
    """
    blocks: list[dict] = []
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph_lines:
            return
        content: list[dict] = []
        for i, line in enumerate(paragraph_lines):
            if i > 0:
                content.append({"type": "hardBreak"})
            if line:
                content.append({"type": "text", "text": line})
        blocks.append({"type": "paragraph", "content": content} if content else {"type": "paragraph"})
        paragraph_lines.clear()

    for line in text.strip().split("\n"):
        stripped = line.strip()
        img_match = IMG_MARKER.fullmatch(stripped)
        if img_match:
            flush_paragraph()
            blocks.append({"type": "image", "attrs": {"src": None, "alt": None}, "_filename": img_match.group(1)})
            continue
        if not stripped:
            flush_paragraph()
            continue
        paragraph_lines.append(line)

    flush_paragraph()
    if not blocks:
        blocks = [{"type": "paragraph"}]
    return {"type": "doc", "content": blocks}


def collect_image_filenames(doc: dict) -> set[str]:
    return {block["_filename"] for block in doc["content"] if "_filename" in block}


def validate_image_filename(filename: str) -> str | None:
    if not filename or filename in {".", ".."}:
        return "파일명이 비어 있다"
    if filename != os.path.basename(filename) or "/" in filename or "\\" in filename:
        return "하위 폴더나 경로 문자를 쓸 수 없다"
    extension = os.path.splitext(filename)[1].lower()
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        return f"지원하지 않는 확장자다 ({extension or '확장자 없음'})"
    return None


def resolve_images(doc: dict, uploaded: dict[str, str]) -> None:
    """placeholder 이미지 블록을 실제 storage 경로로 채운다."""
    for block in doc["content"]:
        filename = block.pop("_filename", None)
        if filename is not None:
            block["attrs"]["src"] = uploaded[filename]


def main() -> None:
    parser = argparse.ArgumentParser(description="AI 풀이 CSV 일괄 입력")
    parser.add_argument("csv_path")
    parser.add_argument("--images", default="", help="[[img:...]] 로 참조한 이미지 파일들이 있는 폴더")
    parser.add_argument("--apply", action="store_true", help="실제로 반영한다. 기본은 dry-run")
    args = parser.parse_args()

    base_url, key = load_env()
    client = Client(base_url, key)

    with open(args.csv_path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None or {"question_code", "content"} - set(reader.fieldnames):
            sys.exit("CSV 헤더에 question_code, content 두 컬럼이 있어야 한다")
        csv_rows = list(reader)

    if not csv_rows:
        sys.exit("CSV 에 데이터 행이 없다")

    print(f"CSV {len(csv_rows)}행 읽음")

    # 문제코드 -> id 매핑 (questions_solve 뷰가 question_code 를 계산해서 노출한다)
    code_to_id = {row["question_code"]: row["id"] for row in client.get("questions_solve", {"select": "id,question_code"})}

    seen_codes: set[str] = set()
    docs: dict[str, dict] = {}  # question_id -> doc
    missing_codes: list[str] = []
    dup_codes: list[str] = []

    for row in csv_rows:
        code = (row.get("question_code") or "").strip()
        # 엑셀 등에서 CRLF 로 저장되면 문단 구분 정규식이 어긋나므로 미리 통일한다.
        content = (row.get("content") or "").replace("\r\n", "\n").replace("\r", "\n")
        if not code:
            sys.exit(f"question_code 가 빈 행이 있다: {row}")
        if code in seen_codes:
            dup_codes.append(code)
            continue
        seen_codes.add(code)

        question_id = code_to_id.get(code)
        if question_id is None:
            missing_codes.append(code)
            continue

        docs[question_id] = text_to_doc(content)

    if missing_codes:
        sys.exit(f"DB 에 없는 문제코드 {len(missing_codes)}개: {', '.join(missing_codes)}")
    if dup_codes:
        sys.exit(f"CSV 안에서 문제코드가 중복됐다: {', '.join(dup_codes)}")

    # 이미지 파일 확인
    needed_images: set[str] = set()
    for doc in docs.values():
        needed_images |= collect_image_filenames(doc)

    invalid_images = {
        filename: error
        for filename in sorted(needed_images)
        if (error := validate_image_filename(filename)) is not None
    }
    if invalid_images:
        details = ", ".join(f"{name}: {error}" for name, error in invalid_images.items())
        sys.exit(f"잘못된 이미지 파일명: {details}")

    if needed_images and not args.images:
        sys.exit(f"본문에서 이미지 {len(needed_images)}개를 참조하는데 --images 폴더를 안 줬다: {sorted(needed_images)}")

    missing_files = []
    if needed_images:
        for filename in needed_images:
            if not os.path.isfile(os.path.join(args.images, filename)):
                missing_files.append(filename)
    if missing_files:
        sys.exit(f"--images 폴더에 없는 파일: {sorted(missing_files)}")

    print(f"문제코드 매칭 {len(docs)}건, 이미지 참조 {len(needed_images)}개")

    if not args.apply:
        print("dry-run 이다. --apply 를 붙이면 실제로 반영한다.")
        return

    # 이미지 업로드
    uploaded: dict[str, str] = {}
    if needed_images:
        prefix = f"import/{uuid.uuid4().hex[:8]}"
        for filename in sorted(needed_images):
            local_path = os.path.join(args.images, filename)
            content_type = mimetypes.guess_type(filename)[0] or "image/png"
            with open(local_path, "rb") as fh:
                ok = client.upload_storage(BUCKET, f"{prefix}/{filename}", fh.read(), content_type)
            if not ok:
                sys.exit(f"이미지 업로드 실패: {filename}")
            uploaded[filename] = f"{BUCKET}/{prefix}/{filename}"
        print(f"이미지 {len(uploaded)}개 업로드 완료")

    for doc in docs.values():
        resolve_images(doc, uploaded)

    rows = [{"question_id": question_id, "content": doc} for question_id, doc in docs.items()]
    client.upsert("ai_solutions", rows, on_conflict="question_id")
    print(f"AI 풀이 {len(rows)}건 반영 완료")


if __name__ == "__main__":
    main()
