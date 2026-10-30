// Run state, the agent's tools, and the deterministic Casting Board. Server-only.
import * as qloo from "./qloo";
import type { Entity, Scored, CallMeta } from "./qloo";
import {
  baseline, coverage, fitBand, optimizeEnsemble, quadrant, rankNormalize, reachGain, targetSegments, toProfile,
  DEFAULT_FIT_FLOOR, SEGMENTS,
  type OptResult, type Profile, type Segment, type Quadrant,
} from "./scoring";
import type { Brief, ConstraintsInput } from "./brief";

// ---------- Events streamed to the client ----------
export type LedgerEntry = {
  id: string; tool: string; endpoint: string; params: string; status: number; ms: number; count: number; cached: boolean;
};
export type RunEvent =
  | { type: "status"; text: string }
  | { type: "note"; text: string }
  | { type: "tool"; id: string; name: string; input: string }
  | { type: "tool_result"; id: string; ok: boolean; summary: string }
  | { type: "call"; entry: LedgerEntry }
  | { type: "warning"; text: string }
  | { type: "needs_input"; query: string; kind: Kind; question: string; options: Entity[] }
  | { type: "board"; board: Board }
  | { type: "final"; summary: string | null; rationales: Rationale[]; rationaleStatus: "ok" | "partial" | "unavailable" }
  | { type: "error"; text: string; retryable: boolean }
  | { type: "done" };
export type Emit = (e: RunEvent) => void;
export type Kind = "title" | "person";
export type WildKind = "comedian" | "musician" | "actor";
export type Rationale = { name: string; text: string };

type Resolution = {
  query: string; kind: Kind; status: "resolved" | "ambiguous" | "not_found";
  chosen: Entity | null; options: Entity[]; reason: string; evidence: string | null;
};

