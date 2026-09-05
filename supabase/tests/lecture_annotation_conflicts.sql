-- 운영 데이터는 ROLLBACK으로 남기지 않고 저장/충돌/재저장의 원자성만 확인한다.
begin;

do $$
declare
  test_user_id uuid;
  test_lecture_id uuid;
  first_result record;
  conflict_result record;
  second_result record;
  directly_bumped_revision bigint;
begin
  select id into test_user_id
    from public.profiles
   where not is_suspended
   order by created_at
   limit 1;
  select id into test_lecture_id
    from public.lecture_documents
   order by created_at
   limit 1;

  if test_user_id is null or test_lecture_id is null then
    raise exception '충돌 저장 시험에 필요한 회원 또는 강의록이 없습니다.';
  end if;

  perform set_config('request.jwt.claim.sub', test_user_id::text, true);

  select * into first_result
    from public.save_lecture_pdf_annotations(
      test_lecture_id,
      2147483647,
      '[{"tool":"pen","color":"#111827","width":0.004,"points":[0.1,0.1,0.2,0.2]}]'::jsonb,
      null
    );
  if first_result.save_status <> 'saved' or first_result.server_revision <> 1 then
    raise exception '첫 저장 결과가 올바르지 않습니다: %', row_to_json(first_result);
  end if;

  -- 배포 전 화면의 직접 upsert도 트리거가 revision을 증가시켜야 한다.
  update public.lecture_pdf_annotations
     set marks = '[]'::jsonb
   where user_id = test_user_id
     and lecture_id = test_lecture_id
     and page_number = 2147483647
  returning revision into directly_bumped_revision;
  if directly_bumped_revision <> 2 then
    raise exception '직접 update의 revision 증가가 올바르지 않습니다: %', directly_bumped_revision;
  end if;

  select * into conflict_result
    from public.save_lecture_pdf_annotations(test_lecture_id, 2147483647, '[]'::jsonb, 1);
  if conflict_result.save_status <> 'conflict' or conflict_result.server_revision <> 2 then
    raise exception '충돌 감지가 작동하지 않습니다: %', row_to_json(conflict_result);
  end if;

  select * into second_result
    from public.save_lecture_pdf_annotations(test_lecture_id, 2147483647, '[]'::jsonb, 2);
  if second_result.save_status <> 'saved' or second_result.server_revision <> 3 then
    raise exception 'revision 재저장이 올바르지 않습니다: %', row_to_json(second_result);
  end if;
end;
$$;

rollback;
