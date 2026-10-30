"use client";
import { useRef, useState } from "react";
import type { Board as BoardT, BoardCandidate, LedgerEntry, Wildcard } from "@/lib/run";
import { SEGMENTS, SEGMENT_LABEL, REACH_HIGH, A_LIST_POP, type Profile, type Segment } from "@/lib/scoring";
import type { FinalT } from "./App";

const pct = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}th pct`);
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;

export function Evidence({ ids, ledger }: { ids: string[]; ledger: LedgerEntry[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {[...new Set(ids)].map((id) => {
        const l = ledger.find((x) => x.id === id);
        return (
          <span key={id} className="chip text-amber" title={l ? `GET ${l.endpoint} · ${l.params} · ${l.count} results` : id}>
            {id}
          </span>
        );
      })}
    </span>
  );
}

export function Avatar({ name, image, size = 40 }: { name: string; image: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  if (image && !broken)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" width={size} height={size} onError={() => setBroken(true)} className="shrink-0 rounded-sm object-cover grayscale-[20%]" style={{ width: size, height: size }} />;
  return (
    <span className="display grid shrink-0 place-items-center rounded-sm bg-panel-2 text-muted" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden>
      {initials}
    </span>
  );
}

/** Diverging bars per segment (-1..1) with the comps' baseline as a tick. */
export function DemoStrip({ profile, base, targets, compact = false }: { profile: Profile | null; base: Profile | null; targets: Segment[]; compact?: boolean }) {
  if (!profile) return <p className="text-xs text-muted">No Qloo demographic data.</p>;
  if (compact)
    return (
      <div className="flex items-center gap-[3px]" aria-label="Audience age and gender skew versus average">
        {SEGMENTS.map((s) => {
          const v = profile[s];
          const h = Math.abs(v) * 14;
          return (
            <span key={s} className="relative h-8 w-2.5" title={`${SEGMENT_LABEL[s]}: ${signed(v)}`}>
              <span className="absolute left-0 right-0 top-1/2 h-px bg-line" />
              <span
                className={`absolute left-0 right-0 ${v >= 0 ? "bg-pos" : "bg-neg"} ${targets.includes(s) ? "" : "opacity-50"}`}
                style={v >= 0 ? { bottom: "50%", height: h } : { top: "50%", height: h }}
              />
            </span>
          );
        })}
      </div>
    );
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Audience over/under-index by segment versus average; tick marks the comps’ baseline</caption>
      <tbody>
        {SEGMENTS.map((s) => {
          const v = profile[s];
          const b = base?.[s] ?? null;
          return (
            <tr key={s}>
              <th scope="row" className={`w-14 py-0.5 pr-2 text-left font-mono font-normal ${targets.includes(s) ? "text-amber" : "text-muted"}`}>
                {SEGMENT_LABEL[s]}{targets.includes(s) ? " ◆" : ""}
              </th>
              <td className="py-0.5">
                <div className="relative h-3 rounded-sm bg-panel-2">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-muted/40" />
                  <span
                    className={`absolute inset-y-0.5 rounded-sm ${v >= 0 ? "bg-pos" : "bg-neg"}`}
                    style={v >= 0 ? { left: "50%", width: `${v * 50}%` } : { right: "50%", width: `${-v * 50}%` }}
                  />
                  {b !== null && <span className="absolute -inset-y-0.5 w-0.5 bg-ink" style={{ left: `${50 + b * 50}%` }} title={`Comps baseline ${signed(b)}`} />}
                </div>
              </td>
              <td className="w-12 py-0.5 pl-2 text-right font-mono">{signed(v)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Quadrant({ cands, onOpen }: { cands: BoardCandidate[]; onOpen: (c: BoardCandidate) => void }) {
  const pts = cands.filter((c) => c.fitRank !== null && c.reach !== null);
  const yMax = Math.max(0.5, ...pts.map((c) => c.reach! * 1.15));
  const X = (v: number) => 8 + v * 84;
  const Y = (v: number) => 92 - (v / yMax) * 84;
  const yT = Y(REACH_HIGH);
  return (
    <div className="crop relative rounded border border-line bg-bg p-2">
      <svg viewBox="0 0 100 100" className="aspect-[4/3] w-full" role="img" aria-label="Fit versus reach quadrant">
        <line x1={X(0.5)} y1="6" x2={X(0.5)} y2="94" stroke="var(--line)" strokeWidth="0.3" strokeDasharray="1 1" />
        <line x1="6" y1={yT} x2="94" y2={yT} stroke="var(--line)" strokeWidth="0.3" strokeDasharray="1 1" />
        {[
          ["Audience expander", 93, 9, "end"],
          ["Cult pick", 7, 9, "start"],
          ["Safe bet", 93, 97, "end"],
          ["Risky", 7, 97, "start"],
        ].map(([t, x, y, a]) => (
          <text key={t as string} x={x as number} y={y as number} textAnchor={a as "end" | "start"} fontSize="3.2" fill="var(--muted)" style={{ fontFamily: "var(--font-courier)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {t}
          </text>
        ))}
        <text x="50" y="99.5" textAnchor="middle" fontSize="2.6" fill="var(--muted)">audience fit (rank within this call) →</text>
        <text x="3.5" y="50" textAnchor="middle" fontSize="2.6" fill="var(--muted)" transform="rotate(-90 3.5 50)">reach gain on target segments →</text>
        {pts.map((c) => (
          <g key={c.query} role="button" tabIndex={0} aria-label={`${c.name}: ${c.quadrant}`} className="cursor-pointer focus:outline-none" onClick={() => onOpen(c)} onKeyDown={(e) => e.key === "Enter" && onOpen(c)}>
            <circle cx={X(c.fitRank!)} cy={Y(c.reach!)} r="2.2" fill="var(--amber)" stroke="var(--bg)" strokeWidth="0.6" />
            <text x={X(c.fitRank!) + (c.fitRank! > 0.75 ? -3 : 3)} y={Y(c.reach!) + 1} fontSize="3.2" fill="var(--ink)" textAnchor={c.fitRank! > 0.75 ? "end" : "start"} fontWeight="600">
              {c.name}
            </text>
          </g>
        ))}
      </svg>
      {cands.length > pts.length && (
        <p className="px-1 pb-1 text-xs text-muted">
          Not plotted: {cands.filter((c) => !pts.includes(c)).map((c) => `${c.name} (${c.status === "scored" ? "no demographics" : c.status === "no_fit_data" ? "no Qloo fit data" : c.status.replace("_", " ")})`).join(", ")}
        </p>
      )}
    </div>
  );
}

function statusBadge(c: BoardCandidate) {
  if (c.status === "no_fit_data") return <span className="chip border-amber text-amber">Not enough Qloo data</span>;
  if (c.status === "not_found") return <span className="chip border-neg text-neg">Not found in Qloo</span>;
  if (c.status === "ambiguous") return <span className="chip border-amber text-amber">Ambiguous name</span>;
  return null;
}

export function Board({ board, final, running, onPin }: { board: BoardT; final: FinalT | null; running: boolean; onPin: (name: string, id: string) => void }) {
  const [open, setOpen] = useState<BoardCandidate | Wildcard | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const show = (c: BoardCandidate | Wildcard) => {
    setOpen(c);
    dlg.current?.showModal();
  };
  const rationale = (name: string, query?: string) =>
    final?.rationales.find((r) => [name, query].filter(Boolean).some((n) => r.name.toLowerCase() === n!.toLowerCase()))?.text ?? null;
  const ens = board.ensemble;
  const tLabel = board.targets.map((t) => SEGMENT_LABEL[t]).join(", ") || "none";

  return (
    <div className="grid grid-cols-1 gap-6">
      {(board.partial || running) && (
        <p className={`chip w-fit ${board.partial ? "border-neg text-neg" : ""}`}>{board.partial ? "PARTIAL — some Qloo calls failed; results use the data that came back" : "Updating as the agent works…"}</p>
      )}

      {/* Comps */}
      <section aria-labelledby="comps-h" className="reveal">
        <h2 id="comps-h" className="field-label mb-2">Comparable titles (the audience you’re casting for)</h2>
        <div className="flex flex-wrap gap-3">
          {board.comps.map((c) => (
            <div key={c.query} className="panel flex items-center gap-3 p-2 pr-4">
              <Avatar name={c.name} image={c.image} size={44} />
              <div>
                <p className="font-semibold leading-tight">{c.name} {c.disambiguation && <span className="chip ml-1">{c.disambiguation}</span>}</p>
                <p className="text-xs text-muted">
                  {c.status === "resolved" ? (c.hasDemographics ? "in baseline" : "no demographics") : c.status === "not_found" ? "not found in Qloo" : "ambiguous"}
                </p>
              </div>
            </div>
          ))}
        </div>
        {board.baseline && (
          <div className="panel mt-3 grid gap-3 p-4 md:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="field-label">Comps’ audience baseline</p>
              <p className="mt-1 text-sm">
                Target segments to grow ({board.targetsSource === "user" ? "your choice" : "auto: where the comps under-index"}): <strong className="text-amber">{tLabel}</strong>
              </p>
              <p className="mt-2 text-xs text-muted">Bars show relative over/under-index versus the average audience (−1…1), from Qloo demographics <Evidence ids={board.ledger.filter((l) => l.params.includes("demographics")).map((l) => l.id).slice(0, 3)} ledger={board.ledger} /></p>
            </div>
            <DemoStrip profile={board.baseline} base={null} targets={board.targets} />
          </div>
        )}
      </section>

      {/* Ensemble */}
      {ens && (
        <section aria-labelledby="ens-h" className="panel crop reveal p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ens-h" className="display text-4xl">Recommended ensemble</h2>
            <span className="field-label">{ens.feasible} of {ens.considered} combinations feasible · deterministic optimizer</span>
          </div>
          {final?.summary && <p className="mt-2 max-w-3xl">{final.summary}</p>}
          {final?.rationaleStatus === "unavailable" && !running && <p className="mt-2 text-sm text-amber">Rationales unavailable (agent did not complete). Scores and evidence below are complete.</p>}
          {ens.best ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ens.best.picks.map((p) => {
                const c = board.roles.find((r) => r.role === p.role)?.candidates.find((x) => x.id === p.id);
                return (
                  <button key={p.role} onClick={() => c && show(c)} disabled={!c} className="panel flex items-center gap-3 p-3 text-left hover:border-amber">
                    {c ? <Avatar name={c.name} image={c.image} size={56} /> : <Avatar name="?" image={null} size={56} />}
                    <div>
                      <p className="field-label">{p.role}</p>
                      <p className="display text-3xl">{p.name ?? "Open"}</p>
                      {c?.quadrant && <p className="text-xs text-muted">{c.band} · {c.quadrant}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-neg">No ensemble satisfies the constraints.</p>
          )}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="field-label">Target-audience coverage (Σ positive over-index on {tLabel})</p>
              <div className="mt-2 space-y-1.5 text-sm">
                {[["Comps alone", ens.coverageBefore], ["Comps + ensemble", ens.coverageAfter]].map(([l, v]) => (
                  <div key={l as string} className="flex items-center gap-2">
                    <span className="w-36 shrink-0">{l}</span>
                    <span className="h-3 flex-1 rounded-sm bg-panel-2">
                      <span className="block h-3 rounded-sm bg-amber" style={{ width: `${Math.min(100, ((v as number) / Math.max(board.targets.length, 1)) * 100)}%` }} />
                    </span>
                    <span className="w-12 text-right font-mono">{(v as number).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Max possible is {board.targets.length.toFixed(0)} (every target segment fully over-indexed).</p>
            </div>
            <div className="text-sm">
              <p className="field-label">Constraints</p>
              <p className="mt-1">Fit floor: within {Math.round((1 - ens.constraints.fitFloor) * 100)}% of each role’s best fit · A-listers (popularity ≥ {A_LIST_POP}): {ens.constraints.maxAListers ?? "no cap"}{ens.constraints.mustInclude.length ? ` · must include ${ens.constraints.mustInclude.join(", ")}` : ""}{ens.constraints.exclude.length ? ` · exclude ${ens.constraints.exclude.join(", ")}` : ""}</p>
              {ens.alternatives.length > 0 && (
                <p className="mt-2"><span className="field-label">Runners-up </span>{ens.alternatives.map((a) => a.picks.map((p) => p.name ?? "open").join(" + ") + ` (${a.reach.toFixed(2)})`).join(" · ")}</p>
              )}
              {ens.notes.map((n) => <p key={n} className="mt-1 text-amber">{n}</p>)}
            </div>
          </div>
        </section>
      )}

      {/* Roles */}
      {board.roles.map((r) => (
        <section key={r.role} aria-labelledby={`role-${r.role}`} className="reveal">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 id={`role-${r.role}`} className="display text-4xl">{r.role}</h2>
            {r.evidence && <span className="text-xs text-muted">fit from <Evidence ids={[r.evidence]} ledger={board.ledger} /></span>}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Quadrant cands={r.candidates} onOpen={show} />
            <ul className="grid min-w-0 grid-cols-1 content-start gap-2">
              {[...r.candidates]
                .sort((a, b) => (b.fitRank ?? -1) - (a.fitRank ?? -1))
                .map((c) => (
                  <li key={c.query}>
                    <button onClick={() => show(c)} className="panel flex w-full items-center gap-3 p-2.5 text-left hover:border-amber">
                      <Avatar name={c.name} image={c.image} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{c.name}</p>
                        <p className="text-xs text-muted">
                          {c.band ? `${c.band}${c.quadrant ? ` · ${c.quadrant}` : c.profile ? "" : " · no demographics"}` : statusBadge(c)}
                        </p>
                      </div>
                      <DemoStrip profile={c.profile} base={board.baseline} targets={board.targets} compact />
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </section>
      ))}

      {/* Wildcards */}
      {board.wildcards.length > 0 && (
        <section aria-labelledby="wild-h" className="reveal">
          <h2 id="wild-h" className="display text-4xl">Cross-over wildcards</h2>
          <p className="mb-3 text-sm text-muted">Names not on your shortlist whose audiences already fit the comps — surfaced by Qloo, not by the LLM.</p>
          {board.wildcards.map((w) => (
            <div key={w.kind} className="mb-4">
              <p className="field-label mb-2">{w.kind}s</p>
              {w.note ? (
                <p className="text-sm text-muted">{w.note} Try different comps or another kind.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {w.items.map((i) => (
                    <button key={i.id} onClick={() => show(i)} className="panel flex items-center gap-3 p-2.5 text-left hover:border-amber">
                      <Avatar name={i.name} image={i.image} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{i.name}</p>
                        <p className="text-xs text-muted">{i.band}{i.driver ? ` · driven by ${i.driver}` : ""}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <Methodology />

      <dialog ref={dlg} onClose={() => setOpen(null)} className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-md border border-line bg-panel p-0 text-ink">
        {open && <CandidateCard c={open} board={board} rationale={rationale(open.name, "query" in open ? open.query : undefined)} onPin={onPin} onClose={() => dlg.current?.close()} />}
      </dialog>
    </div>
  );
}

function CandidateCard({ c, board, rationale, onPin, onClose }: { c: BoardCandidate | Wildcard; board: BoardT; rationale: string | null; onPin: (n: string, id: string) => void; onClose: () => void }) {
  const isCand = "query" in c;
  const role = isCand ? board.roles.find((r) => r.candidates.includes(c)) : null;
  const scored = role ? role.candidates.filter((x) => x.fitRank !== null).sort((a, b) => b.fitRank! - a.fitRank!) : [];
  const rank = isCand ? scored.findIndex((x) => x === c) + 1 : 0;
  return (
    <div>
      <div className="slate-stripes h-3" aria-hidden />
      <div className="flex items-start gap-4 p-5">
        <Avatar name={c.name} image={c.image} size={72} />
        <div className="min-w-0 flex-1">
          <p className="field-label">{isCand ? role?.role : `${c.kind} wildcard`}</p>
          <h3 className="display text-4xl">{c.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {isCand && statusBadge(c)}
            {c.band && <span className="chip">{c.band}{isCand && rank ? ` · #${rank} of ${scored.length}` : ""}</span>}
            {isCand && c.quadrant && <span className="chip">{c.quadrant}</span>}
            <span className="chip">popularity {pct(c.popularity)}</span>
          </div>
        </div>
        <button onClick={onClose} className="btn btn-ghost px-2 py-1" aria-label="Close">✕</button>
      </div>
      <div className="grid grid-cols-1 gap-4 px-5 pb-5">
        {isCand && c.status === "no_fit_data" && (
          <p className="rounded border border-amber/60 p-3 text-sm">Qloo doesn’t have enough audience data for {c.name} against these comps. Decide on track record — Qloo can’t speak to this audience, and CastSignal won’t invent a score.</p>
        )}
        {isCand && c.status === "not_found" && <p className="rounded border border-neg/60 p-3 text-sm">“{c.query}” wasn’t found in Qloo. Check the spelling in the brief.</p>}
        <div>
          <p className="field-label mb-1">Rationale (written by the agent from the evidence)</p>
          <p className="text-sm">{rationale ?? <span className="text-muted">No rationale for this name{isCand ? "" : " yet"}.</span>}</p>
        </div>
        {"drivers" in c && c.drivers.length > 0 && (
          <div>
            <p className="field-label mb-1">Which comp drives the fit (Qloo explainability)</p>
            <ul className="space-y-1 text-sm">
              {[...c.drivers].sort((a, b) => b.score - a.score).map((d) => (
                <li key={d.name} className="flex items-center gap-2">
                  <span className="w-40 truncate">{d.name}</span>
                  <span className="h-2 flex-1 rounded-sm bg-panel-2"><span className="block h-2 rounded-sm bg-amber" style={{ width: `${d.score * 100 * 2}%` }} /></span>
                  <span className="w-10 text-right font-mono text-xs">{d.score.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!isCand && c.driver && <p className="text-sm">Strongest driver: fans of <strong>{c.driver}</strong>.</p>}
        {isCand && c.brings.length > 0 && (
          <div>
            <p className="field-label mb-1">Taste themes linked to this candidate that the comps don’t carry (Qloo compare)</p>
            <div className="flex flex-wrap gap-1.5">{c.brings.map((b) => <span key={b} className="chip">{b}</span>)}</div>
          </div>
        )}
        <div>
          <p className="field-label mb-1">Audience demographics vs comps baseline (tick) — ◆ target segments</p>
          <DemoStrip profile={c.profile} base={board.baseline} targets={board.targets} />
          {isCand && c.reach !== null && <p className="mt-1 text-xs text-muted">Reach gain on targets: <span className="font-mono">{c.reach.toFixed(2)}</span> (mean over-index beyond the comps’ baseline)</p>}
        </div>
        <p className="text-xs text-muted">Evidence: <Evidence ids={c.evidence} ledger={board.ledger} /></p>
        {isCand && c.alternatives.length > 1 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Wrong person? Pick the right “{c.query}”</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {c.alternatives.filter((a) => a.id !== c.id).map((a) => (
                <button key={a.id} className="btn btn-ghost text-xs" onClick={() => { onClose(); onPin(c.query, a.id); }}>
                  {a.name} <span className="chip">{a.disambiguation || "no date"}</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export function Methodology() {
  return (
    <details className="panel p-4 text-sm">
      <summary className="field-label cursor-pointer">Methodology & limits</summary>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
        <li><strong className="text-ink">Fit</strong> is Qloo affinity of each candidate to the comps’ audience (/v2/insights with explainability). Qloo normalizes affinity per query, so candidates are compared only within the same call; we show bands and ranks, not false precision (“91 vs 92 is effectively the same”).</li>
        <li><strong className="text-ink">Reach</strong> uses Qloo demographics (relative over/under-index, −1…1, versus average). Reach gain = mean amount a candidate over-indexes beyond the comps’ baseline on the target segments. Targets are yours, or (auto) the segments where the comps under-index.</li>
        <li><strong className="text-ink">Ensemble</strong> is a deterministic brute-force search: one pick per role maximizing Σ over target segments of the best over-index among the picks, with a fit floor, must-include/exclude, an A-lister cap (Qloo popularity ≥ {A_LIST_POP}) and no duplicates.</li>
        <li>Popularity is a within-domain percentile. Affinity describes aggregate audience taste, never facts about an individual. This is not a box-office prediction or a judgment of anyone’s talent or worth.</li>
        <li>The LLM never produces numbers: every number on this page comes from Qloo or deterministic code. Rationales must cite evidence ids; the server rejects uncited ones.</li>
        <li>Coverage gaps are shown, never filled: a candidate Qloo can’t score gets a “Not enough Qloo data” badge.</li>
      </ul>
    </details>
  );
}
