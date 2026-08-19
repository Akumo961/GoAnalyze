"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { GapNote } from "@/components/ui/States";

export default function CasesPage() {
  const [caseId, setCaseId] = useState("");
  const router = useRouter();

  return (
    <AppShell>
      <div className="pageHeading">
        <div>
          <h1>Cases</h1>
          <p>Open a case by ID to review and assign it.</p>
        </div>
      </div>

      <GapNote>
        The backend does not expose <code className="mono">GET /v1/cases</code> or{" "}
        <code className="mono">GET /v1/cases/{"{case_id}"}</code>, so no case list or case detail
        can be fetched or displayed here. Only <code className="mono">POST /v1/cases/{"{case_id}"}/assign</code>{" "}
        exists today. This page intentionally does not show a fabricated case list — see
        FRONTEND_BACKEND_GAPS.md for the recommended endpoints.
      </GapNote>

      <div className="card" style={{ maxWidth: 480 }}>
        <div className="cardHeader">
          <h2>Open a Case</h2>
        </div>
        <div className="formField">
          <label htmlFor="case-id">Case ID</label>
          <input
            id="case-id"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="e.g. CASE-2026-0142"
          />
          <span className="formHint">
            Case IDs come from your case management workflow (e.g. referenced in an environmental
            review or document ingest). There is currently no in-app way to browse cases.
          </span>
        </div>
        <button
          className="btn btnPrimary"
          disabled={!caseId}
          onClick={() => router.push(`/cases/${encodeURIComponent(caseId)}`)}
        >
          Open <ArrowRight size={15} />
        </button>
      </div>
    </AppShell>
  );
}
