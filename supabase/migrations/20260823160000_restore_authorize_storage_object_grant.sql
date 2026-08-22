-- authorize_storage_object 는 Worker 가 "사용자 JWT" 로 부르는 진입점이라
-- authenticated 에게 실행 권한이 있어야 한다. 20260823140000(lecture_documents)
-- 에서 이 함수를 다시 만들며 authenticated 권한을 걷어내는 바람에, R2 서명과
-- 업로드 인가가 전부 503 authorization_unavailable 로 떨어졌다. 풀이에 이미지를
-- 넣으려던 사람이 "R2 업로드 실패: authorization_unavailable" 을 보고 알렸다.
--
-- 함수 안에서 auth.uid() 로 본인 여부를 따지고 boolean 만 돌려주므로 authenticated
-- 가 직접 불러도 안전하다. 함수가 안에서 쓰는 can_read_* 도우미들은 security
-- definer 라 호출자 권한과 무관하며, 그쪽은 authenticated 에서 걷어낸 채로 둔다.
revoke execute on function public.authorize_storage_object(text, text, text)
  from public, anon;
grant execute on function public.authorize_storage_object(text, text, text)
  to authenticated;
