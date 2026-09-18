import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fantasy War Room",
  description: "Open-source fantasy football draft war room.",
};

/**
 * `viewport-fit=cover` lets the layout reach under the notch and home indicator; the war room
 * pays the insets back with env(safe-area-inset-*) on the header and the mobile action bar.
 * Zoom is deliberately not capped — a draft room read in a dim room needs it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1a1e25",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
