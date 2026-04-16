import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resumeExtractForBook } from "@/lib/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return NextResponse.json({ error: "ADMIN_SECRET not configured" }, { status: 500 });
  const provided = req.headers.get("x-admin-secret") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id: string | undefined = body?.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await resumeExtractForBook(id);
    return NextResponse.json({ ok: true, id, status: "ready" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, id, error: String(e?.message || e) }, { status: 500 });
  }
}
