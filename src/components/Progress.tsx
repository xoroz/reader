"use client";

/**
 * Shared-m3 progress wrapper: wavy for determinate, morph for indeterminate.
 * Both variants are styled via shared-m3/components.css; contextual label is
 * spoken via aria-live for accessibility.
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
            marginBottom: "0.4rem",
            color: "var(--reader-muted)",
            fontFamily: "var(--reader-sans)",
          }}
        >
          <span>{label}</span>
          {typeof pct === "number" ? (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{clamped}%</span>
          ) : null}
        </div>
      ) : null}
      <div
        className="m3-progress-wavy"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ ["--m3-progress" as any]: String(clamped) }}
      />
    </div>
  );
}
