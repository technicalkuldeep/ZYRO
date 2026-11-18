import type { Metadata } from "next";
import { Shell } from "../components/shell";
import "./globals.css";
import "./premium.css";
import "./arena-expansion.css";
export const metadata: Metadata = {
  title: "ZYRO — Predict Freely. Settle Privately.",
  description:
    "A privacy-first Zcash testnet prediction market. Explore challenges and build forecasting instincts in the free ZYRO Arena.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
