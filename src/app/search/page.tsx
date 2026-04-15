"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Progress from "@/components/Progress";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

type Hit = { md5: string; title: string; author?: string; year?: string; language?: string; pages?: string; extension?: string; size?: string };

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [fmt, setFmt] = useState<"epub" | "pdf" | "any">("epub");
  const [hits, setHits] = useState<Hit[]>([]);
  const [formatCounts, setFormatCounts] = useState<Record<string, number>>({});
  const [totalRaw, setTotalRaw] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string>("");
  const [status, setStatus] = useState("");
  const router = useRouter();

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setError(""); setHits([]);
    try {
      const res = await fetch(`${BP}/api/libgen/search?q=${encodeURIComponent(query)}&fmt=${fmt}`);
      const body = await res.json();
      if (!res.ok) throw new Error((typeof body.error === "string" && body.error) || "Search failed");
      setHits(body.hits || []);
      setFormatCounts(body.formatCounts || {});
      setTotalRaw(body.totalRaw || 0);
      const friendly = (typeof body.note === "string" && body.note) || (typeof body.error === "string" && body.error) || "";
      if (!body.hits?.length && body.totalRaw === 0 && friendly) setError(friendly);
    } catch (e: any) { setError(typeof e?.message === "string" ? e.message : String(e ?? "Unknown error")); } finally { setBusy(false); }
  }

  const [pct, setPct] = useState(0);

  async function pick(h: Hit) {
    setDownloading(h.md5); setStatus("Fetching from LibGen"); setPct(0); setError("");
    try {
      const res = await fetch(`${BP}/api/libgen/download`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ md5: h.md5, title: h.title, author: h.author, extension: h.extension }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error((typeof body.error === "string" && body.error) || "Download failed");
      const bookId = body.id;
      setStatus("Preparing");
      for (let i = 0; i < 600; i++) {
        await new Promise(r => setTimeout(r, 1200));
        const s = await fetch(`${BP}/api/books/${bookId}`).then(r => r.json());
        if (s.status === "ready") { router.push(`/book/${bookId}`); return; }
        if (s.status === "failed") throw new Error((typeof s.error === "string" && s.error) || "Extraction failed");
        setStatus(s.status_detail || "Extracting");
        setPct(Number(s.progress_pct || 0));
      }
      throw new Error("Extraction timed out");
    } catch (e: any) { setError(typeof e?.message === "string" ? e.message : String(e ?? "Unknown error")); setDownloading(""); setPct(0); }
  }

  return (
    <main className="app-shell">
      <header style={{ display: "flex", alignItems: "center", gap: "var(--m3-space-3)", padding: "var(--m3-space-4) var(--m3-space-5)", maxWidth: 960, margin: "0 auto", width: "100%" }}>
        <a href={BP} className="btn-ghost">← Library</a>
        <h1 style={{ font: "var(--m3-title-lg)", flex: 1 }}>Search LibGen</h1>
      </header>

      <form onSubmit={doSearch} style={{ maxWidth: 720, margin: "0 auto", padding: "0 var(--m3-space-5)", display: "flex", gap: "var(--m3-space-2)", width: "100%", flexWrap: "wrap" }}>
        <input
          autoFocus
          placeholder="Title, author, ISBN…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "var(--m3-space-3) var(--m3-space-4)", font: "var(--m3-body-lg)", border: "1px solid var(--m3-outline-variant)", borderRadius: "var(--m3-shape-sm)", background: "transparent", color: "inherit", fontFamily: "inherit" }}
        />
        <div className="seg" style={{ display: "inline-flex", background: "var(--m3-surface-container-highest)", borderRadius: "var(--m3-shape-full)", padding: 3, alignSelf: "center" }}>
          {(["epub", "pdf", "any"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={fmt === f} onClick={() => setFmt(f)}
              style={{ background: fmt === f ? "var(--m3-primary)" : "none", color: fmt === f ? "var(--m3-on-primary)" : "inherit", border: 0, padding: "var(--m3-space-2) var(--m3-space-3)", borderRadius: "var(--m3-shape-full)", font: "var(--m3-label-md)", cursor: "pointer", boxShadow: fmt === f ? "var(--m3-elev-1)" : "none", fontWeight: fmt === f ? 600 : 400 }}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <button className="btn-primary" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </form>

      {error && <p style={{ maxWidth: 720, margin: "var(--m3-space-3) auto", padding: "0 var(--m3-space-5)", color: "var(--m3-error)" }}>{error}</p>}
      {downloading ? (
        <div style={{ maxWidth: 720, margin: "var(--m3-space-4) auto", padding: "0 var(--m3-space-5)" }}>
          <Progress pct={pct} label={status || "Working"} indeterminate={pct === 0} />
        </div>
      ) : null}

      <div style={{ maxWidth: 760, margin: "var(--m3-space-5) auto var(--m3-space-8)", padding: "0 var(--m3-space-4)", width: "100%", display: "flex", flexDirection: "column", gap: "var(--m3-space-2)" }}>
        {hits.map((h) => {
          const isBusy = downloading === h.md5;
          const extColor: Record<string, string> = {
            epub: "#0ea5a6", pdf: "#b91c1c", djvu: "#9333ea", mobi: "#b45309", azw3: "#b45309", txt: "#525252", fb2: "#2563eb",
          };
          const badgeColor = extColor[h.extension || ""] || "#525252";
          const meta = [h.year, h.language, h.pages && `${h.pages}p`, h.size].filter(Boolean).join(" · ");
          return (
            <div key={h.md5}
              style={{
                background: "var(--m3-surface-container-low)",
                border: "1px solid var(--m3-outline-variant)",
                borderRadius: "var(--m3-shape-md)",
                padding: "var(--m3-space-3) var(--m3-space-4)",
                display: "flex", alignItems: "center", gap: "var(--m3-space-3)",
                opacity: downloading && !isBusy ? 0.45 : 1,
                transition: "opacity var(--m3-dur-short-3) var(--m3-ease-standard)",
              }}>
              <div style={{
                flexShrink: 0, width: 48, height: 48, borderRadius: "var(--m3-shape-sm)",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: `color-mix(in srgb, ${badgeColor} 14%, transparent)`,
                color: badgeColor, font: "var(--m3-label-sm)", fontWeight: 700, letterSpacing: "0.04em",
                fontFamily: "var(--m3-font-brand)",
              }}>
                {(h.extension || "?").toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  font: "var(--m3-title-sm)", fontWeight: 500,
                  color: "var(--m3-on-surface)",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>{h.title}</div>
                {h.author ? (
                  <div style={{ font: "var(--m3-body-sm)", color: "var(--m3-on-surface-variant)", marginTop: "var(--m3-space-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {h.author}
                  </div>
                ) : null}
                {meta ? (
                  <div style={{ font: "var(--m3-label-sm)", color: "var(--m3-on-surface-variant)", marginTop: "var(--m3-space-1)", fontVariantNumeric: "tabular-nums" }}>
                    {meta}
                  </div>
                ) : null}
              </div>

              <button
                className="btn-primary"
                disabled={!!downloading}
                onClick={() => pick(h)}
                style={{ minWidth: 68 }}
              >
                {isBusy ? "…" : "Get"}
              </button>
            </div>
          );
        })}
        {!busy && hits.length === 0 && query && !error && totalRaw > 0 ? (
          <div style={{ textAlign: "center", padding: "var(--m3-space-6) var(--m3-space-3)", color: "var(--m3-on-surface-variant)" }}>
            <p style={{ font: "var(--m3-body-lg)", marginBottom: "var(--m3-space-2)" }}>
              No <strong>{fmt.toUpperCase()}</strong> for &ldquo;{query}&rdquo;.
            </p>
            <p style={{ font: "var(--m3-body-md)", marginBottom: "var(--m3-space-3)" }}>
              LibGen has {totalRaw} result{totalRaw === 1 ? "" : "s"} in other formats:
            </p>
            <div style={{ display: "flex", gap: "var(--m3-space-2)", justifyContent: "center", flexWrap: "wrap" }}>
              {Object.entries(formatCounts)
                .filter(([k]) => k !== fmt)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <button key={k} className="btn-ghost" onClick={() => { setFmt(k as any); setTimeout(() => doSearch({ preventDefault: () => {} } as any), 0); }}>
                    {k.toUpperCase()} · {n}
                  </button>
                ))}
              <button className="btn-ghost" onClick={() => { setFmt("any"); setTimeout(() => doSearch({ preventDefault: () => {} } as any), 0); }}>
                Any format
              </button>
            </div>
          </div>
        ) : null}
        {!busy && hits.length === 0 && query && !error && totalRaw === 0 ? (
          <p style={{ color: "var(--m3-on-surface-variant)", textAlign: "center", padding: "var(--m3-space-7) 0", fontStyle: "italic" }}>
            No results for &ldquo;{query}&rdquo;.
          </p>
        ) : null}
      </div>
    </main>
  );
}
