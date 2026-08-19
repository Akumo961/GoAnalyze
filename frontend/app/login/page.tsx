"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Gauge, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { config } from "@/lib/config";
import { LoadingBlock } from "@/components/ui/States";

function LoginInner() {
  const { ready, authenticated, login } = useAuth();
  const searchParams = useSearchParams();
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (ready && authenticated) {
      window.location.href = searchParams.get("redirect") || "/dashboard";
    }
  }, [ready, authenticated, searchParams]);

  if (!ready) {
    return <LoadingBlock label="Checking your session…" />;
  }

  return (
    <div className="authCard">
      <div className="sidebarBrandMark" style={{ width: 48, height: 48 }}>
        <Gauge size={24} />
      </div>
      <h1 style={{ fontSize: 22 }}>{config.appName}</h1>
      <p style={{ color: "var(--muted)", marginBottom: 24 }}>
        Sign in with your organization&apos;s identity provider to access government document
        intelligence.
      </p>
      <button
        className="btn btnPrimary"
        style={{ width: "100%", justifyContent: "center", padding: "12px 14px" }}
        disabled={starting}
        onClick={() => {
          setStarting(true);
          login(searchParams.get("redirect") || "/dashboard");
        }}
      >
        <ShieldCheck size={16} />
        {starting ? "Redirecting to sign-in…" : "Sign in with Keycloak"}
      </button>
      <p style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 18 }}>
        Authenticated via OpenID Connect. Your credentials are never seen by this application.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="authScreen">
      <Suspense fallback={<LoadingBlock label="Loading…" />}>
        <LoginInner />
      </Suspense>
    </div>
  );
}
