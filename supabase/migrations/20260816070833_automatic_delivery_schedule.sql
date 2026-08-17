create or replace function private.delivery_date_for_order(p_ordered_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  with local_order as (
    select p_ordered_at at time zone 'America/Montevideo' as ordered_at
  )
  select ordered_at::date
    + case when ordered_at::time <= time '18:00:00' then 1 else 2 end
  from local_order;
$$;

create or replace function private.order_change_deadline(p_delivery_date date)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((p_delivery_date - 1) + time '18:00:00') at time zone 'America/Montevideo';
$$;

create or replace function private.set_order_delivery_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.delivery_date := private.delivery_date_for_order(coalesce(new.created_at, now()));
  return new;
end;
$$;

drop trigger if exists orders_assign_delivery_date on public.orders;
create trigger orders_assign_delivery_date
  before insert or update of created_at, delivery_date on public.orders
  for each row execute function private.set_order_delivery_date();

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
  select customer_id into v_customer_id
  from public.profiles
  where id = p_actor_id and role = 'customer';

  if v_customer_id is null then
    raise exception 'Solo una panaderia cliente puede crear comandas' using errcode = '42501';
  end if;

  -- p_delivery_date remains in the signature for API compatibility. The server
  -- is authoritative and always derives delivery from the confirmation time.
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
  select customer_id into v_customer_id
  from public.profiles
  where id = p_actor_id and role = 'customer';

  if v_customer_id is null then
    raise exception 'Solo una panaderia cliente puede modificar comandas' using errcode = '42501';
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

  -- Delivery is fixed when the order is created; p_delivery_date is ignored.
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
  select customer_id into v_customer_id
  from public.profiles
  where id = p_actor_id and role = 'customer';

  if v_customer_id is null then
    raise exception 'Solo una panaderia cliente puede cancelar comandas' using errcode = '42501';
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

comment on function private.delivery_date_for_order(timestamptz) is
  'Assigns delivery in America/Montevideo: through 18:00 next day, after 18:00 day after next.';
comment on function private.order_change_deadline(date) is
  'Returns the 18:00 America/Montevideo cutoff on the day before delivery.';

revoke all on function private.delivery_date_for_order(timestamptz) from public, anon, authenticated;
revoke all on function private.order_change_deadline(date) from public, anon, authenticated;
revoke all on function private.set_order_delivery_date() from public, anon, authenticated;
grant execute on function private.delivery_date_for_order(timestamptz) to service_role;
grant execute on function private.order_change_deadline(date) to service_role;

revoke all on function public.place_order(uuid, jsonb, date, text) from public, anon, authenticated;
revoke all on function public.update_pending_order(uuid, uuid, jsonb, date, text) from public, anon, authenticated;
revoke all on function public.cancel_pending_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.place_order(uuid, jsonb, date, text) to service_role;
grant execute on function public.update_pending_order(uuid, uuid, jsonb, date, text) to service_role;
grant execute on function public.cancel_pending_order(uuid, uuid) to service_role;
