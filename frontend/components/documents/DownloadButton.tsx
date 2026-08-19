"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { documentsApi } from "@/lib/api";

export function DownloadButton({
  documentId,
  filename,
  className = "btn btnSm"
}: {
  documentId: string;
  filename?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const blob = await documentsApi.download(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || documentId;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button className={className} onClick={handleDownload} disabled={busy} aria-label="Download document">
        {busy ? <Loader2 size={13} className="spin" /> : <Download size={13} />} Download
      </button>
      {error && <span className="fieldError">{error}</span>}
    </span>
  );
}
