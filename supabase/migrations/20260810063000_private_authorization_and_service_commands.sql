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

create or replace function private.is_admin()
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

drop policy if exists "profiles are visible to their owner and admins" on public.profiles;
create policy "profiles are visible to their owner and admins"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "customers are visible to their account and admins" on public.customers;
create policy "customers are visible to their account and admins"
  on public.customers for select to authenticated
  using (id = (select private.current_customer_id()) or (select private.is_admin()));

drop policy if exists "customers may update delivery data" on public.customers;
create policy "customers may update delivery data"
  on public.customers for update to authenticated
  using (id = (select private.current_customer_id()) or (select private.is_admin()))
  with check (id = (select private.current_customer_id()) or (select private.is_admin()));

drop policy if exists "products are visible to authenticated users" on public.products;
create policy "products are visible to authenticated users"
  on public.products for select to authenticated
  using (
    is_active
    or (select private.is_admin())
    or exists (
      select 1
      from public.order_items item
      join public.orders order_header on order_header.id = item.order_id
      where item.product_id = products.id
        and order_header.customer_id = (select private.current_customer_id())
    )
  );

drop policy if exists "administrators may update products" on public.products;
create policy "administrators may update products"
  on public.products for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "orders are visible to their customer and admins" on public.orders;
create policy "orders are visible to their customer and admins"
  on public.orders for select to authenticated
  using (customer_id = (select private.current_customer_id()) or (select private.is_admin()));

drop policy if exists "order items are visible to their customer and admins" on public.order_items;
create policy "order items are visible to their customer and admins"
  on public.order_items for select to authenticated
  using (
    (select private.is_admin()) or exists (
      select 1
      from public.orders order_header
      where order_header.id = order_items.order_id
        and order_header.customer_id = (select private.current_customer_id())
    )
  );

drop policy if exists "administrators may see price history" on public.product_price_history;
create policy "administrators may see price history"
  on public.product_price_history for select to authenticated
  using ((select private.is_admin()));

drop function if exists public.current_customer_id();
drop function if exists public.is_admin();
drop function if exists public.place_order(jsonb, date, text);
drop function if exists public.update_pending_order(uuid, jsonb, date, text);
drop function if exists public.cancel_pending_order(uuid);
drop function if exists public.advance_order_status(uuid, text);
drop function if exists public.bootstrap_admin(uuid, text);

create index if not exists orders_cancelled_by_idx
  on public.orders(cancelled_by)
  where cancelled_by is not null;

create index if not exists product_price_history_changed_by_idx
  on public.product_price_history(changed_by)
  where changed_by is not null;

create function public.place_order(
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
  v_delivery_date date := coalesce(p_delivery_date, (now() at time zone 'America/Montevideo')::date + 1);
begin
  select customer_id into v_customer_id
  from public.profiles
  where id = p_actor_id and role = 'customer';

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

create function public.update_pending_order(
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
  v_delivery_date date := coalesce(p_delivery_date, (now() at time zone 'America/Montevideo')::date + 1);
begin
  select customer_id into v_customer_id
  from public.profiles
  where id = p_actor_id and role = 'customer';

  if v_customer_id is null then
    raise exception 'Solo una panaderia cliente puede modificar comandas' using errcode = '42501';
  end if;
  if not private.is_before_order_cutoff() then
    raise exception 'El horario de corte para modificar comandas es a las 18:00';
  end if;
  if v_delivery_date < (now() at time zone 'America/Montevideo')::date then
    raise exception 'La fecha de entrega no puede ser anterior a hoy';
  end if;

  perform 1 from public.orders
  where id = p_order_id and customer_id = v_customer_id and status = 'pending'
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

create function public.cancel_pending_order(p_actor_id uuid, p_order_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_customer_id uuid;
begin
  select customer_id into v_customer_id from public.profiles where id = p_actor_id and role = 'customer';
  if v_customer_id is null then
    raise exception 'Solo una panaderia cliente puede cancelar comandas' using errcode = '42501';
  end if;
  if not private.is_before_order_cutoff() then
    raise exception 'El horario de corte para cancelar comandas es a las 18:00';
  end if;

  update public.orders
  set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor_id
  where id = p_order_id and customer_id = v_customer_id and status = 'pending';
  if not found then
    raise exception 'La comanda no esta disponible para cancelar' using errcode = '42501';
  end if;
end;
$$;

create function public.advance_order_status(p_actor_id uuid, p_order_id uuid, p_next_status text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_current_status text;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin') then
    raise exception 'Solo un administrador puede actualizar estados' using errcode = '42501';
  end if;

  select status into v_current_status from public.orders where id = p_order_id for update;
  if v_current_status is null then raise exception 'Comanda no encontrada'; end if;
  if not (
    (v_current_status = 'pending' and p_next_status in ('in_production', 'cancelled')) or
    (v_current_status = 'in_production' and p_next_status in ('dispatched', 'cancelled')) or
    (v_current_status = 'dispatched' and p_next_status = 'delivered')
  ) then raise exception 'Transicion de estado no permitida'; end if;

  update public.orders
  set status = p_next_status,
      cancelled_at = case when p_next_status = 'cancelled' then now() else cancelled_at end,
      cancelled_by = case when p_next_status = 'cancelled' then p_actor_id else cancelled_by end
  where id = p_order_id;
end;
$$;

create function private.bootstrap_admin(p_user_id uuid, p_full_name text default null)
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

revoke all on schema private from public;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;
revoke all on function private.current_customer_id() from public;
revoke all on function private.is_admin() from public;
grant execute on function private.current_customer_id() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_before_order_cutoff() to service_role;
grant execute on function private.replace_order_items(uuid, jsonb) to service_role;

revoke all on function public.place_order(uuid, jsonb, date, text) from public, anon, authenticated;
revoke all on function public.update_pending_order(uuid, uuid, jsonb, date, text) from public, anon, authenticated;
revoke all on function public.cancel_pending_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.advance_order_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.place_order(uuid, jsonb, date, text) to service_role;
grant execute on function public.update_pending_order(uuid, uuid, jsonb, date, text) to service_role;
grant execute on function public.cancel_pending_order(uuid, uuid) to service_role;
grant execute on function public.advance_order_status(uuid, uuid, text) to service_role;
