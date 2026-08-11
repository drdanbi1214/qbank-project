-- =============================================================================
-- 기출문제 풀이 플랫폼 — 핵심 스키마
-- 사용자/권한, 분류 체계(과목-단원), 시험, 문제, R형 세트, 중복 그룹
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- 공통 헬퍼
-- -----------------------------------------------------------------------------

-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2.1 사용자 및 권한
-- -----------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  cohort       text,                                    -- 사용자 본인 학번 ('20학번')
  role         text not null default 'member' check (role in ('admin', 'member')),
  is_suspended boolean not null default false,          -- true 면 모든 쓰기 차단
  avatar_url   text,
  theme        text not null default 'system' check (theme in ('light', 'dark', 'system')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 관리자 판별. RLS 재귀를 피하기 위해 SECURITY DEFINER 로 profiles 를 조회한다.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 쓰기 가능 여부. 로그인 상태이고 정지되지 않은 사용자만 true.
create or replace function public.can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_suspended = false
  );
$$;

-- 신규 가입 시 프로필 자동 생성.
-- 폐쇄형 플랫폼이므로 is_suspended = true (승인 대기) 상태로 만들고,
-- 관리자가 사용자 관리 화면에서 해제하면 쓰기가 열린다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, is_suspended)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 2.2 분류 체계 (과목 -> 단원, 2단계만)
-- -----------------------------------------------------------------------------

create table public.subjects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,                      -- '정신건강의학과', '외과'
  icon_key   text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subjects_sort_idx on public.subjects (sort_order, name);

create trigger subjects_set_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

create table public.units (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name       text not null,                             -- '조현병', '기분장애', '간담췌'
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, name)
);

create index units_subject_idx on public.units (subject_id, sort_order, name);

create trigger units_set_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2.3 시험
-- -----------------------------------------------------------------------------

create table public.exams (
  id                 uuid primary key default gen_random_uuid(),
  cohort             text not null,                     -- '20학번'
  subject_id         uuid not null references public.subjects(id) on delete restrict,
  exam_name          text not null default '학년말고사',
  exam_date          date,
  duration_min       int check (duration_min is null or duration_min > 0),
  format             text check (format is null or format in ('CBT', 'PBT')),
  total_questions    int check (total_questions is null or total_questions >= 0),
  restored_questions int check (restored_questions is null or restored_questions >= 0),
  overview           text,                              -- 총평 원문
  source_file_url    text,                              -- 원본 PDF Storage 경로
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (cohort, subject_id, exam_name)
);

create index exams_cohort_idx on public.exams (cohort);
create index exams_subject_idx on public.exams (subject_id);

create trigger exams_set_updated_at
  before update on public.exams
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2.7 R형(확장결합형) 세트
-- -----------------------------------------------------------------------------

