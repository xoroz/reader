"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { apiFetch } from "@/lib/csrf-client";

// Inline Markdown renderer for AI-generated body text (summary, notes).
// Handles **bold**, __bold__, *italic*, _italic_, `code`, and [text](url).
// Everything else is rendered as plain text. Keep tiny — this is not a full MD parser.
const INLINE_MD_RE = /(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(`[^`\n]+`)|(\[[^\]]+\]\([^)]+\))/g;
function renderInlineMd(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_MD_RE.lastIndex = 0;
  while ((m = INLINE_MD_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**") && tok.endsWith("**")) parts.push(<strong key={parts.length}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("__") && tok.endsWith("__")) parts.push(<strong key={parts.length}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("*") && tok.endsWith("*")) parts.push(<em key={parts.length}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("_") && tok.endsWith("_")) parts.push(<em key={parts.length}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("`") && tok.endsWith("`")) parts.push(<code key={parts.length}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (lm) parts.push(<a key={parts.length} href={lm[2]} target="_blank" rel="noopener noreferrer">{renderInlineMd(lm[1])}</a>);
      else parts.push(tok);
    }
    last = INLINE_MD_RE.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Returns { tag, content } for a paragraph: if it starts with Markdown heading
// syntax (`# ...`) or list marker (`- `, `* `), strip the marker so callers
// can render a proper heading / dedented paragraph. Otherwise returns the
// paragraph unchanged as a 'p'.
function classifyParagraph(raw: string): { tag: "h2" | "h3" | "h4" | "li" | "p"; content: string; marker?: string } {
  const t = raw.trim();
  const h = /^(#{1,6})\s+(.*)$/.exec(t);
  if (h) {
    const level = h[1].length;
    const tag = (level <= 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
    return { tag, content: h[2].trim() };
  }
  const ul = /^[*\u2022\-]\s+(.*)$/.exec(t);
  if (ul) return { tag: "li", content: ul[1].trim(), marker: "\u2022" };
  const ol = /^(\d+)[.)]\s+(.*)$/.exec(t);
  if (ol) return { tag: "li", content: ol[2].trim(), marker: ol[1] + "." };
  return { tag: "p", content: raw };
}

import PrefsSheet, { type Prefs, DEFAULT_PREFS } from "./PrefsSheet";
import AudioPlayer, { type Voice } from "./AudioPlayer";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

type Chapter = { idx: number; title: string | null; text: string };

export default function Reader({
  bookId,
  title,
  author,
  chapters,
  initialPrefs,
  initialProgress,
  alreadyPrompted,
}: {
  bookId: string;
  title: string | null;
  author: string | null;
  chapters: Chapter[];
  initialPrefs: Partial<Prefs>;
  initialProgress: { chapter_idx: number; paragraph_idx: number };
  /**
   * True when the server has already recorded finished_prompted_at for this
   * book — suppresses the "Archive?" dialog so we don't nag every reopen.
   */
  alreadyPrompted?: boolean;
}) {
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULT_PREFS, ...initialPrefs });
  const [chapterIdx, setChapterIdx] = useState<number>(clamp(initialProgress.chapter_idx, 0, chapters.length - 1));
  const [pageIdx, setPageIdx] = useState<number>(0);
  const [pageCount, setPageCount] = useState<number>(1);
  const [scrollPct, setScrollPct] = useState<number>(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [ttsOn, setTtsOn] = useState(false);
  const [activePara, setActivePara] = useState<number | null>(null);
  const [activeFrac, setActiveFrac] = useState<number>(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  // "You just finished this book — archive it?" dialog. We keep a session
  // guard (`suppressFinish`) so the dialog doesn't re-open inside the same
  // mount once the user has answered; `alreadyPrompted` suppresses it across
  // sessions (server-side finished_prompted_at).
  const [finishOpen, setFinishOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [suppressFinish, setSuppressFinish] = useState<boolean>(!!alreadyPrompted);
  const chromeTimerRef = useRef<number | null>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const paragraphIdxRef = useRef<number>(initialProgress.paragraph_idx || 0);
  const pendingRestoreRef = useRef<number | null>(initialProgress.paragraph_idx > 0 ? initialProgress.paragraph_idx : null);
  // Ref on the button that opens the TOC modal, so we can restore focus on close.
  const tocTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Close TOC on Escape and restore focus to the button that opened it.
  useEffect(() => {
    if (!tocOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); setTocOpen(false); } }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // When the effect tears down (tocOpen flipped to false), put focus back.
      tocTriggerRef.current?.focus();
    };
  }, [tocOpen]);

  useEffect(() => {
    const b = document.body;
    b.dataset.theme = prefs.theme;
    b.dataset.justify = String(prefs.justify);
    b.dataset.hyphenate = String(prefs.hyphenate);
    b.dataset.mode = prefs.mode;
    b.dataset.tts = String(ttsOn);
    const r = document.documentElement.style;
    r.setProperty("--reader-font-size", prefs.fontSize + "px");
    r.setProperty("--reader-line-height", String(prefs.lineHeight));
    // Resolve `measure` to a px value using the paragraph font's "0" width.
    // `ch` resolves at each element's own font-size, so larger headings would
    // expand past the body column and break left-edge alignment when centered.
    const chPx = (() => {
      try {
        const ctx = document.createElement("canvas").getContext("2d");
        if (ctx) { ctx.font = `${prefs.fontSize}px ${prefs.font}`; return ctx.measureText("0").width; }
      } catch {}
      return prefs.fontSize * 0.5;
    })();
    r.setProperty("--reader-measure", `${prefs.measure * chPx}px`);
    r.setProperty("--reader-margins", prefs.margins + "rem");
    r.setProperty("--reader-serif", prefs.font);
  }, [prefs, ttsOn]);

  const computePages = useCallback(() => {
    const el = columnRef.current;
    if (!el || prefs.mode !== "paginated") return;
    const pages = Math.max(1, Math.ceil(el.scrollWidth / el.clientWidth));
    setPageCount(pages);
    setPageIdx((p) => Math.min(p, pages - 1));
  }, [prefs.mode]);

  useEffect(() => {
    computePages();
    const ro = new ResizeObserver(computePages);
    if (columnRef.current) ro.observe(columnRef.current);
    window.addEventListener("resize", computePages);
    return () => { ro.disconnect(); window.removeEventListener("resize", computePages); };
  }, [computePages, chapterIdx, prefs]);

  // Auto-hide top+bottom chrome after idle; wake on any interaction.
  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimerRef.current) window.clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = window.setTimeout(() => {
      if (!sheetOpen && !tocOpen) setChromeVisible(false);
    }, 2800);
  }, [sheetOpen, tocOpen]);
  useEffect(() => {
    wakeChrome();
    const guarded = (e: Event) => {
      // Clicks inside the reader body area toggle the chrome explicitly via
      // the onClick below, so don't let them trigger the global wake.
      const t = e.target as Node | null;
      if (t && columnRef.current?.contains(t)) return;
      wakeChrome();
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart", "wheel", "mousemove"];
    events.forEach((e) => window.addEventListener(e, guarded as any, { passive: true } as any));
    return () => {
      events.forEach((e) => window.removeEventListener(e, wakeChrome as any));
      if (chromeTimerRef.current) window.clearTimeout(chromeTimerRef.current);
    };
  }, [wakeChrome]);

  useEffect(() => {
    if (prefs.mode !== "paginated") return;
    const el = columnRef.current;
    if (!el) return;
    const gap = parsePx(getComputedStyle(el).columnGap || "0");
    el.scrollTo({ left: pageIdx * (el.clientWidth + gap), behavior: "auto" });
  }, [pageIdx, chapterIdx, prefs]);

  useEffect(() => {
    if (prefs.mode !== "scroll") return;
    const el = columnRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setScrollPct(max > 0 ? Math.round((el.scrollTop / max) * 100) : 0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [prefs.mode, chapterIdx]);

  // Track the first visible paragraph for resume
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const paras = el.querySelectorAll<HTMLElement>("p[data-p-idx]");
    if (!paras.length) return;
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting).map(e => Number((e.target as HTMLElement).dataset.pIdx));
      if (visible.length) paragraphIdxRef.current = Math.min(...visible);
    }, { root: el, threshold: 0.01 });
    paras.forEach(p => io.observe(p));
    return () => io.disconnect();
  }, [chapterIdx, prefs.mode]);

  // Restore saved paragraph position once layout is ready
  useEffect(() => {
    const target = pendingRestoreRef.current;
    if (target == null) return;
    const el = columnRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      const p = el.querySelector<HTMLElement>(`p[data-p-idx="${target}"]`);
      if (!p) { pendingRestoreRef.current = null; return; }
      if (prefs.mode === "scroll") {
        el.scrollTo({ top: p.offsetTop - 16, behavior: "auto" });
      } else {
        const gap = parsePx(getComputedStyle(el).columnGap || "0");
        const pageW = el.clientWidth + gap;
        const x = p.offsetLeft;
        const page = Math.max(0, Math.floor(x / pageW));
        setPageIdx(page);
      }
      pendingRestoreRef.current = null;
    }, 50);
    return () => clearTimeout(t);
  }, [chapterIdx, pageCount, prefs.mode, prefs.fontSize, prefs.lineHeight, prefs.measure, prefs.margins, prefs.font]);

  // Keep active paragraph in view when TTS is driving reading position
  useEffect(() => {
    if (!ttsOn || activePara == null) return;
    const el = columnRef.current?.querySelector<HTMLElement>(`[data-p-idx="${activePara}"]`);
    if (!el) return;
    if (prefs.mode === "scroll") {
      const parent = columnRef.current!;
      const pRect = parent.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const relTop = eRect.top - pRect.top;
      if (relTop < 60 || relTop > pRect.height - 160) {
        parent.scrollTo({ top: parent.scrollTop + relTop - pRect.height * 0.3, behavior: "smooth" });
      }
    } else {
      const parent = columnRef.current!;
      const gap = parsePx(getComputedStyle(parent).columnGap || "0");
      const page = Math.max(0, Math.floor(el.offsetLeft / (parent.clientWidth + gap)));
      if (page !== pageIdx) setPageIdx(page);
    }
  }, [activePara, ttsOn, prefs.mode, pageIdx]);

  // Persist progress (chapter + paragraph)
  useEffect(() => {
    const t = setTimeout(() => {
      apiFetch(`${BP}/api/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, chapter_idx: chapterIdx, paragraph_idx: paragraphIdxRef.current }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [bookId, chapterIdx, pageIdx, scrollPct]);

  function next() {
    if (prefs.mode === "paginated") {
      if (pageIdx + 1 < pageCount) setPageIdx(pageIdx + 1);
      else if (chapterIdx + 1 < chapters.length) { setChapterIdx(chapterIdx + 1); setPageIdx(0); }
    } else {
      if (chapterIdx + 1 < chapters.length) { setChapterIdx(chapterIdx + 1); columnRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }
    }
  }
  function prev() {
    if (prefs.mode === "paginated") {
      if (pageIdx > 0) setPageIdx(pageIdx - 1);
      else if (chapterIdx > 0) { setChapterIdx(chapterIdx - 1); setPageIdx(0); }
    } else {
      if (chapterIdx > 0) { setChapterIdx(chapterIdx - 1); columnRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (sheetOpen || tocOpen) return;
      if (prefs.mode === "paginated") {
        if (e.key === "ArrowRight" || e.key === " " || e.key === "j" || e.key === "PageDown") { e.preventDefault(); next(); }
        else if (e.key === "ArrowLeft" || e.key === "k" || e.key === "PageUp") { e.preventDefault(); prev(); }
      } else {
        const el = columnRef.current;
        if (!el) return;
        if (e.key === " " || e.key === "PageDown") { e.preventDefault(); el.scrollBy({ top: el.clientHeight * 0.9, behavior: "smooth" }); }
        else if (e.key === "PageUp") { e.preventDefault(); el.scrollBy({ top: -el.clientHeight * 0.9, behavior: "smooth" }); }
        else if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); el.scrollBy({ top: 60, behavior: "smooth" }); }
        else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); el.scrollBy({ top: -60, behavior: "smooth" }); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.mode, sheetOpen, tocOpen, pageIdx, pageCount, chapterIdx, chapters.length]);

  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) { const t = e.changedTouches[0]; touch.current = { x: t.clientX, y: t.clientY, t: Date.now() }; }
  function onTouchEnd(e: React.TouchEvent) {
    if (!touch.current || prefs.mode !== "paginated") { touch.current = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 2) { if (dx < 0) next(); else prev(); }
    touch.current = null;
  }

  const chapter = chapters[chapterIdx];
  const paragraphs = useMemo(() => chapter.text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean), [chapter.text]);

  const isLastChapter = chapterIdx === chapters.length - 1;

  // Detect "finished" — user reached the tail of the last chapter (within 3
  // paragraphs of the end, matching the spec) OR paginated mode is on the
  // last page of the last chapter. If we haven't already prompted, open the
  // archive dialog. We watch pageIdx / scrollPct so both reading modes fire.
  useEffect(() => {
    if (suppressFinish || finishOpen) return;
    if (!isLastChapter) return;
    const visibleEnd = paragraphIdxRef.current >= Math.max(0, paragraphs.length - 3);
    const paginatedEnd = prefs.mode === "paginated" && pageIdx >= Math.max(0, pageCount - 1);
    const scrollEnd = prefs.mode === "scroll" && scrollPct >= 92;
    if (visibleEnd || paginatedEnd || scrollEnd) {
      setFinishOpen(true);
    }
  }, [isLastChapter, pageIdx, pageCount, scrollPct, paragraphs.length, prefs.mode, suppressFinish, finishOpen]);

  // Persist the fact we've already asked. Runs when the user picks Yes / No
  // / dismiss, and once `alreadyPrompted` was already true at mount time.
  async function markPrompted() {
    setSuppressFinish(true);
    try {
      await apiFetch(`${BP}/api/books/${bookId}/finish-prompt`, { method: "POST" });
    } catch { /* best-effort */ }
  }

  async function onArchive() {
    setArchiveBusy(true);
    try {
      const res = await apiFetch(`${BP}/api/books/${bookId}/archive`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      // markPrompted is implicit: archiving sets finished_prompted_at in the
      // same tx? No — we still want to record the prompt shown regardless.
      await markPrompted();
      // Leave the reader — back to library.
      window.location.href = BP;
    } catch (err: any) {
      alert(`Archive failed: ${err.message || err}`);
      setArchiveBusy(false);
    }
  }

  function onDismissFinish() {
    setFinishOpen(false);
    markPrompted();
  }

  const progressPct = prefs.mode === "paginated"
    ? (chapters.length > 1 ? Math.round(((chapterIdx + (pageIdx / Math.max(1, pageCount - 1))) / chapters.length) * 100) : Math.round((pageIdx / Math.max(1, pageCount - 1)) * 100))
    : (chapters.length > 1 ? Math.round(((chapterIdx + scrollPct / 100) / chapters.length) * 100) : scrollPct);

  return (
    <div className="reader-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className={`top-chrome${chromeVisible ? "" : " chrome-hidden"}`}>
        <a href={BP} className="chrome-btn" title="Library">←</a>
        <div style={{ flex: 1, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ fontWeight: 500, color: "var(--reader-fg)" }}>{title || "Untitled"}</span>
          {chapter.title ? <span> · {chapter.title}</span> : null}
        </div>
        <button className="chrome-btn" onClick={() => setTtsOn((v) => !v)} title="Listen" aria-label={ttsOn ? "Stop text-to-speech" : "Start text-to-speech"} aria-pressed={ttsOn} style={{ fontWeight: ttsOn ? 600 : 400 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ verticalAlign: "middle" }} aria-hidden="true"><path d="M3 10v4a1 1 0 0 0 1 1h3l4 3a1 1 0 0 0 1.6-.8V6.8A1 1 0 0 0 11 6l-4 3H4a1 1 0 0 0-1 1z"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/><path d="M18.5 5.5a8 8 0 0 1 0 13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
        </button>
        <button ref={tocTriggerRef} className="chrome-btn" onClick={() => setTocOpen(true)} title="Contents" aria-label="Open table of contents">☰</button>
        <button className="chrome-btn" onClick={() => setSheetOpen(true)} title="Typography" aria-label="Open typography preferences">Aa</button>
      </div>

      <div
        ref={columnRef}
        className={prefs.mode === "paginated" ? "reader-column" : "reader-scroll"}
        aria-label="reader"
        onClick={(e) => {
          const cls = (e.target as HTMLElement).className || "";
          if (typeof cls === "string" && (cls.includes("tap-left") || cls.includes("tap-right"))) return;
          if (chromeTimerRef.current) window.clearTimeout(chromeTimerRef.current);
          setChromeVisible((v) => !v);
        }}
      >
        {chapter.title ? <h2>{chapter.title}</h2> : null}
        {(/^(table of )?contents?$/i.test(chapter.title || "")) ? (
          <ul className="reader-toc">
            {(() => {
              // Flatten paragraphs → lines, splitting only on real line breaks
              // or bullet separators. Do NOT split on "(?<=\.)\s+" — that would
              // turn "1. The Self-Image" into two entries ("1." + title).
              const rawLines = paragraphs
                .flatMap((p) => p.split(/\n+|\s\u2022\s/))
                .map((l) => l.trim())
                .filter(Boolean);
              // Defensive fallback: merge a dangling "N." / "N" line into the
              // next non-empty line (handles older cached TOCs where the number
              // ended up on its own paragraph before this fix shipped).
              const lines: string[] = [];
              for (let k = 0; k < rawLines.length; k++) {
                const cur = rawLines[k];
                if (/^\d{1,3}\.?$/.test(cur) && k + 1 < rawLines.length) {
                  lines.push(`${cur.replace(/\.?$/, ".")} ${rawLines[k + 1]}`);
                  k++;
                } else {
                  lines.push(cur);
                }
              }
              // Normalizer for fuzzy matching TOC entry → chapter title.
              const norm = (s: string) =>
                s
                  .toLowerCase()
                  .replace(/^\s*(chapter|ch\.?)\s*\d+[:.\s]*/i, "")
                  .replace(/^\s*\d+[.)]\s*/, "")
                  .replace(/[^a-z0-9]+/g, " ")
                  .trim();
              return lines.map((line, i) => {
                // Strip leading "[text](#ch-N)" markdown link wrapper if present.
                const mdLink = /^\[([^\]]+)\]\(#ch-(\d+)\)$/.exec(line);
                let display = line;
                let explicitTarget = -1;
                if (mdLink) {
                  display = mdLink[1];
                  const n = Number(mdLink[2]);
                  // Resolve "#ch-N" as 1-based chapter position in body chapters.
                  const bodyStart = chapters.findIndex(
                    (c) => !/^(title|summary|(table of )?contents?)$/i.test(c.title || "")
                  );
                  if (bodyStart >= 0) explicitTarget = bodyStart + (n - 1);
                }
                // Strip trailing page numbers / dot leaders.
                const cleaned = display
                  .replace(/\s*\.{2,}\s*\d+\s*$/, "")
                  .replace(/\s+\d+\s*$/, "")
                  .trim();
                const entryN = norm(cleaned);
                let target = explicitTarget;
                if (target < 0 && entryN) {
                  target = chapters.findIndex((c, idx) => {
                    if (idx <= chapterIdx || !c.title) return false;
                    const titleN = norm(c.title);
                    if (!titleN) return false;
                    return (
                      titleN === entryN ||
                      titleN.startsWith(entryN.slice(0, Math.min(entryN.length, 40))) ||
                      entryN.startsWith(titleN.slice(0, Math.min(titleN.length, 40)))
                    );
                  });
                }
                const onClick = () => {
                  if (target >= 0) {
                    pendingRestoreRef.current = null;
                    paragraphIdxRef.current = 0;
                    setChapterIdx(target);
                    setPageIdx(0);
                    columnRef.current?.scrollTo({ top: 0 });
                  }
                };
                return (
                  <li key={i} data-p-idx={i}>
                    {target >= 0 ? (
                      <a href="#" onClick={(e) => { e.preventDefault(); onClick(); }}>{cleaned || line}</a>
                    ) : (
                      <span>{cleaned || line}</span>
                    )}
                  </li>
                );
              });
            })()}
          </ul>
        ) : paragraphs.map((p, i) => {
          const { tag, content, marker } = classifyParagraph(p);
          const cls = ttsOn && activePara === i ? "tts-para-active" : undefined;
          if (tag === "h2") return <h2 key={i} data-p-idx={i} className={cls}>{renderInlineMd(content)}</h2>;
          if (tag === "h3") return <h3 key={i} data-p-idx={i} className={cls}>{renderInlineMd(content)}</h3>;
          if (tag === "h4") return <h4 key={i} data-p-idx={i} className={cls}>{renderInlineMd(content)}</h4>;
          if (tag === "li") return (
            <p key={i} data-p-idx={i} className={`reader-li ${cls ?? ""}`.trim()} style={{ hyphens: prefs.hyphenate ? "auto" : "manual", WebkitHyphens: prefs.hyphenate ? "auto" : "manual" } as React.CSSProperties}>
              <span className="reader-li-marker">{marker}</span>
              <span>{renderInlineMd(content)}</span>
            </p>
          );
          return (
            <p key={i} data-p-idx={i} className={cls} style={{ hyphens: prefs.hyphenate ? "auto" : "manual", WebkitHyphens: prefs.hyphenate ? "auto" : "manual" } as React.CSSProperties}>
              {renderInlineMd(content)}
              {ttsOn && activePara === i ? (
                <span className="tts-para-progress" aria-hidden style={{ ["--frac" as any]: activeFrac.toFixed(3) }} />
              ) : null}
            </p>
          );
        })}
        {prefs.mode === "scroll" && chapterIdx + 1 < chapters.length ? (
          <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--reader-muted)", fontFamily: "var(--reader-sans)", fontSize: "0.85rem" }}>
            <button className="btn-ghost" onClick={next}>Next chapter →</button>
          </div>
        ) : null}
      </div>

      {prefs.mode === "paginated" ? (
        <>
          <div className="tap-left" onClick={prev} aria-hidden />
          <div className="tap-right" onClick={next} aria-hidden />
        </>
      ) : null}

      <div className={`bottom-chrome${chromeVisible ? "" : " chrome-hidden"}`}>
        <button
          className="chrome-btn"
          onClick={() => { if (chapterIdx > 0) { setChapterIdx(chapterIdx - 1); setPageIdx(0); columnRef.current?.scrollTo({ top: 0 }); } }}
          disabled={chapterIdx === 0}
          title="Previous chapter"
          aria-label="Previous chapter"
        >⏮</button>
        <button className="chrome-btn" onClick={prev} title="Previous page" aria-label="Previous page">‹</button>
        <div className="bottom-chrome-meta">
          <span>Ch {chapterIdx + 1}/{chapters.length}</span>
          {prefs.mode === "paginated" ? <><span style={{ margin: "0 0.5rem" }}>·</span><span>p {pageIdx + 1}/{pageCount}</span></> : null}
          <span style={{ margin: "0 0.5rem" }}>·</span>
          <span>{progressPct}%</span>
        </div>
        <button className="chrome-btn" onClick={next} title="Next page" aria-label="Next page">›</button>
        <button
          className="chrome-btn"
          onClick={() => { if (chapterIdx + 1 < chapters.length) { setChapterIdx(chapterIdx + 1); setPageIdx(0); columnRef.current?.scrollTo({ top: 0 }); } }}
          disabled={chapterIdx + 1 >= chapters.length}
          title="Next chapter"
          aria-label="Next chapter"
        >⏭</button>
      </div>

      {ttsOn ? (
        <AudioPlayer
          bookId={bookId}
          chapterIdx={chapterIdx}
          chapterCount={chapters.length}
          startParagraph={paragraphIdxRef.current}
          onChapterChange={(i) => { setChapterIdx(i); setPageIdx(0); setActivePara(null); setActiveFrac(0); }}
          onActiveParagraph={(p, f) => { setActivePara(p); setActiveFrac(f); }}
          initialVoice={(prefs.ttsVoice || "onyx") as Voice}
          onPrefs={(p) => setPrefs((cur) => ({ ...cur, ttsVoice: p.voice }))}
        />
      ) : null}

      {sheetOpen ? <PrefsSheet prefs={prefs} onChange={setPrefs} onClose={() => setSheetOpen(false)} /> : null}

      {tocOpen ? (
        <div className="sheet-overlay" onClick={() => setTocOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Table of contents" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "70vh", overflow: "auto" }}>
            <h3>Contents</h3>
            <div style={{ fontFamily: "var(--reader-serif)" }}>
              {chapters.map((c, i) => (
                <div key={c.idx} className="row" style={{ cursor: "pointer", padding: "0.5rem 0", borderBottom: "1px solid color-mix(in srgb, var(--reader-fg) 8%, transparent)" }}
                  onClick={() => { pendingRestoreRef.current = null; paragraphIdxRef.current = 0; setChapterIdx(i); setPageIdx(0); columnRef.current?.scrollTo({ top: 0 }); setTocOpen(false); }}>
                  <span style={{ fontWeight: i === chapterIdx ? 600 : 400 }}>{c.title || `Chapter ${i + 1}`}</span>
                  <span style={{ color: "var(--reader-muted)", fontSize: "0.8rem" }}>{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {finishOpen ? (
        <div className="sheet-overlay" onClick={onDismissFinish}>
          <div
            className="sheet"
            role="alertdialog"
            aria-modal="true"
            aria-label="Finished book"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "26rem" }}
          >
            <h3 style={{ marginTop: 0 }}>You finished this book.</h3>
            <p style={{ fontFamily: "var(--reader-serif)", color: "var(--reader-fg)", lineHeight: 1.5 }}>
              Archive <strong>{title || "Untitled"}</strong>? Archived books are
              hidden from your main library but stay accessible under
              <em> Library → Archived</em>.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1rem", flexWrap: "wrap" }}>
              <button className="btn-ghost" onClick={onDismissFinish} disabled={archiveBusy}>Not now</button>
              <button className="btn-primary" onClick={onArchive} disabled={archiveBusy}>
                {archiveBusy ? "Archiving…" : "Archive"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function parsePx(s: string) { return parseFloat(s) || 0; }
