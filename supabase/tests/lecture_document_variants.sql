-- 운영 데이터는 ROLLBACK으로 남기지 않고 관리자 R2 읽기 우회만 확인한다.
begin;

do $$
declare
  test_admin_id uuid;
  test_lecture_id uuid;
  test_variant_id uuid;
  test_permission_key text;
  test_object_name text := 'variants/test/' || gen_random_uuid()::text || '.pdf';
  test_search_term text := 'variantleaksecret' || replace(gen_random_uuid()::text, '-', '');
begin
  select id into test_admin_id
    from public.profiles
   where role = 'admin'
     and not is_suspended
   order by created_at
   limit 1;
  select id into test_lecture_id
    from public.lecture_documents
   where is_published
   order by created_at
   limit 1;
  select key into test_permission_key
    from public.access_permissions
   order by key
   limit 1;

  if test_admin_id is null or test_lecture_id is null or test_permission_key is null then
    raise exception '대체본 권한 시험에 필요한 관리자·강의록·권한 키가 없습니다.';
  end if;

  -- 관리자가 이 권한을 별도로 가진 경우에도 is_admin 우회 자체를 시험하도록
  -- 트랜잭션 안에서 잠시 지운다. 아래 rollback으로 원래 값은 복구된다.
  delete from public.profile_permissions
   where profile_id = test_admin_id
     and permission_key = test_permission_key;

  insert into public.lecture_document_variants (
    lecture_id,
    label,
    file_path,
    content_hash,
    required_permission,
    created_by
  ) values (
    test_lecture_id,
    test_search_term,
    'lecture-documents/' || test_object_name,
    md5(random()::text) || md5(random()::text),
    test_permission_key,
    test_admin_id
  ) returning id into test_variant_id;

  perform set_config('test.lecture_variant_id', test_variant_id::text, true);
  perform set_config('test.lecture_variant_object', test_object_name, true);
  perform set_config('test.lecture_variant_search_term', test_search_term, true);

  perform set_config('request.jwt.claim.sub', test_admin_id::text, true);

  if not public.is_admin() then
    raise exception '시험 대상 사용자가 활성 관리자로 인식되지 않습니다.';
  end if;
  if public.has_permission(test_permission_key) then
    raise exception '시험 대상 관리자에게 권한 키가 남아 있습니다.';
  end if;
  if not public.can_read_lecture_document(test_object_name) then
    raise exception '권한 키가 없는 관리자의 대체본 R2 읽기가 거부됐습니다.';
  end if;

  -- 같은 활성 계정을 일반 회원으로 바꿔 RLS와 검색을 실제 authenticated 역할로
  -- 확인한다. 트랜잭션 끝의 rollback이 관리자 역할과 권한을 모두 복구한다.
  update public.profiles set role = 'member' where id = test_admin_id;
end;
$$;

set local role authenticated;

do $$
begin
  if exists (
    select 1
      from public.lecture_document_variants v
     where v.id = current_setting('test.lecture_variant_id')::uuid
  ) then
    raise exception '레옵스 권한 없는 회원에게 대체본 행이 노출됐습니다.';
  end if;

  if public.authorize_storage_object(
    'lecture-documents',
    current_setting('test.lecture_variant_object'),
    'read'
  ) then
    raise exception '레옵스 권한 없는 회원에게 대체본 R2 읽기가 허용됐습니다.';
  end if;

  -- 통합 검색은 원본 강의록 색인만 읽는다. 대체본에만 넣은 고유 문자열로
  -- 검색했을 때 결과가 생기면 대체본 메타데이터가 새고 있다는 뜻이다.
  if exists (
    select 1
      from public.search_lecture_documents(
        current_setting('test.lecture_variant_search_term'),
        null,
        null,
        null,
        500
      )
  ) then
    raise exception '통합 검색에서 권한 없는 대체본 정보가 노출됐습니다.';
  end if;
end;
$$;

reset role;

rollback;
