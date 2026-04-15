import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const email = await currentEmail();
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const rows = await q<{ source_path: string | null; source_filename: string | null; title: string | null }>(
    `SELECT source_path, source_filename, title FROM books WHERE id = $1 AND owner_email = $2`,
    [id, email]
  );
  if (!rows.length || !rows[0].source_path) return NextResponse.json({ error: "No original file" }, { status: 404 });
  const p = rows[0].source_path;
  try {
    const buf = await fs.readFile(p);
    const ext = path.extname(p).slice(1).toLowerCase();
    const downloadName = rows[0].source_filename || `${(rows[0].title || "book").replace(/[^\w.\- ]+/g, "_")}.${ext || "bin"}`;
    return new Response(buf as any, {
      status: 200,
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${downloadName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
