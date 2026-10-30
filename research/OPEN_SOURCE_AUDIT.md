# Open-source audit

| Project | License | Use in CastSignal |
|---|---|---|
| `@qloo/qloo-harness` 0.1.26 (official CLI/MCP) | MIT | Not used. Its MCP route is stdio-only ("serverless not supported"), which doesn't fit Vercel functions; we call the REST API directly per the hackathon developer guide. |
| qloo/docs-public | No license | Read-only reference. Its `openapi-schema.json` is the generic OpenAPI meta-schema, not Qloo's spec. |
| qloo-hackathon-kit | No license | Docs only; nothing copied. |
| GeoTaste (2025 winner) | No license, committed key | Avoided entirely. |
| alloy (2025 HM) | MIT | Reference only; no code copied. |
| `hahahahahahahahah6/qloo-taste-mcp` | MIT | Rival entry; reference only. |

## Dependencies we ship

| Dependency | License |
|---|---|
| next, react, react-dom | MIT |
| tailwindcss, @tailwindcss/turbopack | MIT |
| @anthropic-ai/sdk | Apache-2.0 |
| zod | MIT |
| vitest, tsx (dev) | MIT |
| Bebas Neue, Archivo, Courier Prime (Google Fonts) | SIL OFL 1.1 |

Charts are hand-rolled SVG (no chart library). Avoided: react-leaflet (Hippocratic license, not OSI-approved).

Live API facts we relied on were verified with our key on 2026-10-29/30 and are documented in `TECHNICAL_PLAN.md`.
