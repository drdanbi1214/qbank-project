"""합쳐진 강의 정리본 Markdown을 강의별로 나누고 PDF 연결 후보를 점검한다.

기본은 dry-run이라 DB와 파일 저장소에는 아무것도 쓰지 않는다. 자동 연결·검토
필요·누락 결과를 확인하고 manifest로 애매한 항목을 명시적으로 승인하거나
제외한 뒤에만 --apply로 DB에 반영한다. PDF 파일 자체는 수정하거나 업로드하지
않는다.

예시:

    python3 scripts/import_lecture_notes.py \
      "강의록/정리본/2026 본2-1 내분비 정리본.md" \
      --course "내분비 1차" \
      --manifest scripts/lecture_note_manifests/2026_endocrine_1.json

    python3 scripts/import_lecture_notes.py \
      "강의록/정리본/2026 본2-1 내분비 정리본.md" \
      --course "내분비 1차" \
      --manifest scripts/lecture_note_manifests/2026_endocrine_1.json \
      --category "내분비계(2026)" --apply

PDF 폴더를 생략하면 MD의 상위 강의록 폴더 아래에서 과목명과 같은 폴더를 찾는다.
다른 위치를 쓸 때만 --pdf-folder를 준다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import hashlib
import json
import pathlib
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass


# 내부 소제목도 `## 1. ...` 형태이므로 날짜로 시작하는 바깥 제목만 강의 경계다.
OUTER_HEADING = re.compile(r"^##\s+(\d+)\.\s+(\d{4}_.+?)\s*$")
COURSE_LINE = re.compile(r"^-\s*과목:\s*(.+?)\s*$")
DATE_LINE = re.compile(r"^-\s*날짜:\s*(\d{4}-\d{2}-\d{2})\s*$")
SUMMARY_MARKER = re.compile(r"^###\s+시험 요점 정리\s*$")
SCHEDULE = re.compile(r"^(\d{4})_([\d,\s-]+)교시_(.+)$", re.IGNORECASE)
SCHEDULE_PROFESSOR_FIRST = re.compile(
    r"^(\d{4})_([가-힣]{2,4})_([\d,\s-]+)교시_(.+)$",
    re.IGNORECASE,
)
KOREAN_NAME = re.compile(r"^[가-힣]{2,4}$")
FAILED_PHRASES = (
    "요점 정리 생성에 실패",
    "정리 생성에 실패",
    "내용을 생성하지 못",
)
DEFAULT_PERMISSION = "mediprep_lecture_notes_view"


def nfc(value: str) -> str:
    """macOS의 분해형 한글 파일명과 MD 제목을 같은 문자열로 비교한다."""
    return unicodedata.normalize("NFC", value).strip()


def normalized_words(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[^0-9a-z가-힣]+", "", value)


@dataclass(frozen=True)
class ScheduleInfo:
    month_day: str
    periods: tuple[int, ...]
    professor: str | None
    title: str


@dataclass(frozen=True)
class NoteSection:
    order: int
    source_key: str
    course: str | None
    lecture_date: str | None
    markdown: str
    start_line: int
    failed_reason: str | None
    schedule: ScheduleInfo | None


@dataclass(frozen=True)
class PdfLecture:
    path: pathlib.Path
    filename: str
    schedule: ScheduleInfo | None


@dataclass(frozen=True)
class Candidate:
    filename: str
    score: int
    reasons: tuple[str, ...]
    same_date: bool
    period_overlap: bool
    professor_conflict: bool
    title_conflict: bool
    title_similarity: float


@dataclass(frozen=True)
class MatchResult:
    section: NoteSection
    status: str
    candidate: Candidate | None
    alternatives: tuple[Candidate, ...]


@dataclass(frozen=True)
class ResolvedNote:
    section: NoteSection
    pdf_filename: str
    resolution: str


def parse_periods(value: str) -> tuple[int, ...]:
    periods: set[int] = set()
    for token in value.replace(" ", "").split(","):
        if not token:
            continue
        if "-" in token:
            left, right = token.split("-", 1)
            if left.isdigit() and right.isdigit():
                start, end = int(left), int(right)
                periods.update(range(min(start, end), max(start, end) + 1))
                continue
        if token.isdigit():
            periods.add(int(token))
    return tuple(sorted(periods))


def parse_schedule(value: str) -> ScheduleInfo | None:
    stem = nfc(pathlib.Path(value).stem)
    found = SCHEDULE.match(stem)
    if found:
        month_day = found.group(1)
        periods = parse_periods(found.group(2))
        rest = found.group(3).strip()
        pieces = rest.split("_", 1)
        professor = pieces[0].strip() if len(pieces) == 2 and KOREAN_NAME.fullmatch(pieces[0].strip()) else None
        title = pieces[1].strip() if professor and len(pieces) == 2 else rest
    else:
        professor_first = SCHEDULE_PROFESSOR_FIRST.match(stem)
        if not professor_first:
            return None
        month_day = professor_first.group(1)
        professor = professor_first.group(2).strip()
        periods = parse_periods(professor_first.group(3))
        title = professor_first.group(4).strip()

    return ScheduleInfo(
        month_day=month_day,
        periods=periods,
        professor=professor,
        title=nfc(title),
    )


def _trim_content(lines: list[str]) -> str:
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    # 강의 사이 구분선은 다음 구획의 일부가 아니라 합쳐진 파일의 포장이다.
    if lines and lines[-1].strip() == "---":
        lines.pop()
        while lines and not lines[-1].strip():
            lines.pop()
    return "\n".join(lines)


def parse_markdown(path: pathlib.Path) -> list[NoteSection]:
    lines = path.read_text(encoding="utf-8").splitlines()
    boundaries: list[tuple[int, re.Match[str]]] = []
    for index, line in enumerate(lines):
        found = OUTER_HEADING.match(nfc(line))
        if found:
            boundaries.append((index, found))

    sections: list[NoteSection] = []
    for position, (start, heading) in enumerate(boundaries):
        end = boundaries[position + 1][0] if position + 1 < len(boundaries) else len(lines)
        block = lines[start:end]
        course = None
        lecture_date = None
        marker_index = None
        for offset, line in enumerate(block[1:], 1):
            normalized = nfc(line)
            if course is None:
                found_course = COURSE_LINE.match(normalized)
                if found_course:
                    course = nfc(found_course.group(1))
            if lecture_date is None:
                found_date = DATE_LINE.match(normalized)
                if found_date:
                    lecture_date = found_date.group(1)
            if SUMMARY_MARKER.match(normalized):
                marker_index = offset
                break

        source_key = nfc(heading.group(2))
        if marker_index is None:
            markdown = ""
            failed_reason = "'시험 요점 정리' 구획을 찾지 못함"
        else:
            markdown = _trim_content(block[marker_index + 1 :])
            failed_reason = next((phrase for phrase in FAILED_PHRASES if phrase in markdown), None)
            if not markdown and failed_reason is None:
                failed_reason = "정리 내용이 비어 있음"

        sections.append(
            NoteSection(
                order=int(heading.group(1)),
                source_key=source_key,
                course=course,
                lecture_date=lecture_date,
                markdown=markdown,
                start_line=start + 1,
                failed_reason=failed_reason,
                schedule=parse_schedule(source_key),
            )
        )
    return sections


def load_pdfs(folder: pathlib.Path) -> list[PdfLecture]:
    return [
        PdfLecture(path=path, filename=nfc(path.name), schedule=parse_schedule(path.name))
        for path in sorted(folder.glob("*.pdf"), key=lambda item: nfc(item.name))
        if path.is_file()
    ]


def _day_distance(left: str, right: str) -> int | None:
    try:
        left_date = dt.date(2000, int(left[:2]), int(left[2:]))
        right_date = dt.date(2000, int(right[:2]), int(right[2:]))
    except (TypeError, ValueError):
        return None
    return abs((left_date - right_date).days)


def score_candidate(section: NoteSection, pdf: PdfLecture) -> Candidate:
    note = section.schedule
    target = pdf.schedule
    if not note or not target:
        return Candidate(pdf.filename, -100, ("시간표 형식 해석 실패",), False, False, False, False, 0.0)

    score = 0
    reasons: list[str] = []
    same_date = note.month_day == target.month_day
    distance = _day_distance(note.month_day, target.month_day)
    if same_date:
        score += 50
        reasons.append("날짜 일치")
    elif distance == 1:
        score += 8
        reasons.append("날짜 1일 차이")
    else:
        score -= 15
        reasons.append("날짜 불일치")

    note_periods = set(note.periods)
    pdf_periods = set(target.periods)
    overlap = bool(note_periods & pdf_periods)
    if note_periods and note_periods == pdf_periods:
        score += 35
        reasons.append("교시 일치")
    elif note_periods and note_periods.issubset(pdf_periods):
        score += 28
        reasons.append("합쳐진 PDF 교시에 포함")
    elif overlap:
        score += 18
        reasons.append("교시 일부 겹침")
    else:
        score -= 35
        reasons.append("교시 불일치")

    professor_conflict = False
    if note.professor and target.professor:
        if normalized_words(note.professor) == normalized_words(target.professor):
            score += 30
            reasons.append("교수 일치")
        else:
            professor_conflict = True
            score -= 25
            reasons.append("교수 불일치")

    note_title = normalized_words(note.title)
    pdf_title = normalized_words(target.title)
    similarity = difflib.SequenceMatcher(None, note_title, pdf_title).ratio() if note_title and pdf_title else 0
    # 교시·교수가 같아도 긴 강의명이 전혀 다르면 다른 강의를 잘못 고를 수 있다.
    # RT, MEN 같은 짧은 약어는 이 규칙에서 제외하고 사람이 쓴 시간표 정보를 따른다.
    title_conflict = len(note_title) >= 4 and similarity < 0.18
    title_points = round(similarity * 35)
    score += title_points
    reasons.append(f"제목 {similarity:.0%}" + (" (불일치)" if title_conflict else ""))

    return Candidate(
        pdf.filename,
        score,
        tuple(reasons),
        same_date,
        overlap,
        professor_conflict,
        title_conflict,
        similarity,
    )


def match_sections(sections: list[NoteSection], pdfs: list[PdfLecture]) -> list[MatchResult]:
    results: list[MatchResult] = []
    for section in sections:
        if section.failed_reason:
            results.append(MatchResult(section, "FAILED", None, ()))
            continue

        ranked = tuple(
            sorted(
                (score_candidate(section, pdf) for pdf in pdfs),
                key=lambda item: (-item.score, item.filename),
            )
        )
        best = ranked[0] if ranked else None
        runner_up = ranked[1].score if len(ranked) > 1 else -999
        note_title = normalized_words(section.schedule.title) if section.schedule else ""
        likely_swapped_schedule = bool(
            best
            and len(note_title) >= 4
            and any(
                alternative.same_date
                and not alternative.professor_conflict
                and alternative.title_similarity >= 0.72
                and alternative.title_similarity - best.title_similarity >= 0.35
                for alternative in ranked[1:]
            )
        )
        if (
            best
            and best.score >= 75
            and best.same_date
            and best.period_overlap
            and not best.professor_conflict
            and not best.title_conflict
            and not likely_swapped_schedule
            and best.score - runner_up >= 8
        ):
            status = "AUTO"
        elif best and best.score >= 35:
            status = "REVIEW"
        else:
            status = "UNMATCHED"
        results.append(MatchResult(section, status, best, ranked[1:3]))
    return results


def find_duplicate_sections(sections: list[NoteSection]) -> dict[str, list[NoteSection]]:
    grouped: dict[str, list[NoteSection]] = {}
    for section in sections:
        grouped.setdefault(section.source_key, []).append(section)
    return {source_key: items for source_key, items in grouped.items() if len(items) > 1}


def load_manifest(path: pathlib.Path | None) -> dict[str, dict[str, object]]:
    if path is None:
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("manifest 최상위 값은 강의 키를 키로 하는 JSON 객체여야 합니다.")

    manifest: dict[str, dict[str, object]] = {}
    for raw_key, raw_value in payload.items():
        if not isinstance(raw_key, str) or not isinstance(raw_value, dict):
            raise ValueError("manifest의 각 값은 JSON 객체여야 합니다.")
        value = dict(raw_value)
        pdf = value.get("pdf")
        pdfs = value.get("pdfs")
        skip = value.get("skip")
        if pdf is not None and not isinstance(pdf, str):
            raise ValueError(f"manifest의 pdf는 문자열이어야 합니다: {raw_key}")
        if pdfs is not None and (
            not isinstance(pdfs, list)
            or not pdfs
            or any(not isinstance(item, str) or not item.strip() for item in pdfs)
        ):
            raise ValueError(f"manifest의 pdfs는 비어 있지 않은 문자열 배열이어야 합니다: {raw_key}")
        if skip is not None and not isinstance(skip, bool):
            raise ValueError(f"manifest의 skip은 true/false여야 합니다: {raw_key}")
        selected_actions = sum((bool(pdf), bool(pdfs), skip is True))
        if selected_actions > 1:
            raise ValueError(f"pdf, pdfs, skip 중 하나만 지정할 수 있습니다: {raw_key}")
        manifest[nfc(raw_key)] = value
    return manifest


def resolve_matches(
    results: list[MatchResult],
    manifest: dict[str, dict[str, object]],
) -> tuple[list[ResolvedNote], list[NoteSection], list[MatchResult]]:
    resolved: list[ResolvedNote] = []
    skipped: list[NoteSection] = []
    unresolved: list[MatchResult] = []

    selected_keys = {result.section.source_key for result in results}
    unknown = sorted(set(manifest) - selected_keys)
    if unknown:
        raise ValueError("선택 과목에 없는 manifest 강의 키: " + ", ".join(unknown))

    for result in results:
        override = manifest.get(result.section.source_key, {})
        if override.get("skip") is True:
            skipped.append(result.section)
            continue

        override_pdf = override.get("pdf")
        override_pdfs = override.get("pdfs")
        if isinstance(override_pdfs, list):
            for pdf_filename in dict.fromkeys(nfc(str(item)) for item in override_pdfs):
                resolved.append(ResolvedNote(result.section, pdf_filename, "manifest 복수 승인"))
        elif isinstance(override_pdf, str) and override_pdf.strip():
            resolved.append(ResolvedNote(result.section, nfc(override_pdf), "manifest 승인"))
        elif result.status == "AUTO" and result.candidate:
            resolved.append(ResolvedNote(result.section, result.candidate.filename, "자동"))
        else:
            unresolved.append(result)
    return resolved, skipped, unresolved


def markdown_title(section: NoteSection) -> str:
    for line in section.markdown.splitlines():
        found = re.match(r"^#\s+(.+?)\s*$", line)
        if found:
            return nfc(found.group(1))
    if section.schedule and section.schedule.title:
        return section.schedule.title
    return section.source_key


def markdown_to_text(markdown: str) -> str:
    """검색 문맥에 Markdown 기호가 그대로 나오지 않게 가벼운 평문으로 바꾼다."""
    text = unicodedata.normalize("NFC", markdown)
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"^\s{0,3}(?:#{1,6}|>|[-+*]\s|\d+[.)]\s)\s*", "", text, flags=re.MULTILINE)
    text = text.replace("|", " ").replace("`", "")
    text = re.sub(r"[*_~]{1,3}", "", text)
    text = re.sub(r"^[\s:|-]+$", "", text, flags=re.MULTILINE)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def safe_pdf_key(name: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z가-힣._-]+", "_", pathlib.Path(nfc(name)).stem).strip("._-")
    return f"{cleaned or 'lecture'}.pdf"


def print_resolution_report(
    resolved: list[ResolvedNote],
    skipped: list[NoteSection],
    unresolved: list[MatchResult],
) -> None:
    print("\n[승인 manifest 반영 결과]")
    print(f"  등록 준비 {len(resolved)} · 명시적 제외 {len(skipped)} · 미해결 {len(unresolved)}")
    for item in resolved:
        if item.resolution != "자동":
            print(f"  승인  {item.section.source_key}")
            print(f"     -> {item.pdf_filename}")
    for section in skipped:
        print(f"  제외  {section.source_key}")
    for result in unresolved:
        print(f"  미해결  {result.section.source_key} ({result.status})")


def _api_request(
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
        data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
        method=method,
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = response.read()
    return json.loads(payload) if payload else None


def apply_notes(
    resolved: list[ResolvedNote],
    category_name: str,
    permission: str,
) -> int:
    # 직접 실행과 unittest 모듈 import 양쪽에서 같은 자격 증명 로더를 쓴다.
    script_folder = str(pathlib.Path(__file__).resolve().parent)
    if script_folder not in sys.path:
        sys.path.insert(0, script_folder)
    from supabase_credentials import load_supabase_credentials  # type: ignore[import-not-found]

    base, key = load_supabase_credentials()
    encoded_category = urllib.parse.quote(category_name, safe="")
    categories = _api_request(
        base,
        key,
        "GET",
        f"/rest/v1/lecture_categories?select=id,name&name=eq.{encoded_category}",
    )
    if not isinstance(categories, list) or len(categories) != 1:
        raise RuntimeError(f"강의록 분류를 하나로 찾지 못했습니다: {category_name}")
    category_id = categories[0]["id"]

    documents = _api_request(
        base,
        key,
        "GET",
        "/rest/v1/lecture_documents"
        f"?select=id,title,file_path&category_id=eq.{category_id}",
    )
    if not isinstance(documents, list):
        raise RuntimeError("강의록 목록 응답을 해석하지 못했습니다.")

    by_filename: dict[str, list[dict[str, object]]] = {}
    for document in documents:
        filename = pathlib.PurePosixPath(str(document["file_path"])).name
        by_filename.setdefault(nfc(filename), []).append(document)

    admins = _api_request(
        base,
        key,
        "GET",
        "/rest/v1/profiles?select=id&role=eq.admin&order=created_at&limit=1",
    )
    created_by = admins[0]["id"] if isinstance(admins, list) and admins else None

    rows: list[dict[str, object]] = []
    errors: list[str] = []
    for item in resolved:
        key_name = safe_pdf_key(item.pdf_filename)
        targets = by_filename.get(key_name, [])
        if len(targets) != 1:
            errors.append(
                f"{item.section.source_key}: DB에서 {key_name}을 "
                f"{len(targets)}개 찾음"
            )
            continue

        markdown = unicodedata.normalize("NFC", item.section.markdown).strip()
        rows.append(
            {
                "lecture_id": targets[0]["id"],
                "source_key": item.section.source_key,
                "source_course": item.section.course,
                "lecture_date": item.section.lecture_date,
                "title": markdown_title(item.section),
                "content_md": markdown,
                "content_text": markdown_to_text(markdown),
                "source_hash": hashlib.sha256(markdown.encode()).hexdigest(),
                "required_permission": permission,
                "sort_order": item.section.order,
                "created_by": created_by,
            }
        )

    if errors:
        raise RuntimeError("DB 강의록 연결 실패:\n  " + "\n  ".join(errors))

    for offset in range(0, len(rows), 100):
        _api_request(
            base,
            key,
            "POST",
            "/rest/v1/lecture_student_notes?on_conflict=lecture_id,source_key",
            rows[offset : offset + 100],
            prefer="return=minimal,resolution=merge-duplicates",
        )
    return len(rows)


def _display_key(section: NoteSection) -> str:
    return f"{section.order:>2}. {section.source_key}"


def print_report(
    markdown_path: pathlib.Path,
    pdf_folder: pathlib.Path,
    course: str,
    all_sections: list[NoteSection],
    selected: list[NoteSection],
    pdfs: list[PdfLecture],
    results: list[MatchResult],
) -> None:
    counts = {status: sum(result.status == status for result in results) for status in ("AUTO", "REVIEW", "UNMATCHED", "FAILED")}
    all_failures = [section for section in all_sections if section.failed_reason]
    print("강의 정리본 가져오기 미리보기 (DRY-RUN · DB 변경 없음)")
    print(f"  MD       {markdown_path}")
    print(f"  과목     {course}")
    print(f"  PDF 폴더 {pdf_folder}")
    print()
    print(
        f"전체 구획 {len(all_sections)} · 선택 과목 {len(selected)} · PDF {len(pdfs)} · "
        f"자동 {counts['AUTO']} · 검토 {counts['REVIEW']} · 미연결 {counts['UNMATCHED']} · 실패 {counts['FAILED']}"
    )
    if all_failures:
        outside = sum(section.course != course for section in all_failures)
        print(f"원본 전체 생성 실패 {len(all_failures)}개" + (f" (선택 과목 밖 {outside}개 포함)" if outside else ""))

    duplicates = find_duplicate_sections(all_sections)
    print("\n[원본에서 중복된 강의 키]")
    if not duplicates:
        print("  없음")
    for source_key, sections in duplicates.items():
        same_content = len({section.markdown.strip() for section in sections}) == 1
        print(f"  {source_key} · 본문 {'동일' if same_content else '서로 다름'}")
        for section in sections:
            print(
                f"     - {section.order}번 · {section.course or '과목 없음'} · "
                f"{section.lecture_date or '날짜 없음'} · MD {section.start_line}행"
            )

    print("\n[자동 연결]")
    automatic = [result for result in results if result.status == "AUTO"]
    if not automatic:
        print("  없음")
    for result in automatic:
        assert result.candidate
        print(f"  {_display_key(result.section)}")
        print(f"     -> {result.candidate.filename}  (점수 {result.candidate.score})")

    print("\n[사람 확인 필요]")
    review = [result for result in results if result.status == "REVIEW"]
    if not review:
        print("  없음")
    for result in review:
        assert result.candidate
        print(f"  {_display_key(result.section)}")
        print(f"     1순위 {result.candidate.filename}  (점수 {result.candidate.score}; {', '.join(result.candidate.reasons)})")
        for index, candidate in enumerate(result.alternatives, 2):
            print(f"     {index}순위 {candidate.filename}  (점수 {candidate.score})")

    print("\n[연결할 PDF를 찾지 못한 정리본]")
    unmatched = [result for result in results if result.status == "UNMATCHED"]
    if not unmatched:
        print("  없음")
    for result in unmatched:
        candidate = f" · 가장 가까운 후보 {result.candidate.filename} ({result.candidate.score})" if result.candidate else ""
        print(f"  {_display_key(result.section)}{candidate}")

    print("\n[정리 생성 실패]")
    failures = [result for result in results if result.status == "FAILED"]
    if not failures:
        print("  선택 과목에는 없음")
    for result in failures:
        print(f"  {_display_key(result.section)} · {result.section.failed_reason}")

    linked = {result.candidate.filename for result in automatic if result.candidate}
    review_candidates = {result.candidate.filename for result in review if result.candidate}
    print("\n[자동 연결되지 않은 PDF]")
    unlinked_pdfs = [pdf for pdf in pdfs if pdf.filename not in linked]
    if not unlinked_pdfs:
        print("  없음")
    for pdf in unlinked_pdfs:
        suffix = " · 위 검토 후보" if pdf.filename in review_candidates else ""
        print(f"  {pdf.filename}{suffix}")

    grouped: dict[str, list[NoteSection]] = {}
    for result in automatic:
        if result.candidate:
            grouped.setdefault(result.candidate.filename, []).append(result.section)
    combined = {filename: notes for filename, notes in grouped.items() if len(notes) > 1}
    print("\n[정리본 여러 개가 연결되는 합본 PDF]")
    if not combined:
        print("  없음")
    for filename, notes in combined.items():
        print(f"  {filename}")
        for note in notes:
            print(f"     - {note.source_key}")


def json_report(
    markdown_path: pathlib.Path,
    pdf_folder: pathlib.Path,
    course: str,
    all_sections: list[NoteSection],
    selected: list[NoteSection],
    pdfs: list[PdfLecture],
    results: list[MatchResult],
) -> str:
    duplicates = find_duplicate_sections(all_sections)
    payload = {
        "dry_run": True,
        "markdown": str(markdown_path),
        "pdf_folder": str(pdf_folder),
        "course": course,
        "total_sections": len(all_sections),
        "selected_sections": len(selected),
        "pdf_count": len(pdfs),
        "results": [
            {
                "order": result.section.order,
                "source_key": result.section.source_key,
                "course": result.section.course,
                "start_line": result.section.start_line,
                "status": result.status,
                "failed_reason": result.section.failed_reason,
                "candidate": asdict(result.candidate) if result.candidate else None,
                "alternatives": [asdict(candidate) for candidate in result.alternatives],
            }
            for result in results
        ],
        "source_failures": [
            {
                "order": section.order,
                "source_key": section.source_key,
                "course": section.course,
                "reason": section.failed_reason,
            }
            for section in all_sections
            if section.failed_reason
        ],
        "source_duplicates": [
            {
                "source_key": source_key,
                "same_content": len({section.markdown.strip() for section in sections}) == 1,
                "sections": [
                    {
                        "order": section.order,
                        "course": section.course,
                        "lecture_date": section.lecture_date,
                        "start_line": section.start_line,
                    }
                    for section in sections
                ],
            }
            for source_key, sections in duplicates.items()
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(description="합쳐진 강의 정리본 MD와 PDF 연결 결과를 미리 본다")
    parser.add_argument("markdown", type=pathlib.Path, help="과목별로 합쳐진 Markdown 파일")
    parser.add_argument("--course", required=True, help='가져올 과목 구획. 예: "내분비 1차"')
    parser.add_argument("--pdf-folder", type=pathlib.Path, default=None, help="비교할 PDF 폴더")
    parser.add_argument("--manifest", type=pathlib.Path, default=None, help="검토 승인·제외 JSON")
    parser.add_argument("--category", default=None, help='운영 DB 강의록 분류. 예: "내분비계(2026)"')
    parser.add_argument(
        "--permission",
        default=DEFAULT_PERMISSION,
        help=f"정리본 열람 권한 키 (기본: {DEFAULT_PERMISSION})",
    )
    parser.add_argument("--apply", action="store_true", help="승인된 연결을 운영 DB에 등록")
    parser.add_argument("--json", action="store_true", help="사람용 보고서 대신 JSON 출력")
    args = parser.parse_args()

    markdown_path = args.markdown.expanduser().resolve()
    if not markdown_path.is_file():
        parser.error(f"MD 파일을 찾지 못했습니다: {markdown_path}")

    course = nfc(args.course)
    pdf_folder = (
        args.pdf_folder.expanduser().resolve()
        if args.pdf_folder
        else markdown_path.parent.parent.joinpath(course).resolve()
    )
    if not pdf_folder.is_dir():
        parser.error(f"PDF 폴더를 찾지 못했습니다: {pdf_folder} (--pdf-folder로 지정할 수 있습니다)")

    manifest_path = args.manifest.expanduser().resolve() if args.manifest else None
    if manifest_path and not manifest_path.is_file():
        parser.error(f"manifest 파일을 찾지 못했습니다: {manifest_path}")
    if args.apply and manifest_path is None:
        parser.error("실제 등록에는 검토 결과를 고정한 --manifest가 필요합니다.")
    if args.apply and not args.category:
        parser.error("실제 등록에는 운영 DB의 --category가 필요합니다.")

    all_sections = parse_markdown(markdown_path)
    selected = [section for section in all_sections if section.course == course]
    if not selected:
        available = ", ".join(sorted({section.course for section in all_sections if section.course}))
        parser.error(f"과목 '{course}' 구획이 없습니다. 발견한 과목: {available or '없음'}")

    pdfs = load_pdfs(pdf_folder)
    if not pdfs:
        parser.error(f"PDF가 없습니다: {pdf_folder}")

    results = match_sections(selected, pdfs)
    try:
        manifest = load_manifest(manifest_path)
        resolved, skipped, unresolved = resolve_matches(results, manifest)
    except (OSError, ValueError, json.JSONDecodeError) as caught:
        parser.error(str(caught))

    available_pdfs = {pdf.filename for pdf in pdfs}
    missing_manifest_pdfs = sorted(
        item.pdf_filename
        for item in resolved
        if item.resolution == "manifest 승인" and item.pdf_filename not in available_pdfs
    )
    if missing_manifest_pdfs:
        parser.error("manifest가 가리킨 PDF가 폴더에 없습니다: " + ", ".join(missing_manifest_pdfs))

    if args.json:
        payload = json.loads(
            json_report(markdown_path, pdf_folder, course, all_sections, selected, pdfs, results)
        )
        payload["resolution"] = {
            "ready": [
                {
                    "source_key": item.section.source_key,
                    "pdf": item.pdf_filename,
                    "resolution": item.resolution,
                }
                for item in resolved
            ],
            "skipped": [section.source_key for section in skipped],
            "unresolved": [result.section.source_key for result in unresolved],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_report(markdown_path, pdf_folder, course, all_sections, selected, pdfs, results)
        if manifest_path:
            print_resolution_report(resolved, skipped, unresolved)

    if args.apply:
        if unresolved:
            print("\n미해결 항목이 있어 DB 등록을 중단했습니다.", file=sys.stderr)
            return 2
        try:
            applied = apply_notes(resolved, nfc(args.category), nfc(args.permission))
        except Exception as caught:
            print(f"\nDB 등록 실패: {caught}", file=sys.stderr)
            return 1
        print(f"\n운영 DB에 강의 정리본 {applied}개를 등록했습니다.")
    elif manifest_path and not args.json:
        print("\n시늉 모드였습니다. 실제 등록하려면 --category와 --apply를 붙이세요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
