import { AppShell } from "@/components/layout/AppShell";
import { DocumentUpload } from "@/components/documents/DocumentUpload";
import { GapNote } from "@/components/ui/States";

export default function DocumentUploadPage() {
  return (
    <AppShell>
      <div className="pageHeading">
        <div>
          <h1>Upload Document</h1>
          <p>
            Ingests a document record, uploads its content, and optionally runs the processing
            pipeline — using the real backend endpoints in sequence.
          </p>
        </div>
      </div>

      <GapNote>
        The ingest schema requires an <code className="mono">object_uri</code>, which is normally
        assigned by object storage. This frontend has no direct MinIO/S3 client, so it sends a
        provisional client-generated URI. Recommended: a pre-signed upload endpoint (e.g.{" "}
        <code className="mono">POST /v1/documents/upload-url</code>) so the backend controls
        object storage placement. See FRONTEND_BACKEND_GAPS.md.
      </GapNote>

      <DocumentUpload />
    </AppShell>
  );
}
