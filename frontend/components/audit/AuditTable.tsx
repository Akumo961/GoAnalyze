"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { AuditEvent } from "@/lib/types";

export function AuditTable({ events }: { events: AuditEvent[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="tableWrap">
      <table className="dataTable">
        <thead>
          <tr>
            <th aria-label="Expand" />
            <th>Timestamp</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Resource</th>
            <th>Purpose</th>
            <th>Trace</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const isOpen = expanded === event.id;
            return (
              <Fragment key={event.id}>
                <tr style={{ cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : event.id)}>
                  <td>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                  <td>{formatDateTime(event.timestamp)}</td>
                  <td>{event.actor}</td>
                  <td>
                    <span className="badge badge-info">{event.action}</span>
                  </td>
                  <td>
                    {event.resource_type}
                    <div className="mono" style={{ fontSize: 11 }}>
                      {event.resource_id}
                    </div>
                  </td>
                  <td>{event.purpose}</td>
                  <td className="mono">{event.trace_id.slice(0, 8)}…</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={7} style={{ background: "var(--surface)" }}>
                      <div style={{ padding: "8px 4px", fontSize: 12.5 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", rowGap: 6 }}>
                          <strong>Event ID</strong>
                          <span className="mono">{event.id}</span>
                          <strong>Tenant</strong>
                          <span>{event.tenant_id}</span>
                          <strong>Trace ID</strong>
                          <span className="mono">{event.trace_id}</span>
                          {event.previous_hash && (
                            <>
                              <strong>Previous hash</strong>
                              <span className="mono">{event.previous_hash}</span>
                            </>
                          )}
                          {event.event_hash && (
                            <>
                              <strong>Event hash</strong>
                              <span className="mono">{event.event_hash}</span>
                            </>
                          )}
                        </div>
                        {Object.keys(event.details ?? {}).length > 0 && (
                          <>
                            <strong style={{ display: "block", marginTop: 10 }}>Details</strong>
                            <pre
                              style={{
                                background: "var(--panel)",
                                border: "1px solid var(--line)",
                                borderRadius: 6,
                                padding: 10,
                                overflowX: "auto"
                              }}
                            >
                              {JSON.stringify(event.details, null, 2)}
                            </pre>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
