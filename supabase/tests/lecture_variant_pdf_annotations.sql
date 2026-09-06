-- 원본과 후배 필기본의 같은 쪽이 서로 다른 개인 필기로 저장되는지 확인한다.
begin;

do $$
declare
  test_user_id uuid;
  test_lecture_id uuid;
  test_variant_id uuid;
  original_result record;
  variant_result record;
  original_marks jsonb;
  variant_marks jsonb;
begin
  select profile.id into test_user_id
    from public.profiles profile
   where profile.role = 'admin'
     and not profile.is_suspended
   order by profile.created_at
   limit 1;

  select variant.lecture_id, variant.id
    into test_lecture_id, test_variant_id
    from public.lecture_document_variants variant
   where variant.is_published
   order by variant.created_at
   limit 1;

  if test_user_id is null or test_variant_id is null then
    raise exception '대체본 필기 시험에 필요한 관리자 또는 필기본이 없습니다.';
  end if;

  perform set_config('request.jwt.claim.sub', test_user_id::text, true);

  select * into original_result
    from public.save_lecture_pdf_annotations_for_document(
      test_lecture_id,
      null,
      2147483646,
      '[{"tool":"pen","color":"#2563eb","width":0.004,"points":[0.1,0.1,0.2,0.2]}]'::jsonb,
      null
    );

  select * into variant_result
    from public.save_lecture_pdf_annotations_for_document(
      test_lecture_id,
      test_variant_id,
      2147483646,
      '[{"tool":"highlight","color":"#facc15","width":0.03,"points":[0.3,0.3,0.4,0.4]}]'::jsonb,
      null
    );

  if original_result.save_status <> 'saved' or variant_result.save_status <> 'saved' then
    raise exception '원본 또는 대체본 필기 저장에 실패했습니다.';
  end if;

  select marks into original_marks
    from public.lecture_pdf_annotations
   where user_id = test_user_id
     and lecture_id = test_lecture_id
     and variant_id is null
     and page_number = 2147483646;

  select marks into variant_marks
    from public.lecture_pdf_annotations
   where user_id = test_user_id
     and lecture_id = test_lecture_id
     and variant_id = test_variant_id
     and page_number = 2147483646;

  if original_marks = variant_marks or original_marks is null or variant_marks is null then
    raise exception '원본과 대체본의 개인 필기가 분리되지 않았습니다.';
  end if;
end;
$$;

rollback;
