"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/csrf-client";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

/**
 * Typography-first book row that matches the design handoff's `.book-row`
 * spec. Progress bar / meta / menu live inline; archive + delete happen
 * via the trailing menu. The card also polls ingest status for in-flight
 * books so the user sees live progress.
 */
export default function LibraryCard({
  id,
  index,
  title,
  author,
  status,
  wordCount,
  chapterIdx,
  chapterCount,
  hasCover,
  highlight,
  ingestPct,
  ingestDetail,
  estimatedMinutes,
  finished,
}: {
  id: string;
  index: number;
  title: string | null;
  author: string | null;
  status: string;
  wordCount: number | null;
  chapterIdx: number | null;
  chapterCount: number | null;
  hasCover: boolean;
  highlight?: "new" | "dup" | null;
  ingestPct?: number | null;
  ingestDetail?: string | null;
  estimatedMinutes?: number | null;
  finished?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [coverOk, setCoverOk] = useState(hasCover);
  const [livePct, setLivePct] = useState<number | null>(ingestPct ?? null);
  const [liveDetail, setLiveDetail] = useState<string | null>(ingestDetail ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLAnchorElement | null>(null);

  const inFlight = status !== "ready" && status !== "failed" && status !== "duplicate";
  useEffect(() => {
    if (!inFlight) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const res = await fetch(`${BP}/api/books/${id}/status`, { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (!cancelled) {
            setLivePct(typeof j.progressPct === "number" ? j.progressPct : null);
            setLiveDetail(j?.progress?.message || j?.statusDetail || null);
            if (j.status === "ready" || j.status === "failed" || j.status === "duplicate") {
              router.refresh();
              return;
            }
          }
        }
      } catch {}
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, inFlight, router]);

  useEffect(() => {
    if (!highlight || !rowRef.current) return;
    rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const onArchive = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setMenuOpen(false);
    try {
      const res = await apiFetch(`${BP}/api/books/${id}/archive`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err: any) {
      alert(`Archive failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [id, router]);

  const onDelete = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${title || "Untitled"}"?`)) return;
    setBusy(true);
    setMenuOpen(false);
    try {
      const res = await apiFetch(`${BP}/api/books/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
      setBusy(false);
    }
  }, [id, router, title]);

  const displayTitle = (title || "Untitled").replace(/\s+/g, " ").trim();
  const displayAuthor = author ? author.replace(/\s+/g, " ").trim() : "";
  const progressPct = chapterIdx != null && chapterCount
    ? Math.min(100, Math.round((chapterIdx / chapterCount) * 100))
    : 0;
  const ready = status === "ready";
  const numLabel = String(index + 1).padStart(3, "0");
  const metaBits: string[] = [];
  if (displayAuthor) metaBits.push(displayAuthor);
  const pages = wordCount ? Math.max(1, Math.round(wordCount / 250)) : null;
  if (pages) metaBits.push(`${pages} pages`);
  const metaLine = metaBits.join(" · ");

  // Progress "X% left" / "finished" / "not started" label
  let statusLabel: React.ReactNode = null;
  if (!ready) {
    statusLabel = (
      <span style={{ color: status === "failed" ? "var(--error)" : "var(--ink-2)", fontStyle: "italic" }}>
        {liveDetail || `${status}…`}{livePct != null ? ` ${livePct}%` : ""}
      </span>
    );
  } else if (finished || progressPct >= 100) {
    statusLabel = <span>Finished</span>;
  } else if (progressPct === 0) {
    statusLabel = <span>Not started</span>;
  } else if (typeof estimatedMinutes === "number" && estimatedMinutes > 0) {
    const h = Math.floor(estimatedMinutes / 60);
    const m = estimatedMinutes % 60;
    const txt = h > 0 ? `${h}h ${m}m` : `${m}m`;
    statusLabel = (<><span className="eta">{txt}</span> left</>);
  } else {
    statusLabel = <span>In progress</span>;
  }

  return (
    <Link
      ref={rowRef}
      href={`/book/${id}`}
      className="book-row"
      data-highlight={highlight || undefined}
      style={{
        opacity: busy ? 0.5 : 1,
        ...(highlight
          ? {
              outline: `2px solid var(${highlight === "new" ? "--accent" : "--accent-ink"})`,
              outlineOffset: 4,
              borderRadius: 12,
            }
          : {}),
      }}
    >
      <span className="n">{numLabel}</span>
      <div
        className="mini-cover cover"
        style={{
          // Deterministic fallback palette seeded from the book id so each
          // book gets a consistent but different mini-cover gradient.
          ["--cover-bg" as any]: gradientFor(id),
          padding: coverOk ? 0 : "6px 4px",
        }}
      >
        {coverOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${BP}/api/books/${id}/cover`}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setCoverOk(false)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <h3 className="tl" style={{ overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {displayTitle}
        </h3>
        <div className="at" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {metaLine || (highlight === "dup" ? "Already in library" : "\u00A0")}
        </div>
      </div>
      <div className="prog" aria-label={`${progressPct}% read`}>
        {ready ? (
          <>
            <div className="bar"><div className="bar-fill" style={{ width: `${progressPct}%` }} /></div>
            <span className="p">{finished || progressPct >= 100 ? "\u2713" : progressPct > 0 ? `${progressPct}%` : "\u2014"}</span>
          </>
        ) : (
          <>
            <div className="bar">
              <div
                className="bar-fill"
                style={{
                  width: `${Math.max(2, Math.min(100, livePct ?? 0))}%`,
                  transition: "width 400ms ease",
                  background: status === "failed" ? "var(--error)" : "var(--accent)",
                }}
              />
            </div>
            <span className="p">{livePct != null ? `${livePct}%` : ""}</span>
          </>
        )}
      </div>
      <div className="meta">{statusLabel}</div>
      <div
        ref={menuRef}
        style={{ position: "relative" }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <button
          type="button"
          className="menu"
          aria-label={`Actions for ${displayTitle}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((v) => !v); }}
        >
          <svg className="icn" viewBox="0 0 24 24"><circle cx="6" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18" cy="12" r="1" /></svg>
        </button>
        {menuOpen ? (
          <div className="row-menu" role="menu">
            <a
              href={`${BP}/api/books/${id}/download`}
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }}
            >
              <button type="button" style={{ width: "100%", background: "transparent", padding: 0, font: "inherit", textAlign: "left" }}>Download EPUB</button>
            </a>
            <button type="button" role="menuitem" onClick={onArchive} disabled={busy}>Archive</button>
            <button type="button" role="menuitem" className="danger" onClick={onDelete} disabled={busy}>Delete…</button>
          </div>
        ) : null}
      </div>
    </Link>
  );
}

/** Deterministic gradient based on the book UUID's first 6 hex chars. */
function gradientFor(id: string): string {
  const palette = [
    ["#2a1c10", "#5a3a1e"],
    ["#3D5A6C", "#1f3440"],
    ["#6B7A4F", "#3f4a2a"],
    ["#8B3A3A", "#4a1f1f"],
    ["#A68A3E", "#5a471c"],
    ["#5E4AE3", "#2f2480"],
    ["#C4622A", "#6e3212"],
    ["#8B4A6B", "#4a2335"],
    ["#4A6B8B", "#253a50"],
    ["#3F7D58", "#1f4330"],
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const [a, b] = palette[hash % palette.length];
  return `linear-gradient(160deg, ${a}, ${b})`;
}
