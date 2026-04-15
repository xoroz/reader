"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
}: {
  bookId: string;
  title: string | null;
  author: string | null;
  chapters: Chapter[];
  initialPrefs: Partial<Prefs>;
  initialProgress: { chapter_idx: number; paragraph_idx: number };
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
  const chromeTimerRef = useRef<number | null>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const paragraphIdxRef = useRef<number>(initialProgress.paragraph_idx || 0);
  const pendingRestoreRef = useRef<number | null>(initialProgress.paragraph_idx > 0 ? initialProgress.paragraph_idx : null);

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
    r.setProperty("--reader-measure", prefs.measure + "ch");
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
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart", "wheel", "mousemove"];
    events.forEach((e) => window.addEventListener(e, wakeChrome as any, { passive: true } as any));
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
      fetch(`${BP}/api/progress`, {
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
  });

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
        <button className="chrome-btn" onClick={() => setTtsOn((v) => !v)} title="Listen" aria-pressed={ttsOn} style={{ fontWeight: ttsOn ? 600 : 400 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ verticalAlign: "middle" }}><path d="M3 10v4a1 1 0 0 0 1 1h3l4 3a1 1 0 0 0 1.6-.8V6.8A1 1 0 0 0 11 6l-4 3H4a1 1 0 0 0-1 1z"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/><path d="M18.5 5.5a8 8 0 0 1 0 13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
        </button>
        <button className="chrome-btn" onClick={() => setTocOpen(true)} title="Contents">☰</button>
        <button className="chrome-btn" onClick={() => setSheetOpen(true)} title="Typography">Aa</button>
      </div>

      <div ref={columnRef} className={prefs.mode === "paginated" ? "reader-column" : "reader-scroll"} aria-label="reader">
        {chapter.title ? <h2>{chapter.title}</h2> : null}
        {(/^(table of )?contents?$/i.test(chapter.title || "")) ? (
          <ul className="reader-toc">
            {paragraphs.flatMap((para, i) => {
              const lines = para.split(/\n+|\s\u2022\s|(?<=\.)\s+(?=[A-Z0-9])/).map(l => l.trim()).filter(Boolean);
              return lines.map((line, j) => {
                const cleaned = line.replace(/\s*\.{2,}\s*\d+\s*$/, "").replace(/\s+\d+\s*$/, "").trim();
                const target = chapters.findIndex((c, idx) => idx > chapterIdx && c.title && cleaned.toLowerCase().includes(c.title.toLowerCase().replace(/^chapter\s+\d+[:.\s]*/i, "").trim().slice(0, 40)));
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
                  <li key={`${i}-${j}`} data-p-idx={i}>
                    {target >= 0 ? (
                      <a href="#" onClick={(e) => { e.preventDefault(); onClick(); }}>{cleaned || line}</a>
                    ) : (
                      <span>{cleaned || line}</span>
                    )}
                  </li>
                );
              });
            })}
          </ul>
        ) : paragraphs.map((p, i) => (
          <p key={i} data-p-idx={i} className={ttsOn && activePara === i ? "tts-para-active" : undefined}>
            {p}
            {ttsOn && activePara === i ? (
              <span className="tts-para-progress" aria-hidden style={{ ["--frac" as any]: activeFrac.toFixed(3) }} />
            ) : null}
          </p>
        ))}
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
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "70vh", overflow: "auto" }}>
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
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function parsePx(s: string) { return parseFloat(s) || 0; }
