import { riskBand } from "@/lib/utils";
import { EmptyBlock } from "@/components/ui/States";
import type { DocumentProcessingResult } from "@/lib/types";

export function RiskScore({ score }: { score: number | null | undefined }) {
  const band = riskBand(score);
  if (score === null || score === undefined) {
    return (
      <div className="card">
        <h2>Risk Score</h2>
        <EmptyBlock title="Not scored yet" description="Run processing on this document to compute a risk score." />
      </div>
    );
  }
  return (
    <div className="card">
      <h2>Risk Score</h2>
      <div className="riskGauge" style={{ marginTop: 10 }}>
        <span className="riskValue">{(score * 100).toFixed(0)}%</span>
        <div className={`riskBar risk-${band}`}>
          <div style={{ width: `${Math.round(score * 100)}%` }} />
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8, textTransform: "capitalize" }}>{band} risk</p>
    </div>
  );
}

export function ClassificationResult({ label }: { label: string | null | undefined }) {
  return (
    <div className="card">
      <h2>Classification Result</h2>
      {label ? (
        <p style={{ fontSize: 15, fontWeight: 700, marginTop: 10 }}>{label}</p>
      ) : (
        <EmptyBlock title="Not classified yet" description="Run processing to classify this document." />
      )}
    </div>
  );
}

export function EntitiesPanel({ entities }: { entities: string[] | undefined }) {
  return (
    <div className="card">
      <h2>Extracted Entities</h2>
      {!entities || entities.length === 0 ? (
        <EmptyBlock title="No entities extracted" description="Entities appear here once processing completes." />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {entities.map((entity, i) => (
            <span key={`${entity}-${i}`} className="badge badge-info">
              {entity}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkflowPanel({ queue }: { queue: string | null | undefined }) {
  return (
    <div className="card">
      <h2>Workflow Routing</h2>
      {queue ? (
        <p style={{ fontSize: 14, marginTop: 10 }}>
          Routed to queue <span className="badge badge-accent">{queue}</span>
        </p>
      ) : (
        <EmptyBlock title="Not routed yet" description="Workflow routing appears here once processing completes." />
      )}
    </div>
  );
}

export function AnalysisOverview({ result }: { result: DocumentProcessingResult | null }) {
  if (!result) {
    return (
      <EmptyBlock
        title="No analysis run yet"
        description="Trigger processing to run OCR, classification, entity extraction, compliance analysis, and risk scoring on this document."
      />
    );
  }
  return (
    <div className="statGrid" style={{ marginBottom: 0 }}>
      <div className="statCard">
        <span className="statLabel">Status</span>
        <span className="statValue" style={{ fontSize: 18 }}>
          {result.completed ? "Completed" : "In progress"}
        </span>
      </div>
      <div className="statCard">
        <span className="statLabel">Stages run</span>
        <span className="statValue">{result.stages.length}</span>
      </div>
      <div className="statCard">
        <span className="statLabel">Entities found</span>
        <span className="statValue">{result.extracted_entities.length}</span>
      </div>
      <div className="statCard">
        <span className="statLabel">Risk</span>
        <span className="statValue" style={{ fontSize: 18 }}>
          {result.risk_score !== null && result.risk_score !== undefined
            ? `${(result.risk_score * 100).toFixed(0)}%`
            : "—"}
        </span>
      </div>
    </div>
  );
}
