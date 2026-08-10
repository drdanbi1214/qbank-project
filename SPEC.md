# 의대 기출문제 풀이 플랫폼 — 프로젝트 전체 스펙

이 문서는 Claude Code에 전달하는 초기 구축 지시서다. 아래 명세를 기준으로 프로젝트를 처음부터 구축한다.

---

## 0. 프로젝트 개요

한양대학교 의과대학 본과 학년말고사 기출문제를 데이터베이스화하고, 정해진 그룹의 학생들이 함께 풀이를 작성/검토하며 학습하는 폐쇄형 웹 플랫폼.

**핵심 특징**
- 기출문제는 오픈소스(자유 이용 가능)이나, 풀이 작성 그룹이 정해져 있어 **로그인 필수 폐쇄형**
- 문제 등록/편집은 별도 승인 절차 없이 로그인 사용자가 직접 수행(위키형), 대신 전체 편집 이력 추적 및 되돌리기 지원
- 한 문제에 담당자가 배정되어 풀이를 작성하고, 다른 사용자가 인라인 코멘트로 질의응답
- 웹/모바일 반응형. 편집 작업은 주로 웹, 문제풀이는 양쪽 모두 최적화

**기술 스택 (고정)**
- Frontend: React 19 + TypeScript + Vite
- Styling: Tailwind CSS
- Backend: Supabase (PostgreSQL, Auth, Storage, Realtime, RLS)
- Deployment: Vercel
- Rich text editor: Tiptap (인라인 코멘트, 이미지 붙여넣기, 수식 지원 때문에 필수)
- 수식: KaTeX
- 차트: Recharts

---

## 1. 도메인 용어 정의

| 용어 | 의미 |
|---|---|
| 학번(cohort) | `20학번`, `21학번` 형태. 연도 대신 시험 구분의 기준으로 사용 |
| 시험(exam) | `20학번 정신건강의학과 학년말고사` 처럼 학번+과목 단위. 과목당 학번당 1개 |
| 과목(subject) | 정신건강의학과, 외과, 내과 등. 최상위 분류 |
| 단원(unit) | 과목 하위 분류. 2단계 계층만 사용 (과목 → 단원) |
| 야마답(yama_answer) | 복기 당시 학생들 사이에서 통용되던 답 |
| 편집자답(editor_answer) | 편집자가 검토 후 확정한 답. **채점은 항상 이 값 기준** |
| 복기(restoration) | 시험 후 학생들이 기억으로 문제를 복원한 것 |
| 담당자(assignee) | 특정 문제의 풀이 작성을 배정받은 사용자 |
| 풀이(solution) | 공개 해설. 모든 사용자가 열람 |
| 개인노트(personal note) | 본인만 보는 메모 |

---

## 2. 데이터베이스 스키마

Supabase 마이그레이션 SQL로 작성한다. 모든 테이블에 `created_at timestamptz default now()`, 수정 가능한 테이블에는 `updated_at` 포함.

### 2.1 사용자 및 권한

```sql
-- Supabase auth.users 확장
profiles
  id uuid PK (auth.users.id 참조)
  email text
  display_name text
  cohort text                    -- 사용자 본인 학번
  role text                      -- 'admin' | 'member'
  is_suspended boolean default false
  avatar_url text
  created_at timestamptz
```

- 신규 가입은 관리자가 발급한 초대 또는 이메일 도메인 제한으로 통제(초기에는 수동 승인 방식으로 구현)
- `is_suspended = true`인 사용자는 로그인은 되나 모든 쓰기 작업 차단

### 2.2 분류 체계

```sql
subjects
  id uuid PK
  name text                      -- '정신건강의학과', '외과'
  icon_key text                  -- 아이콘 식별자
  sort_order int

units
  id uuid PK
  subject_id uuid FK
  name text                      -- '조현병', '기분장애', '간담췌'
  sort_order int
  UNIQUE(subject_id, name)
```

### 2.3 시험

```sql
exams
  id uuid PK
  cohort text                    -- '20학번'
  subject_id uuid FK
  exam_name text                 -- '학년말고사' (기본값, 확장 대비)
  exam_date date                 -- 231030 형태를 date로
  duration_min int               -- 60
  format text                    -- 'CBT' | 'PBT'
  total_questions int            -- 50 (실제 출제 문항 수)
  restored_questions int         -- 50 (복기된 문항 수)
  overview text                  -- 총평 원문 ("교수님들께서 전반적으로...")
  source_file_url text           -- 원본 PDF Storage 경로
  created_by uuid FK
  UNIQUE(cohort, subject_id, exam_name)
```

표시명은 `{cohort} {subject.name} {exam_name}` 로 조합. 예: `20학번 정신건강의학과 학년말고사`

### 2.4 문제 (핵심 테이블)

