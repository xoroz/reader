import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_SECRET = process.env.OTP_SESSION_SECRET || "";
const COOKIE_NAME = "app_otp_session";
const BASE_PATH = "/Reader";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySessionEdge(token: string, secret: string): Promise<{ email: string; expiresAt: number } | null> {
  if (!token || !secret) return null;
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const payload = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (!constantTimeEqual(signature, expectedSig)) return null;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (!data.email || !data.expiresAt) return null;
    if (Date.now() > data.expiresAt) return null;
    return data;
  } catch { return null; }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const proxySecret = process.env.PROXY_SECRET;
  if (proxySecret) {
    const got = request.headers.get("x-proxy-secret") || "";
    if (got !== proxySecret) return new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/manifest.json" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js"
  ) return NextResponse.next();

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionEdge(token, SESSION_SECRET) : null;
  if (!session) {
    if (pathname.startsWith("/api/") || request.headers.get("accept")?.includes("application/json")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const fwdHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
    const fwdProto = request.headers.get("x-forwarded-proto") || "https";
    return NextResponse.redirect(`${fwdProto}://${fwdHost}${BASE_PATH}/api/auth/login`);
  }
  const res = NextResponse.next();
  res.headers.set("x-user-email", session.email);
  // Mint a CSRF double-submit cookie if missing. Kept non-HttpOnly so client
  // JS can echo it in the X-CSRF-Token header on mutating requests. Runs in
  // the Edge runtime, so we inline the token generation rather than importing
  // from lib/security (which imports NextResponse types — fine here but we
  // keep middleware dependency-free).
  const existingCsrf = request.cookies.get("reader_csrf")?.value;
  if (!existingCsrf || !/^[a-f0-9]{64}$/.test(existingCsrf)) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    const token = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
    res.cookies.set({
      name: "reader_csrf",
      value: token,
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }
  return res;
}

export const config = {
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico|icon\\.svg|manifest\\.json|manifest\\.webmanifest|api/upload|api/sync|api/admin).*)"],
};
