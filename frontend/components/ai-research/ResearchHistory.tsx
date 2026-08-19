import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { EmptyBlock } from "@/components/ui/States";
import type { ResearchTurn } from "@/hooks/useRag";

export function ResearchHistory({ history }: { history: ResearchTurn[] }) {
  if (history.length === 0) {
    return (
      <EmptyBlock
        title="Ask your first research question"
        description="Attach evidence citations, then ask a question. GoAnalyze will return a server-verified, citation-backed answer."
      />
    );
  }

  return (
    <div className="chatThread">
      {history.map((turn, i) => (
        <div className="chatTurn" key={i}>
          <div className="chatQuestion">{turn.question}</div>
          {turn.error ? (
            <div style={{ display: "flex", gap: 8, color: "var(--danger)", fontSize: 13.5 }}>
              <AlertTriangle size={15} /> {turn.error}
            </div>
          ) : (
            <>
              <p style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>
                {typeof turn.response?.answer === "string" ? turn.response.answer : JSON.stringify(turn.response, null, 2)}
              </p>
              {Array.isArray(turn.response?.citations) && turn.response!.citations!.length > 0 && (
                <div>
                  <h3 style={{ marginBottom: 8 }}>Citations</h3>
                  {turn.response!.citations!.map((c, ci) => (
                    <div key={ci} className="evidenceCard">
                      <div className="evidenceMeta">
                        <Link href={`/documents/${c.document_id}`} className="mono">
                          {c.document_id}
                        </Link>
                        {c.page !== null && c.page !== undefined && <span>page {c.page}</span>}
                      </div>
                      {c.excerpt}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
