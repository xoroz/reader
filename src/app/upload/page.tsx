"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Progress from "@/components/Progress";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

type Phase = "idle" | "uploading" | "extracting" | "error";

export default function UploadPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const router = useRouter();

  function xhrUpload(file: File): Promise<{ id: string }> {
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
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.id) resolve(xhr.response);
        else reject(new Error(xhr.response?.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(fd);
    });
  }

  async function onFile(f: File) {
    setPhase("uploading"); setStage(`Uploading ${f.name}`); setPct(0); setErrMsg("");
    try {
      const { id } = await xhrUpload(f);
      setPhase("extracting"); setStage("Preparing"); setPct(0);
      for (let i = 0; i < 600; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const s = await fetch(`${BP}/api/books/${id}`).then((r) => r.json());
        if (s.status === "ready") { router.push(`/book/${id}`); return; }
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
      <header style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1.25rem 1.5rem", maxWidth: 960, margin: "0 auto", width: "100%" }}>
        <a href={BP} className="btn-ghost">← Library</a>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Upload</h1>
      </header>

      {phase === "idle" ? (
        <div className="upload-box">
          <p style={{ fontFamily: "var(--reader-serif)", fontSize: "1.1rem", marginBottom: "1.2rem" }}>
            PDF (text-layer), EPUB, DOCX, TXT, or Markdown.
          </p>
          <label className="upload-btn">
            Choose file
            <input type="file" accept=".pdf,.epub,.docx,.txt,.md,.markdown" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          </label>
        </div>
      ) : null}

      {phase !== "idle" ? (
        <div style={{ maxWidth: 520, margin: "3rem auto", padding: "2rem", borderRadius: 16, border: "1px solid color-mix(in srgb, var(--reader-fg) 12%, transparent)", background: "color-mix(in srgb, var(--reader-fg) 2%, transparent)" }}>
          <div style={{ fontFamily: "var(--reader-serif)", fontSize: "1.1rem", marginBottom: "1.2rem", lineHeight: 1.4 }}>
            {phase === "uploading" ? "Uploading your book" : phase === "extracting" ? "Converting with AI" : "Something went wrong"}
          </div>
          {phase !== "error" ? (
            <Progress pct={pct} label={stage || "Working"} indeterminate={phase === "extracting" && pct === 0} />
          ) : (
            <div style={{ color: "#b91c1c", fontSize: "0.9rem", marginBottom: "1rem" }}>{errMsg}</div>
          )}
          {phase === "error" ? (
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
              <button className="btn-primary" onClick={() => { setPhase("idle"); setPct(0); }}>Try again</button>
              <a href={BP} className="btn-ghost">Back to library</a>
            </div>
          ) : (
            <p style={{ fontSize: "0.8rem", color: "var(--reader-muted)", marginTop: "1rem", lineHeight: 1.4 }}>
              {phase === "uploading" ? "Your file is being transferred to the server." : "Your book is being parsed, cleaned up, and structured into chapters. This may take a minute for longer texts."}
            </p>
          )}
        </div>
      ) : null}
    </main>
  );
}
