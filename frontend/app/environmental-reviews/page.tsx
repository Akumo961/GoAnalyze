"use client";

import { useState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { InlineBanner } from "@/components/ui/States";
import { ApiError, environmentalApi } from "@/lib/api";
import { config } from "@/lib/config";
import type { EnvironmentalReviewRequest, EnvironmentalReviewResponse } from "@/lib/types";

export default function EnvironmentalReviewsPage() {
  const [form, setForm] = useState({
    tenant_id: config.defaultTenantId,
    case_id: "",
    project_type: "",
    location: "",
    applicant: ""
  });
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [draftDocId, setDraftDocId] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnvironmentalReviewResponse | null>(null);

  const missingFields = !form.tenant_id || !form.case_id || !form.project_type || !form.location || !form.applicant || documentIds.length === 0;

  async function submit() {
    setStatus("loading");
    setError(null);
    setResult(null);
    const payload: EnvironmentalReviewRequest = {
      ...form,
      documents: documentIds
    };
    try {
      const res = await environmentalApi.review(payload);
      setResult(res);
      setStatus("success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The environmental review request failed.");
      setStatus("error");
    }
  }

  return (
    <AppShell>
      <div className="pageHeading">
        <div>
          <h1>Environmental Reviews</h1>
          <p>
            Submit a project for environmental review via{" "}
            <code className="mono">POST /v1/environmental-reviews</code>.
          </p>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="cardHeader">
            <h2>New Review Request</h2>
          </div>

          <div className="formRow">
            <div className="formField">
              <label htmlFor="tenant">Tenant ID</label>
              <input id="tenant" value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value })} />
            </div>
            <div className="formField">
              <label htmlFor="case">Case ID (UUID)</label>
              <input
                id="case"
                value={form.case_id}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(e) => setForm({ ...form, case_id: e.target.value })}
              />
            </div>
          </div>

          <div className="formRow">
            <div className="formField">
              <label htmlFor="project_type">Project type</label>
              <input
                id="project_type"
                value={form.project_type}
                placeholder="e.g. pipeline, land development"
                onChange={(e) => setForm({ ...form, project_type: e.target.value })}
              />
            </div>
            <div className="formField">
              <label htmlFor="location">Location</label>
              <input id="location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
          </div>

          <div className="formField">
            <label htmlFor="applicant">Applicant</label>
            <input id="applicant" value={form.applicant} onChange={(e) => setForm({ ...form, applicant: e.target.value })} />
          </div>

          <div className="formField">
            <label htmlFor="doc-id">Supporting document IDs (UUID)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="doc-id"
                value={draftDocId}
                onChange={(e) => setDraftDocId(e.target.value)}
                placeholder="Document ID from Documents search"
              />
              <button
                type="button"
                className="btn btnSm"
                onClick={() => {
                  if (!draftDocId) return;
                  setDocumentIds([...documentIds, draftDocId]);
                  setDraftDocId("");
                }}
              >
                <Plus size={13} /> Add
              </button>
            </div>
            <span className="formHint">
              Copy document ids from <Link href="/documents">Documents</Link> — at least one is required.
            </span>
            {documentIds.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {documentIds.map((id, i) => (
                  <div key={i} className="fileRow">
                    <span className="mono" style={{ flex: 1 }}>
                      {id}
                    </span>
                    <button
                      className="btn btnSm btnGhost"
                      onClick={() => setDocumentIds(documentIds.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <InlineBanner kind="error">{error}</InlineBanner>}

          <button className="btn btnPrimary" disabled={missingFields || status === "loading"} onClick={submit}>
            <Send size={15} /> {status === "loading" ? "Submitting…" : "Submit for Review"}
          </button>
        </div>

        <div className="card">
          <div className="cardHeader">
            <h2>Result</h2>
          </div>
          {status === "success" && result ? (
            <pre
              style={{
                fontSize: 12.5,
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: 12,
                overflowX: "auto"
              }}
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Submit a review request to see the backend&apos;s response here. The response schema
              is open-ended (findings, risks, and recommendations as returned by the backend), so
              it is shown as-received rather than mapped to assumed fields.
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
