-- Fresh install only. For the existing live project, run the files in /supabase/migrations instead.
-- 1) Run this file in Supabase: SQL Editor > New query > paste > Run
-- 2) Then run every file in /supabase/migrations in date order (RLS policies, admin allowlist,
--    column grants, consent trigger, spam guard, Make webhook and retention job).
create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  full_name       text not null check (char_length(full_name) between 2 and 120),
  whatsapp_number text not null check (char_length(whatsapp_number) between 7 and 20),
  email_address   text check (email_address is null or char_length(email_address) <= 254),
  status          text not null default 'New' check (status in ('New','Contacted','Converted','Lost')),
  deal_value      numeric(12,2) not null default 0 check (deal_value >= 0),
  source          text,
  campaign        text,
  ad              text,
  interest        text,
  score           smallint not null default 0,
  temperature     text not null default 'Cold',
  notes           text,
  contacted_at    timestamptz,
  consent_at      timestamptz,
  consent_version text,
  utm_medium      text,
  utm_term        text,
  fbclid          text,
  fbc             text,
  fbp             text
);

create index leads_created_at_idx on public.leads (created_at desc);

-- Locked until the migration adds policies (RLS on + no policies = nobody can read or write).
alter table public.leads enable row level security;
