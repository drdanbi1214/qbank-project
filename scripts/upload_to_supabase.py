"""파싱 결과를 Supabase 에 올린다.

이미지를 question-images 버킷에 올린 뒤, 그 경로를 stem_blocks 의 image 블록에
넣어 문항을 만든다. 이미 같은 (exam_id, question_number) 가 있으면 덮어쓴다.

올라간 문항은 status=draft 로 들어간다. 학생 화면에 바로 뜨면 검수 전 자료가
노출되므로, 검수 화면에서 확인한 뒤 공개로 바꾸는 흐름을 강제한다.

service_role 키를 쓴다. RLS 를 우회하므로 이 스크립트는 사람이 직접 돌리는
용도로만 두고, 키를 브라우저나 저장소에 넣지 않는다.

사용법:
    python upload_to_supabase.py out/questions.json --exam-id <uuid> \
        --images out/images [--answers out/answers.json] [--publish]
"""

# 파이썬 3.9 에서도 X | None 표기를 쓰기 위해 (실행 시 평가하지 않는다)
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import sys
import uuid

from supabase_credentials import load_supabase_credentials

try:
    import requests
except ImportError:
    sys.exit("requests 가 필요하다. pip install -r requirements.txt")

IMAGE_NAME = re.compile(r"_q(\d+)_p(\d+)_")


def load_env() -> tuple[str, str]:
    return load_supabase_credentials()


def upload_images(base_url: str, key: str, folder: str, prefix: str) -> dict[int, list[str]]:
    """문항 번호 -> 저장 경로 목록"""
    mapping: dict[int, list[str]] = {}
    if not folder or not os.path.isdir(folder):
        return mapping

    for name in sorted(os.listdir(folder)):
        if not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        found = IMAGE_NAME.search(name)
        if not found:
            print(f"  이름 규칙에 맞지 않아 건너뜀: {name}")
            continue

        number = int(found.group(1))
        path = f"{prefix}/{name}"
        content_type = mimetypes.guess_type(name)[0] or "image/png"

        with open(os.path.join(folder, name), "rb") as fh:
            response = requests.post(
                f"{base_url}/storage/v1/object/question-images/{path}",
                data=fh.read(),
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
                timeout=60,
            )
        if response.status_code == 200:
            mapping.setdefault(number, []).append(f"question-images/{path}")
        else:
            print(f"  이미지 업로드 실패 {name}: {response.status_code} {response.text[:120]}")

    return mapping


def build_rows(
    questions: list[dict],
    exam_id: str,
    images: dict[int, list[str]],
    answers: dict[str, list[int]],
    publish: bool,
) -> list[dict]:
    rows = []
    for question in questions:
        number = question["question_number"]

        blocks: list[dict] = []
        if question.get("stem"):
            blocks.append({"type": "text", "content": question["stem"]})
        for path in images.get(number, []):
            blocks.append({"type": "image", "url": path, "caption": None})

        choices = [
            {"no": index + 1, "text": text, "image_url": None}
            for index, text in enumerate(question.get("choices", []))
        ]

        yama = answers.get(str(number)) or question.get("yama_answer") or []
        completeness = question.get("completeness", "complete")
        if completeness == "image_missing" and images.get(number):
            completeness = "complete"

        rows.append(
            {
                "exam_id": exam_id,
                "question_number": number,
                "question_type": "A" if choices else "essay",
                "stem_blocks": blocks,
                "choices": choices,
                "answer_count": max(1, len(yama)),
                "yama_answer": yama or None,
                "editor_answer": [],
                "answer_status": "unconfirmed",
                "completeness": completeness,
                "status": "published" if publish else "draft",
                "source_tags": question.get("source_tags", []),
                "variant_type": question.get("variant_type", "original"),
                "restorer_note": question.get("restorer_note"),
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="파싱 결과를 Supabase 에 업로드")
    parser.add_argument("questions_json")
    parser.add_argument("--exam-id", required=True)
    parser.add_argument("--images", default="")
    parser.add_argument("--answers", default="")
    parser.add_argument(
        "--publish",
        action="store_true",
        help="검수 없이 바로 공개한다. 기본은 검수 중(draft) 이다.",
    )
    args = parser.parse_args()

    base_url, key = load_env()

    with open(args.questions_json, encoding="utf-8") as fh:
        questions = json.load(fh)["questions"]

    answers: dict[str, list[int]] = {}
    if args.answers:
        with open(args.answers, encoding="utf-8") as fh:
            answers = json.load(fh)

    prefix = f"upload/{uuid.uuid4().hex[:8]}"
    print("이미지 업로드")
    images = upload_images(base_url, key, args.images, prefix)
    print(f"  {sum(len(v) for v in images.values())}장을 {len(images)}문항에 연결했다")

    rows = build_rows(questions, args.exam_id, images, answers, args.publish)

    print("문항 업로드")
    response = requests.post(
        f"{base_url}/rest/v1/questions?on_conflict=exam_id,question_number",
        json=rows,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal,resolution=merge-duplicates",
        },
        timeout=120,
    )
    if response.status_code not in (200, 201, 204):
        sys.exit(f"실패 {response.status_code}: {response.text[:500]}")

    graded = sum(1 for row in rows if row["yama_answer"])
    print(f"  {len(rows)}문항 완료 (정답 있는 문항 {graded}개)")
    if not args.publish:
        print("  검수 중 상태다. 관리자 > PDF 검수 에서 확인한 뒤 공개로 바꾼다.")


if __name__ == "__main__":
    main()
