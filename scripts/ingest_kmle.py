"""Allen 수집 JSON을 독립된 국시 KMLE 문제은행으로 등록한다.

기본 실행은 읽기 전용 미리보기다. 확인한 뒤 ``--apply``를 붙여 반영한다.

    python3 scripts/ingest_kmle.py kmle_*.json --subject 순환기
    python3 scripts/ingest_kmle.py kmle_*.json --subject 순환기 --apply

JSON의 chapter는 ``순환기 총론`` 같은 알렌 대제목과 앱의 ``1 순환기 총론``을
앞 번호와 문장부호를 무시하고 매칭한다. 과목 목차 전체를 담은 JSON도 처리하며,
심혈관계 검사/흉통/실신 같은 소제목에는 문제를 나누어 연결하지 않는다.
"""

from __future__ import annotations

import argparse
import base64
import difflib
import hashlib
import json
import mimetypes
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote_to_bytes, urlparse

try:
    import requests
except ImportError:
    raise SystemExit("requests가 필요합니다. pip install -r scripts/requirements.txt")

try:
    from .ingest_exam import Client
    from .supabase_credentials import load_supabase_credentials
except ImportError:  # `python3 scripts/ingest_kmle.py`로 직접 실행할 때
    from ingest_exam import Client
    from supabase_credentials import load_supabase_credentials


def normalized_title(value: str) -> str:
    """앞 번호와 `/`·`및` 같은 제목 구분 표기를 무시하고 비교한다."""
    without_order = re.sub(r"^\s*\d+\s*[.)\-]?\s*", "", value)
    compact = re.sub(r"[^0-9a-z가-힣]+", "", without_order.casefold())
    return compact.replace("및", "")


def sanitize_question(value: object) -> str:
    """현재 알렌 문제 화면에서 본문 앞에 붙는 글꼴 조작 문구를 제거한다."""
    lines = [line.strip() for line in str(value or "").splitlines() if line.strip()]
    while lines and re.fullmatch(r"(?:조건 해석|A-|A\+|\d{1,2}px)", lines[0]):
        lines.pop(0)
    return "\n".join(lines)


