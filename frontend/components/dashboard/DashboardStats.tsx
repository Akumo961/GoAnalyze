import { Activity, Files, ShieldAlert, Wifi } from "lucide-react";

export function DashboardStats({
  totalDocuments,
  apiReady,
  auditTotal,
  loading
}: {
  totalDocuments: number | null;
  apiReady: boolean | null;
  auditTotal: number | null;
  loading: boolean;
}) {
  const cards = [
    {
      icon: Files,
      label: "Documents indexed",
      value: loading ? "—" : totalDocuments !== null ? totalDocuments.toLocaleString() : "—",
      hint: "From document search"
    },
    {
      icon: ShieldAlert,
      label: "Audit events logged",
      value: loading ? "—" : auditTotal !== null ? auditTotal.toLocaleString() : "—",
      hint: "Total governance events"
    },
    {
      icon: Wifi,
      label: "API readiness",
      value: loading ? "—" : apiReady === null ? "Unknown" : apiReady ? "Ready" : "Not ready",
      hint: "Live from /ready"
    },
    {
      icon: Activity,
      label: "API status",
      value: loading ? "—" : "Live",
      hint: "See System Health for detail"
    }
  ];

  return (
    <div className="statGrid">
      {cards.map((c) => (
        <div className="statCard" key={c.label}>
          <div className="statIcon">
            <c.icon size={18} />
          </div>
          <span className="statLabel">{c.label}</span>
          <span className="statValue">{c.value}</span>
          <span className="statHint">{c.hint}</span>
        </div>
      ))}
    </div>
  );
}
