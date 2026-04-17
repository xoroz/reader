import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { authenticateSync } from "@/lib/sync-auth";
import { parseFeed } from "@/lib/opds-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/sync/opds/browse?catalogId=…&url=…  — fetches the remote OPDS
// feed server-side using stored creds, returns parsed shape. Mirror of the
// cookie-auth /api/opds-client/browse route.
export async function GET(req: NextRequest) {
  const auth = authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const url = new URL(req.url);
  const catalogId = url.searchParams.get("catalogId") || "";
  const target = url.searchParams.get("url") || "";
  if (!catalogId || !target) return NextResponse.json({ error: "Missing catalogId or url" }, { status: 400 });

  const rows = await q<{ url: string; username: string | null; password: string | null }>(
    `SELECT url, username, password FROM opds_catalogs WHERE id = $1 AND owner_email = $2`,
    [catalogId, auth.email]
  );
  if (!rows.length) return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  const cat = rows[0];

  let targetUrl: URL;
  try { targetUrl = new URL(target, cat.url); } catch { return NextResponse.json({ error: "Bad url" }, { status: 400 }); }
  try {
    const catUrl = new URL(cat.url);
    if (targetUrl.host !== catUrl.host || targetUrl.protocol !== catUrl.protocol) {
      return NextResponse.json({ error: "Cross-origin browse blocked" }, { status: 400 });
    }
  } catch { return NextResponse.json({ error: "Bad saved catalog" }, { status: 400 }); }

  const headers: Record<string, string> = {
    "Accept": "application/atom+xml;profile=opds-catalog, application/atom+xml, application/xml, */*;q=0.1",
    "User-Agent": "Reader/OPDS-sync",
  };
  if (cat.username && cat.password) {
    headers["Authorization"] = "Basic " + Buffer.from(`${cat.username}:${cat.password}`).toString("base64");
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(targetUrl.toString(), { headers, signal: ac.signal, redirect: "follow" });
    const contentType = r.headers.get("content-type") || "";
    const text = await r.text();
    if (!r.ok) return NextResponse.json({ error: `Upstream ${r.status}`, body: text.slice(0, 500) }, { status: 502 });
    if (contentType.includes("application/opds+json") || contentType.includes("application/json")) {
      return NextResponse.json({ kind: "opds2-json", json: safeJson(text), url: targetUrl.toString() });
    }
    const parsed = parseFeed(text, targetUrl.toString());
    return NextResponse.json({ kind: "atom", feed: parsed, url: targetUrl.toString() });
  } catch (e: any) {
    return NextResponse.json({ error: `Fetch failed: ${e.message || e}` }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
