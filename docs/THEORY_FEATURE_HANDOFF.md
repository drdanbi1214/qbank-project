# 이론 보기 기능 인수인계

최종 기록: 2026-08-13

## 목표

문제 풀이와 별도로 과목별 이론을 읽는 독립 페이지를 운영한다. 이론은 한 과목에
여러 문서를 둘 수 있고, 필요하면 특정 단원과 연결한다. 향후 AI가 작성한 HTML과
이미지를 파일 묶음으로 받아 일괄 등록한다.

## 현재 완료된 작업

커밋 `4e39af2`에서 아래 기반을 운영 환경에 배포했다.

- PC 상단 메뉴의 `이론 보기` 탭
- 모바일 하단 메뉴의 `이론` 탭
- 학습 사이드바 과목 행의 `[이론] [Q n/n]` 배치
- `/theory`: 과목별 이론 문서 개수와 진입 링크
- `/theory/:subjectId`: 해당 과목 이론 목차와 첫 문서
- `/theory/:subjectId/:documentId`: 선택한 이론 문서
- `theory_documents` 테이블
- `theory-images` 비공개 Storage 버킷
- `study_hapbon3` 권한 기반 문서 및 이미지 RLS

현재 운영 DB의 이론 문서는 0개다. 따라서 화면에는 `이론 0개` 또는
`아직 등록된 이론이 없습니다`가 정상적으로 표시된다.

### 현재 DB 구조

`theory_documents` 주요 컬럼:

- `subject_id`: 필수 과목
- `unit_id`: 선택 단원. 과목 공통 문서는 `null`
- `title`: 문서 제목
- `content`: RichDoc JSON
- `sort_order`: 과목 내 목차 순서
- `required_permission`: 기본값 `study_hapbon3`
- `is_published`: 공개 여부. 기본값 `false`
- `created_by`, `created_at`, `updated_at`

관련 코드:

- `src/pages/TheoryIndexPage.tsx`
- `src/pages/TheorySubjectPage.tsx`
- `src/lib/queries/theory.ts`
- `supabase/migrations/20260813180000_theory_documents.sql`

## 합의한 이론 자료 전달 형식

HTML 원문을 브라우저에 그대로 삽입하지 않는다. 입력기가 HTML을 읽어 위험한
요소를 제거하고, 사이트의 RichDoc JSON으로 변환해 저장한다. 이미지는 별도
파일로 받아 `theory-images`에 올린다.

```text
theory_delivery/
├── manifest.csv
├── html/
│   ├── 01-001.html
│   ├── 01-002.html
│   └── 07-001.html
└── images/
    ├── 01-001-01.png
    ├── 01-001-02.webp
    └── 07-001-01.jpg
```

`manifest.csv` 형식:

```csv
subject_code,unit_name,title,sort_order,html_file
01,,내과 총론,1,01-001.html
01,순환기내과,심부전,2,01-002.html
07,골절,골절 치유 과정,1,07-001.html
```

- `subject_code`: 현재 과목 코드 `01`~`09`
- `unit_name`: 과목 공통 문서는 빈 값
- `title`: 화면과 목차에 표시할 제목
- `sort_order`: 과목 안에서 표시할 순서
- `html_file`: `html/` 안의 파일명

HTML의 이미지는 다음처럼 상대경로로 참조한다.

```html
<img src="../images/01-001-01.png" alt="심부전 진단 흐름도">
```

지원 대상:

- `h1`~`h4`, `p`, 굵게, 기울임, 밑줄
- `ul`, `ol`, `blockquote`
- 표
- 이미지
- 안전한 링크
- 코드 블록과 수식 표기

반드시 제거할 대상:

- `script`, `iframe`, `form`
- 버튼과 입력 요소
- `onclick`, `onload` 같은 이벤트 속성
- 외부 CSS 및 임의 JavaScript
- 허용 목록 밖의 URL 스킴과 과도한 인라인 스타일

이미지는 base64나 외부 URL보다 별도 파일 전달을 우선한다. 허용 형식은 PNG,
JPG/JPEG, WEBP, GIF이며 파일당 최대 10MB다.

## 다음 작업

### 1. HTML 일괄 입력기

`scripts/import_theory_html.py`를 만든다.

- 기본 실행은 dry-run
- `--apply`에서만 DB와 Storage 변경
- manifest 필수 컬럼, 과목 코드, 단원명, 중복 문서 검사
- HTML 파싱 및 허용 목록 기반 정제
- HTML을 RichDoc JSON으로 변환
- 이미지 존재 여부와 MIME/크기 검사
- 이미지를 `theory-images/import/<batch>/...`에 업로드
- 본문에는 만료 URL이 아닌 `theory-images/<path>` 저장
- 동일 문서 재입력 시 갱신할 안정적인 식별 규칙 결정
- 일부 실패 시 DB만 반영되거나 고아 이미지가 남지 않도록 사전 검사를 모두 끝낸
  뒤 쓰기 시작

Python 의존성 후보는 `beautifulsoup4`, `bleach`, `requests`다. 실제 구현 전에
현재 `scripts/requirements.txt`와 배포 환경을 확인한다.

### 2. 관리자 이론 관리 화면

- 관리자 메뉴에 `이론 관리` 추가
- 과목/단원, 제목, 순서, 공개 여부 입력
- 기존 RichTextEditor 재사용
- 이미지 업로드는 `theory-images` 버킷 전용 함수 사용
- 미리보기, 수정, 삭제
- 초안은 관리자만 보이고 `is_published=true` 문서만 학습자에게 표시

### 3. 입력 규칙 확정이 필요한 부분

구현 시작 전에 아래만 최종 결정한다.

- 같은 문서를 재입력할 때의 키: 별도 `document_code` 추가 권장
- HTML 수식 표기: LaTeX 구분자 또는 별도 태그 규칙
- 과목 이론 목차를 단원별로 자동 그룹화할지 여부
- 관리자 화면을 먼저 만들지, 일괄 입력기를 먼저 만들지

권장 순서는 `document_code 컬럼 추가 → HTML 일괄 입력기 → 실제 자료 1과목
시험 입력 → 화면 검수 → 관리자 편집 화면`이다.

## 주의사항

- HTML 문자열을 `dangerouslySetInnerHTML`로 직접 출력하지 않는다.
- `service_role` 키를 브라우저, CSV, HTML 또는 Git에 넣지 않는다.
- 권한 없는 사용자에게는 메뉴뿐 아니라 DB/Storage에서도 내용이 노출되면 안 된다.
- 원격 Supabase 마이그레이션 이력에 과거 타임스탬프 불일치가 있으므로 전체
  `supabase db push`를 무작정 실행하지 않는다. 새 마이그레이션을 검증해 선택적으로
  적용하고 이력을 기록한다.
