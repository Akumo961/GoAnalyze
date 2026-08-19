"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  documents: "Documents",
  upload: "Upload",
  analysis: "Analysis",
  "ai-research": "AI Research",
  "environmental-reviews": "Environmental Reviews",
  cases: "Cases",
  search: "Search",
  audit: "Audit Log",
  setup: "Setup",
  system: "System Health",
  login: "Sign In"
};

function labelFor(segment: string): string {
  if (LABELS[segment]) return LABELS[segment];
  // UUID-ish or dynamic segment: show a shortened id instead of the raw slug.
  if (segment.length > 12) return `${segment.slice(0, 8)}…`;
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function Breadcrumbs() {
  const pathname = usePathname() ?? "/";
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return (
      <div className="breadcrumbs">
        <span className="current">Dashboard</span>
      </div>
    );
  }

  return (
    <div className="breadcrumbs" aria-label="Breadcrumb">
      <Link href="/dashboard">Home</Link>
      {segments.map((segment, i) => {
        const href = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <span key={href} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ChevronRight size={13} />
            {isLast ? (
              <span className="current">{labelFor(segment)}</span>
            ) : (
              <Link href={href}>{labelFor(segment)}</Link>
            )}
          </span>
        );
      })}
    </div>
  );
}
