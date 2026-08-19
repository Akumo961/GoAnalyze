"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { LoadingBlock } from "@/components/ui/States";

export default function RootPage() {
  const { ready, authenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(authenticated ? "/dashboard" : "/login");
  }, [ready, authenticated, router]);

  return (
    <div className="authScreen">
      <LoadingBlock label="Loading GoAnalyze…" />
    </div>
  );
}
