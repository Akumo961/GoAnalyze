import { AlertTriangle, Inbox, Lock, ShieldAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="stateBlock loading" role="status" aria-live="polite">
      <div className="stateIcon">
        <div className="spinner" />
      </div>
      <p>{label}</p>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="tableWrap" aria-hidden="true">
      <div style={{ padding: 16 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 16, marginBottom: 12, width: `${90 - i * 4}%` }} />
        ))}
      </div>
    </div>
  );
}

export function EmptyBlock({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="stateBlock empty">
      <div className="stateIcon">
        <Inbox size={20} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorBlock({
  error,
  onRetry,
  title
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";

  const Icon = apiError?.kind === "unauthorized" ? Lock : apiError?.kind === "forbidden" ? ShieldAlert : apiError?.kind === "network" ? WifiOff : AlertTriangle;

  const heading =
    title ??
    (apiError?.kind === "unauthorized"
      ? "Sign-in required"
      : apiError?.kind === "forbidden"
      ? "Access denied"
      : apiError?.kind === "network"
      ? "Can't reach the API"
      : "Something went wrong");

  return (
    <div className="stateBlock error" role="alert">
      <div className="stateIcon">
        <Icon size={20} />
      </div>
      <h3>{heading}</h3>
      <p>{message}</p>
      {onRetry && (
        <button className="btn btnSm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function InlineBanner({
  kind,
  children
}: {
  kind: "error" | "warning" | "info" | "success";
  children: ReactNode;
}) {
  return (
    <div className={`banner banner-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function GapNote({ children }: { children: ReactNode }) {
  return <div className="gapNote">BACKEND GAP — {children}</div>;
}
