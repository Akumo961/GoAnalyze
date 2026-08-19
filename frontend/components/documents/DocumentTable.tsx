import Link from "next/link";
import { FileText } from "lucide-react";
import { ClassificationBadge } from "@/components/ui/Badges";
import { DownloadButton } from "@/components/documents/DownloadButton";
import { formatDateTime } from "@/lib/utils";
import type { SearchHit } from "@/lib/types";

export function DocumentTable({ results }: { results: SearchHit[] }) {
  return (
    <div className="tableWrap">
      <table className="dataTable">
        <thead>
          <tr>
            <th>Document</th>
            <th>Classification</th>
            <th>Content Type</th>
            <th>Relevance</th>
            <th>Created</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {results.map((hit) => (
            <tr key={hit.document_id}>
              <td>
                <Link href={`/documents/${hit.document_id}`} className="rowLink" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <FileText size={14} color="var(--muted-2)" />
                  {hit.filename}
                </Link>
                {hit.highlight && (
                  <div
                    style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}
                    // Highlight text comes from the trusted backend search
                    // response only (OpenSearch/db highlighting), never
                    // from unsanitized user HTML.
                    dangerouslySetInnerHTML={{ __html: hit.highlight }}
                  />
                )}
              </td>
              <td>
                <ClassificationBadge level={hit.classification} />
              </td>
              <td className="mono">{hit.content_type}</td>
              <td className="mono">{hit.score.toFixed(3)}</td>
              <td>{formatDateTime(hit.created_at)}</td>
              <td>
                <div style={{ display: "flex", gap: 6 }}>
                  <Link href={`/analysis/${hit.document_id}`} className="btn btnSm">
                    Analyze
                  </Link>
                  <DownloadButton documentId={hit.document_id} filename={hit.filename} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
