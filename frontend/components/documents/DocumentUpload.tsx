"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, Loader2, UploadCloud, XCircle } from "lucide-react";
import { ApiError, documentsApi } from "@/lib/api";
import { cacheDocumentRecord } from "@/lib/documentCache";
import { CLASSIFICATION_LEVELS } from "@/lib/types";
import type { ClassificationLevel, DocumentRecord } from "@/lib/types";
import { classificationLabel, cx, formatBytes, sha256Hex } from "@/lib/utils";
import { config } from "@/lib/config";
import { InlineBanner } from "@/components/ui/States";

type StepStatus = "pending" | "active" | "done" | "error";

interface StepState {
  ingest: StepStatus;
  content: StepStatus;
  process: StepStatus;
}

const INITIAL_STEPS: StepState = { ingest: "pending", content: "pending", process: "pending" };

function StepRow({ label, status }: { label: string; status: StepStatus }) {
  const Icon = status === "done" ? CheckCircle2 : status === "error" ? XCircle : status === "active" ? Loader2 : undefined;
  const color =
    status === "done" ? "var(--success)" : status === "error" ? "var(--danger)" : status === "active" ? "var(--accent)" : "var(--muted-2)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color, padding: "4px 0" }}>
      {Icon ? <Icon size={15} className={status === "active" ? "spin" : undefined} /> : <span style={{ width: 15 }} />}
      {label}
    </div>
  );
}

export function DocumentUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [tenantId, setTenantId] = useState(config.defaultTenantId);
  const [caseId, setCaseId] = useState("");
  const [classification, setClassification] = useState<ClassificationLevel>("internal");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<StepState>(INITIAL_STEPS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<DocumentRecord | null>(null);
  const [autoProcess, setAutoProcess] = useState(true);

  const reset = useCallback(() => {
    setFile(null);
    setSteps(INITIAL_STEPS);
    setError(null);
    setRecord(null);
    setBusy(false);
  }, []);

  function pickFile(f: File | undefined | null) {
    if (!f) return;
    setFile(f);
    setError(null);
    setRecord(null);
    setSteps(INITIAL_STEPS);
  }

  async function runUpload() {
    if (!file) return;
    setBusy(true);
    setError(null);

    try {
      // Step 1: ingest metadata record.
      setSteps((s) => ({ ...s, ingest: "active" }));
      const sha256 = await sha256Hex(file);
      const ingestPayload = {
        tenant_id: tenantId || config.defaultTenantId,
        case_id: caseId || null,
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        classification,
        sha256,
        // object_uri is normally assigned by object storage after upload;
        // since this frontend has no direct MinIO/S3 client, we send a
        // provisional client-generated URI. BACKEND GAP: ideally the
        // backend would issue a pre-signed upload URL / object key instead
        // of the frontend inventing one -- see FRONTEND_BACKEND_GAPS.md.
        object_uri: `pending://${tenantId || config.defaultTenantId}/${sha256}/${encodeURIComponent(file.name)}`,
        metadata: description ? { description } : {}
      };
      const ingested = await documentsApi.ingest(ingestPayload);
      cacheDocumentRecord(ingested);
      setRecord(ingested);
      setSteps((s) => ({ ...s, ingest: "done", content: "active" }));

      // Step 2: upload the actual bytes.
      await documentsApi.uploadContent(ingested.id, file);
      setSteps((s) => ({ ...s, content: "done", process: autoProcess ? "active" : "pending" }));

      // Step 3 (optional): kick off processing immediately.
      if (autoProcess) {
        await documentsApi.process(ingested.id);
        setSteps((s) => ({ ...s, process: "done" }));
      }

      setBusy(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Upload failed unexpectedly.";
      setError(message);
      setSteps((s) => ({
        ingest: s.ingest === "active" ? "error" : s.ingest,
        content: s.content === "active" ? "error" : s.content,
        process: s.process === "active" ? "error" : s.process
      }));
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div
        className={cx("dropzone", dragging && "dragging")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files?.[0]);
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload a document by dragging it here or pressing Enter to browse"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud size={30} />
        <p style={{ margin: "8px 0 4px", fontWeight: 700, color: "var(--ink)" }}>
          Drag & drop a file, or click to browse
        </p>
        <p style={{ fontSize: 12.5 }}>PDF, DOCX, images, and other formats accepted by the backend</p>
        <input
          ref={inputRef}
          type="file"
          style={{ display: "none" }}
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
      </div>

      {file && (
        <div className="fileRow">
          <FileUp size={16} color="var(--muted-2)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{file.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted-2)" }}>{formatBytes(file.size)}</div>
          </div>
          <button className="btn btnSm btnGhost" onClick={reset} disabled={busy}>
            Remove
          </button>
        </div>
      )}

      <div className="formRow" style={{ marginTop: 18 }}>
        <div className="formField">
          <label htmlFor="tenant">Tenant ID</label>
          <input id="tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} required />
          <span className="formHint">Required by the ingest schema (tenant_id).</span>
        </div>
        <div className="formField">
          <label htmlFor="case">Case ID (optional)</label>
          <input id="case" value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="e.g. CASE-2026-0142" />
        </div>
      </div>

      <div className="formRow">
        <div className="formField">
          <label htmlFor="classification">Classification</label>
          <select
            id="classification"
            value={classification}
            onChange={(e) => setClassification(e.target.value as ClassificationLevel)}
          >
            {CLASSIFICATION_LEVELS.map((level) => (
              <option key={level} value={level}>
                {classificationLabel(level)}
              </option>
            ))}
          </select>
        </div>
        <div className="formField">
          <label htmlFor="description">Description (optional metadata)</label>
          <input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 16 }}>
        <input type="checkbox" checked={autoProcess} onChange={(e) => setAutoProcess(e.target.checked)} />
        Automatically run processing (OCR, classification, risk scoring…) after upload
      </label>

      {error && <InlineBanner kind="error">{error}</InlineBanner>}

      {(steps.ingest !== "pending" || busy) && (
        <div className="card" style={{ background: "var(--surface)", marginBottom: 16 }}>
          <StepRow label="Ingest document record (POST /v1/documents)" status={steps.ingest} />
          <StepRow label="Upload file content (PUT /v1/documents/{id}/content)" status={steps.content} />
          {autoProcess && <StepRow label="Run processing pipeline (POST /v1/documents/{id}/process)" status={steps.process} />}
        </div>
      )}

      {record && steps.content === "done" && (
        <InlineBanner kind="success">
          Document uploaded successfully as <strong>{record.filename}</strong> (id: {record.id}).
        </InlineBanner>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btnPrimary" onClick={runUpload} disabled={!file || busy || !tenantId}>
          {busy ? <Loader2 size={15} className="spin" /> : <UploadCloud size={15} />}
          {busy ? "Uploading…" : "Upload Document"}
        </button>
        {record && (
          <button className="btn" onClick={() => router.push(`/documents/${record.id}`)}>
            View document
          </button>
        )}
      </div>
    </div>
  );
}
