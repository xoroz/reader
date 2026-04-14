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

export async function synthesize(text: string, voice: TtsVoice): Promise<Buffer> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  const body = {
    model: process.env.OPENROUTER_MODEL_TTS || "openai/gpt-audio-mini",
    modalities: ["text", "audio"],
    audio: { voice, format: "pcm16" },
    stream: true,
    messages: [
      { role: "system", content: "You are a text-to-speech engine. Read the user's text aloud verbatim in a warm, homey, low-pitched tone — like a seasoned audiobook narrator reading by a fireplace. Unhurried, calm, deliberate pace, slightly slower than conversational speech. Breathe naturally between sentences; pause a bit longer at paragraph breaks. Never add commentary, summaries, or extra words. Never read markdown or formatting characters aloud." },
      { role: "user", content: text },
    ],
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer": "https://apps.lukasz.com/Reader",
      "X-Title": "Reader",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);

  // Parse SSE stream: each `data:` JSON event may carry choices[0].delta.audio.data (base64 chunk)
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const chunks: Buffer[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta || j.choices?.[0]?.message;
        const b64 = delta?.audio?.data;
        if (b64) chunks.push(Buffer.from(b64, "base64"));
      } catch {}
    }
  }
  if (!chunks.length) throw new Error("TTS stream returned no audio chunks");
  const pcm = Buffer.concat(chunks);
  return wrapWav(pcm, 24000, 1, 16);
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
