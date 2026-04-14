"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function UploadBanner({ kind, title }: { kind: "new" | "dup"; title: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace("/"), 6000);
    return () => clearTimeout(t);
  }, [router]);

  const displayTitle = (title || "Untitled").trim();
  const isNew = kind === "new";
  return (
    <div
      role="status"
      className={`m3-banner ${isNew ? "m3-banner-success" : "m3-banner-warning"} m3-enter`}
      style={{
        maxWidth: 1200,
        margin: "0 auto var(--m3-space-3)",
        marginLeft: "auto",
        marginRight: "auto",
      }}
    >
      <span style={{ fontSize: "1.3rem", lineHeight: 1 }}>{isNew ? "✨" : "ℹ️"}</span>
      <span style={{ flex: 1 }}>
        {isNew ? (
          <><strong>Added to your library:</strong> “{displayTitle}”</>
        ) : (
          <><strong>Already in your library:</strong> “{displayTitle}”</>
        )}
      </span>
      <button
        onClick={() => router.replace("/")}
        className="m3-btn m3-btn-text"
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
