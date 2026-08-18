-- =============================================================================
-- 테마 (주제별 이론 정리)
--
-- 하나의 주제를 이론으로 정리하고, 거기에 관련된 야마를 붙여 나가는 글이다.
-- 4단계에서 본문 중간에 야마를 끼워 넣게 되고, 여기서는 본문까지만 만든다.
--
-- theory_documents 를 재사용하지 않는 이유:
--   그쪽 495건은 Notion 에서 기계적으로 임포트한 미러다(source_key, 폴더 계층).
--   손으로 쓴 편집물을 그 트리에 섞으면 트리가 의미를 잃는다.
--
-- 스터디별로 따로 쓴다. required_permission 을 컬럼으로 둔 덕에 레전드옵세 말고
-- 다른 스터디도 나중에 자기 테마를 만들 수 있다.
-- =============================================================================

create table if not exists public.topics (
  id                  uuid primary key default gen_random_uuid(),
  subject_id          uuid not null references public.subjects(id) on delete cascade,
  -- 대표 단원. 목록에서 어디에 놓을지 정한다.
  unit_id             uuid references public.units(id) on delete set null,
  title               text not null,
  content             jsonb not null
                        default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  required_permission text not null default 'study_legendob'
                        references public.access_permissions(key),
  created_by          uuid references public.profiles(id) on delete set null,
  updated_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.topics is
  '주제별 이론 정리글. 스터디 권한으로 열람·편집 범위를 나눈다.';

create index if not exists topics_subject_idx on public.topics (subject_id);
create index if not exists topics_unit_idx    on public.topics (unit_id);

-- 대표 단원 말고 더 걸치는 단원. "전해질 이상" 처럼 신장내과와 내분비내과
-- 양쪽에 뜨는 편이 나은 주제가 있다.
create table if not exists public.topic_units (
  topic_id uuid not null references public.topics(id) on delete cascade,
  unit_id  uuid not null references public.units(id)  on delete cascade,
  primary key (topic_id, unit_id)
);

comment on table public.topic_units is
  '테마가 걸치는 추가 단원. 대표 단원(topics.unit_id)은 여기 넣지 않는다.';


-- -----------------------------------------------------------------------------
-- 권한
--
-- 위키식이라 열람할 수 있는 사람은 편집도 할 수 있다. 초안/검토 단계는 두지
-- 않고, 되돌리기는 revisions 로 한다.
-- -----------------------------------------------------------------------------
create or replace function public.can_edit_topic(p_permission text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_admin() or public.has_content_access(p_permission);
$$;

comment on function public.can_edit_topic(text) is
  '이 권한이 걸린 테마를 읽고 쓸 수 있는 사람인지. 위키식이라 열람=편집이다.';

alter table public.topics      enable row level security;
alter table public.topic_units enable row level security;

drop policy if exists topics_select on public.topics;
create policy topics_select on public.topics
  for select to authenticated
  using (public.can_edit_topic(required_permission));

drop policy if exists topics_insert on public.topics;
create policy topics_insert on public.topics
  for insert to authenticated
  with check (public.can_edit_topic(required_permission));

drop policy if exists topics_update on public.topics;
create policy topics_update on public.topics
  for update to authenticated
  using (public.can_edit_topic(required_permission))
  with check (public.can_edit_topic(required_permission));

-- 삭제만 좁게 잡는다. 남의 글을 지우는 것은 되돌리기가 아니라 소실이다.
drop policy if exists topics_delete on public.topics;
create policy topics_delete on public.topics
  for delete to authenticated
  using (public.is_admin() or created_by = auth.uid());

drop policy if exists topic_units_select on public.topic_units;
create policy topic_units_select on public.topic_units
  for select to authenticated
  using (exists (
    select 1 from public.topics t
     where t.id = topic_units.topic_id
       and public.can_edit_topic(t.required_permission)
  ));

drop policy if exists topic_units_write on public.topic_units;
create policy topic_units_write on public.topic_units
  for all to authenticated
  using (exists (
    select 1 from public.topics t
     where t.id = topic_units.topic_id
       and public.can_edit_topic(t.required_permission)
  ))
  with check (exists (
    select 1 from public.topics t
     where t.id = topic_units.topic_id
       and public.can_edit_topic(t.required_permission)
  ));


-- -----------------------------------------------------------------------------
-- 갱신 시각과 편집 이력
-- -----------------------------------------------------------------------------
drop trigger if exists topics_set_updated_at on public.topics;
create trigger topics_set_updated_at
  before update on public.topics
  for each row execute function public.set_updated_at();

-- 위키식으로 바로 반영되므로 되돌릴 수단이 있어야 한다. 기존 revisions 를
-- 그대로 쓰면 AdminRevisionsPage 도 그대로 재사용된다.
alter table public.revisions drop constraint if exists revisions_entity_type_check;
alter table public.revisions add constraint revisions_entity_type_check
  check (entity_type in ('question', 'solution', 'topic'));

create or replace function public.record_topic_revision()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d     jsonb := '{}'::jsonb;
  parts text[] := array[]::text[];
begin
  if new.title is distinct from old.title then
    d := d || jsonb_build_object('title', jsonb_build_array(old.title, new.title));
    parts := parts || format('제목 변경 %s → %s', old.title, new.title);
  end if;

  if new.content is distinct from old.content then
    d := d || jsonb_build_object('content', jsonb_build_array(old.content, new.content));
    parts := parts || '본문 수정'::text;
  end if;

  if new.unit_id is distinct from old.unit_id then
    d := d || jsonb_build_object('unit_id', jsonb_build_array(old.unit_id, new.unit_id));
    parts := parts || '대표 단원 변경'::text;
  end if;

  -- 바뀐 게 없으면 이력을 남기지 않는다. updated_at 만 튀는 저장이 흔하다.
  if array_length(parts, 1) is null then
    return null;
  end if;

  insert into public.revisions (entity_type, entity_id, editor_id, diff, change_summary)
  values ('topic', new.id, coalesce(auth.uid(), new.updated_by), d,
          array_to_string(parts, ', '));

  return null;
end;
$$;

drop trigger if exists topics_record_revision on public.topics;
create trigger topics_record_revision
  after update on public.topics
  for each row execute function public.record_topic_revision();
