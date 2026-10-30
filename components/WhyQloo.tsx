"use client";
import type { Board as BoardT } from "@/lib/run";
import type { Baseline } from "@/app/api/baseline/route";
import { coverage, SEGMENT_LABEL, type Profile } from "@/lib/scoring";
import { Evidence } from "./Board";

const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Verdict = "confirmed" | "contradicted" | "unverifiable";

/** Same brief, LLM alone vs Qloo-grounded result. Computed live from both answers; illustrative, not a benchmark. */
export function WhyQloo({ board, baseline, onRetry }: { board: BoardT | null; baseline: { data: Baseline | null; error: string | null; loading: boolean }; onRetry: () => void }) {
  if (baseline.loading || !board)
    return <div aria-busy="true" className="skeleton h-64" />;
  if (baseline.error || !baseline.data)
    return (
      <div role="alert" className="panel flex items-center justify-between gap-3 p-4">
        <p>{baseline.error ?? "No LLM-only answer."}</p>
        <button className="btn btn-primary text-sm" onClick={onRetry}>Retry</button>
      </div>
    );
  const b = baseline.data;
  const people = board.roles.flatMap((r) => r.candidates);
  const findCand = (name: string) => people.find((c) => n(c.name) === n(name) || n(c.query) === n(name));

  // Audience claims checked against Qloo demographics.
  const claims = b.audience_claims.flatMap((cl) => {
    const c = findCand(cl.name);
    return cl.adds_segments.map((s) => {
      const v = c?.profile?.[s];
      const verdict: Verdict = v === undefined || v === null ? "unverifiable" : v > 0 ? "confirmed" : "contradicted";
      return { name: cl.name, seg: s, v: v ?? null, verdict };
    });
  });
  const count = (k: Verdict) => claims.filter((c) => c.verdict === k).length;

  // Ensemble coverage of the LLM's picks, measured with Qloo data.
  const llmProfiles = b.ensemble.map((p) => findCand(p.name)?.profile).filter((p): p is Profile => !!p);
  const base = board.baseline ? [board.baseline] : [];
  const llmCov = coverage([...base, ...llmProfiles], board.targets).total;
  const qCov = board.ensemble?.coverageAfter ?? null;

  const qWild = board.wildcards.flatMap((w) => w.items.map((i) => i.name));
  const overlap = b.wildcards.filter((w) => qWild.some((q) => n(q) === n(w.name)));

  return (
    <div className="grid grid-cols-1 gap-6">
      <p className="chip w-fit border-amber text-amber">Illustrative comparison, not a benchmark — both answers generated live for this brief</p>

      <section className="panel p-4">
        <h3 className="display text-3xl">Ranking by audience fit</h3>
        <p className="mb-3 text-sm text-muted">Left: the LLM alone, asked to rank by how well each fan base matches the comps. Right: Qloo affinity from one insights call per role.</p>
        {board.roles.map((r) => {
          const llm = b.roles.find((x) => n(x.role) === n(r.role))?.ranking ?? [];
          const q = r.candidates.filter((c) => c.fitRank !== null).sort((a, z) => z.fitRank! - a.fitRank!);
          const noData = r.candidates.filter((c) => c.status === "no_fit_data");
          const llmTop = llm[0];
          const qTop = q[0]?.name;
          return (
            <div key={r.role} className="mb-4">
              <p className="field-label mb-1">{r.role}</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <ol className="list-decimal space-y-0.5 pl-5">
                  {llm.map((x, k) => {
                    const c = findCand(x);
                    const flag = c?.status === "no_fit_data";
                    const dup = llm.findIndex((y) => n(y) === n(x)) !== k;
                    return <li key={k} className={flag ? "text-neg" : ""}>{x}{flag && " — no Qloo audience data"}{dup && <span className="text-muted"> (listed twice by the LLM)</span>}</li>;
                  })}
                </ol>
                <ol className="list-decimal space-y-0.5 pl-5">
                  {q.map((c) => <li key={c.query}>{c.name} <span className="text-xs text-muted">{c.band}</span></li>)}
                  {noData.map((c) => <li key={c.query} className="list-none text-muted">— {c.name}: not enough Qloo data</li>)}
                </ol>
              </div>
              {llmTop && qTop && n(llmTop) !== n(qTop) && (
                <p className="mt-2 rounded border border-amber/60 p-2 text-sm">
                  <strong>Disagreement:</strong> the LLM puts <strong>{llmTop}</strong> first; Qloo’s measured audience overlap puts <strong>{qTop}</strong> first{findCand(llmTop)?.band ? ` (Qloo has ${llmTop} as “${findCand(llmTop)!.band}”)` : findCand(llmTop)?.status === "no_fit_data" ? ` (Qloo can’t measure ${llmTop}’s audience at all)` : ""}.
                </p>
              )}
              {r.evidence && <p className="mt-1 text-xs text-muted">Qloo evidence: <Evidence ids={[r.evidence]} ledger={board.ledger} /></p>}
            </div>
          );
        })}
      </section>

      <section className="panel p-4">
        <h3 className="display text-3xl">Audience claims, fact-checked</h3>
        <p className="mb-2 text-sm text-muted">The LLM said which segments each person’s fans over-index on. We checked each claim against Qloo demographics.</p>
        <p className="mb-3 text-sm">
          <span className="text-pos">{count("confirmed")} confirmed</span> · <span className="text-neg">{count("contradicted")} contradicted</span> · <span className="text-muted">{count("unverifiable")} unverifiable (no Qloo data)</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {claims.map((c, i) => (
            <span key={i} className={`chip ${c.verdict === "confirmed" ? "border-pos text-pos" : c.verdict === "contradicted" ? "border-neg text-neg" : "text-muted"}`} title={c.v !== null ? `Qloo: ${c.v.toFixed(2)}` : "No Qloo demographics"}>
              {c.name} · {SEGMENT_LABEL[c.seg]} {c.verdict === "confirmed" ? "✓" : c.verdict === "contradicted" ? `✕ (${c.v!.toFixed(2)})` : "?"}
            </span>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="panel p-4">
          <h3 className="display text-3xl">Ensemble</h3>
          <p className="text-sm"><span className="field-label">LLM alone </span>{b.ensemble.map((p) => `${p.role}: ${p.name}`).join(" · ")}</p>
          <p className="mt-1 text-sm"><span className="field-label">Qloo-grounded </span>{board.ensemble?.best?.picks.map((p) => `${p.role}: ${p.name ?? "open"}`).join(" · ") ?? "—"}</p>
          <p className="mt-3 text-sm">
            Target coverage measured with Qloo data: LLM picks <strong className="font-mono">{llmCov.toFixed(2)}</strong>{llmProfiles.length < b.ensemble.length ? " (some picks have no Qloo demographics)" : ""} vs CastSignal <strong className="font-mono">{qCov?.toFixed(2) ?? "—"}</strong> on {board.targets.map((t) => SEGMENT_LABEL[t]).join(", ")}.
          </p>
        </div>
        <div className="panel p-4">
          <h3 className="display text-3xl">Wildcards</h3>
          <p className="text-sm"><span className="field-label">LLM alone </span>{b.wildcards.map((w) => w.name).join(", ")}</p>
          <p className="mt-1 text-sm"><span className="field-label">Qloo-surfaced </span>{qWild.join(", ") || "—"}</p>
          <p className="mt-3 text-sm">{overlap.length ? `Overlap: ${overlap.map((o) => o.name).join(", ")}.` : "No overlap: every Qloo wildcard is one the LLM never mentioned, and the LLM’s picks are unmeasured guesses."}</p>
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="display text-3xl">Every Qloo call behind this result</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left font-mono text-xs">
            <thead className="text-muted"><tr><th className="py-1 pr-2">id</th><th className="pr-2">tool</th><th className="pr-2">endpoint</th><th className="pr-2">params</th><th className="pr-2">status</th><th className="pr-2">results</th><th>latency</th></tr></thead>
            <tbody>
              {board.ledger.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="py-1 pr-2 text-amber">{l.id}</td><td className="pr-2">{l.tool}</td><td className="pr-2">{l.endpoint}</td>
                  <td className="max-w-[280px] truncate pr-2" title={l.params}>{l.params}</td><td className="pr-2">{l.status}</td><td className="pr-2">{l.count}</td><td>{l.cached ? "cached" : `${l.ms}ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <details className="text-sm text-muted">
        <summary className="cursor-pointer">LLM-alone summary (verbatim)</summary>
        <p className="mt-2">{b.summary}</p>
      </details>
    </div>
  );
}
