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
- exam_name 이 없으면 기존처럼 '학년말고사'로 처리한다. 같은 학번·과목에
  여러 차수가 있으면 exam_name을 반드시 넣어야 올바른 시험에 매칭된다.
- R형(공통 보기 세트) 문항의 question_set/set_id 연결은 다루지 않는다.
  전사 JSON에 그 구조가 아직 없다.

사용법:
    python3 ingest_exam.py exam.json \\
        [--units unit_suggestions.json] \\
        [--lectures lecture_sources.json] \\
        [--images ./images_dir] \\
        [--image-map image_map.json] \\
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

from object_storage import ObjectStorage
from supabase_credentials import load_supabase_credentials

try:
    import requests
except ImportError:
    sys.exit("requests 가 필요하다. pip install -r requirements.txt")

IMAGE_NAME_RE = re.compile(r"_q(\d+|UNKNOWN)_p(\d+)_(\d+)\.")
UNIT_ID_CACHE: dict[tuple[str, str], str | None] = {}


def load_env() -> tuple[str, str]:
    return load_supabase_credentials()


class Client:
    """PostgREST + Storage 얇은 래퍼. service_role 키를 쓰므로 RLS/컬럼 권한을
    다 우회한다 — 사람이 터미널에서 직접 돌리는 용도로만 쓴다."""

    def __init__(self, base_url: str, key: str):
        self.base_url = base_url
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        self.storage = ObjectStorage(base_url, key)

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

    def delete(self, path: str, params: dict) -> None:
        headers = {**self.headers, "Prefer": "return=minimal"}
        r = requests.delete(f"{self.base_url}/rest/v1/{path}", headers=headers, params=params, timeout=60)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"DELETE {path} 실패 {r.status_code}: {r.text[:300]}")

    def upload_storage(self, bucket: str, path: str, data: bytes, content_type: str) -> bool:
        return self.storage.upload(bucket, path, data, content_type)


def resolve_subject(client: Client, name: str) -> dict:
    rows = client.get("subjects", {"name": f"eq.{name}", "select": "id,name,code"})
    if not rows:
        all_subjects = client.get("subjects", {"select": "name"})
        names = ", ".join(s["name"] for s in all_subjects)
        sys.exit(f"과목 '{name}' 을 찾을 수 없다. 새 과목은 미리 만들어둬야 한다. 등록된 과목: {names}")
    return rows[0]


def resolve_or_create_unit(client: Client, subject_id: str, name: str, apply: bool, created: list[str]) -> str | None:
    cache_key = (subject_id, name)
    if cache_key in UNIT_ID_CACHE:
        return UNIT_ID_CACHE[cache_key]
    rows = client.get("units", {"subject_id": f"eq.{subject_id}", "name": f"eq.{name}", "select": "id"})
    if rows:
        UNIT_ID_CACHE[cache_key] = rows[0]["id"]
        return UNIT_ID_CACHE[cache_key]
    created.append(name)
    if not apply:
        UNIT_ID_CACHE[cache_key] = None
        return None
    row = client.post("units", [{"subject_id": subject_id, "name": name}])
    UNIT_ID_CACHE[cache_key] = row[0]["id"]
    return UNIT_ID_CACHE[cache_key]


def resolve_exam(client: Client, subject_id: str, exam_meta: dict) -> dict | None:
    """시험을 재실행용으로 찾되, 같은 과목의 동명 차수를 혼동하지 않는다.

    계통Y처럼 같은 학번·과목에 여러 분야의 "1차"가 공존할 수 있다. 이때
    exam_code가 있으면 그것을 최우선 식별자로 쓰고, 없으면 기존 동작처럼
    학번·과목·시험명 조합으로 찾는다.
    """
    params = {
        "subject_id": f"eq.{subject_id}",
        "cohort": f"eq.{exam_meta['cohort']}",
        "select": "id,exam_name,exam_code,curriculum,exam_subject_label,restored_questions",
    }
    if exam_meta.get("exam_code"):
        params["exam_code"] = f"eq.{exam_meta['exam_code']}"
    else:
        params["exam_name"] = f"eq.{exam_meta.get('exam_name', '학년말고사')}"
    rows = client.get("exams", params)
    if len(rows) > 1:
        sys.exit("같은 시험 식별자로 여러 시험이 발견됨. exam_code를 지정해 정리해야 한다.")
    return rows[0] if rows else None


