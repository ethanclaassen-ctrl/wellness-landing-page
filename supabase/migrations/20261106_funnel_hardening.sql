-- =====================================================================
-- 2026-11-06  Funnel hardening: attribution columns, retention fix,
-- minimal Make/Telegram payload, spam guard.
-- Run AFTER 20261105_security_architecture.sql. Safe to re-run.
--
-- AFTER RUNNING: update the Make scenario mapping. The webhook now only
-- receives { id, name, temperature, interest, ts } (no phone/email/UTMs).
-- =====================================================================

-- ---------- 1. Attribution columns ----------
alter table public.leads add column if not exists utm_medium text;
alter table public.leads add column if not exists utm_term   text;
alter table public.leads add column if not exists fbclid     text;  -- raw ?fbclid= from the ad click
alter table public.leads add column if not exists fbc        text;  -- Meta _fbc cookie (or built from fbclid)
alter table public.leads add column if not exists fbp        text;  -- Meta _fbp browser id cookie

do $$ begin
  alter table public.leads add constraint leads_tracking_lengths check (
    char_length(coalesce(utm_medium,'')) <= 200 and
    char_length(coalesce(utm_term,''))   <= 200 and
    char_length(coalesce(fbclid,''))     <= 500 and
    char_length(coalesce(fbc,''))        <= 600 and
    char_length(coalesce(fbp,''))        <= 100) not valid;
exception when duplicate_object then null; end $$;

-- Anon may insert the new form columns too (column-level grant; anon still cannot read anything).
grant insert (utm_medium, utm_term, fbclid, fbc, fbp) on public.leads to anon;

-- ---------- 2. Public insert policy: also block source = 'dashboard' ----------
-- 'dashboard' marks manual entries by Bailey; they skip the alert and the spam guard,
-- so the public must not be able to claim it.
drop policy if exists "Public form inserts new leads" on public.leads;
create policy "Public form inserts new leads" on public.leads for insert to anon
  with check (
    status = 'New'
    and deal_value = 0
    and contacted_at is null
    and notes is null
    and consent_at is not null
    and coalesce(source, '') <> 'dashboard'
    and whatsapp_number ~ '^\+27[0-9]{9}$'
    and (email_address is null or email_address ~ '^\S+@\S+\.\S+$')
  );

-- ---------- 3. Spam guard: 24h dedupe + global hourly cap ----------
create index if not exists leads_phone_created_idx on public.leads (whatsapp_number, created_at desc);

create or replace function public.leads_spam_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'dashboard' then return new; end if;  -- Bailey's manual entries are never limited

  -- Same number within 24h: drop silently, so the visitor still sees the thank-you screen.
  if exists (select 1 from public.leads
             where whatsapp_number = new.whatsapp_number
               and created_at > now() - interval '24 hours') then
    return null;
  end if;

  -- Flood protection: more than 30 public submissions in the last hour is not real traffic.
  if (select count(*) from public.leads
      where created_at > now() - interval '1 hour'
        and coalesce(source, '') <> 'dashboard') >= 30 then
    raise exception 'Too many submissions, please try again later' using errcode = 'P0001';
  end if;

  return new;
end $$;
revoke all on function public.leads_spam_guard() from public, anon, authenticated;
drop trigger if exists leads_spam_guard on public.leads;
create trigger leads_spam_guard before insert on public.leads
  for each row execute function public.leads_spam_guard();

-- ---------- 4. Minimal Make payload (Telegram alert keeps no phone/email) ----------
create or replace function public.leads_notify_make() returns trigger
language plpgsql security definer set search_path = '' as $$
declare url text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'make_webhook_url' limit 1;
  if url is null or new.source = 'dashboard' then return new; end if;  -- manual dashboard entries don't ping
  perform net.http_post(
    url := url,
    body := jsonb_build_object(
      'id', new.id, 'name', new.full_name, 'temperature', new.temperature,
      'interest', new.interest, 'ts', new.created_at),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return new;
exception when others then
  raise warning 'leads_notify_make failed: %', sqlerrm;  -- never lose a lead because the webhook broke
  return new;
end $$;
revoke all on function public.leads_notify_make() from public, anon, authenticated;

-- ---------- 5. POPIA retention: everything except customers goes after 12 months ----------
-- cron.schedule with an existing job name replaces that job.
select cron.schedule('purge-stale-leads', '15 2 * * *', $job$
  delete from public.leads
  where created_at < now() - interval '12 months'
    and status <> 'Converted'
$job$);
