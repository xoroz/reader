"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

function formatAuthor(author: string | null): string {
  if (!author) return "";
  const a = author.replace(/\s+/g, " ").trim();
  if (a.length <= 60) return a;
  // Split on common separators
  const parts = a.split(/\s*[,;&]\s*| and /i).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return a.slice(0, 57) + "…";
  return `${parts[0]} · ${parts.length - 1} more`;
}

export default function LibraryCard({ id, title, author, status, wordCount, chapterIdx, chapterCount, hasCover }: {
  id: string; title: string | null; author: string | null; status: string; wordCount: number | null;
  chapterIdx: number | null; chapterCount: number | null; hasCover: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [coverOk, setCoverOk] = useState(hasCover);

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
    <Link href={`/book/${id}`} className="lib-card" style={{ opacity: busy ? 0.5 : 1 }}>
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
              <span style={{ color: status === "failed" ? "#b91c1c" : "var(--reader-muted)", fontStyle: "italic" }}>{status}…</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
