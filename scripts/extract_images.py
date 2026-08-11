"""PDF 안의 이미지를 뽑아 문항 번호에 매핑한다.

같은 단(column) 안에서 이미지 바로 위에 있는 문항 번호를 그 이미지의 주인으로 본다.
2단 편집이라 단 구분을 하지 않으면 옆 단 문항에 붙어버린다.

완벽한 자동 매핑은 어렵다. 그래서 파일명에 추정한 문항 번호와 페이지를 넣어
사람이 파일 목록만 훑어도 틀린 것을 잡을 수 있게 한다.
    <접두어>_q<문항>_p<페이지>_<순번>.png

사용법:
    python extract_images.py 원본.pdf out/images 2601
"""

# 파이썬 3.9 에서도 X | None 표기를 쓰기 위해 (실행 시 평가하지 않는다)
from __future__ import annotations

import argparse
import os
import re
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF 가 필요하다. pip install -r requirements.txt")

QUESTION_START = re.compile(r"^(\d{1,3})\.\s*\S")
# 로고나 구분선 같은 자잘한 장식은 건너뛴다
MIN_PIXELS = 100


def extract(pdf_path: str, output_dir: str, prefix: str) -> list[dict]:
    os.makedirs(output_dir, exist_ok=True)
    doc = fitz.open(pdf_path)
    results = []

    for page_number, page in enumerate(doc, start=1):
        mid_x = page.rect.width / 2

        markers = []  # (단, y, 문항번호)
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                text = "".join(span["text"] for span in line["spans"]).strip()
                found = QUESTION_START.match(text)
                if found:
                    x0, y0 = line["bbox"][0], line["bbox"][1]
                    markers.append((0 if x0 < mid_x else 1, y0, int(found.group(1))))
        markers.sort(key=lambda m: (m[0], m[1]))

        for order, image in enumerate(page.get_images(full=True)):
            xref = image[0]
            rects = page.get_image_rects(xref)
            if not rects:
                continue

            rect = rects[0]
            if rect.width < MIN_PIXELS or rect.height < MIN_PIXELS:
                continue

            column = 0 if rect.x0 < mid_x else 1
            # 같은 단에서 이미지보다 위에 있는 가장 가까운 문항 번호
            above = [m for m in markers if m[0] == column and m[1] <= rect.y0 + 5]
            if not above:
                # 단 맨 위에 있는 이미지는 페이지 전체에서 다시 찾는다
                above = [m for m in markers if m[1] <= rect.y0 + 5]
            question = max(above, key=lambda m: m[1])[2] if above else None

            pixmap = fitz.Pixmap(doc, xref)
            if pixmap.n - pixmap.alpha > 3:  # CMYK 는 RGB 로 바꿔야 저장된다
                pixmap = fitz.Pixmap(fitz.csRGB, pixmap)

            name = f"{prefix}_q{question or 'UNKNOWN'}_p{page_number}_{order}.png"
            pixmap.save(os.path.join(output_dir, name))
            results.append({"file": name, "page": page_number, "question": question})

    doc.close()
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="PDF 이미지 추출 및 문항 매핑")
    parser.add_argument("pdf")
    parser.add_argument("output_dir")
    parser.add_argument("prefix", help="파일명 접두어. 시험 구분용 (예: 2601)")
    args = parser.parse_args()

    results = extract(args.pdf, args.output_dir, args.prefix)
    unknown = [r for r in results if r["question"] is None]

    print(f"이미지 {len(results)}장을 {args.output_dir} 에 저장했다")
    if unknown:
        print(f"  문항을 못 찾은 이미지 {len(unknown)}장. 파일명이 UNKNOWN 이다.")
    print("  파일 목록을 훑어 문항 번호가 맞는지 확인한다.")


if __name__ == "__main__":
    main()
