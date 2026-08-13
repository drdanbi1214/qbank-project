"""답지에서 정답 후보를 찾는다.

답지가 정답을 표시하는 방법은 학교와 연도마다 다르다. 실제 자료를 열어보니
이 학교 답지는 정답 보기를 굵은 글씨로 써두었고, 노란 형광은 쓰지 않았다.
그래서 두 가지를 모두 본다.

  bold      정답 보기만 굵은 글꼴 (기본값, 실제 자료가 이 방식이다)
  highlight 정답 보기 줄에 노란 배경

이 방법은 확실하지 않다. 문제 전체가 굵거나 형광이 없으면 못 잡는다. 결과는
어디까지나 후보이고, 못 찾은 문항은 answer_status 를 unconfirmed 로 두어
검수 화면에서 사람이 확정한다.

사용법:
    python detect_answers.py 원본.pdf out/answers.json [--mode bold|highlight|both]
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

# `38.5도` 같은 검사수치를 38번 문항으로 오인하지 않는다. 번호 뒤에
# 공백이 없더라도 다음 글자가 숫자가 아닌 실제 문항 표기는 허용한다.
QUESTION_START = re.compile(r"^(\d{1,3})[.,](?!\d)(?:\s*\S|\s*$)")
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"
CHOICE_START = re.compile(rf"^\s*([{CIRCLED}]|\(?(\d)\))")

BOLD_FLAG = 1 << 4  # PyMuPDF span flags 의 굵은 글씨 비트


def choice_index(text: str) -> int | None:
    found = CHOICE_START.match(text)
    if not found:
        return None
    token = found.group(1)
    if token and token[0] in CIRCLED:
        return CIRCLED.index(token[0]) + 1
    if found.group(2):
        return int(found.group(2))
    return None


def is_bold(span: dict) -> bool:
    """flags 비트와 글꼴 이름을 함께 본다. 둘 중 하나만 맞아도 굵은 글씨로 본다."""
    return bool(span.get("flags", 0) & BOLD_FLAG) or "bold" in span.get("font", "").lower()


def is_yellow(r: int, g: int, b: int) -> bool:
    return r > 180 and g > 160 and b < 150 and (r + g) / 2 - b > 60


def detect(pdf_path: str, mode: str, min_ratio: float) -> dict[int, list[int]]:
    doc = fitz.open(pdf_path)
    answers: dict[int, list[int]] = {}

    for page in doc:
        mid_x = page.rect.width / 2
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2)) if mode != "bold" else None

        entries = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                spans = [s for s in line["spans"] if s["text"].strip()]
                text = "".join(s["text"] for s in line["spans"]).strip()
                if text:
                    entries.append((line["bbox"], text, spans))

        # 2단 편집이라 단 -> 세로 순으로 읽어야 문항과 보기가 어긋나지 않는다
        entries.sort(key=lambda e: (0 if e[0][0] < mid_x else 1, e[0][1]))

        current = None
        for bbox, text, spans in entries:
            found = QUESTION_START.match(text)
            if found:
                current = int(found.group(1))
                continue

            index = choice_index(text)
            if current is None or index is None:
                continue

            marked = False

            if mode in ("bold", "both") and spans and all(is_bold(s) for s in spans):
                marked = True

            if not marked and mode in ("highlight", "both") and pixmap is not None:
                x0, y0, x1, y1 = (int(v * 2) for v in bbox)
                x0, y0 = max(0, x0), max(0, y0)
                x1, y1 = min(pixmap.width, x1), min(pixmap.height, y1)
                if x1 > x0 and y1 > y0:
                    total = hits = 0
                    for y in range(y0, y1, 2):
                        for x in range(x0, x1, 2):
                            r, g, b = pixmap.pixel(x, y)[:3]
                            total += 1
                            if is_yellow(r, g, b):
                                hits += 1
                    marked = bool(total) and hits / total >= min_ratio

            if marked:
                answers.setdefault(current, []).append(index)

    doc.close()
    return answers


def main() -> None:
    parser = argparse.ArgumentParser(description="답지에서 정답 후보 추출")
    parser.add_argument("pdf")
    parser.add_argument("output")
    parser.add_argument("--mode", choices=["bold", "highlight", "both"], default="bold")
    parser.add_argument("--min-ratio", type=float, default=0.15)
    args = parser.parse_args()

    answers = detect(args.pdf, args.mode, args.min_ratio)
    payload = {str(number): sorted(set(choices)) for number, choices in sorted(answers.items())}

    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    multi = [n for n, c in payload.items() if len(c) > 1]
    print(f"정답 후보를 찾은 문항 {len(payload)}개를 {args.output} 에 저장했다")
    if multi:
        print(f"  보기 여러 개가 잡힌 문항 {multi}. 복수정답인지 오탐인지 확인한다.")
    print("  못 찾은 문항은 answer_status 를 unconfirmed 로 두고 검수 화면에서 확정한다.")


if __name__ == "__main__":
    main()
