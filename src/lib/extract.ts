import fs from "node:fs/promises";
import path from "node:path";
import { cleanupChunk, splitParagraphs, countWords, normalizeText, dropBoilerplate, dropCopyrightChapters } from "./ai";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export type Chapter = { title?: string; paragraphs: string[] };
export type Extracted = { title?: string; author?: string; chapters: Chapter[]; wordCount: number; kind: string; coverPath?: string };
export type ProgressFn = (stage: string, pct: number) => void;

async function tryPdfCover(pdfPath: string, outPath: string): Promise<string | null> {
  try {
    const base = outPath.replace(/\.[^.]+$/, "");
    await exec("pdftoppm", ["-jpeg", "-jpegopt", "quality=82", "-r", "120", "-f", "1", "-l", "1", "-singlefile", pdfPath, base], { timeout: 45000 });
    const final = base + ".jpg";
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(final).catch(() => null);
    return stat && stat.size > 0 ? final : null;
  } catch { return null; }
}

async function tryEpubCover(epub: any, dir: string): Promise<string | null> {
  try {
    const meta = epub.metadata || {};
    const manifest = epub.manifest || {};
    let coverId: string | undefined =
      meta.cover ||
      Object.keys(manifest).find((k) => /cover/i.test(k) && /image/i.test(manifest[k]["media-type"] || ""));
    if (!coverId) return null;
    const entry = manifest[coverId];
    const mt: string = (entry && entry["media-type"]) || "image/jpeg";
    const ext = mt.includes("png") ? "png" : mt.includes("webp") ? "webp" : "jpg";
    const data: Buffer | string = await new Promise((res, rej) => epub.getImage(coverId, (e: any, d: any) => e ? rej(e) : res(d)));
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
    if (!buf.length) return null;
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const p = path.join(dir, `cover.${ext}`);
    await fs.writeFile(p, buf);
    return p;
  } catch { return null; }
}

const MAX_CHARS_PER_CHUNK = 24000;

export function detectKind(filename: string, mime?: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".epub") return "epub";
  if (ext === ".docx") return "docx";
  if (ext === ".md" || ext === ".markdown") return "md";
  if (ext === ".txt") return "txt";
  if (mime?.startsWith("image/")) return "image";
  return "txt";
}

export async function extract(filePath: string, filename: string, mime: string | undefined, onProgress?: ProgressFn): Promise<Extracted> {
  const kind = detectKind(filename, mime);
  const report = onProgress || (() => {});
  report(`Parsing ${kind.toUpperCase()}`, 5);
  switch (kind) {
    case "txt":
    case "md":
      return await fromPlain(filePath, kind, filename, report);
    case "epub":
      return await fromEpub(filePath, filename, report);
    case "docx":
      return await fromDocx(filePath, filename, report);
    case "pdf":
      return await fromPdf(filePath, filename, report);
    default:
      throw new Error(`Unsupported kind: ${kind}`);
  }
}

async function fromPlain(filePath: string, kind: string, filename: string, report: ProgressFn): Promise<Extracted> {
  const text = await fs.readFile(filePath, "utf8");
  report("Cleaning with AI", 20);
  const cleaned = await cleanupInChunks(text, kind === "md" ? "markdown source" : "plain text", report);
  return { title: filename.replace(/\.[^.]+$/, ""), chapters: cleaned, wordCount: cleaned.reduce((s, c) => s + c.paragraphs.reduce((a, p) => a + countWords(p), 0), 0), kind };
}

async function fromDocx(filePath: string, filename: string, report: ProgressFn): Promise<Extracted> {
  const mammoth = await import("mammoth");
  report("Reading DOCX", 10);
  const { value } = await mammoth.extractRawText({ path: filePath });
  report("Cleaning with AI", 20);
  const cleaned = await cleanupInChunks(value, "docx", report);
  return { title: filename.replace(/\.[^.]+$/, ""), chapters: cleaned, wordCount: cleaned.reduce((s, c) => s + c.paragraphs.reduce((a, p) => a + countWords(p), 0), 0), kind: "docx" };
}

