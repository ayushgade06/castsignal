"use client";
import { useEffect, useId, useState } from "react";
import { BriefSchema, type Brief } from "@/lib/brief";
import { SEGMENTS, SEGMENT_LABEL, type Segment } from "@/lib/scoring";

type Sugg = { id: string; name: string; disambiguation: string | null; image: string | null };
type Pin = Brief["pins"][number];

/** Chip input with Qloo-backed autocomplete (/api/resolve → Qloo /search). Picking a suggestion pins the exact entity. */
function NameInput({ kind, values, max, onChange, onPin, label }: { kind: "title" | "person"; values: string[]; max: number; onChange: (v: string[]) => void; onPin: (p: Pin) => void; label: string }) {
  const [q, setQ] = useState("");
  const [sugg, setSugg] = useState<Sugg[]>([]);
  const [active, setActive] = useState(-1);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    if (q.trim().length < 2) {
      setSugg([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/resolve?kind=${kind}&q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        const j = await r.json();
        setSugg(j.results ?? []);
        setErr(r.ok ? null : j.error ?? "Search unavailable");
        setActive(-1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr("Search unavailable");
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, kind]);

  const add = (name: string, s?: Sugg) => {
    const n = name.trim();
    if (!n || values.length >= max || values.some((v) => v.toLowerCase() === n.toLowerCase())) return;
    onChange([...values, n]);
    if (s) onPin({ name: n, id: s.id });
    setQ("");
    setSugg([]);
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1.5 rounded border border-line bg-bg p-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-sm bg-panel-2 px-2 py-1 text-sm">
            {v}
            <button type="button" aria-label={`Remove ${v}`} className="text-muted hover:text-neg" onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
          </span>
        ))}
        {values.length < max && (
          <input
            aria-label={label}
            role="combobox"
            aria-expanded={sugg.length > 0}
            aria-controls={`${id}-list`}
            aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
            className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 outline-none"
            value={q}
            maxLength={80}
            placeholder={kind === "title" ? "Add a movie or TV show…" : "Add a name…"}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, sugg.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
              else if (e.key === "Enter") { e.preventDefault(); active >= 0 ? add(sugg[active].name, sugg[active]) : add(q); }
              else if (e.key === "Escape") setSugg([]);
              else if (e.key === "Backspace" && !q && values.length) onChange(values.slice(0, -1));
            }}
          />
        )}
      </div>
      {sugg.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="panel absolute z-20 mt-1 max-h-72 w-full overflow-y-auto p-1 shadow-xl">
          {sugg.map((s, i) => (
            <li
              key={s.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm ${i === active ? "bg-panel-2" : "hover:bg-panel-2"}`}
              onMouseDown={(e) => { e.preventDefault(); add(s.name, s); }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {s.image ? <img src={s.image} alt="" className="h-8 w-8 rounded-sm object-cover" /> : <span className="h-8 w-8 rounded-sm bg-panel-2" />}
              <span className="flex-1">{s.name}</span>
              <span className="chip">{s.disambiguation || "—"}</span>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="mt-1 text-xs text-neg">{err}. You can still type names and press Enter.</p>}
    </div>
  );
}

export function BriefForm({ initial, onSubmit, onCancel }: { initial: Brief; onSubmit: (b: Brief) => void; onCancel: () => void }) {
  const [b, setB] = useState<Brief>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Brief>) => setB((x) => ({ ...x, ...patch }));
  const addPin = (p: Pin) => setB((x) => ({ ...x, pins: [...x.pins.filter((y) => y.name.toLowerCase() !== p.name.toLowerCase()), p] }));
  const toggleTarget = (s: Segment) => set({ targets: b.targets.includes(s) ? b.targets.filter((t) => t !== s) : [...b.targets, s] });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = { ...b, roles: b.roles.filter((r) => r.role.trim() || r.candidates.length) };
    const p = BriefSchema.safeParse(clean);
    if (!p.success) {
      const i = p.error.issues[0];
      setError(`${i.path.join(" › ") || "Brief"}: ${i.message}`);
      return;
    }
    if (p.data.comps.length < 2) return setError("Add at least two comparable titles.");
    if (p.data.roles.some((r) => r.candidates.length < 2)) return setError("Each role needs a shortlist of at least two names.");
    setError(null);
    onSubmit(p.data);
  };

  return (
    <form onSubmit={submit} className="mx-auto mt-8 max-w-3xl space-y-6" noValidate>
      <div>
        <p className="field-label">Call sheet</p>
        <h1 className="display text-6xl">Your project brief</h1>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <label className="block">
          <span className="field-label">Project title</span>
          <input className="input mt-1" required maxLength={120} value={b.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="block">
          <span className="field-label">Logline</span>
          <input className="input mt-1" maxLength={500} value={b.logline} onChange={(e) => set({ logline: e.target.value })} />
        </label>
      </div>
      <div>
        <span className="field-label">Comparable titles (2–5)</span>
        <div className="mt-1"><NameInput kind="title" label="Comparable titles" values={b.comps} max={5} onChange={(comps) => set({ comps })} onPin={addPin} /></div>
      </div>
      <fieldset>
        <legend className="field-label">Target audience to grow (optional; leave empty to let the agent target what your comps under-cover)</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SEGMENTS.map((s) => (
            <button type="button" key={s} aria-pressed={b.targets.includes(s)} onClick={() => toggleTarget(s)} className={`chip px-3 py-1 text-sm ${b.targets.includes(s) ? "border-amber bg-amber-soft text-ink" : "hover:border-amber"}`}>
              {SEGMENT_LABEL[s]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="space-y-4">
        {b.roles.map((r, i) => (
          <div key={i} className="panel crop space-y-2 p-4">
            <div className="flex items-end gap-2">
              <label className="block flex-1">
                <span className="field-label">Role {i + 1}</span>
                <input className="input mt-1" maxLength={60} value={r.role} onChange={(e) => set({ roles: b.roles.map((x, k) => (k === i ? { ...x, role: e.target.value } : x)) })} />
              </label>
              {b.roles.length > 1 && <button type="button" className="btn btn-ghost text-sm" onClick={() => set({ roles: b.roles.filter((_, k) => k !== i) })}>Remove role</button>}
            </div>
            <span className="field-label">Shortlist (2–6)</span>
            <NameInput kind="person" label={`Shortlist for role ${i + 1}`} values={r.candidates} max={6} onPin={addPin} onChange={(candidates) => set({ roles: b.roles.map((x, k) => (k === i ? { ...x, candidates } : x)) })} />
          </div>
        ))}
        {b.roles.length < 3 && <button type="button" className="btn btn-ghost text-sm" onClick={() => set({ roles: [...b.roles, { role: `Role ${b.roles.length + 1}`, candidates: [] }] })}>+ Add role</button>}
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={b.wildcards} onChange={(e) => set({ wildcards: e.target.checked })} className="h-4 w-4 accent-[var(--amber)]" />
        <span>Suggest cross-over wildcards (comedians, musicians, actors not on my shortlist)</span>
      </label>
      {error && <p role="alert" className="text-neg">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary px-6 py-3">Run the agent</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-ghost" onClick={() => setB({ title: "", logline: "", comps: [], targets: [], roles: [{ role: "Lead", candidates: [] }], wildcards: true, pins: [] })}>Clear form</button>
      </div>
    </form>
  );
}
