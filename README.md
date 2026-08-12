# SignalDesk

An AI sales copilot that tells a salesperson what to ask, say, or do next —
before, during, and after a sales conversation.

## Product purpose

SignalDesk is organized around **Before the call** (who the prospect is + call
strategy), **During** (one concise live recommendation at the right moment,
quiet Listening otherwise), and **After** (evidence-based review, coaching, and
next steps). The core promise: *SignalDesk understands what is happening in a
sales conversation and tells the salesperson what to ask, say, or do next.*

## Simulated limitations (Phase 1)

Phase 1 ships the complete product experience over **clearly labeled simulated
calls** only:

- No microphone capture, no live transcription, no production AI calls
- No Twilio, dialing, scraping, CRM integrations, or native apps
- No OpenAI / transcription / Twilio / CRM keys are required
- Scores are explainable evidence-based heuristics — never invented
- Future provider credentials stay server-side behind clean service boundaries

## Prerequisites

- Node.js >= 20 (developed on Node 22)
- npm (>= 10)
- A Supabase project (Auth + Postgres) for real auth — needed from the auth
  milestone onward

## Installation

```bash
npm install
cp .env.example .env.local   # add real values when Supabase is connected
npm run dev
```

## Supabase setup

1. Create a project at supabase.com.
2. Copy the project URL and anon (publishable) key into `.env.local`:
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Enable Email/password auth provider.
4. Never expose a service-role key to the browser; never disable RLS.

## Database migration & RLS

- SQL migrations live in `migrations/` — see `migrations/README.md` for how to
  apply. `001_initial_schema.sql` creates the schema, `002_rls_policies.sql`
  enables RLS (apply both via the Supabase SQL Editor, in order).
- Every user-owned table enables RLS via `auth.uid()`; users may only
  select/insert/update/delete rows they own, and related ownership is verified
  (knowing another user's UUID must not allow attaching records to theirs).
- A two-user RLS isolation test is planned for every user-owned table.

## Auth redirects

Planned: `/login` -> `/home` after sign-in; `/signup` -> Sales Profile
onboarding; `/logout` -> `/`; password-reset request at `/forgot-password`.
Auth itself is not wired yet in this milestone.

## Environment variables

See `.env.example` (names only):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Local commands

| Command            | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `npm run dev`      | Start the dev server                         |
| `npm run lint`     | ESLint (flat config)                         |
| `npm run typecheck`| `tsc --noEmit` (strict)                      |
| `npm run test`     | Vitest unit tests                            |
| `npm run test:e2e` | Playwright e2e (browsers not installed yet)  |
| `npm run build`    | Production build                             |
| `npm run check`    | lint + typecheck + test + build              |

## Tests

- `tests/unit/` — Vitest smoke test now; schema, session-transition, event
  precedence, cooldown, deduplication, LISTEN, scoring, pipeline, and
  UUID-safe function tests planned
- `tests/integration/` — planned: ownership isolation, ordered transcripts,
  review persistence, generated-note idempotency, pipeline application
- `tests/e2e/` — planned Playwright golden path (install browsers with
  `npx playwright install` in the e2e milestone)

## Practice flow

The deterministic **ABC Roofing** scenario exercises the whole loop: quiet
listening, a $500 price objection -> **ASK NEXT** value question (not a
discount), LISTEN, buying signals, evidence-based review, and a
Contacted -> Qualified recommendation. Everything is visibly labeled
**PRACTICE** / simulated.

## Vercel deployment

The app is Vercel-compatible (App Router, server routes/actions, no native
dependencies). Set the two env vars in the Vercel project settings. Supabase
URL/anon key are public by design; RLS protects data.

## Known limitations

- Placeholder pages for all routes (structure in place, features land in
  later milestones)
- Supabase not connected yet — owner must provision a project and share the
  URL + anon key as secrets
- Playwright browsers not installed (by design, e2e milestone)
- No microphone/transcription/AI/Twilio/CRM — Phase 1 is simulated only

## Future phases

1. Auth + RLS + schema migrations (profiles, sales profiles, prospects, call
   sessions, transcript segments, call events, ai suggestions, activities,
   notes, product events)
2. Prospects CRUD, Command Center, Call Strategy brief
3. Live-call workspace + ABC Roofing simulation engine
4. Post-call review, pipeline, coach
5. Real providers behind the service boundaries (transcription, event
   detection, coaching, analysis, scoring) with credentials server-side
