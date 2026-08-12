-- ============================================================================
-- SignalDesk — Phase 1: ai_suggestions.superseded_by
-- File 3 of 3. Run AFTER 002_rls_policies.sql.
--
-- Adds the "superseded by" link to ai_suggestions so a superseded suggestion
-- is marked WITHOUT deleting history (spec: "Suggestions expire or are
-- superseded WITHOUT deleting history"). The engine (domain/simulation) sets
-- expires_at for expiry and superseded_by when a strictly-higher-priority
-- suggestion takes over the live recommendation.
--
-- Idempotency: add column if not exists + drop/recreate index, so re-running
-- a COMPLETED file is safe.
-- ============================================================================
begin;

alter table public.ai_suggestions
  add column if not exists superseded_by uuid references public.ai_suggestions (id) on delete set null;

drop index if exists ai_suggestions_superseded_by_idx;
create index ai_suggestions_superseded_by_idx on public.ai_suggestions (superseded_by);

commit;
