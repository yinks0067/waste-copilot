import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { aiEnabled } from "@/src/briefing";

export const metadata: Metadata = {
  title: "Waste Copilot — Project B",
  description: "Cuts short-life food waste in grocery stores: smarter ordering, a daily reduce list and a Claude-written morning briefing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const ai = aiEnabled();
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="top">
            <Link href="/" className="logo">
              <span className="logo-mark">◐</span> Waste Copilot
            </Link>
            <span className={ai ? "pill" : "pill warn"} title={ai ? "Briefings are written by Claude" : "Set ANTHROPIC_API_KEY to have Claude write the briefing"}>
              {ai ? "Briefing: Claude" : "Offline mode: rule-based briefing"}
            </span>
          </header>
          {children}
          <footer>Demo store: 44 short-life lines, 8 weeks of trading (simulated). Money in GBP.</footer>
        </div>
      </body>
    </html>
  );
}
