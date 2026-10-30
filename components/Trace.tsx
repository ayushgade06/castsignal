"use client";
import { useEffect, useRef } from "react";
import type { RunEvent } from "@/lib/run";

const TOOL_LABEL: Record<string, string> = {
  resolve_entities: "Resolve names in Qloo",
  choose_entity: "Settle ambiguity",
  ask_user: "Ask you",
  score_fit: "Score audience fit",
  get_demographics: "Pull demographics",
  compare_audiences: "Compare taste",
  find_wildcards: "Hunt wildcards",
  update_brief: "Update brief",
  optimize_ensemble: "Optimize ensemble",
  finish: "Write rationales",
};

/** Live agent trace: progress, Qloo calls (endpoint, params, count, latency), decisions and warnings. Not chain-of-thought. */
export function Trace({ events, running }: { events: RunEvent[]; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);
  const calls = events.filter((e) => e.type === "call").length;
  const results = new Map(events.flatMap((e) => (e.type === "tool_result" ? [[e.id, e] as const] : [])));

  return (
    <div className="panel overflow-hidden">
      <div className="slate-stripes h-4" aria-hidden />
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <h2 className="display text-2xl">Agent trace</h2>
        <span className="field-label" aria-live="polite">{running ? "● rolling" : "cut"} · {calls} Qloo calls</span>
      </div>
      <ol className="max-h-[70vh] space-y-2 overflow-y-auto p-3 text-sm" aria-live="polite">
        {events.length === 0 && running && <li className="text-muted">Connecting to the agent…</li>}
        {events.map((e, i) => {
          if (e.type === "tool") {
            const r = results.get(e.id);
            return (
              <li key={i} className="reveal">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${!r ? "animate-pulse bg-amber" : r.ok ? "bg-pos" : "bg-neg"}`} aria-hidden />
                  <span className="font-semibold">{TOOL_LABEL[e.name] ?? e.name}</span>
                </div>
                {r && <p className={`ml-4 mt-0.5 text-xs ${r.ok ? "text-muted" : "text-neg"}`}>{r.summary}</p>}
              </li>
            );
          }
          if (e.type === "call")
            return (
              <li key={i} className="ml-4 font-mono text-[0.7rem] leading-snug text-muted">
                <span className="text-amber">[{e.entry.id}]</span> GET {e.entry.endpoint} · {e.entry.count} results · {e.entry.cached ? "cached" : `${e.entry.ms}ms`}
                <span className="block truncate opacity-80" title={e.entry.params}>{e.entry.params}</span>
              </li>
            );
          if (e.type === "note" || e.type === "status") return <li key={i} className="italic text-muted">{e.text}</li>;
          if (e.type === "warning") return <li key={i} className="rounded border border-amber/50 bg-amber-soft/40 px-2 py-1 text-xs">⚠ {e.text}</li>;
          if (e.type === "error") return <li key={i} role="alert" className="rounded border border-neg/60 px-2 py-1 text-xs text-neg">✕ {e.text}</li>;
          if (e.type === "needs_input") return <li key={i} className="font-semibold text-amber">? Waiting for your choice: {e.query}</li>;
          if (e.type === "done") return <li key={i} className="field-label pt-2">— that’s a wrap —</li>;
          return null;
        })}
        <div ref={end} />
      </ol>
    </div>
  );
}
