"""PDF 텍스트 레이어에서 문항을 잘라낸다.

원본은 2단 편집이 많아 좌표 기준으로 좌우 단을 나눈 뒤 위에서 아래로 읽는다.
그냥 page.get_text() 로 뽑으면 두 단이 뒤섞여 문장이 엉킨다.

문항 분할은 줄 시작의 `12.` 패턴, 보기는 `①~⑤` 또는 `1)` 패턴으로 본다.
복기 자료라 규칙에서 벗어나는 문항이 반드시 나오므로, 결과에
completeness 를 붙여 검수 화면에서 걸러낼 수 있게 한다.

사용법:
    python parse_questions.py 원본.pdf out/questions.json [--single-column]
"""

# 파이썬 3.9 에서도 X | None 표기를 쓰기 위해 (실행 시 평가하지 않는다)
from __future__ import annotations

import argparse
import json
import re
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF 가 필요하다. pip install -r requirements.txt")

# `7.26 mg/dL` 같은 검사수치를 문항번호로 오인하지 않는다. 쉼표 오타와
# 번호만 단독 줄에 남는 PDF도 허용하되 구분자 바로 뒤 숫자는 제외한다.
QUESTION_START = re.compile(r"^(\d{1,3})[.,](?!\d)(?:\s*(.*)|\s*$)")
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"
CHOICE_START = re.compile(rf"^\s*([{CIRCLED}]|\(?\d\))\s*(.*)")


def read_lines(pdf_path: str, single_column: bool) -> list[tuple[int, str]]:
    """(페이지, 줄) 목록을 읽는 순서대로 돌려준다."""
    doc = fitz.open(pdf_path)
    lines: list[tuple[int, str]] = []

    for page_number, page in enumerate(doc, start=1):
        mid_x = page.rect.width / 2
        entries = []

        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                text = "".join(span["text"] for span in line["spans"]).strip()
                if not text:
                    continue
                x0, y0 = line["bbox"][0], line["bbox"][1]
                column = 0 if (single_column or x0 < mid_x) else 1
                entries.append((column, y0, text))

        # 단 -> 세로 위치 순으로 읽는다
        entries.sort(key=lambda item: (item[0], item[1]))
        lines.extend((page_number, text) for _, _, text in entries)

    doc.close()
    return lines


def split_questions(lines: list[tuple[int, str]]) -> list[dict]:
    questions: list[dict] = []
    current: dict | None = None
    mode = "stem"

    # 본문 속 검사수치(`9, Creatinine`)나 번호 목록도 문항 시작처럼 보일 수
    # 있다. 문서 전체에서 문제번호가 증가하는 최장 부분열만 실제 경계로 쓴다.
    markers = [
        (index, int(found.group(1)))
        for index, (_, text) in enumerate(lines)
        if (found := QUESTION_START.match(text))
    ]
    lengths = [1] * len(markers)
    previous = [-1] * len(markers)
    for i in range(len(markers)):
        for j in range(i):
            if markers[j][1] < markers[i][1] and lengths[j] + 1 > lengths[i]:
                lengths[i] = lengths[j] + 1
                previous[i] = j
    accepted_starts: set[int] = set()
    if markers:
        cursor = max(range(len(markers)), key=lambda i: lengths[i])
        while cursor != -1:
            accepted_starts.add(markers[cursor][0])
            cursor = previous[cursor]

    def flush() -> None:
        if current is None:
            return
        current["stem"] = "\n".join(current["stem_lines"]).strip()
        del current["stem_lines"]
        # 보기가 2개 미만이면 복기가 덜 된 것으로 본다
        if len(current["choices"]) < 2:
            current["completeness"] = "partial_choices"
        questions.append(current)

    for line_index, (page, text) in enumerate(lines):
        start = QUESTION_START.match(text)
        if start and line_index in accepted_starts:
            flush()
            current = {
                "question_number": int(start.group(1)),
                "page": page,
                "stem_lines": [start.group(2).strip()] if start.group(2).strip() else [],
                "choices": [],
                "completeness": "complete",
            }
            mode = "stem"
            continue

        if current is None:
            continue

        choice = CHOICE_START.match(text)
        if choice:
            mode = "choice"
            current["choices"].append(choice.group(2).strip())
            continue

        if mode == "choice" and current["choices"]:
            # 보기가 여러 줄로 이어진 경우
            current["choices"][-1] = (current["choices"][-1] + " " + text).strip()
        else:
            current["stem_lines"].append(text)

    flush()
    return questions


def main() -> None:
    parser = argparse.ArgumentParser(description="PDF 에서 문항 분할")
    parser.add_argument("pdf")
    parser.add_argument("output")
    parser.add_argument(
        "--single-column",
        action="store_true",
        help="1단 편집 PDF 일 때 지정한다. 기본은 2단으로 본다.",
    )
    args = parser.parse_args()

    lines = read_lines(args.pdf, args.single_column)
    questions = split_questions(lines)

    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump({"questions": questions}, fh, ensure_ascii=False, indent=2)

    numbers = [q["question_number"] for q in questions]
    duplicated = sorted({n for n in numbers if numbers.count(n) > 1})
    missing = sorted(set(range(1, max(numbers) + 1)) - set(numbers)) if numbers else []

    print(f"문항 {len(questions)}개를 {args.output} 에 저장했다")
    if duplicated:
        print(f"  중복 번호: {duplicated}")
    if missing:
        print(f"  빠진 번호: {missing}")
    weak = [q["question_number"] for q in questions if q["completeness"] != "complete"]
    if weak:
        print(f"  보기가 부족한 문항: {weak}")


if __name__ == "__main__":
    main()