def create_exam(client: Client, subject_id: str, exam_meta: dict) -> dict:
    body: dict = {"subject_id": subject_id, "cohort": exam_meta["cohort"]}
    for key in (
        "exam_name",
        "exam_date",
        "duration_min",
        "format",
        "total_questions",
        "restored_questions",
        "overview",
        "curriculum",
        "exam_code",
        "exam_subject_label",
        "required_permission",
        "source_page_start",
        "source_page_end",
    ):
        if exam_meta.get(key) is not None:
            body[key] = exam_meta[key]
    return client.post("exams", [body])[0]


def load_images(images_dir: str, image_map_path: str = "") -> dict[int, list[tuple[int, str]]]:
    """폴더 안의 <접두어>_q<번호>_p<페이지>_<순번>.png 를 문항번호별로,
    순번 순서대로 묶는다. q<번호> 가 UNKNOWN 인 파일(매핑 실패)은 여기서
    다루지 않는다 — 사람이 먼저 원본 PDF와 대조해 어느 문항인지 정해야 한다.

    원본 PDF에서 직접 추출한 이미지처럼 파일명에 문항 번호가 없는 경우에는
    --image-map의 {"문항번호": ["파일명", ...]}를 사용한다. 이 경로는 원문과
    대조를 마친 이미지에만 쓰며, 추측 매핑을 자동으로 만들지 않는다.
    """
    by_question: dict[int, list[tuple[int, str]]] = defaultdict(list)
    if not images_dir or not os.path.isdir(images_dir):
        return by_question
    if image_map_path:
        with open(image_map_path, encoding="utf-8") as fh:
            mapped = json.load(fh)
        for raw_number, names in mapped.items():
            number = int(raw_number)
            if not isinstance(names, list) or not all(isinstance(name, str) for name in names):
                raise ValueError(f"image map 문항 {raw_number} 값은 파일명 배열이어야 한다")
            for order, name in enumerate(names):
                if not os.path.isfile(os.path.join(images_dir, name)):
                    raise FileNotFoundError(f"image map 문항 {number}: 이미지 파일 없음 ({name})")
                by_question[number].append((order, name))
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


def resolve_or_create_lecture_sources(
    client: Client,
    subject_id: str,
    curriculum: str | None,
    rows: list[dict],
    apply: bool,
) -> dict[str, str]:
    """복기 원문에 적힌 강의 제목/교수를 한 번 저장해 source_key로 찾는다.

    강의록 파일은 후속 업로드 때 theory_document_id만 갱신하면 되므로 이 단계에서
    연결하지 않는다. 같은 key를 다시 넣으면 원문 표기를 최신 상태로 갱신한다.
    """
    by_key: dict[str, str] = {}
    for row in rows:
        key = row.get("source_key")
        title = row.get("title")
        if not key or not title:
            raise ValueError("lecture source에는 source_key와 title이 필요하다")
        current = client.get(
            "lecture_sources",
            {
                "subject_id": f"eq.{subject_id}",
                "curriculum": f"eq.{curriculum or ''}",
                "source_key": f"eq.{key}",
                "select": "id",
            },
        )
        payload = {
            "subject_id": subject_id,
            "curriculum": curriculum,
            "source_key": key,
            "title": title,
            "professor": row.get("professor"),
            "sort_order": row.get("sort_order", 0),
        }
        if current:
            lecture_id = current[0]["id"]
            if apply:
                client.patch("lecture_sources", {"id": f"eq.{lecture_id}"}, payload)
        elif apply:
            lecture_id = client.post("lecture_sources", [payload])[0]["id"]
        else:
            lecture_id = f"DRY-RUN:{key}"
        by_key[key] = lecture_id
    return by_key


