"""종양 이론 목차를 Allen의 2개 대제목 구조로 재편한다.

기본 실행은 변경 계획만 출력한다. ``--apply``를 붙이면 원격 Supabase에
반영한다. 기존 세 문서의 UUID를 유지하므로 직접 링크와 사용자 참조는
그대로 남고, 본문만 빈 편집 문서로 초기화된다.
"""

from __future__ import annotations

import argparse

from ingest_exam import Client
from supabase_credentials import load_supabase_credentials


ROOT_ID = "e42b824d-5606-44c2-90c3-4c6f0cdc667d"
DIAGNOSIS_ID = "2d7f9d51-6ec5-4a71-8dca-5efdf78cbdd9"
TREATMENT_ID = "c1c4ac02-e82a-4b45-a667-969b67d03540"
COMPLICATIONS_GROUP_ID = "965d16ba-af55-4a62-b4ed-4ff00bab8f8f"
DIAGNOSIS_TREATMENT_GROUP_ID = "4b4600f0-6c54-4ab4-a833-c183772174e1"
EMPTY_CONTENT = {"type": "doc", "content": [{"type": "paragraph"}]}

NEW_COMPLICATIONS = [
    (
        "6e7ac283-3c54-48f8-824f-10258b0eac01",
        "신생물딸림증후군",
        100,
        "kmle:onco:complication:paraneoplastic",
    ),
    (
        "6e7ac283-3c54-48f8-824f-10258b0eac02",
        "위대정맥증후군",
        200,
        "kmle:onco:complication:svc",
    ),
    (
        "6e7ac283-3c54-48f8-824f-10258b0eac03",
        "종양의 척수 압박",
        300,
        "kmle:onco:complication:spinal-cord-compression",
    ),
    (
        "6e7ac283-3c54-48f8-824f-10258b0eac04",
        "종양용해증후군",
        400,
        "kmle:onco:complication:tumor-lysis",
    ),
]


