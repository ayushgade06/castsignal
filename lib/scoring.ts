// Deterministic math. The LLM never produces numbers; everything shown comes from Qloo or from here.

export const SEGMENTS = [
  "24_and_younger",
  "25_to_29",
  "30_to_34",
  "35_to_44",
  "45_to_54",
  "55_and_older",
  "female",
  "male",
] as const;
export type Segment = (typeof SEGMENTS)[number];
export type Profile = Record<Segment, number>; // -1..1 relative over/under-index

export const SEGMENT_LABEL: Record<Segment, string> = {
  "24_and_younger": "≤24",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55+",
  female: "Women",
  male: "Men",
};

export function toProfile(d: { age: Record<string, number>; gender: { male: number; female: number } }): Profile {
  const p = {} as Profile;
  for (const s of SEGMENTS) p[s] = s === "male" || s === "female" ? d.gender[s] : (d.age[s] ?? 0);
  return p;
}

/** Mean profile across comps (those with data). Null if no comp has data. */
export function baseline(profiles: Profile[]): Profile | null {
  if (!profiles.length) return null;
  const b = {} as Profile;
  for (const s of SEGMENTS) b[s] = profiles.reduce((a, p) => a + p[s], 0) / profiles.length;
  return b;
}

/** Rank-normalize within one call: best = 1, worst = 0, ties share the average rank. n=1 → 1. */
export function rankNormalize(items: { id: string; value: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  const n = items.length;
  if (n === 1) return { [items[0].id]: 1 };
  const sorted = [...items].sort((a, b) => b.value - a.value);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].value === sorted[i].value) j++;
    const avgRank = (i + j) / 2;
    for (let k = i; k <= j; k++) out[sorted[k].id] = 1 - avgRank / (n - 1);
    i = j + 1;
  }
  return out;
}

export function fitBand(rank: number): "Top fit" | "Strong fit" | "Moderate fit" {
  return rank >= 0.67 ? "Top fit" : rank >= 0.34 ? "Strong fit" : "Moderate fit";
}

/** Segments to grow: the user's targets, else the segments the comps' audience under-indexes on. */
export function targetSegments(base: Profile | null, userTargets: Segment[]): Segment[] {
  if (userTargets.length) return userTargets;
  if (!base) return [];
  return SEGMENTS.filter((s) => base[s] < 0);
}

/** Reach gain: mean amount the candidate over-indexes beyond the comps' baseline on target segments (0..2). */
export function reachGain(cand: Profile, base: Profile | null, targets: Segment[]): number {
  if (!targets.length) return 0;
  const sum = targets.reduce((a, s) => a + Math.max(0, cand[s] - Math.max(0, base?.[s] ?? 0)), 0);
  return sum / targets.length;
}

export type Quadrant = "Safe bet" | "Audience expander" | "Cult pick" | "Risky";
export const REACH_HIGH = 0.15;
export function quadrant(fitRank: number, reach: number): Quadrant {
  const fitHigh = fitRank >= 0.5;
  const reachHigh = reach >= REACH_HIGH;
  if (fitHigh && reachHigh) return "Audience expander";
  if (fitHigh) return "Safe bet";
  if (reachHigh) return "Cult pick";
  return "Risky";
}

/** Coverage of target segments: Σ max(0, best profile among sources). */
export function coverage(sources: Profile[], targets: Segment[]): { total: number; perSegment: Record<string, number> } {
  const perSegment: Record<string, number> = {};
  let total = 0;
  for (const s of targets) {
    const v = Math.max(0, ...sources.map((p) => p[s]));
    perSegment[s] = v;
    total += v;
  }
  return { total, perSegment };
}

export type OptCandidate = {
  id: string;
  name: string;
  fitRel: number | null; // affinity / best affinity in the role's call; null = no Qloo fit data
  fitRank: number | null;
  popularity: number | null;
  profile: Profile | null;
};
export type OptRole = { role: string; candidates: OptCandidate[] };
export type Constraints = {
  targets: Segment[];
  fitFloor: number; // on fitRel
  mustInclude: string[];
  exclude: string[];
  maxAListers: number | null; // popularity >= A_LIST_POP
};
export const A_LIST_POP = 0.95;
export const DEFAULT_FIT_FLOOR = 0.9;

export type Ensemble = {
  picks: { role: string; id: string | null; name: string | null }[];
  reach: number;
  perSegment: Record<string, number>;
  meanFit: number;
  aListers: number;
};
export type OptResult = {
  best: Ensemble | null;
  alternatives: Ensemble[];
  considered: number;
  feasible: number;
  notes: string[];
};

/** Brute-force every combination across roles (fine for ≤6×6×3). Score = reach on targets, tie-break on fit. */
export function optimizeEnsemble(roles: OptRole[], c: Constraints): OptResult {
  const notes: string[] = [];
  const must = new Set(c.mustInclude);
  const excl = new Set(c.exclude);
  const options: (OptCandidate | null)[][] = roles.map((r) => {
    const forced = r.candidates.filter((x) => must.has(x.id));
    if (forced.length) return forced;
    const ok = r.candidates.filter(
      (x) => !excl.has(x.id) && x.fitRel !== null && x.fitRel >= c.fitFloor,
    );
    if (!ok.length) {
      notes.push(`No candidate for "${r.role}" passes the fit floor with Qloo data; role left open.`);
      return [null];
    }
    return ok;
  });

  const all: Ensemble[] = [];
  let considered = 0;
  const walk = (i: number, chosen: (OptCandidate | null)[]) => {
    if (i === options.length) {
      considered++;
      const picked = chosen.filter((x): x is OptCandidate => !!x);
      if (new Set(picked.map((p) => p.id)).size !== picked.length) return; // same person in two roles
      const aListers = picked.filter((p) => (p.popularity ?? 0) >= A_LIST_POP).length;
      if (c.maxAListers !== null && aListers > c.maxAListers) return;
      const cov = coverage(
        picked.flatMap((p) => (p.profile ? [p.profile] : [])),
        c.targets,
      );
      const fits = picked.map((p) => p.fitRel ?? 0);
      all.push({
        picks: roles.map((r, k) => ({ role: r.role, id: chosen[k]?.id ?? null, name: chosen[k]?.name ?? null })),
        reach: cov.total,
        perSegment: cov.perSegment,
        meanFit: fits.length ? fits.reduce((a, b) => a + b, 0) / fits.length : 0,
        aListers,
      });
      return;
    }
    for (const o of options[i]) walk(i + 1, [...chosen, o]);
  };
  walk(0, []);

  all.sort((a, b) => b.reach - a.reach || b.meanFit - a.meanFit);
  if (!all.length) notes.push("No combination satisfies the constraints (check must-include vs. A-lister cap).");
  return { best: all[0] ?? null, alternatives: all.slice(1, 3), considered, feasible: all.length, notes };
}

/** Return citation ids in text like [q3] that are not in the known set. */
export function unknownCitations(text: string, known: Set<string>): string[] {
  const cited = [...text.matchAll(/\[(q\d+)\]/g)].map((m) => m[1]);
  return [...new Set(cited.filter((id) => !known.has(id)))];
}
export function hasCitation(text: string): boolean {
  return /\[q\d+\]/.test(text);
}
