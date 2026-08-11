-- =============================================================================
-- record_question_revision 요약 문구 버그 수정
--
-- `text[] || '문자열'` 은 리터럴을 배열로 해석하려다
-- "malformed array literal" 로 실패한다. 본문/보기/그룹 변경 요약이 이 경로였다.
-- 20260810145839 원본 파일도 함께 고쳤으므로 신규 배포에서는 처음부터 올바르게 생성된다.
-- =============================================================================

create or replace function public.record_question_revision()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  d jsonb := '{}'::jsonb;
  k text;
  parts text[] := '{}';
  tracked text[] := array[
    'exam_id', 'unit_id', 'question_number', 'question_type', 'set_id',
    'stem_blocks', 'choices', 'answer_count',
    'editor_answer', 'yama_answer', 'answer_status', 'answer_note',
    'official_explanation', 'model_answer', 'grading_points',
    'professor', 'restorer_note', 'source_tags', 'variant_type',
    'group_id', 'completeness', 'status'
  ];
  before_name text;
  after_name text;
begin
  foreach k in array tracked loop
    if (o -> k) is distinct from (n -> k) then
      d := d || jsonb_build_object(k, jsonb_build_object('before', o -> k, 'after', n -> k));
    end if;
  end loop;

  if d = '{}'::jsonb then
    return null;
  end if;

  if d ? 'unit_id' then
    select name into before_name from public.units where id = old.unit_id;
    select name into after_name from public.units where id = new.unit_id;
    parts := parts || format('단원 이동: %s → %s',
                             coalesce(before_name, '미분류'), coalesce(after_name, '미분류'));
  end if;

  if d ? 'editor_answer' then
    parts := parts || format('편집자답 변경 %s → %s',
                             public.circled_answer(old.editor_answer),
                             public.circled_answer(new.editor_answer));
  end if;

  if d ? 'answer_status' then
    parts := parts || format('정답 상태 변경 %s → %s', old.answer_status, new.answer_status);
  end if;

  if d ? 'stem_blocks' then parts := parts || '문제 본문 수정'::text; end if;
  if d ? 'choices'     then parts := parts || '보기 수정'::text; end if;
  if d ? 'group_id'    then parts := parts || '중복 그룹 변경'::text; end if;

  if array_length(parts, 1) is null then
    parts := array['문제 정보 수정'];
  end if;

  insert into public.revisions (entity_type, entity_id, editor_id, diff, change_summary)
  values ('question', new.id, coalesce(auth.uid(), new.updated_by), d, array_to_string(parts, ', '));

  return null;
end;
$$;

alter function public.record_question_revision() set search_path = public;
