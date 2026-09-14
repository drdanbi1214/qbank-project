"""종양 이론 목차, 사용자 참조, 연결된 KMLE 문항을 읽기 전용으로 점검한다."""

from __future__ import annotations

import json
from collections import Counter, defaultdict

from ingest_exam import Client
from supabase_credentials import load_supabase_credentials


def plain_text(value: object) -> str:
    parts: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            text = node.get("text")
            if isinstance(text, str):
                parts.append(text)
            for child in node.get("content", []) if isinstance(node.get("content"), list) else []:
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(value)
    return " ".join(" ".join(parts).split())


def theory_embeds(value: object) -> set[str]:
    found: set[str] = set()

    def walk(node: object) -> None:
        if isinstance(node, dict):
            if node.get("type") == "theoryEmbed":
                attrs = node.get("attrs")
                if isinstance(attrs, dict) and isinstance(attrs.get("documentId"), str):
                    found.add(attrs["documentId"])
            for child in node.get("content", []) if isinstance(node.get("content"), list) else []:
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(value)
    return found


def image_urls(value: object) -> list[str]:
    found: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            if node.get("type") == "image" and isinstance(node.get("url"), str):
                found.append(node["url"])
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(value)
    return found


def main() -> None:
    base_url, key = load_supabase_credentials()
    client = Client(base_url, key)
    documents = client.get(
        "theory_documents",
        {"select": "id,subject_id,parent_id,title,has_content,sort_order,source_key,content"},
    )
    roots = [row for row in documents if row["title"] == "종양" and row["parent_id"] is None]
    if len(roots) != 1:
        raise SystemExit(f"최상위 종양 문서가 {len(roots)}개입니다.")
    root = roots[0]
    by_parent: dict[str | None, list[dict]] = defaultdict(list)
    for row in documents:
        if row["subject_id"] == root["subject_id"]:
            by_parent[row["parent_id"]].append(row)
    for rows in by_parent.values():
        rows.sort(key=lambda row: (row["sort_order"], row["title"]))

    oncology: list[dict] = []

    def collect(row: dict, depth: int) -> None:
        oncology.append(row)
        text = plain_text(row["content"])
        print(
            f"{'  ' * depth}- {row['title']} | id={row['id']} | "
            f"content={row['has_content']} | order={row['sort_order']} | text={len(text)}자"
        )
        if text:
            print(f"{'  ' * (depth + 1)}본문: {text[:160]}")
        for child in by_parent.get(row["id"], []):
            collect(child, depth + 1)

    print("현재 종양 목차:")
    collect(root, 0)
    ids = [row["id"] for row in oncology]
    id_filter = "in.(" + ",".join(ids) + ")"

    memo_rows = client.get(
        "theory_memos", {"document_id": id_filter, "select": "document_id,user_id,id"}
    )
    mark_rows = client.get(
        "text_marks",
        {
            "target_type": "eq.theory",
            "target_id": id_filter,
            "select": "target_id,user_id,id",
        },
    )
    lecture_rows = client.get(
        "lecture_sources",
        {"theory_document_id": id_filter, "select": "theory_document_id,id,title"},
    )
    question_rows = client.get(
        "theory_questions",
        {"theory_document_id": id_filter, "select": "theory_document_id,question_id"},
    )
    linked_question_ids = sorted({row["question_id"] for row in question_rows})
    linked_filter = (
        "in.(" + ",".join(linked_question_ids) + ")"
        if linked_question_ids
        else "eq.00000000-0000-0000-0000-000000000000"
    )
    linked_questions = client.get(
        "questions",
        {
            "id": linked_filter,
            "select": "id,status,completeness,stem_blocks,official_explanation,editor_answer,choices",
        },
    )
    source_rows = client.get(
        "kmle_sources",
        {"question_id": linked_filter, "select": "question_id,allen_hash,allen_chapter"},
    )
    topics = client.get("topics", {"select": "id,title,created_by,content"})
    topic_refs: list[tuple[str, str, str | None, str]] = []
    oncology_ids = set(ids)
    title_by_id = {row["id"]: row["title"] for row in oncology}
    for topic in topics:
        for document_id in theory_embeds(topic.get("content")) & oncology_ids:
            topic_refs.append((topic["id"], topic["title"], topic.get("created_by"), document_id))

    user_ids = {
        str(row["user_id"])
        for row in [*memo_rows, *mark_rows]
        if row.get("user_id")
    } | {str(row[2]) for row in topic_refs if row[2]}
    profiles = client.get(
        "profiles",
        {
            "id": "in.(" + ",".join(sorted(user_ids)) + ")" if user_ids else "eq.00000000-0000-0000-0000-000000000000",
            "select": "id,display_name",
        },
    )
    profile_name = {row["id"]: row["display_name"] for row in profiles}

    print("\n문서별 참조:")
    memo_counts = Counter(row["document_id"] for row in memo_rows)
    mark_counts = Counter(row["target_id"] for row in mark_rows)
    lecture_counts = Counter(row["theory_document_id"] for row in lecture_rows)
    question_counts = Counter(row["theory_document_id"] for row in question_rows)
    topic_counts = Counter(row[3] for row in topic_refs)
    for row in oncology:
        document_id = row["id"]
        print(
            f"- {row['title']}: 개인메모 {memo_counts[document_id]}, "
            f"형광펜 {mark_counts[document_id]}, 게시물삽입 {topic_counts[document_id]}, "
            f"강의연결 {lecture_counts[document_id]}, KMLE연결 {question_counts[document_id]}"
        )

    if topic_refs:
        print("\n이론 문서를 삽입한 게시물:")
        for topic_id, title, creator, document_id in topic_refs:
            print(
                f"- {title} ({topic_id}) → {title_by_id[document_id]} | "
                f"작성자={profile_name.get(creator or '', creator or '없음')}"
            )
    if memo_rows or mark_rows:
        print("\n개인 표시 사용자 수:")
        affected = Counter()
        for row in memo_rows:
            affected[str(row["user_id"])] += 1
        for row in mark_rows:
            affected[str(row["user_id"])] += 1
        for user_id, count in affected.items():
            print(f"- {profile_name.get(user_id, user_id)}: {count}개")

    all_image_urls = [
        url
        for row in linked_questions
        for url in [*image_urls(row.get("stem_blocks")), *image_urls(row.get("official_explanation"))]
    ]
    placeholder_images = [url for url in all_image_urls if url == "PLACEHOLDER"]
    print("\n연결 KMLE 검증:")
    print(f"- 문항 {len(linked_questions)}개 · 원본 식별자 {len(source_rows)}개")
    print(
        f"- 공개 {sum(row['status'] == 'published' for row in linked_questions)}개 · "
        f"완전 {sum(row['completeness'] == 'complete' for row in linked_questions)}개"
    )
    print(
        f"- 정답 있음 {sum(bool(row.get('editor_answer')) for row in linked_questions)}개 · "
        f"선지 2개 이상 {sum(len(row.get('choices') or []) >= 2 for row in linked_questions)}개"
    )
    print(f"- 저장 이미지 {len(all_image_urls)}개 · PLACEHOLDER {len(placeholder_images)}개")
    print(f"- Allen 대제목별 {dict(sorted(Counter(row['allen_chapter'] for row in source_rows).items()))}")

    print("\nJSON 요약:")
    print(json.dumps({
        "root_id": root["id"],
        "document_ids": {row["title"]: row["id"] for row in oncology},
        "memo_count": len(memo_rows),
        "mark_count": len(mark_rows),
        "topic_embed_count": len(topic_refs),
        "lecture_link_count": len(lecture_rows),
        "kmle_link_count": len(question_rows),
        "kmle_question_count": len(linked_questions),
        "kmle_source_count": len(source_rows),
        "kmle_chapter_counts": dict(sorted(Counter(row["allen_chapter"] for row in source_rows).items())),
        "kmle_stored_image_count": len(all_image_urls),
        "kmle_placeholder_image_count": len(placeholder_images),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