```sql
questions
  id uuid PK
  exam_id uuid FK
  unit_id uuid FK NULL           -- 라벨링 전에는 NULL 허용
  question_number int            -- 시험지상 문항 번호
  question_type text             -- 'A' | 'R' | 'essay'
  set_id uuid FK NULL            -- R형일 때 question_sets 참조

  stem_blocks jsonb              -- 아래 2.5 참조
  choices jsonb                  -- 아래 2.6 참조
  answer_count int default 1     -- 정답 개수. 2 이상이면 체크박스 UI

  editor_answer int[]            -- 채점 기준 정답 (복수 가능)
  yama_answer int[] NULL         -- 복기 당시 통용 답
  answer_status text             -- 'confirmed' | 'unconfirmed' | 'disputed'
  answer_note text NULL          -- 편집자답이 야마답과 다른 이유

  official_explanation jsonb NULL -- 원본 해설이 있는 경우 (stem_blocks와 동일 구조)
  model_answer text NULL          -- 서술형 모범답안
  grading_points jsonb NULL       -- 서술형 채점 포인트 배열

  professor text NULL             -- 출제 교수 (총평에서 파악되는 경우)
  restorer_note text NULL         -- 복기자 주석 ("선지 옆에 영어도 같이 줌", "짤야마")
  source_tags text[]              -- ['22Y'], ['19Y'] 등 원본에 표기된 재출제 태그
  variant_type text               -- 'original' | 'identical' | 'modified'

  group_id uuid FK NULL           -- 중복문제 그룹
  completeness text               -- 'complete' | 'partial_choices' | 'partial_stem' | 'image_missing'
  status text                     -- 'draft' | 'published'

  created_by uuid FK
  updated_by uuid FK
  created_at, updated_at
```

### 2.5 stem_blocks 구조

문제 본문은 텍스트/표/이미지/랩박스가 임의 순서로 섞이므로 **순서를 보존하는 블록 배열**로 저장한다. 단일 텍스트 필드로 저장하지 말 것.

```json
[
  { "type": "text",  "content": "68세 남자가 최근 수일 사이에 숨참이 심해져..." },
  { "type": "labbox", "items": [
      { "label": "WBC", "value": "15,000" },
      { "label": "Hb", "value": "14.7" },
      { "label": "AST", "value": "62" }
    ]},
  { "type": "table", "headers": ["인구군", "유병률(%)"],
    "rows": [["일반인구", "1.0"], ["조현병 환자의 형제", "8.0"]] },
  { "type": "image", "url": "storage/path.webp", "caption": "그림 1: 흉부 X선" },
  { "type": "formula", "latex": "PaCO_2 = 32" }
]
```

블록 타입: `text`, `labbox`, `table`, `image`, `formula`

### 2.6 choices 구조

보기는 개수가 가변(3~5개, 복기 불완전 시 1개)이고, 텍스트 대신 이미지인 경우도 있다.

```json
[
  { "no": 1, "text": "비강 캐뉼라를 통한 산소보조요법", "image_url": null },
  { "no": 2, "text": null, "image_url": "storage/choice2.webp" },
  { "no": 3, "text": "전결장절제술(total colectomy) 및\n회장루 조성술(ileostomy)", "image_url": null }
]
```

보기 개수는 배열 길이로 판단. 하드코딩된 5개 가정 금지.

### 2.7 R형(확장결합형) 세트

```sql
question_sets
  id uuid PK
  exam_id uuid FK
  set_title text                 -- '다음 보기에서 고르시오'
  instruction text
  shared_choices jsonb           -- [{ "key": "A", "text": "..." }, ...] 최대 10개 이상 가능
  sort_order int
```

- 세트에 속한 문항은 `questions.set_id`로 연결
- UI: 공통 선지를 상단 sticky 영역에 고정, 하위 문항 순차 표시
- 진행률 계산 시 세트 내 각 문항을 1문제로 카운트

### 2.8 중복 문제 그룹

동일 문제가 여러 학번 시험에 반복 출제되므로, **풀이는 그룹 단위로 공유하고 풀이 기록은 개별 문제 단위로 유지**한다.

```sql
question_groups
  id uuid PK
  canonical_question_id uuid FK  -- 대표 문제
  note text
  created_by uuid FK
```

- `solutions`, `personal_notes`, `discussions`는 **group_id 기준**으로 연결 (그룹 없으면 question_id 단독)
- `attempts`, `bookmarks`는 **question_id 기준** 유지
- 문제 화면에 "이 문제는 19학번, 22학번 시험에도 동일 출제됨" 표시
- 이미 그룹 내 다른 문제를 풀었으면 "동일 문제를 이미 푸셨습니다" 안내 (재풀이는 허용)
- 자동 후보 탐지: 등록 시 stem 텍스트 정규화(공백/특수문자/숫자 제거) 후 유사도 비교, 85% 이상이면 "그룹 후보" 제안. 최종 확정은 사용자가 클릭
- `source_tags`에 `22Y` 같은 태그가 파싱되면 해당 학번 시험의 문제를 자동으로 그룹 후보로 제시

### 2.9 풀이 및 노트