// ---------- Board (what the UI renders; every number from Qloo or lib/scoring) ----------
export type BoardCandidate = {
  query: string; id: string | null; name: string; image: string | null; disambiguation: string | null;
  popularity: number | null;
  status: "scored" | "no_fit_data" | "not_found" | "ambiguous";
  affinity: number | null; fitRank: number | null; fitRel: number | null; band: string | null;
  profile: Profile | null; reach: number | null; quadrant: Quadrant | null;
  drivers: { name: string; score: number }[];
  brings: string[];
  evidence: string[];
  alternatives: Entity[];
};
export type Wildcard = {
  kind: WildKind; id: string; name: string; image: string | null; popularity: number | null;
  affinity: number | null; fitRank: number; band: string; driver: string | null; profile: Profile | null; evidence: string[];
};
export type Board = {
  title: string;
  comps: { query: string; id: string | null; name: string; image: string | null; disambiguation: string | null; status: string; alternatives: Entity[]; hasDemographics: boolean }[];
  baseline: Profile | null;
  targets: Segment[];
  targetsSource: "user" | "auto";
  roles: { role: string; candidates: BoardCandidate[]; evidence: string | null }[];
  wildcards: { kind: WildKind; items: Wildcard[]; note: string | null }[];
  ensemble: (OptResult & { coverageBefore: number; coverageAfter: number; perSegmentAfter: Record<string, number>; constraints: ConstraintsInput & { targets: Segment[] } }) | null;
  ledger: LedgerEntry[];
  warnings: string[];
  partial: boolean;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const TAG_SUBTYPES = new Set(["genre:qloo", "genre:media", "emotional_tone:qloo", "aesthetic_property:qloo"]);

export class RunState {
  ledger: LedgerEntry[] = [];
  resolved = new Map<string, Resolution>();
  fit = new Map<string, { evidence: string; scores: Map<string, Scored>; missing: string[] }>();
  demos = new Map<string, Profile>();
  demoAsked = new Set<string>();
  demoEvidence: string[] = [];
  compares = new Map<string, { evidence: string; brings: string[] }>();
  wildcards = new Map<WildKind, { evidence: string | null; items: Scored[]; note: string | null }>();
  optimized: { result: OptResult; constraints: ConstraintsInput & { targets: Segment[] } } | null = null;
  warnings: string[] = [];
  partial = false;
  needsInput = false;

  constructor(public brief: Brief, public constraints: ConstraintsInput, private emit: Emit, private tool = "agent") {}

  setTool(t: string) { this.tool = t; }

  warn(text: string) {
    if (!this.warnings.includes(text)) this.warnings.push(text);
    this.emit({ type: "warning", text });
  }

  /** Run a Qloo call, record it in the ledger, return [evidence id, data]. Errors mark the run partial. */
  async call<T>(fn: () => Promise<{ data: T; meta: CallMeta }>): Promise<[string, T]> {
    try {
      const { data, meta } = await fn();
      const entry: LedgerEntry = {
        id: `q${this.ledger.length + 1}`, tool: this.tool, endpoint: meta.endpoint, params: summarizeParams(meta.params),
        status: meta.status, ms: meta.ms, count: meta.count, cached: meta.cached,
      };
      this.ledger.push(entry);
      this.emit({ type: "call", entry });
      return [entry.id, data];
    } catch (e) {
      this.partial = true;
      if (e instanceof qloo.QlooError) {
        this.emit({ type: "error", text: `${e.message} (${e.endpoint}). Results below are partial.`, retryable: true });
      }
      throw e;
    }
  }

  // ----- resolution -----
  key(query: string, kind: Kind) { return `${kind}:${norm(query)}`; }
  pinFor(query: string) { return this.brief.pins.find((p) => norm(p.name) === norm(query))?.id ?? null; }

  async resolve(query: string, kind: Kind): Promise<Resolution> {
    const k = this.key(query, kind);
    const have = this.resolved.get(k);
    if (have) return have;
    const type = kind === "title" ? "urn:entity:movie,urn:entity:tv_show" : "urn:entity:person";
    const [ev, options] = await this.call(() => qloo.search(query, type, kind === "title" ? 4 : 5));
    const r = pick(query, kind, options, this.pinFor(query));
    r.evidence = ev;
    this.resolved.set(k, r);
    return r;
  }

  choose(query: string, kind: Kind, id: string, reason: string): Resolution {
    const r = this.resolved.get(this.key(query, kind));
    if (!r) throw new Error(`"${query}" has not been resolved yet`);
    const opt = r.options.find((o) => o.id === id);
    if (!opt) throw new Error(`entity_id is not one of the options for "${query}"`);
    Object.assign(r, { status: "resolved", chosen: opt, reason });
    return r;
  }

  compIds(): string[] {
    return this.brief.comps.map((c) => this.resolved.get(this.key(c, "title"))?.chosen?.id).filter((x): x is string => !!x);
  }
  candidateEntity(query: string): Entity | null {
    return this.resolved.get(this.key(query, "person"))?.chosen ?? null;
  }
  allCandidateIds(): string[] {
    return this.brief.roles.flatMap((r) => r.candidates.map((c) => this.candidateEntity(c)?.id)).filter((x): x is string => !!x);
  }

  async ensureResolved() {
    await Promise.all([
      ...this.brief.comps.map((c) => this.resolve(c, "title").catch(() => null)),
      ...this.brief.roles.flatMap((r) => r.candidates.map((c) => this.resolve(c, "person").catch(() => null))),
    ]);
  }

  // ----- fit -----
  async ensureFit(role: string) {
    const r = this.brief.roles.find((x) => x.role === role);
    if (!r) throw new Error(`Unknown role "${role}"`);
    if (this.fit.has(role)) return this.fit.get(role)!;
    await this.ensureResolved();
    const comps = this.compIds();
    if (!comps.length) throw new Error("No comparable title resolved; cannot score fit");
    const ids = r.candidates.map((c) => this.candidateEntity(c)?.id).filter((x): x is string => !!x);
    if (!ids.length) throw new Error(`No candidate for "${role}" resolved in Qloo`);
    const [ev, scored] = await this.call(() =>
      qloo.insightsEntities({
        "filter.type": "urn:entity:person",
        "signal.interests.entities": comps.join(","),
        "filter.results.entities": ids.join(","),
        "feature.explainability": "true",
        take: 50,
      }),
    );
    const scores = new Map(scored.filter((s) => s.affinity !== null).map((s) => [s.id, s]));
    const missing = r.candidates.filter((c) => {
      const e = this.candidateEntity(c);
      return e && !scores.has(e.id);
    });
    for (const m of missing) this.warn(`Not enough Qloo audience data for ${m} (${role}); no fit score.`);
    const out = { evidence: ev, scores, missing };
    this.fit.set(role, out);
    return out;
  }

  // ----- demographics -----
  async ensureDemographics(extra: string[] = []) {
    await this.ensureResolved();
    const want = [...new Set([...this.compIds(), ...this.allCandidateIds(), ...extra])].filter((id) => !this.demoAsked.has(id));
    for (let i = 0; i < want.length; i += 25) {
      const chunk = want.slice(i, i + 25);
      const [ev, data] = await this.call(() => qloo.demographics(chunk));
      chunk.forEach((id) => this.demoAsked.add(id));
      this.demoEvidence.push(ev);
      for (const [id, d] of Object.entries(data)) this.demos.set(id, toProfile(d));
    }
  }
  baselineProfile(): Profile | null {
    return baseline(this.compIds().map((id) => this.demos.get(id)).filter((p): p is Profile => !!p));
  }
  targets(): { targets: Segment[]; source: "user" | "auto" } {
    return {
      targets: targetSegments(this.baselineProfile(), this.brief.targets),
      source: this.brief.targets.length ? "user" : "auto",
    };
  }

  // ----- compare -----
  async compareCandidate(query: string) {
    const e = this.candidateEntity(query);
    if (!e) throw new Error(`"${query}" is not a resolved candidate`);
    const have = this.compares.get(e.id);
    if (have) return have;
    const comps = this.compIds();
    const [ev, d] = await this.call(() => qloo.compare([e.id], comps, 30));
    const compSide = new Set(d.b.map((t) => norm(t.name)));
    const brings = [...new Set(
      d.a.filter((t) => TAG_SUBTYPES.has(t.subtype) && !compSide.has(norm(t.name))).map((t) => titleCase(t.name)),
    )].slice(0, 6);
    const out = { evidence: ev, brings };
    this.compares.set(e.id, out);
    return out;
  }

  // ----- wildcards -----
  async findWildcards(kind: WildKind) {
    const have = this.wildcards.get(kind);
    if (have) return have;
    await this.ensureResolved();
    const comps = this.compIds();
    if (!comps.length) throw new Error("No comparable title resolved");
    const exclude = [...new Set([...this.allCandidateIds(), ...comps])].join(",");
    const base = { "signal.interests.entities": comps.join(","), "feature.explainability": "true", "filter.exclude.entities": exclude };
    let ev: string;
    let items: Scored[];
    if (kind === "comedian") {
      [ev, items] = await this.call(() => qloo.insightsEntities({ ...base, "filter.type": "urn:entity:person", "filter.tags": "urn:tag:genre:person:comedian", take: 10 }));
    } else if (kind === "musician") {
      [ev, items] = await this.call(() => qloo.insightsEntities({ ...base, "filter.type": "urn:entity:artist", "filter.popularity.min": 0.6, take: 10 }));
    } else {
      // Person type spans every profession; Qloo ignores actor tags, so post-filter on the entity's own tag names.
      [ev, items] = await this.call(() => qloo.insightsEntities({ ...base, "filter.type": "urn:entity:person", "filter.popularity.min": 0.6, take: 50 }));
      items = items.filter((x) => x.tags.some((t) => /\b(actor|actress|actresses)\b/i.test(t)));
    }
    items = items.filter((x) => x.affinity !== null).slice(0, 5);
    const note = items.length ? null : `Qloo returned no ${kind}s that fit these comps.`;
    const out = { evidence: ev, items, note };
    this.wildcards.set(kind, out);
    return out;
  }

  // ----- optimizer -----
  async optimize(c: ConstraintsInput) {
    for (const r of this.brief.roles) await this.ensureFit(r.role).catch((e) => this.warn(String(e.message ?? e)));
    await this.ensureDemographics();
    const { targets } = this.targets();
    const toIds = (names: string[]) =>
      names.map((n) => this.candidateEntity(n)?.id ?? this.findCandidateByName(n)).filter((x): x is string => !!x);
    const roles = this.brief.roles.map((r) => {
      const f = this.fit.get(r.role);
      const affs = r.candidates.map((q) => f?.scores.get(this.candidateEntity(q)?.id ?? "")).filter((s): s is Scored => !!s);
      const max = Math.max(...affs.map((s) => s.affinity!), 0);
      const ranks = rankNormalize(affs.map((s) => ({ id: s.id, value: s.affinity! })));
      return {
        role: r.role,
        candidates: r.candidates.flatMap((q) => {
          const e = this.candidateEntity(q);
          if (!e) return [];
          const s = f?.scores.get(e.id);
          return [{
            id: e.id, name: e.name, popularity: s?.popularity ?? e.popularity,
            fitRel: s && max ? s.affinity! / max : null, fitRank: s ? ranks[e.id] : null,
            profile: this.demos.get(e.id) ?? null,
          }];
        }),
      };
    });
    const constraints = { ...c, targets };
    const result = optimizeEnsemble(roles, {
      targets, fitFloor: c.fitFloor ?? DEFAULT_FIT_FLOOR, mustInclude: toIds(c.mustInclude), exclude: toIds(c.exclude), maxAListers: c.maxAListers,
    });
    this.constraints = c;
    this.optimized = { result, constraints };
    return this.optimized;
  }

  findCandidateByName(name: string): string | null {
    for (const r of this.resolved.values()) if (r.kind === "person" && r.chosen && norm(r.chosen.name) === norm(name)) return r.chosen.id;
    return null;
  }

  // ----- board -----
  async buildBoard(): Promise<Board> {
    await this.ensureResolved();
    for (const r of this.brief.roles) await this.ensureFit(r.role).catch(() => null);
    const wildIds = [...this.wildcards.values()].flatMap((w) => w.items.map((i) => i.id));
    await this.ensureDemographics(wildIds).catch(() => null);
    if (!this.optimized) await this.optimize(this.constraints).catch(() => null);

    const base = this.baselineProfile();
    const { targets, source } = this.targets();
    const nameOf = (id: string) => [...this.resolved.values()].find((r) => r.chosen?.id === id)?.chosen?.name ?? null;
    const demoEv = (id: string) => (this.demos.has(id) ? this.demoEvidence : []);

    const roles = this.brief.roles.map((r) => {
      const f = this.fit.get(r.role);
      const scoredList = [...(f?.scores.values() ?? [])];
      const ranks = rankNormalize(scoredList.map((s) => ({ id: s.id, value: s.affinity! })));
      const max = Math.max(...scoredList.map((s) => s.affinity!), 0);
      const candidates: BoardCandidate[] = r.candidates.map((q) => {
        const res = this.resolved.get(this.key(q, "person"));
        const e = res?.chosen ?? null;
        const s = e ? f?.scores.get(e.id) : undefined;
        const profile = e ? this.demos.get(e.id) ?? null : null;
        const fitRank = s ? ranks[s.id] : null;
        const reach = profile ? reachGain(profile, base, targets) : null;
        const cmp = e ? this.compares.get(e.id) : undefined;
        return {
          query: q, id: e?.id ?? null, name: e?.name ?? q, image: e?.image ?? s?.image ?? null,
          disambiguation: e?.disambiguation ?? null, popularity: s?.popularity ?? e?.popularity ?? null,
          status: !res || res.status === "not_found" ? "not_found" : res.status === "ambiguous" ? "ambiguous" : s ? "scored" : "no_fit_data",
          affinity: s?.affinity ?? null, fitRank, fitRel: s && max ? s.affinity! / max : null,
          band: fitRank !== null ? fitBand(fitRank) : null,
          profile, reach, quadrant: fitRank !== null && reach !== null ? quadrant(fitRank, reach) : null,
          drivers: (s?.drivers ?? []).map((d) => ({ name: nameOf(d.id) ?? "comp", score: d.score })),
          brings: cmp?.brings ?? [],
          evidence: [res?.evidence, s ? f?.evidence : null, ...(e ? demoEv(e.id) : []), cmp?.evidence].filter((x): x is string => !!x),
          alternatives: res?.options ?? [],
        };
      });
      return { role: r.role, candidates, evidence: f?.evidence ?? null };
    });

    const wildcards = [...this.wildcards.entries()].map(([kind, w]) => {
      const ranks = rankNormalize(w.items.map((i) => ({ id: i.id, value: i.affinity! })));
      return {
        kind, note: w.note,
        items: w.items.map((i) => {
          const top = [...i.drivers].sort((a, b) => b.score - a.score)[0];
          return {
            kind, id: i.id, name: i.name, image: i.image, popularity: i.popularity, affinity: i.affinity,
            fitRank: ranks[i.id], band: fitBand(ranks[i.id]), driver: top ? nameOf(top.id) : null,
            profile: this.demos.get(i.id) ?? null, evidence: [w.evidence, ...demoEv(i.id)].filter((x): x is string => !!x),
          };
        }),
      };
    });

    let ensemble: Board["ensemble"] = null;
    if (this.optimized) {
      const { result, constraints } = this.optimized;
      const pickProfiles = (result.best?.picks ?? []).map((p) => (p.id ? this.demos.get(p.id) : undefined)).filter((p): p is Profile => !!p);
      const before = coverage(base ? [base] : [], targets);
      const after = coverage([...(base ? [base] : []), ...pickProfiles], targets);
      ensemble = { ...result, coverageBefore: before.total, coverageAfter: after.total, perSegmentAfter: after.perSegment, constraints };
    }

    return {
      title: this.brief.title,
      comps: this.brief.comps.map((q) => {
        const r = this.resolved.get(this.key(q, "title"));
        return {
          query: q, id: r?.chosen?.id ?? null, name: r?.chosen?.name ?? q, image: r?.chosen?.image ?? null,
          disambiguation: r?.chosen?.disambiguation ?? null, status: r?.status ?? "not_found", alternatives: r?.options ?? [],
          hasDemographics: !!(r?.chosen && this.demos.has(r.chosen.id)),
        };
      }),
      baseline: base, targets, targetsSource: source, roles, wildcards, ensemble,
      ledger: this.ledger, warnings: this.warnings, partial: this.partial,
    };
  }
}

/** Pick the intended entity: a pin wins; otherwise an exact-name match that clearly leads on popularity. */
export function pick(query: string, kind: Kind, options: Entity[], pinId: string | null): Resolution {
  const r: Resolution = { query, kind, status: "not_found", chosen: null, options, reason: "", evidence: null };
  if (pinId) {
    const p = options.find((o) => o.id === pinId);
    if (p) return { ...r, status: "resolved", chosen: p, reason: "pinned by user" };
  }
  if (!options.length) return { ...r, reason: "no Qloo match" };
  const exact = options.filter((o) => norm(o.name) === norm(query)).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  if (exact.length === 1) return { ...r, status: "resolved", chosen: exact[0], reason: "only exact match" };
  if (exact.length > 1) {
    const gap = (exact[0].popularity ?? 0) - (exact[1].popularity ?? 0);
    if (gap >= 0.1) return { ...r, status: "resolved", chosen: exact[0], reason: `most popular of ${exact.length} exact matches` };
    return { ...r, status: "ambiguous", reason: `${exact.length} exact matches with similar popularity` };
  }
  return { ...r, status: "ambiguous", reason: "no exact name match" };
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function summarizeParams(p: Record<string, string>): string {
  return Object.entries(p)
    .map(([k, v]) => {
      const n = v.split(",").length;
      const short = /^[0-9A-F-]{36}(,|$)/i.test(v) ? `${n} id${n > 1 ? "s" : ""}` : v.length > 60 ? v.slice(0, 57) + "…" : v;
      return `${k.replace(/^(filter|signal)\./, "")}=${short}`;
    })
    .join(" · ");
}

export const SEGMENT_KEYS = SEGMENTS;
