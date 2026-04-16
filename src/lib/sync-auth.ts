import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try { return timingSafeEqual(ab, bb); } catch { return false; }
}

export type SyncAuth =
  | { ok: true; email: string }
  | { ok: false; status: number; msg: string };

export function authenticateSync(req: NextRequest): SyncAuth {
  const proxySecret = process.env.PROXY_SECRET;
  if (proxySecret) {
    const got = req.headers.get("x-proxy-secret") || "";
    if (!safeEqual(got, proxySecret)) return { ok: false, status: 403, msg: "Forbidden" };
  }
  const token = process.env.READER_API_TOKEN;
  const email = process.env.READER_API_EMAIL;
  if (!token || !email) return { ok: false, status: 503, msg: "Sync API not configured" };
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || !safeEqual(m[1], token)) return { ok: false, status: 401, msg: "Invalid token" };
  return { ok: true, email: email.toLowerCase() };
}
