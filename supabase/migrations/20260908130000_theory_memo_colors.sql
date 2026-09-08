begin;

alter table public.theory_memos
  add column if not exists color text not null default 'yellow';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'theory_memos_color_check'
      and conrelid = 'public.theory_memos'::regclass
  ) then
    alter table public.theory_memos
      add constraint theory_memos_color_check
      check (color in ('yellow', 'rose', 'green', 'blue', 'violet'));
  end if;
end
$$;

comment on column public.theory_memos.color is
  'User-selected memo paper color: yellow, rose, green, blue, or violet.';

commit;
