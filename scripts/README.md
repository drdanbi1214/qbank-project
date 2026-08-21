# 데이터 입력 파이프라인

원본 PDF 를 문제 레코드로 바꾸는 스크립트 모음이다.
완전 자동은 목표가 아니다. 사람이 검수하기 쉬운 중간 결과를 만드는 데 집중하고,
마지막 확인은 웹의 `관리자 > PDF 검수` 화면에서 한다.

## 스토리지 provider

DB에는 실제 URL이 아니라 `버킷/경로`만 저장한다. 관리 스크립트의 업로드 대상은
`scripts/.env`의 `OBJECT_STORAGE_PROVIDER`로 선택한다.

```env
# 전체 R2 복사·검증 전에는 반드시 supabase
OBJECT_STORAGE_PROVIDER=supabase
R2_BUCKET_NAME=qbank-storage
R2_ACCOUNT_ID=<Cloudflare account id>
```

R2 API 키는 저장소나 `.env`에 넣지 않고 macOS 키체인에 저장한다.

```bash
security add-generic-password -U -a qbank-project \
  -s qbank-project-r2-access-key-id -w '<R2 access key id>'
security add-generic-password -U -a qbank-project \
  -s qbank-project-r2-secret-access-key -w '<R2 secret access key>'
```

이전 도구는 기본 dry-run이며 Supabase 원본을 삭제하는 기능이 없다.

```bash
# 가장 작은 버킷 확인
python3 scripts/migrate_storage_to_r2.py --bucket topic-images

# R2 계정 설정 후 복사 + R2 재다운로드 SHA-256 검증
python3 scripts/migrate_storage_to_r2.py --bucket topic-images --apply --verify
```

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

## AI 풀이 일괄 입력 (`import_ai_solutions.py`)

`AI 풀이 탭` 권한이 체크된 사용자에게만 보이는 별도 풀이 트랙
(`ai_solutions` 테이블)에 CSV로 한 번에 넣는다. 권한이 없는 사용자에게는
탭과 데이터가 모두 노출되지 않는다.

```bash
# 확인만 (기본값 dry-run)
python3 scripts/import_ai_solutions.py ai_solutions.csv --images ./ai_images

# 실제 반영
python3 scripts/import_ai_solutions.py ai_solutions.csv --images ./ai_images --apply
```

이미지 파일만 별도 전달된 경우에는 파일명을 `문제코드-순번.확장자`
(`2607044-01.jpg`) 형식으로 맞춘 뒤 아래처럼 넣을 수 있다. 기존 AI 풀이의
본문은 보존하고 이미지 블록만 새 전달본으로 교체한다. 파일명으로 번호를
추정하지 않으므로, 반영 전에는 반드시 실제 DB 문제의 발문과 이미지 내용을
표본 대조한다.

```bash
# 기본은 dry-run
python3 scripts/import_ai_solutions.py --images ./ai_images --images-only

# 실제 반영
python3 scripts/import_ai_solutions.py --images ./ai_images --images-only --apply
```

새 전달본에서 의도적으로 빠진 기존 이미지를 제거해야 할 때만, 검증한
문제코드를 명시해서 `--prune-image-codes 2601013,2601018`처럼 사용한다.

CSV는 `question_code,content` 두 컬럼(헤더 포함, UTF-8)이다.
`question_code` 는 학번2자리+과목코드2자리+문항번호3자리 7자리 코드다
(예: `2607044` = 26학번 정형외과 44번).

`content` 안에서 빈 줄은 문단 구분, 단독 줄바꿈은 그대로 줄바꿈이 된다.
제목을 굵게 보이게 할 부분은 `<제목>제목 내용</제목>`, 출처·가이드라인 등의
근거를 작고 회색으로 보이게 할 부분은 `<근거>근거 내용</근거>`로 쓴다. 긴
내용이면 시작 태그와 닫는 태그 사이에 여러 줄을 써도 된다. 이 두 태그는
이미지 표기와 마찬가지로 AI 풀이 CSV에서만 쓰는 전용 서식이다.
이미지를 넣을 자리에는 그 줄만 단독으로 `[[img:파일명.png]]` 라고 적고,
`--images` 로 준 폴더에 같은 파일명으로 이미지를 넣어둔다 (하위 폴더 없이
평평하게). 지원 형식은 PNG, JPG/JPEG, WEBP, GIF이고 파일명에 `/`나 `\`를
넣으면 안 된다. `scripts/ai_solutions_example.csv`를 복사해 시작하면 된다.

전달할 때는 CSV와 이미지 폴더를 아래처럼 한 폴더로 묶으면 된다.

```text
ai_solution_delivery/
├── ai_solutions.csv
└── ai_images/
    ├── 2607044-01.png
    └── 2607045-chart.jpg
```

CSV의 이미지 표기는 실제 파일명과 대소문자까지 같아야 한다. 이미지가 없는
풀이에는 `[[img:...]]` 줄을 넣지 않으면 되고 `--images`도 생략할 수 있다.

같은 문제코드로 다시 돌리면 그 문제의 AI 풀이를 덮어쓴다.

같은 CSV 형식으로 선배해설을 넣을 때는 `--kind senior`를 붙인다. AI 풀이와
선배해설은 별도 테이블과 별도 권한으로 관리되므로 같은 문제에 둘 다 넣을 수 있다.

```bash
python3 scripts/import_ai_solutions.py senior_solutions.csv --kind senior
python3 scripts/import_ai_solutions.py senior_solutions.csv --kind senior --images ./senior_images --apply
```

## 예전 방식 (1단계 로컬 파싱 파이프라인, 지금은 잘 안 씀)

## 준비

```bash
cd scripts
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # SUPABASE_URL만 채우기
```

운영용 `sb_secret_…` 키는 macOS 키체인의 서비스
`qbank-project-supabase-secret`, 계정 `qbank-project`에 저장한다. 스크립트는
키체인을 우선 사용한다. CI나 macOS가 아닌 환경에서는
`SUPABASE_SECRET_KEY` 환경변수로만 주입한다. secret 키는 RLS를 우회하므로
브라우저·저장소·명령행 인자에 넣지 않는다.

## Notion 이론 일괄 등록 (`import_notion_theory.py`)

Notion에서 `Markdown & CSV`로 내보낸 ZIP을 과목별 이론 목차로 등록한다.
대분류는 목차 그룹으로 만들고, 본문이 있는 세부 페이지에만 사이트의 `이론 보기`
버튼이 표시된다. 내보낸 ZIP 안의 로컬 이미지와 외부 이미지도 QBank의 비공개
이미지 저장소로 복사한다.

```bash
# 먼저 구조만 확인 (DB 변경 없음)
python3 scripts/import_notion_theory.py "신경과 신경외과.zip" --subject-code 06

# 실제 등록
python3 scripts/import_notion_theory.py "신경과 신경외과.zip" --subject-code 06 --apply

# 내과 안에 순환기 부속 목차를 만들어 등록
python3 scripts/import_notion_theory.py "순환기 이론.zip" --subject-code 01 --section "순환기" --apply
```

같은 Notion ZIP을 다시 등록해도 원본 경로를 기준으로 같은 문서를 갱신한다.

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
