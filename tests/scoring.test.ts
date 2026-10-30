import { describe, expect, it } from "vitest";
import {
  rankNormalize, baseline, reachGain, targetSegments, quadrant, coverage,
  optimizeEnsemble, unknownCitations, toProfile, SEGMENTS,
  type Profile, type OptRole, type Constraints,
} from "@/lib/scoring";

const flat = (v: number): Profile => Object.fromEntries(SEGMENTS.map((s) => [s, v])) as Profile;
const withSeg = (over: Partial<Profile>) => ({ ...flat(0), ...over });

describe("rankNormalize", () => {
  it("maps best to 1, worst to 0", () => {
    expect(rankNormalize([{ id: "a", value: 0.8 }, { id: "b", value: 0.7 }, { id: "c", value: 0.6 }]))
      .toEqual({ a: 1, b: 0.5, c: 0 });
  });
  it("ties share the average rank; single item is 1", () => {
    expect(rankNormalize([{ id: "a", value: 0.8 }, { id: "b", value: 0.8 }, { id: "c", value: 0.1 }]))
      .toEqual({ a: 0.75, b: 0.75, c: 0 });
    expect(rankNormalize([{ id: "x", value: 0.2 }])).toEqual({ x: 1 });
  });
});

describe("reach", () => {
  it("baseline averages profiles; under-indexed segments become default targets", () => {
    const b = baseline([withSeg({ female: 0.4, male: -0.4 }), withSeg({ female: 0.2, male: -0.2 })])!;
    expect(b.female).toBeCloseTo(0.3);
    expect(targetSegments(b, [])).toEqual(["male"]);
    expect(targetSegments(b, ["35_to_44"])).toEqual(["35_to_44"]);
    expect(baseline([])).toBeNull();
  });
  it("reachGain counts only over-index beyond the positive part of the baseline", () => {
    const base = withSeg({ female: 0.5, male: -0.5 });
    expect(reachGain(withSeg({ female: 0.7, male: 0.3 }), base, ["female", "male"])).toBeCloseTo((0.2 + 0.3) / 2);
    expect(reachGain(withSeg({ female: 0.1 }), base, ["female"])).toBe(0);
    expect(reachGain(withSeg({}), base, [])).toBe(0);
  });
  it("quadrants and coverage", () => {
    expect(quadrant(1, 0.3)).toBe("Audience expander");
    expect(quadrant(1, 0)).toBe("Safe bet");
    expect(quadrant(0, 0.3)).toBe("Cult pick");
    expect(quadrant(0, 0)).toBe("Risky");
    const cov = coverage([withSeg({ male: 0.2, female: -0.1 }), withSeg({ male: 0.5 })], ["male", "female"]);
    expect(cov.total).toBeCloseTo(0.5);
    expect(cov.perSegment).toEqual({ male: 0.5, female: 0 });
  });
  it("toProfile reads the real demographics shape", () => {
    const p = toProfile({
      age: { "24_and_younger": 0.9, "25_to_29": 0, "30_to_34": 0, "35_to_44": 0, "45_to_54": 0, "55_and_older": 0 },
      gender: { male: -0.6, female: 0.6 },
    });
    expect(p["24_and_younger"]).toBe(0.9);
    expect(p.female).toBe(0.6);
  });
});

const roles: OptRole[] = [
  {
    role: "Lead",
    candidates: [
      { id: "A", name: "A", fitRel: 1, fitRank: 1, popularity: 0.99, profile: withSeg({ male: 0.1 }) },
      { id: "B", name: "B", fitRel: 0.95, fitRank: 0.5, popularity: 0.8, profile: withSeg({ male: 0.6 }) },
      { id: "C", name: "C", fitRel: 0.5, fitRank: 0, popularity: 0.5, profile: withSeg({ male: 0.9 }) }, // below floor
      { id: "K", name: "K", fitRel: null, fitRank: null, popularity: null, profile: null }, // no Qloo data
    ],
  },
  {
    role: "Friend",
    candidates: [
      { id: "D", name: "D", fitRel: 1, fitRank: 1, popularity: 0.97, profile: withSeg({ "35_to_44": 0.7 }) },
      { id: "E", name: "E", fitRel: 0.92, fitRank: 0, popularity: 0.6, profile: withSeg({ "35_to_44": 0.2 }) },
    ],
  },
];
const c = (over: Partial<Constraints> = {}): Constraints => ({
  targets: ["male", "35_to_44"], fitFloor: 0.9, mustInclude: [], exclude: [], maxAListers: null, ...over,
});

describe("optimizeEnsemble", () => {
  it("maximizes reach over eligible candidates, skipping below-floor and no-data people", () => {
    const r = optimizeEnsemble(roles, c());
    expect(r.best!.picks.map((p) => p.id)).toEqual(["B", "D"]);
    expect(r.best!.reach).toBeCloseTo(1.3);
    expect(r.considered).toBe(4); // {A,B} x {D,E}
    expect(r.alternatives).toHaveLength(2);
  });
  it("must-include forces a pick", () => {
    expect(optimizeEnsemble(roles, c({ mustInclude: ["A"] })).best!.picks[0].id).toBe("A");
  });
  it("A-lister cap is enforced", () => {
    const r = optimizeEnsemble(roles, c({ mustInclude: ["A"], maxAListers: 1 }));
    expect(r.best!.picks.map((p) => p.id)).toEqual(["A", "E"]);
    expect(r.best!.aListers).toBe(1);
  });
  it("exclude and impossible constraints", () => {
    expect(optimizeEnsemble(roles, c({ exclude: ["B"] })).best!.picks[0].id).toBe("A");
    const none = optimizeEnsemble(roles, c({ mustInclude: ["A", "D"], maxAListers: 1 }));
    expect(none.best).toBeNull();
    expect(none.notes.join(" ")).toMatch(/No combination/);
  });
  it("never picks the same person twice; a role with no eligible candidate is left open", () => {
    const dup: OptRole[] = [
      { role: "R1", candidates: [roles[0].candidates[1]] },
      { role: "R2", candidates: [roles[0].candidates[1], roles[1].candidates[1]] },
      { role: "R3", candidates: [roles[0].candidates[3]] },
    ];
    const r = optimizeEnsemble(dup, c({ targets: ["male"] }));
    expect(r.best!.picks.map((p) => p.id)).toEqual(["B", "E", null]);
    expect(r.notes[0]).toMatch(/R3/);
  });
});

describe("citation validator", () => {
  it("flags ids not in the ledger", () => {
    expect(unknownCitations("Fans over-index [q1][q7] and [q2].", new Set(["q1", "q2"]))).toEqual(["q7"]);
    expect(unknownCitations("no cites", new Set())).toEqual([]);
  });
});
