-- PropTech · Auto Listing. Run after workspaces.sql. Additive only and safe to re-run.
-- An agency is a workspace, so every table carries workspace_id and every query filters on it.

-- Feature flags per workspace (PropTech shows only when 'proptech_auto_listing' is in here).
alter table public.workspaces add column if not exists features text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- Listings
-- ---------------------------------------------------------------------------
create table if not exists public.listings (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      text not null references public.workspaces (id) on delete cascade,
  created_by        text not null,                               -- app_users.username
  agent_id          text,                                        -- app_users.username of the listing agent
  status            text not null default 'draft'
                    check (status in ('draft', 'processing', 'review', 'approved', 'published', 'archived', 'failed')),
  offering_type     text check (offering_type in ('sale', 'rent')),
  category          text check (category in ('residential', 'commercial')),
  property_type     text,
  completion_status text check (completion_status in ('ready', 'off_plan')),
  emirate           text,
  community         text,
  sub_community     text,
  building          text,
  unit_number       text,
  bedrooms          integer,                                     -- 0 = studio
  bathrooms         integer,
  size_sqft         numeric,
  plot_sqft         numeric,
  parking           integer,
  furnishing        text check (furnishing in ('furnished', 'semi_furnished', 'unfurnished')),
  view              text,
  floor             text,
  amenities         text[] not null default '{}',
  price             numeric,
  price_type        text check (price_type in ('sale', 'yearly', 'monthly')),
  cheques           integer,
  service_charge    numeric,                                     -- AED per sqft per year
  developer         text,
  handover_date     date,
  payment_plan      text,
  permit_number     text,                                        -- Trakheesi / DLD advertising permit, entered by hand
  permit_expiry     date,
  agency_orn        text,
  agent_brn         text,
  form_a_number     text,
  form_a_expiry     date,
  title_en          text,
  title_ar          text,
  description_en    text,
  description_ar    text,
  tone              text not null default 'professional' check (tone in ('professional', 'luxury', 'investor')),
  -- Owner name, Emirates ID / passport and phone: AES-GCM encrypted JSON. Never published or sent to a portal.
  owner_pii         text,
  field_confidence  jsonb not null default '{}'::jsonb,          -- { field: 0..1 }
  field_source      jsonb not null default '{}'::jsonb,          -- { field: { source, page?, snippet? } }
  ai_questions      jsonb not null default '[]'::jsonb,          -- "AI asks" chips for missing required fields
  progress          jsonb not null default '{}'::jsonb,          -- { step, label, done[] } while processing
  ai_cost_usd       numeric not null default 0,
  ai_tokens         integer not null default 0,
  approved_at       timestamptz,
  approved_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists listings_ws_idx on public.listings (workspace_id, created_at desc);
create index if not exists listings_ws_status_idx on public.listings (workspace_id, status);
alter table public.listings enable row level security;

-- Photos, floor plans, documents and audio. `path` is the object key in the private "proptech" bucket.
create table if not exists public.listing_media (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  listing_id   uuid not null references public.listings (id) on delete cascade,
  path         text not null,                                    -- {workspace}/{listing}/{uuid}.{ext}
  kind         text not null check (kind in ('photo', 'floorplan', 'form_a', 'document', 'audio')),
  doc_type     text,                                             -- title_deed | oqood | other (for kind = document)
  file_name    text not null default '',
  mime_type    text not null default '',
  size_bytes   integer not null default 0,
  width        integer,
  height       integer,
  room_type    text,
  sort_order   integer not null default 0,
  is_cover     boolean not null default false,
  removed      boolean not null default false,                   -- removed in the photo manager (kept for the audit trail)
  flags        jsonb not null default '{}'::jsonb,               -- { blurry, dark, duplicate, watermark, phone_visible, people_visible }
  created_at   timestamptz not null default now()
);
create index if not exists listing_media_listing_idx on public.listing_media (listing_id, sort_order);
create index if not exists listing_media_ws_idx on public.listing_media (workspace_id);
alter table public.listing_media enable row level security;

-- What the agent gave us, and what the AI read from it.
create table if not exists public.listing_inputs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      text not null references public.workspaces (id) on delete cascade,
  listing_id        uuid not null unique references public.listings (id) on delete cascade,
  agent_notes       text not null default '',
  voice_transcript  text not null default '',
  voice_facts       jsonb not null default '{}'::jsonb,
  extraction_raw    jsonb,                                       -- last validated ListingDraft from Gemini
  photo_analysis    jsonb,
  prompt_versions   jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.listing_inputs enable row level security;

-- ---------------------------------------------------------------------------
-- Portals
-- ---------------------------------------------------------------------------
create table if not exists public.portal_connections (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  portal       text not null check (portal in ('propertyfinder', 'bayut', 'mock')),
  enabled      boolean not null default true,
  mode         text not null default 'sandbox' check (mode in ('sandbox', 'live')),
  credentials  text,                                             -- AES-GCM encrypted JSON, never returned to the browser
  feed_token   text,                                             -- Bayut feed URL token
  defaults     jsonb not null default '{}'::jsonb,               -- { orn, agents: { username: { brn, portalAgentId } }, mock: {...} }
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, portal)
);
alter table public.portal_connections enable row level security;

