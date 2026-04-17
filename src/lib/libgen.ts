// LibGen search + download via the *.vg / *.la / *.gl / *.bz mirrors.
// Flow:
//   1) GET https://libgen.vg/index.php?req=...&res=25  (HTML results; each row has /ads.php?md5=<md5>)
//   2) Scrape MD5 + title/author/year/size/ext from the results table.
//   3) Follow /ads.php?md5=... to the "GET" button's direct download URL (cloudflare-storage).
//
// All mirrors are Cloudflare-fronted, reachable from PL ISPs. We try them in order.

const MIRRORS = ["https://libgen.vg", "https://libgen.la", "https://libgen.gl", "https://libgen.bz"];
const UA = "Mozilla/5.0 (Reader/0.2)";

// Some libgen mirrors return ~20MB "no results" pages bloated with HTML/CSS/JS.
// Cap how much HTML we actually read+parse so the parser doesn't burn CPU.
const MAX_RESULT_HTML_BYTES = 2 * 1024 * 1024; // 2 MB
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > MAX_RESULT_HTML_BYTES) {
      out += decoder.decode(value, { stream: true });
      try { await reader.cancel(); } catch {}
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

export type LibgenHit = {
  md5: string;
  title: string;
  author?: string;
  year?: string;
  language?: string;
  pages?: string;
  extension?: string;
  size?: string;
  mirror: string;
};

export async function searchLibgen(query: string, format?: string): Promise<{ hits: LibgenHit[]; formatCounts: Record<string, number>; totalRaw: number }> {
  // Race all mirrors in parallel — first one with non-empty results wins.
  // Cancel losers on first success so their AbortSignal.timeout rejections don't escape as unhandled.
  const controllers = MIRRORS.map(() => new AbortController());
  const timers = controllers.map((c) => setTimeout(() => c.abort(), 7000));
  const attempts = MIRRORS.map(async (base, i) => {
    try {
      const url = `${base}/index.php?req=${encodeURIComponent(query)}&res=50`;
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, signal: controllers[i].signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const html = await readCapped(res);
      const all = parseResults(html, base);
      if (!all.length) throw new Error("empty");
      return { all, base };
    } catch (err) {
      // swallow so unhandled rejections never crash the process; Promise.any still aggregates
      throw err;
    }
  });
  // Attach a no-op catch to each so post-resolution rejections don't bubble
  attempts.forEach((p) => p.catch(() => {}));
  try {
    const { all } = await Promise.any(attempts);
    // Cancel still-pending mirror fetches
    controllers.forEach((c) => { try { c.abort(); } catch {} });
    timers.forEach((t) => clearTimeout(t));
    const formatCounts: Record<string, number> = {};
    for (const h of all) if (h.extension) formatCounts[h.extension] = (formatCounts[h.extension] || 0) + 1;
    const hits = (format && format !== "any") ? all.filter((h) => h.extension === format) : all;
    return { hits, formatCounts, totalRaw: all.length };
  } catch {
    timers.forEach((t) => clearTimeout(t));
    return { hits: [], formatCounts: {}, totalRaw: 0 };
  }
}

function strip(s: string): string {
  return s
    .replace(/<i>[\s\S]*?<\/i>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

// Quote-aware HTML tokenizer: walks the string and produces a list of tokens
// (text or tagName). Attribute values inside " or ' are ignored for tag detection.
function tokenize(html: string): Array<{ type: "text" | "tag"; value: string; raw?: string }> {
  const out: Array<{ type: "text" | "tag"; value: string }> = [];
  let i = 0;
  let text = "";
  const n = html.length;
  while (i < n) {
    const c = html[i];
    if (c !== "<") { text += c; i++; continue; }
    // Try to parse a tag starting at i
    let j = i + 1;
    // Must be a letter or '/' immediately after '<' to be a real tag
    if (j >= n || !/[a-zA-Z\/!]/.test(html[j])) { text += c; i++; continue; }
    // Find the matching '>' while respecting quotes
    let quote: string | null = null;
    let k = j;
    while (k < n) {
      const ch = html[k];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      k++;
    }
    if (k >= n) { text += c; i++; continue; } // no close — treat as text
    // Capture the raw tag contents (without angle brackets)
    const raw = html.slice(j, k);
    const nameMatch = raw.match(/^\/?([a-zA-Z][a-zA-Z0-9]*)/);
    if (!nameMatch) { text += html.slice(i, k + 1); i = k + 1; continue; }
    if (text) { out.push({ type: "text", value: text }); text = ""; }
    const isClose = raw.startsWith("/");
    out.push({ type: "tag", value: (isClose ? "/" : "") + nameMatch[1].toLowerCase() });
    i = k + 1;
  }
  if (text) out.push({ type: "text", value: text });
  return out;
}

function extractFirstAnchorText(cell: string): string {
  const toks = tokenize(cell);
  let inA = 0;
  let buf = "";
  for (const t of toks) {
    if (t.type === "tag") {
      if (t.value === "a") inA++;
      else if (t.value === "/a") {
        if (inA > 0) { inA--; if (inA === 0 && buf.trim()) break; }
      }
    } else if (inA > 0) {
      buf += t.value;
    }
  }
  if (!buf.trim()) {
    // Fallback: take text of the whole cell
    buf = toks.filter((t) => t.type === "text").map((t) => t.value).join(" ");
  }
  return buf
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTextOnly(cell: string): string {
  const toks = tokenize(cell);
  return toks
    .filter((t) => t.type === "text")
    .map((t) => t.value)
    .join(" ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseResults(html: string, base: string): LibgenHit[] {
  const hits: LibgenHit[] = [];
  const seen = new Set<string>();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const md5Match = row.match(/ads\.php\?md5=([a-fA-F0-9]{32})/);
    if (!md5Match) continue;
    const md5 = md5Match[1].toUpperCase();
    if (seen.has(md5)) continue;
    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((x) => x[1]);
    // libgen.vg layout: [0]title, [1]author, [2]publisher, [3]year, [4]lang, [5]pages, [6]size, [7]ext, [8]links
    if (cells.length < 8) continue;
    const title = extractFirstAnchorText(cells[0]).replace(/\s+$/, "").slice(0, 250);
    if (!title || /^\d+$/.test(title)) continue;
    const author = stripTextOnly(cells[1]) || undefined;
    const publisher = stripTextOnly(cells[2]) || undefined;
    const year = stripTextOnly(cells[3]) || undefined;
    const language = stripTextOnly(cells[4]) || undefined;
    const pagesRaw = stripTextOnly(cells[5]);
    const pages = pagesRaw && pagesRaw !== "0" ? pagesRaw.split("/")[0].trim() : undefined;
    const size = stripTextOnly(cells[6]) || undefined;
    const extension = stripTextOnly(cells[7]).toLowerCase() || undefined;
    if (!extension || !["pdf", "epub", "djvu", "mobi", "azw3", "txt", "fb2"].includes(extension)) continue;
    seen.add(md5);
    hits.push({ md5, title, author, year, pages, language, size, extension, mirror: base });
    void publisher;
  }
  // Rank: epubs first, then pdfs, by year desc
  hits.sort((a, b) => {
    const order = (e?: string) => (e === "epub" ? 0 : e === "pdf" ? 1 : 2);
    const o = order(a.extension) - order(b.extension);
    if (o !== 0) return o;
    return (Number(b.year || 0) || 0) - (Number(a.year || 0) || 0);
  });
  return hits;
}

// Resolve the ads.php GET link for a single mirror. Returns null on failure.
async function resolveOneMirror(base: string, md5: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `${base}/ads.php?md5=${md5}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow", signal: ctrl.signal });
    if (!res.ok) return null;
    const html = await readCapped(res);
    const get1 = html.match(/<a[^>]+href="([^"]+)"[^>]*>\s*GET\s*<\/a>/i);
    if (get1) {
      const abs = absolute(get1[1], new URL(url));
      if (abs) return abs;
    }
    const get2 = html.match(/href="(get\.php\?md5=[^"]+)"/i);
    if (get2) {
      const abs = absolute(get2[1], new URL(url));
      if (abs) return abs;
    }
    const get3 = html.match(/href="(https?:\/\/[^"]+\.(?:pdf|epub|djvu|mobi|azw3)(?:\?[^"]*)?)"/i);
    if (get3) {
      const abs = absolute(get3[1], new URL(url));
      if (abs) return abs;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Backwards-compat: return the first mirror that resolves (race).
export async function resolveDownloadUrl(md5: string): Promise<string | null> {
  const attempts = MIRRORS.map((b) => resolveOneMirror(b, md5).then((u) => u || Promise.reject()));
  attempts.forEach((p) => p.catch(() => {}));
  try { return await Promise.any(attempts); } catch { return null; }
}

// Resolve candidate download URLs from every mirror (in parallel, de-duped).
// Returned in priority order: libgen.la (most reliable observed), .vg, .gl, .bz.
const DOWNLOAD_MIRROR_ORDER = ["https://libgen.la", "https://libgen.vg", "https://libgen.gl", "https://libgen.bz"];
export async function resolveDownloadUrls(md5: string): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  const results = await Promise.all(DOWNLOAD_MIRROR_ORDER.map((b) => resolveOneMirror(b, md5)));
  for (const u of results) {
    if (u && !seen.has(u)) { seen.add(u); urls.push(u); }
  }
  return urls;
}

// Hostname allowlist for every URL we resolve or dereference during LibGen
// fetches. Anything that doesn't match the mirror roots OR one of the CDN
// hosts LibGen hands out in "GET" redirects is rejected — this prevents an
// attacker who controls a mirror HTML response from steering our server into
// fetching arbitrary internal / LAN / cloud-metadata hosts (SSRF).
//
// Note: LibGen mirrors commonly return ads.php pages whose GET button points
// to `cdn?.books.ms`, `libgen.rs`, or one of the main *.vg/*.la/*.gl/*.bz
// domains. Keep the list explicit; if a new mirror appears we'll add it
// deliberately rather than auto-trusting.
const ALLOWED_DOWNLOAD_HOSTS = new Set<string>([
  "libgen.vg", "libgen.la", "libgen.gl", "libgen.bz",
  "cdn1.booksdl.lc", "cdn2.booksdl.lc", "cdn3.booksdl.lc",
  "cdn.booksdl.org", "cdn1.booksdl.org", "cdn2.booksdl.org",
  "libgen.rs", "libgen.is", "libgen.st",
  "download.library.lol", "library.lol",
  "books.ms", "cdn.books.ms", "cdn1.books.ms", "cdn2.books.ms",
]);

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (ALLOWED_DOWNLOAD_HOSTS.has(h)) return true;
  // Accept subdomains of any allowed host (e.g. cloudflare CDN edges).
  for (const base of ALLOWED_DOWNLOAD_HOSTS) {
    if (h.endsWith("." + base)) return true;
  }
  return false;
}

function absolute(href: string, origin: URL): string | null {
  let abs: URL;
  try { abs = new URL(href, origin); } catch { return null; }
  if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
  if (!isAllowedHost(abs.hostname)) return null;
  return abs.toString();
}

export type DownloadProgress = (info: { bytes: number; total: number | null; pct: number | null }) => void;

// Stream a URL to disk with a stall watchdog. If no bytes arrive for stallMs,
// aborts the fetch so the caller can try the next mirror.
// No wall-clock timeout: a slow mirror is OK as long as bytes keep flowing.
export async function downloadToFile(
  url: string,
  dest: string,
  maxBytes: number,
  opts?: { onProgress?: DownloadProgress; stallMs?: number; signal?: AbortSignal }
): Promise<{ bytes: number; filename: string }> {
  const fsp = await import("node:fs/promises");
  const path = await import("node:path");
  const stallMs = opts?.stallMs ?? 20000;

  // Defense-in-depth: even though callers (resolveDownloadUrls) only hand us
  // allowlisted URLs, enforce again here so any future caller can't bypass
  // the SSRF guard.
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Invalid download URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported protocol");
  if (!isAllowedHost(parsed.hostname)) throw new Error(`Host not in LibGen allowlist: ${parsed.hostname}`);

  const ctrl = new AbortController();
  const linkAbort = () => ctrl.abort(new Error("external abort"));
  if (opts?.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", linkAbort, { once: true });
  }

  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: ctrl.signal });
  if (!res.ok) { ctrl.abort(); throw new Error(`download ${res.status}`); }
  const cd = res.headers.get("content-disposition") || "";
  const m = cd.match(/filename\*?=["']?(?:UTF-\d'[^']*')?([^";]+)/i);
  let name = m ? decodeURIComponent(m[1]) : path.basename(new URL(url).pathname) || "book";
  name = name.replace(/[^\w.\- ]+/g, "_").slice(0, 180);
  const finalPath = path.join(path.dirname(dest), name);

  const totalHeader = Number(res.headers.get("content-length") || "0");
  const total = totalHeader > 0 ? totalHeader : null;
  if (total !== null && total > maxBytes) {
    ctrl.abort();
    throw new Error(`File too large: ${total} > ${maxBytes}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("no response body");

  const fh = await fsp.open(finalPath, "w");
  let bytes = 0;
  let stallTimer: NodeJS.Timeout | null = null;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      ctrl.abort(new Error(`stalled: no bytes for ${stallMs}ms`));
    }, stallMs);
  };
  armStall();
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      bytes += value.length;
      if (bytes > maxBytes) { ctrl.abort(); throw new Error(`File too large: ${bytes} > ${maxBytes}`); }
      await fh.write(value);
      armStall();
      if (opts?.onProgress) {
        const pct = total ? Math.min(100, Math.floor((bytes / total) * 100)) : null;
        try { opts.onProgress({ bytes, total, pct }); } catch {}
      }
    }
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    await fh.close().catch(() => {});
    if (opts?.signal) opts.signal.removeEventListener("abort", linkAbort);
  }
  return { bytes, filename: name };
}

// Try each candidate URL in sequence; first one that streams to completion wins.
// Stalls (20s default without progress) and errors trigger fallback to the next URL.
export async function downloadWithFallback(
  urls: string[],
  dest: string,
  maxBytes: number,
  opts?: { onProgress?: DownloadProgress; stallMs?: number; onMirrorStart?: (url: string, i: number, total: number) => void }
): Promise<{ bytes: number; filename: string; url: string }> {
  const errors: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    try {
      opts?.onMirrorStart?.(u, i, urls.length);
      const r = await downloadToFile(u, dest, maxBytes, { onProgress: opts?.onProgress, stallMs: opts?.stallMs });
      return { ...r, url: u };
    } catch (e: any) {
      errors.push(`${new URL(u).hostname}: ${String(e?.message || e).slice(0, 120)}`);
      continue;
    }
  }
  throw new Error(`All mirrors failed: ${errors.join("; ")}`);
}
