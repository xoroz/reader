// LibGen search + download via the *.vg / *.la / *.gl / *.bz mirrors.
// Flow:
//   1) GET https://libgen.vg/index.php?req=...&res=25  (HTML results; each row has /ads.php?md5=<md5>)
//   2) Scrape MD5 + title/author/year/size/ext from the results table.
//   3) Follow /ads.php?md5=... to the "GET" button's direct download URL (cloudflare-storage).
//
// All mirrors are Cloudflare-fronted, reachable from PL ISPs. We try them in order.

const MIRRORS = ["https://libgen.vg", "https://libgen.la", "https://libgen.gl", "https://libgen.bz"];
const UA = "Mozilla/5.0 (Reader/0.2)";

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

export async function searchLibgen(query: string, format?: string): Promise<LibgenHit[]> {
  for (const base of MIRRORS) {
    try {
      const url = `${base}/index.php?req=${encodeURIComponent(query)}&res=50`;
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const html = await res.text();
      let hits = parseResults(html, base);
      if (format && format !== "any") hits = hits.filter((h) => h.extension === format);
      if (hits.length) return hits;
    } catch {}
  }
  return [];
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

// Strip all attributes from every HTML tag so attribute values (which may contain nested quotes,
// ampersands, and even leaked ">" characters) never pollute text parsing.
function stripAttrs(s: string): string {
  return s.replace(/<([a-zA-Z][a-zA-Z0-9]*)(?:\s+[^>]*)?(\s*\/?)>/g, "<$1$2>");
}

function extractFirstAnchorText(cell: string): string {
  const s = stripAttrs(cell);
  const m = s.match(/<a>([\s\S]*?)<\/a>/i);
  return strip(m ? m[1] : s);
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
    const author = strip(cells[1]) || undefined;
    const publisher = strip(cells[2]) || undefined;
    const year = strip(cells[3]) || undefined;
    const language = strip(cells[4]) || undefined;
    const pagesRaw = strip(cells[5]);
    const pages = pagesRaw && pagesRaw !== "0" ? pagesRaw.split("/")[0].trim() : undefined;
    const size = strip(cells[6]) || undefined;
    const extension = strip(cells[7]).toLowerCase() || undefined;
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

export async function resolveDownloadUrl(md5: string): Promise<string | null> {
  for (const base of MIRRORS) {
    try {
      const url = `${base}/ads.php?md5=${md5}`;
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const html = await res.text();
      // The "GET" button on libgen.vg ads.php is typically an <a href="get.php?md5=...&key=..."> or a direct CF-Storage URL.
      const get1 = html.match(/<a[^>]+href="([^"]+)"[^>]*>\s*GET\s*<\/a>/i);
      if (get1) return absolute(get1[1], new URL(url));
      const get2 = html.match(/href="(get\.php\?md5=[^"]+)"/i);
      if (get2) return new URL(get2[1], url).toString();
      const get3 = html.match(/href="(https?:\/\/[^"]+\.(?:pdf|epub|djvu|mobi|azw3)(?:\?[^"]*)?)"/i);
      if (get3) return get3[1];
    } catch {}
  }
  return null;
}

function absolute(href: string, origin: URL): string {
  try { return new URL(href, origin).toString(); } catch { return href; }
}

export async function downloadToFile(url: string, dest: string, maxBytes: number): Promise<{ bytes: number; filename: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const cd = res.headers.get("content-disposition") || "";
  const m = cd.match(/filename\*?=["']?(?:UTF-\d'[^']*')?([^";]+)/i);
  let name = m ? decodeURIComponent(m[1]) : path.basename(new URL(url).pathname) || "book";
  name = name.replace(/[^\w.\- ]+/g, "_").slice(0, 180);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`File too large: ${buf.length} > ${maxBytes}`);
  const finalPath = path.join(path.dirname(dest), name);
  await fs.writeFile(finalPath, buf);
  return { bytes: buf.length, filename: name };
}
