import type { ClassificationLevel } from "./types";

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso).getTime();
  if (Number.isNaN(date)) return iso;
  const diffMs = Date.now() - date;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function classificationLabel(level: ClassificationLevel | string): string {
  const map: Record<string, string> = {
    public: "Public",
    internal: "Internal",
    confidential: "Confidential",
    protected_b: "Protected B"
  };
  return map[level] ?? level;
}

export function riskBand(score: number | null | undefined): "low" | "medium" | "high" | "unknown" {
  if (score === null || score === undefined || Number.isNaN(score)) return "unknown";
  if (score < 0.34) return "low";
  if (score < 0.67) return "medium";
  return "high";
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function stageLabel(stage: string): string {
  return stage
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
