"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

function formatAuthor(author: string | null): string {
  if (!author) return "";
  const a = author.replace(/\s+/g, " ").trim();
  if (a.length <= 60) return a;
  const parts = a.split(/\s*[,;&]\s*| and /i).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return a.slice(0, 57) + "…";
  return `${parts[0]} · ${parts.length - 1} more`;
}

export default function LibraryCard({ id, title, author, status, wordCount, chapterIdx, chapterCount, hasCover, highlight }: {
  id: string; title: string | null; author: string | null; status: string; wordCount: number | null;
  chapterIdx: number | null; chapterCount: number | null; hasCover: boolean;
  highlight?: "new" | "dup" | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [coverOk, setCoverOk] = useState(hasCover);
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (highlight && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!confirm(`Delete "${title || "Untitled"}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${BP}/api/books/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err: any) { alert(`Delete failed: ${err.message}`); setBusy(false); }
  }

  const displayTitle = (title || "Untitled").replace(/\s+/g, " ").trim();
  const displayAuthor = formatAuthor(author);
  const progressPct = chapterIdx != null && chapterCount ? Math.min(100, Math.round((chapterIdx / chapterCount) * 100)) : 0;
  const ready = status === "ready";

  return (
    <Link
      ref={ref}
      href={`/book/${id}`}
      className="lib-card"
      data-highlight={highlight || undefined}
      style={{
        opacity: busy ? 0.5 : 1,
        ...(highlight
          ? {
              outline: `2px solid var(${highlight === "new" ? "--m3-primary" : "--m3-warning"})`,
              outlineOffset: 4,
              boxShadow: `0 0 0 8px color-mix(in srgb, var(${highlight === "new" ? "--m3-primary" : "--m3-warning"}) 15%, transparent)`,
            }
          : {}),
      }}
    >
      {highlight ? (
        <span
          className={`m3-badge ${highlight === "new" ? "" : "m3-badge-warn"}`}
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            zIndex: 3,
            boxShadow: "var(--m3-elev-2)",
          }}
        >
          {highlight === "new" ? "New" : "Already in library"}
        </span>
      ) : null}
      <button className="lib-del" onClick={onDelete} disabled={busy} aria-label="Delete book">×</button>
      <div className="lib-cover">
        {coverOk ? (
          <img src={`${BP}/api/books/${id}/cover`} alt="" onError={() => setCoverOk(false)} />
        ) : (
          <div className="lib-cover-fallback">
            <span className="lib-cover-title">{displayTitle.slice(0, 60)}</span>
          </div>
        )}
      </div>
      <div className="lib-info">
        <div className="lib-title" title={displayTitle}>{displayTitle}</div>
        {displayAuthor ? <div className="lib-author" title={author || ""}>{displayAuthor}</div> : null}
        <div className="lib-foot">
          {ready ? (
            <>
              {progressPct > 0 ? (
                <div className="lib-progress" aria-label={`${progressPct}% read`}>
                  <div className="lib-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
              ) : null}
              <div className="lib-meta">
                <span>{progressPct > 0 ? `${progressPct}%` : "Not started"}</span>
                <span>{chapterCount ? `ch ${Math.min(chapterCount, (chapterIdx ?? 0) + 1)} / ${chapterCount}` : `${(wordCount || 0).toLocaleString()} words`}</span>
              </div>
            </>
          ) : (
            <div className="lib-meta">
              <span style={{ color: status === "failed" ? "var(--m3-error)" : "var(--m3-on-surface-variant)", fontStyle: "italic" }}>{status}…</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
