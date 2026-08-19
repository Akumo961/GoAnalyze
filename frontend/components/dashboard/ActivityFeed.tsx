import Link from "next/link";
import { History } from "lucide-react";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/States";
import { formatRelativeTime } from "@/lib/utils";
import type { AuditEvent } from "@/lib/types";

export function ActivityFeed({
  status,
  events,
  error,
  onRetry
}: {
  status: "idle" | "loading" | "success" | "error";
  events: AuditEvent[];
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="card">
      <div className="cardHeader">
        <h2>Recent Activity</h2>
        <Link href="/audit" className="btn btnSm">
          View audit log
        </Link>
      </div>
      {status === "loading" && <LoadingBlock label="Loading recent activity…" />}
      {status === "error" && <ErrorBlock error={error} onRetry={onRetry} />}
      {status === "success" && events.length === 0 && (
        <EmptyBlock title="No activity yet" description="Audit events will appear here as the platform is used." />
      )}
      {status === "success" && events.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {events.slice(0, 6).map((event) => (
            <li key={event.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <History size={14} color="var(--muted-2)" style={{ marginTop: 3, flexShrink: 0 }} />
              <div style={{ fontSize: 13 }}>
                <strong>{event.actor}</strong> {event.action.replace(/_/g, " ")} on {event.resource_type}
                <div style={{ fontSize: 12, color: "var(--muted-2)" }}>{formatRelativeTime(event.timestamp)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