```sql
solutions
  id uuid PK
  group_id uuid NULL             -- 그룹 있으면 그룹, 없으면 question_id
  question_id uuid NULL
  author_id uuid FK
  content jsonb                  -- Tiptap JSON (이미지, 표, 수식 포함)
  references jsonb NULL          -- [{ "label": "심인성쇼크, 급성폐부종", "url": "..." }]
  is_verified boolean default false
  upvote_count int default 0
  created_at, updated_at
  edited_at timestamptz NULL     -- 최초 작성 후 수정된 경우에만 기록

solution_upvotes
  solution_id uuid FK
  user_id uuid FK
  PRIMARY KEY(solution_id, user_id)

personal_notes
  id uuid PK
  group_id uuid NULL
  question_id uuid NULL
  user_id uuid FK
  content jsonb
  updated_at
  UNIQUE(user_id, COALESCE(group_id, question_id))

drafts                           -- 작성 중 임시저장 (풀이/노트/게시판 공용)
  id uuid PK
  user_id uuid FK
  target_type text               -- 'solution' | 'note' | 'discussion'
  target_key text                -- question_id 또는 group_id
  content jsonb
  updated_at
```

**풀이 수정 표시**: `edited_at`이 존재하면 풀이 하단에 아주 작은 회색 글씨로 `수정됨 · 2026.08.10 14:23` 표시. 클릭하면 버전 히스토리 모달.

**풀이 작성 기본 템플릿**: 새 풀이 작성 시 에디터에 아래 섹션 스켈레톤을 미리 삽입 (사용자가 지우고 자유 작성 가능)
```
1. 한줄요약
2. 출제 Point
3. 정답 해설
4. 실전 Tip
```

### 2.10 인라인 코멘트 (드래그 지정 코멘트)

```sql
inline_comments
  id uuid PK
  solution_id uuid FK
  parent_id uuid FK NULL         -- 대댓글
  author_id uuid FK
  selected_text text             -- 드래그한 원문 (표시용)
  anchor_from int                -- Tiptap 문서 내 위치
  anchor_to int
  content text
  status text                    -- 'open' | 'resolved'
  resolved_by uuid FK NULL
  created_at
```

- Tiptap의 Mark 확장으로 구현. 드래그 → 팝오버 → 코멘트 입력 → 본문에 하이라이트
- 우측(모바일은 하단 시트)에 코멘트 목록 패널, 클릭 시 해당 위치로 스크롤
- 코멘트 달리면 풀이 작성자에게 알림
- `resolved` 처리 시 하이라이트 해제 및 목록에서 접힘
- **모바일에서는 새 코멘트 작성은 롱프레스로 지원하되, 열람/답글은 완전 지원**

### 2.11 게시판 (문의/논의)

```sql
discussions
  id uuid PK
  question_id uuid FK NULL       -- 문제 연결 (일반글은 NULL)
  author_id uuid FK
  category text                  -- '정답이의' | '해설질문' | '단원분류' | '복기오류' | '일반'
  title text
  content jsonb
  confusion_point text           -- "헷갈리는 이유" 별도 입력 필드
  status text                    -- 'open' | 'resolved'
  resolved_by uuid FK NULL
  view_count int default 0
  created_at, updated_at

discussion_replies
  id uuid PK
  discussion_id uuid FK
  parent_id uuid FK NULL         -- 대댓글 (2단계까지만 허용)
  author_id uuid FK
  content jsonb                  -- 텍스트 + 이미지 첨부 가능
  is_accepted boolean default false
  upvote_count int default 0
  is_deleted boolean default false  -- 대댓글이 달린 댓글은 물리삭제 대신 '삭제된 댓글입니다' 표시
  created_at, updated_at

discussion_upvotes
  discussion_id uuid FK
  user_id uuid FK
  PRIMARY KEY(discussion_id, user_id)

reply_upvotes
  reply_id uuid FK
  user_id uuid FK
  PRIMARY KEY(reply_id, user_id)

discussion_bookmarks
  discussion_id uuid FK
  user_id uuid FK
  PRIMARY KEY(discussion_id, user_id)
```

`discussions`에 `upvote_count int default 0`, `reply_count int default 0` 캐시 컬럼 추가. 트리거로 갱신.

- 문제 화면 상단 아이콘바에 **[게시판에 문의하기]** 버튼 → 클릭 시 해당 문제가 자동 첨부된 글쓰기 폼. `confusion_point` 입력란이 상단에 별도 배치
- 문제 화면에 관련 스레드 수 뱃지 표시 (`💬 3`)
- 답변/채택 시 질문자에게 알림
- 논의 결과 정답 변경 시, 편집자가 `editor_answer` 수정하면 revision에 `게시판 논의 #ID 반영` 자동 기록

### 2.12 정답 투표 (미확정 문제용)

```sql
answer_votes
  question_id uuid FK
  user_id uuid FK
  voted_answer int[]
  reason text NULL
  PRIMARY KEY(question_id, user_id)
```

