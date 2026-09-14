"""KMLE JSON과 운영 DB 반영 결과를 읽기 전용으로 정확히 대조한다.

이 스크립트는 DB나 스토리지를 수정하지 않는다. ``ingest_kmle.py --apply`` 뒤에
실행하여 문제 본문, 표, 이미지 경로, 선지, 정답, 해설, 출처 메타데이터와 이론
목차 연결이 입력 JSON에서 계산되는 값과 같은지 확인한다.

    python3 scripts/verify_kmle_ingest.py kmle_종양.json --subject 종양
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests

try:
    from .ingest_exam import Client
    from .ingest_kmle import (
        explanation_blocks,
        html_blocks,
        load_items,
        resolve_group,
        resolve_subject,
        sanitize_question,
        upload_inline_images,
    )
    from .supabase_credentials import load_supabase_credentials
except ImportError:  # ``python3 scripts/verify_kmle_ingest.py``로 실행할 때
    from ingest_exam import Client
    from ingest_kmle import (
        explanation_blocks,
        html_blocks,
        load_items,
        resolve_group,
        resolve_subject,
        sanitize_question,
        upload_inline_images,
    )
    from supabase_credentials import load_supabase_credentials


def chunks(values: list[str], size: int = 80) -> list[list[str]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def get_by_ids(client: Client, table: str, ids: list[str], select: str) -> list[dict]:
    rows: list[dict] = []
    for group in chunks(ids):
        rows.extend(client.get(table, {"id": f"in.({','.join(group)})", "select": select}))
    return rows


def get_links(client: Client, question_ids: list[str]) -> list[dict]:
    rows: list[dict] = []
    for group in chunks(question_ids):
        rows.extend(client.get(
            "theory_questions",
            {
                "question_id": f"in.({','.join(group)})",
                "select": "theory_document_id,question_id,sort_order,link_source",
            },
        ))
    return rows


def count_blocks(blocks: object, block_type: str) -> int:
    if not isinstance(blocks, list):
        return 0
    return sum(isinstance(block, dict) and block.get("type") == block_type for block in blocks)


def storage_object_exists(client: Client, logical_url: str) -> bool:
    if "/" not in logical_url:
        return False
    bucket, path = logical_url.split("/", 1)
    if client.storage.r2:
        return client.storage.r2.head(bucket, path) is not None
    encoded_path = urllib.parse.quote(path, safe="/")
    response = requests.head(
        f"{client.storage.supabase_url}/storage/v1/object/{bucket}/{encoded_path}",
        headers={
            "apikey": client.storage.supabase_secret_key,
            "Authorization": f"Bearer {client.storage.supabase_secret_key}",
        },
        timeout=30,
    )
    if response.status_code == 404:
        return False
    response.raise_for_status()
    return True


def normalized_timestamp(value: object) -> object:
    """Postgres의 ``+00:00``과 JSON의 ``Z`` 표기를 같은 시각으로 비교한다."""
    if not isinstance(value, str) or not value:
        return value
    match = re.fullmatch(
        r"(?P<head>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"
        r"(?:\.(?P<fraction>\d+))?(?P<zone>Z|[+-]\d{2}:\d{2})?",
        value,
    )
    if match:
        fraction = (match.group("fraction") or "").ljust(6, "0")[:6]
        zone = "+00:00" if match.group("zone") == "Z" else (match.group("zone") or "")
        value = f"{match.group('head')}.{fraction}{zone}"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(timezone.utc)


def main() -> None:
    parser = argparse.ArgumentParser(description="KMLE JSON 운영 반영 결과 검증(읽기 전용)")
    parser.add_argument("json_files", type=Path, nargs="+", help="반영에 사용한 KMLE JSON 파일")
    parser.add_argument("--subject", required=True, help="ingest_kmle.py에 사용한 과목/알렌 섹션명")
    parser.add_argument(
        "--json-only",
        action="store_true",
        help="운영 DB에 접속하지 않고 JSON 구조와 이미지/표 변환만 사전 검사",
    )
    parser.add_argument(
        "--skip-storage",
        action="store_true",
        help="DB 값만 대조하고 이미지 객체의 실제 저장소 존재 확인은 생략",
    )
    args = parser.parse_args()

    items: list[dict] = []
    export_failures: list[str] = []
    errors: list[str] = []
    for path in args.json_files:
        if not path.is_file():
            errors.append(f"파일 없음: {path}")
            continue
        raw_data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw_data, dict) and raw_data.get("schema") != "qbank-kmle-v1":
            errors.append(f"{path.name}: schema가 qbank-kmle-v1이 아님")
        file_items, file_failures = load_items(path)
        items.extend(file_items)
        export_failures.extend(f"{path.name}: {message}" for message in file_failures)

    if not items:
        errors.append("검증할 문제가 없습니다.")
    ids = [str(item.get("id") or "").strip() for item in items]
    duplicate_ids = sorted(value for value, count in Counter(ids).items() if value and count > 1)
    if duplicate_ids:
        errors.append(f"JSON 내 중복 id: {', '.join(duplicate_ids)}")

    for index, item in enumerate(items, 1):
        label = str(item.get("code") or item.get("id") or f"{index}번")
        choices = item.get("choices")
        answers = item.get("answers")
        if not str(item.get("id") or "").strip():
            errors.append(f"{label}: id 없음")
        if not str(item.get("chapter") or "").strip():
            errors.append(f"{label}: chapter 없음")
        if not sanitize_question(item.get("question")):
            errors.append(f"{label}: 문제 본문 없음")
        if not isinstance(choices, list) or len(choices) < 2:
            errors.append(f"{label}: 선지 2개 미만")
            choices = choices if isinstance(choices, list) else []
        if not isinstance(answers, list) or not answers:
            errors.append(f"{label}: 정답 없음")
            answers = answers if isinstance(answers, list) else []
        for answer in answers:
            answer_index = answer.get("index") if isinstance(answer, dict) else None
            if not isinstance(answer_index, int) or not 0 <= answer_index < len(choices):
                errors.append(f"{label}: 잘못된 정답 index {answer_index}")
            elif str(answer.get("text") or "") != str(choices[answer_index]):
                errors.append(f"{label}: 정답 text가 해당 선지와 다름")
        rates = item.get("choiceRates")
        if isinstance(rates, list) and rates and len(rates) != len(choices):
            errors.append(f"{label}: choiceRates와 choices 개수 불일치")

    if errors:
        print("JSON 사전 검사 실패:")
        for message in errors:
            print(f"  - {message}")
        raise SystemExit(2)

    preflight_images = 0
    preflight_tables = 0
    preflight_warnings: list[str] = []
    for item in items:
        label = str(item.get("code") or item["id"])
        stem = html_blocks(item.get("contentHtml"))
        explanation = explanation_blocks(item)
        conversion_warnings: list[str] = []
        stem = upload_inline_images(stem, None, f"preflight/{item['id']}/stem", False, conversion_warnings)
        explanation = upload_inline_images(
            explanation, None, f"preflight/{item['id']}/explanation", False, conversion_warnings
        )
        preflight_warnings.extend(f"{label}: {message}" for message in conversion_warnings)
        preflight_images += count_blocks(stem, "image") + count_blocks(explanation, "image")
        preflight_tables += count_blocks(stem, "table") + count_blocks(explanation, "table")
    if preflight_warnings:
        print("JSON 이미지 변환 검사 실패:")
        for message in preflight_warnings:
            print(f"  - {message}")
        raise SystemExit(2)
    if args.json_only:
        print(f"JSON 문항: {len(items)}개 · 고유 id: {len(set(ids))}개")
        print(f"대제목별: {dict(Counter(str(item['chapter']).strip() for item in items))}")
        print(f"변환 가능 이미지: {preflight_images}개 · 표: {preflight_tables}개")
        if export_failures:
            print(f"참고: imageFailures {len(export_failures)}개는 원격 이미지에서 복구 가능합니다.")
        print("\nJSON 사전 검사 통과")
        return

    base_url, key = load_supabase_credentials()
    client = Client(base_url, key)
    subject = resolve_subject(client, args.subject)
    chapters = sorted({str(item["chapter"]).strip() for item in items})
    groups = {chapter: resolve_group(client, subject["id"], chapter) for chapter in chapters}

    exams = client.get(
        "exams",
        {
            "subject_id": f"eq.{subject['id']}",
            "question_bank": "eq.kmle",
            "select": "id",
        },
    )
    if len(exams) != 1:
        raise SystemExit(f"운영 KMLE 문제은행이 {len(exams)}개입니다. 정확히 1개여야 합니다.")
    exam_id = exams[0]["id"]

    all_sources = client.get(
        "kmle_sources",
        {
            "select": (
                "allen_hash,question_id,allen_chapter,allen_code,choice_rates,"
                "source_url,collected_at"
            ),
        },
    )
    source_hash_counts = Counter(str(row["allen_hash"]) for row in all_sources)
    duplicated_db_hashes = [value for value in ids if source_hash_counts[value] > 1]
    errors.extend(f"DB에 kmle_sources 중복: {value}" for value in duplicated_db_hashes)
    source_by_hash = {str(row["allen_hash"]): row for row in all_sources}
    relevant_sources = [source_by_hash[value] for value in ids if value in source_by_hash]
    missing_sources = [value for value in ids if value not in source_by_hash]
    errors = [f"DB에 kmle_sources 없음: {value}" for value in missing_sources]

    question_ids = [str(row["question_id"]) for row in relevant_sources]
    questions = get_by_ids(
        client,
        "questions",
        question_ids,
        (
            "id,exam_id,stem_blocks,choices,editor_answer,official_explanation,"
            "source_tags,status,completeness"
        ),
    ) if question_ids else []
    question_by_id = {str(row["id"]): row for row in questions}
    links = get_links(client, question_ids) if question_ids else []
    links_by_question: dict[str, list[dict]] = {}
    for link in links:
        links_by_question.setdefault(str(link["question_id"]), []).append(link)

    expected_images = 0
    expected_tables = 0
    stored_images = 0
    stored_tables = 0
    placeholders = 0
    stored_image_urls: list[str] = []

    for item_index, item in enumerate(items):
        allen_hash = str(item["id"]).strip()
        label = str(item.get("code") or allen_hash)
        source = source_by_hash.get(allen_hash)
        if not source:
            continue
        question = question_by_id.get(str(source["question_id"]))
        if not question:
            errors.append(f"{label}: DB questions 행 없음")
            continue

        chapter = str(item["chapter"]).strip()
        group = groups[chapter]
        conversion_warnings: list[str] = []
        prefix = f"{subject['id']}/{allen_hash}"
        expected_stem = [{"type": "text", "content": sanitize_question(item.get("question"))}]
        expected_stem += html_blocks(item.get("contentHtml"))
        expected_stem = upload_inline_images(
            expected_stem, client, prefix + "/stem", False, conversion_warnings
        )
        expected_explanation = explanation_blocks(item)
        expected_explanation = upload_inline_images(
            expected_explanation, client, prefix + "/explanation", False, conversion_warnings
        )
        if conversion_warnings:
            errors.extend(f"{label}: {message}" for message in conversion_warnings)

        choices = [
            {"no": index + 1, "text": str(text), "image_url": None}
            for index, text in enumerate(item.get("choices", []))
        ]
        answers = sorted({
            int(answer["index"]) + 1
            for answer in item.get("answers", [])
            if isinstance(answer, dict) and "index" in answer
        })
        code = str(item.get("code") or "").strip() or None
        expected_source = {
            "allen_chapter": chapter,
            "allen_code": code,
            "choice_rates": item.get("choiceRates", []),
            "source_url": item.get("url"),
            "collected_at": item.get("collectedAt"),
        }
        expected_question = {
            "exam_id": exam_id,
            "stem_blocks": expected_stem,
            "choices": choices,
            "editor_answer": answers,
            "official_explanation": expected_explanation or None,
            "source_tags": [value for value in ["KMLE", chapter, code] if value],
            "status": "published",
            "completeness": "complete",
        }

        for field, expected in expected_source.items():
            actual = source.get(field)
            if field == "collected_at":
                actual = normalized_timestamp(actual)
                expected = normalized_timestamp(expected)
            if actual != expected:
                errors.append(f"{label}: kmle_sources.{field} 불일치")
        for field, expected in expected_question.items():
            if question.get(field) != expected:
                errors.append(f"{label}: questions.{field} 불일치")

        matching_links = [
            link for link in links_by_question.get(str(source["question_id"]), [])
            if link.get("theory_document_id") == group["id"]
        ]
        if not matching_links:
            errors.append(f"{label}: '{group['title']}' 목차 연결 없음")
        elif not any(link.get("link_source") == "import" for link in matching_links):
            errors.append(f"{label}: 목차 link_source가 import가 아님")

        expected_images += count_blocks(expected_stem, "image")
        expected_images += count_blocks(expected_explanation, "image")
        expected_tables += count_blocks(expected_stem, "table")
        expected_tables += count_blocks(expected_explanation, "table")
        stored_blocks = (question.get("stem_blocks") or []) + (question.get("official_explanation") or [])
        stored_images += count_blocks(stored_blocks, "image")
        stored_tables += count_blocks(stored_blocks, "table")
        stored_image_urls.extend(
            str(block.get("url") or "")
            for block in stored_blocks
            if isinstance(block, dict) and block.get("type") == "image"
        )
        placeholders += sum(
            isinstance(block, dict)
            and block.get("type") == "image"
            and block.get("url") == "PLACEHOLDER"
            for block in stored_blocks
        )

    verified_storage_objects = 0
    if not args.skip_storage:
        for logical_url in sorted(set(stored_image_urls) - {"PLACEHOLDER", ""}):
            try:
                exists = storage_object_exists(client, logical_url)
            except Exception as error:
                errors.append(f"저장소 확인 실패: {logical_url} ({error})")
                continue
            if not exists:
                errors.append(f"저장소 객체 없음: {logical_url}")
                continue
            verified_storage_objects += 1

    print(f"과목: {subject['name']} (입력명: {args.subject})")
    print(f"JSON 문항: {len(items)}개 · 고유 id: {len(set(ids))}개")
    print(f"대제목별: {dict(Counter(str(item['chapter']).strip() for item in items))}")
    print(f"DB 원본 연결: {len(relevant_sources)}/{len(items)}개")
    print(f"DB 문제 대조: {len(question_by_id)}/{len(items)}개")
    print(f"이미지: JSON 변환 {expected_images}개 · DB {stored_images}개 · PLACEHOLDER {placeholders}개")
    if not args.skip_storage:
        print(f"저장소 객체: {verified_storage_objects}/{len(set(stored_image_urls) - {'PLACEHOLDER', ''})}개 존재")
    print(f"표: JSON 변환 {expected_tables}개 · DB {stored_tables}개")
    if export_failures:
        print(f"참고: JSON imageFailures {len(export_failures)}개(원격 복구 결과는 위 대조에 포함)")

    if errors:
        print("\n검증 실패:")
        for message in errors:
            print(f"  - {message}")
        raise SystemExit(2)
    print("\n검증 통과: JSON과 운영 DB 및 목차 연결이 모두 일치합니다.")


if __name__ == "__main__":
    main()
