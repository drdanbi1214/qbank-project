"""PDF 를 페이지별 PNG 로 변환한다.

검수 화면은 PDF 를 그대로 띄우지만, 페이지를 눈으로 훑거나 다른 도구에 넘길 때는
이미지가 편하다. 해상도는 기본 200dpi 로 두었다. 그보다 높이면 파일만 커지고
글자 판독에는 큰 차이가 없다.

사용법:
    python pdf_to_images.py 원본.pdf 출력폴더 [--dpi 200]
"""

# 파이썬 3.9 에서도 X | None 표기를 쓰기 위해 (실행 시 평가하지 않는다)
from __future__ import annotations

import argparse
import os
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF 가 필요하다. pip install -r requirements.txt")


def pdf_to_images(pdf_path: str, output_dir: str, dpi: int = 200) -> list[str]:
    os.makedirs(output_dir, exist_ok=True)
    doc = fitz.open(pdf_path)
    zoom = dpi / 72  # PDF 기본 해상도가 72dpi 다
    matrix = fitz.Matrix(zoom, zoom)

    saved = []
    for page_number, page in enumerate(doc, start=1):
        pixmap = page.get_pixmap(matrix=matrix)
        path = os.path.join(output_dir, f"page_{page_number:03d}.png")
        pixmap.save(path)
        saved.append(path)

    doc.close()
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(description="PDF 를 페이지 이미지로 변환")
    parser.add_argument("pdf")
    parser.add_argument("output_dir")
    parser.add_argument("--dpi", type=int, default=200)
    args = parser.parse_args()

    saved = pdf_to_images(args.pdf, args.output_dir, args.dpi)
    print(f"{len(saved)}쪽을 {args.output_dir} 에 저장했다")


if __name__ == "__main__":
    main()
