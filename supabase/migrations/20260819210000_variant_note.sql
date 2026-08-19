-- =============================================================================
-- 변주 차이 메모
--
-- 지금은 모든 변주에 "지문이 조금 다릅니다" 가 똑같이 붙는다. 정작 중요한 것은
-- 어떻게 다른지다 — "묻는 방향이 반대", "숫자만 바뀜", "선지 하나가 교체됨".
-- 특히 발문이 뒤집힌 변주는 공유 해설을 그대로 읽으면 오답으로 이어지므로,
-- 그 차이를 한 줄로 적어둘 자리가 있어야 한다.
--
-- 문제는 클러스터에 많아야 하나 속하므로 questions 에 컬럼으로 둔다.
-- =============================================================================

alter table public.questions
  add column if not exists variant_note text;

comment on column public.questions.variant_note is
  '이 판본이 대표와 무엇이 다른지 한 줄 메모. 변주(modified)에만 쓴다.';


-- 형제 조회가 questions_solve 뷰를 타므로 뷰에도 실어 준다.
-- create or replace view 는 컬럼 순서를 바꿀 수 없어 맨 끝에 붙인다.
create or replace view public.questions_solve as
  select id, exam_id, unit_id, question_number, question_type, set_id,
         stem_blocks, choices, answer_count, answer_status, professor,
         restorer_note, source_tags, variant_type, group_id,
         completeness, status, view_count, stem_text, created_by, updated_by,
         created_at, updated_at, unit_source,
         question_code(questions.*) as question_code,
         variant_note
    from questions
   where is_admin() or can_view_exam(exam_id);


-- 메모도 클러스터 컬럼과 같이 보호한다. 아무나 고칠 수 있으면 "묻는 방향이
-- 반대" 같은 경고가 조용히 지워질 수 있다.
create or replace function public.guard_cluster_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.group_id is not distinct from old.group_id
     and new.variant_type is not distinct from old.variant_type
     and new.variant_note is not distinct from old.variant_note then
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


create or replace function public.cluster_set_note(p_question_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.can_cluster() then
    raise exception '야마 메모를 고칠 권한이 없습니다.' using errcode = '42501';
  end if;

  perform set_config('app.cluster_write', 'on', true);

  update public.questions
     set variant_note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_question_id;

  -- set_config(..., is_local) 는 트랜잭션 끝까지 남는다. 쓰고 바로 내려야
  -- 같은 트랜잭션의 다른 UPDATE 까지 통과하지 않는다.
  perform set_config('app.cluster_write', 'off', true);

  if not found then
    raise exception '문제를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.cluster_set_note(uuid, text) is
  '변주가 대표와 무엇이 다른지 한 줄 메모를 남긴다.';

revoke all on function public.cluster_set_note(uuid, text) from public;
grant execute on function public.cluster_set_note(uuid, text) to authenticated;
