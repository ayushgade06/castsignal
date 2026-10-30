# Competition analysis

> Method note: Devpost pages returned HTTP 403 to automated fetching, so details below come from Devpost search summaries, the winners' public JSON-LD/project pages as summarized during research on 2026-10-29, and the Qloo developer docs. Claims about other projects are as observed then and may have changed.

## Rules summary (Qloo Agentic Hackathon 2026)

- Theme: "Agents, but with taste." Stage 1 is pass/fail: fits the theme and genuinely uses the Qloo API.
- Stage 2 criteria: **Technological Implementation** (depth and skill of Qloo use; real code), **Design** (complete, coherent product), **Potential Impact** (credible problem, specific audience), **Quality of the Idea** (creative, non-obvious).
- Central test: *would this work just as well without Qloo?* The answer must visibly be no.
- Requirements: working agentic app integrating Qloo; publicly hosted, free, no login for judges; public repo with an OSI license; README; English description; work done in the submission period.
- Deadline: Oct 30, 2026, 11:45 PM ET.

## 2025 Qloo LLM Hackathon winners (344 entries)

| Project | Award | What it did | Qloo depth | Notes |
|---|---|---|---|---|
| GeoTaste | Grand Prize | Flask app; two `/v2/insights` calls (brands, places by city) then GPT-4.1 analysis | Shallow | No real agent loop; several charts simulated with `random`; no license; hard-coded key; demo down today |
| Alloy (Axiom) | Honorable Mention | M&A "cultural due diligence", hand-rolled ReAct agent on Gemini | Medium | Score = Jaccard overlap of Qloo tag sets; silently falls back to the LLM when Qloo fails; MIT |
| Zesty | Honorable Mention | "Unrecommendation" engine | Low | Qloo path largely broken/mocked; won on concept |
| Resonance AI | Honorable Mention | Political campaign messaging on Google ADK | Deepest | Audiences, demographics, heatmaps, `bias.trends`; rough UX (ADK dev UI + Streamlit) |

**Interpretation.** Winners had a specific buyer with money at stake, visual output, and a tangible artifact (report/score). None combined deep Qloo use, a real tool-calling agent, polish, *and* a demo that stays up. That combination is CastSignal's target.

## 2026 landscape

Devpost search shows roughly 586 Qloo projects (gallery unpublished at research time). Crowded themes:

- Group/couple "common ground" (~96)
- Brand, launch and sponsorship (~107)
- Live music, tour routing, openers (~54: Swami, Headliner, LineupLab, Tourscout, Roadie, Stagehand)
- Festival timetables (Interval)
- Dementia reminiscence (~29)
- Relocation and travel; podcasts and guest booking
- Comps for pitches (Meets, Comps, FirstPlayable); release-date dodging (Clear Run, Quiet Week)

Table stakes now: "receipts" for every Qloo call and an LLM-only comparison. Having them earns little; missing them costs.

**Gap: film and TV casting.** No project found among ~586. Casting is a decision with real money attached (talent fees, pre-sales), a clear buyer (indie producers, casting directors, development execs) and a question an LLM cannot answer from memory: how much do this person's fans overlap with the audience of projects like ours, and which demographics would they add?

Judges' public backgrounds lean toward entertainment and media. We make no claims about their preferences.

## Sources

- https://qloo-hackathon.devpost.com/project-gallery
- https://devpost.com/software/geotaste-your-agentic-qloo-taste-business-consultant
- https://devpost.com/software/axiom-2bn391
- https://devpost.com/software/zesty
- https://devpost.com/software/resonance-ai-1hjbf0
- https://devpost.com/software/interval-w9mb1u
- https://devpost.com/software/search?query=qloo
- https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
