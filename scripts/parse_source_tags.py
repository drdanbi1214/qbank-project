"""본문에서 출처 태그를 뽑아낸다.

복기 자료에는 `(21Y)`, `(22Y 변형)` 처럼 어느 해 문제인지 표시가 붙는다.
이걸 source_tags 로 옮기고 변형이면 variant_type 을 variant 로 둔다.

태그는 본문에서 지운다. 화면에서는 태그를 따로 표시하므로 본문에 남겨두면
같은 정보가 두 번 나온다.

사용법:
    python parse_source_tags.py out/questions.json [--in-place]
"""

# 파이썬 3.9 에서도 X | None 표기를 쓰기 위해 (실행 시 평가하지 않는다)
from __future__ import annotations

import argparse
import json
import re

# (21Y), (21Y 변형), (21Y, 22Y) 형태를 모두 잡는다
TAG_BLOCK = re.compile(r"\(\s*((?:\d{2}Y\s*(?:변형)?\s*,?\s*)+)\)")
SINGLE_TAG = re.compile(r"(\d{2}Y)\s*(변형)?")


def extract_tags(text: str) -> tuple[str, list[str], bool]:
    tags: list[str] = []
    variant = False

    def replace(match: re.Match[str]) -> str:
        nonlocal variant
        for year, mark in SINGLE_TAG.findall(match.group(1)):
            tags.append(f"{year} 변형" if mark else year)
            if mark:
                variant = True
        return ""

    cleaned = TAG_BLOCK.sub(replace, text)
    # 태그를 빼면서 생긴 이중 공백을 정리한다
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()
    return cleaned, tags, variant


def main() -> None:
    parser = argparse.ArgumentParser(description="본문에서 출처 태그 추출")
    parser.add_argument("questions_json")
    parser.add_argument("--in-place", action="store_true", help="원본 파일을 덮어쓴다")
    args = parser.parse_args()

    with open(args.questions_json, encoding="utf-8") as fh:
        data = json.load(fh)

    tagged = 0
    for question in data.get("questions", []):
        stem = question.get("stem", "")
        cleaned, tags, variant = extract_tags(stem)
        if not tags:
            continue
        question["stem"] = cleaned
        question["source_tags"] = tags
        question["variant_type"] = "variant" if variant else "original"
        tagged += 1

    target = args.questions_json if args.in_place else args.questions_json.replace(
        ".json", ".tagged.json"
    )
    with open(target, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)

    print(f"{tagged}문항에서 출처 태그를 뽑아 {target} 에 저장했다")


if __name__ == "__main__":
    main()
