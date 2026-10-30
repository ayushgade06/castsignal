// Live smoke test against the real Qloo API: `pnpm smoke`. Needs QLOO_API_KEY in .env.local.
import assert from "node:assert/strict";
import { RunState } from "../lib/run";
import { SAMPLE_BRIEF } from "../lib/brief";

const state = new RunState(structuredClone(SAMPLE_BRIEF), { mustInclude: [], exclude: [], maxAListers: null, fitFloor: 0.9 }, () => {}, "smoke");
const t0 = Date.now();

await state.ensureResolved();
const comps = state.compIds();
console.log(`resolved comps: ${comps.length}/${SAMPLE_BRIEF.comps.length}`);
assert.ok(comps.length >= 2, "comps should resolve");

for (const r of SAMPLE_BRIEF.roles) {
  const f = await state.ensureFit(r.role);
  const ranked = [...f.scores.values()].sort((a, b) => b.affinity! - a.affinity!);
  console.log(`fit ${r.role}: ${ranked.map((s) => `${s.name} ${s.affinity!.toFixed(3)}`).join(", ")}${f.missing.length ? ` | no data: ${f.missing.join(", ")}` : ""}`);
  assert.ok(ranked.length > 0, `fit results for ${r.role}`);
}

await state.ensureDemographics();
console.log(`demographics: ${state.demos.size} entities with data`);
assert.ok(state.demos.size > 0, "demographics non-empty");
const base = state.baselineProfile();
assert.ok(base, "comps baseline");
console.log(`comps baseline: ${Object.entries(base!).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}`);

for (const kind of ["comedian", "musician", "actor"] as const) {
  const w = await state.findWildcards(kind);
  console.log(`wildcards ${kind}: ${w.items.map((x) => x.name).join(", ") || w.note}`);
  assert.ok(w.items.length > 0, `wildcards ${kind}`);
}

const cmp = await state.compareCandidate("Jenna Ortega");
console.log(`compare Jenna Ortega vs comps brings: ${cmp.brings.join(", ")}`);

const opt = await state.optimize(state.constraints);
console.log(`ensemble: ${opt.result.best?.picks.map((p) => `${p.role}=${p.name}`).join(", ")} (reach ${opt.result.best?.reach.toFixed(2)}, targets ${opt.constraints.targets.join(",")})`);
assert.ok(opt.result.best, "an ensemble");

console.log(`\nSMOKE OK: ${state.ledger.length} Qloo calls in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
