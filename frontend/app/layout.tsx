import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "GoAnalyze | Government Document Intelligence",
  description: "Government-grade AI document intelligence platform"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
