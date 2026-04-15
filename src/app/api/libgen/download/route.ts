import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { resolveDownloadUrl, downloadToFile } from "@/lib/libgen";
import { extract } from "@/lib/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/opt/apps/Reader/uploads";
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || "60") * 1024 * 1024;

export async function POST(req: NextRequest) {
  const email = await currentEmail();
  const body = await req.json().catch(() => ({}));
  const { md5, title, author, extension } = body || {};
  if (!md5 || !/^[A-F0-9]{32}$/i.test(md5)) return NextResponse.json({ error: "Invalid md5" }, { status: 400 });

  const counts = await q<{ n: string }>(`SELECT COUNT(*)::text AS n FROM books WHERE owner_email = $1`, [email]);
  if (Number(counts[0]?.n || 0) >= 10) {
    return NextResponse.json({ error: "Library limit reached (10 books). Delete a book to add another." }, { status: 409 });
  }

  const url = await resolveDownloadUrl(md5.toUpperCase());
  if (!url) return NextResponse.json({ error: "Could not resolve download URL" }, { status: 502 });

  const id = crypto.randomUUID();
  const dir = path.join(UPLOAD_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const placeholder = path.join(dir, `book.${String(extension || "pdf").toLowerCase()}`);

  console.log("[Reader] libgen download starting", { md5, url: url.slice(0, 120) });
  let saved;
  try {
    const t0 = Date.now();
    saved = await downloadToFile(url, placeholder, MAX_BYTES);
    console.log("[Reader] libgen download ok", { md5, bytes: saved.bytes, ms: Date.now() - t0, filename: saved.filename });
  } catch (e: any) {
    console.error("[Reader] libgen download failed", { md5, url: url.slice(0, 120), err: e?.message || String(e), stack: e?.stack?.split('\n').slice(0, 3).join(' | ') });
    return NextResponse.json({ error: `Download failed: ${e?.message || e}` }, { status: 502 });
  }
  const filePath = path.join(dir, saved.filename);

  await q(
    `INSERT INTO books (id, owner_email, title, author, source_filename, source_path, source_kind, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'extracting')`,
    [id, email, title || saved.filename.replace(/\.[^.]+$/, ""), author || null, saved.filename, filePath, path.extname(saved.filename).slice(1).toLowerCase() || "pdf"]
  );

  (async () => {
    try {
      const out = await extract(filePath, saved.filename, undefined);
      await q(`UPDATE books SET title = COALESCE($2, title), author = COALESCE($3, author), word_count = $4, source_kind = $5, cover_path = $6 WHERE id = $1`,
        [id, out.title || null, out.author || null, out.wordCount, out.kind, out.coverPath || null]);
      for (let i = 0; i < out.chapters.length; i++) {
        const c = out.chapters[i];
        const text = c.paragraphs.join("\n\n");
        await q(`INSERT INTO chapters (book_id, idx, title, text, word_count) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (book_id, idx) DO UPDATE SET title = EXCLUDED.title, text = EXCLUDED.text, word_count = EXCLUDED.word_count`,
          [id, i, c.title || null, text, (text.match(/\S+/g) || []).length]);
      }
      await q(`UPDATE books SET status = 'ready', error = NULL WHERE id = $1`, [id]);
    } catch (e: any) {
      console.error("[Reader] libgen extract failed:", e);
      await q(`UPDATE books SET status = 'failed', error = $2 WHERE id = $1`, [id, String(e.message || e).slice(0, 500)]);
    }
  })();

  return NextResponse.json({ id, bytes: saved.bytes, filename: saved.filename });
}
