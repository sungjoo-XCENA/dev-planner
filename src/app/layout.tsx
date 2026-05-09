import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DEV FC Planner",
  description: "Team balancer and lineup planner for DEV FC.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        <script src="/match-record-widget.js" defer />
      </body>
    </html>
  );
}