create table if not exists public.portal_listings (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   text not null references public.workspaces (id) on delete cascade,
  listing_id     uuid not null references public.listings (id) on delete cascade,
  portal         text not null check (portal in ('propertyfinder', 'bayut', 'mock')),
  external_id    text,
  status         text not null default 'draft'
                 check (status in ('draft', 'queued', 'submitted', 'live', 'rejected', 'expired', 'unpublished')),
  last_error     jsonb,                                          -- { code, message, plain, field }
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (listing_id, portal)
);
create index if not exists portal_listings_ws_idx on public.portal_listings (workspace_id, portal, status);
alter table public.portal_listings enable row level security;

-- Every outbound portal call, feed generation and feed fetch.
create table if not exists public.portal_events (
  id           bigint generated always as identity primary key,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  listing_id   uuid references public.listings (id) on delete cascade,
  portal       text not null,
  action       text not null,                                    -- publish | update | unpublish | status | feed_generate | feed_fetch | leads_received | validate
  ok           boolean not null default true,
  request      jsonb,
  response     jsonb,
  error        text,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);
create index if not exists portal_events_listing_idx on public.portal_events (listing_id, created_at desc);
create index if not exists portal_events_ws_idx on public.portal_events (workspace_id, portal, action, created_at desc);
alter table public.portal_events enable row level security;

-- Who published, unpublished or edited a permit, and when.
create table if not exists public.listing_audit (
  id           bigint generated always as identity primary key,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  listing_id   uuid not null references public.listings (id) on delete cascade,
  actor        text not null,
  action       text not null,                                    -- approve | publish | unpublish | permit_edit | duplicate
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists listing_audit_listing_idx on public.listing_audit (listing_id, created_at desc);
alter table public.listing_audit enable row level security;

-- Gemini calls: tokens and cost per listing.
create table if not exists public.ai_usage (
  id            bigint generated always as identity primary key,
  workspace_id  text not null references public.workspaces (id) on delete cascade,
  listing_id    uuid references public.listings (id) on delete cascade,
  task          text not null,                                   -- extract_form_a | analyse_photos | transcribe_notes | copy_en | copy_ar
  prompt_version text not null default '',
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric not null default 0,
  ok            boolean not null default true,
  error         text,
  duration_ms   integer,
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_listing_idx on public.ai_usage (listing_id);
alter table public.ai_usage enable row level security;

-- ---------------------------------------------------------------------------
-- Background jobs (claimed by the in-process worker with FOR UPDATE SKIP LOCKED)
-- ---------------------------------------------------------------------------
create table if not exists public.proptech_jobs (
  id           bigint generated always as identity primary key,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  listing_id   uuid references public.listings (id) on delete cascade,
  kind         text not null,                                    -- process_listing | regenerate_copy | portal_publish | portal_update | portal_unpublish | portal_status
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts     integer not null default 0,
  max_attempts integer not null default 3,
  run_at       timestamptz not null default now(),
  locked_until timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists proptech_jobs_due_idx on public.proptech_jobs (status, run_at);
alter table public.proptech_jobs enable row level security;

-- Claim up to n due jobs. A running job whose lease ran out (server restarted mid-job) is claimed again.
create or replace function public.proptech_claim_jobs(n integer default 3, lease_seconds integer default 180)
returns setof public.proptech_jobs
language sql
as $$
  update public.proptech_jobs j
     set status = 'running', attempts = j.attempts + 1, locked_until = now() + make_interval(secs => lease_seconds), updated_at = now()
   where j.id in (
     select id from public.proptech_jobs
      where (status = 'queued' and run_at <= now())
         or (status = 'running' and locked_until < now())
      order by run_at
      limit n
      for update skip locked
   )
  returning j.*;
$$;

-- ---------------------------------------------------------------------------
-- Caches
-- ---------------------------------------------------------------------------
-- Property Finder location tree, cached per mode so we don't look up the same community twice.
create table if not exists public.pf_locations (
  mode        text not null check (mode in ('sandbox', 'live')),
  location_id text not null,
  name        text not null,
  path        text not null default '',                          -- "Dubai > Dubai Marina > Marina Gate 1"
  type        text not null default '',
  fetched_at  timestamptz not null default now(),
  primary key (mode, location_id)
);
create index if not exists pf_locations_name_idx on public.pf_locations (mode, lower(name));
alter table public.pf_locations enable row level security;

-- The last feed that passed validation, served if a newer one fails.
create table if not exists public.bayut_feed_cache (
  workspace_id  text primary key references public.workspaces (id) on delete cascade,
  xml           text not null,
  listing_count integer not null default 0,
  generated_at  timestamptz not null default now(),
  last_error    text,
  last_error_at timestamptz,
  last_fetched_at timestamptz
);
alter table public.bayut_feed_cache enable row level security;

-- Private bucket for uploads (served only through short-lived signed URLs).
insert into storage.buckets (id, name, public, file_size_limit)
values ('proptech', 'proptech', false, 52428800)
on conflict (id) do nothing;

-- Only the server (secret key) may claim jobs.
revoke execute on function public.proptech_claim_jobs(integer, integer) from public, anon, authenticated;
alter function public.proptech_claim_jobs(integer, integer) set search_path = public;
