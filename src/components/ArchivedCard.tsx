"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/csrf-client";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

// Slim variant of LibraryCard for /archived. No ingest-status polling (every
// archived book is necessarily "ready") and the primary action is "Unarchive"
// rather than "Delete" — so the separate component keeps both screens small.
export default function ArchivedCard({ id, title, author, wordCount, chapterIdx, chapterCount, hasCover }: {
  id: string;
  title: string | null;
  author: string | null;
  wordCount: number | null;
  chapterIdx: number | null;
  chapterCount: number | null;
  hasCover: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [coverOk, setCoverOk] = useState(hasCover);

  async function onUnarchive(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    setBusy(true);
    try {
      const res = await apiFetch(`${BP}/api/books/${id}/unarchive`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err: any) { alert(`Unarchive failed: ${err.message}`); setBusy(false); }
  }

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!confirm(`Delete "${title || "Untitled"}" permanently?`)) return;
    setBusy(true);
    try {
      const res = await apiFetch(`${BP}/api/books/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err: any) { alert(`Delete failed: ${err.message}`); setBusy(false); }
  }

  const displayTitle = (title || "Untitled").replace(/\s+/g, " ").trim();
  const progressPct = chapterIdx != null && chapterCount ? Math.min(100, Math.round((chapterIdx / chapterCount) * 100)) : 0;

  return (
    <Link
      href={`/book/${id}`}
      className="lib-card"
      style={{ opacity: busy ? 0.5 : 0.85 }}
      aria-label={`${displayTitle} (archived)`}
    >
      <button
        className="lib-del"
        onClick={onUnarchive}
        disabled={busy}
        aria-label={busy ? "Unarchiving" : "Unarchive book"}
        title="Unarchive"
        style={{ right: 44 }}
      >
        ↺
      </button>
      <button
        className="lib-del"
        onClick={onDelete}
        disabled={busy}
        aria-label={busy ? "Deleting" : "Delete permanently"}
        title="Delete permanently"
      >
        ×
      </button>
      <div className="lib-cover">
        {coverOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${BP}/api/books/${id}/cover`}
            alt={displayTitle ? `${displayTitle} cover` : "Book cover"}
            loading="lazy"
            decoding="async"
            width={180}
            height={270}
            onError={() => setCoverOk(false)}
          />
        ) : (
          <div className="lib-cover-fallback">
            <span className="lib-cover-title">{displayTitle.slice(0, 60)}</span>
          </div>
        )}
      </div>
      <div className="lib-info">
        <div className="lib-title" title={displayTitle}>{displayTitle}</div>
        {author ? <div className="lib-author" title={author}>{author}</div> : null}
        <div className="lib-foot">
          <div className="lib-meta">
            <span>Archived</span>
            <span>{chapterCount ? `${progressPct}% · ${chapterCount} ch` : `${(wordCount || 0).toLocaleString()} words`}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
