import { classificationLabel, riskBand } from "@/lib/utils";
import type { ClassificationLevel } from "@/lib/types";

export function ClassificationBadge({ level }: { level: ClassificationLevel | string }) {
  return (
    <span className={`badge badge-classification-${level}`}>{classificationLabel(level)}</span>
  );
}

export function RiskBadge({ score }: { score: number | null | undefined }) {
  const band = riskBand(score);
  const kindMap = { low: "success", medium: "warning", high: "danger", unknown: "neutral" } as const;
  const labelMap = {
    low: "Low risk",
    medium: "Medium risk",
    high: "High risk",
    unknown: "Not scored"
  } as const;
  return (
    <span className={`badge badge-${kindMap[band]}`}>
      {labelMap[band]}
      {score !== null && score !== undefined ? ` · ${(score * 100).toFixed(0)}%` : ""}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const kind = ["completed", "success", "accepted", "ready"].includes(normalized)
    ? "success"
    : ["failed", "error", "rejected"].includes(normalized)
    ? "danger"
    : ["pending", "processing", "running"].includes(normalized)
    ? "warning"
    : "neutral";
  return <span className={`badge badge-${kind}`}>{status}</span>;
}
