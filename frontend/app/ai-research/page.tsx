"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CitationBuilder } from "@/components/ai-research/CitationBuilder";
import { ResearchHistory } from "@/components/ai-research/ResearchHistory";
import { InlineBanner } from "@/components/ui/States";
import { useRag } from "@/hooks/useRag";
import type { EvidenceCitation } from "@/lib/types";

export default function AiResearchPage() {
  const [question, setQuestion] = useState("");
  const [citations, setCitations] = useState<EvidenceCitation[]>([]);
  const { status, error, history, ask } = useRag();

  async function handleAsk() {
    if (!question.trim()) return;
    try {
      await ask(question.trim(), citations);
      setQuestion("");
    } catch {
      /* error already captured in history/error state */
    }
  }

  return (
    <AppShell>
      <div className="pageHeading">
        <div>
          <h1>AI Research</h1>
          <p>
            Ask questions answered with server-verified evidence citations via{" "}
            <code className="mono">POST /v1/rag/answer</code>.
          </p>
        </div>
      </div>

      <CitationBuilder citations={citations} onChange={setCitations} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="formField" style={{ marginBottom: 12 }}>
          <label htmlFor="question">Question</label>
          <textarea
            id="question"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What environmental risks were flagged in the Q3 permit filings?"
          />
        </div>
        {error && <InlineBanner kind="error">{error.message}</InlineBanner>}
        <button className="btn btnPrimary" disabled={status === "loading" || !question.trim()} onClick={handleAsk}>
          <Send size={15} /> {status === "loading" ? "Asking…" : "Ask"}
        </button>
      </div>

      <ResearchHistory history={history} />
    </AppShell>
  );
}
