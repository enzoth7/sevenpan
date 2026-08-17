-- Pending, suspended, and paused customer accounts must not see the catalog.

drop policy if exists "products are visible to authenticated users" on public.products;
create policy "products are visible to active customers and admins"
  on public.products for select to authenticated
  using (
    (select private.is_admin())
    or (
      (select private.current_customer_id()) is not null
      and (
        is_active
        or exists (
          select 1
          from public.order_items item
          join public.orders order_header on order_header.id = item.order_id
          where item.product_id = products.id
            and order_header.customer_id = (select private.current_customer_id())
        )
      )
    )
  );
