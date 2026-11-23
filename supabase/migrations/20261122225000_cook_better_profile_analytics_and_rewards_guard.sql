alter table public.profiles
  add column if not exists equipment_preferences text[] not null default '{}'::text[];

alter table public.site_events
  add column if not exists session_id text,
  add column if not exists is_internal boolean not null default false;

alter table public.pending_orders
  add column if not exists meal_logged_at timestamptz;

create index if not exists site_events_created_event_idx
  on public.site_events (created_at desc, event);
create index if not exists site_events_visitor_session_idx
  on public.site_events (visitor_id, session_id, created_at desc);
create index if not exists pending_orders_verified_meal_idx
  on public.pending_orders (user_id, status, verified_at)
  where meal_logged_at is null;

create or replace function public.enforce_household_five_members()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  current_member_count integer;
begin
  -- Serialize joins per household so simultaneous invites cannot exceed five members.
  perform pg_advisory_xact_lock(hashtext(new.household_id::text));
  select count(*) into current_member_count
  from public.household_members
  where household_id = new.household_id;

  if current_member_count >= 5 then
    raise exception 'Households are limited to five people.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists household_max_five_members on public.household_members;
create trigger household_max_five_members
before insert on public.household_members
for each row
execute function public.enforce_household_five_members();
