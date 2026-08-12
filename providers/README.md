# Providers

Future vendor adapter boundaries. Phase 1 uses **deterministic adapters** that
return the same structured shapes later providers (transcription, event
detection, coaching, analysis, scoring, simulation) will return. Components
never connect directly to model calls, and there is no single giant AI service.

- `transcription/` — future mic/audio-to-segments (out of scope in Phase 1)
- `event-detection/` — segments -> structured events
- `coaching/` — events + state -> one suggestion (or none)
- `analysis/` — session -> post-call review payload
- `scoring/` — Opportunity Fit / Purchase Intent heuristics
- `simulation/` — the deterministic Phase 1 scenario engine

All future provider credentials stay server-side.
