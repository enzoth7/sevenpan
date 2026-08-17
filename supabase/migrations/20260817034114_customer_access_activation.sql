-- Managed B2B customer access and email activation.

alter table public.customers
  add column if not exists customer_code text;

update public.customers
set customer_code = upper(slug)
where customer_code is null;

alter table public.customers
  alter column customer_code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customers_customer_code_format_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_customer_code_format_check
      check (customer_code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$');
  end if;
end $$;

create unique index if not exists customers_customer_code_key
  on public.customers(customer_code);

alter table public.profiles
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists access_status text not null default 'active',
  add column if not exists activated_at timestamptz;

update public.profiles profile
set contact_email = lower(trim(auth_user.email)),
    contact_phone = nullif(trim(auth_user.phone), ''),
    activated_at = coalesce(profile.activated_at, profile.created_at)
from auth.users auth_user
where auth_user.id = profile.id
  and profile.role = 'customer'
  and profile.contact_email is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_access_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_access_status_check
      check (access_status in ('pending', 'active', 'suspended'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_contact_email_normalized_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_contact_email_normalized_check
      check (contact_email is null or contact_email = lower(trim(contact_email)));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_contact_phone_format_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_contact_phone_format_check
      check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end $$;

create unique index if not exists profiles_enabled_contact_email_key
  on public.profiles(contact_email)
  where role = 'customer' and contact_email is not null and access_status <> 'suspended';

create unique index if not exists profiles_enabled_contact_phone_key
  on public.profiles(contact_phone)
  where role = 'customer' and contact_phone is not null and access_status <> 'suspended';

create table if not exists public.customer_activation_challenges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  secret_hash text not null unique,
  request_fingerprint text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint customer_activation_challenges_expiry_check check (expires_at > created_at)
);

create index if not exists customer_activation_challenges_profile_created_idx
  on public.customer_activation_challenges(profile_id, created_at desc);

create index if not exists customer_activation_challenges_active_expiry_idx
  on public.customer_activation_challenges(expires_at)
  where used_at is null;

alter table public.customer_activation_challenges enable row level security;
revoke all on public.customer_activation_challenges from public, anon, authenticated;
grant select, insert, update, delete on public.customer_activation_challenges to service_role;

create or replace function public.complete_customer_activation(
  p_profile_id uuid,
  p_secret_hash text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
  from public.profiles
  where id = p_profile_id
    and role = 'customer'
    and access_status = 'pending'
  for update;

  if not found then
    return false;
  end if;

  update public.customer_activation_challenges
  set used_at = now()
  where profile_id = p_profile_id
    and secret_hash = p_secret_hash
    and used_at is null
    and expires_at > now();

  if not found then
    return false;
  end if;

  update public.profiles
  set access_status = 'active',
      activated_at = now()
  where id = p_profile_id;

  return true;
end;
$$;

revoke all on function public.complete_customer_activation(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_customer_activation(uuid, text) to service_role;

create or replace function private.assigned_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select customer_id
  from public.profiles
  where id = (select auth.uid())
    and role = 'customer';
$$;

create or replace function private.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.customer_id
  from public.profiles profile
  join public.customers customer on customer.id = profile.customer_id
  where profile.id = (select auth.uid())
    and profile.role = 'customer'
    and profile.access_status = 'active'
    and customer.is_active;
$$;

drop policy if exists "customers are visible to their account and admins" on public.customers;
create policy "customers are visible to their account and admins"
  on public.customers for select to authenticated
  using (id = (select private.assigned_customer_id()) or (select private.is_admin()));

drop policy if exists "customers may update their own delivery data" on public.customers;
create policy "customers may update their own delivery data"
  on public.customers for update to authenticated
  using (id = (select private.current_customer_id()))
  with check (id = (select private.current_customer_id()));

create or replace function public.place_order(
  p_actor_id uuid,
  p_items jsonb,
  p_delivery_date date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_delivery_date date := private.delivery_date_for_order(now());
begin
  select profile.customer_id into v_customer_id
  from public.profiles profile
  join public.customers customer on customer.id = profile.customer_id
  where profile.id = p_actor_id
    and profile.role = 'customer'
    and profile.access_status = 'active'
    and customer.is_active;

  if v_customer_id is null then
    raise exception 'La cuenta cliente no esta habilitada para crear comandas' using errcode = '42501';
  end if;

  insert into public.orders (customer_id, status, delivery_date, notes)
  values (v_customer_id, 'pending', v_delivery_date, nullif(trim(p_notes), ''))
  returning id into v_order_id;

  perform private.replace_order_items(v_order_id, p_items);
  return v_order_id;
end;
$$;

create or replace function public.update_pending_order(
  p_actor_id uuid,
  p_order_id uuid,
  p_items jsonb,
  p_delivery_date date,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_delivery_date date;
begin
  select profile.customer_id into v_customer_id
  from public.profiles profile
  join public.customers customer on customer.id = profile.customer_id
  where profile.id = p_actor_id
    and profile.role = 'customer'
    and profile.access_status = 'active'
    and customer.is_active;

  if v_customer_id is null then
    raise exception 'La cuenta cliente no esta habilitada para modificar comandas' using errcode = '42501';
  end if;

  select delivery_date into v_delivery_date
  from public.orders
  where id = p_order_id
    and customer_id = v_customer_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'La comanda no esta disponible para modificar' using errcode = '42501';
  end if;

  if now() > private.order_change_deadline(v_delivery_date) then
    raise exception 'La comanda ya cerro para produccion a las 18:00 del dia anterior a la entrega';
  end if;

  update public.orders
  set notes = nullif(trim(p_notes), '')
  where id = p_order_id;

  perform private.replace_order_items(p_order_id, p_items);
  return p_order_id;
end;
$$;

create or replace function public.cancel_pending_order(p_actor_id uuid, p_order_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_delivery_date date;
begin
  select profile.customer_id into v_customer_id
  from public.profiles profile
  join public.customers customer on customer.id = profile.customer_id
  where profile.id = p_actor_id
    and profile.role = 'customer'
    and profile.access_status = 'active'
    and customer.is_active;

  if v_customer_id is null then
    raise exception 'La cuenta cliente no esta habilitada para cancelar comandas' using errcode = '42501';
  end if;

  select delivery_date into v_delivery_date
  from public.orders
  where id = p_order_id
    and customer_id = v_customer_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'La comanda no esta disponible para cancelar' using errcode = '42501';
  end if;

  if now() > private.order_change_deadline(v_delivery_date) then
    raise exception 'La comanda ya cerro para produccion a las 18:00 del dia anterior a la entrega';
  end if;

  update public.orders
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = p_actor_id
  where id = p_order_id;
end;
$$;

revoke all on function private.assigned_customer_id() from public;
revoke all on function private.current_customer_id() from public;
grant execute on function private.assigned_customer_id() to authenticated;
grant execute on function private.current_customer_id() to authenticated;
