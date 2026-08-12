alter table public.profiles
  add column welcome_popup_dismissed boolean not null default false;
