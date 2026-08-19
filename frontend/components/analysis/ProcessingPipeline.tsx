import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { CANONICAL_PIPELINE_STAGES } from "@/lib/types";
import { stageLabel } from "@/lib/utils";
import type { StageResult } from "@/lib/types";

export function ProcessingPipeline({ stages }: { stages: StageResult[] | null }) {
  const byStage = new Map((stages ?? []).map((s) => [s.stage, s]));
  // Show every stage the backend actually returned, in the order returned.
  // If nothing has run yet, show the documented canonical order as "pending"
  // placeholders (clearly not results) so the user knows what will run.
  const order = stages && stages.length > 0 ? stages.map((s) => s.stage) : CANONICAL_PIPELINE_STAGES;

  return (
    <div className="pipeline">
      {order.map((stageName) => {
        const result = byStage.get(stageName);
        const status = !result ? "pending" : result.status === "failed" || result.status === "error" ? "failed" : "completed";
        const Icon = status === "completed" ? CheckCircle2 : status === "failed" ? XCircle : Circle;
        return (
          <div key={stageName} className={`pipelineStage ${status}`}>
            <Icon size={13} />
            {stageLabel(stageName)}
            {result && <span style={{ opacity: 0.7 }}>· {result.duration_ms}ms</span>}
          </div>
        );
      })}
    </div>
  );
}
