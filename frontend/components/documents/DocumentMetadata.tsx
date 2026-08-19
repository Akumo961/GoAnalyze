import { ClassificationBadge } from "@/components/ui/Badges";
import { GapNote } from "@/components/ui/States";
import { formatDateTime } from "@/lib/utils";
import type { CachedDocument } from "@/lib/documentCache";
import Link from "next/link";

export function DocumentMetadata({ doc, documentId }: { doc: CachedDocument | null; documentId: string }) {
  if (!doc) {
    return (
      <div className="card">
        <div className="cardHeader">
          <h2>Document Metadata</h2>
        </div>
        <GapNote>
          There is no <code className="mono">GET /v1/documents/{"{document_id}"}</code> endpoint,
          and this document (<code className="mono">{documentId}</code>) wasn&apos;t returned by
          a search or upload in this session, so its metadata can&apos;t be displayed. Find it via{" "}
          <Link href="/documents">Documents search</Link> to populate this page, or use the actions
          below, which only require the document id.
        </GapNote>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardHeader">
        <h2>Document Metadata</h2>
        {doc.classification && <ClassificationBadge level={doc.classification} />}
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "140px 1fr", rowGap: 10, fontSize: 13.5, margin: 0 }}>
        <dt style={{ color: "var(--muted)" }}>Filename</dt>
        <dd style={{ margin: 0 }}>{doc.filename ?? "—"}</dd>

        <dt style={{ color: "var(--muted)" }}>Content type</dt>
        <dd style={{ margin: 0 }} className="mono">
          {doc.content_type ?? "—"}
        </dd>

        <dt style={{ color: "var(--muted)" }}>Document ID</dt>
        <dd style={{ margin: 0 }} className="mono">
          {documentId}
        </dd>

        {doc.tenant_id && (
          <>
            <dt style={{ color: "var(--muted)" }}>Tenant</dt>
            <dd style={{ margin: 0 }}>{doc.tenant_id}</dd>
          </>
        )}
        {doc.case_id && (
          <>
            <dt style={{ color: "var(--muted)" }}>Case</dt>
            <dd style={{ margin: 0 }}>{doc.case_id}</dd>
          </>
        )}
        {doc.version !== undefined && (
          <>
            <dt style={{ color: "var(--muted)" }}>Version</dt>
            <dd style={{ margin: 0 }}>{doc.version}</dd>
          </>
        )}
        {doc.sha256 && (
          <>
            <dt style={{ color: "var(--muted)" }}>SHA-256</dt>
            <dd style={{ margin: 0 }} className="mono">
              {doc.sha256}
            </dd>
          </>
        )}
        {doc.created_at && (
          <>
            <dt style={{ color: "var(--muted)" }}>Created</dt>
            <dd style={{ margin: 0 }}>{formatDateTime(doc.created_at)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
