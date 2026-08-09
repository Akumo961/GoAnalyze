import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "GoAnalyze Government",
  description: "Government-grade AI document intelligence console"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