`answer_status = 'unconfirmed'`인 문제에서 "다른 사람들은 뭘 골랐나" 집계 표시.

### 2.13 학습 기록

```sql
attempts
  id uuid PK
  question_id uuid FK            -- 그룹 아님, 개별 문제
  user_id uuid FK
  selected_answer int[]
  is_correct boolean
  self_grade text NULL           -- 서술형: 'correct' | 'partial' | 'wrong'
  time_spent_sec int
  attempt_number int             -- 같은 문제 N회차
  is_active boolean default true -- 초기화 시 false 처리 (기록은 보존)
  created_at

bookmarks
  question_id uuid FK
  user_id uuid FK
  PRIMARY KEY(question_id, user_id)

study_sessions                   -- 이어풀기 / 블록테스트
  id uuid PK
  user_id uuid FK
  mode text                      -- 'sequential' | 'block_test' | 'wrong_only' | 'bookmark'
  scope jsonb                    -- { subject_id, unit_ids, exam_ids, cohorts }
  question_ids uuid[]            -- 세션에 포함된 문제 순서
  current_index int
  time_limit_sec int NULL
  started_at, finished_at NULL
  status text                    -- 'in_progress' | 'completed' | 'abandoned'
```

**초기화 기능**: 과목/단원 단위로 "안 푼 상태로 되돌리기" 버튼. 실제 삭제가 아니라 해당 범위 `attempts.is_active = false` 처리. 진행률/오답노트는 `is_active = true`만 집계. 기록 자체는 보존되므로 "총 누적 풀이 횟수"는 유지됨.

### 2.14 배정 (담당자 분배)

```sql
assignments
  id uuid PK
  question_id uuid FK
  assignee_id uuid FK
  assigned_by uuid FK
  status text                    -- 'pending' | 'in_progress' | 'done'
  due_date date NULL
  created_at, completed_at NULL
```

- 담당자가 해당 문제에 풀이를 작성하면 자동으로 `done` 처리
- 배정 시 담당자에게 알림
- 관리자 화면에서 담당자별 진행률(완료/전체) 집계

### 2.15 편집 이력

```sql
revisions
  id uuid PK
  entity_type text               -- 'question' | 'solution'
  entity_id uuid
  editor_id uuid FK
  diff jsonb                     -- 변경 전/후 필드 스냅샷
  change_summary text            -- '단원 이동: 조현병 → 기분장애', '편집자답 변경 ③→②'
  created_at
```

- 문제/풀이의 모든 수정 시 자동 기록
- 되돌리기(revert) 지원
- **최근 변경 피드** 화면: 전체 변경 이력을 시간순으로. 승인 절차는 없고 사후 확인용

### 2.16 알림

```sql
notifications
  id uuid PK
  user_id uuid FK                -- 수신자
  type text
  -- 'solution_comment' | 'inline_comment' | 'comment_reply' | 'mention'
  -- | 'solution_upvote' | 'assignment' | 'comment_resolved'
  -- | 'discussion_reply' | 'answer_accepted' | 'announcement'
  actor_id uuid FK NULL          -- 행위자
  target_type text
  target_id uuid
  message text
  is_read boolean default false
  created_at
```

Supabase Realtime으로 실시간 수신. 헤더 종 아이콘에 미읽음 뱃지.

### 2.17 공지사항 / 신고

```sql
announcements
  id uuid PK
  author_id uuid FK
  title text
  content jsonb
  is_pinned boolean default false
  created_at, updated_at

reports
  id uuid PK
  reporter_id uuid FK
  target_type text               -- 'question' | 'solution' | 'comment' | 'discussion'
  target_id uuid
  reason text
  status text                    -- 'pending' | 'in_progress' | 'resolved'
  handled_by uuid FK NULL
  created_at
```

---

## 3. RLS 정책

- 모든 테이블 RLS 활성화. **비로그인 사용자는 어떤 데이터도 조회 불가**
- `profiles.is_suspended = true`인 사용자는 모든 INSERT/UPDATE/DELETE 차단
- `personal_notes`, `attempts`, `bookmarks`, `drafts`, `notifications`: 본인 행만 SELECT/UPDATE/DELETE
- `questions`, `solutions`: 로그인 사용자 누구나 SELECT/INSERT/UPDATE. DELETE는 작성자 또는 admin
- `announcements`: SELECT는 전체, 쓰기는 admin만
- `assignments`: SELECT는 전체, 쓰기는 admin만
- `revisions`: SELECT 전체, INSERT는 트리거로만
- 관리자 판별은 `profiles.role = 'admin'` 을 확인하는 SECURITY DEFINER 함수로 처리 (RLS 재귀 방지)

---

## 4. 화면 명세

### 4.1 공통 레이아웃

