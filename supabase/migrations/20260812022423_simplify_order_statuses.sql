create or replace function public.advance_order_status(
  p_actor_id uuid,
  p_order_id uuid,
  p_next_status text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_status text;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and role = 'admin'
  ) then
    raise exception 'Solo un administrador puede actualizar estados' using errcode = '42501';
  end if;

  select status into v_current_status
  from public.orders
  where id = p_order_id
  for update;

  if v_current_status is null then
    raise exception 'Comanda no encontrada';
  end if;

  if v_current_status in ('delivered', 'cancelled')
    or p_next_status not in ('delivered', 'cancelled') then
    raise exception 'Transicion de estado no permitida';
  end if;

  update public.orders
  set status = p_next_status,
      cancelled_at = case when p_next_status = 'cancelled' then now() else null end,
      cancelled_by = case when p_next_status = 'cancelled' then p_actor_id else null end
  where id = p_order_id;
end;
$$;

revoke all on function public.advance_order_status(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.advance_order_status(uuid, uuid, text)
  to service_role;
