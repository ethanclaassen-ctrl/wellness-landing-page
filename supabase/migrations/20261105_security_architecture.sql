-- =====================================================================
-- 2026-11-05  Security + architecture migration for the LIVE project.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to re-run (idempotent).
--
-- BEFORE RUNNING, do these two things in the Supabase dashboard:
--   1. Database > Extensions: enable "pg_net" and "pg_cron".
--   2. Create a NEW webhook URL in Make (the old one was public in the
--      landing page source and should be considered burned), then store it:
--        select vault.create_secret('https://hook.eu1.make.com/NEW-ID', 'make_webhook_url');
--      (To change it later: select vault.update_secret(id, 'new-url') ...)
--
-- AFTER RUNNING, add Bailey's account to the admin allowlist (section 3).
-- =====================================================================

-- ---------- 1. New / missing columns ----------
alter table public.leads add column if not exists interest        text;
alter table public.leads add column if not exists score           smallint not null default 0;
alter table public.leads add column if not exists temperature     text not null default 'Cold';
alter table public.leads add column if not exists notes           text;
alter table public.leads add column if not exists contacted_at    timestamptz;
alter table public.leads add column if not exists email_address   text;
alter table public.leads add column if not exists consent_at      timestamptz;  -- set by the server, never by the client
alter table public.leads add column if not exists consent_version text;         -- which consent wording they agreed to

-- Sanity limits on what the public form can write. NOT VALID = don't re-check old rows.
do $$ begin
  alter table public.leads add constraint leads_score_range   check (score between 0 and 3) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.leads add constraint leads_temperature_chk check (temperature in ('Hot','Warm','Cold')) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.leads add constraint leads_text_lengths check (
    char_length(coalesce(interest,''))        <= 40  and
    char_length(coalesce(source,''))          <= 200 and
    char_length(coalesce(campaign,''))        <= 200 and
    char_length(coalesce(ad,''))              <= 200 and
    char_length(coalesce(consent_version,'')) <= 40  and
    char_length(coalesce(notes,''))           <= 5000) not valid;
exception when duplicate_object then null; end $$;

-- consent_at is stamped by the database so it can't be forged or back-dated.
create or replace function public.leads_stamp_consent() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.consent_version is not null then new.consent_at := now(); else new.consent_at := null; end if;
  return new;
end $$;
drop trigger if exists leads_stamp_consent on public.leads;
create trigger leads_stamp_consent before insert on public.leads
  for each row execute function public.leads_stamp_consent();

-- ---------- 2. Admin allowlist ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;   -- no policies: invisible to the API
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------- 3. Replace ALL existing policies on leads ----------
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'leads' loop
    execute format('drop policy %I on public.leads', p.policyname);
  end loop;
end $$;

alter table public.leads enable row level security;

-- Dashboard: only allowlisted users can see or change leads.
create policy "Admins manage leads" on public.leads for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Landing page: anonymous visitors may only create a brand-new, untouched, consented lead.
create policy "Public form inserts new leads" on public.leads for insert to anon
  with check (
    status = 'New'
    and deal_value = 0
    and contacted_at is null
    and notes is null
    and consent_at is not null
    and whatsapp_number ~ '^\+27[0-9]{9}$'
    and (email_address is null or email_address ~ '^\S+@\S+\.\S+$')
  );

-- Column-level grants: anon can INSERT only the form fields, and nothing else at all.
revoke all on public.leads from anon;
grant insert (full_name, whatsapp_number, email_address, interest, score, temperature,
              source, campaign, ad, consent_version) on public.leads to anon;

-- Add Bailey's dashboard account (replace the email, then run this line):
-- insert into public.admins (user_id) select id from auth.users where email = 'Bailey@EXAMPLE.COM' on conflict do nothing;

-- ---------- 4. Make.com notification fired by the database ----------
-- Only saved leads trigger Make, and the URL lives in Vault, not in any public file.
-- Payload keeps the same field names the browser used to send, so the Make scenario mapping still works.
create or replace function public.leads_notify_make() returns trigger
language plpgsql security definer set search_path = '' as $$
declare url text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'make_webhook_url' limit 1;
  if url is null or new.source = 'dashboard' then return new; end if;  -- manual dashboard entries don't ping
  perform net.http_post(
    url := url,
    body := jsonb_build_object(
      'id', new.id, 'name', new.full_name, 'whatsapp', new.whatsapp_number, 'email', new.email_address,
      'interest', new.interest, 'score', new.score, 'temperature', new.temperature,
      'source', new.source, 'campaign', new.campaign, 'ad', new.ad,
      'consent', new.consent_at is not null, 'ts', new.created_at),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return new;
exception when others then
  raise warning 'leads_notify_make failed: %', sqlerrm;  -- never lose a lead because the webhook broke
  return new;
end $$;
revoke all on function public.leads_notify_make() from public, anon, authenticated;
drop trigger if exists leads_notify_make on public.leads;
create trigger leads_notify_make after insert on public.leads
  for each row execute function public.leads_notify_make();

-- ---------- 5. POPIA retention: purge stale leads after 12 months ----------
-- Deletes Lost leads and leads that were never contacted. Converted / active leads are kept.
select cron.schedule('purge-stale-leads', '15 2 * * *', $job$
  delete from public.leads
  where created_at < now() - interval '12 months'
    and (status = 'Lost' or contacted_at is null)
$job$);

-- ---------- 6. Realtime (no-op if already added) ----------
do $$ begin
  alter publication supabase_realtime add table public.leads;
exception when duplicate_object then null; end $$;
