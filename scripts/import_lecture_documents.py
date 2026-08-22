"""강의록 PDF 를 R2 에 올리고 lecture_documents 에 등록한다.

강의록은 관리자만 올린다. 수백 건·수 GB 를 브라우저로 밀어 넣는 건 비현실적이라
등록 경로를 이 스크립트 하나로 정했다. 웹에는 강의록 업로드 화면이 없다.

한 파일에 대해 이 순서로 처리한다.

1. PDF 안의 이미지를 다시 인코딩해 용량을 줄인다. 품질 기준(150dpi/q85)은
   compress_lecture_pdfs.py 와 같다. 줄어드는 폭은 원본에 크게 달렸다. 고해상도
   슬라이드를 담은 강의록은 78% 까지 줄지만, 이미 알맞은 해상도로 뽑은 파일은
   몇 % 에 그친다. 안 줄어드는 것도 정상이라 등록을 막지 않는다.
2. 줄인 결과의 SHA-256 을 구한다. lecture_documents.content_hash 가 유니크라
   같은 파일을 두 번 올리면 DB 가 막는다. 올리기 전에 먼저 물어봐서 이미 있으면
   업로드 자체를 건너뛴다.
3. 쪽수와 본문 텍스트를 뽑는다. 텍스트는 문서 간 검색에만 쓴다. 스캔본은 글자가
   이미지라 비어서 나오는데, 그건 오류가 아니라 제목·교수로만 찾게 된다는 뜻이다.
4. R2 에 올리고 DB 행을 만든다. 업로드가 성공한 뒤에만 행을 만들어, 파일 없는
   행이 남지 않게 한다.

기본은 시늉만 하는 모드다. 실제로 올리려면 --apply 를 준다.

    python3 scripts/import_lecture_documents.py ~/강의록/순환기 \\
        --category 심혈관계 --curriculum "2026 본 2-1 계통 Y" --year 2026

    python3 scripts/import_lecture_documents.py ~/강의록/순환기 \\
        --category 심혈관계 --year 2026 --apply

분류(--category)는 강의록 화면의 "과목"이며 임상 과목(내과·외과…)과 별개다.
없는 이름을 주면 새로 만든다. 웹의 "과목 추가"로 미리 만들어 둔 것과 같은 것이다.

파일명에서 교수명과 제목을 뽑아 보지만 규칙이 제각각이라 자주 틀린다. 먼저
시늉 모드로 돌려 결과를 보고, 어긋나면 --manifest 로 바로잡는다. manifest 는
파일명을 키로 하는 JSON 이다.

    {"순환기_01_김철수.pdf": {"title": "심부전의 진단", "professor": "김철수"}}
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

import fitz

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from object_storage import R2Backend  # noqa: E402
from supabase_credentials import load_supabase_credentials  # noqa: E402

BUCKET = "lecture-documents"
QUALITY, DPI_TARGET = 85, 150

# "김철수 교수님", "김철수교수", "[김철수]" 처럼 흔한 표기에서 이름만 집는다.
PROFESSOR_PATTERNS = (
    re.compile(r"([가-힣]{2,4})\s*교수님"),
    re.compile(r"([가-힣]{2,4})\s*교수"),
    re.compile(r"[\[(]\s*([가-힣]{2,4})\s*[\])]"),
)
YEAR_PATTERN = re.compile(r"(20\d{2})")

# 강의 시간표에서 그대로 내려받은 이름. 날짜(MMDD)·교시·교수명·제목이 밑줄로
# 끊겨 있다. 교수와 교시의 앞뒤가 바뀐 것이 섞여 있어 둘 다 받는다.
#   0212_3,4교시_이유경_심장영상의학
#   0602_김용석_2교시_비만증치료의 분자생물학적 접근
TIMETABLE_PATTERNS = (
    re.compile(r"^(\d{4})_[\d,\s]+교시_([가-힣]{2,4})_(.+)$"),
    re.compile(r"^(\d{4})_([가-힣]{2,4})_[\d,\s]+교시_(.+)$"),
)
# 교수명이 아예 없는 것도 있다. 예) 0517_8,9교시_anatomy&histology lab
TIMETABLE_NO_PROFESSOR = re.compile(r"^(\d{4})_[\d,\s]+교시_(.+)$")


def rest(base: str, key: str, method: str, path: str, body: bytes | None = None) -> bytes:
    request = urllib.request.Request(
        f"{base}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def _shrink_here(source: pathlib.Path, target: pathlib.Path) -> None:
    """자식 프로세스 안에서만 부른다. shrink() 의 설명을 볼 것."""
    document = fitz.open(source)
    document.rewrite_images(
        dpi_threshold=int(DPI_TARGET * 1.3),
        dpi_target=DPI_TARGET,
        quality=QUALITY,
        lossy=True,
    )
    document.save(target, garbage=4, deflate=True, clean=True)
    document.close()


def shrink(source: pathlib.Path) -> bytes:
    """PDF 안의 이미지를 다시 인코딩해 용량을 줄인다.

    변환은 반드시 자식 프로세스에서 돌린다. rewrite_images 는 큰 PDF 를 연달아
    처리하면 세그폴트로 죽는데(파일은 멀쩡하고 단독 실행하면 성공한다) 파일마다
    프로세스를 새로 띄우면 상태가 누적되지 않고, 죽더라도 그 한 건만 실패한다.
    compress_lecture_pdfs.py 가 같은 이유로 같은 구조를 쓴다.

    줄지 않거나 변환이 실패하면 원본을 그대로 쓴다. 이미 알맞은 해상도로 뽑은
    강의록은 줄어들 여지가 없는데, 그건 정상이라 등록을 막지 않는다.
    """
    # 원본을 미리 읽지 않는다. 30MB 짜리를 든 채로 자식을 띄우면 변환이 메모리를
    # 크게 쓰는 순간 SIGBUS 로 죽는 일이 있었다(같은 파일을 단독으로 돌리면 된다).
    original_size = source.stat().st_size

    with tempfile.TemporaryDirectory() as workdir:
        shrunk = None
        # 죽는 건 파일 탓이 아니라 그때그때라, 같은 파일도 다시 돌리면 대개 된다.
        # 한 번만 더 해 보고 그래도 안 되면 원본으로 올린다.
        for attempt in (1, 2):
            target = pathlib.Path(workdir) / f"shrunk{attempt}.pdf"
            result = subprocess.run(
                [sys.executable, __file__, "--shrink", str(source), str(target)],
                capture_output=True,
                timeout=900,
            )
            if result.returncode == 0 and target.exists():
                # 줄어든 경우에만 읽는다. 여기서도 쓸데없이 두 벌을 들지 않는다.
                if target.stat().st_size < original_size:
                    shrunk = target.read_bytes()
                break
            if attempt == 2:
                lines = result.stderr.decode(errors="replace").strip().splitlines()
                detail = lines[-1] if lines else f"종료코드 {result.returncode}"
                print(f"           압축 건너뜀(원본 사용): {detail[:120]}")

        if shrunk is not None:
            return shrunk

    return source.read_bytes()


def profile(data: bytes) -> tuple[int, str]:
    document = fitz.open(stream=data, filetype="pdf")
    try:
        pages = len(document)
        text = "\n".join(page.get_text().strip() for page in document)
    finally:
        document.close()
    return pages, text.strip()


def guess_meta(name: str) -> tuple[str, str | None, int | None]:
    stem = pathlib.Path(name).stem

    def clean(text: str) -> str:
        return re.sub(r"\s+", " ", text.replace("_", " ")).strip(" .")

    # 날짜에는 연도가 없다. 연도는 --year 로 받는다.
    for pattern in TIMETABLE_PATTERNS:
        found = pattern.match(stem)
        if found:
            return (clean(found.group(3)) or stem), found.group(2), None

    plain = TIMETABLE_NO_PROFESSOR.match(stem)
    if plain:
        return (clean(plain.group(2)) or stem), None, None

    professor = None
    for pattern in PROFESSOR_PATTERNS:
        found = pattern.search(stem)
        if found:
            professor = found.group(1)
            break

    year_found = YEAR_PATTERN.search(stem)
    year = int(year_found.group(1)) if year_found else None

    title = stem
    if professor:
        title = re.sub(rf"{re.escape(professor)}\s*교수(님)?", " ", title)
    if year_found:
        title = title.replace(year_found.group(1), " ")
    title = re.sub(r"[_\-\[\]()]+", " ", title)
    title = re.sub(r"\s+", " ", title).strip(" .")
    return (title or stem), professor, year


def safe_key(name: str) -> str:
    """R2 키로 쓸 이름. 인가 함수가 막는 문자를 미리 없앤다."""
    cleaned = re.sub(r"[^0-9A-Za-z가-힣._-]+", "_", pathlib.Path(name).stem).strip("._-")
    return f"{cleaned or 'lecture'}.pdf"


def main() -> int:
    # 자식 프로세스로 다시 들어온 경우. shrink() 참고.
    if len(sys.argv) == 4 and sys.argv[1] == "--shrink":
        _shrink_here(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]))
        return 0

    parser = argparse.ArgumentParser(description="강의록 PDF 일괄 등록")
    parser.add_argument("folder", type=pathlib.Path, help="PDF 가 든 폴더 (하위 폴더까지 훑는다)")
    parser.add_argument("--category", required=True, help="강의록 분류 이름. 없으면 새로 만든다")
    parser.add_argument("--curriculum", default=None, help='예: "2026 본 2-1 계통 Y"')
    parser.add_argument("--year", type=int, default=None, help="판본 연도. 파일명에서 못 찾을 때 쓴다")
    parser.add_argument("--professor", default=None, help="폴더 전체가 같은 교수일 때")
    parser.add_argument("--permission", default=None, help="열람 권한 키. 생략하면 활성 회원 전원")
    parser.add_argument("--prefix", default="", help="R2 경로 앞에 붙일 폴더명")
    parser.add_argument("--manifest", type=pathlib.Path, default=None, help="파일명별 메타데이터 JSON")
    parser.add_argument("--no-compress", action="store_true", help="압축하지 않고 원본 그대로 올린다")
    parser.add_argument("--apply", action="store_true", help="실제로 올리고 등록한다")
    args = parser.parse_args()

    if not args.folder.is_dir():
        print(f"폴더가 없습니다: {args.folder}")
        return 1

    manifest: dict[str, dict] = {}
    if args.manifest:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))

    base, key = load_supabase_credentials()

    category_name = args.category.strip()
    found = json.loads(
        rest(base, key, "GET", f"/rest/v1/lecture_categories?select=id,name&name=eq.{urllib.parse.quote(category_name)}")
    )
    if found:
        category_id = found[0]["id"]
    elif args.apply:
        created = json.loads(
            rest(base, key, "POST", "/rest/v1/lecture_categories", json.dumps({"name": category_name}).encode())
        )
        category_id = created[0]["id"]
        print(f"분류를 새로 만들었습니다: {category_name}")
    else:
        category_id = None
        print(f"분류 '{category_name}' 는 아직 없습니다. --apply 로 돌리면 새로 만듭니다.")

    admins = json.loads(rest(base, key, "GET", "/rest/v1/profiles?select=id&role=eq.admin&order=created_at&limit=1"))
    created_by = admins[0]["id"] if admins else None

    pdfs = sorted(p for p in args.folder.rglob("*.pdf") if p.is_file())
    if not pdfs:
        print("PDF 를 찾지 못했습니다.")
        return 1

    backend = R2Backend() if args.apply else None
    before_total = after_total = 0
    registered = skipped = failed = 0

    print(
        f"{len(pdfs)}개 PDF · 분류 {category_name}"
        + (" · 원본 그대로" if args.no_compress else "")
        + ("" if args.apply else " · 시늉 모드(--apply 없음)")
    )
    print()

    for pdf in pdfs:
        override = manifest.get(pdf.name, {})
        title, professor, year = guess_meta(pdf.name)
        title = override.get("title", title)
        professor = override.get("professor", professor or args.professor)
        year = override.get("year", year or args.year)

        data = pdf.read_bytes() if args.no_compress else shrink(pdf)
        digest = hashlib.sha256(data).hexdigest()
        original_size = pdf.stat().st_size
        before_total += original_size
        after_total += len(data)

        existing = json.loads(
            rest(base, key, "GET", f"/rest/v1/lecture_documents?select=id,title&content_hash=eq.{digest}")
        )
        if existing:
            print(f"  건너뜀  {pdf.name}\n           이미 등록됨: {existing[0]['title']}")
            skipped += 1
            continue

        pages, text = profile(data)
        path = f"{args.prefix.strip('/')}/{safe_key(pdf.name)}" if args.prefix else safe_key(pdf.name)
        shrink_note = f"{original_size / 1024 / 1024:.1f}MB → {len(data) / 1024 / 1024:.1f}MB"
        text_note = f"{len(text):,}자" if text else "텍스트 없음(스캔본)"

        print(f"  {'등록' if args.apply else '등록 예정'}  {title}")
        print(f"           {professor or '교수 미상'} · {year or '연도 미상'} · {pages}쪽 · {shrink_note} · {text_note}")
        print(f"           {BUCKET}/{path}")

        if not args.apply:
            registered += 1
            continue

        try:
            # 파일을 먼저 올리고 성공한 뒤에만 행을 만든다. 반대로 하면 파일 없는
            # 행이 남아 화면에서 열리지 않는 강의록이 생긴다.
            backend.upload(BUCKET, path, data, "application/pdf", sha256=digest)
            body = json.dumps(
                {
                    "category_id": category_id,
                    "title": title,
                    "professor": professor,
                    "curriculum": args.curriculum,
                    "lecture_year": year,
                    "file_path": f"{BUCKET}/{path}",
                    "content_hash": digest,
                    "byte_size": len(data),
                    "page_count": pages,
                    "text_content": text or None,
                    "required_permission": args.permission,
                    "created_by": created_by,
                }
            ).encode()
            rest(base, key, "POST", "/rest/v1/lecture_documents", body)
            registered += 1
        except Exception as exc:
            print(f"           실패: {exc}")
            failed += 1

    print()
    print(f"등록 {registered} · 건너뜀 {skipped} · 실패 {failed}")
    if before_total:
        saved = 100 - after_total / before_total * 100
        print(f"용량 {before_total / 1024 / 1024:.0f}MB → {after_total / 1024 / 1024:.0f}MB ({saved:.0f}% 감소)")
    if not args.apply:
        print("시늉 모드였습니다. 실제로 올리려면 --apply 를 붙이세요.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