def replace_question_lecture_sources(
    client: Client,
    question_id: str | None,
    source_keys: list[str],
    lecture_ids: dict[str, str],
    apply: bool,
) -> None:
    """문항에 명시된 강의 연결만 원자적으로 교체한다.

    JSON에 lecture_source_keys가 없는 기존 전사본은 건드리지 않는다. 명시된
    연결은 원문 분류이므로 재실행 때도 오래된 연결이 남지 않게 교체한다.
    """
    unknown = [key for key in source_keys if key not in lecture_ids]
    if unknown:
        raise ValueError(f"등록되지 않은 lecture_source_keys: {unknown}")
    if not apply or not question_id:
        return
    client.delete("question_lecture_sources", {"question_id": f"eq.{question_id}"})
    if source_keys:
        client.post(
            "question_lecture_sources",
            [
                {"question_id": question_id, "lecture_source_id": lecture_ids[key], "sort_order": index}
                for index, key in enumerate(source_keys)
            ],
            prefer="return=minimal",
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="전사 JSON을 DB에 반영한다 (기본 dry-run)")
    parser.add_argument("exam_json")
    parser.add_argument("--units", default="", help="unit_suggestions_*.json 경로")
    parser.add_argument("--lectures", default="", help="강의 제목·교수명 JSON 경로")
    parser.add_argument("--images", default="", help="map_images_to_questions.py 결과 이미지 폴더")
    parser.add_argument("--image-map", default="", help="원본 PDF 추출 이미지의 수동 대조 매핑 JSON 경로")
    parser.add_argument("--pdf", default="", help="원본 PDF 경로 (exam-sources 버킷에 업로드)")
    parser.add_argument("--apply", action="store_true", help="실제로 DB에 반영한다. 기본은 리포트만 하는 dry-run")
    args = parser.parse_args()

    base_url, key = load_env()
    client = Client(base_url, key)

    with open(args.exam_json, encoding="utf-8") as fh:
        data = json.load(fh)
    exam_meta = data.get("exam", {})
    questions = data["questions"]

    lecture_rows: list[dict] = []
    if args.lectures:
        with open(args.lectures, encoding="utf-8") as fh:
            lecture_data = json.load(fh)
        lecture_rows = lecture_data.get("lectures", [])

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
    exam_name = exam_meta.get("exam_name", "학년말고사")

    exam = resolve_exam(client, subject_id, exam_meta)

    print(f"=== {cohort} {subject_name} {exam_name} ===")
    if exam:
        print(f"기존 시험에 반영 (exam_id={exam['id']})")
    elif args.apply:
        exam = create_exam(client, subject_id, exam_meta)
        print(f"새 시험 생성 (exam_id={exam['id']})")
    else:
        print("새 시험. dry-run 이라 아직 만들지 않음")
        exam = {"id": None}

    exam_id = exam["id"]

    lecture_ids = resolve_or_create_lecture_sources(
        client,
        subject_id,
        exam_meta.get("curriculum"),
        lecture_rows,
        args.apply,
    )
    if lecture_rows:
        print(f"출제 강의: {len(lecture_rows)}개 {'등록' if args.apply else '등록 예정'}")

    # 1. 문항 수 사전 확인 --------------------------------------------------
    existing = []
    if exam_id:
        existing = client.get(
            "questions",
            {
                "exam_id": f"eq.{exam_id}",
                "select": "id,question_number,unit_id,unit_source,editor_answer,answer_status,stem_blocks",
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

    # Storage 오브젝트 경로는 한글/공백을 피한다. 일부 Storage 엔드포인트가
    # URL 인코딩된 한글 경로를 정상 처리하지 않아 원본 PDF 연결이 실패한다.
    cohort_code = re.sub(r"[^A-Za-z0-9]+", "", cohort) or "cohort"
    subject_code = re.sub(r"[^A-Za-z0-9]+", "", subject.get("code", "")) or "subject"
    exam_code = re.sub(r"[^A-Za-z0-9]+", "", exam_meta.get("exam_code", ""))
    storage_prefix = "_".join(part for part in (cohort_code, subject_code, exam_code) if part)
    image_files_by_q = load_images(args.images, args.image_map)

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
        # 재실행 중에는 이미 성공적으로 저장된 원본 도판을 다시 전송하지 않는다.
        # 기존 URL 수가 이번 매핑과 정확히 같을 때만 재사용하므로, 매핑 변경이나
        # 불완전 입력은 평소처럼 다시 업로드해 드러난다.
        if existing_row and image_files:
            existing_urls = [
                block.get("url") for block in (existing_row.get("stem_blocks") or [])
                if block.get("type") == "image" and block.get("url") not in (None, "", "PLACEHOLDER")
            ]
            placeholders = sum(
                1 for block in stem_blocks
                if block.get("type") == "image" and block.get("url") == "PLACEHOLDER"
            )
            if len(existing_urls) == len(image_files) == placeholders:
                url_iter = iter(existing_urls)
                stem_blocks = [
                    {**block, "url": next(url_iter)}
                    if block.get("type") == "image" and block.get("url") == "PLACEHOLDER"
                    else block
                    for block in stem_blocks
                ]
                image_files = []
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
            question_id = existing_row["id"]
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
                question_id = client.post("questions", [body])[0]["id"]
            else:
                question_id = None

        if "lecture_source_keys" in q:
            replace_question_lecture_sources(
                client,
                question_id,
                q["lecture_source_keys"],
                lecture_ids,
                args.apply,
            )

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
