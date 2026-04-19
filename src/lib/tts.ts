// High-quality TTS via OpenRouter -> openai/gpt-audio-mini (same voice family as ChatGPT).
// Accepts text, returns MP3 bytes. Chunked at ~3500 chars per request.

export const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "coral", "sage"] as const;
export type TtsVoice = typeof TTS_VOICES[number];

const MAX_CHARS = 3500;

export type TtsPart = { text: string; startPara: number; endPara: number; paragraphWordCounts: number[] };

function wordCount(s: string): number { return (s.match(/\S+/g) || []).length; }

export function chunkForTts(text: string): TtsPart[] {
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const parts: TtsPart[] = [];
  let buf: string[] = [];
  let startPara = 0;

  const flush = (endPara: number) => {
    if (!buf.length) return;
    parts.push({
      text: buf.join("\n\n"),
      startPara,
      endPara,
      paragraphWordCounts: buf.map(wordCount),
    });
    buf = [];
  };

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const curLen = buf.reduce((s, b) => s + b.length + 2, 0);
    if (buf.length && curLen + p.length > MAX_CHARS) {
      flush(startPara + buf.length - 1);
      startPara = i;
    }
    if (!buf.length) startPara = i;
    buf.push(p);
  }
  flush(startPara + buf.length - 1);
  return parts;
}

export function partsMeta(text: string): { parts: { startPara: number; endPara: number; paragraphWordCounts: number[] }[]; totalWords: number } {
  const parts = chunkForTts(text);
  const meta = parts.map(({ startPara, endPara, paragraphWordCounts }) => ({ startPara, endPara, paragraphWordCounts }));
  const totalWords = meta.reduce((s, p) => s + p.paragraphWordCounts.reduce((a, b) => a + b, 0), 0);
  return { parts: meta, totalWords };
}

// Return the text (and paragraph word counts) for paragraphs [from..endPara] of the part containing `fromPara`.
export function sliceFromParagraph(text: string, fromPara: number): { text: string; startPara: number; endPara: number; paragraphWordCounts: number[] } | null {
  const parts = chunkForTts(text);
  const part = parts.find((p) => fromPara >= p.startPara && fromPara <= p.endPara);
  if (!part) return null;
  const localStart = fromPara - part.startPara;
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const slice = paragraphs.slice(fromPara, part.endPara + 1);
  return {
    text: slice.join("\n\n"),
    startPara: fromPara,
    endPara: part.endPara,
    paragraphWordCounts: part.paragraphWordCounts.slice(localStart),
  };
}

// Map the OpenAI-flavoured voice ids the Reader UI exposes onto Gemini
// prebuilt voice names. Keeps the existing voice picker working unchanged
// while the backend uses Gemini TTS (the model the Android app already uses).
const GEMINI_VOICE_MAP: Record<TtsVoice, string> = {
  alloy: "Charon",
  onyx: "Orus",
  echo: "Puck",
  fable: "Zephyr",
  nova: "Aoede",
  shimmer: "Kore",
  coral: "Leda",
  sage: "Algenib",
};

const TTS_INSTRUCTIONS =
  "You are a text-to-speech engine. Read the user's text aloud verbatim in a warm, homey, low-pitched tone — like a seasoned audiobook narrator reading by a fireplace. Unhurried, calm, deliberate pace, slightly slower than conversational speech. Breathe naturally between sentences; pause a bit longer at paragraph breaks. Never add commentary, summaries, or extra words. Never read markdown or formatting characters aloud.";

function parseSampleRate(mime: string): number {
  const m = /rate=(\d+)/.exec(mime || "");
  return m ? parseInt(m[1], 10) : 24000;
}

export async function synthesize(text: string, voice: TtsVoice): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = process.env.READER_TTS_MODEL || "gemini-2.5-flash-preview-tts";
  const geminiVoice = GEMINI_VOICE_MAP[voice] || "Charon";
  const payload = {
    contents: [{ parts: [{ text: `${TTS_INSTRUCTIONS}\n\n${text}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice } },
      },
    },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json().catch(() => null);
  const part = json?.candidates?.[0]?.content?.parts?.[0];
  const b64: string | undefined = part?.inlineData?.data;
  const mime: string = part?.inlineData?.mimeType ?? "audio/L16;codec=pcm;rate=24000";
  if (!b64) throw new Error("TTS returned no audio");
  const pcm = Buffer.from(b64, "base64");
  return await pcmToMp3(pcm, parseSampleRate(mime));
}

// Pipe raw PCM (signed 16-bit little-endian, mono) through ffmpeg -> MP3.
// Falls back to WAV if ffmpeg isn't on PATH.
async function pcmToMp3(pcm: Buffer, sampleRate: number): Promise<Buffer> {
  const { spawn } = await import("node:child_process");
  return await new Promise<Buffer>((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-f", "s16le",
        "-ar", String(sampleRate),
        "-ac", "1",
        "-i", "pipe:0",
        "-codec:a", "libmp3lame",
        "-b:a", "64k",
        "-f", "mp3",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.stderr.on("data", (d) => errChunks.push(d));
    ff.on("error", (err) => reject(err));
    ff.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 200)}`));
    });
    ff.stdin.end(pcm);
  });
}

function wrapWav(pcm: Buffer, sampleRate: number, channels: number, bits: number): Buffer {
  const byteRate = sampleRate * channels * bits / 8;
  const blockAlign = channels * bits / 8;
  const dataSize = pcm.length;
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);            // fmt chunk size
  buf.writeUInt16LE(1, 20);             // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return Buffer.concat([buf, pcm]);
}
