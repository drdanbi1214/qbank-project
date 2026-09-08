begin;

alter table public.theory_memos
  add column if not exists content jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'theory_memos_content_size'
      and conrelid = 'public.theory_memos'::regclass
  ) then
    alter table public.theory_memos
      add constraint theory_memos_content_size
      check (content is null or octet_length(content::text) <= 1000000);
  end if;
end
$$;

-- 배포 전부터 열려 있던 구버전 탭은 body/image_paths만 저장한다. 그런 저장이
-- 나중에 들어오면 content를 null로 돌려 새 화면이 최신 구버전 값을 변환해 읽는다.
create or replace function public.invalidate_theory_memo_content_on_legacy_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content is not distinct from old.content
    and (
      new.body is distinct from old.body
      or new.image_paths is distinct from old.image_paths
    )
  then
    new.content := null;
  end if;
  return new;
end;
$$;

drop trigger if exists theory_memos_invalidate_legacy_content on public.theory_memos;
create trigger theory_memos_invalidate_legacy_content
before update on public.theory_memos
for each row execute function public.invalidate_theory_memo_content_on_legacy_write();

comment on column public.theory_memos.content is
  'Tiptap JSON document. Null rows are legacy body/image_paths memos and are converted on read.';

commit;
