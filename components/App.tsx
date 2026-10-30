"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SAMPLE_BRIEF, type Brief, type ConstraintsInput } from "@/lib/brief";
import type { Board as BoardT, RunEvent, Rationale } from "@/lib/run";
import type { Entity } from "@/lib/qloo";
import type { Baseline } from "@/app/api/baseline/route";
import { BriefForm } from "./BriefForm";
import { Trace } from "./Trace";
import { Board } from "./Board";
import { WhyQloo } from "./WhyQloo";
import { Memo, downloadMemo } from "./Memo";
import { ThemeToggle } from "./ThemeToggle";

const DEFAULT_CONSTRAINTS: ConstraintsInput = { mustInclude: [], exclude: [], maxAListers: null, fitFloor: 0.9 };

export type FinalT = { summary: string | null; rationales: Rationale[]; rationaleStatus: "ok" | "partial" | "unavailable" };
export type NeedsInput = { query: string; kind: "title" | "person"; question: string; options: Entity[] };
type Diff = { refine: string; changes: string[] };

export function App() {
  const [view, setView] = useState<"landing" | "brief" | "run">("landing");
  const [brief, setBrief] = useState<Brief>(SAMPLE_BRIEF);
  const [constraints, setConstraints] = useState<ConstraintsInput>(DEFAULT_CONSTRAINTS);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [board, setBoard] = useState<BoardT | null>(null);
  const [final, setFinal] = useState<FinalT | null>(null);
  const [needs, setNeeds] = useState<NeedsInput | null>(null);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [tab, setTab] = useState<"board" | "why">("board");
  const [baseline, setBaseline] = useState<{ data: Baseline | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: false });
  const [diff, setDiff] = useState<Diff | null>(null);
  const [refineText, setRefineText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const boardRef = useRef<BoardT | null>(null);
  boardRef.current = board;

  const fetchBaseline = useCallback(async (b: Brief) => {
    setBaseline({ data: null, error: null, loading: true });
    try {
      const r = await fetch("/api/baseline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief: b }) });
      const j = await r.json();
      setBaseline({ data: j.baseline ?? null, error: r.ok ? null : j.error ?? "Baseline failed", loading: false });
    } catch {
      setBaseline({ data: null, error: "Baseline request failed", loading: false });
    }
  }, []);

  const run = useCallback(
    async (b: Brief, c: ConstraintsInput, refine?: string) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const prev = boardRef.current?.ensemble?.best?.picks.map((p) => ({ role: p.role, name: p.name })) ?? undefined;
      setView("run");
      setRunning(true);
      setFatal(null);
      setNeeds(null);
      setEvents([]);
      if (!refine) {
        setBoard(null);
        setFinal(null);
        setDiff(null);
        setTab("board");
        fetchBaseline(b);
      }
      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief: b, constraints: c, refine, previousEnsemble: refine ? prev : undefined, wildKinds: refine ? boardRef.current?.wildcards.map((w) => w.kind) : undefined }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `Request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (!chunk.startsWith("data: ")) continue;
            const e = JSON.parse(chunk.slice(6)) as RunEvent;
            setEvents((xs) => [...xs, e]);
            if (e.type === "board") setBoard(e.board);
            else if (e.type === "final") {
              setFinal({ summary: e.summary, rationales: e.rationales, rationaleStatus: e.rationaleStatus });
            } else if (e.type === "needs_input") setNeeds(e);
            else if (e.type === "state") {
              setBrief(e.brief);
              setConstraints(e.constraints);
            }
          }
        }
        if (refine && prev) {
          const now = boardRef.current?.ensemble?.best?.picks ?? [];
          const changes = now
            .map((p) => {
              const before = prev.find((x) => x.role === p.role)?.name ?? "open";
              return before !== (p.name ?? "open") ? `${p.role}: ${before} → ${p.name ?? "open"}` : null;
            })
            .filter((x): x is string => !!x);
          setDiff({ refine, changes });
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFatal((e as Error).message || "The run failed");
      } finally {
        setRunning(false);
      }
    },
    [fetchBaseline],
  );

  // Pin a name to a specific Qloo entity (from a chooser) and re-run.
  const pin = (name: string, id: string) => {
    const b = { ...brief, pins: [...brief.pins.filter((p) => p.name.toLowerCase() !== name.toLowerCase()), { name, id }] };
    setBrief(b);
    run(b, constraints);
  };

  const submitRefine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!refineText.trim() || running) return;
    run(brief, constraints, refineText.trim());
    setRefineText("");
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-24 sm:px-6">
      <header className="no-print flex items-center justify-between gap-4 border-b border-line py-4">
        <button onClick={() => setView("landing")} className="flex items-baseline gap-3 text-left" aria-label="CastSignal home">
          <span className="display text-3xl text-ink">CAST<span className="text-amber">SIGNAL</span></span>
          <span className="field-label hidden sm:inline">casting × audience intelligence</span>
        </button>
        <div className="flex items-center gap-2">
          {view !== "brief" && (
            <button className="btn btn-ghost whitespace-nowrap text-sm" onClick={() => setView("brief")}>
              {view === "run" ? "Edit brief" : "Start your own"}
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {view === "landing" && <Landing onSample={() => { setBrief(SAMPLE_BRIEF); setConstraints(DEFAULT_CONSTRAINTS); run(SAMPLE_BRIEF, DEFAULT_CONSTRAINTS); }} onOwn={() => setView("brief")} />}

      {view === "brief" && (
        <BriefForm
          initial={brief}
          onCancel={() => setView(board ? "run" : "landing")}
          onSubmit={(b) => { setBrief(b); setConstraints(DEFAULT_CONSTRAINTS); run(b, DEFAULT_CONSTRAINTS); }}
        />
      )}

      {view === "run" && (
        <main className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="no-print min-w-0 lg:sticky lg:top-4 lg:self-start">
            <Trace events={events} running={running} />
          </aside>
          <section className="min-w-0">
            <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="field-label">Production</p>
                <h1 className="display text-5xl">{brief.title}</h1>
                <p className="mt-1 max-w-2xl text-sm text-muted">{brief.logline}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-ghost text-sm" disabled={!board || running} onClick={() => window.print()}>Print memo / PDF</button>
                <button className="btn btn-ghost text-sm" disabled={!board || running} onClick={() => board && downloadMemo(brief, board, final)}>Download .md</button>
              </div>
            </div>

            {fatal && (
              <div role="alert" className="panel no-print mb-4 flex flex-wrap items-center justify-between gap-3 border-neg p-4">
                <p><strong className="text-neg">Run failed.</strong> {fatal}</p>
                <button className="btn btn-primary text-sm" onClick={() => run(brief, constraints)}>Retry</button>
              </div>
            )}

            {needs && <Chooser needs={needs} onPick={(id) => pin(needs.query, id)} />}

            {(board || running) && (
              <form onSubmit={submitRefine} className="panel no-print mb-5 flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                <label htmlFor="refine" className="field-label shrink-0">Refine</label>
                <input
                  id="refine"
                  className="input"
                  maxLength={300}
                  value={refineText}
                  onChange={(e) => setRefineText(e.target.value)}
                  placeholder='Tell the agent what changed… e.g. "We need to reach women 35–44"'
                  disabled={running || !board}
                />
                <button className="btn btn-primary shrink-0 text-sm" disabled={running || !board || !refineText.trim()}>
                  {running ? "Working…" : "Re-run"}
                </button>
              </form>
            )}
            {board && !running && !refineText && (
              <div className="no-print -mt-3 mb-5 flex flex-wrap gap-2">
                {["Keep Florence Pugh; we can only afford one A-lister.", "We need to reach women 35–44.", "Swap Barbarian for Scream."].map((s) => (
                  <button key={s} className="chip hover:border-amber" onClick={() => setRefineText(s)}>{s}</button>
                ))}
              </div>
            )}

            {diff && (
              <div className="panel no-print reveal mb-5 border-amber p-4">
                <p className="field-label">Change applied: “{diff.refine}”</p>
                <p className="mt-1 font-semibold">
                  {diff.changes.length ? `Ensemble changed: ${diff.changes.join(" · ")}` : "Ensemble unchanged."}
                </p>
                {final?.summary && <p className="mt-1 text-sm text-muted">{final.summary}</p>}
              </div>
            )}

            <div role="tablist" aria-label="Results" className="no-print mb-4 flex gap-1 border-b border-line">
              {(["board", "why"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`display -mb-px border-b-2 px-4 py-2 text-2xl ${tab === t ? "border-amber text-ink" : "border-transparent text-muted hover:text-ink"}`}
                >
                  {t === "board" ? "Casting Board" : "Why Qloo?"}
                </button>
              ))}
            </div>

            <div className="no-print">
              {tab === "board" ? (
                board ? <Board board={board} final={final} running={running} onPin={pin} /> : <BoardSkeleton />
              ) : (
                <WhyQloo board={board} baseline={baseline} onRetry={() => fetchBaseline(brief)} />
              )}
            </div>
            {board && <Memo brief={brief} board={board} final={final} />}
          </section>
        </main>
      )}
      <footer className="no-print mt-16 border-t border-line pt-4 text-xs text-muted">
        Audience data: Qloo Taste AI (live API). Agent: Claude. Affinity describes aggregate audience taste, not facts about individuals. Not a box-office prediction. MIT-licensed —{" "}
        <a className="underline" href="https://github.com/ayushgade06/castsignal">source</a>.
      </footer>
    </div>
  );
}

function Landing({ onSample, onOwn }: { onSample: () => void; onOwn: () => void }) {
  const steps = [
    ["01", "Brief", "Name two to five comparable titles and your shortlist for each role."],
    ["02", "Agent run", "The agent resolves every name in Qloo, scores audience fit, pulls demographics, compares taste and hunts for cross-over wildcards."],
    ["03", "Casting Board", "See fit × reach for every candidate, the wildcards, and the ensemble that reaches the most new audience — every number traceable to a Qloo call."],
  ];
  return (
    <main className="mt-8 sm:mt-12">
      <div className="bulbs reveal mb-5 w-40" aria-hidden />
      <p className="field-label reveal">For indie producers & casting directors</p>
      <h1 className="display reveal mt-3 max-w-5xl text-[clamp(3.2rem,8vw,6.75rem)]" style={{ animationDelay: "60ms" }}>
        Cast for the audience,<br />
        <span className="text-amber">not just the headline.</span>
      </h1>
      <p className="reveal mt-6 max-w-2xl text-lg text-muted" style={{ animationDelay: "120ms" }}>
        Popularity isn’t fit. CastSignal measures whether each candidate’s fans already love projects like yours, which audience segments they’d add, and who the surprising cross-over picks are — using Qloo’s cross-domain taste data, not guesses.
      </p>
      <div className="reveal mt-8 flex flex-wrap gap-3" style={{ animationDelay: "180ms" }}>
        <button className="btn btn-primary px-6 py-4 text-lg" onClick={onSample}>▶ Try the sample project</button>
        <button className="btn btn-ghost px-6 py-4 text-lg" onClick={onOwn}>Start your own</button>
      </div>
      <p className="field-label reveal mt-3" style={{ animationDelay: "200ms" }}>Sample: a social-thriller horror comedy · comps Get Out, Barbarian, Ready or Not · ~1 minute live run</p>

      <ol className="mt-16 grid gap-4 md:grid-cols-3">
        {steps.map(([n, t, d], i) => (
          <li key={n} className="panel crop reveal p-5" style={{ animationDelay: `${260 + i * 80}ms` }}>
            <div className="flex items-baseline justify-between">
              <span className="display text-5xl text-amber">{n}</span>
              <span className="field-label">scene {n}</span>
            </div>
            <h2 className="display mt-2 text-3xl">{t}</h2>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </li>
        ))}
      </ol>
      <div className="slate-stripes mt-12 h-3 w-full rounded-sm opacity-80" aria-hidden />
    </main>
  );
}

function Chooser({ needs, onPick }: { needs: NeedsInput; onPick: (id: string) => void }) {
  return (
    <div role="alert" className="panel reveal no-print mb-5 border-amber p-4">
      <p className="field-label">The agent needs you</p>
      <p className="mt-1 font-semibold">{needs.question}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {needs.options.map((o) => (
          <button key={o.id} className="btn btn-ghost text-sm" onClick={() => onPick(o.id)}>
            {o.name} <span className="chip">{o.disambiguation || "no date"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading results" className="grid grid-cols-1 gap-4">
      <div className="skeleton h-72" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="skeleton h-40" />
        <div className="skeleton h-40" />
      </div>
    </div>
  );
}
