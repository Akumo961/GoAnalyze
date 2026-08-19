"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { UserCheck } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { InlineBanner, GapNote } from "@/components/ui/States";
import { ApiError, casesApi } from "@/lib/api";
import type { CaseAssignResponse } from "@/lib/types";

const SKILLS = ["technical", "legal", "environmental", "financial", "general"];

export default function CaseDetailPage() {
  const params = useParams<{ case_id: string }>();
  const caseId = params.case_id;
  const [skill, setSkill] = useState("technical");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CaseAssignResponse | null>(null);

  async function assign() {
    setStatus("loading");
    setError(null);
    try {
      const res = await casesApi.assign(caseId, skill);
      setResult(res);
      setStatus("success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Case assignment failed.");
      setStatus("error");
    }
  }

  return (
    <AppShell>
      <div className="pageHeading">
        <div>
          <h1>Case {caseId}</h1>
          <p className="mono">{caseId}</p>
        </div>
      </div>

      <GapNote>
        No <code className="mono">GET /v1/cases/{"{case_id}"}</code> endpoint exists, so case
        details (status, history, linked documents) can&apos;t be displayed here. Only assignment
        is available. See FRONTEND_BACKEND_GAPS.md.
      </GapNote>

      <div className="card" style={{ maxWidth: 480 }}>
        <div className="cardHeader">
          <h2>Assign Case</h2>
        </div>
        <div className="formField">
          <label htmlFor="skill">Skill / queue</label>
          <select id="skill" value={skill} onChange={(e) => setSkill(e.target.value)}>
            {SKILLS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        {error && <InlineBanner kind="error">{error}</InlineBanner>}
        {status === "success" && result && (
          <InlineBanner kind="success">
            Case assigned. Response: <span className="mono">{JSON.stringify(result)}</span>
          </InlineBanner>
        )}
        <button className="btn btnPrimary" disabled={status === "loading"} onClick={assign}>
          <UserCheck size={15} /> {status === "loading" ? "Assigning…" : "Assign Case"}
        </button>
      </div>
    </AppShell>
  );
}
