// The CastSignal agent: a manual Claude tool-use loop over Qloo-backed tools. Server-only.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { RunState, type Emit, type Rationale, type WildKind } from "./run";
import { hasCitation, unknownCitations, SEGMENTS } from "./scoring";
import type { RunRequest } from "./brief";

export const AGENT_MODEL = "claude-sonnet-5-5";
const MAX_ITERATIONS = 12;

const SYSTEM = `You are CastSignal, a casting-audience analyst for indie film and TV producers.
You answer, for each role, two questions using Qloo taste data only: (1) fit — does this person's audience already love projects like ours? (2) reach — which audience segments would they add that the comparable titles ("comps") don't already reach?

Work in this order, batching independent tool calls in the same turn:
1. resolve_entities for the comps (kind "title") and every shortlisted name (kind "person").
   - If a name is "ambiguous", settle it with choose_entity when the release year, popularity or the brief makes the intent clear (e.g. the well-known actor for a casting shortlist). Otherwise call ask_user and stop.
   - "not_found" names: mention them and continue.
2. score_fit for every role, and get_demographics (once, after resolving).
3. compare_audiences for the top 2–4 candidates overall.
4. If wildcards are enabled: find_wildcards with the kind(s) that suit the project's tone (comedian for comedy, musician for music-driven or youth projects, actor otherwise). At most two kinds.
5. optimize_ensemble with constraints derived from the brief and the user's instructions.
6. finish with a short summary and one rationale per recommended pick, per notable wildcard, and per candidate without data.

Rules:
- Never state a number. Do not write digits in summaries or rationales; use words like "top fit", "over-indexes", "strongest". All numbers in the UI come from Qloo or deterministic code.
- Every rationale must cite evidence ids from tool results in square brackets, e.g. [q3]. Use only ids that tools returned.
- Talk about audiences, never about a person's identity attributes. Phrase claims as "fans of X over-index on…". Affinity describes aggregate audience taste, not a fact about an individual.
- Candidates Qloo has no data for: say so plainly ("decide on track record; Qloo can't speak to this audience"). Never guess a score.
- Rationales: at most two sentences each. Summary: at most three sentences.
- On a refine request, change only what the instruction requires; the tools reuse cached Qloo results, so only call what the change needs (usually update_brief and/or optimize_ensemble, then finish).
- Keep text between tool calls to one short progress sentence or none.`;

const segEnum = { type: "string", enum: [...SEGMENTS] } as const;
const TOOLS: Anthropic.Tool[] = [
  {
    name: "resolve_entities",
    description: "Look up names in Qloo search. Returns per name: status resolved/ambiguous/not_found, the chosen entity, alternatives, and an evidence id. Names must come from the brief.",
    input_schema: {
      type: "object",
      properties: { names: { type: "array", items: { type: "string" }, maxItems: 20 }, kind: { type: "string", enum: ["title", "person"] } },
      required: ["names", "kind"],
    },
  },
  {
    name: "choose_entity",
    description: "Settle an ambiguous name by picking one of the options resolve_entities returned.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, kind: { type: "string", enum: ["title", "person"] }, entity_id: { type: "string" }, reason: { type: "string" } },
      required: ["query", "kind", "entity_id", "reason"],
    },
  },
  {
    name: "ask_user",
    description: "Ask the user to disambiguate a name you cannot settle. Ends the run; the UI shows a chooser.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, kind: { type: "string", enum: ["title", "person"] }, question: { type: "string" } },
      required: ["query", "kind", "question"],
    },
  },
  {
    name: "score_fit",
    description: "One Qloo insights call scoring a role's shortlist against the comps' audience, with explainability (which comp drove each score). Reports candidates Qloo has no data for.",
    input_schema: { type: "object", properties: { role: { type: "string" } }, required: ["role"] },
  },
  {
    name: "get_demographics",
    description: "Batched Qloo demographics (age band and gender over/under-index, -1..1) for the comps, all candidates and any wildcards found so far. Returns the comps' baseline and the segments it under-covers.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "compare_audiences",
    description: "Qloo compare: taste themes linked to each candidate that the comps' audience does not carry. Max 4 names.",
    input_schema: { type: "object", properties: { names: { type: "array", items: { type: "string" }, maxItems: 4 } }, required: ["names"] },
  },
  {
    name: "find_wildcards",
    description: "Discover cross-over names (not on the shortlist) whose audiences fit the comps.",
    input_schema: { type: "object", properties: { kind: { type: "string", enum: ["comedian", "musician", "actor"] } }, required: ["kind"] },
  },
  {
    name: "update_brief",
    description: "Refine only: change comps, shortlist or target segments as the user asked. Then re-run only the affected tools.",
    input_schema: {
      type: "object",
      properties: {
        add_comps: { type: "array", items: { type: "string" } },
        remove_comps: { type: "array", items: { type: "string" } },
        add_candidates: { type: "array", items: { type: "object", properties: { role: { type: "string" }, name: { type: "string" } }, required: ["role", "name"] } },
        remove_candidates: { type: "array", items: { type: "string" } },
        targets: { type: "array", items: segEnum, description: "Replace the target segments to grow. Empty array = auto (segments the comps under-cover)." },
      },
    },
  },
  {
    name: "optimize_ensemble",
    description: "Deterministic optimizer: one pick per role maximizing combined reach on target segments, subject to a fit floor, must-include/exclude and an A-lister cap. Omitted fields keep their current values.",
    input_schema: {
      type: "object",
      properties: {
        must_include: { type: "array", items: { type: "string" } },
        exclude: { type: "array", items: { type: "string" } },
        max_a_listers: { type: ["integer", "null"], minimum: 0, maximum: 3 },
        fit_floor: { type: "number", minimum: 0.5, maximum: 1, description: "Minimum affinity relative to the role's best fit. Default 0.9." },
      },
    },
  },
  {
    name: "finish",
    description: "End the run with a summary and rationales. Each rationale: a name and at most two sentences citing evidence ids like [q3]. No digits.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        rationales: { type: "array", items: { type: "object", properties: { name: { type: "string" }, text: { type: "string" } }, required: ["name", "text"] }, maxItems: 14 },
      },
      required: ["summary", "rationales"],
    },
  },
];

