-- Sevenpan B2B security, customer profile and order workflow.
-- This migration intentionally replaces the anonymous demo access model.

create schema if not exists private;
revoke all on schema private from public;

do $$
begin
  create type public.app_role as enum ('admin', 'customer');
exception
  when duplicate_object then null;
end $$;

alter table public.customers
  add column if not exists address_line_1 text not null default '',
  add column if not exists city text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists delivery_notes text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.products
  add column if not exists updated_at timestamptz not null default now();

alter table public.orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null,
  customer_id uuid unique references public.customers(id) on delete restrict,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_customer_check check (
    (role = 'admin' and customer_id is null) or
    (role = 'customer' and customer_id is not null)
  )
);

create table if not exists public.product_price_history (
  id bigint generated always as identity primary key,
  product_id text not null references public.products(id) on delete restrict,
  old_price numeric not null check (old_price >= 0),
  new_price numeric not null check (new_price >= 0),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists profiles_customer_id_idx on public.profiles(customer_id);
create index if not exists order_items_product_id_idx on public.order_items(product_id);
create index if not exists orders_customer_delivery_idx on public.orders(customer_id, delivery_date desc);
create index if not exists orders_status_delivery_idx on public.orders(status, delivery_date);
create index if not exists product_price_history_product_changed_at_idx on public.product_price_history(product_id, changed_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.record_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.price is distinct from old.price then
    insert into public.product_price_history (product_id, old_price, new_price, changed_by)
    values (new.id, old.price, new.price, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function private.set_updated_at();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function private.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

drop trigger if exists products_record_price_change on public.products;
create trigger products_record_price_change
  after update of price on public.products
  for each row execute function private.record_product_price_change();

create or replace function private.current_customer_id()
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

create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_customer_id();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

create or replace function private.is_before_order_cutoff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Montevideo')::time < time '18:00';
$$;

create or replace function private.replace_order_items(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_products integer;
  v_inserted_products integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La comanda debe incluir al menos un producto';
  end if;

  with input as (
    select item.product_id, sum(item.quantity) as quantity
    from jsonb_to_recordset(p_items) as item(product_id text, quantity numeric)
    where item.quantity > 0
    group by item.product_id
  )
  select count(*) into v_requested_products from input;

  if v_requested_products = 0 then
    raise exception 'Las cantidades deben ser mayores a cero';
  end if;

  delete from public.order_items where order_id = p_order_id;

  with input as (
    select item.product_id, sum(item.quantity) as quantity
    from jsonb_to_recordset(p_items) as item(product_id text, quantity numeric)
    where item.quantity > 0
    group by item.product_id
  )
  insert into public.order_items (order_id, product_id, quantity, unit_price)
  select p_order_id, input.product_id, input.quantity, product.price
  from input
  join public.products product
    on product.id = input.product_id
   and product.is_active;

  get diagnostics v_inserted_products = row_count;

  if v_inserted_products <> v_requested_products then
    raise exception 'Uno o mas productos no estan disponibles';
  end if;
end;
$$;

create or replace function public.place_order(
  p_items jsonb,
  p_delivery_date date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_delivery_date date := coalesce(
    p_delivery_date,
    (now() at time zone 'America/Montevideo')::date + 1
  );
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  v_customer_id := private.current_customer_id();
  if v_customer_id is null then
    raise exception 'Solo una panaderia cliente puede crear comandas' using errcode = '42501';
  end if;

  if not private.is_before_order_cutoff() then
    raise exception 'El horario de corte para comandas es a las 18:00';
  end if;

  if v_delivery_date < (now() at time zone 'America/Montevideo')::date then
    raise exception 'La fecha de entrega no puede ser anterior a hoy';
  end if;

  insert into public.orders (customer_id, status, delivery_date, notes)
  values (v_customer_id, 'pending', v_delivery_date, nullif(trim(p_notes), ''))
  returning id into v_order_id;

  perform private.replace_order_items(v_order_id, p_items);
  return v_order_id;
end;
$$;

create or replace function public.update_pending_order(
  p_order_id uuid,
  p_items jsonb,
  p_delivery_date date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_delivery_date date := coalesce(p_delivery_date, (now() at time zone 'America/Montevideo')::date + 1);
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  v_customer_id := private.current_customer_id();
  if v_customer_id is null then
    raise exception 'Solo una panaderia cliente puede modificar comandas' using errcode = '42501';
  end if;

  if not private.is_before_order_cutoff() then
    raise exception 'El horario de corte para modificar comandas es a las 18:00';
  end if;

  if v_delivery_date < (now() at time zone 'America/Montevideo')::date then
    raise exception 'La fecha de entrega no puede ser anterior a hoy';
  end if;

  perform 1
  from public.orders
  where id = p_order_id
    and customer_id = v_customer_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'La comanda no esta disponible para modificar' using errcode = '42501';
  end if;

  update public.orders
  set delivery_date = v_delivery_date,
      notes = nullif(trim(p_notes), '')
  where id = p_order_id;

  perform private.replace_order_items(p_order_id, p_items);
  return p_order_id;
end;
$$;

create or replace function public.cancel_pending_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  v_customer_id := private.current_customer_id();
  if v_customer_id is null then
    raise exception 'Solo una panaderia cliente puede cancelar comandas' using errcode = '42501';
  end if;

  if not private.is_before_order_cutoff() then
    raise exception 'El horario de corte para cancelar comandas es a las 18:00';
  end if;

  update public.orders
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid()
  where id = p_order_id
    and customer_id = v_customer_id
    and status = 'pending';

  if not found then
    raise exception 'La comanda no esta disponible para cancelar' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.advance_order_status(p_order_id uuid, p_next_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede actualizar estados' using errcode = '42501';
  end if;

  select status into v_current_status
  from public.orders
  where id = p_order_id
  for update;

  if v_current_status is null then
    raise exception 'Comanda no encontrada';
  end if;

  if not (
    (v_current_status = 'pending' and p_next_status in ('in_production', 'cancelled')) or
    (v_current_status = 'in_production' and p_next_status in ('dispatched', 'cancelled')) or
    (v_current_status = 'dispatched' and p_next_status = 'delivered')
  ) then
    raise exception 'Transicion de estado no permitida';
  end if;

  update public.orders
  set status = p_next_status,
      cancelled_at = case when p_next_status = 'cancelled' then now() else cancelled_at end,
      cancelled_by = case when p_next_status = 'cancelled' then auth.uid() else cancelled_by end
  where id = p_order_id;
end;
$$;

create or replace function public.bootstrap_admin(p_user_id uuid, p_full_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'El usuario de Auth no existe';
  end if;

  insert into public.profiles (id, role, customer_id, full_name)
  values (p_user_id, 'admin', null, nullif(trim(p_full_name), ''))
  on conflict (id) do update
    set role = excluded.role,
        customer_id = null,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
end;
$$;

drop function if exists public.create_demo_order(text, jsonb, date);

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.product_price_history enable row level security;

drop policy if exists "demo clients read customers" on public.customers;
drop policy if exists "demo clients read products" on public.products;
drop policy if exists "demo clients read orders" on public.orders;
drop policy if exists "demo clients create orders" on public.orders;
drop policy if exists "demo admins update orders" on public.orders;
drop policy if exists "demo clients read order items" on public.order_items;
drop policy if exists "demo clients create order items" on public.order_items;

drop policy if exists "profiles are visible to their owner and admins" on public.profiles;
create policy "profiles are visible to their owner and admins"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "customers are visible to their account and admins" on public.customers;
create policy "customers are visible to their account and admins"
  on public.customers for select to authenticated
  using (id = (select public.current_customer_id()) or (select public.is_admin()));

drop policy if exists "customers may update delivery data" on public.customers;
create policy "customers may update delivery data"
  on public.customers for update to authenticated
  using (id = (select public.current_customer_id()) or (select public.is_admin()))
  with check (id = (select public.current_customer_id()) or (select public.is_admin()));

drop policy if exists "products are visible to authenticated users" on public.products;
create policy "products are visible to authenticated users"
  on public.products for select to authenticated
  using (is_active or (select public.is_admin()));

drop policy if exists "administrators may update products" on public.products;
create policy "administrators may update products"
  on public.products for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "orders are visible to their customer and admins" on public.orders;
create policy "orders are visible to their customer and admins"
  on public.orders for select to authenticated
  using (customer_id = (select public.current_customer_id()) or (select public.is_admin()));

drop policy if exists "order items are visible to their customer and admins" on public.order_items;
create policy "order items are visible to their customer and admins"
  on public.order_items for select to authenticated
  using (
    (select public.is_admin()) or exists (
      select 1
      from public.orders order_header
      where order_header.id = order_items.order_id
        and order_header.customer_id = (select public.current_customer_id())
    )
  );

drop policy if exists "administrators may see price history" on public.product_price_history;
create policy "administrators may see price history"
  on public.product_price_history for select to authenticated
  using ((select public.is_admin()));

revoke all on table public.profiles, public.customers, public.products, public.orders, public.order_items, public.product_price_history from anon;
revoke all on table public.profiles, public.customers, public.products, public.orders, public.order_items, public.product_price_history from authenticated;

grant select on public.profiles, public.customers, public.products, public.orders, public.order_items, public.product_price_history to authenticated;
grant update (address_line_1, city, phone, delivery_notes) on public.customers to authenticated;
grant update (price, is_active) on public.products to authenticated;

revoke all on function public.current_customer_id() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.place_order(jsonb, date, text) from public;
revoke all on function public.update_pending_order(uuid, jsonb, date, text) from public;
revoke all on function public.cancel_pending_order(uuid) from public;
revoke all on function public.advance_order_status(uuid, text) from public;
revoke all on function public.bootstrap_admin(uuid, text) from public;

grant execute on function public.current_customer_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.place_order(jsonb, date, text) to authenticated;
grant execute on function public.update_pending_order(uuid, jsonb, date, text) to authenticated;
grant execute on function public.cancel_pending_order(uuid) to authenticated;
grant execute on function public.advance_order_status(uuid, text) to authenticated;
