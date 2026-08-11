"""전사 JSON(+ 선택: 단원 제안 JSON, 이미지 폴더, 원본 PDF)을 DB에 반영한다.

convert_file/DATA_INGESTION_HANDOFF.md 10절 절차를 그대로 구현했다.
upload_to_supabase.py 와 달리 최신 스키마(stem_blocks/choices 구조,
unit/unit_suggestions 분리, unit_source 추적)를 기준으로 한다.

기본은 dry-run 이다. 무엇이 바뀔지 전부 화면에 보여주기만 하고 DB에는
아무것도 쓰지 않는다. 확인 후 --apply 를 붙여 실제로 반영한다.

재실행 안전성 (같은 시험 JSON을 오탈자 수정 후 다시 넣는 상황을 가정):
- editor_answer 가 비어있지 않거나 answer_status 가 unconfirmed 가 아니면,
  즉 편집자가 이미 검토했으면 그 문항의 editor_answer/answer_status 는
  절대 건드리지 않는다.
- unit_id 의 unit_source 가 human_confirmed 면 그 문항의 단원도 건드리지
  않는다. ai_suggested 이거나 비어있으면 새 값으로 갱신한다.
- 그 외 원문 전사 필드(stem_blocks, choices, answer_count, yama_answer)는
  항상 JSON 값으로 덮어쓴다 — 이게 이 스크립트를 다시 돌리는 이유이기
  때문이다.

한계 (알고 있는 것):
- exam_name 이 전사 JSON 스키마에 없어서, 같은 학번+과목 조합의 시험이
  이미 하나 있다고 가정하고 그 시험에 매칭한다. 같은 과목에 이름이 다른
  시험(중간고사 등)을 추가로 넣어야 하면 이 스크립트를 확장해야 한다.
- R형(공통 보기 세트) 문항의 question_set/set_id 연결은 다루지 않는다.
  전사 JSON에 그 구조가 아직 없다.

사용법:
    python3 ingest_exam.py exam.json \\
        [--units unit_suggestions.json] \\
        [--images ./images_dir] \\
        [--pdf original.pdf] \\
        [--apply]
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import sys
from collections import defaultdict

try:
    import requests
except ImportError:
    sys.exit("requests 가 필요하다. pip install -r requirements.txt")

IMAGE_NAME_RE = re.compile(r"_q(\d+|UNKNOWN)_p(\d+)_(\d+)\.")


def load_env() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not (url and key) and os.path.exists(".env"):
        with open(".env", encoding="utf-8") as fh:
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
    """PostgREST + Storage 얇은 래퍼. service_role 키를 쓰므로 RLS/컬럼 권한을
    다 우회한다 — 사람이 터미널에서 직접 돌리는 용도로만 쓴다."""

    def __init__(self, base_url: str, key: str):
        self.base_url = base_url
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def get(self, path: str, params: dict) -> list[dict]:
        r = requests.get(f"{self.base_url}/rest/v1/{path}", headers=self.headers, params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def post(self, path: str, rows: list[dict], prefer: str = "return=representation") -> list[dict] | None:
        headers = {**self.headers, "Prefer": prefer}
        r = requests.post(f"{self.base_url}/rest/v1/{path}", headers=headers, json=rows, timeout=60)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"POST {path} 실패 {r.status_code}: {r.text[:300]}")
        return r.json() if r.text else None

    def patch(self, path: str, params: dict, body: dict) -> None:
        headers = {**self.headers, "Prefer": "return=minimal"}
        r = requests.patch(f"{self.base_url}/rest/v1/{path}", headers=headers, params=params, json=body, timeout=60)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"PATCH {path} 실패 {r.status_code}: {r.text[:300]}")

    def upload_storage(self, bucket: str, path: str, data: bytes, content_type: str) -> bool:
        r = requests.post(
            f"{self.base_url}/storage/v1/object/{bucket}/{path}",
            data=data,
            headers={**self.headers, "Content-Type": content_type, "x-upsert": "true"},
            timeout=120,
        )
        return r.status_code == 200


def resolve_subject(client: Client, name: str) -> dict:
    rows = client.get("subjects", {"name": f"eq.{name}", "select": "id,name,code"})
    if not rows:
        all_subjects = client.get("subjects", {"select": "name"})
        names = ", ".join(s["name"] for s in all_subjects)
        sys.exit(f"과목 '{name}' 을 찾을 수 없다. 새 과목은 미리 만들어둬야 한다. 등록된 과목: {names}")
    return rows[0]


def resolve_or_create_unit(client: Client, subject_id: str, name: str, apply: bool, created: list[str]) -> str | None:
    rows = client.get("units", {"subject_id": f"eq.{subject_id}", "name": f"eq.{name}", "select": "id"})
    if rows:
        return rows[0]["id"]
    created.append(name)
    if not apply:
        return None
    row = client.post("units", [{"subject_id": subject_id, "name": name}])
    return row[0]["id"]


def resolve_exam(client: Client, subject_id: str, cohort: str) -> dict | None:
    rows = client.get(
        "exams",
        {"subject_id": f"eq.{subject_id}", "cohort": f"eq.{cohort}", "select": "id,exam_name,restored_questions"},
    )
    return rows[0] if rows else None


def create_exam(client: Client, subject_id: str, exam_meta: dict) -> dict:
    body: dict = {"subject_id": subject_id, "cohort": exam_meta["cohort"]}
    for key in ("exam_date", "duration_min", "format", "total_questions", "restored_questions", "overview"):
        if exam_meta.get(key) is not None:
            body[key] = exam_meta[key]
    return client.post("exams", [body])[0]


def load_images(images_dir: str) -> dict[int, list[tuple[int, str]]]:
    """폴더 안의 <접두어>_q<번호>_p<페이지>_<순번>.png 를 문항번호별로,
    순번 순서대로 묶는다. q<번호> 가 UNKNOWN 인 파일(매핑 실패)은 여기서
    다루지 않는다 — 사람이 먼저 원본 PDF와 대조해 어느 문항인지 정해야 한다."""
    by_question: dict[int, list[tuple[int, str]]] = defaultdict(list)
    if not images_dir or not os.path.isdir(images_dir):
        return by_question
    for name in sorted(os.listdir(images_dir)):
        if not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        m = IMAGE_NAME_RE.search(name)
        if not m or m.group(1) == "UNKNOWN":
            continue
        by_question[int(m.group(1))].append((int(m.group(3)), name))
    for q in by_question:
        by_question[q].sort()
    return by_question


def substitute_placeholders(
    stem_blocks: list[dict],
    files: list[tuple[int, str]],
    images_dir: str,
    client: Client,
    storage_prefix: str,
    apply: bool,
    upload_log: list[str],
) -> tuple[list[dict], list[tuple[int, str]]]:
    """PLACEHOLDER 인 image 블록을 순서대로 실제 업로드 경로로 바꾼다.
    본문에 PLACEHOLDER 자리가 이미지 파일 수보다 적으면 남는 파일을
    반환한다(사람이 확인해야 할 불일치)."""
    file_iter = iter(files)
    result = []
    for block in stem_blocks:
        if block.get("type") != "image" or block.get("url") != "PLACEHOLDER":
            result.append(block)
            continue
        nxt = next(file_iter, None)
        if nxt is None:
            result.append(block)
            continue
        _, fname = nxt
        storage_path = f"{storage_prefix}/{fname}"
        if apply:
            with open(os.path.join(images_dir, fname), "rb") as fh:
                content_type = mimetypes.guess_type(fname)[0] or "image/png"
                if not client.upload_storage("question-images", storage_path, fh.read(), content_type):
                    upload_log.append(f"업로드 실패: {fname}")
        result.append({**block, "url": f"question-images/{storage_path}"})
    return result, list(file_iter)


def main() -> None:
    parser = argparse.ArgumentParser(description="전사 JSON을 DB에 반영한다 (기본 dry-run)")
    parser.add_argument("exam_json")
    parser.add_argument("--units", default="", help="unit_suggestions_*.json 경로")
    parser.add_argument("--images", default="", help="map_images_to_questions.py 결과 이미지 폴더")
    parser.add_argument("--pdf", default="", help="원본 PDF 경로 (exam-sources 버킷에 업로드)")
    parser.add_argument("--apply", action="store_true", help="실제로 DB에 반영한다. 기본은 리포트만 하는 dry-run")
    args = parser.parse_args()

    base_url, key = load_env()
    client = Client(base_url, key)

    with open(args.exam_json, encoding="utf-8") as fh:
        data = json.load(fh)
    exam_meta = data.get("exam", {})
    questions = data["questions"]

    unit_suggestions: dict[int, str] = {}
    if args.units:
        with open(args.units, encoding="utf-8") as fh:
            for row in json.load(fh):
                unit_suggestions[row["question_number"]] = row["suggested_unit"]

    subject_name = exam_meta.get("subject")
    cohort = exam_meta.get("cohort")
    if not subject_name or not cohort:
        sys.exit("exam.subject 와 exam.cohort 가 필요하다 (이미 등록된 시험에 붙이는 방식은 아직 없음)")

    subject = resolve_subject(client, subject_name)
    subject_id = subject["id"]

    exam = resolve_exam(client, subject_id, cohort)

    print(f"=== {cohort} {subject_name} ===")
    if exam:
        print(f"기존 시험에 반영 (exam_id={exam['id']})")
    elif args.apply:
        exam = create_exam(client, subject_id, exam_meta)
        print(f"새 시험 생성 (exam_id={exam['id']})")
    else:
        print("새 시험. dry-run 이라 아직 만들지 않음")
        exam = {"id": None}

    exam_id = exam["id"]

    # 1. 문항 수 사전 확인 --------------------------------------------------
    existing = []
    if exam_id:
        existing = client.get(
            "questions",
            {
                "exam_id": f"eq.{exam_id}",
                "select": "id,question_number,unit_id,unit_source,editor_answer,answer_status",
            },
        )
    existing_by_number = {row["question_number"]: row for row in existing}
    json_numbers = {q["question_number"] for q in questions}
    existing_numbers = set(existing_by_number)

    missing_in_json = sorted(existing_numbers - json_numbers)
    new_in_json = sorted(json_numbers - existing_numbers)
    print(f"DB 기존 문항 {len(existing_numbers)}개, JSON 문항 {len(json_numbers)}개")
    if missing_in_json:
        print(f"  ⚠ DB에는 있는데 이 JSON에는 없는 번호 (그대로 둠): {missing_in_json}")
    if new_in_json:
        print(f"  새로 생성될 번호: {new_in_json}")

    # 2. 문항별 반영 ---------------------------------------------------------
    updated: list[int] = []
    inserted: list[int] = []
    unit_created: list[str] = []
    unit_matched: list[tuple[int, str]] = []
    skipped_reviewed: list[int] = []
    upload_log: list[str] = []

    storage_prefix = re.sub(r"\s+", "_", f"{cohort}_{subject_name}")
    image_files_by_q = load_images(args.images)

    for q in sorted(questions, key=lambda x: x["question_number"]):
        number = q["question_number"]
        existing_row = existing_by_number.get(number)

        # 단원 해석: 원본에 인쇄된 unit 필드가 최우선. 없으면 AI 단원 제안.
        # 그마저 없으면 미분류로 남긴다.
        unit_id = None
        unit_source = None
        printed_unit = q.get("unit")
        if printed_unit:
            unit_id = resolve_or_create_unit(client, subject_id, printed_unit, args.apply, unit_created)
            unit_source = None  # 원본 인쇄물 그대로라 "검토 필요" 대상이 아니다
        elif number in unit_suggestions:
            suggested = unit_suggestions[number]
            rows = client.get("units", {"subject_id": f"eq.{subject_id}", "name": f"eq.{suggested}", "select": "id"})
            if rows:
                unit_id = rows[0]["id"]
                unit_source = "ai_suggested"
                unit_matched.append((number, suggested))
            else:
                print(f"  문항 {number}: 단원 제안 '{suggested}' 이 확정된 단원 목록에 없어 건너뜀")

        stem_blocks = q.get("stem_blocks", [])
        image_files = image_files_by_q.pop(number, [])
        if image_files:
            stem_blocks, remainder = substitute_placeholders(
                stem_blocks, image_files, args.images, client, storage_prefix, args.apply, upload_log
            )
            if remainder:
                print(f"  문항 {number}: 이미지 {len(remainder)}장 남음 (본문에 PLACEHOLDER 자리가 더 없음)")

        body: dict = {
            "stem_blocks": stem_blocks,
            "choices": q.get("choices", []),
            "answer_count": q.get("answer_count", 1),
            "yama_answer": q.get("yama_answer"),
            "source_tags": q.get("source_tags", []),
        }
        if q.get("model_answer") is not None:
            body["question_type"] = "essay"
            body["model_answer"] = q["model_answer"]
            body["grading_points"] = q.get("grading_points", [])

        if existing_row:
            reviewed = existing_row["answer_status"] != "unconfirmed" or bool(existing_row.get("editor_answer"))
            if reviewed:
                skipped_reviewed.append(number)
            else:
                body["answer_status"] = "unconfirmed"
                body["editor_answer"] = []
            if unit_id is not None and existing_row.get("unit_source") != "human_confirmed":
                body["unit_id"] = unit_id
                body["unit_source"] = unit_source
            updated.append(number)
            if args.apply:
                client.patch("questions", {"id": f"eq.{existing_row['id']}"}, body)
        else:
            body.update(
                {
                    "exam_id": exam_id,
                    "question_number": number,
                    "question_type": body.get("question_type", "A" if body["choices"] else "essay"),
                    "editor_answer": [],
                    "answer_status": "unconfirmed",
                    "status": "draft",
                    "unit_id": unit_id,
                    "unit_source": unit_source,
                    "variant_type": q.get("variant_type", "original"),
                    "restorer_note": q.get("restorer_note"),
                }
            )
            inserted.append(number)
            if args.apply and exam_id:
                client.post("questions", [body])

    unmatched_images = [f for files in image_files_by_q.values() for _, f in files]

    # 3. 원본 PDF 업로드 ------------------------------------------------------
    if args.pdf:
        if args.apply and exam_id:
            with open(args.pdf, "rb") as fh:
                pdf_path = f"{storage_prefix}.pdf"
                ok = client.upload_storage("exam-sources", pdf_path, fh.read(), "application/pdf")
            if ok:
                client.patch("exams", {"id": f"eq.{exam_id}"}, {"source_file_url": f"exam-sources/{pdf_path}"})
                print(f"원본 PDF 업로드 완료: {pdf_path}")
            else:
                print("원본 PDF 업로드 실패")
        else:
            print(f"원본 PDF 업로드 예정 (dry-run): {args.pdf}")

    # 4. 요약 ------------------------------------------------------------
    print()
    print("=== 요약 ===")
    print(f"업데이트된 문항: {len(updated)}개 (이 중 이미 검토돼 답/단원 보존한 문항 {len(skipped_reviewed)}개)")
    print(f"새로 생성된 문항: {len(inserted)}개")
    print(f"매칭 실패(DB에만 있고 JSON에 없는) 번호: {missing_in_json or '없음'}")
    if unit_created:
        print(f"새로 만들어진 단원: {sorted(set(unit_created))}")
    if unit_matched:
        print(f"AI 제안으로 배정된 단원: {len(unit_matched)}건")
    if unmatched_images:
        print(f"어느 문항에도 못 붙인 이미지 파일: {unmatched_images}")
    if upload_log:
        print("이미지 업로드 문제:")
        for line in upload_log:
            print(f"  {line}")

    if not args.apply:
        print()
        print("dry-run 입니다. 위 내용이 맞으면 --apply 를 붙여 다시 실행하세요.")


if __name__ == "__main__":
    main()
