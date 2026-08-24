-- 레옵스 공지에 사용설명 영상을 첨부할 수 있게 한다.
-- 기존 topic-images의 비공개/RLS 규칙은 그대로 사용하며, 허용 형식과 크기만 넓힌다.

begin;

update storage.buckets
set
  file_size_limit = 104857600,
  allowed_mime_types = array[
    'image/webp',
    'image/png',
    'image/jpeg',
    'image/gif',
    'video/mp4',
    'video/webm'
  ]::text[]
where id = 'topic-images';

commit;
