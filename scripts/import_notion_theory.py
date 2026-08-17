"""Notion Markdown ZIP을 QBank 이론 목차/문서로 등록한다.

사용법:
  python3 scripts/import_notion_theory.py "convert_file/이론 보기/신경과 신경외과.zip" --subject-code 06
  python3 scripts/import_notion_theory.py "...zip" --subject-code 06 --apply
  python3 scripts/import_notion_theory.py "순환기 이론.zip" --subject-code 01 --section "순환기" --apply

여러 과목을 한 번에 내보낸 ZIP은 --root-page로 과목 페이지 하나를 골라 등록한다.
  python3 scripts/import_notion_theory.py "알렌 전체 .zip" --subject-code 03 \
      --root-page "산과 (1)" --section "산과" --section-order 1000 --apply

Notion의 Markdown & CSV 내보내기 ZIP을 그대로 받는다. 대분류 문서 중 목차만
있는 것은 has_content=false로 등록해 목차에는 보이되 '이론 보기' 버튼은 만들지
않는다. 실제 본문 Markdown만 문서로 등록한다. 계층 깊이에는 제한이 없고 Notion이
이미지 블록을 페이지로 내보내며 만든 'Untitled' 조각은 건너뛴다. 이미지는 로컬
파일과 외부 URL을 모두 theory-images 비공개 버킷으로 복사한다.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import mimetypes
import os
import re
import subprocess
import sys
import tempfile
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


def to_supported_image(data: bytes, suffix: str) -> tuple[bytes, str]:
    """버킷은 webp/png/jpeg/gif만 받고 브라우저도 HEIC를 못 그리니 PNG로 바꾼다."""
    if suffix.lower() not in {".heic", ".heif"}:
        return data, suffix
    with tempfile.TemporaryDirectory() as folder:
        source, target = os.path.join(folder, "in" + suffix), os.path.join(folder, "out.png")
        with open(source, "wb") as file:
            file.write(data)
        result = subprocess.run(["sips", "-s", "format", "png", source, "--out", target], capture_output=True)
        if result.returncode != 0 or not os.path.exists(target):
            raise RuntimeError(f"HEIC를 PNG로 바꾸지 못했다: {result.stderr.decode('utf-8', 'replace')[:200]}")
        with open(target, "rb") as file:
            return file.read(), ".png"


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
    parser.add_argument("--section-order", type=int, default=None, help="부속 목차의 정렬 순서. 생략하면 대분류 수로 정한다")
    parser.add_argument("--root-page", default="", help="여러 과목이 담긴 내보내기에서 컬렉션 루트로 삼을 페이지 이름. 예: '산과 (1)'")
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
    if args.root_page:
        candidates = sorted(name for name in markdowns if clean_title(name) == args.root_page)
        if len(candidates) != 1:
            sys.exit(f"루트 페이지 '{args.root_page}'를 {len(candidates)}개 찾았다")
        root = candidates[0]
    else:
        root = min(markdowns, key=lambda name: len(PurePosixPath(name).parts))
    # Notion은 최상위 Markdown 파일과 같은 이름의 폴더에 하위 페이지를 둔다.
    # Markdown 파일명 끝의 32자리 id는 폴더명에는 붙지 않는다.
    collection_dir = PurePosixPath(root).parent / clean_title(root)
    # 그 규칙 덕분에 어떤 문서의 부모는 '자기 폴더가 곧 부모 페이지'로 정확히 찾을 수 있다.
    folder_to_markdown = {str(PurePosixPath(name).parent / clean_title(name)): name for name in markdowns}

    def is_notion_fragment(path: str, relative: PurePosixPath) -> bool:
        # Notion은 이미지 블록이나 컬럼을 하위 'Untitled' 페이지로 내보낸다. 본문이
        # 아니라 캡션 조각이므로 그 아래 것까지 통째로 건너뛴다.
        names = [clean_title(part) for part in relative.parts[:-1]] + [clean_title(path)]
        return any(name.startswith("Untitled") for name in names)

    entries = []
    for path, text in markdowns.items():
        if path == root: continue
        try:
            relative = PurePosixPath(path).relative_to(collection_dir)
        except ValueError:
            continue
        if is_notion_fragment(path, relative): continue
        entries.append((path, text, len(relative.parts) - 1, clean_title(path)))
    # '10'을 '2' 앞에 두지 않도록 파일 경로의 숫자를 자연 정렬한다.
    def natural_key(value: str) -> list[object]:
        return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value)]
    # 부모를 자식보다 먼저 등록해야 parent_id를 채울 수 있어 깊이 순으로 정렬한다.
    entries.sort(key=lambda row: (row[2], natural_key(row[0])))
    section_label = f" > {args.section}" if args.section else ""
    depth_counts = {}
    for _, _, depth, _ in entries: depth_counts[depth] = depth_counts.get(depth, 0) + 1
    layers = ", ".join(f"{depth + 1}단계 {count}개" for depth, count in sorted(depth_counts.items()))
    print(f"{subject['name']}{section_label}: 문서 {len(entries)}개 ({layers})")
    if not args.apply:
        for path, text, depth, title in entries:
            print(f"  {'  ' * depth}{title} ({'본문 있음' if doc_has_body(text) else '목차만'})")
        return
    source_prefix = f"section:{args.section}/" if args.section else ""
    existing: dict[str, str] = {}
    if args.resume:
        existing = {row["source_key"]: row["id"] for row in client.get("theory_documents", {"select": "id,source_key", "subject_id": f"eq.{subject['id']}"}) if row.get("source_key")}
    section_id = None
    if args.section:
        section_row = {
            "subject_id": subject["id"],
            "source_key": f"section:{args.section}",
            "title": args.section,
            "sort_order": args.section_order if args.section_order is not None else len(entries) * 1000,
            "has_content": False,
            "is_published": True,
            "content": {"type": "doc", "content": [{"type": "paragraph"}]},
        }
        section_id = client.upsert([section_row])[0]["id"]
    image_cache = {}
    def image_path(source: str, document_path: str) -> str:
        # Notion이 외부로 참조한 이미지는 우선 원본 URL을 유지한다. 응답이
        # 느린 외부 서버 하나 때문에 전체 이론 등록이 중단되지 않게 한다.
        # ZIP 안에 실제로 포함된 이미지는 아래에서 비공개 버킷으로 복사한다.
        if source.startswith("http"):
            return source
        key = str(PurePosixPath(document_path).parent / unquote(source))
        if key in image_cache: return image_cache[key]
        data = archive.read(key); suffix = os.path.splitext(key)[1] or ".png"
        data, suffix = to_supported_image(data, suffix)
        digest = hashlib.sha256(data).hexdigest()[:20]
        stored = f"{subject['id']}/{digest}{suffix.lower()}"
        client.upload(stored, data, mimetypes.guess_type(stored)[0] or "image/png")
        # 뷰어는 첫 경로 조각을 Storage 버킷 이름으로 해석한다.
        image_cache[key] = f"{BUCKET}/{stored}"
        return image_cache[key]
    source_to_id: dict[str, str] = {}
    order_within_parent: dict[str | None, int] = {}
    saved = 0
    for path, text, depth, title in entries:
        parent_path = folder_to_markdown.get(str(PurePosixPath(path).parent))
        parent_id = section_id if depth == 0 else source_to_id.get(parent_path)
        order_within_parent[parent_id] = order_within_parent.get(parent_id, 0) + 1
        source_key = source_prefix + path
        if source_key in existing:
            # 이어서 등록할 때도 자식이 부모를 찾을 수 있게 id는 기억해 둔다.
            source_to_id[path] = existing[source_key]
            continue
        row = {
            "subject_id": subject["id"],
            "source_key": source_key,
            "parent_id": parent_id,
            "title": title,
            "sort_order": order_within_parent[parent_id] * 100,
            "has_content": doc_has_body(text),
            "is_published": True,
            "content": markdown_doc(text, lambda source: image_path(source, path)),
        }
        source_to_id[path] = client.upsert([row])[0]["id"]
        saved += 1
        print(f"등록: {'  ' * depth}{title}")
    print(f"완료: 문서 {saved}개 등록, 이미지 {len(image_cache)}개")


if __name__ == "__main__": main()