**웹 (≥1024px)**
- 상단 헤더: 로고, 메인 네비게이션, 알림 종, 프로필
- 메인 네비: `학습하기` / `시험별` / `오답노트` / `게시판` / `공지사항` / (admin) `관리자`
- 학습 화면은 좌측 사이드바(과목→단원 트리) + 우측 콘텐츠

**모바일 (<768px)**
- 하단 탭바: 학습 / 오답노트 / 게시판 / 알림 / 내정보
- 사이드바는 드로어로 전환
- 문제풀이 화면의 `정답 확인` 버튼은 하단 sticky 고정
- 편집 기능(문제 등록, 일괄 업로드, 검수 화면)은 웹 전용. 모바일 접근 시 "PC에서 이용해주세요" 안내

**다크모드** 지원. Tailwind `dark:` 클래스 기반, 토글 상태는 localStorage 아닌 Supabase profiles에 저장(기기 간 동기화).

### 4.2 홈 / 학습하기

- 과목 아이콘 그리드 (알렌의서재 스타일 카드형)
- 각 과목 카드에 전체 진행률 표시
- 과목 클릭 → 단원 목록. 단원마다 `Q 15/117` 형태 진행률 뱃지 + 정답률
- 단원 클릭 → 해당 단원 문제 목록 또는 바로 풀이 시작
- 상단에 `이어풀기` 버튼 (마지막 study_session 재개)
- 각 과목/단원 우측에 `⋯` 메뉴 → `진행 초기화`

### 4.3 시험별 보기

- 학번 → 과목 순으로 목록. 예: `20학번` 아래 `정신건강의학과 학년말고사 (50/50 복기)`
- 시험 상세: 총평(overview) 표시, 문항 목록, 진행률
- 시험 단위 블록테스트 시작 버튼 (제한시간 = `duration_min`)

### 4.4 문제풀이 화면 (핵심)

**상단 바**
- 좌측: 단원명, `10번 [20학번 정신과] 👁 조회수`
- 우측 아이콘: 나가기 / 이전·다음 / 스킵 / 북마크 / 개인노트 / 게시판에 문의하기 / 신고 / `정답 확인` 버튼
- 문제 진행 표시 `10 / 50`

**본문**
- `stem_blocks` 순서대로 렌더링 (텍스트 → 랩박스 → 표 → 이미지 → 수식)
- 이미지: 클릭 시 확대 모달(핀치줌/휠줌). 여러 장이면 썸네일 갤러리 + 캡션
- `restorer_note`가 있으면 본문 하단에 작은 회색 글씨로 표시
- `completeness != 'complete'`면 상단에 배지: `보기 일부만 복기됨` 등

**보기**
- `answer_count == 1` → 라디오, `>= 2` → 체크박스 + "정답 N개를 고르세요" 안내
- 보기가 이미지면 이미지 카드로 렌더링
- 미제출 상태에서는 정답 힌트가 절대 노출되지 않아야 함

**정답 확인 후**
- 각 보기 옆에 뱃지 표시:
  - 야마답에만 포함 → `(Y답)`
  - 편집자답에만 포함 → `(편집자답)`
  - 둘 다 → `(Y답/편집자답)`
- 채점은 **`editor_answer` 기준**
- 야마답 ≠ 편집자답인 경우, 해설 상단에 경고 배너:
  `야마답과 편집자 판단이 다릅니다` + `answer_note` 내용 + 관련 게시판 스레드 링크
- `answer_status = 'unconfirmed'`면 `정답 미확정` 배지 + 정답 투표 UI + 투표 분포
- 통계 바: `정답률 40%` / `누적 풀이 횟수 700+` / `평균 풀이 시간 56초 / 나의 풀이 시간 6초`
- 보기별 선택 비율(%) 표시
- 동일 문제 그룹 안내: `이 문제는 19학번, 22학번에도 동일 출제됨`

**해설 영역 (탭)**
1. `풀이` — 공개 풀이 목록. 추천순/최신순 정렬, 베스트 상단 고정. 각 풀이에 작성자, 추천 버튼, `수정됨 · 날짜` 표시, 인라인 코멘트 하이라이트
2. `내 노트` — 개인 메모 (본인만)
3. `게시판` — 이 문제 관련 스레드 목록

**풀이 본문 하단 고정 섹션** (탭과 무관하게 풀이 탭 아래에 항상 표시)
- `관련 이론 및 Reference` — 풀이 작성자가 참고 링크나 관련 단원을 걸어둘 수 있는 영역. 링크 목록 형태
- `커뮤니티 Q&A` — 4.8 (1) 참조

**서술형 문제**
- 답안 입력란 → `모범답안 보기` → 자가채점 버튼(맞음/부분/틀림) → attempts에 `self_grade` 저장

**R형 문제**
- 공통 선지를 상단 sticky 영역에 고정, 하위 문항 순차 표시

### 4.5 풀이 작성 에디터 (Tiptap)

