import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bearer-token auth for external clients (e.g. Android app).
// This route is excluded from the OTP middleware in src/middleware.ts matcher,
// so it must still enforce PROXY_SECRET + its own bearer token here.
//
// Required env:
//   PROXY_SECRET        — matches Caddy's X-Proxy-Secret header (same as middleware)
//   READER_API_TOKEN    — shared secret issued to each external client
//   READER_API_EMAIL    — email mapped to that token (single-user model for now)

function authenticate(req: NextRequest): { ok: true; email: string } | { ok: false; status: number; msg: string } {
  const proxySecret = process.env.PROXY_SECRET;
  if (proxySecret) {
    const got = req.headers.get("x-proxy-secret") || "";
    if (got !== proxySecret) return { ok: false, status: 403, msg: "Forbidden" };
  }
  const token = process.env.READER_API_TOKEN;
  const email = process.env.READER_API_EMAIL;
  if (!token || !email) return { ok: false, status: 503, msg: "Sync API not configured" };
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] !== token) return { ok: false, status: 401, msg: "Invalid token" };
  return { ok: true, email: email.toLowerCase() };
}

export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (bookId) {
    const rows = await q<any>(
      `SELECT book_id, chapter_idx, paragraph_idx, extract(epoch from updated_at)*1000 AS updated_at_ms
         FROM progress WHERE book_id = $1 AND owner_email = $2`,
      [bookId, auth.email]
    );
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const r = rows[0];
    return NextResponse.json({
      bookId: r.book_id,
      chapter: r.chapter_idx,
      paragraph: r.paragraph_idx,
      updatedAt: Number(r.updated_at_ms),
    });
  }
  // List all books + progress so external client can match by title/author.
  const rows = await q<any>(
    `SELECT b.id AS book_id, b.title, b.author, b.word_count,
            p.chapter_idx, p.paragraph_idx,
            extract(epoch from p.updated_at)*1000 AS updated_at_ms,
            (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapter_count
       FROM books b LEFT JOIN progress p ON p.book_id = b.id AND p.owner_email = b.owner_email
      WHERE b.owner_email = $1 AND b.status = 'ready'
      ORDER BY b.created_at DESC`,
    [auth.email]
  );
  return NextResponse.json({
    books: rows.map((r: any) => ({
      bookId: r.book_id,
      title: r.title,
      author: r.author,
      wordCount: r.word_count,
      chapterCount: Number(r.chapter_count),
      chapter: r.chapter_idx,
      paragraph: r.paragraph_idx,
      updatedAt: r.updated_at_ms == null ? null : Number(r.updated_at_ms),
    })),
  });
}

export async function PUT(req: NextRequest) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const { bookId, chapter, paragraph, updatedAt } = body || {};
  if (!bookId) return NextResponse.json({ error: "Missing bookId" }, { status: 400 });
  // Last-write-wins by timestamp if client supplied one; else now().
  if (updatedAt && Number.isFinite(Number(updatedAt))) {
    const ts = new Date(Number(updatedAt)).toISOString();
    // Only apply if newer than what's stored.
    const result = await q<any>(
      `INSERT INTO progress (book_id, owner_email, chapter_idx, paragraph_idx, updated_at)
         VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (book_id, owner_email) DO UPDATE
         SET chapter_idx = EXCLUDED.chapter_idx,
             paragraph_idx = EXCLUDED.paragraph_idx,
             updated_at = EXCLUDED.updated_at
         WHERE progress.updated_at < EXCLUDED.updated_at
       RETURNING extract(epoch from updated_at)*1000 AS updated_at_ms`,
      [bookId, auth.email, Number(chapter) || 0, Number(paragraph) || 0, ts]
    );
    if (!result.length) {
      // Server copy is newer — return it so client can reconcile.
      const rows = await q<any>(
        `SELECT chapter_idx, paragraph_idx, extract(epoch from updated_at)*1000 AS updated_at_ms
           FROM progress WHERE book_id = $1 AND owner_email = $2`,
        [bookId, auth.email]
      );
      const r = rows[0];
      return NextResponse.json({
        applied: false,
        server: r ? { chapter: r.chapter_idx, paragraph: r.paragraph_idx, updatedAt: Number(r.updated_at_ms) } : null,
      });
    }
    return NextResponse.json({ applied: true, updatedAt: Number(result[0].updated_at_ms) });
  }
  const rows = await q<any>(
    `INSERT INTO progress (book_id, owner_email, chapter_idx, paragraph_idx, updated_at)
       VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (book_id, owner_email) DO UPDATE
       SET chapter_idx = EXCLUDED.chapter_idx,
           paragraph_idx = EXCLUDED.paragraph_idx,
           updated_at = now()
     RETURNING extract(epoch from updated_at)*1000 AS updated_at_ms`,
    [bookId, auth.email, Number(chapter) || 0, Number(paragraph) || 0]
  );
  return NextResponse.json({ applied: true, updatedAt: Number(rows[0].updated_at_ms) });
}
