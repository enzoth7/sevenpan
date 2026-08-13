drop policy if exists "products are visible to authenticated users" on public.products;

create policy "products are visible to authenticated users"
  on public.products for select to authenticated
  using (
    is_active
    or (select public.is_admin())
    or exists (
      select 1
      from public.order_items item
      join public.orders order_header on order_header.id = item.order_id
      where item.product_id = products.id
        and order_header.customer_id = (select public.current_customer_id())
    )
  );
