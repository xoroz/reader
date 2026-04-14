"use client";

export default function Progress({ pct, label, indeterminate }: { pct?: number; label?: string; indeterminate?: boolean }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  return (
    <div aria-live="polite" style={{ width: "100%" }}>
      {label ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: "var(--reader-muted)", marginBottom: "0.4rem", fontFamily: "var(--reader-sans)" }}>
          <span>{label}</span>
          {!indeterminate && typeof pct === "number" ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{clamped}%</span> : null}
        </div>
      ) : null}
      <div style={{ position: "relative", height: 6, background: "color-mix(in srgb, var(--reader-fg) 8%, transparent)", borderRadius: 999, overflow: "hidden" }}>
        {indeterminate ? (
          <div style={{
            position: "absolute", inset: 0, width: "40%",
            background: "linear-gradient(90deg, transparent, var(--reader-fg), transparent)",
            opacity: 0.6, borderRadius: 999,
            animation: "rdr-indeterm 1.4s ease-in-out infinite",
          }} />
        ) : (
          <div style={{
            height: "100%", width: `${clamped}%`,
            background: "linear-gradient(90deg, var(--reader-fg), color-mix(in srgb, var(--reader-fg) 70%, transparent))",
            borderRadius: 999,
            transition: "width 0.35s cubic-bezier(.25,.8,.25,1)",
          }} />
        )}
      </div>
      <style>{`
        @keyframes rdr-indeterm {
          0% { transform: translateX(-40%); }
          50% { transform: translateX(80%); }
          100% { transform: translateX(260%); }
        }
      `}</style>
    </div>
  );
}
