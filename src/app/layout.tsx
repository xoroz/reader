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
  themeColor: "#111111",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SWRegister />
      </body>
    </html>
  );
}
