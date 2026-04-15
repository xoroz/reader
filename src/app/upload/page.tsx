"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Progress from "@/components/Progress";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

type Phase = "idle" | "uploading" | "extracting" | "error";

type UploadResult = { id: string; duplicate?: false } | { duplicate: true; existingId: string; title: string | null };

export default function UploadPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const router = useRouter();

  function xhrUpload(file: File): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BP}/api/upload`);
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        const body = xhr.response;
        if (xhr.status === 409 && body?.error === "duplicate" && body?.existingId) {
          resolve({ duplicate: true, existingId: body.existingId, title: body.title ?? null });
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300 && body?.id) {
          resolve({ id: body.id });
          return;
        }
        reject(new Error(body?.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(fd);
    });
  }

  async function onFile(f: File) {
    setPhase("uploading"); setStage(`Uploading ${f.name}`); setPct(0); setErrMsg("");
    try {
      const res = await xhrUpload(f);
      if ("duplicate" in res && res.duplicate) {
        router.push(`/?dup=${res.existingId}`);
        return;
      }
      const id = (res as { id: string }).id;
      setPhase("extracting"); setStage("Preparing"); setPct(0);
      for (let i = 0; i < 600; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const s = await fetch(`${BP}/api/books/${id}`).then((r) => r.json());
        if (s.status === "duplicate" && s.duplicate_of) {
          router.push(`/?dup=${s.duplicate_of}`);
          return;
        }
        if (s.status === "ready") { router.push(`/?new=${id}`); return; }
        if (s.status === "failed") throw new Error(s.error || "Extraction failed");
        setStage(s.status_detail || "Extracting");
        setPct(Number(s.progress_pct || 0));
      }
      throw new Error("Extraction timed out");
    } catch (e: any) {
      setPhase("error"); setErrMsg(e.message);
    }
  }

  return (
    <main className="app-shell">
      <header style={{ display: "flex", alignItems: "center", gap: "var(--m3-space-4)", padding: "var(--m3-space-4) var(--m3-space-5)", maxWidth: 960, margin: "0 auto", width: "100%" }}>
        <a href={BP} className="btn-ghost">← Library</a>
        <h1 style={{ font: "var(--m3-title-lg)" }}>Upload</h1>
      </header>

      {phase === "idle" ? (
        <div className="upload-box">
          <p style={{ font: "var(--m3-body-lg)", marginBottom: "var(--m3-space-4)" }}>
            PDF (text-layer), EPUB, DOCX, TXT, or Markdown.
          </p>
          <label className="upload-btn">
            Choose file
            <input type="file" accept=".pdf,.epub,.docx,.txt,.md,.markdown" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          </label>
        </div>
      ) : null}

      {phase !== "idle" ? (
        <div style={{ maxWidth: 520, margin: "var(--m3-space-7) auto", padding: "var(--m3-space-6)", borderRadius: "var(--m3-shape-lg)", border: "1px solid var(--m3-outline-variant)", background: "var(--m3-surface-container-low)" }}>
          <div style={{ font: "var(--m3-title-md)", marginBottom: "var(--m3-space-4)" }}>
            {phase === "uploading" ? "Uploading your book" : phase === "extracting" ? "Converting with AI" : "Something went wrong"}
          </div>
          {phase !== "error" ? (
            <Progress pct={pct} label={stage || "Working"} indeterminate={phase === "extracting" && pct === 0} />
          ) : (
            <div style={{ color: "var(--m3-error)", font: "var(--m3-body-md)", marginBottom: "var(--m3-space-3)" }}>{errMsg}</div>
          )}
          {phase === "error" ? (
            <div style={{ marginTop: "var(--m3-space-3)", display: "flex", gap: "var(--m3-space-2)" }}>
              <button className="btn-primary" onClick={() => { setPhase("idle"); setPct(0); }}>Try again</button>
              <a href={BP} className="btn-ghost">Back to library</a>
            </div>
          ) : (
            <p style={{ font: "var(--m3-body-sm)", color: "var(--m3-on-surface-variant)", marginTop: "var(--m3-space-3)" }}>
              {phase === "uploading" ? "Your file is being transferred to the server." : "Your book is being parsed, cleaned up, and structured into chapters. This may take a minute for longer texts."}
            </p>
          )}
        </div>
      ) : null}
    </main>
  );
}
