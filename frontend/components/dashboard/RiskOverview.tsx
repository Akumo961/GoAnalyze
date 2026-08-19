import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { GapNote } from "@/components/ui/States";

/**
 * BACKEND GAP: risk_score is only produced per-document as part of
 * `POST /v1/documents/{id}/process`'s synchronous response -- there's no
 * endpoint to list or aggregate risk scores across documents. This panel
 * says so instead of fabricating a portfolio-wide risk number.
 */
export function RiskOverview() {
  return (
    <div className="card">
      <div className="cardHeader">
        <h2>Risk Overview</h2>
        <AlertTriangle size={16} color="var(--muted-2)" />
      </div>
      <GapNote>
        No endpoint aggregates risk scores across documents. Recommended:{" "}
        <code className="mono">GET /v1/analytics/risk-summary</code>. See
        FRONTEND_BACKEND_GAPS.md.
      </GapNote>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        Per-document risk scores are available on each document&apos;s{" "}
        <Link href="/documents">Analysis page</Link> after processing.
      </p>
    </div>
  );
}
