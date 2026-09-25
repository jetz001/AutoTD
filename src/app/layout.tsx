import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://autotd.pages.dev"),
  title: "AutoTD — Autonomous Quant Trading Terminal",
  description: "Enterprise Bitget Spot Autonomous Quant Trading Terminal with Multi-Model AI Decision Engine.",
  openGraph: {
    title: "AutoTD — Autonomous Quant Trading Terminal",
    description: "Enterprise Bitget Spot Autonomous Quant Trading Terminal with Multi-Model AI Decision Engine.",
    type: "website",
    url: "https://autotd.pages.dev",
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoTD — Autonomous Quant Trading Terminal",
    description: "Enterprise Bitget Spot Autonomous Quant Trading Terminal with Multi-Model AI Decision Engine.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased font-sans`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
