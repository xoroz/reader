import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "/opt/apps/Reader/uploads");
// Resolve UPLOAD_DIR through symlinks once at module load so the per-request
// realpath comparison is meaningful. Falls back to the literal path if the
// dir doesn't exist yet (startup-race safety).
const UPLOAD_DIR_REAL = (() => {
  try { return fsSync.realpathSync(UPLOAD_DIR); } catch { return UPLOAD_DIR; }
})();

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.ebook",
  txt: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  rtf: "application/rtf",
};

// Produce a safe ASCII Content-Disposition filename. Non-alnum/space/- chars
// are replaced with `_`; trimmed to 120 chars before the extension; falls
// back to `book-{id}.{ext}` if empty.
function buildDownloadName(title: string | null | undefined, ext: string, id: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 10) || "bin";
  const rawTitle = (title || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = rawTitle
    .replace(/[^A-Za-z0-9 \-]+/g, "_")
    .replace(/[_ ]{2,}/g, "_")
    .replace(/^[_\- ]+|[_\- ]+$/g, "")
    .trim()
    .slice(0, 120);
  if (!cleaned) return `book-${id}.${safeExt}`;
  return `${cleaned}.${safeExt}`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const email = await currentEmail();
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const rows = await q<{ source_path: string | null; source_filename: string | null; title: string | null }>(
    `SELECT source_path, source_filename, title FROM books WHERE id = $1 AND owner_email = $2`,
    [id, email]
  );
  if (!rows.length || !rows[0].source_path) return NextResponse.json({ error: "No original file" }, { status: 404 });
  const p = path.resolve(rows[0].source_path);
  // Defense in depth: never serve files outside the configured upload dir, even if the DB was tampered with.
  // Resolve symlinks so an attacker can't point source_path at a symlink that
  // escapes UPLOAD_DIR.
  let real: string;
  try { real = fsSync.realpathSync(p); } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
  if (real !== UPLOAD_DIR_REAL && !real.startsWith(UPLOAD_DIR_REAL + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }
  try {
    const buf = await fs.readFile(real);
    const ext = path.extname(real).slice(1).toLowerCase();
    const downloadName = buildDownloadName(rows[0].title, ext, id);
    return new Response(buf as any, {
      status: 200,
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
