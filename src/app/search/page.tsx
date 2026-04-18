"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AppNav from "@/components/AppNav";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

type Hit = {
  md5: string;
  title: string;
  author?: string;
  year?: string;
  language?: string;
  pages?: string;
  extension?: string;
  size?: string;
};

// Extension to accent colour, mirroring the design's .fmt-badge feel.
const FMT_COLOUR: Record<string, string> = {
  epub: "#0ea5a6",
  pdf: "#b91c1c",
  djvu: "#9333ea",
  mobi: "#b45309",
  azw3: "#b45309",
  txt: "#525252",
  fb2: "#2563eb",
};

const SUGGESTIONS = ["Piranesi", "Klara and the Sun", "The Waves", "Borges", "Italo Calvino"];

export default function DiscoverPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [fmt, setFmt] = useState<"epub" | "pdf" | "any">("epub");
  const [hits, setHits] = useState<Hit[]>([]);
  const [formatCounts, setFormatCounts] = useState<Record<string, number>>({});
  const [totalRaw, setTotalRaw] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string>("");
  const [status, setStatus] = useState("");
  const [pct, setPct] = useState(0);

  async function doSearch(qOverride?: string) {
    const q = (qOverride ?? query).trim();
    if (!q) return;
    setBusy(true);
    setError("");
    setHits([]);
    try {
      const res = await fetch(`${BP}/api/libgen/search?q=${encodeURIComponent(q)}&fmt=${fmt}`);
      const body = await res.json();
      if (!res.ok) throw new Error((typeof body.error === "string" && body.error) || "Search failed");
      setHits(body.hits || []);
      setFormatCounts(body.formatCounts || {});
      setTotalRaw(body.totalRaw || 0);
      const friendly = (typeof body.note === "string" && body.note) || (typeof body.error === "string" && body.error) || "";
      if (!body.hits?.length && body.totalRaw === 0 && friendly) setError(friendly);
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : String(e ?? "Unknown error"));
    } finally {
      setBusy(false);
    }
  }

  async function pick(h: Hit) {
    setDownloading(h.md5);
    setStatus("Fetching from LibGen");
    setPct(0);
    setError("");
    try {
      const res = await fetch(`${BP}/api/libgen/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ md5: h.md5, title: h.title, author: h.author, extension: h.extension }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error((typeof body.error === "string" && body.error) || "Download failed");
      const bookId = body.id;
      setStatus("Preparing");
      for (let i = 0; i < 600; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const s = await fetch(`${BP}/api/books/${bookId}`).then((r) => r.json());
        if (s.status === "ready") { router.push(`/book/${bookId}`); return; }
        if (s.status === "failed") throw new Error((typeof s.error === "string" && s.error) || "Extraction failed");
        setStatus(s.status_detail || "Extracting");
        setPct(Number(s.progress_pct || 0));
      }
      throw new Error("Extraction timed out");
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : String(e ?? "Unknown error"));
      setDownloading("");
      setPct(0);
    }
  }

  return (
    <>
      <AppNav active="discover" showResume={false} />
      <div className="page">
        <section className="discover-hero">
          <div className="mono">Discover · Add to library</div>
          <h1>
            Find your next <em>good evening.</em>
          </h1>
          <p>Search LibGen mirrors, browse OPDS catalogues, or drop in your own EPUBs. Every book you add syncs with the Android app.</p>
          <form
            onSubmit={(e) => { e.preventDefault(); doSearch(); }}
            className="search-wrap"
          >
            <svg className="icn sicon" viewBox="0 0 24 24" style={{ width: 20, height: 20 }}>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              autoFocus
              type="text"
              placeholder="Title, author, or ISBN — try “Borges” or “The Waves”"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="search-format" role="group" aria-label="Format filter">
              {(["epub", "pdf", "any"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={fmt === f ? "active" : ""}
                  onClick={() => setFmt(f)}
                  aria-pressed={fmt === f}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <button type="submit" className="btn btn-accent" disabled={busy}>
              {busy ? "Searching…" : "Search"}
            </button>
          </form>
          <div className="suggestions">
            <span className="mono" style={{ alignSelf: "center", marginRight: 6 }}>Trending:</span>
            {SUGGESTIONS.map((s) => (
              <button
                type="button"
                key={s}
                className="suggestion"
                onClick={() => { setQuery(s); doSearch(s); }}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <div className="sec-head" style={{ marginTop: 48 }}>
          <h2>Three ways to add a book</h2>
          <span className="mono">All stay synced</span>
        </div>

        <div className="add-methods">
          <a className="method" href="#libgen-results">
            <div className="icon-tile accent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 22, height: 22 }} strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
            </div>
            <h3>Search LibGen</h3>
            <p>Query LibGen mirrors for the title you want. Pick a format, hit Get, and we convert + extract it into your library.</p>
            <span className="arrow-link">Jump to results →</span>
          </a>
          <Link className="method" href="/opds-client">
            <div className="icon-tile">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 22, height: 22 }} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 14l4-4M8.5 7.5l2-2a4 4 0 015.6 5.6l-2 2M15.5 16.5l-2 2a4 4 0 01-5.6-5.6l2-2" />
              </svg>
            </div>
            <h3>Browse OPDS</h3>
            <p>Point at any OPDS feed — Calibre, Standard Ebooks, Gutenberg, your own Reader library — and import titles in place.</p>
            <span className="arrow-link">Open OPDS →</span>
          </Link>
          <Link className="method" href="/upload">
            <div className="icon-tile">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 22, height: 22 }} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v12M6 10l6-6 6 6" />
                <path d="M4 20h16" />
              </svg>
            </div>
            <h3>Upload files</h3>
            <p>Drop EPUB, PDF, MOBI, AZW3, DOCX, TXT, or Markdown. Reader extracts chapters and mirrors to your Android app.</p>
            <span className="arrow-link">Choose files →</span>
          </Link>
        </div>

        {downloading ? (
          <div className="banner warn" style={{ marginBottom: 24 }}>
            <span>{status || "Preparing"}</span>
            <div className="bar" style={{ flex: 1, margin: "0 12px" }}>
              <div className="bar-fill" style={{ width: `${pct}%`, transition: "width 400ms ease" }} />
            </div>
            <span className="mono">{pct}%</span>
          </div>
        ) : null}
        {error ? (
          <div className="banner" style={{ marginBottom: 24, color: "var(--error)" }}>{error}</div>
        ) : null}

        <div id="libgen-results" className="sec-head">
          <h2>LibGen results</h2>
          <span className="mono">{hits.length ? `${hits.length} shown` : "Try a search"}</span>
        </div>

        {hits.length > 0 ? (
          <div className="results">
            {hits.map((h) => {
              const isBusy = downloading === h.md5;
              const colour = FMT_COLOUR[h.extension || ""] || "#525252";
              const metaBits = [h.year, h.language, h.pages && `${h.pages}p`, h.size].filter(Boolean).join(" · ");
              return (
                <div className="result" key={h.md5} style={{ opacity: downloading && !isBusy ? 0.5 : 1 }}>
                  <div
                    className="fmt-badge"
                    style={{
                      background: `color-mix(in srgb, ${colour} 85%, black 15%)`,
                    }}
                    aria-label={`${(h.extension || "").toUpperCase()} format`}
                  >
                    {(h.extension || "?").toUpperCase()}
                  </div>
                  <div className="rbody">
                    <h4 className="tl">{h.title}</h4>
                    <div className="at">{h.author || "Unknown author"}</div>
                    {metaBits ? <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--reader-mono)", letterSpacing: "0.04em", marginTop: 4 }}>{metaBits}</div> : null}
                    <div className="meta-row">
                      <span>{h.year || "—"}</span>
                      <button type="button" className="add-btn" onClick={() => pick(h)} disabled={!!downloading}>
                        {isBusy ? "…" : "+ Get"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : !busy && query && totalRaw > 0 ? (
          <div style={{ padding: "48px 16px", textAlign: "center", color: "var(--ink-2)" }}>
            <p style={{ fontSize: 15, marginBottom: 12 }}>
              No <strong>{fmt.toUpperCase()}</strong> for &ldquo;{query}&rdquo;.
            </p>
            <p style={{ fontSize: 14, marginBottom: 20 }}>LibGen has {totalRaw} result{totalRaw === 1 ? "" : "s"} in other formats:</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {Object.entries(formatCounts)
                .filter(([k]) => k !== fmt)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <button type="button" key={k} className="chip" onClick={() => { setFmt(k as any); setTimeout(() => doSearch(), 0); }}>
                    {k.toUpperCase()} · {n}
                  </button>
                ))}
              <button type="button" className="chip" onClick={() => { setFmt("any"); setTimeout(() => doSearch(), 0); }}>Any format</button>
            </div>
          </div>
        ) : !busy && query && !error ? (
          <p style={{ color: "var(--ink-2)", textAlign: "center", padding: "60px 16px", fontStyle: "italic" }}>
            No results for &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <p style={{ color: "var(--ink-3)", textAlign: "center", padding: "40px 16px" }}>
            Enter a title, author, or ISBN above to see results from LibGen.
          </p>
        )}
      </div>

      <footer className="foot">
        <div className="foot-inner">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="logo-mark">R</span>
            <span style={{ fontFamily: "var(--reader-serif)", fontSize: 18, color: "var(--ink)" }}>Reader</span>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <Link href="/">Library</Link>
            <Link href="/upload">Upload</Link>
            <Link href="/opds-client">OPDS</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
