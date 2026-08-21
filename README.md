# 의대 기출문제 풀이 플랫폼

한양대학교 의과대학 본과 학년말고사 기출문제를 데이터베이스화하고, 정해진 그룹의 학생들이
함께 풀이를 작성하고 검토하는 폐쇄형 웹 플랫폼입니다.

전체 명세는 [SPEC.md](SPEC.md)를 참고하세요.

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Backend | Supabase (PostgreSQL, Auth, Realtime, RLS) |
| Object Storage | Cloudflare R2 + private Worker gateway (Supabase temporary fallback) |
| Routing | React Router v7 |
| Deployment | Vercel |

## 시작하기

```bash
npm install
npm run dev
```

`.env.local` 에 아래 값이 필요합니다. Supabase URL에는 `/rest/v1` 같은 경로를
붙이지 않습니다. 브라우저에는 신형 publishable key만 넣고 secret key는 넣지 않습니다.

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
VITE_STORAGE_PROVIDER=r2
VITE_R2_GATEWAY_URL=https://<worker-name>.<account>.workers.dev
VITE_STORAGE_READ_FALLBACK=true
VITE_STORAGE_UPLOAD_FALLBACK=false
```

## 명령어

| 명령어 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 검사 후 프로덕션 빌드 |
| `npm run lint` | ESLint |
| `npm run db:push` | `supabase/migrations` 를 연결된 프로젝트에 적용 |
| `npm run gen:types` | DB 스키마에서 `src/types/database.ts` 재생성 |
| `npm run typecheck:worker` | R2 gateway Worker 타입 검사 |
| `npm run worker:deploy` | R2 gateway Worker 배포 |
| `npm run worker:tail` | R2 gateway 실시간 오류 확인 |

## 비공개 파일 저장소

DB에는 실제 URL이 아니라 `버킷/경로`만 저장한다. 브라우저는 Supabase JWT로
Worker에 권한 확인을 요청하고, 허용된 객체에 대해서만 5분짜리 읽기 URL을 받는다.
R2 자격 증명과 관리용 migration secret은 브라우저 번들에 포함하지 않는다.

운영 데이터는 2026-08-21 기준 9개 버킷, 3,348개, 373.2 MiB를 R2로 복사하고
재다운로드 SHA-256 전수 검증했다. 실제 인증 업로드·서명·전체/Range 읽기 E2E
검증 뒤에는 신규 파일이 두 저장소로 갈라지지 않도록 업로드 fallback을 끄고, 기존
파일 표시를 위한 읽기 fallback과 Supabase 원본만 보존한다. 원본 삭제는 별도 백업과
실제 로그인 화면 검증을 마치기 전에는 수행하지 않는다. 상세 절차는
[Worker 운영 문서](cloudflare/storage-worker/README.md)를 참고한다.

Supabase 사본은 `20260821183000_freeze_supabase_storage_backup.sql`에서 일반
사용자의 Storage 쓰기 정책을 제거하고, restrictive INSERT/UPDATE/DELETE 거부
정책으로 고정한 읽기 전용 스냅샷이다. 브라우저의 서명 읽기는 유지되고, 명시적인
복구 작업에 사용하는 `service_role`만 RLS 우회 권한을 유지한다.

## 데이터베이스

마이그레이션은 `supabase/migrations` 에 있고 순서대로 적용됩니다.

| 파일 | 내용 |
|---|---|
| `..._core_schema.sql` | profiles, subjects, units, exams, question_sets, question_groups, questions |
| `..._content_tables.sql` | solutions, personal_notes, drafts, inline_comments, discussions, answer_votes |
| `..._learning_admin.sql` | attempts, bookmarks, study_sessions, assignments, revisions, notifications, announcements, reports |
| `..._functions_triggers.sql` | 추천수/댓글수 캐시, 댓글 깊이 제한, 편집 이력 자동 기록, 배정 자동 완료, 알림 |
| `..._answer_exposure_and_rpcs.sql` | 정답 비노출 처리, 채점 및 통계 RPC |
| `..._rls_policies.sql` | 전체 테이블 RLS |
| `..._storage_buckets.sql` | Storage 버킷 및 정책 |
| `..._harden_function_privileges.sql` | 함수 search_path 고정, RPC 노출 범위 정리 |

### 정답 비노출 설계

"미제출 상태에서 정답이 DOM 이나 네트워크 응답에 노출되지 않는다"는 규칙을 DB 권한으로 강제합니다.

- `questions` 의 `editor_answer`, `yama_answer`, `answer_note`, `official_explanation`,
  `model_answer`, `grading_points` 는 `authenticated` 역할의 SELECT 권한이 회수되어 있습니다.
- 문제 풀이 화면은 `questions_solve` 뷰에서 읽습니다. 이 뷰에는 정답 컬럼이 없습니다.
- 채점은 `submit_attempt()` RPC 가 서버에서 수행하고, 그 응답에만 정답이 포함됩니다.
  채점 기준은 언제나 `editor_answer` 이며 `yama_answer` 로는 채점하지 않습니다.
- 정답 확인이나 스킵 시에는 `reveal_answer()`, 편집 화면은 `get_question_for_edit()` 를 씁니다.

### 주요 RPC

| 함수 | 용도 |
|---|---|
| `submit_attempt(question_id, selected, time_spent_sec, self_grade)` | 채점, 기록, 정답과 통계 반환 |
| `reveal_answer(question_id)` | 정답 확인 및 스킵 시 정답 공개 |
| `get_question_for_edit(question_id)` | 편집 화면용 전체 행 |
| `get_question_stats(question_id)` | 정답률, 누적 풀이 횟수, 평균 풀이 시간, 보기별 선택 분포 |
| `find_similar_questions(question_id, threshold)` | 중복 문제 그룹 후보 탐지 |
| `reset_progress(subject_id, unit_id, exam_id)` | 진행 초기화 (`attempts.is_active = false`, 기록은 보존) |
| `admin_set_suspended(user_id, suspended)` | 계정 승인 및 정지 |
| `admin_set_role(user_id, role)` | 관리자 권한 부여 및 회수 |

## 데모 데이터

실제 기출이 들어오기 전까지 화면 확인용 샘플이 들어 있습니다.
모든 stem 블록 타입과 문제 유형(A형, R형, 서술형), 정답 상태, 중복 그룹을 덮습니다.

- 적용: `supabase/seed_demo.sql`
- 제거: `supabase/seed_demo_rollback.sql`

실제 데이터를 넣기 전에 rollback 스크립트로 지우세요.

## 풀이 화면 표시 규칙

- 정답으로 확정된 보기는 하늘색, 내가 고른 오답은 분홍색으로 칠합니다.
- 정답 확인 후 각 보기에 `(Y답)`, `(편집자답)`, `(Y답/편집자답)` 뱃지를 붙입니다.
- 누적 풀이 횟수는 **내 계정 기준**으로 표시합니다. 전체 정답률과 평균 풀이 시간은
  집계는 유지하되 풀이 화면에는 노출하지 않습니다(마이페이지와 관리자 통계에서 사용).
- 보기별 선택 비율은 전체 사용자 기준입니다.

## 계정 승인

폐쇄형 서비스라 신규 가입은 관리자 승인이 필요합니다.

- 가입하면 `profiles.is_suspended = true` 상태로 생성되어 로그인은 되지만 모든 쓰기가 막힙니다.
- 관리자가 `admin_set_suspended(user_id, false)` 로 승인합니다.
- **첫 관리자**는 승인해줄 사람이 없으므로 Supabase SQL Editor 에서 직접 지정합니다.

```sql
update public.profiles
   set role = 'admin', is_suspended = false
 where email = '<본인 이메일>';
```

## 진행 상황

- [x] **Phase 1 기반** — 프로젝트 초기화, 전체 스키마, RLS, 타입 생성, Auth, 라우팅, 레이아웃 셸
- [x] **Phase 2 문제풀이 코어** — QuestionView, 정답 확인, attempts 기록, 진행률, 과목/단원 트리, 시험별 보기
- [ ] Phase 3 협업 (Tiptap, 인라인 코멘트, 게시판, 알림)
- [ ] Phase 4 학습 도구 (오답노트, 블록테스트, 검색, 통계)
- [ ] Phase 5 관리자 및 데이터 입력 파이프라인
