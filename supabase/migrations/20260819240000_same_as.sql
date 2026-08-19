-- =============================================================================
-- 카드마다 자기 '완전히 동일한 문제' 를 갖게 하기
--
-- 지금까지 identical 은 클러스터의 대표 하나를 기준으로만 붙었다. 그런데 한
-- 야마 안에 판본이 여럿이면, 그 판본 각각에도 "이건 저 학번 것과 글자까지 같다"
-- 가 따로 생긴다. 대표 기준 하나로는 그걸 담을 수 없다.
--
-- 두 층으로 나눈다.
--   group_id  = 유사 문제 묶음 (박스 전체)
--   same_as   = 이 문제가 어느 카드와 완전히 같은지. null 이면 자기가 카드다.
--
-- 그래서 격자에 깔리는 카드 = group_id 가 같고 same_as 가 null 인 문제들이고,
-- 각 카드에 딸린 동일 판본 = same_as 가 그 카드를 가리키는 문제들이다.
--
-- variant_type 은 그대로 둔다. same_as 가 null 이 아니면 'identical' 이고,
-- 카드이면서 대표가 아니면 'modified' 다 — 값이 서로 어긋나지 않게 RPC 가 함께
-- 관리한다.
-- =============================================================================

alter table public.questions
  add column if not exists same_as uuid references public.questions(id) on delete set null;

comment on column public.questions.same_as is
  '이 문제와 글자까지 같은 카드. null 이면 자기가 카드다. 같은 클러스터 안에서만 가리킨다.';

create index if not exists questions_same_as_idx on public.questions (same_as);

-- 지금까지의 identical 은 전부 그룹 대표를 가리키던 것이다.
update public.questions q
   set same_as = g.canonical_question_id
  from public.question_groups g
 where q.group_id = g.id
   and q.variant_type = 'identical'
   and q.same_as is null
   and g.canonical_question_id is not null
   and g.canonical_question_id <> q.id;


-- same_as 도 클러스터 컬럼과 같이 보호한다.
create or replace function public.guard_cluster_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.group_id is not distinct from old.group_id
     and new.variant_type is not distinct from old.variant_type
     and new.variant_note is not distinct from old.variant_note
     and new.same_as is not distinct from old.same_as then
    return new;
  end if;

  if coalesce(current_setting('app.cluster_write', true), '') = 'on' then
    return new;
  end if;

  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  raise exception '야마 묶기는 전용 기능으로만 바꿀 수 있습니다.' using errcode = '42501';
end;
$$;


-- 형제 조회가 뷰를 타므로 뷰에도 싣는다. create or replace 는 컬럼 순서를
-- 바꿀 수 없어 맨 끝에 붙인다.
create or replace view public.questions_solve as
  select id, exam_id, unit_id, question_number, question_type, set_id,
         stem_blocks, choices, answer_count, answer_status, professor,
         restorer_note, source_tags, variant_type, group_id,
         completeness, status, view_count, stem_text, created_by, updated_by,
         created_at, updated_at, unit_source,
         question_code(questions.*) as question_code,
         variant_note, same_as
    from questions
   where is_admin() or can_view_exam(exam_id);


-- -----------------------------------------------------------------------------
-- 붙이기: 기준은 이제 '카드' 다. 대표가 아니어도 된다.
-- -----------------------------------------------------------------------------
create or replace function public.cluster_attach(
  p_anchor_id uuid, p_target_id uuid, p_variant text
)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_group_id uuid; v_anchor_group uuid; v_target_group uuid;
  v_anchor_exam uuid; v_target_exam uuid; v_anchor_same uuid;
  v_card_id uuid;
begin
  if not public.can_cluster() then
    raise exception '야마를 묶을 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_variant not in ('identical', 'modified') then
    raise exception '변주 종류는 identical 또는 modified 여야 합니다.' using errcode = '22023';
  end if;
  if p_anchor_id = p_target_id then
    raise exception '같은 문제를 자기 자신에게 붙일 수 없습니다.' using errcode = '22023';
  end if;

  select group_id, exam_id, same_as into v_anchor_group, v_anchor_exam, v_anchor_same
    from public.questions where id = p_anchor_id;
  if not found then
    raise exception '기준 문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  select group_id, exam_id into v_target_group, v_target_exam
    from public.questions where id = p_target_id;
  if not found then
    raise exception '붙일 문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  if not public.is_admin() then
    if not public.can_view_exam(v_anchor_exam) or not public.can_view_exam(v_target_exam) then
      raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
    end if;
  end if;

  if v_target_group is not null then
    raise exception '이미 다른 야마에 묶여 있는 문제입니다. 먼저 묶기를 풀어 주세요.'
      using errcode = '23505';
  end if;

  -- 기준이 이미 어느 카드에 딸린 판본이면 그 카드를 기준으로 삼는다.
  v_card_id := coalesce(v_anchor_same, p_anchor_id);

  perform set_config('app.cluster_write', 'on', true);

  if v_anchor_group is not null then
    v_group_id := v_anchor_group;
  else
    insert into public.question_groups (canonical_question_id, created_by)
    values (v_card_id, auth.uid())
    returning id into v_group_id;

    update public.questions
       set group_id = v_group_id, variant_type = 'original', same_as = null,
           updated_by = auth.uid(), updated_at = now()
     where id = v_card_id;
  end if;

  update public.questions
     set group_id = v_group_id,
         variant_type = p_variant,
         -- 완전히 같으면 그 카드에 딸리고, 거의 비슷하면 자기가 새 카드가 된다.
         same_as = case when p_variant = 'identical' then v_card_id else null end,
         updated_by = auth.uid(), updated_at = now()
   where id = p_target_id;

  perform set_config('app.cluster_write', 'off', true);
  return v_group_id;
end;
$$;


create or replace function public.cluster_detach(p_question_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.can_cluster() then
    raise exception '야마 묶기를 풀 권한이 없습니다.' using errcode = '42501';
  end if;

  perform set_config('app.cluster_write', 'on', true);

  -- 카드를 빼면 거기 딸려 있던 동일 판본들은 갈 곳이 없다. 함께 풀어 준다.
  update public.questions
     set group_id = null, variant_type = 'original', same_as = null,
         updated_by = auth.uid(), updated_at = now()
   where same_as = p_question_id;

  update public.questions
     set group_id = null, variant_type = 'original', same_as = null,
         updated_by = auth.uid(), updated_at = now()
   where id = p_question_id;

  perform set_config('app.cluster_write', 'off', true);

  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
end;
$$;


create or replace function public.cluster_ensure_group(p_question_id uuid)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_group_id uuid; v_exam_id uuid;
begin
  if not public.can_cluster() then
    raise exception '야마를 묶을 권한이 없습니다.' using errcode = '42501';
  end if;

  select group_id, exam_id into v_group_id, v_exam_id
    from public.questions where id = p_question_id;
  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  if v_group_id is not null then
    return v_group_id;
  end if;

  if not public.is_admin() and not public.can_view_exam(v_exam_id) then
    raise exception '열람할 수 없는 시험의 문제입니다.' using errcode = '42501';
  end if;

  perform set_config('app.cluster_write', 'on', true);

  insert into public.question_groups (canonical_question_id, created_by)
  values (p_question_id, auth.uid())
  returning id into v_group_id;

  update public.questions
     set group_id = v_group_id, variant_type = 'original', same_as = null,
         updated_by = auth.uid(), updated_at = now()
   where id = p_question_id;

  perform set_config('app.cluster_write', 'off', true);
  return v_group_id;
end;
$$;
