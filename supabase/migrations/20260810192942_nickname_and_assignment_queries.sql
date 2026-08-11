-- =============================================================================
-- 닉네임(display_name) 을 공개 표시용 식별자로 승격
-- 풀이, 댓글, 배정 등 모든 화면에서 작성자를 이 값으로 표시한다.
-- =============================================================================

update public.profiles
   set display_name = split_part(coalesce(email, 'user'), '@', 1)
 where display_name is null or btrim(display_name) = '';

-- 대소문자 무시 중복은 뒤에 번호를 붙여 해소한다.
with dup as (
  select id,
         row_number() over (partition by lower(display_name) order by created_at) as rn
    from public.profiles
)
update public.profiles p
   set display_name = p.display_name || '-' || dup.rn
  from dup
 where p.id = dup.id and dup.rn > 1;

alter table public.profiles
  alter column display_name set not null,
  add constraint profiles_display_name_length
    check (char_length(btrim(display_name)) between 2 and 20);

create unique index profiles_display_name_lower_key
  on public.profiles (lower(display_name));

-- 가입 시 닉네임 저장. 중복이면 뒤에 번호를 붙여 가입 자체가 실패하지 않게 한다.
-- (클라이언트에서 미리 중복 검사를 하므로 실제로는 거의 걸리지 않는 안전장치)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base_name text;
  candidate text;
  suffix    int := 1;
begin
  base_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if base_name = '' then
    base_name := split_part(coalesce(new.email, 'user'), '@', 1);
  end if;
  base_name := left(base_name, 20);
  if char_length(base_name) < 2 then
    base_name := base_name || '00';
  end if;

  candidate := base_name;
  while exists (select 1 from public.profiles where lower(display_name) = lower(candidate)) loop
    suffix := suffix + 1;
    candidate := left(base_name, 17) || '-' || suffix;
  end loop;

  insert into public.profiles (id, email, display_name, is_suspended)
  values (new.id, new.email, candidate, true)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 가입 화면에서 닉네임 사용 가능 여부 확인 (비로그인 상태에서 호출)
create or replace function public.is_display_name_available(p_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select char_length(btrim(p_name)) between 2 and 20
     and not exists (
       select 1 from public.profiles where lower(display_name) = lower(btrim(p_name))
     );
$$;

revoke execute on function public.is_display_name_available(text) from public;
grant execute on function public.is_display_name_available(text) to anon, authenticated;

-- =============================================================================
-- 배정 조회
-- =============================================================================

create or replace function public.get_my_assignments()
returns table (
  assignment_id   uuid,
  question_id     uuid,
  status          text,
  due_date        date,
  completed_at    timestamptz,
  subject_id      uuid,
  subject_name    text,
  unit_id         uuid,
  unit_name       text,
  exam_id         uuid,
  cohort          text,
  exam_name       text,
  question_number int,
  question_type   text,
  stem_preview    text,
  has_my_solution boolean
)
language sql stable security definer set search_path = public
as $$
  select a.id,
         q.id,
         a.status,
         a.due_date,
         a.completed_at,
         e.subject_id,
         s.name,
         q.unit_id,
         u.name,
         e.id,
         e.cohort,
         e.exam_name,
         q.question_number,
         q.question_type,
         left(q.stem_text, 160),
         exists (
           select 1 from public.solutions sol
            where sol.author_id = auth.uid()
              and (sol.question_id = q.id
                   or (q.group_id is not null and sol.group_id = q.group_id))
         )
    from public.assignments a
    join public.questions q on q.id = a.question_id
    join public.exams e on e.id = q.exam_id
    join public.subjects s on s.id = e.subject_id
    left join public.units u on u.id = q.unit_id
   where a.assignee_id = auth.uid()
   order by s.sort_order, s.name, e.cohort, q.question_number;
$$;

create or replace function public.count_my_open_assignments()
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.assignments
   where assignee_id = auth.uid() and status <> 'done';
$$;

-- 관리자 화면의 담당자별 진행률
create or replace function public.get_assignment_progress()
returns table (
  assignee_id  uuid,
  display_name text,
  total        int,
  done         int,
  overdue      int
)
language sql stable security definer set search_path = public
as $$
  select a.assignee_id,
         p.display_name,
         count(*)::int,
         count(*) filter (where a.status = 'done')::int,
         count(*) filter (where a.status <> 'done'
                            and a.due_date is not null
                            and a.due_date < current_date)::int
    from public.assignments a
    join public.profiles p on p.id = a.assignee_id
   group by a.assignee_id, p.display_name
   order by p.display_name;
$$;

revoke execute on function public.get_my_assignments()        from public, anon;
revoke execute on function public.count_my_open_assignments() from public, anon;
revoke execute on function public.get_assignment_progress()   from public, anon;

grant execute on function public.get_my_assignments()         to authenticated;
grant execute on function public.count_my_open_assignments()  to authenticated;
grant execute on function public.get_assignment_progress()    to authenticated;
