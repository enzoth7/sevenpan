drop policy if exists "customers may update delivery data" on public.customers;

create policy "customers may update their own delivery data"
  on public.customers for update to authenticated
  using (id = (select private.current_customer_id()))
  with check (id = (select private.current_customer_id()));
