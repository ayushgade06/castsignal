# Devpost submission — CastSignal

## Title
CastSignal — cast for the audience, not just the headline

## Tagline (≤200 chars)
An AI casting agent that uses Qloo taste data to score your shortlist on real audience fit and reach, find cross-over wildcards, and propose the ensemble that reaches the most new fans.

## Links
- **Demo:** https://castsignal.vercel.app — no login. Click **Try the sample project** (~40–60 s live run).
- **Repo:** https://github.com/ayushgade06/castsignal (MIT)

---

## The problem
Every indie film or series has to answer the same question for each role: *who should we cast?* Studios buy casting analytics; indie producers and casting directors get agent pitches and popularity rankings. But popularity isn't fit. The questions that matter for financing and marketing are: **do this person's fans already love projects like ours, and which audiences would they bring that we don't already reach?** An LLM can only guess at that. Qloo measures it.

## Who it's for
Indie film/TV producers, casting directors and development executives preparing a cast wish-list and a financing or pre-sales pitch.

## What it does
1. **Brief:** project title and logline, 2–5 comparable titles (autocomplete from Qloo), optional target audience segments, and up to three roles with a 2–6 person shortlist each.
2. **Agent run (live trace):** the agent resolves every name in Qloo (settling or asking about ambiguous ones), scores each role's shortlist against the comps' audience, pulls demographics for everyone, compares taste themes, and hunts for cross-over wildcards. Every Qloo call shows up in the trace with its endpoint, parameters, result count and latency.
3. **Casting Board:**
   - a Fit × Reach quadrant per role (Safe bet / Audience expander / Cult pick / Risky);
   - demographic strips against the comps' baseline;
   - Qloo-surfaced wildcards with the comp that drove each;
   - a recommended ensemble with target-audience coverage before and after;
   - candidate cards with explainability, compare themes, popularity percentile and a two-sentence rationale citing evidence ids;
   - an honest **"Not enough Qloo data"** badge where Qloo can't speak.
4. **Refine in one sentence:** "Keep Florence Pugh; we can only afford one A-lister." / "We need to reach women 35–44." / "Swap Barbarian for Scream." The agent turns that into constraint or brief changes, re-runs only what's needed (cached Qloo calls are reused), and shows the diff.
5. **Why Qloo?** The same brief answered by the LLM alone, side by side with the Qloo-grounded answer: disagreements highlighted, the LLM's audience claims fact-checked against Qloo demographics, and every Qloo call listed.
6. **Casting memo:** print to PDF or download as Markdown, with evidence footnotes and a methodology/limits note.

## How the agent works
A manual Claude tool-use loop (`claude-sonnet-5-5`, at most 12 turns, parallel tool calls) over Qloo-backed tools:

`resolve_entities` → (`choose_entity` | `ask_user`) → `score_fit` per role ∥ `get_demographics` → `compare_audiences` → `find_wildcards` → `optimize_ensemble` → `finish`

