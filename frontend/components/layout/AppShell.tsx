"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useAuth } from "@/hooks/useAuth";
import { LoadingBlock } from "@/components/ui/States";
import { cx } from "@/lib/utils";

/**
 * Wrap any authenticated page's content with <AppShell>. Handles the
 * sidebar/header chrome plus the auth guard: unauthenticated visitors are
 * redirected to /login (with the current path preserved so they land back
 * here after signing in) instead of ever rendering a blank page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { ready, authenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !authenticated) {
      const target = pathname && pathname !== "/" ? `?redirect=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${target}`);
    }
  }, [ready, authenticated, pathname, router]);

  if (!ready) {
    return (
      <div className="authScreen">
        <LoadingBlock label="Checking your session…" />
      </div>
    );
  }

  if (!authenticated) {
    // Redirect effect above is in-flight; avoid a flash of protected content.
    return (
      <div className="authScreen">
        <LoadingBlock label="Redirecting to sign-in…" />
      </div>
    );
  }

  return (
    <div className={cx("appShell", collapsed && "collapsed")}>
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 30 }}
          aria-hidden="true"
        />
      )}
      <div className="contentColumn">
        <Header
          onToggleMobile={() => setMobileOpen(true)}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          collapsed={collapsed}
        />
        <div className="pageBody">{children}</div>
      </div>
    </div>
  );
}
