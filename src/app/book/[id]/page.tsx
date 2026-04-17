import { q } from "@/lib/db";
import { requirePageEmail } from "@/lib/user";
import { notFound } from "next/navigation";
import Reader from "@/components/Reader";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const email = await requirePageEmail();
  const books = await q<any>(
    `SELECT id, title, author, status, archived,
            extract(epoch from finished_prompted_at)*1000 AS finished_prompted_at_ms
       FROM books WHERE id = $1 AND owner_email = $2`,
    [id, email]
  );
  if (!books.length) return notFound();
  const book = books[0];
  if (book.status !== "ready") {
    return (
      <main className="app-shell" style={{ textAlign: "center", padding: "var(--m3-space-8) var(--m3-space-3)", color: "var(--m3-on-surface-variant)" }}>
        <p style={{ fontFamily: "var(--m3-font-serif)", fontSize: "1.2rem", lineHeight: 1.5 }}>
          {book.status === "failed" ? "This book failed to extract." : "Still preparing this book…"}
        </p>
        <div style={{ marginTop: "var(--m3-space-4)" }}><a href="/Reader" className="btn-ghost">← Library</a></div>
      </main>
    );
  }
  const chapters = await q<any>(`SELECT idx, title, text FROM chapters WHERE book_id = $1 ORDER BY idx`, [id]);
  const prefsRows = await q<any>(`SELECT json FROM prefs WHERE owner_email = $1`, [email]);
  const progressRows = await q<any>(`SELECT chapter_idx, paragraph_idx FROM progress WHERE book_id = $1 AND owner_email = $2`, [id, email]);
  return (
    <Reader
      bookId={book.id}
      title={book.title}
      author={book.author}
      chapters={chapters.map((c: any) => ({ idx: c.idx, title: c.title, text: c.text }))}
      initialPrefs={prefsRows[0]?.json || {}}
      initialProgress={progressRows[0] || { chapter_idx: 0, paragraph_idx: 0 }}
      alreadyPrompted={book.finished_prompted_at_ms != null}
    />
  );
}
