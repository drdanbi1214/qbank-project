-- macOS 화면 녹화 등 QuickTime 동영상(.mov)도 레옵스 공지에 첨부할 수 있게 한다.

begin;

update storage.buckets
set allowed_mime_types = array[
  'image/webp',
  'image/png',
  'image/jpeg',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime'
]::text[]
where id = 'topic-images';

commit;
