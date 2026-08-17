-- A one-time access code identifies the customer profile directly.
-- The previous four-argument function is retained during the rollout.

create index if not exists customer_activation_challenges_secret_purpose_active_idx
  on public.customer_activation_challenges(secret_hash, purpose, created_at desc)
  where used_at is null;

create or replace function public.redeem_customer_access_code(
  p_secret_hash text,
  p_purpose text
)
returns table (
  challenge_id uuid,
  profile_id uuid,
  access_status text,
  contact_email text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_challenge_id uuid;
  v_profile_id uuid;
  v_access_status text;
  v_contact_email text;
begin
  if p_purpose not in ('activation', 'recovery') then
    return;
  end if;

  select challenge.id, profile.id, profile.access_status, profile.contact_email
  into v_challenge_id, v_profile_id, v_access_status, v_contact_email
  from public.customer_activation_challenges challenge
  join public.profiles profile on profile.id = challenge.profile_id
  join public.customers customer on customer.id = profile.customer_id
  where customer.is_active
    and profile.role = 'customer'
    and challenge.secret_hash = p_secret_hash
    and challenge.purpose = p_purpose
    and challenge.used_at is null
    and challenge.expires_at > now()
    and (
      (p_purpose = 'activation' and profile.access_status = 'pending')
      or (p_purpose = 'recovery' and profile.access_status = 'active')
    )
  order by challenge.created_at desc
  limit 1
  for update of challenge;

  if not found then
    return;
  end if;

  update public.customer_activation_challenges
  set used_at = now()
  where id = v_challenge_id;

  return query select v_challenge_id, v_profile_id, v_access_status, v_contact_email;
end;
$$;

revoke all on function public.redeem_customer_access_code(text, text) from public, anon, authenticated;
grant execute on function public.redeem_customer_access_code(text, text) to service_role;
