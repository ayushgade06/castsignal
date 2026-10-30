"use client";
import { useEffect, useState } from "react";

type Mode = "system" | "dark" | "light";

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    try {
      const m = localStorage.getItem("theme") as Mode | null;
      if (m) setMode(m);
    } catch {}
  }, []);
  useEffect(() => {
    const el = document.documentElement;
    if (mode === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", mode);
    try {
      localStorage.setItem("theme", mode);
    } catch {}
  }, [mode]);
  const next: Record<Mode, Mode> = { system: "dark", dark: "light", light: "system" };
  return (
    <button className="btn btn-ghost text-sm" onClick={() => setMode(next[mode])} aria-label={`Theme: ${mode}. Click to change.`}>
      {mode === "dark" ? "☾ Dark" : mode === "light" ? "☀ Light" : "◐ Auto"}
    </button>
  );
}
