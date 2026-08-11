# 기출문제 데이터 입력 가이드

문제 데이터를 넘겨주실 때 이 형식을 따라주시면 별도 변환 없이 바로 반영할 수 있습니다.
JSON 파일 하나로 시험 한 개를 표현합니다.

## 기본 구조

```json
{
  "exam": {
    "cohort": "26학번",
    "subject": "내과",
    "exam_date": "2026-04-17",
    "duration_min": 60,
    "format": "CBT",
    "total_questions": 60,
    "restored_questions": 62,
    "overview": "과별로 출제된 문제 수 및 분류가 정확하지 않을 수 있습니다."
  },
  "questions": [
    { "question_number": 1, "unit": "심장내과", "stem_blocks": [...], "choices": [...], ... }
  ]
}
```

- `exam` 은 시험 한 개의 정보입니다. 이미 등록된 시험이면 이 부분은 없어도 됩니다.
- `format` 은 `CBT` 또는 `PBT` 만 허용됩니다.
- `questions` 배열의 각 항목이 문항 하나입니다.

## 문항 하나의 형식

```json
{
  "question_number": 1,
  "unit": "심장내과",
  "stem_blocks": [
    { "type": "text", "content": "82세 남성이 70년 동안 담배 피고 술 먹었는데..." },
    { "type": "image", "url": "PLACEHOLDER", "caption": null }
  ],
  "choices": [
    { "no": 1, "text": "경피적혈관개통술" },
    { "no": 2, "text": "스테로이드" }
  ],
  "answer_count": 1,
  "yama_answer": [1],
  "editor_answer": [],
  "answer_status": "unconfirmed",
  "completeness": "image_missing",
  "restorer_note": null
}
```

### 각 필드 설명

| 필드 | 필수 | 설명 |
|---|---|---|
| `question_number` | ✅ | 원본 시험지의 문항 번호. 중복·누락 없이 |
| `unit` | 진료과별 시험만 | 아래 "단원(unit) 규칙" 참고 |
| `stem_blocks` | ✅ | 본문. 아래 "본문 블록" 참고 |
| `choices` | A형/R형만 | 보기. **개수 고정 없음** — 4개든 6개든 배열 길이대로 |
| `answer_count` | ✅ | 정답 개수. 단일 정답도 `1` |
| `yama_answer` | 원본에 있으면 | 원문(파일)에 적혀 있던 답. 보기 번호 배열, 예: `[1]`, `[1,3]` |
| `editor_answer` | 항상 빈 배열 `[]` | **입력하지 마세요.** 편집자 검토 후 저희 쪽에서 채웁니다 |
| `answer_status` | ✅ | 항상 `"unconfirmed"` 로 넣어주세요 |
| `completeness` | ✅ | 아래 "완성도" 참고 |
| `restorer_note` | 있으면 | 복기자가 남긴 메모. 예: "보기 순서가 다를 수 있음" |

### 본문 블록 (`stem_blocks`)

배열 순서가 곧 화면에 보이는 순서입니다. 다섯 종류를 섞어 쓸 수 있습니다.

```json
{ "type": "text", "content": "문제 본문 텍스트" }

{ "type": "labbox", "items": [
    { "label": "Hb", "value": "14.7" },
    { "label": "WBC", "value": "7,200" }
] }

{ "type": "table", "headers": ["인구군", "유병률(%)"],
  "rows": [["일반인구", "1.0"], ["형제", "8.0"]] }

{ "type": "image", "url": "PLACEHOLDER", "caption": null }

{ "type": "formula", "latex": "\\frac{a}{b}" }
```

**이미지가 있는 자리**는 `"url": "PLACEHOLDER"` 로 표시해주세요. 실제 이미지 파일은
따로 첨부해주시면 저희가 자동으로 문항 번호에 맞춰 끼워 넣습니다.

**caption 규칙 — 원본에 없는 설명을 넣지 마세요.** 시험지에 "CT angio" 같은 캡션이
실제로 인쇄되어 있었으면 넣고, 복기자가 나중에 붙인 설명이면 `caption`이 아니라
`restorer_note`에 넣어주세요. 목표는 시험지를 있는 그대로 옮기는 것이라, 원본에
없던 문구가 화면에 나오면 안 됩니다.

### 보기 (`choices`)

```json
{ "no": 1, "text": "경피적혈관개통술" }
```

- 번호는 `1`부터 순서대로. 개수 제한 없습니다.
- 보기가 이미지인 경우 `"text"` 대신 `"image_url": "PLACEHOLDER"` 로 넣어주세요.
- 서술형 문제는 `choices` 를 아예 빼고 `model_answer`(모범답안), `grading_points`(채점
  포인트 배열)를 대신 넣어주세요.

### 완성도 (`completeness`)

| 값 | 의미 |
|---|---|
| `complete` | 본문, 보기 모두 온전히 복기됨 |
| `partial_choices` | 보기 일부가 비어 있거나 불확실함 |
| `partial_stem` | 본문 자체가 일부만 기억남 |
| `image_missing` | 사진/그림이 있었는데 못 구했음 (이미지를 나중에 붙이면 저희가 `complete` 로 바꿉니다) |

### 단원(unit) 규칙

- **진료과별로 나뉘는 시험**(예: 내과, 소아과처럼 여러 과가 섞인 시험)은 `unit` 에
  **실제 진료과명**을 넣어주세요. 예: `"심장내과"`, `"호흡기내과"`. 저희 쪽에서
  단원으로 자동 연결합니다.
- **단일 과목 시험**(정형외과, 영상의학과처럼 진료과 구분이 없는 시험)은 `unit` 을
  아예 넣지 마세요. 저희가 관리자 화면에서 나중에 정리합니다.

### 출처 태그 (선택)

본문에 `(21Y)`, `(22Y 변형)` 처럼 몇 년도 문제인지 표시가 있으면 본문에서 빼지 말고
그대로 두셔도 됩니다. 저희 쪽 스크립트가 자동으로 인식해 `source_tags` 로 분리하고
본문에서는 제거합니다.

## 이미지 파일

- 파일명 규칙: `<접두어>_q<문항번호>_p<페이지>_<순번>.png`
  예: `2601_q14_p3_0.png` = 시험 2601, 14번 문항, 3쪽, 그 문항의 첫 번째 이미지
- 한 문항에 이미지가 여러 장이면 순번(`_0`, `_1`...)만 다르게, 나머지는 동일하게.
- PNG, JPG, WebP 지원. 파일명은 영문/숫자만 사용해주세요(한글 금지).

## 원본 PDF도 함께 주세요

원본 PDF가 있으면 저희가 검수 화면에서 원본과 나란히 보며 확인할 수 있습니다.
파일명에 과목이 들어가면 자동으로 연결되니 `내과`, `정형외과`처럼 과목명을
파일명에 포함해주세요.

## 체크리스트 (넘기기 전에)

- [ ] `question_number` 가 1부터 연속인지 (중복·누락 확인)
- [ ] `editor_answer` 를 비워뒀는지 (임의로 채우지 않기)
- [ ] `answer_status` 를 `unconfirmed` 로 통일했는지
- [ ] 원본에 없는 캡션이나 설명을 임의로 추가하지 않았는지
- [ ] 이미지 파일명이 문항 번호와 정확히 맞는지
- [ ] JSON 형식이 유효한지 (예: `python -m json.tool 파일.json` 으로 확인 가능)

## 예시 파일

기존에 넘겨주신 세 과목 JSON(`orthopedics_26_exam.json` 등)이 정확히 이 형식입니다.
그대로 참고해서 만들어달라고 전달하시면 됩니다.
