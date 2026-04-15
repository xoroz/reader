const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function cleanupChunk(rawText: string, hint: string): Promise<{ chapters: Array<{ title?: string; paragraphs: string[] }> }> {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL_CLEANUP || "anthropic/claude-haiku-4.5";
  if (!key) throw new Error("OPENROUTER_API_KEY not set");

  const system = `You are a careful book typesetter. Given raw extracted text from a document, clean it and return STRICT JSON of shape:
{"chapters":[{"title":"optional string","paragraphs":["paragraph 1","paragraph 2"]}]}

Rules:
- Keep only: the book title (+ subtitle), the author, a TABLE OF CONTENTS if one is present, a Prologue / Foreword / Preface / Introduction if it's authored by the actual author of the book, and the main body (Chapter 1 onward). DROP everything else: copyright page, ISBN block, dedication page if brief and boilerplate (<5 words), "also by the author" lists, publisher address, Library of Congress cataloging, printing history, endorsements/blurbs from other authors, epigraphs from *other* works' front matter, translator's notes unless substantive, "About the Publisher", marketing copy, preview chapters of other books, back-cover blurbs.
- Keep the Table of Contents as a single paragraph or a list, intact, as a chapter titled "Contents" if present.
- Remove running headers, footers, page numbers, and copyright boilerplate.
- Merge hyphenated line-breaks (e.g. "exam-\\nple" -> "example").
- Join lines that belong to the same paragraph; keep paragraph breaks.
- Detect chapter starts from clear cues ("Chapter 1", "CHAPTER I", "Prologue", numeric section, centered bold heading) and use them as chapters. If no chapters detected, put everything in one chapter with no title.
- RESTORE CONTRACTION APOSTROPHES that were dropped by PDF extraction: "didn t" -> "didn't", "weren t" -> "weren't", "I m" -> "I'm", "it s" -> "it's", "you re" -> "you're", "we ve" -> "we've", etc. Use a typographic apostrophe (\u2019).
- RESTORE POSSESSIVES: "the ship s" -> "the ship's", "it s own" -> "its own" (when possessive, not contraction).
- RESTORE QUOTES that were dropped (pairs of "), leaving plain quotes where ambiguous.
- Collapse multiple spaces to one; fix " ." / " ," to ". " / ", " spacing.
- Drop orphan single-letter accented symbols on their own line (often PDF ligature glitches like "\u00D3\u00D3").
- Fix obvious OCR artefacts (e.g. "rn" -> "m" only when unambiguous) but do NOT rewrite prose.
- Preserve original language. Do not translate.
- Return ONLY JSON, no prose, no markdown fences.`;

  const user = `Hint: ${hint}\n\nRAW TEXT:\n${rawText}`;

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer": process.env.OPENROUTER_REFERER || "https://apps.lukasz.com/Reader",
      "X-Title": "Reader",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`cleanup ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  const content = json.choices?.[0]?.message?.content || "{}";
  const fallback = { chapters: [{ paragraphs: splitParagraphs(rawText) }] };
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.chapters)) return fallback;
    // Validate shape: each chapter must have a paragraphs array of strings; drop bad entries.
    const chapters: Array<{ title?: string; paragraphs: string[] }> = [];
    for (const ch of parsed.chapters) {
      if (!ch || typeof ch !== "object" || !Array.isArray(ch.paragraphs)) continue;
      const paragraphs = ch.paragraphs.filter((p: unknown): p is string => typeof p === "string");
      if (!paragraphs.length) continue;
      chapters.push(typeof ch.title === "string" ? { title: ch.title, paragraphs } : { paragraphs });
    }
    return chapters.length ? { chapters } : fallback;
  } catch {
    return fallback;
  }
}

export function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function countWords(text: string): number {
  return (text.match(/\S+/g) || []).length;
}

// Deterministic cleanup for common PDF extraction artefacts before/after AI pass.
export function normalizeText(text: string): string {
  let t = text;
  // Strip zero-width + BOM + soft hyphen + replacement char + misc control chars
  t = t.replace(/[\u200B-\u200F\uFEFF\u00AD\uFFFD\u0000-\u0008\u000B-\u001F]/g, "");
  // Fix broken contractions: "didn t" -> "didn't", etc.
  const neg = "didn|isn|wasn|weren|haven|hasn|hadn|doesn|don|couldn|wouldn|shouldn|won|aren|mustn|needn|shan|mightn|oughtn";
  t = t.replace(new RegExp(`\\b(${neg})\\s+t\\b`, "gi"), "$1\u2019t");
  // "I m", "I ll", "I ve", "I d"
  t = t.replace(/\b(I|you|we|they|You|We|They)\s+(ll|ve|re|d|m)\b/g, "$1\u2019$2");
  t = t.replace(/\b(he|she|it|He|She|It)\s+(s|d|ll)\b/g, "$1\u2019$2");
  t = t.replace(/\b(that|That|there|There|here|Here|what|What|who|Who|how|How|where|Where|when|When|why|Why|this|This|now|Now|let|Let|its|Its)\s+s\b/g, "$1\u2019s");
  // "it s" as standalone low-case
  t = t.replace(/\b(it|It)\s+(s|d|ll)\b/g, "$1\u2019$2");
  // Fix broken quotes where text has curly artifacts dropped
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  // Join hyphenated line breaks already removed earlier, but collapse stray double-space runs
  t = t.replace(/[ \t]{2,}/g, " ");
  // Remove orphan "Ó" / random diacritics not adjacent to letters (common OCR junk on page bullets)
  t = t.replace(/(^|\n)\s*[\u00C0-\u00FF\u0100-\u024F]{1,3}\s*(\n|$)/g, "$1$2");
  return t.trim();
}

// Drop boilerplate paragraphs (copyright pages, ISBN blocks, frontmatter junk).
export function isBoilerplateParagraph(p: string): boolean {
  const t = p.trim();
  if (!t) return true;
  if (t.length < 350 && /\bcopyright\b|©|\(c\)\s*\d{4}|all rights reserved|no part of this (book|publication)|printed in (the )?(united states|great britain|usa|u\.s\.a)|first published|isbn[- ]?1?0?[:]?\s*\d|library of congress cataloging|a cip catalog|manufactured in|cataloging-in-publication|cataloguing-in-publication|publisher'?s note|published by|a division of|penguin books|random house|harpercollins|simon\s*&?\s*schuster|printed and bound|typeset in|typeset by|set in \w+ type|printing\s*:?\s*\d+\s*\d+\s*\d+|this book is a work of (non)?fiction|\bp\.\s*cm\b|printing history|distributed by|reprinted by arrangement|electronic edition/i.test(t)) return true;
  // ALL CAPS boilerplate line (common for trademark/legal)
  if (t === t.toUpperCase() && t.length < 200 && /ALL RIGHTS RESERVED|COPYRIGHT|TRADEMARK|PUBLISHED|PRINTED|FIRST EDITION/.test(t)) return true;
  // Lone ISBN
  if (/^\s*isbn[- ]?1?[03]?:?\s*[\d\- Xx]+\s*$/i.test(t)) return true;
  // Printing line like "10 9 8 7 6 5 4 3 2 1"
  if (/^(\s*\d+\s*){5,}$/.test(t)) return true;
  return false;
}

export function dropBoilerplate(paragraphs: string[]): string[] {
  return paragraphs.filter((p) => !isBoilerplateParagraph(p));
}

// Chapter-level copyright detection: drops the whole chapter if its title
// or its body is dominated by copyright/legal/front-matter content.
export function isCopyrightChapter(ch: { title?: string; paragraphs: string[] }): boolean {
  const title = (ch.title || "").toLowerCase();
  if (/copyright|colophon|legal notice|imprint|publisher.{0,3}note|cataloging|cataloguing|publication data|edition notice/.test(title)) return true;
  const paras = ch.paragraphs || [];
  if (!paras.length) return false;
  // Total chars > 4000 implies real chapter — keep
  const totalChars = paras.reduce((s, p) => s + p.length, 0);
  if (totalChars > 4000) return false;
  // Count paragraphs flagged as boilerplate; if ≥60% of them OR ≥4 hits, drop
  let hits = 0;
  for (const p of paras) if (isBoilerplateParagraph(p)) hits++;
  if (hits >= 4) return true;
  if (hits / paras.length >= 0.6) return true;
  // Strong single-paragraph signal: lone copyright line
  if (paras.length <= 3 && /\bcopyright\b|©|all rights reserved|isbn[- ]?[0-9]/i.test(paras.join(" "))) return true;
  return false;
}

export function dropCopyrightChapters<T extends { title?: string; paragraphs: string[] }>(chapters: T[]): T[] {
  return chapters.filter((c) => !isCopyrightChapter(c));
}
