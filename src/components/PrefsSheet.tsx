"use client";
import { useEffect } from "react";
import { apiFetch } from "@/lib/csrf-client";

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

// Three-step scales — same semantics as the Android prefs sheet.
const FONT_SIZE = [16, 19, 23] as const;
const LINE_HEIGHT = [1.45, 1.65, 1.9] as const;
const MEASURE = [52, 62, 78] as const;
const MARGINS = [1.5, 3, 5] as const;
type Step = "S" | "M" | "L";
function pickStep<T extends number>(value: number, scale: readonly [T, T, T]): Step {
  const [s, m, l] = scale;
  const ds = Math.abs(value - s), dm = Math.abs(value - m), dl = Math.abs(value - l);
  if (ds <= dm && ds <= dl) return "S";
  if (dl < dm) return "L";
  return "M";
}
function stepValue<T extends number>(step: Step, scale: readonly [T, T, T]): T {
  return step === "S" ? scale[0] : step === "L" ? scale[2] : scale[1];
}

export default function PrefsSheet({ prefs, onChange, onClose }: { prefs: Prefs; onChange: (p: Prefs) => void; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => {
      apiFetch(`${BP}/api/prefs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prefs) }).catch(() => {});
      try { localStorage.setItem("reader.prefs", JSON.stringify(prefs)); } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [prefs]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set<K extends keyof Prefs>(k: K, v: Prefs[K]) { onChange({ ...prefs, [k]: v }); }

  function SizeSeg({ current, onPick }: { current: Step; onPick: (s: Step) => void }) {
    return (
      <div className="seg">
        {(["S", "M", "L"] as const).map((s) => (
          <button key={s} aria-pressed={current === s} onClick={() => onPick(s)}>{s}</button>
        ))}
      </div>
    );
  }

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

      <h3>Text size</h3>
      <SizeSeg current={pickStep(prefs.fontSize, FONT_SIZE)} onPick={(s) => set("fontSize", stepValue(s, FONT_SIZE))} />

      <h3>Line spacing</h3>
      <SizeSeg current={pickStep(prefs.lineHeight, LINE_HEIGHT)} onPick={(s) => set("lineHeight", stepValue(s, LINE_HEIGHT))} />

      <h3>Column width</h3>
      <SizeSeg current={pickStep(prefs.measure, MEASURE)} onPick={(s) => set("measure", stepValue(s, MEASURE))} />

      <h3>Margins</h3>
      <SizeSeg current={pickStep(prefs.margins, MARGINS)} onPick={(s) => set("margins", stepValue(s, MARGINS))} />

      <h3>Alignment</h3>
      <div className="seg">
        <button aria-pressed={!prefs.justify} onClick={() => set("justify", false)}>Left</button>
        <button aria-pressed={prefs.justify} onClick={() => set("justify", true)}>Justify</button>
      </div>

      <h3>Hyphenate long words</h3>
      <div className="seg">
        <button aria-pressed={!prefs.hyphenate} onClick={() => set("hyphenate", false)}>Off</button>
        <button aria-pressed={prefs.hyphenate} onClick={() => set("hyphenate", true)}>On</button>
      </div>
    </aside>
  );
}
