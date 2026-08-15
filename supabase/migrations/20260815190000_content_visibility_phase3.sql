-- 콘텐츠 가시성 3단계 — 학번별 문제 숨김을 실제로 켠다.
--
-- 여기서부터는 화면에 보이는 것이 달라진다. 22·23학번 문제 677개가
-- 권한 없는 사람에게는 아예 조회되지 않는다.

-- ---------------------------------------------------------------------------
-- 1. 시험에 공개범위를 건다
--
-- 26학번은 required_permission 이 null 로 남아 전체공개다.
-- ---------------------------------------------------------------------------
update public.exams set required_permission = 'cohort_22_view' where cohort = '22학번';
update public.exams set required_permission = 'cohort_23_view' where cohort = '23학번';

-- ---------------------------------------------------------------------------
-- 2. 22·23학번을 열어줄 사람
--
-- 이후에는 관리자 화면(사용자 관리)에서 체크박스로 켜고 끈다.
-- ---------------------------------------------------------------------------
insert into public.profile_permissions (profile_id, permission_key)
select p.id, k.key
  from public.profiles p
 cross join (values ('cohort_22_view'), ('cohort_23_view')) as k(key)
 where p.id in (
   'f7ad7248-8045-4186-b45d-2e188f763349',  -- 딱딱복숭아
   'b849912b-d04f-4f0a-af8a-3e80615b1197',  -- 꾹이
   '7580f306-152f-4be5-a7eb-8747f602b3b7',  -- 김기윤
   '4048ad36-ecd4-49fb-b5e2-a62a902925c4',  -- dopamine
   '6d097e1e-11f0-4b5e-a154-046962db6a22',  -- 저공비행의삶 (관리자)
   '6bd8ae40-5c99-45d3-ba58-2fe9279eaf49',  -- 레몬탱
   'a12ab2e3-4806-4ed0-afb1-902d8a68faff'   -- 재현
 )
on conflict (profile_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. 문제가 속한 시험을 볼 수 있는지 판정한다
--
-- questions 의 RLS 안에서 exams 를 다시 읽어야 하는데, exams 에도 RLS 가
-- 걸리므로 정책끼리 서로 물리지 않도록 definer 로 조회한다.
-- ---------------------------------------------------------------------------
create or replace function public.can_view_exam(p_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_content_access(e.required_permission)
    from public.exams e
   where e.id = p_exam_id;
$$;

revoke all on function public.can_view_exam(uuid) from public;
grant execute on function public.can_view_exam(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. 조회 정책
--
-- 관리자는 항상 전부 본다. 관리 화면(문제 목록, 업로드, 라벨링)이
-- 학번 권한과 무관하게 동작해야 하기 때문이다.
-- ---------------------------------------------------------------------------
drop policy if exists exams_select on public.exams;
create policy exams_select on public.exams
  for select to authenticated
  using (public.is_admin() or public.has_content_access(required_permission));

drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions
  for select to authenticated
  using (public.is_admin() or public.can_view_exam(exam_id));

-- ---------------------------------------------------------------------------
-- 5. 풀이 화면이 보는 뷰에도 같은 조건을 건다
--
-- questions_solve 는 postgres 소유의 일반 뷰라 questions 의 RLS 를 통째로
-- 우회한다. 위의 정책만으로는 이 뷰를 통한 조회가 걸러지지 않는다.
--
-- security_invoker 로 바꾸는 방법은 쓸 수 없다. authenticated 에게는
-- questions 의 SELECT 권한이 아예 없기 때문이다(정답 컬럼을 숨기려고
-- 일부러 뷰로만 열어두었다). invoker 로 바꾸면 조회 자체가 권한 오류로
-- 막힌다. 그래서 뷰 정의에 직접 조건을 넣는다.
-- ---------------------------------------------------------------------------
create or replace view public.questions_solve as
  select id,
         exam_id,
         unit_id,
         question_number,
         question_type,
         set_id,
         stem_blocks,
         choices,
         answer_count,
         answer_status,
         professor,
         restorer_note,
         source_tags,
         variant_type,
         group_id,
         completeness,
         status,
         view_count,
         stem_text,
         created_by,
         updated_by,
         created_at,
         updated_at,
         unit_source,
         public.question_code(questions.*) as question_code
    from public.questions
   where public.is_admin() or public.can_view_exam(exam_id);
