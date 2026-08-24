-- 레옵스 새 글과 기존 글 수정 중에도 사용자별 임시저장을 남긴다.
-- 제목과 목차 위치는 본문 JSON과 별개라 metadata에 함께 보관한다.

begin;

alter table public.drafts
  drop constraint if exists drafts_target_type_check;

alter table public.drafts
  add constraint drafts_target_type_check
  check (target_type in ('solution', 'note', 'discussion', 'topic'));

alter table public.drafts
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.drafts
  drop constraint if exists drafts_metadata_object_check;

alter table public.drafts
  add constraint drafts_metadata_object_check
  check (jsonb_typeof(metadata) = 'object');

comment on column public.drafts.metadata is
  '본문 외 임시 값. 레옵스 제목·대표 목차 위치처럼 작성 화면을 복원하는 데 사용한다.';

commit;