def require_document(client: Client, document_id: str, expected_title: str) -> dict:
    rows = client.get(
        "theory_documents",
        {"id": f"eq.{document_id}", "select": "id,subject_id,parent_id,title,has_content,required_permission,created_by"},
    )
    if len(rows) != 1:
        raise SystemExit(f"필수 이론 문서가 없습니다: {expected_title} ({document_id})")
    row = rows[0]
    allowed_titles = {expected_title}
    if document_id == COMPLICATIONS_GROUP_ID:
        allowed_titles.add("2 종양의 합병증")
    if row["title"] not in allowed_titles:
        raise SystemExit(f"문서 제목이 예상과 다릅니다: {row['title']} ({document_id})")
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description="종양 이론 목차 개편")
    parser.add_argument("--apply", action="store_true", help="원격 DB에 실제 반영")
    args = parser.parse_args()

    base_url, key = load_supabase_credentials()
    client = Client(base_url, key)
    root = require_document(client, ROOT_ID, "종양")
    diagnosis = require_document(client, DIAGNOSIS_ID, "종양의 진단")
    treatment = require_document(client, TREATMENT_ID, "종양의 치료")
    complications = require_document(client, COMPLICATIONS_GROUP_ID, "종양의 합병증")
    for row in (diagnosis, treatment, complications):
        if row["subject_id"] != root["subject_id"]:
            raise SystemExit(f"종양 문서의 과목이 서로 다릅니다: {row['title']}")

    oncology_ids = [ROOT_ID, DIAGNOSIS_ID, TREATMENT_ID, COMPLICATIONS_GROUP_ID]
    id_filter = "in.(" + ",".join(oncology_ids) + ")"
    memos = client.get("theory_memos", {"document_id": id_filter, "select": "id"})
    marks = client.get(
        "text_marks",
        {"target_type": "eq.theory", "target_id": id_filter, "select": "id"},
    )
    topic_rows = client.get("topics", {"select": "id,title,content"})
    embedded = [
        row for row in topic_rows
        if any(document_id in str(row.get("content")) for document_id in oncology_ids)
    ]

    print("변경할 목차:")
    print("- 종양")
    print("  - 1 종양의 진단/치료")
    print("    - 종양의 진단")
    print("    - 종양의 치료")
    print("  - 2 종양의 합병증")
    for _, title, _, _ in NEW_COMPLICATIONS:
        print(f"    - {title}")
    print(
        f"기존 사용자 참조: 개인메모 {len(memos)} · 형광펜 {len(marks)} · "
        f"게시물 삽입 {len(embedded)}"
    )
    print("기존 세 문서 ID는 유지하고 본문만 비웁니다.")

    if not args.apply:
        print("dry-run입니다. 반영하려면 --apply를 붙이세요.")
        return

    common = {
        "subject_id": root["subject_id"],
        "unit_id": None,
        "required_permission": root["required_permission"],
        "is_published": True,
        "created_by": root.get("created_by"),
    }
    group_rows = client.get(
        "theory_documents",
        {"id": f"eq.{DIAGNOSIS_TREATMENT_GROUP_ID}", "select": "id"},
    )
    group_body = {
            **common,
            "id": DIAGNOSIS_TREATMENT_GROUP_ID,
            "parent_id": ROOT_ID,
            "title": "1 종양의 진단/치료",
            "sort_order": 100,
            "has_content": False,
            "source_key": "kmle:onco:group:diagnosis-treatment",
    }
    if group_rows:
        group_body.pop("id")
        group_body.pop("created_by")
        client.patch("theory_documents", {"id": f"eq.{DIAGNOSIS_TREATMENT_GROUP_ID}"}, group_body)
    else:
        client.post("theory_documents", [{**group_body, "content": EMPTY_CONTENT}])

    diagnosis_body = {
        "parent_id": DIAGNOSIS_TREATMENT_GROUP_ID,
        "sort_order": 100,
        "has_content": True,
        "is_published": True,
    }
    if diagnosis["parent_id"] == ROOT_ID:
        diagnosis_body["content"] = EMPTY_CONTENT
    client.patch(
        "theory_documents",
        {"id": f"eq.{DIAGNOSIS_ID}"},
        diagnosis_body,
    )

    treatment_body = {
        "parent_id": DIAGNOSIS_TREATMENT_GROUP_ID,
        "sort_order": 200,
        "has_content": True,
        "is_published": True,
    }
    if treatment["parent_id"] == ROOT_ID:
        treatment_body["content"] = EMPTY_CONTENT
    client.patch(
        "theory_documents",
        {"id": f"eq.{TREATMENT_ID}"},
        treatment_body,
    )

    complications_body = {
        "parent_id": ROOT_ID,
        "unit_id": None,
        "title": "2 종양의 합병증",
        "sort_order": 200,
        "has_content": False,
        "is_published": True,
        "source_key": "kmle:onco:group:complications",
    }
    if complications["has_content"]:
        complications_body["content"] = EMPTY_CONTENT
    client.patch(
        "theory_documents",
        {"id": f"eq.{COMPLICATIONS_GROUP_ID}"},
        complications_body,
    )

    for document_id, title, sort_order, source_key in NEW_COMPLICATIONS:
        child_rows = client.get(
            "theory_documents", {"id": f"eq.{document_id}", "select": "id"}
        )
        child_body = {
            **common,
            "parent_id": COMPLICATIONS_GROUP_ID,
            "title": title,
            "sort_order": sort_order,
            "has_content": True,
            "source_key": source_key,
        }
        if child_rows:
            child_body.pop("created_by")
            client.patch("theory_documents", {"id": f"eq.{document_id}"}, child_body)
        else:
            client.post(
                "theory_documents",
                [{**child_body, "id": document_id, "content": EMPTY_CONTENT}],
            )
    print("종양 이론 목차를 반영했습니다.")


if __name__ == "__main__":
    main()
