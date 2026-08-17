-- Manual one-time access codes for customer activation and password recovery.

alter table public.customer_activation_challenges
  add column if not exists purpose text not null default 'activation',
  add column if not exists issued_by uuid,
  alter column request_fingerprint drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_activation_challenges_purpose_check'
      and conrelid = 'public.customer_activation_challenges'::regclass
  ) then
    alter table public.customer_activation_challenges
      add constraint customer_activation_challenges_purpose_check
      check (purpose in ('activation', 'recovery'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_activation_challenges_issued_by_fkey'
      and conrelid = 'public.customer_activation_challenges'::regclass
  ) then
    alter table public.customer_activation_challenges
      add constraint customer_activation_challenges_issued_by_fkey
      foreign key (issued_by) references public.profiles(id) on delete set null;
  end if;
end $$;

-- Email OTP challenges cannot be redeemed by the new manual flow.
update public.customer_activation_challenges
set used_at = now()
where used_at is null;

create index if not exists customer_activation_challenges_profile_purpose_active_idx
  on public.customer_activation_challenges(profile_id, purpose, created_at desc)
  where used_at is null;

create table if not exists public.customer_access_attempts (
  id bigint generated always as identity primary key,
  request_fingerprint text not null,
  successful boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists customer_access_attempts_fingerprint_created_idx
  on public.customer_access_attempts(request_fingerprint, created_at desc);

alter table public.customer_access_attempts enable row level security;
revoke all on public.customer_access_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.customer_access_attempts to service_role;
grant usage, select on sequence public.customer_access_attempts_id_seq to service_role;

create or replace function public.redeem_customer_access_code(
  p_customer_code text,
  p_contact_email text,
  p_secret_hash text,
  p_purpose text
)
returns table (
  challenge_id uuid,
  profile_id uuid,
  access_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_challenge_id uuid;
  v_profile_id uuid;
  v_access_status text;
begin
  if p_purpose not in ('activation', 'recovery') then
    return;
  end if;

  select challenge.id, profile.id, profile.access_status
  into v_challenge_id, v_profile_id, v_access_status
  from public.customers customer
  join public.profiles profile on profile.customer_id = customer.id
  join public.customer_activation_challenges challenge on challenge.profile_id = profile.id
  where customer.customer_code = upper(trim(p_customer_code))
    and customer.is_active
    and profile.role = 'customer'
    and profile.contact_email = lower(trim(p_contact_email))
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

  return query select v_challenge_id, v_profile_id, v_access_status;
end;
$$;

revoke all on function public.redeem_customer_access_code(text, text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_customer_access_code(text, text, text, text) to service_role;
