import { Fragment } from "react";
import { EmptyBlock } from "@/components/ui/States";
import type { StageResult } from "@/lib/types";

/**
 * The processing result schema doesn't have a dedicated `compliance`
 * field -- compliance findings, if any, live inside the
 * `compliance_analysis` stage's free-form `output` object. We surface
 * whatever the backend actually put there, key by key, rather than
 * assuming a fixed shape it hasn't committed to.
 */
export function CompliancePanel({ stages }: { stages: StageResult[] | null }) {
  const stage = stages?.find((s) => s.stage === "compliance_analysis");

  return (
    <div className="card">
      <h2>Compliance Analysis</h2>
      {!stage ? (
        <EmptyBlock title="Not analyzed yet" description="Run processing to see compliance findings for this document." />
      ) : Object.keys(stage.output).length === 0 ? (
        <EmptyBlock title="No findings reported" description="The compliance stage ran but returned no findings." />
      ) : (
        <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 8, fontSize: 13, margin: "10px 0 0" }}>
          {Object.entries(stage.output).map(([key, value]) => (
            <Fragment key={key}>
              <dt style={{ color: "var(--muted)", textTransform: "capitalize" }}>
                {key.replace(/_/g, " ")}
              </dt>
              <dd style={{ margin: 0 }}>
                {typeof value === "object" ? JSON.stringify(value) : String(value)}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}
