import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { extract } from "@/lib/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/opt/apps/Reader/uploads";
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || "60") * 1024 * 1024;

export async function POST(req: NextRequest) {
  const email = await currentEmail();
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `File too large (> ${process.env.MAX_UPLOAD_MB || 60}MB)` }, { status: 413 });

  const counts = await q<{ n: string }>(`SELECT COUNT(*)::text AS n FROM books WHERE owner_email = $1`, [email]);
  if (Number(counts[0]?.n || 0) >= 10) {
    return NextResponse.json({ error: "Library limit reached (10 books). Delete a book to upload another." }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const dir = path.join(UPLOAD_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  const filePath = path.join(dir, safeName);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  await q(
    `INSERT INTO books (id, owner_email, title, source_filename, source_path, source_kind, status) VALUES ($1,$2,$3,$4,$5,$6,'extracting')`,
    [id, email, safeName.replace(/\.[^.]+$/, ""), safeName, filePath, path.extname(safeName).slice(1).toLowerCase() || "txt"]
  );

  (async () => {
    const setProgress = (stage: string, pct: number) =>
      q(`UPDATE books SET status_detail = $2, progress_pct = $3 WHERE id = $1`, [id, stage, pct]).catch(() => {});
    try {
      await setProgress("Uploaded, queuing", 2);
      const out = await extract(filePath, safeName, file.type || undefined, setProgress);
      await setProgress("Saving chapters", 95);
      await q(`UPDATE books SET title = COALESCE($2, title), author = $3, word_count = $4, source_kind = $5, cover_path = $6 WHERE id = $1`,
        [id, out.title || null, out.author || null, out.wordCount, out.kind, out.coverPath || null]);
      for (let i = 0; i < out.chapters.length; i++) {
        const c = out.chapters[i];
        const text = c.paragraphs.join("\n\n");
        await q(`INSERT INTO chapters (book_id, idx, title, text, word_count) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (book_id, idx) DO UPDATE SET title = EXCLUDED.title, text = EXCLUDED.text, word_count = EXCLUDED.word_count`,
          [id, i, c.title || null, text, (text.match(/\S+/g) || []).length]);
      }
      await q(`UPDATE books SET status = 'ready', status_detail = 'Ready', progress_pct = 100, error = NULL WHERE id = $1`, [id]);
    } catch (e: any) {
      console.error("[Reader] extract failed:", e);
      await q(`UPDATE books SET status = 'failed', status_detail = 'Failed', error = $2 WHERE id = $1`, [id, String(e.message || e).slice(0, 500)]);
    }
  })();

  return NextResponse.json({ id });
}
