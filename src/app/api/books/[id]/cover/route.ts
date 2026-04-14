import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const email = await currentEmail();
  const rows = await q<{ cover_path: string | null }>(`SELECT cover_path FROM books WHERE id = $1 AND owner_email = $2`, [id, email]);
  if (!rows.length || !rows[0].cover_path) return NextResponse.json({ error: "No cover" }, { status: 404 });
  const p = rows[0].cover_path;
  try {
    const buf = await fs.readFile(p);
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return new Response(buf as any, {
      status: 200,
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400, immutable" },
    });
  } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
}
