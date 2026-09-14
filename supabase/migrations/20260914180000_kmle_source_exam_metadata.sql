begin;

alter table public.kmle_sources
  add column if not exists allen_exam text,
  add column if not exists allen_session integer,
  add column if not exists allen_question_number integer,
  add column if not exists allen_label text;

alter table public.kmle_sources
  drop constraint if exists kmle_sources_allen_session_positive,
  add constraint kmle_sources_allen_session_positive
    check (allen_session is null or allen_session > 0),
  drop constraint if exists kmle_sources_allen_question_number_positive,
  add constraint kmle_sources_allen_question_number_positive
    check (allen_question_number is null or allen_question_number > 0);

-- 구버전 JSON도 시험 종류별 묶기에는 쓸 수 있도록 기존 code를 시험명으로 둔다.
-- 교시와 원시험 번호는 새 수집기로 다시 받은 문제에만 정확히 채운다.
update public.kmle_sources
set allen_exam = allen_code
where allen_exam is null and allen_code is not null;

create index if not exists kmle_sources_exam_position_idx
  on public.kmle_sources (allen_exam, allen_session, allen_question_number);

comment on column public.kmle_sources.allen_exam is
  'Allen 문제 화면 제목에서 읽은 원시험 이름. 예: 임종평23-2.';
comment on column public.kmle_sources.allen_session is
  '원시험 교시. 화면 제목에 없으면 null.';
comment on column public.kmle_sources.allen_question_number is
  '원시험에서의 문제 번호. KMLE 문제은행 내부 순번과 별개다.';
comment on column public.kmle_sources.allen_label is
  '화면 제목에서 보존한 전체 원시험 표기. 예: 임종평23-2 2교시, 43번.';

commit;
