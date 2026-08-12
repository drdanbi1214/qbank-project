# 데이터 입력 파이프라인

원본 PDF 를 문제 레코드로 바꾸는 스크립트 모음이다.
완전 자동은 목표가 아니다. 사람이 검수하기 쉬운 중간 결과를 만드는 데 집중하고,
마지막 확인은 웹의 `관리자 > PDF 검수` 화면에서 한다.

## 지금 쓰는 방식 (권장)

문항 본문/보기/정답은 이제 다른 AI 채팅창이 `convert_file/` 에
`DATA_INGESTION_HANDOFF.md` 규칙에 따라 전사 JSON(+ 선택적으로 단원 제안
JSON)으로 직접 만들어 넘겨준다. 아래 1~5단계(`pdf_to_images.py` ~
`parse_source_tags.py`)는 이 흐름에서는 필요 없다 — 사람이 직접 읽고 판단해
만든 JSON이 정규식 기반 자동 파싱보다 정확하기 때문이다.

```bash
# 0. 정답(굵은 보기) 자동 추출 — 절대 눈으로 판단하지 않는다 (아래 "정답 표시는
#    반드시 코드로" 참고)
python3 ../convert_file/extract_bold_answers.py 원본.pdf answers.json

# 1. 이미지를 문항번호에 매핑 (convert_file/map_images_to_questions.py, v2)
python3 ../convert_file/map_images_to_questions.py 원본.pdf ./images 2607 [exam.json]

# 2. DB 반영 (기본은 dry-run — 뭐가 바뀔지만 보여주고 아무것도 안 씀)
python3 ingest_exam.py exam.json --images ./images --units unit_suggestions.json --pdf 원본.pdf

# 확인 후 실제로 반영
python3 ingest_exam.py exam.json --images ./images --units unit_suggestions.json --pdf 원본.pdf --apply
```

`ingest_exam.py` 는 같은 시험을 다시 넣어도 안전하다. 편집자가 이미 검토한
답/단원은 덮어쓰지 않고, 원문 전사 내용(본문/보기/야마답)만 최신화한다.
자세한 동작은 스크립트 상단 docstring 참고.

### 정답 표시는 반드시 코드로 (`extract_bold_answers.py`)

과거에 렌더링된 PDF 페이지를 사람(AI)이 눈으로 보고 "이 문항은 정답 표시가
없다"고 판단했다가, 실제로는 60문항 중 7문항에서 굵은 글씨를 놓친 사고가
있었다. 원인은 시각 판단 자체의 신뢰도 문제였다 — 인접한 문항의 굵은 글씨는
잘 잡으면서도 특정 문항에서만 놓치는 식이라 패턴도 없었다.

PDF는 폰트 메타데이터(굵은 글씨 비트, 폰트명)를 그대로 갖고 있으므로 코드로
읽으면 100% 객관적으로 판별된다. `extract_bold_answers.py` 가 이 방식을
구현한다. **전사 작업에서 `yama_answer` 를 채울 때는 반드시 이 스크립트
결과를 우선 신뢰**하고, 스크립트가 빈 배열(`[]`)을 준 문항만 사람이 원본을
다시 봐서 "진짜로 표시가 없는지" 확인한다 (진짜로 없는 경우도 있다 — 정답
표시 없이 문제만 있는 문항은 실제로 존재한다).

## 예전 방식 (1단계 로컬 파싱 파이프라인, 지금은 잘 안 씀)

## 준비

```bash
cd scripts
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # SUPABASE_URL, SUPABASE_SERVICE_KEY 채우기
```

`SUPABASE_SERVICE_KEY` 는 service_role 키다. RLS 를 우회하므로 절대 저장소나
브라우저에 넣지 않는다. 이 폴더의 `.env` 는 `.gitignore` 로 막아두었다.

## 실행 순서

```bash
# 1. PDF 를 페이지 이미지로 (눈으로 훑거나 다른 도구에 넘길 때)
python pdf_to_images.py 원본.pdf out/pages

# 2. 텍스트 레이어에서 문항 분할
python parse_questions.py 원본.pdf out/questions.json

# 3. 문항 번호에 이미지 매핑
python extract_images.py 원본.pdf out/images 2601

# 4. 답지에서 정답 후보 추출
python detect_answers.py 원본.pdf out/answers.json

# 5. 출처 태그 (21Y, 22Y 변형) 추출
python parse_source_tags.py out/questions.json --in-place

# 6. 모아서 업로드
python upload_to_supabase.py out/questions.json --exam-id <uuid> \
    --images out/images --answers out/answers.json
```

각 단계는 결과를 파일로 남긴다. 중간에 손으로 고친 뒤 다음 단계를 이어서
돌릴 수 있게 하려는 것이다.

## 실제 자료로 재본 정확도

2026 학년말고사 세 과목(내과, 정형외과, 영상의학과) 답지로 확인했다.

| 단계 | 결과 |
|---|---|
| 문항 분할 | 영상의학과 49문항을 정확히 잘라냈다 |
| 이미지 매핑 | 36장 추출, 문항 번호는 파일명으로 확인 |
| 정답 추출 | 150문항 중 142개 일치, 오탐 3, 미검출 5 |

`detect_answers.py` 는 기본이 `--mode bold` 다. 이 학교 답지는 정답 보기를
굵은 글씨로 쓰기 때문이다. 노란 형광을 쓰는 답지라면 `--mode highlight`,
둘 다 섞였으면 `--mode both` 를 준다.

## 한계

- **2단 편집 가정.** 1단 PDF 는 `parse_questions.py --single-column` 을 준다.
- **텍스트 레이어 필요.** 스캔본처럼 이미지만 있는 PDF 는 글자를 못 읽는다.
  이 경우 이미지만 뽑고 본문은 검수 화면에서 직접 입력한다.
- **표와 검사 수치.** 본문의 표나 랩 수치는 텍스트로만 나온다.
  블록 구조로 만들려면 검수 화면에서 손봐야 한다.
- **정답 추출은 후보일 뿐이다.** 업로드는 `yama_answer` 에만 넣고
  `editor_answer` 는 비워둔다. 편집자가 검토하며 확정한다.

## 파일명 규칙

모든 스크립트 파일명은 영문 ASCII 다. 코드 안의 한글 문구는 무방하다.
