# 데이터 입력 파이프라인

원본 PDF 를 문제 레코드로 바꾸는 스크립트 모음이다.
완전 자동은 목표가 아니다. 사람이 검수하기 쉬운 중간 결과를 만드는 데 집중하고,
마지막 확인은 웹의 `관리자 > PDF 검수` 화면에서 한다.

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
