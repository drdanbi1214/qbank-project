begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lecture_pdf_annotations_marks_count_limit'
      and conrelid = 'public.lecture_pdf_annotations'::regclass
  ) then
    alter table public.lecture_pdf_annotations
      add constraint lecture_pdf_annotations_marks_count_limit
      check (
        case
          when jsonb_typeof(marks) = 'array' then jsonb_array_length(marks) <= 2000
          else false
        end
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lecture_pdf_annotations_marks_size_limit'
      and conrelid = 'public.lecture_pdf_annotations'::regclass
  ) then
    alter table public.lecture_pdf_annotations
      add constraint lecture_pdf_annotations_marks_size_limit
      check (pg_column_size(marks) <= 4194304) not valid;
  end if;
end
$$;

comment on constraint lecture_pdf_annotations_marks_count_limit
  on public.lecture_pdf_annotations is
  '한 PDF 쪽에 저장하는 필기 개수를 2,000개로 제한한다.';

comment on constraint lecture_pdf_annotations_marks_size_limit
  on public.lecture_pdf_annotations is
  '한 PDF 쪽의 필기 JSON 크기를 4MB로 제한한다.';

alter table public.lecture_pdf_annotations
  validate constraint lecture_pdf_annotations_marks_count_limit;

alter table public.lecture_pdf_annotations
  validate constraint lecture_pdf_annotations_marks_size_limit;

commit;
