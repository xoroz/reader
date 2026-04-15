"use client";

/**
 * Shared-m3 progress wrapper: solid determinate bar, morph for indeterminate.
 * If the caller-supplied label already contains a percent (e.g. "Downloading
 * 31% of 32.3 MB"), the right-hand percent readout is suppressed to avoid a
 * duplicate "...MB22%" rendering.
 */
export default function Progress({
  pct,
  label,
  indeterminate,
}: {
  pct?: number;
  label?: string;
  indeterminate?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  const ariaLabel = label || (indeterminate ? "Working..." : `${clamped}% complete`);
  const labelHasPercent = typeof label === "string" && /\d%/.test(label);

  if (indeterminate) {
    return (
      <div aria-live="polite" style={{ width: "100%" }}>
        {label ? (
          <div
            className="m3-progress-label"
            style={{ marginBottom: "0.4rem", color: "var(--reader-muted)", fontFamily: "var(--reader-sans)" }}
          >
            {label}
          </div>
        ) : null}
        <div
          className="m3-progress-morph"
          role="progressbar"
          aria-label={ariaLabel}
          aria-busy="true"
        />
      </div>
    );
  }

  return (
    <div aria-live="polite" style={{ width: "100%" }}>
      {label ? (
        <div
          className="m3-progress-label"
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "0.75rem",
            marginBottom: "0.4rem",
            color: "var(--reader-muted)",
            fontFamily: "var(--reader-sans)",
          }}
        >
          <span>{label}</span>
          {typeof pct === "number" && !labelHasPercent ? (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{clamped}%</span>
          ) : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: "100%",
          height: 8,
          borderRadius: 999,
          background: "color-mix(in srgb, var(--reader-fg) 12%, transparent)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            background: "var(--reader-fg, currentColor)",
            borderRadius: 999,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}
