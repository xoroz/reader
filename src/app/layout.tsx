import "./globals.css";
import type { Metadata, Viewport } from "next";
import SWRegister from "@/components/SWRegister";

export const metadata: Metadata = {
  title: "Reader",
  description: "Private reading, beautifully typeset",
  manifest: "/Reader/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Reader" },
};

export const viewport: Viewport = {
  themeColor: "#FBF7F1",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

// Inline script ensures the chosen theme (paper / sepia / dark) is applied
// synchronously before the first paint, preventing a flash of the default
// "paper" palette on sessions that had picked another theme.
//
// Legacy values are coerced: "light" → "paper", "solarized" → "sepia".
const THEME_INLINE = `
(function() {
  try {
    var saved = localStorage.getItem('reader-theme');
    if (saved === 'light') saved = 'paper';
    if (saved === 'solarized') saved = 'sepia';
    if (saved !== 'paper' && saved !== 'sepia' && saved !== 'dark') saved = 'paper';
    document.documentElement.setAttribute('data-theme', saved);
    document.documentElement.style.colorScheme = saved === 'dark' ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'paper');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-app="reader" data-theme="paper">
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INLINE }} />
      </head>
      <body>
        {children}
        <SWRegister />
      </body>
    </html>
  );
}
