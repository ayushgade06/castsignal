# Technical plan (as built)

## Verified live Qloo behavior (2026-10-29/30, our key)

- Base `https://hackathon.api.qloo.com`, header `X-Api-Key`, all GET.
- `/search?query=…&types=urn:entity:movie,urn:entity:tv_show` accepts multiple types (Severance → TV 2022, films 2006/1988). Search tag objects carry `name` but `id` is null.
- Person fit: `/v2/insights?filter.type=urn:entity:person&signal.interests.entities=<comps>&filter.results.entities=<shortlist>&feature.explainability=true` returns `query.affinity` and per-comp explainability. Sample: Jenna Ortega 0.827, Florence Pugh 0.825, Pete Davidson 0.781, Bad Bunny 0.723; **Daniel Kaluuya absent** (search resolves him with null popularity).
- Demographics: `filter.type=urn:demographics` batched; returns rows only for entities with data. **Pete Davidson returns none**, Kaluuya none.
- Wildcards: `filter.tags=urn:tag:genre:person:comedian` works; actor/musician person tags are ignored silently, so actors = person + `filter.popularity.min=0.6` + post-filter on tag names matching actor/actress; musicians = `urn:entity:artist` (Doja Cat, Olivia Rodrigo, Charli XCX… for the sample comps).
- Compare: `/v2/analysis/compare` returns `a`, `b`, `tags` (shared) and `matchEntities`. Side `a` for a person includes identity tags (ethnicity, gender, nationality, residence), which we filter out; we keep only genre/emotional-tone/aesthetic subtypes not present on the comps side.
- 404 = no results (treated as empty); 401 wrong host/key; 403 unsupported type; 400 bad params; 429 rate limit.

## Architecture

Next.js 16 App Router on Vercel; no database, no auth. Server-only Qloo client (`lib/qloo.ts`: 12 s timeout, one retry on 429/5xx/timeout with backoff, LRU+TTL cache, zod validation of used fields, logs endpoint+status only). Agent (`lib/agent.ts`): manual Claude tool-use loop (`claude-sonnet-5-5`, ≤12 iterations, parallel tool calls per turn) streaming SSE from `/api/run` (`maxDuration` 300). Tools operate on a `RunState` (`lib/run.ts`) that records every Qloo call in an evidence ledger and builds the Casting Board deterministically. `/api/baseline` = same brief to the LLM alone with structured output. `/api/resolve` = autocomplete. `/api/health`. Per-IP token bucket and zod allowlists on every route.

## Honesty guarantees in code

- The LLM never produces numbers: `finish` rejects rationales with digits, unknown evidence ids or no citation.
- Board numbers come only from Qloo responses or `lib/scoring.ts`.
- No silent fallback: Qloo errors mark the run "partial" and are shown with a retry; LLM failure still renders the Qloo-derived board with rationales marked unavailable.
- Fixtures exist only under `tests/fixtures/` and are unreachable from the app.

## Build order followed

1. Scaffold, MIT license, public repo, Vercel production deploy with env vars.
2. Qloo client, scoring, unit tests, live smoke (`pnpm smoke`).
3. Agent loop + SSE + tools + ledger, verified from the CLI (`pnpm agent`).
4. UI: landing, brief form, trace, Casting Board, refine, Why Qloo, memo export.
5. Hardening: error states, rate limits, mobile layout (verified at 375 px, no horizontal scroll), accessibility basics.
6. Docs and submission text.

## Deferred (not built)

TV-series mode, momentum badges via `/v2/trending`, territory heatmaps for international sales.
