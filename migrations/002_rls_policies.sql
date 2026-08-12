-- ============================================================================
-- SignalDesk — Phase 1 Row Level Security
-- File 2 of 2. Run AFTER 001_initial_schema.sql.
--
-- Enables RLS on ALL ten tables and defines per-table policies. Model:
--   * Every user may select/insert/update/delete only rows they own
--     (user_id = auth.uid(); profiles: id = auth.uid()).
--   * Child tables additionally require (via EXISTS) that the parent record
--     (call_sessions / prospects) belongs to the same user — knowing another
--     user's UUID can never be used to attach a record to their data.
--   * call_sessions / prospect_notes / activities / product_events verify the
--     ownership of any optional parent they reference (prospect, sales
--     profile, call) the same way.
--   * auth.uid() is derived server-side by Postgres from the request JWT;
--     a browser-supplied user_id is never trusted.
--   * anon gets NO table privileges; only the authenticated role can touch
--     tables, and RLS confines it to owned rows.
--   * The service_role key bypasses RLS by design and must NEVER be exposed
--     to the browser (see README).
--
-- Idempotency: policies are dropped before being created, so re-running a
-- completed file is safe.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Enable RLS on every table
-- ----------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.sales_profiles      enable row level security;
alter table public.prospects           enable row level security;
alter table public.prospect_notes      enable row level security;
alter table public.activities          enable row level security;
alter table public.call_sessions       enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.call_events         enable row level security;
alter table public.ai_suggestions      enable row level security;
alter table public.product_events      enable row level security;

-- ----------------------------------------------------------------------------
-- 2. Role privileges — least privilege
--    anon: no table access at all (public pages never query tables).
--    authenticated: full DML on tables, confined by RLS to owned rows.
--    service_role: untouched (bypasses RLS; never exposed to the browser).
-- ----------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Policies
-- ----------------------------------------------------------------------------

-- profiles: identity is the auth user id itself.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete using (id = auth.uid());

-- ----------------------------------------------------------------------------
-- Top-level tables: ownership is the user_id column itself.
-- ----------------------------------------------------------------------------

drop policy if exists sales_profiles_select_own on public.sales_profiles;
create policy sales_profiles_select_own on public.sales_profiles
  for select using (user_id = auth.uid());

drop policy if exists sales_profiles_insert_own on public.sales_profiles;
create policy sales_profiles_insert_own on public.sales_profiles
  for insert with check (user_id = auth.uid());

drop policy if exists sales_profiles_update_own on public.sales_profiles;
create policy sales_profiles_update_own on public.sales_profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists sales_profiles_delete_own on public.sales_profiles;
create policy sales_profiles_delete_own on public.sales_profiles
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- prospects
-- ----------------------------------------------------------------------------

drop policy if exists prospects_select_own on public.prospects;
create policy prospects_select_own on public.prospects
  for select using (user_id = auth.uid());

drop policy if exists prospects_insert_own on public.prospects;
create policy prospects_insert_own on public.prospects
  for insert with check (user_id = auth.uid());

drop policy if exists prospects_update_own on public.prospects;
create policy prospects_update_own on public.prospects
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists prospects_delete_own on public.prospects;
create policy prospects_delete_own on public.prospects
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- call_sessions — top-level, but any referenced prospect/sales profile must
-- also belong to the same user (a call can never be attached to another
-- user's prospect or profile).
-- ----------------------------------------------------------------------------

drop policy if exists call_sessions_select_own on public.call_sessions;
create policy call_sessions_select_own on public.call_sessions
  for select using (user_id = auth.uid());

drop policy if exists call_sessions_insert_own on public.call_sessions;
create policy call_sessions_insert_own on public.call_sessions
  for insert with check (
    user_id = auth.uid()
    and (
      prospect_id is null
      or exists (
        select 1 from public.prospects p
        where p.id = prospect_id and p.user_id = auth.uid()
      )
    )
    and (
      sales_profile_id is null
      or exists (
        select 1 from public.sales_profiles sp
        where sp.id = sales_profile_id and sp.user_id = auth.uid()
      )
    )
  );

drop policy if exists call_sessions_update_own on public.call_sessions;
create policy call_sessions_update_own on public.call_sessions
  for update using (user_id = auth.uid()) with check (
    user_id = auth.uid()
    and (
      prospect_id is null
      or exists (
        select 1 from public.prospects p
        where p.id = prospect_id and p.user_id = auth.uid()
      )
    )
    and (
      sales_profile_id is null
      or exists (
        select 1 from public.sales_profiles sp
        where sp.id = sales_profile_id and sp.user_id = auth.uid()
      )
    )
  );

drop policy if exists call_sessions_delete_own on public.call_sessions;
create policy call_sessions_delete_own on public.call_sessions
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Child tables — user_id = auth.uid() AND the parent call_sessions row belongs
-- to the same user.
-- ----------------------------------------------------------------------------

-- transcript_segments
drop policy if exists transcript_segments_select_own on public.transcript_segments;
create policy transcript_segments_select_own on public.transcript_segments
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

drop policy if exists transcript_segments_insert_own on public.transcript_segments;
create policy transcript_segments_insert_own on public.transcript_segments
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

drop policy if exists transcript_segments_update_own on public.transcript_segments;
create policy transcript_segments_update_own on public.transcript_segments
  for update using (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

drop policy if exists transcript_segments_delete_own on public.transcript_segments;
create policy transcript_segments_delete_own on public.transcript_segments
  for delete using (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

-- call_events
drop policy if exists call_events_select_own on public.call_events;
create policy call_events_select_own on public.call_events
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

drop policy if exists call_events_insert_own on public.call_events;
create policy call_events_insert_own on public.call_events
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

drop policy if exists call_events_update_own on public.call_events;
create policy call_events_update_own on public.call_events
  for update using (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

drop policy if exists call_events_delete_own on public.call_events;
create policy call_events_delete_own on public.call_events
  for delete using (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

-- ai_suggestions
drop policy if exists ai_suggestions_select_own on public.ai_suggestions;
create policy ai_suggestions_select_own on public.ai_suggestions
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

drop policy if exists ai_suggestions_insert_own on public.ai_suggestions;
create policy ai_suggestions_insert_own on public.ai_suggestions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

drop policy if exists ai_suggestions_update_own on public.ai_suggestions;
create policy ai_suggestions_update_own on public.ai_suggestions
  for update using (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

drop policy if exists ai_suggestions_delete_own on public.ai_suggestions;
create policy ai_suggestions_delete_own on public.ai_suggestions
  for delete using (
    user_id = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_id and cs.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- prospect_notes — parent is prospects; an optional call_id must also belong
-- to the same user.
-- ----------------------------------------------------------------------------

drop policy if exists prospect_notes_select_own on public.prospect_notes;
create policy prospect_notes_select_own on public.prospect_notes
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from public.prospects p
      where p.id = prospect_id and p.user_id = auth.uid()
    )
    and (
      call_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = call_id and cs.user_id = auth.uid()
      )
    )
  );

drop policy if exists prospect_notes_insert_own on public.prospect_notes;
create policy prospect_notes_insert_own on public.prospect_notes
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.prospects p
      where p.id = prospect_id and p.user_id = auth.uid()
    )
    and (
      call_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = call_id and cs.user_id = auth.uid()
      )
    )
  );

drop policy if exists prospect_notes_update_own on public.prospect_notes;
create policy prospect_notes_update_own on public.prospect_notes
  for update using (
    user_id = auth.uid()
    and exists (
      select 1 from public.prospects p
      where p.id = prospect_id and p.user_id = auth.uid()
    )
    and (
      call_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = call_id and cs.user_id = auth.uid()
      )
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.prospects p
      where p.id = prospect_id and p.user_id = auth.uid()
    )
    and (
      call_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = call_id and cs.user_id = auth.uid()
      )
    )
  );

