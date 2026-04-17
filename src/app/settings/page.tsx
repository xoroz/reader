import Link from "next/link";
import { q } from "@/lib/db";
import { requirePageEmail } from "@/lib/user";

export const dynamic = "force-dynamic";

type Item = { href: string; label: string; desc: string };

export default async function SettingsPage() {
  const email = await requirePageEmail();
  const archived = await q<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM books WHERE owner_email = $1 AND archived = true`,
    [email]
  );
  const archivedCount = archived[0]?.c ?? 0;

  const items: Item[] = [
    { href: "/search", label: "Search LibGen", desc: "Find books by title or author on libgen mirrors." },
    { href: "/opds-client", label: "OPDS catalogs", desc: "Browse external OPDS catalogs (Calibre, Standard Ebooks, Gutenberg…) and import into your library." },
    { href: "/settings/app-passwords", label: "App passwords", desc: "Create passwords for e-reader apps (KOReader, Thorium, Moon+ Reader) to read your library via OPDS." },
    { href: "/archived", label: `Archived books${archivedCount ? ` (${archivedCount})` : ""}`, desc: "Books you've finished or set aside." },
  ];

  return (
    <main className="app-shell">
      <header className="lib-header">
        <div className="hero lib-header-title">
          <h1 className="m3-brand-title">SETTINGS</h1>
          <div className="lib-header-sub">{email}</div>
        </div>
        <div className="lib-header-actions">
          <Link href="/" className="btn-ghost">← Library</Link>
          <a href="/Reader/api/auth/logout" className="btn-ghost">Sign out</a>
        </div>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "var(--m3-space-4, 16px) var(--m3-space-5, 24px)", width: "100%" }}>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((it) => (
            <li key={it.href}>
              <Link
                href={it.href}
                style={{
                  display: "block",
                  padding: "16px 20px",
                  borderRadius: 12,
                  background: "rgba(0,0,0,0.04)",
                  textDecoration: "none",
                  color: "inherit",
                  border: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{it.label}</div>
                <div style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.45 }}>{it.desc}</div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
