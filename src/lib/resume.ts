import fs from "node:fs/promises";
import { q } from "@/lib/db";
import { extract } from "@/lib/extract";

// Run the same extract + DB update pipeline that /api/libgen/download/route.ts
// executes after the file lands. Safe to call for any book whose source_path
// points at an intact downloaded file.
export async function resumeExtractForBook(id: string): Promise<void> {
  const rows = await q<{ id: string; source_path: string; source_filename: string }>(
    `SELECT id, source_path, source_filename FROM books WHERE id = $1`,
    [id]
  );
  const b = rows[0];
  if (!b) throw new Error(`Book ${id} not found`);
  const stat = await fs.stat(b.source_path).catch(() => null);
  if (!stat || stat.size <= 0) throw new Error(`Source file missing or empty for ${id}`);

  await q(
    `UPDATE books SET status = 'extracting', status_detail = 'Resuming extract', progress_pct = 50 WHERE id = $1`,
    [id]
  );
  try {
    const out = await extract(b.source_path, b.source_filename, undefined);
    await q(
      `UPDATE books SET title = COALESCE($2, title), author = COALESCE($3, author), word_count = $4, source_kind = $5, cover_path = $6 WHERE id = $1`,
      [id, out.title || null, out.author || null, out.wordCount, out.kind, out.coverPath || null]
    );
    // Wipe any partial chapters from a prior failed pass, then re-insert.
    await q(`DELETE FROM chapters WHERE book_id = $1`, [id]);
    for (let i = 0; i < out.chapters.length; i++) {
      const c = out.chapters[i];
      const text = c.paragraphs.join("\n\n");
      await q(
        `INSERT INTO chapters (book_id, idx, title, text, word_count) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (book_id, idx) DO UPDATE SET title = EXCLUDED.title, text = EXCLUDED.text, word_count = EXCLUDED.word_count`,
        [id, i, c.title || null, text, (text.match(/\S+/g) || []).length]
      );
    }
    await q(`UPDATE books SET status = 'ready', error = NULL, progress_pct = 100 WHERE id = $1`, [id]);
  } catch (e: any) {
    await q(`UPDATE books SET status = 'failed', error = $2 WHERE id = $1`, [id, String(e.message || e).slice(0, 500)]);
    throw e;
  }
}
