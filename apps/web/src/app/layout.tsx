import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/lib";
import { ToastProvider } from "@/components/Toast";
import { Header, Footer } from "@/components";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "QuickLink - URL Shortener",
  description: "Production-ready URL shortener platform",
  keywords: ["url shortener", "link shortener", "short links", "analytics"],
  authors: [{ name: "QuickLink" }],
  openGraph: {
    title: "QuickLink - URL Shortener",
    description: "Fast, reliable URL shortening with powerful analytics",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen flex flex-col bg-gray-50`}>
        <Providers>
          <ToastProvider>
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