create table public.question_sets (
  id             uuid primary key default gen_random_uuid(),
  exam_id        uuid not null references public.exams(id) on delete cascade,
  set_title      text,                                  -- '다음 보기에서 고르시오'
  instruction    text,
  shared_choices jsonb not null default '[]'::jsonb      -- [{ "key": "A", "text": "..." }, ...]
    check (jsonb_typeof(shared_choices) = 'array'),
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index question_sets_exam_idx on public.question_sets (exam_id, sort_order);

create trigger question_sets_set_updated_at
  before update on public.question_sets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2.8 중복 문제 그룹
-- canonical_question_id 는 questions 생성 이후 FK 를 붙인다 (상호 참조).
-- -----------------------------------------------------------------------------

create table public.question_groups (
  id                    uuid primary key default gen_random_uuid(),
  canonical_question_id uuid,
  note                  text,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger question_groups_set_updated_at
  before update on public.question_groups
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- stem_blocks 에서 평문을 추출하는 IMMUTABLE 함수.
-- 검색(4.7)과 중복 후보 자동 탐지(2.8)의 생성 컬럼에 사용한다.
-- 블록 타입: text | labbox | table | image | formula
-- -----------------------------------------------------------------------------

create or replace function public.stem_plain_text(blocks jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    string_agg(
      case b ->> 'type'
        when 'text'    then b ->> 'content'
        when 'formula' then b ->> 'latex'
        when 'image'   then b ->> 'caption'
        when 'labbox'  then (
          select string_agg(concat_ws(' ', i ->> 'label', i ->> 'value'), ' ')
          from jsonb_array_elements(
            case when jsonb_typeof(b -> 'items') = 'array' then b -> 'items' else '[]'::jsonb end
          ) as i
        )
        when 'table'   then concat_ws(' ',
          (
            select string_agg(h #>> '{}', ' ')
            from jsonb_array_elements(
              case when jsonb_typeof(b -> 'headers') = 'array' then b -> 'headers' else '[]'::jsonb end
            ) as h
          ),
          (
            select string_agg(
              (
                select string_agg(c #>> '{}', ' ')
                from jsonb_array_elements(
                  case when jsonb_typeof(r) = 'array' then r else '[]'::jsonb end
                ) as c
              ), ' ')
            from jsonb_array_elements(
              case when jsonb_typeof(b -> 'rows') = 'array' then b -> 'rows' else '[]'::jsonb end
            ) as r
          )
        )
      end, ' ' order by ord
    ),
    ''
  )
  from jsonb_array_elements(
    case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end
  ) with ordinality as t(b, ord);
$$;

-- 중복 탐지용 정규화: 공백/특수문자/숫자 제거 후 소문자화
create or replace function public.normalize_stem(blocks jsonb)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(public.stem_plain_text(blocks)), '[^가-힣a-z]', '', 'g');
$$;

-- -----------------------------------------------------------------------------
-- 2.4 문제 (핵심 테이블)
-- -----------------------------------------------------------------------------

create table public.questions (
  id              uuid primary key default gen_random_uuid(),
  exam_id         uuid not null references public.exams(id) on delete cascade,
  unit_id         uuid references public.units(id) on delete set null,   -- 라벨링 전 NULL 허용
  question_number int not null,
  question_type   text not null default 'A' check (question_type in ('A', 'R', 'essay')),
  set_id          uuid references public.question_sets(id) on delete set null,

  stem_blocks     jsonb not null default '[]'::jsonb check (jsonb_typeof(stem_blocks) = 'array'),
  choices         jsonb not null default '[]'::jsonb check (jsonb_typeof(choices) = 'array'),
  answer_count    int not null default 1 check (answer_count >= 1),

  -- 정답 관련 컬럼. 미제출 상태 노출 방지를 위해 컬럼 단위 SELECT 권한을 회수한다(20260810120400).
  editor_answer   int[] not null default '{}'::int[],   -- 채점 기준 정답
  yama_answer     int[],                                -- 복기 당시 통용 답
  answer_status   text not null default 'unconfirmed'
    check (answer_status in ('confirmed', 'unconfirmed', 'disputed')),
  answer_note     text,

  official_explanation jsonb check (official_explanation is null or jsonb_typeof(official_explanation) = 'array'),
  model_answer         text,
  grading_points       jsonb check (grading_points is null or jsonb_typeof(grading_points) = 'array'),

  professor     text,
  restorer_note text,
  source_tags   text[] not null default '{}'::text[],   -- ['22Y']
  variant_type  text not null default 'original'
    check (variant_type in ('original', 'identical', 'modified')),

  group_id     uuid references public.question_groups(id) on delete set null,
  completeness text not null default 'complete'
    check (completeness in ('complete', 'partial_choices', 'partial_stem', 'image_missing')),
  status       text not null default 'published' check (status in ('draft', 'published')),

  view_count int not null default 0,

  -- 검색 / 중복 탐지용 생성 컬럼
  stem_text text generated always as (public.stem_plain_text(stem_blocks)) stored,
  stem_norm text generated always as (public.normalize_stem(stem_blocks)) stored,

  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (exam_id, question_number)
);

create index questions_exam_idx on public.questions (exam_id, question_number);
create index questions_unit_idx on public.questions (unit_id);
create index questions_set_idx on public.questions (set_id);
create index questions_group_idx on public.questions (group_id);
create index questions_unlabeled_idx on public.questions (created_at) where unit_id is null;
create index questions_stem_text_trgm_idx on public.questions using gin (stem_text extensions.gin_trgm_ops);
create index questions_stem_norm_trgm_idx on public.questions using gin (stem_norm extensions.gin_trgm_ops);
create index questions_source_tags_idx on public.questions using gin (source_tags);

create trigger questions_set_updated_at
  before update on public.questions
  for each row execute function public.set_updated_at();

-- 상호 참조 FK 마감
alter table public.question_groups
  add constraint question_groups_canonical_fk
  foreign key (canonical_question_id) references public.questions(id) on delete set null;

create index question_groups_canonical_idx on public.question_groups (canonical_question_id);