const Inputs = {
  resolve_entities: z.object({ names: z.array(z.string().max(80)).max(20), kind: z.enum(["title", "person"]) }),
  choose_entity: z.object({ query: z.string(), kind: z.enum(["title", "person"]), entity_id: z.string(), reason: z.string().max(200) }),
  ask_user: z.object({ query: z.string(), kind: z.enum(["title", "person"]), question: z.string().max(300) }),
  score_fit: z.object({ role: z.string() }),
  get_demographics: z.object({}).passthrough(),
  compare_audiences: z.object({ names: z.array(z.string()).max(4) }),
  find_wildcards: z.object({ kind: z.enum(["comedian", "musician", "actor"]) }),
  update_brief: z.object({
    add_comps: z.array(z.string().max(80)).max(3).optional(),
    remove_comps: z.array(z.string()).max(5).optional(),
    add_candidates: z.array(z.object({ role: z.string(), name: z.string().max(80) })).max(4).optional(),
    remove_candidates: z.array(z.string()).max(6).optional(),
    targets: z.array(z.enum(SEGMENTS)).max(8).optional(),
  }),
  optimize_ensemble: z.object({
    must_include: z.array(z.string()).max(6).optional(),
    exclude: z.array(z.string()).max(12).optional(),
    max_a_listers: z.number().int().min(0).max(3).nullable().optional(),
    fit_floor: z.number().min(0.5).max(1).optional(),
  }),
  finish: z.object({ summary: z.string().max(800), rationales: z.array(z.object({ name: z.string(), text: z.string().max(600) })).max(14) }),
};

const DIGITS = /\d/;
/** Server-side check of finish(): cited ids must exist in the ledger; no numbers outside citations. */
export function validateRationales(rs: Rationale[], summary: string, known: Set<string>) {
  const errors: string[] = [];
  const ok: Rationale[] = [];
  for (const r of rs) {
    const bad = unknownCitations(r.text, known);
    const stripped = r.text.replace(/\[q\d+\]/g, "");
    if (bad.length) errors.push(`${r.name}: unknown evidence ids ${bad.join(", ")}`);
    else if (!hasCitation(r.text)) errors.push(`${r.name}: cite at least one evidence id`);
    else if (DIGITS.test(stripped)) errors.push(`${r.name}: remove digits; numbers come from the UI`);
    else ok.push(r);
  }
  if (DIGITS.test(summary.replace(/\[q\d+\]/g, ""))) errors.push("summary: remove digits");
  const badSummary = unknownCitations(summary, known);
  if (badSummary.length) errors.push(`summary: unknown evidence ids ${badSummary.join(", ")}`);
  return { ok, errors };
}

type Ctx = { state: RunState; emit: Emit; finished: { summary: string; rationales: Rationale[]; status: "ok" | "partial" } | null; finishFailures: number };

