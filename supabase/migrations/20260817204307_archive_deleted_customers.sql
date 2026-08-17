-- Keep order history intact when an administrator removes a client from the directory.
-- The account is suspended by the admin Edge Function; this timestamp only controls
-- visibility in the active customer directory.

alter table public.customers
  add column if not exists archived_at timestamptz;

create index if not exists customers_active_directory_name_idx
  on public.customers(name)
  where archived_at is null;
