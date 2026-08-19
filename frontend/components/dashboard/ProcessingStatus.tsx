import Link from "next/link";
import { Workflow } from "lucide-react";
import { GapNote } from "@/components/ui/States";

/**
 * BACKEND GAP: there is no endpoint that reports aggregate processing
 * status across documents (e.g. "N pending / N completed / N failed").
 * `POST /v1/documents/{id}/process` only returns the result for a single
 * document, synchronously, and isn't a queryable queue. Rather than invent
 * numbers, this panel explains the gap and links to where processing can
 * actually be triggered and inspected today.
 */
export function ProcessingStatus() {
  return (
    <div className="card">
      <div className="cardHeader">
        <h2>Processing Status</h2>
        <Workflow size={16} color="var(--muted-2)" />
      </div>
      <GapNote>
        No endpoint reports aggregate processing status yet. Recommended:{" "}
        <code className="mono">GET /v1/documents/processing-status</code> returning per-stage
        counts. See FRONTEND_BACKEND_GAPS.md.
      </GapNote>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        You can trigger and inspect processing for an individual document from its{" "}
        <Link href="/documents">document page</Link>.
      </p>
    </div>
  );
}