- **이미지 클립보드 붙여넣기**: Ctrl+V로 이미지 바로 삽입 → Supabase Storage 자동 업로드 → 업로드 중 플레이스홀더 표시. 드래그앤드롭도 지원
- 표 삽입, 코드블록, 굵게/기울임/하이라이트
- **수식**: `$...$` 인라인, `$$...$$` 블록 → KaTeX 렌더링
- 5초 debounce 자동 임시저장 → `drafts` 테이블. 새로고침 시 복구 안내
- 새 풀이 작성 시 4단계 섹션 스켈레톤 자동 삽입
- 저장 시 `edited_at` 갱신 및 revision 기록

### 4.6 오답노트

- 필터: 과목 / 단원 / 학번 / 시험
- 정렬: 최근 오답순 / 반복 오답순
- `최근 3회 시도 모두 오답`인 문제는 별도 강조 표시
- 바로 재풀이 세션 시작 버튼
- PDF / Excel 내보내기

### 4.7 검색

- 상단 검색바. 범위 토글: `문제만` / `문제 + 풀이`
- PostgreSQL full-text search 사용. 한국어 형태소 분석기 없으므로 `pg_trgm` 기반 유사도 검색 병행
- 결과에 매칭 부분 하이라이트, 과목/단원/학번 필터 사이드바

### 4.8 게시판 (커뮤니티 Q&A)

게시판은 **두 개의 진입 경로**를 가진다. 두 경로 모두 동일한 상세 뷰 컴포넌트를 재사용한다.

#### (1) 문제 화면 하단 임베드 목록

문제풀이 화면에서 해설 영역 맨 아래에 `커뮤니티 Q&A` 섹션을 배치한다.

**레이아웃**
```
커뮤니티 Q&A                                    [게시글 작성하기]
위 문제와 관련된 게시글이에요.
────────────────────────────────────────────────────
산소 공급 방법
산소 공급 방법에 대해서 거의 몰라서 질문드립니다 해설에서 이뇨제가...
조회수 63 | 댓글 2 | 추천수 0              네놈이왕족을능멸하는가 | 26.08.01
────────────────────────────────────────────────────
솔직히 코에 걸면 코걸이 귀에 걸면 귀걸이
산소랑 furosemide 둘다 주면 되는거지 같이 적용 못하는 것도 아니고
조회수 358 | 댓글 1 | 추천수 1                      저공빡대갈 | 26.06.22
────────────────────────────────────────────────────
```

- 제목은 굵게 한 줄, 본문 미리보기는 회색 한 줄 말줄임(`line-clamp-1`)
- 메타는 좌측에 `조회수 N | 댓글 N | 추천수 N`, 우측에 `작성자 | YY.MM.DD`
- 구분선은 항목 사이에만
- 기본 5개까지 노출, 더 있으면 하단에 `더보기` 링크
- 글이 없으면 `아직 등록된 게시글이 없어요` 안내 + 작성 버튼만
- 우측 상단 `게시글 작성하기` 버튼 클릭 시 해당 문제가 자동 첨부된 작성 폼 열림

#### (2) 목록에서 상세로 진입하는 2단 구조

**웹 (≥1024px)** — 목록 항목을 선택하면 우측 패널에 상세가 열리는 마스터-디테일 구조로 구현한다. 페이지 전체가 이동하지 않고 우측만 교체되므로 문제 컨텍스트를 잃지 않는다.

```
┌──────────────────────┬─────────────────────────────┐
│ 좌: 게시글 목록        │ 우: 선택한 게시글 상세        │
│ (문제 하단 또는        │ (본문 + 추천 + 댓글 + 대댓글) │
│  게시판 탭)           │                             │
└──────────────────────┴─────────────────────────────┘
```
- 선택된 항목은 좌측에서 하이라이트 유지
- 우측 패널은 독립 스크롤
- 우측 패널 최상단에 `< 돌아가기` (모바일에서만 노출, 웹에서는 목록이 계속 보이므로 생략 가능)

**모바일 (<768px)** — 목록 → 상세 전체 화면 전환. 상단에 `< 돌아가기`.

#### (3) 게시글 상세 뷰 명세

위에서 아래 순서로 배치한다.

**헤더**
- `< 돌아가기`
- 단원명 (작은 회색 글씨, 예: `순환기`)
- 제목 (큰 굵은 글씨)
- 우측 정렬 아이콘: 북마크(`discussion_bookmarks` 토글), `⋮` 메뉴(수정/삭제/신고 — 본인 글이면 수정·삭제, 타인 글이면 신고만)
- 메타 한 줄: `작성자 | 조회 359 | 26.06.22`
- 구분선

**연결된 문제 카드**
```
┌────────────────────────────────────────────────┐
│ [문제] 심인성 쇼크, 급성 폐부종 / 68세 남자가 최근  │  [문제보기]
│        수일 사이에 숨참이 심해져 응급실로 왔다. 수… │
└────────────────────────────────────────────────┘
```
- `[문제]` 파란 테두리 배지
- `단원명 / stem 첫 텍스트 블록` 을 한 줄 말줄임으로 표시
- 우측 `문제보기` 버튼 → 해당 문제 화면으로 이동 (웹에서는 좌측 패널에 문제를 띄우거나 새 탭)
- `question_id`가 NULL인 일반글이면 이 카드 자체를 렌더링하지 않음

