import Link from "next/link";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import ArchivedCard from "@/components/ArchivedCard";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string | null;
  author: string | null;
  word_count: number | null;
  chapter_idx: number | null;
  cover_path: string | null;
  chapter_count: number | null;
};

export default async function Archived() {
  const email = await currentEmail();
  const rows = await q<Row>(
    `SELECT b.id, b.title, b.author, b.word_count, b.cover_path,
            p.chapter_idx,
            (SELECT COUNT(*)::int FROM chapters c WHERE c.book_id = b.id) AS chapter_count
       FROM books b LEFT JOIN progress p ON p.book_id = b.id AND p.owner_email = $1
      WHERE b.owner_email = $1 AND b.archived = true
      ORDER BY b.updated_at DESC`,
    [email]
  );

  return (
    <main className="app-shell">
      <header className="lib-header">
        <div className="hero lib-header-title">
          <h1 className="m3-brand-title">ARCHIVED</h1>
          <div className="lib-header-sub">
            {rows.length} {rows.length === 1 ? "book" : "books"} · old reads
          </div>
        </div>
        <div className="lib-header-actions">
          <Link href="/" className="btn-ghost">← Library</Link>
        </div>
      </header>
      {rows.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "var(--m3-space-6) var(--m3-space-5)",
            minHeight: "70vh",
          }}
        >
          <div style={{ fontSize: "4.5rem", lineHeight: 1, marginBottom: "var(--m3-space-5)" }}>📚</div>
          <h2
            style={{
              font: "var(--m3-headline-sm)",
              marginBottom: "var(--m3-space-3)",
              color: "var(--m3-on-surface)",
            }}
          >
            No archived books yet
          </h2>
          <p
            style={{
              font: "var(--m3-body-lg)",
              color: "var(--m3-on-surface-variant)",
              maxWidth: "30rem",
              marginBottom: "var(--m3-space-6)",
            }}
          >
            When you finish a book, you can archive it to keep your active
            library tidy. Archived books live here and can be unarchived any
            time.
          </p>
          <Link href="/" className="btn-primary">
            Back to library
          </Link>
        </div>
      ) : (
        <div className="library-grid">
          {rows.map((r) => (
            <ArchivedCard
              key={r.id}
              id={r.id}
              title={r.title}
              author={r.author}
              wordCount={r.word_count}
              chapterIdx={r.chapter_idx}
              chapterCount={r.chapter_count}
              hasCover={!!r.cover_path}
            />
          ))}
        </div>
      )}
    </main>
  );
}
