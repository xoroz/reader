import { NextRequest, NextResponse } from "next/server";
import { authenticateSync } from "@/lib/sync-auth";
import { chatCompletion } from "shared-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_PHRASE = 600;
const MAX_CONTEXT = 2000;
const SYSTEM =
  "You are a precise dictionary. Given a word or phrase from a book the reader is in the middle of, " +
  "reply in 2-3 short sentences: the meaning, and if it is idiomatic or archaic, note that. Use plain " +
  "language. No preamble. You may use inline markdown (*italic*, **bold**) sparingly.";
const SUMMARY_SYSTEM =
  "You are a thoughtful literary companion. Summarise the named chapter or section of a book in 3-5 " +
  "sentences. Focus on the main argument or narrative beats; avoid plot spoilers beyond the chapter. " +
  "No preamble, plain language, inline markdown sparingly.";

export async function POST(req: NextRequest) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 500 });

  let body: { phrase?: string; context?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const phrase = (body.phrase || "").toString().slice(0, MAX_PHRASE).trim();
  const context = (body.context || "").toString().slice(0, MAX_CONTEXT).trim();
  if (!phrase) return NextResponse.json({ error: "phrase required" }, { status: 400 });

  const isSummary = /^summar(i[sz]e|y)\b/i.test(phrase);
  const user = context ? `Phrase: ${phrase}\n\nContext paragraph: ${context}` : `Phrase: ${phrase}`;

  try {
    const { content } = await chatCompletion({
      apiKey,
      model: "anthropic/claude-haiku-4.5",
      temperature: 0.2,
      maxTokens: isSummary ? 400 : 250,
      appName: "Reader",
      referer: process.env.OPENROUTER_REFERER || "",
      messages: [
        { role: "system", content: isSummary ? SUMMARY_SYSTEM : SYSTEM },
        { role: "user", content: user },
      ],
    });
    return NextResponse.json({ content: (content || "").trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ai error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
