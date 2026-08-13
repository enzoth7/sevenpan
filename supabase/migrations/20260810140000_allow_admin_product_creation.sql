-- Allow authenticated administrators to create globally visible catalog products.

drop policy if exists "administrators may insert products" on public.products;
create policy "administrators may insert products"
  on public.products for insert to authenticated
  with check ((select private.is_admin()));

grant insert (id, name, detail, price, unit, category, tone, is_active)
  on public.products to authenticated;