async function execute(name: string, raw: unknown, ctx: Ctx): Promise<{ result: unknown; summary: string }> {
  const s = ctx.state;
  s.setTool(name);
  const inBrief = (n: string) =>
    s.brief.comps.some((c) => c.toLowerCase() === n.toLowerCase()) ||
    s.brief.roles.some((r) => r.candidates.some((c) => c.toLowerCase() === n.toLowerCase()));
  switch (name) {
    case "resolve_entities": {
      const i = Inputs.resolve_entities.parse(raw);
      const outside = i.names.filter((n) => !inBrief(n));
      if (outside.length) throw new Error(`Not in the brief: ${outside.join(", ")}. Use update_brief first.`);
      const rs = await Promise.all(i.names.map((n) => s.resolve(n, i.kind)));
      return {
        result: rs.map((r) => ({
          query: r.query, status: r.status, reason: r.reason, evidence_id: r.evidence,
          chosen: r.chosen && { entity_id: r.chosen.id, name: r.chosen.name, year_or_born: r.chosen.disambiguation },
          options: r.status === "resolved" ? undefined : r.options.map((o) => ({ entity_id: o.id, name: o.name, year_or_born: o.disambiguation, popularity_known: o.popularity !== null })),
        })),
        summary: rs.map((r) => `${r.query}: ${r.status}${r.chosen && r.status === "resolved" ? ` → ${r.chosen.name}${r.chosen.disambiguation ? ` (${r.chosen.disambiguation})` : ""}` : ""}`).join("; "),
      };
    }
    case "choose_entity": {
      const i = Inputs.choose_entity.parse(raw);
      const r = s.choose(i.query, i.kind, i.entity_id, i.reason);
      return { result: { ok: true }, summary: `${i.query} → ${r.chosen!.name} (${r.chosen!.disambiguation ?? "?"}): ${i.reason}` };
    }
    case "ask_user": {
      const i = Inputs.ask_user.parse(raw);
      const r = s.resolved.get(s.key(i.query, i.kind));
      ctx.emit({ type: "needs_input", query: i.query, kind: i.kind, question: i.question, options: r?.options ?? [] });
      s.needsInput = true;
      return { result: { ok: true, note: "Run will pause for the user." }, summary: `Asked the user about "${i.query}"` };
    }
    case "score_fit": {
      const i = Inputs.score_fit.parse(raw);
      const f = await s.ensureFit(i.role);
      const list = [...f.scores.values()].sort((a, b) => b.affinity! - a.affinity!);
      const role = s.brief.roles.find((r) => r.role === i.role)!;
      const unresolved = role.candidates.filter((c) => !s.candidateEntity(c));
      const nameOf = (id: string) => [...s.resolved.values()].find((r) => r.chosen?.id === id)?.chosen?.name ?? id;
      return {
        result: {
          evidence_id: f.evidence,
          ranked: list.map((x, k) => ({ name: x.name, rank: k + 1, top_driver_comp: nameOf([...x.drivers].sort((a, b) => b.score - a.score)[0]?.id ?? "") })),
          no_qloo_data: f.missing,
          unresolved,
        },
        summary: `${i.role}: ranked ${list.map((x) => x.name).join(" > ")}${f.missing.length ? `; no data: ${f.missing.join(", ")}` : ""}`,
      };
    }
    case "get_demographics": {
      await s.ensureDemographics([...s.wildcards.values()].flatMap((w) => w.items.map((x) => x.id)));
      const base = s.baselineProfile();
      const { targets, source } = s.targets();
      const withData: string[] = [];
      const without: string[] = [];
      for (const r of s.resolved.values()) if (r.chosen) (s.demos.has(r.chosen.id) ? withData : without).push(r.chosen.name);
      const top = (id: string) => {
        const p = s.demos.get(id);
        return p ? [...SEGMENTS].sort((a, b) => p[b] - p[a]).slice(0, 2) : [];
      };
      return {
        result: {
          evidence_ids: s.demoEvidence,
          comps_over_index: base ? [...SEGMENTS].filter((x) => base[x] > 0.15) : [],
          comps_under_cover: base ? [...SEGMENTS].filter((x) => base[x] < 0) : [],
          target_segments: targets, target_source: source,
          candidates_top_segments: Object.fromEntries(s.allCandidateIds().map((id) => [[...s.resolved.values()].find((r) => r.chosen?.id === id)!.chosen!.name, top(id)])),
          no_demographic_data: without,
        },
        summary: `${withData.length} with data, ${without.length} without${without.length ? ` (${without.join(", ")})` : ""}; targets: ${targets.join(", ") || "none"}`,
      };
    }
    case "compare_audiences": {
      const i = Inputs.compare_audiences.parse(raw);
      const out = await Promise.all(i.names.map(async (n) => ({ name: n, ...(await s.compareCandidate(n)) })));
      return {
        result: out.map((o) => ({ name: o.name, evidence_id: o.evidence, brings_themes: o.brings })),
        summary: out.map((o) => `${o.name}: ${o.brings.slice(0, 3).join(", ") || "no distinct themes"}`).join("; "),
      };
    }
    case "find_wildcards": {
      const i = Inputs.find_wildcards.parse(raw);
      const w = await s.findWildcards(i.kind as WildKind);
      const nameOf = (id: string) => [...s.resolved.values()].find((r) => r.chosen?.id === id)?.chosen?.name ?? null;
      return {
        result: { evidence_id: w.evidence, note: w.note, wildcards: w.items.map((x, k) => ({ name: x.name, rank: k + 1, top_driver_comp: nameOf([...x.drivers].sort((a, b) => b.score - a.score)[0]?.id ?? "") })) },
        summary: w.items.length ? `${i.kind}s: ${w.items.map((x) => x.name).join(", ")}` : w.note!,
      };
    }
    case "update_brief": {
      const i = Inputs.update_brief.parse(raw);
      const b = s.brief;
      const lower = (a: string[] = []) => a.map((x) => x.toLowerCase());
      if (i.remove_comps?.length) b.comps = b.comps.filter((c) => !lower(i.remove_comps).includes(c.toLowerCase()));
      if (i.add_comps?.length) b.comps = [...b.comps, ...i.add_comps].slice(0, 5);
      if (!b.comps.length) throw new Error("At least one comp is required");
      if (i.remove_candidates?.length) for (const r of b.roles) r.candidates = r.candidates.filter((c) => !lower(i.remove_candidates).includes(c.toLowerCase()));
      for (const a of i.add_candidates ?? []) {
        const r = b.roles.find((x) => x.role.toLowerCase() === a.role.toLowerCase());
        if (!r) throw new Error(`Unknown role "${a.role}"`);
        if (r.candidates.length >= 6) throw new Error(`"${r.role}" already has six candidates`);
        r.candidates.push(a.name);
      }
      if (i.targets) b.targets = i.targets;
      if (i.add_comps?.length || i.remove_comps?.length) {
        s.fit.clear(); s.compares.clear(); s.wildcards.clear();
      } else if (i.add_candidates?.length || i.remove_candidates?.length) s.fit.clear();
      s.optimized = null;
      return { result: { ok: true, comps: b.comps, roles: b.roles, targets: b.targets }, summary: `Brief updated: comps ${b.comps.join(", ")}${i.targets ? `; targets ${i.targets.join(", ") || "auto"}` : ""}` };
    }
    case "optimize_ensemble": {
      const i = Inputs.optimize_ensemble.parse(raw);
      const c = {
        mustInclude: i.must_include ?? s.constraints.mustInclude,
        exclude: i.exclude ?? s.constraints.exclude,
        maxAListers: i.max_a_listers === undefined ? s.constraints.maxAListers : i.max_a_listers,
        fitFloor: i.fit_floor ?? s.constraints.fitFloor,
      };
      const { result, constraints } = await s.optimize(c);
      ctx.emit({ type: "board", board: await s.buildBoard() });
      return {
        result: {
          evidence: "deterministic optimizer over the score_fit and demographics evidence",
          best: result.best?.picks, alternatives: result.alternatives.map((a) => a.picks), notes: result.notes,
          constraints, combinations_considered: result.considered,
        },
        summary: result.best ? `Ensemble: ${result.best.picks.map((p) => `${p.role} = ${p.name ?? "open"}`).join(", ")}` : `No feasible ensemble. ${result.notes.join(" ")}`,
      };
    }
    case "finish": {
      const i = Inputs.finish.parse(raw);
      const known = new Set(s.ledger.map((l) => l.id));
      const { ok, errors } = validateRationales(i.rationales, i.summary, known);
      if (errors.length && ctx.finishFailures < 1) {
        ctx.finishFailures++;
        throw new Error(`Rejected: ${errors.join("; ")}. Fix and call finish again.`);
      }
      const summary = DIGITS.test(i.summary.replace(/\[q\d+\]/g, "")) || unknownCitations(i.summary, known).length ? null : i.summary;
      ctx.finished = { summary: summary ?? "", rationales: ok, status: errors.length ? "partial" : "ok" };
      return { result: { ok: true }, summary: errors.length ? `Finished; dropped ${errors.length} uncited rationale(s)` : "Finished" };
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

function briefMessage(req: RunRequest): string {
  const b = req.brief;
  const lines = [
    `Project: ${b.title}`,
    b.logline && `Logline: ${b.logline}`,
    `Comparable titles: ${b.comps.join(" | ")}`,
    ...b.roles.map((r) => `Role "${r.role}" shortlist: ${r.candidates.join(" | ")}`),
    `Target segments: ${b.targets.length ? b.targets.join(", ") : "none given (auto: grow what the comps under-cover)"}`,
    `Wildcards: ${b.wildcards ? "enabled" : "disabled"}`,
    `Current constraints: must_include=${JSON.stringify(req.constraints.mustInclude)} exclude=${JSON.stringify(req.constraints.exclude)} max_a_listers=${req.constraints.maxAListers} fit_floor=${req.constraints.fitFloor}`,
  ];
  if (req.refine) {
    lines.push(
      "",
      `REFINE REQUEST from the user: "${req.refine}"`,
      req.previousEnsemble ? `Previous ensemble: ${req.previousEnsemble.map((p) => `${p.role} = ${p.name ?? "open"}`).join(", ")}` : "",
      "Translate this into update_brief and/or optimize_ensemble arguments, call only what is needed, then finish. Explain in the summary what changed and why.",
    );
  }
  return lines.filter(Boolean).join("\n");
}

/** Run the agent end to end. Always emits a board (possibly partial) and a final event. */
export async function runAgent(req: RunRequest, emit: Emit, client = new Anthropic()) {
  const state = new RunState(structuredClone(req.brief), req.constraints, emit);
  const ctx: Ctx = { state, emit, finished: null, finishFailures: 0 };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: briefMessage(req) }];
  let llmFailed = false;

  emit({ type: "status", text: req.refine ? "Agent is applying your change…" : "Agent is planning the analysis…" });
  try {
    for (let iter = 0; iter < MAX_ITERATIONS && !ctx.finished && !state.needsInput; iter++) {
      const res = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        tools: TOOLS,
        thinking: { type: "between_tools" },
        output_config: { effort: "medium" },
        messages,
      } as Anthropic.MessageCreateParamsNonStreaming);
      if (res.stop_reason === "refusal") throw new Error("model declined the request");
      messages.push({ role: "assistant", content: res.content });
      for (const b of res.content) if (b.type === "text" && b.text.trim()) emit({ type: "note", text: b.text.trim().slice(0, 300) });
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!uses.length) {
        if (res.stop_reason === "end_turn") messages.push({ role: "user", content: "Call finish to end the run." });
        continue;
      }
      // Run independent calls of one turn concurrently; return all results in one user message.
      const results = await Promise.all(
        uses.map(async (u): Promise<Anthropic.ToolResultBlockParam> => {
          emit({ type: "tool", id: u.id, name: u.name, input: JSON.stringify(u.input).slice(0, 200) });
          try {
            const { result, summary } = await execute(u.name, u.input, ctx);
            emit({ type: "tool_result", id: u.id, ok: true, summary });
            return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(result) };
          } catch (e) {
            const msg = e instanceof z.ZodError ? `Invalid input: ${e.issues.map((x) => x.message).join("; ")}` : String((e as Error).message ?? e);
            emit({ type: "tool_result", id: u.id, ok: false, summary: msg });
            return { type: "tool_result", tool_use_id: u.id, content: msg, is_error: true };
          }
        }),
      );
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    llmFailed = true;
    console.log(`[agent] LLM failure: ${e instanceof Anthropic.APIError ? e.status : (e as Error).message}`);
    emit({ type: "warning", text: "The agent (LLM) is unavailable right now. Showing Qloo evidence and deterministic scores only; rationales unavailable." });
  }

  if (state.needsInput) {
    emit({ type: "done" });
    return;
  }
  // Whatever the LLM did, the board is rebuilt deterministically from the evidence (missing steps run from cache).
  state.setTool(llmFailed || !ctx.finished ? "auto" : "board");
  if (state.brief.wildcards && !state.wildcards.size) await state.findWildcards("comedian").catch(() => null);
  const board = await state.buildBoard().catch((e) => {
    emit({ type: "error", text: `Could not build the board: ${(e as Error).message}`, retryable: true });
    return null;
  });
  if (board) emit({ type: "board", board });
  if (!ctx.finished && !llmFailed) state.warn("The agent stopped before writing rationales; scores are complete.");
  emit({
    type: "final",
    summary: ctx.finished?.summary || null,
    rationales: ctx.finished?.rationales ?? [],
    rationaleStatus: ctx.finished ? ctx.finished.status : "unavailable",
  });
  emit({ type: "done" });
}
