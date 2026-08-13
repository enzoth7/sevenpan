-- Una panadería puede tener más de una cuenta cliente, todas asociadas al mismo customer_id.
alter table public.profiles
  drop constraint if exists profiles_customer_id_key;

create index if not exists profiles_customer_id_idx
  on public.profiles(customer_id)
  where customer_id is not null;
