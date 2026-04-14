import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const email = await currentEmail();
  const rows = await q<any>(`SELECT json FROM prefs WHERE owner_email = $1`, [email]);
  return NextResponse.json(rows[0]?.json || {});
}

export async function POST(req: NextRequest) {
  const email = await currentEmail();
  const body = await req.json().catch(() => ({}));
  await q(
    `INSERT INTO prefs (owner_email, json, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (owner_email) DO UPDATE SET json = EXCLUDED.json, updated_at = now()`,
    [email, JSON.stringify(body || {})]
  );
  return NextResponse.json({ ok: true });
}