class AllenHtmlParser(HTMLParser):
    """수집기가 저장한 제한된 HTML을 문제의 text/table/image 블록으로 바꾼다."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict] = []
        self.table: list[list[str]] | None = None
        self.row: list[str] | None = None
        self.cell: list[str] | None = None
        self.text_tag: str | None = None
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "table":
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("th", "td") and self.row is not None:
            self.cell = []
        elif tag in ("p", "h1", "h2", "h3", "h4", "h5", "li") and self.table is None:
            self.text_tag = tag
            self.text_parts = []
        elif tag == "br" and self.text_tag:
            self.text_parts.append("\n")
        elif tag == "img" and self.table is None:
            source = values.get("src")
            if source:
                self.blocks.append({"type": "image", "url": source, "caption": values.get("alt") or None})

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)
        elif self.text_tag:
            self.text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in ("th", "td") and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None and self.table is not None:
            if any(self.row):
                self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            if self.table:
                width = max(len(row) for row in self.table)
                rows = [row + [""] * (width - len(row)) for row in self.table]
                self.blocks.append({"type": "table", "headers": rows[0], "rows": rows[1:]})
            self.table = None
        elif tag == self.text_tag:
            text = " ".join("".join(self.text_parts).split())
            if text:
                self.blocks.append({"type": "text", "content": text})
            self.text_tag = None
            self.text_parts = []


def html_blocks(value: str | None) -> list[dict]:
    parser = AllenHtmlParser()
    parser.feed(value or "")
    parser.close()
    return parser.blocks


def decode_data_url(url: str) -> tuple[bytes, str]:
    header, encoded = url.split(",", 1)
    mime = header[5:].split(";", 1)[0] or "application/octet-stream"
    data = base64.b64decode(encoded) if ";base64" in header else unquote_to_bytes(encoded)
    return data, mime


def extension_for(mime: str) -> str:
    if mime.split(";", 1)[0] == "image/webp":
        return ".webp"
    return mimetypes.guess_extension(mime.split(";", 1)[0]) or ".bin"


def image_mime(data: bytes, declared: str, url: str) -> str:
    """CDN이 application/octet-stream으로 보내는 이미지 형식을 판별한다."""
    normalized = declared.split(";", 1)[0].strip().casefold()
    if normalized.startswith("image/"):
        return normalized
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    guessed = mimetypes.guess_type(urlparse(url).path)[0]
    return guessed if guessed and guessed.startswith("image/") else "application/octet-stream"


def download_allen_image(url: str) -> tuple[bytes, str]:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or parsed.hostname != "media.allenslibrary.com":
        raise ValueError("허용되지 않은 원격 이미지 주소")
    response = requests.get(
        url,
        headers={
            "Referer": "https://www.allenslibrary.com/",
            "User-Agent": "Mozilla/5.0 KMLE importer",
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.content
    if not data:
        raise ValueError("빈 이미지 응답")
    if len(data) > 10 * 1024 * 1024:
        raise ValueError("이미지가 10MB를 초과함")
    mime = image_mime(data, response.headers.get("Content-Type", ""), url)
    if not mime.startswith("image/"):
        raise ValueError(f"이미지 형식을 판별할 수 없음: {mime}")
    return data, mime


def upload_inline_images(
    blocks: list[dict], client: Client, prefix: str, apply: bool, warnings: list[str]
) -> list[dict]:
    result: list[dict] = []
    image_index = 0
    for block in blocks:
        if block.get("type") != "image":
            result.append(block)
            continue
        image_index += 1
        url = str(block.get("url") or "")
        try:
            if url.startswith("data:"):
                data, mime = decode_data_url(url)
            else:
                data, mime = download_allen_image(url)
        except Exception as error:  # 잘못된 data URL은 한 문항 전체를 망치지 않는다.
            warnings.append(f"이미지 해석 실패: {error}")
            result.append({**block, "url": "PLACEHOLDER"})
            continue
        digest = hashlib.sha256(data).hexdigest()[:16]
        path = f"kmle/{prefix}/{image_index:02d}-{digest}{extension_for(mime)}"
        if apply and not client.upload_storage("question-images", path, data, mime):
            warnings.append(f"이미지 업로드 실패: {path}")
            result.append({**block, "url": "PLACEHOLDER"})
        else:
            result.append({**block, "url": f"question-images/{path}"})
    return result


def resolve_subject(client: Client, name: str) -> dict:
    rows = client.get("subjects", {"name": f"eq.{name}", "select": "id,name"})
    if rows:
        return rows[0]

    # 화면에서는 내과 아래의 section 문서를 "순환기" 과목처럼 부른다. 실제
    # subjects 행이 없어도 같은 이름의 알렌 섹션이 하나면 그 상위 과목을 쓴다.
    documents = client.get("theory_documents", {"select": "title,subject_id"})
    section_subject_ids = {
        row["subject_id"]
        for row in documents
        if normalized_title(row["title"]) == normalized_title(name)
    }
    if len(section_subject_ids) == 1:
        inferred = client.get(
            "subjects", {"id": f"eq.{next(iter(section_subject_ids))}", "select": "id,name"}
        )
        if inferred:
            print(f"'{name}' 알렌 섹션을 실제 과목 '{inferred[0]['name']}' 아래에서 찾았습니다.")
            return inferred[0]

    available = client.get("subjects", {"select": "name", "order": "sort_order"})
    raise SystemExit(f"과목/알렌 섹션 '{name}'을 찾지 못했습니다. 등록된 과목: {', '.join(row['name'] for row in available)}")


def resolve_group(client: Client, subject_id: str, chapter: str) -> dict:
    rows = client.get(
        "theory_documents",
        {"subject_id": f"eq.{subject_id}", "select": "id,title,has_content,parent_id"},
    )
    matches = [row for row in rows if normalized_title(row["title"]) == normalized_title(chapter)]
    group_matches = [row for row in matches if not row["has_content"]]
    candidates = group_matches or matches
    if not candidates:
        expected = normalized_title(chapter)
        suggestions = sorted(
            rows,
            key=lambda row: difflib.SequenceMatcher(
                None, expected, normalized_title(str(row["title"]))
            ).ratio(),
            reverse=True,
        )[:5]
        nearby = ", ".join(
            f"{row['title']} [id={row['id']}, parent={row.get('parent_id')}, content={row.get('has_content')}]"
            for row in suggestions
        )
        raise SystemExit(
            f"알렌 대제목 '{chapter}'을 이 과목 목차에서 찾지 못했습니다. 가까운 제목: {nearby}"
        )
    if len(candidates) > 1:
        found = ", ".join(f"{row['title']} ({row['id']})" for row in candidates)
        raise SystemExit(f"대제목 '{chapter}' 후보가 여러 개입니다: {found}")
    return candidates[0]


def resolve_exam(client: Client, subject_id: str, apply: bool) -> dict | None:
    rows = client.get(
        "exams",
        {"subject_id": f"eq.{subject_id}", "question_bank": "eq.kmle", "select": "id"},
    )
    if len(rows) > 1:
        raise SystemExit("이 과목에 KMLE 시험이 여러 개 있습니다. 하나로 정리한 뒤 다시 실행하세요.")
    if rows:
        return rows[0]
    if not apply:
        return None
    created = client.post("exams", [{
        "subject_id": subject_id,
        "cohort": "국시",
        "curriculum": "국시 KMLE",
        "exam_name": "문제은행",
        "question_bank": "kmle",
        "required_permission": "study_legendob",
        "status": "published",
    }])
    return created[0]


def load_items(path: Path) -> tuple[list[dict], list[str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data, []
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise SystemExit("KMLE JSON 형식이 아닙니다. items 배열이 필요합니다.")
    return data["items"], [str(value) for value in data.get("imageFailures", [])]


def main() -> None:
    parser = argparse.ArgumentParser(description="Allen KMLE JSON 등록")
    parser.add_argument("json_files", type=Path, nargs="+", help="같은 과목에서 받은 KMLE JSON 파일들")
    parser.add_argument("--subject", required=True, help="앱에 등록된 과목명 (예: 순환기)")
    parser.add_argument("--apply", action="store_true", help="미리보기가 아니라 실제 DB에 반영")
    args = parser.parse_args()

    items: list[dict] = []
    export_failures: list[str] = []
    for json_file in args.json_files:
        file_items, file_failures = load_items(json_file)
        items.extend(file_items)
        export_failures.extend(f"{json_file.name}: {value}" for value in file_failures)
    if not items:
        raise SystemExit("JSON에 문제가 없습니다.")
    chapters = {str(item.get("chapter") or "").strip() for item in items}
    if "" in chapters:
        raise SystemExit("대제목(chapter)이 비어 있는 문제가 있습니다.")

    base_url, key = load_supabase_credentials()
    client = Client(base_url, key)
    subject = resolve_subject(client, args.subject)
    groups = {
        chapter: resolve_group(client, subject["id"], chapter)
        for chapter in sorted(chapters, key=normalized_title)
    }
    exam = resolve_exam(client, subject["id"], args.apply)
    exam_id = exam["id"] if exam else None

    existing_sources = client.get("kmle_sources", {"select": "allen_hash,question_id"})
    existing_by_hash = {row["allen_hash"]: row["question_id"] for row in existing_sources}
    next_number = 1
    if exam_id:
        latest = client.get(
            "questions",
            {"exam_id": f"eq.{exam_id}", "select": "question_number", "order": "question_number.desc", "limit": "1"},
        )
        next_number = (latest[0]["question_number"] + 1) if latest else 1

    inserted = 0
    skipped = 0
    drafts = 0
    warnings: list[str] = []
    print(f"과목: {subject['name']}")
    print("연결 대제목:")
    for chapter, group in groups.items():
        print(f"  {chapter} → {group['title']} ({group['id']})")
    print(f"문제은행: 국시 KMLE · 권한 study_legendob")
    if export_failures:
        print(f"브라우저에서 포함하지 못한 이미지 {len(export_failures)}개는 원격 주소에서 복구합니다.")

    for item in items:
        chapter = str(item.get("chapter") or "").strip()
        group = groups[chapter]
        question_text = sanitize_question(item.get("question"))
        allen_hash = str(item.get("id") or "").strip()
        if not allen_hash:
            raw = f"{question_text}\n{json.dumps(item.get('choices', []), ensure_ascii=False)}"
            allen_hash = "allen_" + hashlib.sha256(raw.encode()).hexdigest()[:24]
        if allen_hash in existing_by_hash:
            skipped += 1
            question_id = existing_by_hash[allen_hash]
            if args.apply:
                client.post("theory_questions", [{
                    "theory_document_id": group["id"],
                    "question_id": question_id,
                    "sort_order": skipped + inserted,
                    "link_source": "import",
                }], prefer="resolution=merge-duplicates,return=minimal")
            continue

        item_warnings: list[str] = []
        prefix = f"{subject['id']}/{allen_hash}"
        stem_blocks = [{"type": "text", "content": question_text}]
        stem_blocks += html_blocks(item.get("contentHtml"))
        stem_blocks = upload_inline_images(stem_blocks, client, prefix + "/stem", args.apply, item_warnings)

        explanation = html_blocks(item.get("explanationHtml"))
        explanation += html_blocks(item.get("explanationAssetsHtml"))
        explanation = upload_inline_images(explanation, client, prefix + "/explanation", args.apply, item_warnings)

        answers = sorted({int(answer["index"]) + 1 for answer in item.get("answers", []) if "index" in answer})
        choices = [
            {"no": index + 1, "text": str(text), "image_url": None}
            for index, text in enumerate(item.get("choices", []))
        ]
        published = bool(answers and stem_blocks[0]["content"] and len(choices) >= 2)
        if not published:
            drafts += 1

        code = str(item.get("code") or "").strip() or None
        source_tags = [value for value in ["KMLE", chapter, code] if value]
        body = {
            "exam_id": exam_id,
            "unit_id": None,
            "question_number": next_number,
            "question_type": "A",
            "stem_blocks": stem_blocks,
            "choices": choices,
            "answer_count": max(1, len(answers)),
            "editor_answer": answers,
            "answer_status": "confirmed" if answers else "unconfirmed",
            "official_explanation": explanation or None,
            "source_tags": source_tags,
            "restorer_note": "Allen에서 수집한 국시 KMLE 문제",
            "variant_type": "original",
            "completeness": "image_missing" if item_warnings else "complete",
            "status": "published" if published else "draft",
        }
        print(f"  {next_number}번 ← {code or allen_hash} ({'공개' if published else '검토 필요'})")
        warnings.extend(f"{code or allen_hash}: {message}" for message in item_warnings)

        if args.apply and exam_id:
            created = client.post("questions", [body])[0]
            question_id = created["id"]
            client.post("kmle_sources", [{
                "question_id": question_id,
                "allen_hash": allen_hash,
                "allen_chapter": chapter,
                "allen_code": code,
                "choice_rates": item.get("choiceRates", []),
                "source_url": item.get("url"),
                "collected_at": item.get("collectedAt"),
            }], prefer="return=minimal")
            client.post("theory_questions", [{
                "theory_document_id": group["id"],
                "question_id": question_id,
                "sort_order": inserted,
                "link_source": "import",
            }], prefer="return=minimal")
            existing_by_hash[allen_hash] = question_id
        else:
            # 여러 파일을 한 번에 미리 볼 때 파일 사이 중복도 새 문제로 두 번 세지 않는다.
            existing_by_hash[allen_hash] = "dry-run"
        inserted += 1
        next_number += 1

    if args.apply and exam_id:
        total = client.get("questions", {"exam_id": f"eq.{exam_id}", "select": "id"})
        client.patch("exams", {"id": f"eq.{exam_id}"}, {
            "total_questions": len(total),
            "restored_questions": len(total),
        })

    print(f"\n새 문제 {inserted}개 · 중복 건너뜀 {skipped}개 · 검토 필요 {drafts}개")
    if warnings:
        print("경고:")
        for message in warnings:
            print(f"  - {message}")
    if not args.apply:
        print("\ndry-run입니다. 내용이 맞으면 --apply를 붙여 다시 실행하세요.")


if __name__ == "__main__":
    main()
