import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "QuickLink - URL Shortener",
  description: "Production-ready URL shortener platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