**본문**
- Tiptap JSON 렌더링. 이미지, 표, 수식 포함
- `confusion_point`(헷갈리는 이유)가 입력된 글은 본문 위에 연한 배경 박스로 강조 표시

**추천 버튼**
- 본문 아래 **가운데 정렬**, 외곽선 버튼 형태로 `👍 추천 1`
- 이미 추천했으면 채워진 스타일로 토글 표시
- 본인 글은 추천 불가

**댓글 작성 영역**
- 소제목 `댓글 쓰기`
- textarea, placeholder: `명예훼손, 무단광고, 불법정보 유포 시 삭제 될 수 있습니다.`
- 좌측 하단에 이미지 첨부 아이콘 → 클릭 업로드 및 **클립보드 붙여넣기(Ctrl+V) 모두 지원**
- 우측 하단에 파란 `등록` 버튼
- 임시저장 대상에 포함 (`drafts.target_type = 'discussion'`)

**댓글 목록**
- 소제목 `댓글 N개`
- 각 댓글 항목:
  - 좌측: 작성자(굵게) | 날짜
  - 우측: `👍 추천 0`, `⋮` 메뉴(수정/삭제/신고)
  - 아래 줄에 본문
  - 우측 하단에 `답글 쓰기` 링크
- `답글 쓰기` 클릭 → 해당 댓글 바로 아래에 입력창 인라인 확장 (별도 페이지 이동 없음)
- 대댓글은 좌측 들여쓰기 + 연한 배경으로 구분. **깊이는 2단계까지만** 허용 (대댓글에 또 대댓글 불가, 대신 멘션으로 처리)
- 대댓글이 달린 댓글을 삭제하면 물리삭제 대신 `삭제된 댓글입니다` 로 대체하여 스레드 구조 유지
- 질문 작성자는 댓글에 `답변 채택` 버튼 노출. 채택된 댓글은 상단 고정 + 초록 배지 `채택된 답변`, 글 상태가 `resolved`로 전환
- 댓글 작성 시 원글 작성자에게 알림, 대댓글 작성 시 부모 댓글 작성자에게 알림

**하단**
- 가운데 정렬 `목록` 버튼

#### (4) 게시판 전용 탭 (문제와 무관한 전체 목록)

- 상단 카테고리 탭: `전체` / `정답이의` / `해설질문` / `단원분류` / `복기오류` / `일반`
- 필터: 상태(전체/미해결/해결됨), 과목, 학번, `문제 연결된 글만`
- 정렬: 최신순 / 추천순 / 댓글많은순 / 조회순
- 목록 항목 형식은 (1)의 임베드 목록과 동일한 컴포넌트 재사용
- 선택 시 (2)의 2단 구조로 우측에 상세 표시

#### (5) 조회수 처리

- 상세 진입 시 `view_count` 증가. 동일 사용자의 중복 카운트를 막기 위해 세션 단위로 1회만 반영

### 4.9 마이페이지

- 전체 진행률, 과목별/단원별 정답률 차트 (Recharts)
- 약점 단원 Top 5
- 내가 쓴 풀이 목록, 받은 추천 수
- 내게 배정된 문제 목록 + 진행률
- 학습 스트릭(연속 학습일)

### 4.10 관리자 모드

1. **문제 관리**
   - 문제 등록/수정/삭제 (단건)
   - CSV/Excel 일괄 업로드
   - **PDF 검수 화면 (최우선 구현)**: 좌측에 원본 PDF 페이지 이미지, 우측에 파싱된 문제 폼. 나란히 놓고 수정. 이 화면이 데이터 입력 생산성을 좌우함
   - 단원 라벨링 대기 큐 (`unit_id IS NULL`인 문제만 모아서 빠르게 태깅)
   - 중복 그룹 관리 (그룹 생성/해제, 대표문제 지정, 자동 후보 검토)
2. **사용자 관리**: 목록, 계정 정지/해제, admin 권한 부여/회수
3. **배정 관리**: 문제 일괄 배정(단원/시험 단위로 선택 → 담당자 지정), 담당자별 진행률 테이블, 마감 지난 미완료 목록
4. **신고 처리함**
5. **최근 변경 피드**: 전체 revision 시간순 목록, 되돌리기
6. **통계 대시보드**: 가입자 수, 일별 활성 사용자, 문제별 정답률, 미확정 정답 문제 수

### 4.11 공지사항

별도 탭. 관리자만 작성, 고정글 지원. 새 공지 등록 시 전체 사용자에게 알림.

---

## 5. 데이터 입력 파이프라인 (`/scripts` 폴더, 별도 작업)

원본이 PDF이고 텍스트 레이어가 있는 페이지와 이미지로만 된 페이지가 혼재한다.

