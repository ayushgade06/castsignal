// Run the full agent from the CLI and print the event stream: `pnpm agent ["refine text"]`.
import { runAgent } from "../lib/agent";
import { SAMPLE_BRIEF, RunRequestSchema } from "../lib/brief";
import type { RunEvent } from "../lib/run";

const refine = process.argv[2];
const req = RunRequestSchema.parse({ brief: SAMPLE_BRIEF, ...(refine ? { refine } : {}) });
const t0 = Date.now();
const s = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
await runAgent(req, (e: RunEvent) => {
  if (e.type === "call") console.log(s(), "CALL", e.entry.id, e.entry.endpoint, e.entry.params.slice(0, 90), e.entry.status, `${e.entry.ms}ms`, e.entry.cached ? "cached" : "");
  else if (e.type === "board") {
    const b = e.board;
    console.log(s(), "BOARD", b.roles.map((r) => `${r.role}: ${r.candidates.map((c) => `${c.name}[${c.status}${c.quadrant ? " " + c.quadrant : ""}]`).join(", ")}`).join(" | "));
    console.log(s(), "  ensemble", b.ensemble?.best?.picks.map((p) => `${p.role}=${p.name}`).join(", "), `coverage ${b.ensemble?.coverageBefore.toFixed(2)} -> ${b.ensemble?.coverageAfter.toFixed(2)}`);
    console.log(s(), "  wildcards", b.wildcards.map((w) => `${w.kind}: ${w.items.map((i) => i.name).join(", ")}`).join(" | "));
  } else if (e.type === "final") console.log(s(), "FINAL", JSON.stringify(e, null, 1));
  else console.log(s(), e.type.toUpperCase(), JSON.stringify(e).slice(0, 260));
});
console.log(`total ${s()}`);
