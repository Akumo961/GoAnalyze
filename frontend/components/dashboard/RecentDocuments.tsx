import Link from "next/link";
import { FileText } from "lucide-react";
import { ClassificationBadge } from "@/components/ui/Badges";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/States";
import { formatRelativeTime } from "@/lib/utils";
import type { SearchHit } from "@/lib/types";

export function RecentDocuments({
  status,
  hits,
  error,
  onRetry
}: {
  status: "idle" | "loading" | "success" | "error";
  hits: SearchHit[];
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="card">
      <div className="cardHeader">
        <h2>Recent Documents</h2>
        <Link href="/documents" className="btn btnSm">
          View all
        </Link>
      </div>
      {status === "loading" && <LoadingBlock label="Loading recent documents…" />}
      {status === "error" && <ErrorBlock error={error} onRetry={onRetry} />}
      {status === "success" && hits.length === 0 && (
        <EmptyBlock
          title="No documents yet"
          description="Upload your first document to see it appear here."
          action={
            <Link href="/documents/upload" className="btn btnPrimary btnSm">
              Upload a document
            </Link>
          }
        />
      )}
      {status === "success" && hits.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {hits.slice(0, 6).map((hit) => (
            <Link
              key={hit.document_id}
              href={`/documents/${hit.document_id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
                borderBottom: "1px solid var(--line)",
                textDecoration: "none",
                color: "inherit"
              }}
            >
              <FileText size={16} color="var(--muted-2)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="rowLink" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {hit.filename}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted-2)" }}>
                  {formatRelativeTime(hit.created_at)}
                </div>
              </div>
              <ClassificationBadge level={hit.classification} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
