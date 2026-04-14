"use client";
import { useEffect } from "react";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

export type Prefs = {
  font: string;
  fontSize: number;
  lineHeight: number;
  measure: number;
  margins: number;
  theme: "light" | "sepia" | "dark" | "solarized";
  justify: boolean;
  hyphenate: boolean;
  mode: "paginated" | "scroll";
  ttsVoice?: string;
  ttsRate?: number;
};

export const DEFAULT_PREFS: Prefs = {
  font: '"Source Serif 4", "Iowan Old Style", Charter, Georgia, serif',
  fontSize: 19,
  lineHeight: 1.65,
  measure: 62,
  margins: 3,
  theme: "light",
  justify: false,
  hyphenate: false,
  mode: "paginated",
  ttsVoice: "nova",
  ttsRate: 1.0,
};

const FONTS: { label: string; value: string }[] = [
  { label: "Source Serif", value: '"Source Serif 4", "Iowan Old Style", Charter, Georgia, serif' },
  { label: "Georgia", value: 'Georgia, "Times New Roman", serif' },
  { label: "Charter", value: 'Charter, Georgia, serif' },
  { label: "Inter / System", value: '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, sans-serif' },
];

export default function PrefsSheet({ prefs, onChange, onClose }: { prefs: Prefs; onChange: (p: Prefs) => void; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`${BP}/api/prefs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prefs) }).catch(() => {});
      try { localStorage.setItem("reader.prefs", JSON.stringify(prefs)); } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [prefs]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set<K extends keyof Prefs>(k: K, v: Prefs[K]) { onChange({ ...prefs, [k]: v }); }

  return (
    <aside className="prefs-panel" role="dialog" aria-label="Typography preferences" onClick={(e) => e.stopPropagation()}>
      <button className="close" onClick={onClose} aria-label="Close">×</button>
      <div className="title">Typography</div>

      <h3>Layout</h3>
      <div className="seg">
        <button aria-pressed={prefs.mode === "paginated"} onClick={() => set("mode", "paginated")}>Paginated</button>
        <button aria-pressed={prefs.mode === "scroll"} onClick={() => set("mode", "scroll")}>Scroll</button>
      </div>

      <h3>Theme</h3>
      <div className="seg">
        {(["light", "sepia", "dark", "solarized"] as const).map(t => (
          <button key={t} aria-pressed={prefs.theme === t} onClick={() => set("theme", t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      <h3>Font</h3>
      <select value={prefs.font} onChange={(e) => set("font", e.target.value)}>
        {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>

      <h3>Size</h3>
      <div className="row">
        <span>{prefs.fontSize}px</span>
        <input type="range" min={14} max={28} step={1} value={prefs.fontSize} onChange={(e) => set("fontSize", Number(e.target.value))} />
      </div>

      <h3>Line height</h3>
      <div className="row">
        <span>{prefs.lineHeight.toFixed(2)}</span>
        <input type="range" min={1.3} max={2.0} step={0.05} value={prefs.lineHeight} onChange={(e) => set("lineHeight", Number(e.target.value))} />
      </div>

      <h3>Column width</h3>
      <div className="row">
        <span>{prefs.measure}ch</span>
        <input type="range" min={40} max={90} step={1} value={prefs.measure} onChange={(e) => set("measure", Number(e.target.value))} />
      </div>

      <h3>Margins</h3>
      <div className="row">
        <span>{prefs.margins.toFixed(1)}rem</span>
        <input type="range" min={1} max={6} step={0.5} value={prefs.margins} onChange={(e) => set("margins", Number(e.target.value))} />
      </div>

      <h3>Text</h3>
      <div className="row">
        <span>Justify</span>
        <div className="seg" style={{ width: "auto" }}>
          <button aria-pressed={!prefs.justify} onClick={() => set("justify", false)}>off</button>
          <button aria-pressed={prefs.justify} onClick={() => set("justify", true)}>on</button>
        </div>
      </div>
      <div className="row">
        <span>Hyphens</span>
        <div className="seg" style={{ width: "auto" }}>
          <button aria-pressed={!prefs.hyphenate} onClick={() => set("hyphenate", false)}>off</button>
          <button aria-pressed={prefs.hyphenate} onClick={() => set("hyphenate", true)}>on</button>
        </div>
      </div>
    </aside>
  );
}
