import { NextRequest, NextResponse } from "next/server";
import { searchLibgen } from "@/lib/libgen";
import { currentEmail } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  await currentEmail();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const fmt = (req.nextUrl.searchParams.get("fmt") || "epub").toLowerCase();
  if (!q || q.length < 2) return NextResponse.json({ hits: [] });
  try {
    const hits = await searchLibgen(q, fmt);
    if (!hits.length) {
      return NextResponse.json({ hits: [], note: "LibGen returned no results, or all mirrors are unreachable from this server (ISP block). Upload files directly instead." });
    }
    return NextResponse.json({ hits });
  } catch (e: any) {
    return NextResponse.json({ hits: [], error: `LibGen unreachable: ${e.message || e}. Upload files directly instead.` }, { status: 200 });
  }
}