drop policy if exists prospect_notes_delete_own on public.prospect_notes;
create policy prospect_notes_delete_own on public.prospect_notes
  for delete using (
    user_id = auth.uid()
    and exists (
      select 1 from public.prospects p
      where p.id = prospect_id and p.user_id = auth.uid()
    )
    and (
      call_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = call_id and cs.user_id = auth.uid()
      )
    )
  );

-- ----------------------------------------------------------------------------
-- activities — both optional parents (prospect_id, call_id) are verified when
-- present; either is enough for select when they belong to the user.
-- ----------------------------------------------------------------------------

drop policy if exists activities_select_own on public.activities;
create policy activities_select_own on public.activities
  for select using (
    user_id = auth.uid()
    and (
      prospect_id is null
      or exists (
        select 1 from public.prospects p
        where p.id = prospect_id and p.user_id = auth.uid()
      )
    )
    and (
      call_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = call_id and cs.user_id = auth.uid()
      )
    )
  );

drop policy if exists activities_insert_own on public.activities;
create policy activities_insert_own on public.activities
  for insert with check (
    user_id = auth.uid()
    and (
      prospect_id is null
      or exists (
        select 1 from public.prospects p
        where p.id = prospect_id and p.user_id = auth.uid()
      )
    )
    and (
      call_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = call_id and cs.user_id = auth.uid()
      )
    )
  );

drop policy if exists activities_update_own on public.activities;
create policy activities_update_own on public.activities
  for update using (
    user_id = auth.uid()
    and (
      prospect_id is null
      or exists (
        select 1 from public.prospects p
        where p.id = prospect_id and p.user_id = auth.uid()
      )
    )
    and (
      call_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = call_id and cs.user_id = auth.uid()
      )
    )
  ) with check (
    user_id = auth.uid()
    and (
      prospect_id is null
      or exists (
        select 1 from public.prospects p
        where p.id = prospect_id and p.user_id = auth.uid()
      )
    )
    and (
      call_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = call_id and cs.user_id = auth.uid()
      )
    )
  );

drop policy if exists activities_delete_own on public.activities;
create policy activities_delete_own on public.activities
  for delete using (
    user_id = auth.uid()
    and (
      prospect_id is null
      or exists (
        select 1 from public.prospects p
        where p.id = prospect_id and p.user_id = auth.uid()
      )
    )
    and (
      call_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = call_id and cs.user_id = auth.uid()
      )
    )
  );

-- ----------------------------------------------------------------------------
-- product_events — top-level ownership, plus verification of the optional
-- session reference (session lifecycle events cannot point at another user's
-- call session).
-- ----------------------------------------------------------------------------

drop policy if exists product_events_select_own on public.product_events;
create policy product_events_select_own on public.product_events
  for select using (user_id = auth.uid());

drop policy if exists product_events_insert_own on public.product_events;
create policy product_events_insert_own on public.product_events
  for insert with check (
    user_id = auth.uid()
    and (
      session_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = session_id and cs.user_id = auth.uid()
      )
    )
  );

drop policy if exists product_events_update_own on public.product_events;
create policy product_events_update_own on public.product_events
  for update using (user_id = auth.uid()) with check (
    user_id = auth.uid()
    and (
      session_id is null
      or exists (
        select 1 from public.call_sessions cs
        where cs.id = session_id and cs.user_id = auth.uid()
      )
    )
  );

drop policy if exists product_events_delete_own on public.product_events;
create policy product_events_delete_own on public.product_events
  for delete using (user_id = auth.uid());

commit;