async function fromPdf(filePath: string, filename: string, report: ProgressFn): Promise<Extracted> {
  const pdfParse = (await import("pdf-parse")).default as any;
  const buf = await fs.readFile(filePath);
  report("Extracting text from PDF", 10);
  const data = await pdfParse(buf);
  const raw: string = data.text || "";
  if (!raw.trim() || raw.replace(/\s/g, "").length < 200) {
    throw new Error("This PDF appears to be a scan with no text layer. OCR fallback not enabled in v1.");
  }
  const dir = path.dirname(filePath);
  report("Rendering cover", 15);
  const coverPath = await tryPdfCover(filePath, path.join(dir, "cover.jpg")) || undefined;
  report("Cleaning with AI", 20);
  const cleaned = await cleanupInChunks(raw, `pdf with ${data.numpages || "?"} pages`, report);
  const title = (data.info && (data.info.Title as string)) || filename.replace(/\.[^.]+$/, "");
  const author = data.info && (data.info.Author as string);
  return { title, author, chapters: cleaned, wordCount: cleaned.reduce((s, c) => s + c.paragraphs.reduce((a, p) => a + countWords(p), 0), 0), kind: "pdf", coverPath };
}

async function fromEpub(filePath: string, filename: string, report: ProgressFn): Promise<Extracted> {
  const { EPub } = await import("epub2");
  return new Promise<Extracted>((resolve, reject) => {
    const epub: any = new (EPub as any)(filePath);
    epub.on("error", reject);
    epub.on("end", async () => {
      try {
        const flow: any[] = epub.flow || [];
        const chapters: Chapter[] = [];
        for (let i = 0; i < flow.length; i++) {
          const item = flow[i];
          const html: string = await new Promise((res, rej) => epub.getChapter(item.id, (e: any, t: string) => e ? rej(e) : res(t)));
          const text = htmlToText(html);
          if (!text.trim()) continue;
          chapters.push({ title: item.title, paragraphs: dropBoilerplate(splitParagraphs(text)) });
          report(`Reading EPUB chapters (${i + 1}/${flow.length})`, 10 + Math.round((i / flow.length) * 80));
        }
        const title = (epub.metadata && epub.metadata.title) || filename.replace(/\.[^.]+$/, "");
        const author = epub.metadata && epub.metadata.creator;
        const coverPath = (await tryEpubCover(epub, path.dirname(filePath))) || undefined;
        const cleaned = dropCopyrightChapters(chapters.filter((c) => c.paragraphs.length));
        const wc = cleaned.reduce((s, c) => s + c.paragraphs.reduce((a, p) => a + countWords(p), 0), 0);
        report("Finalizing", 95);
        resolve({ title, author, chapters: cleaned, wordCount: wc, kind: "epub", coverPath });
      } catch (e) { reject(e); }
    });
    epub.parse();
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(p|div|br|h[1-6]|li|tr)[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function cleanupInChunks(rawIn: string, hint: string, report: ProgressFn = () => {}): Promise<Chapter[]> {
  const raw = normalizeText(rawIn);
  if (raw.length <= MAX_CHARS_PER_CHUNK) {
    report("Cleaning with AI", 40);
    const out = await cleanupChunk(raw, hint);
    for (const ch of out.chapters) ch.paragraphs = dropBoilerplate(ch.paragraphs.map(normalizeText).filter(Boolean));
    report("Finalizing", 95);
    return dropCopyrightChapters(out.chapters.filter((c) => c.paragraphs.length));
  }
  const chunks: string[] = [];
  let i = 0;
  while (i < raw.length) {
    let end = Math.min(i + MAX_CHARS_PER_CHUNK, raw.length);
    if (end < raw.length) {
      const nl = raw.lastIndexOf("\n\n", end);
      if (nl > i + 1000) end = nl;
    }
    chunks.push(raw.slice(i, end));
    i = end;
  }
  const out: Chapter[] = [];
  for (let c = 0; c < chunks.length; c++) {
    report(`Cleaning with AI (${c + 1}/${chunks.length})`, 20 + Math.round(((c) / chunks.length) * 70));
    const r = await cleanupChunk(chunks[c], `${hint} (chunk ${c + 1}/${chunks.length})`);
    out.push(...r.chapters);
  }
  for (const ch of out) ch.paragraphs = dropBoilerplate(ch.paragraphs.map(normalizeText).filter(Boolean));
  // Drop empty chapters that were entirely boilerplate, then drop copyright/legal chapters
  const purged = dropCopyrightChapters(out.filter((c) => c.paragraphs.length));
  out.length = 0; out.push(...purged);
  report("Finalizing", 95);
  return out;
}