1. `pdf_to_images.py` — PDF를 페이지별 PNG로 변환
2. `parse_questions.py` — 텍스트 레이어에서 `^\d+\.` 정규식으로 문항 분할. 보기는 `①~⑤` 기호로 분리
3. `extract_images.py` — 페이지 내 이미지 영역 추출, 문항 번호 매핑 (반자동: 이미지 보여주고 번호 입력받는 CLI)
4. `detect_answers.py` — 노란 하이라이트 배경 픽셀 감지로 정답 후보 추출. 실패 시 `answer_status = 'unconfirmed'`로 등록
5. `parse_source_tags.py` — `\((\d{2})Y( 변형)?\)` 패턴 추출 → `source_tags`, `variant_type` 설정
6. `upload_to_supabase.py` — 이미지 WebP 변환 후 Storage 업로드, 레코드 삽입

**규칙**: 모든 스크립트 파일명은 영문/ASCII만 사용. 코드 내 한글 라벨은 무방.

---

## 6. 프로젝트 구조

```
/
├─ src/
│  ├─ components/
│  │  ├─ question/       QuestionView, StemBlocks, ChoiceList, AnswerBadges, StatsBar
│  │  ├─ solution/       SolutionEditor, SolutionList, InlineCommentPanel
│  │  ├─ discussion/     DiscussionList, DiscussionDetail, DiscussionMasterDetail,
│  │  │                  LinkedQuestionCard, CommentThread, CommentComposer
│  │  ├─ admin/          PdfReviewer, LabelingQueue, GroupManager, UserTable, AssignmentBoard
│  │  ├─ layout/         Header, Sidebar, MobileTabBar
│  │  └─ ui/             공용 버튼, 모달, 배지 등
│  ├─ pages/
│  ├─ lib/               supabase client, queries, hooks
│  ├─ types/             DB 타입 (supabase gen types로 생성)
│  └─ utils/
├─ supabase/
│  └─ migrations/
├─ scripts/              데이터 입력 파이프라인 (Python)
└─ .env.local
```

---

## 7. 구현 순서

**Phase 1 — 기반**
1. Vite + React 19 + TS + Tailwind 프로젝트 초기화
2. Supabase 프로젝트 연결, 전체 스키마 마이그레이션 작성 및 적용
3. RLS 정책 전체 작성
4. `supabase gen types typescript` 로 타입 생성
5. Auth (이메일 로그인 + 관리자 수동 승인), 라우팅, 레이아웃 셸(웹/모바일 반응형, 다크모드)

**Phase 2 — 문제풀이 코어**
6. 더미 데이터로 QuestionView 구현 (stem_blocks 전 타입 렌더링, 가변 보기 개수, 복수정답)
7. 정답 확인 로직 + 야마답/편집자답 뱃지 + 통계 바
8. attempts 기록, 진행률 계산
9. 과목/단원 트리 네비게이션, 시험별 보기

**Phase 3 — 협업**
10. Tiptap 에디터 (이미지 붙여넣기, 수식, 임시저장)
11. 풀이 CRUD, 추천, 수정 타임스탬프, 버전 히스토리
12. 인라인 드래그 코멘트
13. 게시판, 알림 시스템

**Phase 4 — 학습 도구**
14. 오답노트, 북마크, 개인노트
15. 블록테스트, 이어풀기, 초기화
16. 검색, 마이페이지 통계

**Phase 5 — 관리자 및 데이터**
17. 관리자 모드 전체
18. PDF 검수 화면
19. 데이터 입력 스크립트, 실제 기출 등록

---

## 8. 반드시 지킬 규칙

- 보기 개수를 5개로 하드코딩하지 않는다. 항상 배열 길이 기준
- 정답은 항상 배열로 다룬다. 단일 정답도 길이 1 배열
- 채점 기준은 `editor_answer`이며 `yama_answer`로 채점하지 않는다
- 미제출 상태에서 정답 정보가 DOM이나 네트워크 응답에 노출되지 않도록 한다 (정답은 제출 시점에 별도 요청 또는 RLS로 분리)
- 풀이/노트/게시판 연결은 그룹이 있으면 `group_id`, 없으면 `question_id` 기준. 두 경우 모두 동작해야 한다
- 진행 초기화는 물리 삭제가 아니라 `is_active = false`
- 단원 이동은 승인 없이 즉시 반영하되 반드시 revision 기록
- 모든 스크립트 파일명은 영문 ASCII
- 댓글 깊이는 2단계까지만 허용한다. 무한 중첩 금지
- 대댓글이 달린 댓글은 물리삭제하지 않고 `is_deleted` 플래그로 처리한다
- 게시글 목록 항목 렌더링은 문제 하단 임베드와 게시판 탭에서 **동일 컴포넌트를 재사용**한다. 중복 구현 금지
- 중간점(·) 문자를 UI 텍스트나 코드에 사용하지 않는다. 쉼표나 줄바꿈 사용
