"""Notion Markdown ZIP을 QBank 이론 목차/문서로 등록한다.

사용법:
  python3 scripts/import_notion_theory.py "convert_file/이론 보기/신경과 신경외과.zip" --subject-code 06
  python3 scripts/import_notion_theory.py "...zip" --subject-code 06 --apply
  python3 scripts/import_notion_theory.py "순환기 이론.zip" --subject-code 01 --section "순환기" --apply

Notion의 Markdown & CSV 내보내기 ZIP을 그대로 받는다. 대분류 문서 중 목차만
있는 것은 has_content=false로 등록해 목차에는 보이되 '이론 보기' 버튼은 만들지
않는다. 실제 본문 Markdown만 문서로 등록한다. 이미지는 로컬 파일과 외부 URL을
모두 theory-images 비공개 버킷으로 복사한다.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import mimetypes
import os
import re
import sys
import uuid
import zipfile
from pathlib import PurePosixPath
from urllib.parse import unquote, urlparse

try:
    import requests
except ImportError:
    sys.exit("requests 가 필요하다. pip install -r scripts/requirements.txt")

BUCKET = "theory-images"
IMAGE_LINE = re.compile(r"^\s*!\[([^]]*)\]\(([^)]+)\)\s*$")
LINK_OR_BOLD = re.compile(r"(\*\*.+?\*\*|\[[^]]+\]\([^)]+\))")


def load_env() -> tuple[str, str]:
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    for path in (".env", os.path.join(os.path.dirname(__file__), ".env")):
        if url and key or not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            if "=" in line and not line.lstrip().startswith("#"):
                name, value = line.strip().split("=", 1)
                os.environ.setdefault(name, value)
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL, SUPABASE_SERVICE_KEY가 필요하다")
    return url.rstrip("/"), key


class Client:
    def __init__(self, url: str, key: str):
        self.url, self.headers = url, {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def get(self, table: str, params: dict) -> list[dict]:
        response = requests.get(f"{self.url}/rest/v1/{table}", headers=self.headers, params=params, timeout=60)
        response.raise_for_status()
        return response.json()

    def upsert(self, rows: list[dict]) -> list[dict]:
        response = requests.post(f"{self.url}/rest/v1/theory_documents", headers={**self.headers, "Prefer": "return=representation,resolution=merge-duplicates"}, params={"on_conflict": "subject_id,source_key"}, json=rows, timeout=120)
        if response.status_code not in (200, 201):
            raise RuntimeError(f"이론 문서 저장 실패: {response.status_code} {response.text[:500]}")
        return response.json()

    def upload(self, path: str, data: bytes, mime: str) -> None:
        response = requests.post(f"{self.url}/storage/v1/object/{BUCKET}/{path}", headers={**self.headers, "Content-Type": mime, "x-upsert": "true"}, data=data, timeout=120)
        if response.status_code not in (200, 201):
            raise RuntimeError(f"이미지 업로드 실패: {path} ({response.status_code})")


def clean_title(path: str) -> str:
    return re.sub(r"\s+[0-9a-f]{32}$", "", PurePosixPath(path).stem).strip()


def doc_has_body(text: str) -> bool:
    body = re.sub(r"^# .*?$", "", text, flags=re.M)
    body = re.sub(r"\[[^]]+\]\([^)]+\)", "", body)
    body = re.sub(r"<aside>|</aside>|💡|#+\s*Table of content", "", body, flags=re.I)
    return bool(re.sub(r"\s|\d|[.()\-]", "", body))


def inline(text: str) -> list[dict]:
    nodes: list[dict] = []
    position = 0
    for match in LINK_OR_BOLD.finditer(text):
        if match.start() > position:
            nodes.append({"type": "text", "text": text[position:match.start()]})
        token = match.group(0)
        if token.startswith("**"):
            nodes.append({"type": "text", "text": token[2:-2], "marks": [{"type": "bold"}]})
        else:
            label, href = re.match(r"\[([^]]+)\]\(([^)]+)\)", token).groups()  # type: ignore[union-attr]
            nodes.append({"type": "text", "text": label, "marks": [{"type": "link", "attrs": {"href": href}}]})
        position = match.end()
    if position < len(text): nodes.append({"type": "text", "text": text[position:]})
    return nodes


def markdown_doc(text: str, image_path) -> dict:
    blocks, lines, index = [], text.splitlines(), 0
    while index < len(lines):
        line = lines[index]
        if not line.strip() or line.strip() in {"<aside>", "</aside>"}:
            index += 1; continue
        image = IMAGE_LINE.match(line)
        if image:
            blocks.append({"type": "image", "attrs": {"src": image_path(image.group(2)), "alt": image.group(1) or None}}); index += 1; continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", line)
        if heading:
            blocks.append({"type": "heading", "attrs": {"level": len(heading.group(1))}, "content": inline(heading.group(2))}); index += 1; continue
        if line.startswith("|"):
            table = []
            while index < len(lines) and lines[index].startswith("|"):
                cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                    table.append({"type": "tableRow", "content": [{"type": "tableCell", "content": [{"type": "paragraph", "content": inline(cell)}]} for cell in cells]})
                index += 1
            blocks.append({"type": "table", "content": table}); continue
        list_match = re.match(r"^\s*[-*+]\s+(.+)$", line)
        if list_match:
            items = []
            while index < len(lines):
                item = re.match(r"^\s*[-*+]\s+(.+)$", lines[index])
                if not item: break
                items.append({"type": "listItem", "content": [{"type": "paragraph", "content": inline(item.group(1))}]}); index += 1
            blocks.append({"type": "bulletList", "content": items}); continue
        paragraph = [line]
        index += 1
        while index < len(lines) and lines[index].strip() and not re.match(r"^(#{1,4})\s+|^\s*!\[|^\s*[-*+]\s+|^\|", lines[index]):
            paragraph.append(lines[index]); index += 1
        content = []
        for n, part in enumerate(paragraph):
            if n: content.append({"type": "hardBreak"})
            content.extend(inline(part))
        blocks.append({"type": "paragraph", "content": content})
    return {"type": "doc", "content": blocks or [{"type": "paragraph"}]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Notion Markdown ZIP 이론 등록")
    parser.add_argument("zip_path")
    parser.add_argument("--subject-code", required=True, help="과목 코드. 신경과는 06")
    parser.add_argument("--section", default="", help="과목 안에 만들 부속 목차 이름. 예: 순환기")
    parser.add_argument("--resume", action="store_true", help="이미 등록된 문서는 건너뛰고 중단 지점부터 이어서 등록")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    outer = zipfile.ZipFile(args.zip_path)
    nested = [x.filename for x in outer.infolist() if x.filename.lower().endswith(".zip")]
    archive = zipfile.ZipFile(io.BytesIO(outer.read(nested[0]))) if nested else outer
    markdowns = {name: archive.read(name).decode("utf-8") for name in archive.namelist() if name.endswith(".md")}
    if not markdowns: sys.exit("Markdown 파일이 없는 Notion 내보내기다")
    url, key = load_env(); client = Client(url, key)
    subjects = client.get("subjects", {"select": "id,name", "code": f"eq.{args.subject_code}"})
    if len(subjects) != 1: sys.exit(f"과목 코드 {args.subject_code}를 찾지 못했다")
    subject = subjects[0]
    root = min(markdowns, key=lambda name: len(PurePosixPath(name).parts))
    # Notion은 최상위 Markdown 파일과 같은 이름의 폴더에 하위 페이지를 둔다.
    # Markdown 파일명 끝의 32자리 id는 폴더명에는 붙지 않는다.
    collection_dir = PurePosixPath(root).parent / clean_title(root)
    entries = []
    for path, text in markdowns.items():
        if path == root or "/Untitled/" in path: continue
        try:
            relative = PurePosixPath(path).relative_to(collection_dir)
        except ValueError:
            continue
        depth = len(relative.parts) - 1
        if depth > 1: continue
        entries.append((path, text, depth, clean_title(path)))
    # '10'을 '2' 앞에 두지 않도록 파일 경로의 숫자를 자연 정렬한다.
    def natural_key(value: str) -> list[object]:
        return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]
    entries.sort(key=lambda row: (row[2], natural_key(row[0])))
    top = [(path, text, title) for path, text, depth, title in entries if depth == 0]
    children = [(path, text, title) for path, text, depth, title in entries if depth == 1]
    section_label = f" > {args.section}" if args.section else ""
    print(f"{subject['name']}{section_label}: 대분류 {len(top)}개, 세부 문서 {len(children)}개")
    if not args.apply:
        for _, text, title in top: print(f"  목차  {title} ({'본문 있음' if doc_has_body(text) else '목차만'})")
        for _, _, title in children: print(f"  문서  {title}")
        return
    source_prefix = f"section:{args.section}/" if args.section else ""
    existing_keys: set[str] = set()
    if args.resume:
        existing_keys = {row["source_key"] for row in client.get("theory_documents", {"select": "source_key", "subject_id": f"eq.{subject['id']}"}) if row.get("source_key")}
    section_id = None
    if args.section:
        section_row = {
            "subject_id": subject["id"],
            "source_key": f"section:{args.section}",
            "title": args.section,
            "sort_order": len(top) * 1000,
            "has_content": False,
            "is_published": True,
            "content": {"type": "doc", "content": [{"type": "paragraph"}]},
        }
        section_id = client.upsert([section_row])[0]["id"]
    source_to_id = {}
    for order, (path, text, title) in enumerate(top, 1):
        row = {"subject_id": subject["id"], "source_key": source_prefix + path, "parent_id": section_id, "title": title, "sort_order": order * 100, "has_content": doc_has_body(text), "is_published": True, "content": markdown_doc(text, lambda _: "")}
        source_to_id[path] = client.upsert([row])[0]["id"]
    image_cache = {}
    def image_path(source: str, document_path: str) -> str:
        # Notion이 외부로 참조한 이미지는 우선 원본 URL을 유지한다. 응답이
        # 느린 외부 서버 하나 때문에 전체 이론 등록이 중단되지 않게 한다.
        # ZIP 안에 실제로 포함된 이미지는 아래에서 비공개 버킷으로 복사한다.
        if source.startswith("http"):
            return source
        key = source if source.startswith("http") else str(PurePosixPath(document_path).parent / unquote(source))
        if key in image_cache: return image_cache[key]
        data = archive.read(key); suffix = os.path.splitext(key)[1] or ".png"
        digest = hashlib.sha256(data).hexdigest()[:20]
        stored = f"{subject['id']}/{digest}{suffix.lower()}"
        client.upload(stored, data, mimetypes.guess_type(stored)[0] or "image/png")
        image_cache[key] = stored
        return stored
    for order, (path, text, title) in enumerate(children, 1):
        if source_prefix + path in existing_keys:
            continue
        parent_folder = PurePosixPath(path).parent.name
        parent = next((candidate for candidate, _, _ in top if clean_title(candidate).split(" ", 1)[0] == parent_folder.split(" ", 1)[0]), None)
        row = {"subject_id": subject["id"], "source_key": source_prefix + path, "parent_id": source_to_id.get(parent), "title": title, "sort_order": order, "has_content": True, "is_published": True, "content": markdown_doc(text, lambda source: image_path(source, path))}
        client.upsert([row]); print(f"등록: {title}")
    print(f"완료: 목차 {len(top)}개, 본문 {len(children)}개, 이미지 {len(image_cache)}개")


if __name__ == "__main__": main()
