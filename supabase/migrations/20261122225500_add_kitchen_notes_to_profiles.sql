alter table public.profiles
  add column if not exists kitchen_notes text not null default '';
