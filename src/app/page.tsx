import Link from "next/link";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import LibraryCard from "@/components/LibraryCard";
import UploadBanner from "@/components/UploadBanner";

export const dynamic = "force-dynamic";

type Row = { id: string; title: string | null; author: string | null; status: string; word_count: number | null; created_at: string; chapter_idx: number | null; cover_path: string | null; chapter_count: number | null };

export default async function Library({ searchParams }: { searchParams?: Promise<{ new?: string; dup?: string }> }) {
  const sp = (await searchParams) || {};
  const newId = sp.new || null;
  const dupId = sp.dup || null;
  const highlightId = newId || dupId;

  const email = await currentEmail();
  const rows = await q<Row>(
    `SELECT b.id, b.title, b.author, b.status, b.word_count, b.created_at, b.cover_path,
            p.chapter_idx,
            (SELECT COUNT(*)::int FROM chapters c WHERE c.book_id = b.id) AS chapter_count
     FROM books b LEFT JOIN progress p ON p.book_id = b.id AND p.owner_email = $1
     WHERE b.owner_email = $1 ORDER BY b.created_at DESC`,
    [email]
  );

  const dupTitle = dupId ? rows.find((r) => r.id === dupId)?.title ?? null : null;
  const newTitle = newId ? rows.find((r) => r.id === newId)?.title ?? null : null;

  return (
    <main className="app-shell">
      <header className="lib-header">
        <div className="hero lib-header-title">
          <h1 className="m3-brand-title">READER</h1>
          <div className="lib-header-sub">{email} · {rows.length}/10 books</div>
        </div>
        <div className="lib-header-actions">
          <Link href="/search" className="btn-ghost">Search</Link>
          <Link href="/upload" className="btn-primary" aria-disabled={rows.length >= 10} style={rows.length >= 10 ? { opacity: 0.4, pointerEvents: "none" } : undefined}>Upload</Link>
          <a href="/Reader/api/auth/logout" className="btn-ghost">Sign out</a>
        </div>
      </header>
      {newId ? <UploadBanner kind="new" title={newTitle} /> : null}
      {dupId ? <UploadBanner kind="dup" title={dupTitle} /> : null}
      {rows.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "var(--m3-space-6) var(--m3-space-5)", minHeight: "70vh" }}>
          <div style={{ fontSize: "4.5rem", lineHeight: 1, marginBottom: "var(--m3-space-5)" }}>📖</div>
          <h2 style={{ font: "var(--m3-headline-sm)", marginBottom: "var(--m3-space-3)", color: "var(--m3-on-surface)" }}>Your library is empty</h2>
          <p style={{ font: "var(--m3-body-lg)", color: "var(--m3-on-surface-variant)", maxWidth: "30rem", marginBottom: "var(--m3-space-6)" }}>
            Upload a book and it will be extracted, cleaned up by AI, and rendered for comfortable reading. PDF, EPUB, DOCX, TXT, or Markdown.
          </p>
          <div style={{ display: "flex", gap: "var(--m3-space-3)", flexWrap: "wrap", justifyContent: "center" }}>
            <Link href="/upload" className="btn-primary">Upload a book</Link>
            <Link href="/search" className="btn-ghost">Search LibGen</Link>
          </div>
        </div>
      ) : (
        <div className="library-grid">
          {rows.map((r) => (
            <LibraryCard
              key={r.id}
              id={r.id}
              title={r.title}
              author={r.author}
              status={r.status}
              wordCount={r.word_count}
              chapterIdx={r.chapter_idx}
              chapterCount={r.chapter_count}
              hasCover={!!r.cover_path}
              highlight={r.id === highlightId ? (newId ? "new" : "dup") : null}
            />
          ))}
        </div>
      )}
    </main>
  );
}
