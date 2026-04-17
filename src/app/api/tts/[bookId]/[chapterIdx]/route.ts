import { NextRequest, NextResponse } from "next/server";
import { q, pool } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { chunkForTts, partsMeta, sliceFromParagraph, synthesize, TTS_VOICES, TtsVoice } from "@/lib/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Upper bounds for integer query params. A book with more than 10k chapters
// or a chapter with more than 10k paragraphs/parts is not a real input; it's
// abuse (probing for off-by-one DB errors, etc.). Reject fast.
const MAX_CHAPTER_IDX = 10_000;
const MAX_PART_IDX = 10_000;
const MAX_PARAGRAPH_IDX = 100_000;

function parseNonNegativeInt(raw: string | null, max: number): number | null {
  if (raw === null) return null;
  if (!/^\d{1,7}$/.test(raw)) return NaN as any;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) return NaN as any;
  return n;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ bookId: string; chapterIdx: string }> }) {
  const email = await currentEmail();
  const { bookId, chapterIdx } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(bookId)) return NextResponse.json({ error: "Invalid bookId" }, { status: 400 });
  if (!/^\d{1,7}$/.test(chapterIdx)) return NextResponse.json({ error: "Invalid chapter" }, { status: 400 });
  const ch = Number(chapterIdx);
  if (!Number.isInteger(ch) || ch < 0 || ch > MAX_CHAPTER_IDX) return NextResponse.json({ error: "Invalid chapter" }, { status: 400 });

  const partParam = req.nextUrl.searchParams.get("part");
  const partParsed = parseNonNegativeInt(partParam, MAX_PART_IDX);
  if (Number.isNaN(partParsed as any)) return NextResponse.json({ error: "Invalid part" }, { status: 400 });
  const partIdx: number = partParsed ?? 0;
  const voiceParam = (req.nextUrl.searchParams.get("voice") || "alloy").toLowerCase();
  if (!TTS_VOICES.includes(voiceParam as any)) return NextResponse.json({ error: "Invalid voice" }, { status: 400 });
  const voice = voiceParam as TtsVoice;

  if (req.nextUrl.searchParams.get("meta") === "1") {
    const chap = await q<{ text: string }>(
      `SELECT c.text FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE b.id = $1 AND b.owner_email = $2 AND c.idx = $3`,
      [bookId, email, ch]
    );
    if (!chap.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { parts, totalWords } = partsMeta(chap[0].text);
    const cached = await q<{ part_idx: number }>(
      `SELECT part_idx FROM audio_cache WHERE book_id = $1 AND chapter_idx = $2 AND voice = $3`,
      [bookId, ch, voice]
    );
    return NextResponse.json({ parts, totalWords, cached: cached.map((x) => x.part_idx) });
  }

  const fromParam = req.nextUrl.searchParams.get("from");
  const fromParsed = parseNonNegativeInt(fromParam, MAX_PARAGRAPH_IDX);
  if (Number.isNaN(fromParsed as any)) return NextResponse.json({ error: "Invalid from" }, { status: 400 });
  const fromPara = fromParsed;

  // Custom slice (start mid-part): synthesize on the fly, don't cache
  if (fromPara != null) {
    const chap = await q<{ text: string }>(
      `SELECT c.text FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE b.id = $1 AND b.owner_email = $2 AND c.idx = $3`,
      [bookId, email, ch]
    );
    if (!chap.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const slice = sliceFromParagraph(chap[0].text, fromPara);
    if (!slice) return NextResponse.json({ error: "Paragraph out of range" }, { status: 404 });
    let wav: Buffer;
    try { wav = await synthesize(slice.text, voice); }
    catch (e: any) { return NextResponse.json({ error: e.message || "TTS failed" }, { status: 502 }); }
    return new Response(wav as any, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "private, no-store",
        "X-Cache": "SKIP",
        "X-Start-Para": String(slice.startPara),
        "X-End-Para": String(slice.endPara),
        "X-Paragraph-Word-Counts": JSON.stringify(slice.paragraphWordCounts),
      },
    });
  }

  const cached = await pool.query<{ data: Buffer }>(
    `SELECT data FROM audio_cache WHERE book_id = $1 AND chapter_idx = $2 AND part_idx = $3 AND voice = $4`,
    [bookId, ch, partIdx, voice]
  );
  if (cached.rows.length) {
    return new Response(cached.rows[0].data as any, {
      status: 200,
      headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=604800", "X-Cache": "HIT" },
    });
  }

  const chap = await q<{ text: string }>(
    `SELECT c.text FROM chapters c JOIN books b ON b.id = c.book_id
     WHERE b.id = $1 AND b.owner_email = $2 AND c.idx = $3`,
    [bookId, email, ch]
  );
  if (!chap.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parts = chunkForTts(chap[0].text);
  if (partIdx >= parts.length) return NextResponse.json({ error: "Part out of range" }, { status: 404 });

  let mp3: Buffer;
  try { mp3 = await synthesize(parts[partIdx].text, voice); }
  catch (e: any) { return NextResponse.json({ error: e.message || "TTS failed" }, { status: 502 }); }

  await pool.query(
    `INSERT INTO audio_cache (book_id, chapter_idx, part_idx, voice, data) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (book_id, chapter_idx, part_idx, voice) DO UPDATE SET data = EXCLUDED.data, created_at = now()`,
    [bookId, ch, partIdx, voice, mp3]
  );

  return new Response(mp3 as any, {
    status: 200,
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=604800", "X-Cache": "MISS" },
  });
}
