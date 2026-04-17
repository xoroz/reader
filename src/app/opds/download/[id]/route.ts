import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { q } from "@/lib/db";
import { requireOpdsAuth } from "@/lib/opds-auth";
import { bookMime } from "@/lib/opds-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "/opt/apps/Reader/uploads");
const UPLOAD_DIR_REAL = (() => {
  try { return fsSync.realpathSync(UPLOAD_DIR); } catch { return UPLOAD_DIR; }
})();

// Safe filename for Content-Disposition.
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOpdsAuth(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const rows = await q<{ source_path: string | null; title: string | null; source_filename: string | null }>(
    `SELECT source_path, title, source_filename FROM books WHERE id = $1 AND owner_email = $2`,
    [id, auth.email]
  );
  if (!rows.length || !rows[0].source_path) return NextResponse.json({ error: "No original file" }, { status: 404 });
  const p = path.resolve(rows[0].source_path);
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
        "Content-Type": bookMime(ext),
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
}