- The agent decides how to settle ambiguity (e.g. "Scream" 1996 vs 2022), which candidates to compare, which wildcard kinds suit the project's tone, and how to translate a refine sentence into structured constraints.
- **The LLM never produces numbers.** Every number comes from Qloo or from a deterministic, unit-tested TypeScript optimizer (rank-normalization within a call, reach gain against the comps' baseline, and a brute-force ensemble search with fit floor, must-include/exclude, A-lister cap and no duplicates).
- `finish` is validated on the server: rationales citing unknown evidence ids, missing a citation, or containing digits are rejected and the agent must fix them.
- After the loop the server rebuilds the board deterministically from the evidence ledger. If Qloo fails, results are labelled **partial** with a retry. There is no silent LLM fallback. If the LLM fails, the Qloo evidence and scores still render, with rationales marked unavailable.

## Exactly how Qloo is used
| Endpoint | Why |
|---|---|
| `GET /search` (movie + TV, person) | Resolve comps and people, with disambiguation |
| `GET /v2/insights` `filter.type=urn:entity:person` + `filter.results.entities` + `feature.explainability=true` | Fit of a whole shortlist to the comps' audience in one call, plus which comp drove each score |
| `GET /v2/insights` `filter.type=urn:demographics` | Age-band and gender over/under-index for comps, candidates and wildcards (one batched call) |
| `GET /v2/insights` with `filter.tags=urn:tag:genre:person:comedian`, `urn:entity:artist`, or person + `filter.popularity.min` + tag post-filter | Cross-over wildcard discovery (comedians / musicians / actors) |
| `GET /v2/analysis/compare` | Taste themes a candidate's audience brings that the comps don't (identity-attribute tags are filtered out) |

Redacted request → result example (real, from the sample):
```
GET /v2/insights?filter.type=urn:entity:person
  &signal.interests.entities=<Get Out, Barbarian, Ready or Not>
  &filter.results.entities=<Jenna Ortega, Florence Pugh, Daniel Kaluuya, Bad Bunny, Pete Davidson>
  &feature.explainability=true
→ 4 results: Jenna Ortega (affinity 0.827, top driver: Ready or Not), Florence Pugh 0.825,
  Pete Davidson 0.781, Bad Bunny 0.723. Daniel Kaluuya absent → shown as "Not enough Qloo data".
```

## "Why Qloo?" findings from real runs (2026-10-30, sample project)
LLM output varies between runs; these are from runs we observed.
- The LLM alone ranked **Daniel Kaluuya third** for the lead. Qloo has no affinity or demographic data for his audience against these comps, so the LLM's confidence had nothing measurable behind it.
- For the comedic best friend, the LLM alone put **Rachel Sennott first**. Qloo's measured audience overlap put **Bowen Yang first** and Sennott third. Yet the optimizer still chose Sennott for **reach**: her audience over-indexes on segments the comps under-cover. That's a distinction the LLM-only answer didn't draw.
- In one run, the fact-check of the LLM's "which segments do their fans over-index on" claims came out **15 confirmed, 5 contradicted, 6 unverifiable** (no Qloo data for that person).
- Wildcards: Qloo surfaced comedians whose fans match the comps (Allison Williams, Brett Gelman, Nik Dodani, Ali Wong, Aubrey Plaza). The LLM alone suggested Aubrey Plaza, Nick Kroll, Sandra Oh, Jack Black and Olivia Rodrigo: one overlap among the comedians, and its other picks are unmeasured guesses.

## Built with
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Claude (Anthropic TypeScript SDK) · Qloo Taste AI API · zod · vitest · Vercel

## Limitations & responsible use
- Affinity describes aggregate audience taste, never facts about an individual. CastSignal is not a box-office predictor and makes no judgment of talent or worth.
- Qloo coverage varies by person; gaps are shown, never filled.
- Demographics are relative indices across eight segments; no territory data yet.
- Scores are normalized per query, so comparisons are only made within a call; the UI shows bands and ranks rather than false precision.
- The "Why Qloo?" panel is an illustrative live comparison, not a benchmark.

## What's next
TV-series mode (season arcs, recurring roles), momentum badges via `/v2/trending`, and territory heatmaps for international sales and pre-sales.

## Testing instructions
Open https://castsignal.vercel.app → **Try the sample project** → wait ~40–60 s for the live run → explore the quadrant, open candidate cards (try Daniel Kaluuya for the no-data case), check the wildcards, refine with one of the suggestion chips, then open **Why Qloo?**. "Start your own" lets you enter any comps and shortlist.

All code was written during the submission period.

---

## 2-minute video script
- **0:00–0:15 Landing.** "Popularity isn't fit. CastSignal casts for the audience." Click *Try the sample project*.
- **0:15–0:40 Live run.** The trace shows the agent resolving names, scoring fit, pulling demographics, comparing taste and hunting wildcards, with every Qloo call listed.
- **0:40–1:05 Casting Board.** The quadrant: Ortega a safe bet, Pugh an audience expander. Then the recommended ensemble and coverage before and after. Open Kaluuya's card: "Not enough Qloo data — decide on track record."
- **1:05–1:20 Surprise wildcard.** Comedians whose fans already love Get Out (Allison Williams, Ali Wong…), each with the comp that drove the fit.
- **1:20–1:40 Refine.** Type "We need to reach women 35–44." The ensemble changes, with the diff and the reason.
- **1:40–2:00 Why Qloo?** The LLM alone ranked a no-data actor third and picked a different best friend; its audience claims are fact-checked live. Close: "Every number traces to a Qloo call."
