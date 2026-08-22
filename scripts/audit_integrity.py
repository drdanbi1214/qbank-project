"""운영 QBank의 문제·풀이·이미지 연결 상태를 읽기 전용으로 점검한다.

이 파일에는 DB/스토리지 쓰기 메서드가 없다. Supabase에는 HTTP GET만,
Cloudflare R2에는 HTTP HEAD만 보낸다. 결과 JSON은 로컬 ``tmp/`` 아래에만 쓴다.

사용법:
    python3 scripts/audit_integrity.py
    python3 scripts/audit_integrity.py --skip-storage
    python3 scripts/audit_integrity.py --output tmp/integrity-audits/latest.json
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import pathlib
import re
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable
from urllib.parse import urlparse

import requests

from object_storage import R2Backend
from supabase_credentials import load_supabase_credentials

PAGE_SIZE = 500
# 현재 규모에서는 문제 행을 전부 보고서에 남겨야 실제 수정 목록으로 쓸 수 있다.
# 비정상 폭증으로 JSON이 무한히 커지는 것만 막는다.
EXAMPLE_LIMIT = 500
KNOWN_BUCKETS = {
    "ai-solution-images",
    "avatars",
    "exam-sources",
    "question-images",
    "senior-solution-images",
    "solution-images",
    "solution-lecture-files",
    "theory-images",
    "topic-images",
}

# 필요한 열만 받는다. 값이 큰 JSON 열도 무결성/이미지 경로 검사에 필요한 경우만
# 포함한다. 모든 요청은 ReadOnlySupabase.get_rows()의 GET을 통해서만 나간다.
TABLE_SELECTS = {
    "subjects": "id,code,name",
    "units": "id,subject_id,name",
    "exams": (
        "id,cohort,subject_id,exam_name,total_questions,restored_questions,"
        "source_file_url"
    ),
    "question_sets": "id,exam_id,shared_choices",
    "question_groups": "id,canonical_question_id",
    "questions": (
        "id,exam_id,unit_id,question_number,question_type,set_id,stem_blocks,choices,"
        "answer_count,editor_answer,yama_answer,answer_status,official_explanation,"
        "grading_points,group_id,same_as,variant_type,completeness,status"
    ),
    "profiles": "id,avatar_url",
    "solutions": "id,author_id,question_id,group_id,content,references",
    "ai_solutions": "id,question_id,content",
    "senior_solutions": "id,question_id,content",
    "personal_notes": "id,user_id,question_id,group_id,content",
    "theory_documents": "id,subject_id,unit_id,title,content,is_published",
    "topics": "id,subject_id,unit_id,title,content",
    "announcements": "id,content",
    "discussions": "id,question_id,content",
    "discussion_replies": "id,discussion_id,content",
    "content_deletion_audit": "id,deleted_at,transaction_id,table_name,row_id,trigger_depth",
}


class ReadOnlySupabase:
    """PostgREST 읽기 전용 클라이언트.

    의도치 않은 변경 API가 추가되지 않도록 공개 메서드는 GET 하나뿐이다.
    신형 ``sb_secret_`` 키는 기존 관리 스크립트와 동일하게 apikey에만 넣는다.
    """

    def __init__(self, base_url: str, key: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {"apikey": key, "Accept": "application/json"}

    def get_rows(self, table: str, select: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            response = requests.get(
                f"{self.base_url}/rest/v1/{table}",
                headers={**self.headers, "Range": f"{offset}-{offset + PAGE_SIZE - 1}"},
                params={"select": select},
                timeout=(15, 120),
            )
            if not response.ok:
                raise RuntimeError(
                    f"{table} 조회 실패 HTTP {response.status_code}: {response.text[:300]}"
                )
            page = response.json()
            if not isinstance(page, list):
                raise RuntimeError(f"{table} 응답이 배열이 아닙니다.")
            rows.extend(page)
            if len(page) < PAGE_SIZE:
                return rows
            offset += len(page)


@dataclass
class Finding:
    severity: str
    code: str
    message: str
    count: int = 0
    examples: list[dict[str, Any]] = field(default_factory=list)


class Findings:
    def __init__(self) -> None:
        self._items: dict[tuple[str, str, str], Finding] = {}

    def add(
        self,
        severity: str,
        code: str,
        message: str,
        example: dict[str, Any] | None = None,
    ) -> None:
        key = (severity, code, message)
        item = self._items.setdefault(key, Finding(severity, code, message))
        item.count += 1
        if example is not None and len(item.examples) < EXAMPLE_LIMIT:
            item.examples.append(example)

    def rows(self) -> list[Finding]:
        rank = {"error": 0, "warning": 1, "info": 2}
        return sorted(self._items.values(), key=lambda row: (rank[row.severity], row.code))

    def counts(self) -> dict[str, int]:
        result = Counter[str]()
        for row in self._items.values():
            result[row.severity] += row.count
        return {level: result[level] for level in ("error", "warning", "info")}


@dataclass(frozen=True)
class StorageReference:
    path: str
    table: str
    row_id: str
    field: str


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def has_meaningful_content(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(has_meaningful_content(item) for item in value)
    if isinstance(value, dict):
        if value.get("type") == "image":
            return True
        return any(has_meaningful_content(item) for item in value.values())
    return value is not None


def storage_path(value: str) -> str | None:
    candidate = value.strip().lstrip("/")
    if candidate.startswith(("http://", "https://", "data:", "blob:")):
        return None
    bucket, separator, name = candidate.partition("/")
    if separator and bucket in KNOWN_BUCKETS and name:
        return f"{bucket}/{name}"
    return None


def walk_strings(value: Any, json_path: str = "$") -> Iterable[tuple[str, str]]:
    if isinstance(value, str):
        yield json_path, value
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk_strings(item, f"{json_path}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from walk_strings(item, f"{json_path}.{key}")


def collect_storage_references(
    tables: dict[str, list[dict[str, Any]]], findings: Findings
) -> list[StorageReference]:
    refs: list[StorageReference] = []
    scan_fields = {
        "questions": ("stem_blocks", "choices", "official_explanation", "grading_points"),
        "solutions": ("content", "references"),
        "ai_solutions": ("content",),
        "senior_solutions": ("content",),
        "personal_notes": ("content",),
        "theory_documents": ("content",),
        "topics": ("content",),
        "announcements": ("content",),
        "discussions": ("content",),
        "discussion_replies": ("content",),
    }

    for exam in tables["exams"]:
        value = exam.get("source_file_url")
        if isinstance(value, str) and value.strip():
            path = storage_path(value)
            if path:
                refs.append(StorageReference(path, "exams", exam["id"], "source_file_url"))
            elif not value.startswith(("http://", "https://")):
                findings.add(
                    "warning",
                    "invalid_storage_path",
                    "스토리지 경로가 '<bucket>/<path>' 형식이 아닙니다.",
                    {"table": "exams", "id": exam["id"], "value": value},
                )

    for profile in tables["profiles"]:
        value = profile.get("avatar_url")
        if isinstance(value, str) and value.strip():
            path = storage_path(value)
            if path:
                refs.append(StorageReference(path, "profiles", profile["id"], "avatar_url"))

    for table, fields in scan_fields.items():
        for row in tables[table]:
            row_id = str(row.get("id") or "")
            for field_name in fields:
                value = row.get(field_name)
                for json_path, text in walk_strings(value):
                    if text == "PLACEHOLDER":
                        declared_missing = (
                            table == "questions"
                            and field_name == "stem_blocks"
                            and row.get("completeness") == "image_missing"
                        )
                        findings.add(
                            "warning" if declared_missing else "error",
                            "declared_image_placeholder" if declared_missing else "image_placeholder",
                            (
                                "이미지 누락으로 표시된 문항에 PLACEHOLDER가 남아 있습니다."
                                if declared_missing
                                else "저장된 콘텐츠에 미처리 이미지 PLACEHOLDER가 남아 있습니다."
                            ),
                            {"table": table, "id": row_id, "field": field_name, "path": json_path},
                        )
                        continue
                    path = storage_path(text)
                    if path:
                        refs.append(
                            StorageReference(path, table, row_id, f"{field_name}:{json_path}")
                        )
    return refs


def choice_numbers(question: dict[str, Any], question_sets: dict[str, dict[str, Any]]) -> set[int]:
    choices = as_list(question.get("choices"))
    numbers = {
        int(choice.get("no", index + 1))
        for index, choice in enumerate(choices)
        if isinstance(choice, dict) and isinstance(choice.get("no", index + 1), int)
    }
    if numbers or question.get("question_type") != "R":
        return numbers
    shared = as_list(question_sets.get(question.get("set_id"), {}).get("shared_choices"))
    # R형 보기는 A, B처럼 문자를 쓰기도 하지만 저장된 정답은 선택 순번(int)이다.
    return set(range(1, len(shared) + 1))


def run_relational_checks(tables: dict[str, list[dict[str, Any]]], findings: Findings) -> None:
    subjects = {row["id"]: row for row in tables["subjects"]}
    units = {row["id"]: row for row in tables["units"]}
    exams = {row["id"]: row for row in tables["exams"]}
    sets = {row["id"]: row for row in tables["question_sets"]}
    groups = {row["id"]: row for row in tables["question_groups"]}
    questions = {row["id"]: row for row in tables["questions"]}
    profiles = {row["id"]: row for row in tables["profiles"]}
    question_counts = Counter(row["exam_id"] for row in tables["questions"])
    published_counts = Counter(
        row["exam_id"] for row in tables["questions"] if row.get("status") == "published"
    )

    for exam in tables["exams"]:
        exam_id = exam["id"]
        if exam.get("subject_id") not in subjects:
            findings.add("error", "exam_subject_missing", "시험의 과목이 존재하지 않습니다.", {"exam_id": exam_id})
        actual = question_counts[exam_id]
        published = published_counts[exam_id]
        if actual == 0:
            findings.add("warning", "exam_without_questions", "문항이 하나도 없는 시험입니다.", {"exam_id": exam_id})
        restored = exam.get("restored_questions")
        if restored is not None and int(restored) != actual:
            findings.add(
                "warning",
                "exam_restored_count_mismatch",
                "시험의 복기 문항 수와 실제 DB 문항 수가 다릅니다.",
                {"exam_id": exam_id, "declared": restored, "actual": actual, "published": published},
            )
        total = exam.get("total_questions")
        if total is not None and restored is not None and int(restored) > int(total):
            findings.add(
                "warning",
                "exam_restored_over_total",
                "복기 문항 수가 시험 총 문항 수보다 큽니다.",
                {"exam_id": exam_id, "restored": restored, "total": total},
            )

    question_codes: dict[str, list[str]] = defaultdict(list)
    for question in tables["questions"]:
        question_id = question["id"]
        exam = exams.get(question.get("exam_id"))
        if not exam:
            findings.add("error", "question_exam_missing", "문항의 시험이 존재하지 않습니다.", {"question_id": question_id})
            continue
        subject = subjects.get(exam.get("subject_id"))
        unit = units.get(question.get("unit_id")) if question.get("unit_id") else None
        if question.get("unit_id") and not unit:
            findings.add("error", "question_unit_missing", "문항의 단원이 존재하지 않습니다.", {"question_id": question_id})
        elif unit and unit.get("subject_id") != exam.get("subject_id"):
            findings.add(
                "error",
                "question_unit_subject_mismatch",
                "문항 단원의 과목과 시험 과목이 다릅니다.",
                {"question_id": question_id, "exam_id": exam["id"], "unit_id": unit["id"]},
            )

        set_id = question.get("set_id")
        if set_id:
            question_set = sets.get(set_id)
            if not question_set:
                findings.add("error", "question_set_missing", "문항의 R형 세트가 존재하지 않습니다.", {"question_id": question_id})
            elif question_set.get("exam_id") != question.get("exam_id"):
                findings.add(
                    "error",
                    "question_set_exam_mismatch",
                    "문항과 R형 세트가 서로 다른 시험에 속합니다.",
                    {"question_id": question_id, "set_id": set_id},
                )

        group_id = question.get("group_id")
        if group_id and group_id not in groups:
            findings.add("error", "question_group_missing", "문항의 야마 묶음이 존재하지 않습니다.", {"question_id": question_id})

        same_as = question.get("same_as")
        if same_as:
            target = questions.get(same_as)
            if not target:
                findings.add("error", "same_as_missing", "동일 문항 기준점이 존재하지 않습니다.", {"question_id": question_id, "same_as": same_as})
            elif same_as == question_id:
                findings.add("error", "same_as_self", "문항이 자기 자신을 동일 문항으로 가리킵니다.", {"question_id": question_id})
            elif not group_id or target.get("group_id") != group_id:
                findings.add("error", "same_as_group_mismatch", "동일 문항끼리 야마 묶음이 다릅니다.", {"question_id": question_id, "same_as": same_as})
        if question.get("variant_type") == "identical" and not same_as:
            findings.add("warning", "identical_without_same_as", "identical 문항에 동일 기준 문항이 없습니다.", {"question_id": question_id})
        if same_as and question.get("variant_type") != "identical":
            findings.add("warning", "same_as_variant_mismatch", "same_as가 있지만 variant_type이 identical이 아닙니다.", {"question_id": question_id})

        if question.get("status") == "published":
            if not has_meaningful_content(question.get("stem_blocks")):
                findings.add("error", "published_empty_stem", "공개 문항의 발문이 비어 있습니다.", {"question_id": question_id})
            if question.get("completeness") != "complete":
                findings.add(
                    "warning",
                    "published_incomplete_question",
                    "미완성 표시된 문항이 공개 상태입니다.",
                    {"question_id": question_id, "completeness": question.get("completeness")},
                )

        if question.get("question_type") == "A" and not as_list(question.get("choices")):
            findings.add("warning", "choice_question_without_choices", "A형 문항에 보기가 없습니다.", {"question_id": question_id})

        answers = as_list(question.get("editor_answer")) or as_list(question.get("yama_answer"))
        available = choice_numbers(question, sets)
        invalid_answers = [answer for answer in answers if not isinstance(answer, int) or answer not in available]
        if answers and available and invalid_answers:
            findings.add(
                "error",
                "answer_outside_choices",
                "정답 번호가 보기 범위를 벗어납니다.",
                {"question_id": question_id, "answers": answers, "choices": sorted(available)},
            )
        if question.get("status") == "published" and not answers and question.get("question_type") != "essay":
            findings.add("info", "published_answer_missing", "공개 객관식 문항에 입력된 정답이 없습니다.", {"question_id": question_id})

        if subject and subject.get("code"):
            cohort_match = re.search(r"\d+", str(exam.get("cohort") or ""))
            if cohort_match:
                code = f"{cohort_match.group(0)}{subject['code']}{int(question['question_number']):03d}"
                question_codes[code].append(question_id)

    for code, ids in question_codes.items():
        if len(ids) > 1:
            findings.add(
                "error",
                "duplicate_question_code",
                "계산된 문제 코드가 중복되어 코드 기반 풀이 입력 대상이 모호합니다.",
                {"question_code": code, "question_ids": ids},
            )

    questions_by_group: dict[str, set[str]] = defaultdict(set)
    for question in tables["questions"]:
        if question.get("group_id"):
            questions_by_group[question["group_id"]].add(question["id"])
    for group in tables["question_groups"]:
        canonical = group.get("canonical_question_id")
        if canonical and canonical not in questions_by_group[group["id"]]:
            findings.add(
                "error",
                "group_canonical_mismatch",
                "야마 묶음의 대표 문항이 그 묶음에 속하지 않습니다.",
                {"group_id": group["id"], "canonical_question_id": canonical},
            )

    for table in ("solutions", "personal_notes"):
        for row in tables[table]:
            row_id = row["id"]
            question_id = row.get("question_id")
            group_id = row.get("group_id")
            if bool(question_id) == bool(group_id):
                findings.add("error", f"{table}_target_ambiguous", f"{table} 행의 연결 대상은 정확히 하나여야 합니다.", {"id": row_id})
            if question_id and question_id not in questions:
                findings.add("error", f"{table}_question_missing", f"{table} 행의 문항이 존재하지 않습니다.", {"id": row_id, "question_id": question_id})
            if group_id and group_id not in groups:
                findings.add("error", f"{table}_group_missing", f"{table} 행의 야마 묶음이 존재하지 않습니다.", {"id": row_id, "group_id": group_id})
            owner_key = "author_id" if table == "solutions" else "user_id"
            if row.get(owner_key) not in profiles:
                findings.add("error", f"{table}_owner_missing", f"{table} 행의 작성자가 존재하지 않습니다.", {"id": row_id})
            if not has_meaningful_content(row.get("content")):
                findings.add("warning", f"{table}_content_empty", f"{table} 본문이 비어 있습니다.", {"id": row_id})

    for table in ("ai_solutions", "senior_solutions"):
        seen: set[str] = set()
        for row in tables[table]:
            question_id = row.get("question_id")
            if question_id not in questions:
                findings.add("error", f"{table}_question_missing", f"{table} 행의 문항이 존재하지 않습니다.", {"id": row["id"], "question_id": question_id})
            if question_id in seen:
                findings.add("error", f"{table}_duplicate", f"같은 문항에 {table} 행이 둘 이상 있습니다.", {"question_id": question_id})
            seen.add(question_id)
            if not has_meaningful_content(row.get("content")):
                findings.add("warning", f"{table}_content_empty", f"{table} 본문이 비어 있습니다.", {"id": row["id"]})


def verify_r2(
    refs: list[StorageReference], findings: Findings, workers: int
) -> dict[str, Any]:
    backend = R2Backend()
    sources: dict[str, list[StorageReference]] = defaultdict(list)
    for ref in refs:
        sources[ref.path].append(ref)

    def check(path: str) -> tuple[str, str, str | None]:
        bucket, name = path.split("/", 1)
        try:
            result = backend.head(bucket, name)
            return path, "missing" if result is None else "ok", None
        except Exception as caught:  # 네트워크/인증 실패도 결과에 남기고 나머지는 계속한다.
            return path, "failed", str(caught)

    counts = Counter[str]()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        for path, status, error in executor.map(check, sorted(sources)):
            counts[status] += 1
            first_sources = [asdict(ref) for ref in sources[path][:3]]
            if status == "missing":
                only_exam_sources = all(
                    ref.table == "exams" and ref.field == "source_file_url"
                    for ref in sources[path]
                )
                findings.add(
                    "warning" if only_exam_sources else "error",
                    "exam_source_missing" if only_exam_sources else "storage_object_missing",
                    (
                        "시험 원본 PDF 경로가 DB에 있지만 R2 파일은 없습니다."
                        if only_exam_sources
                        else "DB에서 참조하는 파일이 R2에 없습니다."
                    ),
                    {"path": path, "sources": first_sources},
                )
            elif status == "failed":
                findings.add(
                    "error",
                    "storage_check_failed",
                    "R2 객체 존재 여부를 확인하지 못했습니다.",
                    {"path": path, "error": error, "sources": first_sources},
                )
    return {
        "references": len(refs),
        "unique_paths": len(sources),
        "checked": counts["ok"],
        "missing": counts["missing"],
        "failed": counts["failed"],
    }


def render_console(report: dict[str, Any], output_path: pathlib.Path) -> None:
    print("\n=== QBank 읽기 전용 무결성 검사 ===")
    print(f"프로젝트: {report['project_ref']}")
    print(f"조회 행: {sum(report['table_counts'].values()):,}개")
    print(
        "결과: "
        f"오류 {report['finding_counts']['error']:,} / "
        f"경고 {report['finding_counts']['warning']:,} / "
        f"참고 {report['finding_counts']['info']:,}"
    )
    storage = report["storage"]
    if storage.get("skipped"):
        print("R2 파일 검사: 생략")
    else:
        print(
            f"R2 파일 검사: 정상 {storage['checked']:,} / "
            f"누락 {storage['missing']:,} / 확인 실패 {storage['failed']:,}"
        )
    print(f"보고서: {output_path.resolve()}")
    for finding in report["findings"]:
        marker = {"error": "ERROR", "warning": "WARN", "info": "INFO"}[finding["severity"]]
        print(f"[{marker}] {finding['code']}: {finding['count']:,}건 - {finding['message']}")


def build_metrics(
    tables: dict[str, list[dict[str, Any]]], refs: list[StorageReference]
) -> dict[str, Any]:
    questions = tables["questions"]
    deletions = tables["content_deletion_audit"]
    answers_present = sum(
        1
        for row in questions
        if as_list(row.get("editor_answer")) or as_list(row.get("yama_answer"))
    )
    return {
        "question_status": dict(sorted(Counter(row.get("status") or "null" for row in questions).items())),
        "question_completeness": dict(
            sorted(Counter(row.get("completeness") or "null" for row in questions).items())
        ),
        "answers": {"present": answers_present, "missing": len(questions) - answers_present},
        "solutions": {
            "member": len(tables["solutions"]),
            "ai": len(tables["ai_solutions"]),
            "senior": len(tables["senior_solutions"]),
        },
        "storage_references_by_bucket": dict(
            sorted(Counter(ref.path.split("/", 1)[0] for ref in refs).items())
        ),
        "deletion_audit": {
            "total": len(deletions),
            "by_table": dict(sorted(Counter(row.get("table_name") or "unknown" for row in deletions).items())),
            "latest_deleted_at": max(
                (str(row.get("deleted_at")) for row in deletions if row.get("deleted_at")),
                default=None,
            ),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="QBank 운영 데이터 읽기 전용 무결성 검사")
    parser.add_argument("--skip-storage", action="store_true", help="R2 HEAD 검사를 생략")
    parser.add_argument("--workers", type=int, default=8, help="R2 HEAD 동시 요청 수(1~16)")
    parser.add_argument("--fail-on-warning", action="store_true", help="경고만 있어도 종료 코드 2")
    parser.add_argument("--output", help="결과 JSON 경로(기본 tmp/integrity-audits/<시각>.json)")
    args = parser.parse_args()
    if not 1 <= args.workers <= 16:
        parser.error("--workers는 1~16 사이여야 합니다.")

    base_url, key = load_supabase_credentials()
    project_ref = urlparse(base_url).hostname.split(".")[0] if urlparse(base_url).hostname else "unknown"
    client = ReadOnlySupabase(base_url, key)
    tables: dict[str, list[dict[str, Any]]] = {}
    for table, select in TABLE_SELECTS.items():
        print(f"조회 중: {table}", flush=True)
        tables[table] = client.get_rows(table, select)

    findings = Findings()
    run_relational_checks(tables, findings)
    refs = collect_storage_references(tables, findings)
    if args.skip_storage:
        storage_report: dict[str, Any] = {
            "skipped": True,
            "references": len(refs),
            "unique_paths": len({ref.path for ref in refs}),
        }
    else:
        storage_report = verify_r2(refs, findings, args.workers)

    generated = datetime.now(timezone.utc)
    output_path = pathlib.Path(
        args.output
        or f"tmp/integrity-audits/integrity-{generated.strftime('%Y%m%dT%H%M%SZ')}.json"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": generated.isoformat(),
        "mode": "read_only_get_and_head",
        "project_ref": project_ref,
        "table_counts": {table: len(rows) for table, rows in tables.items()},
        "metrics": build_metrics(tables, refs),
        "finding_counts": findings.counts(),
        "storage": storage_report,
        "findings": [asdict(row) for row in findings.rows()],
    }
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    render_console(report, output_path)

    if report["finding_counts"]["error"] > 0:
        return 2
    if args.fail_on_warning and report["finding_counts"]["warning"] > 0:
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n중단했습니다. DB와 스토리지는 변경되지 않았습니다.", file=sys.stderr)
        raise SystemExit(130)
