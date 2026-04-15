import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { q } from "@/lib/db";
import { extract } from "@/lib/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/opt/apps/Reader/uploads";
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || "60") * 1024 * 1024;
const COOKIE_NAME = "app_otp_session";
const SESSION_SECRET = process.env.OTP_SESSION_SECRET || "";

async function verifySession(token: string): Promise<string | null> {
  if (!token || !SESSION_SECRET) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (hmac !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!data.email || !data.expiresAt || Date.now() > data.expiresAt) return null;
    return String(data.email).toLowerCase();
  } catch { return null; }
}

function normKey(title: string | null, author: string | null): string | null {
  const t = (title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!t) return null;
  const a = (author || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${t}|${a}`;
}

export async function POST(req: NextRequest) {
  const proxySecret = process.env.PROXY_SECRET;
  if (proxySecret && req.headers.get("x-proxy-secret") !== proxySecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const token = req.cookies.get(COOKIE_NAME)?.value || "";
  const email = await verifySession(token);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `File too large (> ${process.env.MAX_UPLOAD_MB || 60}MB)` }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  const contentHash = crypto.createHash("sha256").update(buf).digest("hex");

  const existingByBytes = await q<{ id: string; title: string | null }>(
    `SELECT id, title FROM books WHERE owner_email = $1 AND content_hash = $2 AND duplicate_of IS NULL LIMIT 1`,
    [email, contentHash]
  );
  if (existingByBytes.length) {
    return NextResponse.json(
      { error: "duplicate", existingId: existingByBytes[0].id, title: existingByBytes[0].title },
      { status: 409 }
    );
  }

  const counts = await q<{ n: string }>(`SELECT COUNT(*)::text AS n FROM books WHERE owner_email = $1 AND duplicate_of IS NULL`, [email]);
  if (Number(counts[0]?.n || 0) >= 10) {
    return NextResponse.json({ error: "Library limit reached (10 books). Delete a book to upload another." }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const dir = path.join(UPLOAD_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  const filePath = path.join(dir, safeName);
  await fs.writeFile(filePath, buf);

  await q(
    `INSERT INTO books (id, owner_email, title, source_filename, source_path, source_kind, status, content_hash) VALUES ($1,$2,$3,$4,$5,$6,'extracting',$7)`,
    [id, email, safeName.replace(/\.[^.]+$/, ""), safeName, filePath, path.extname(safeName).slice(1).toLowerCase() || "txt", contentHash]
  );

  (async () => {
    const setProgress = (stage: string, pct: number) =>
      q(`UPDATE books SET status_detail = $2, progress_pct = $3 WHERE id = $1`, [id, stage, pct]).catch(() => {});
    try {
      await setProgress("Uploaded, queuing", 2);
      const out = await extract(filePath, safeName, file.type || undefined, setProgress);

      const title = out.title || safeName.replace(/\.[^.]+$/, "");
      const author = out.author || null;
      const takKey = normKey(title, author);

      const fullText = out.chapters.map((c) => c.paragraphs.join("\n\n")).join("\n\n");
      const textHash = crypto.createHash("sha256").update(fullText).digest("hex");

      const dup = await q<{ id: string; title: string | null }>(
        `SELECT id, title FROM books
         WHERE owner_email = $1 AND id <> $2 AND duplicate_of IS NULL
           AND ( (title_author_key IS NOT NULL AND title_author_key = $3)
              OR (text_hash IS NOT NULL AND text_hash = $4) )
         LIMIT 1`,
        [email, id, takKey, textHash]
      );

      if (dup.length) {
        await q(
          `UPDATE books SET status = 'duplicate', status_detail = 'Already in library', progress_pct = 100, duplicate_of = $2, title_author_key = $3, text_hash = $4 WHERE id = $1`,
          [id, dup[0].id, takKey, textHash]
        );
        try { await fs.rm(path.dirname(filePath), { recursive: true, force: true }); } catch {}
        await q(`DELETE FROM chapters WHERE book_id = $1`, [id]);
        return;
      }

      await setProgress("Saving chapters", 95);
      await q(`UPDATE books SET title = COALESCE($2, title), author = $3, word_count = $4, source_kind = $5, cover_path = $6, title_author_key = $7, text_hash = $8 WHERE id = $1`,
        [id, out.title || null, out.author || null, out.wordCount, out.kind, out.coverPath || null, takKey, textHash]);
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
      await q(`UPDATE books SET status = 'failed', status_detail = 'Failed', error = $2 WHERE id = $1`, [id, String(e.message || e).slice(0, 500)]).catch((dbErr) => {
        console.error("[Reader] failed to record extract failure:", dbErr);
      });
    }
  })().catch((err) => {
    console.error("[Reader] unhandled background task error:", err);
  });

  return NextResponse.json({ id });
}
