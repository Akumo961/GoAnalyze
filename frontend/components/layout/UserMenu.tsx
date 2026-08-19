"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export function UserMenu() {
  const { user, roles, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user) return null;

  const displayName = user.name || user.preferred_username || user.email || "Signed-in user";
  const initials = displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="userMenu" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="userAvatar">{initials}</span>
        <span>{displayName}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="card"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: 240,
            zIndex: 30,
            padding: 12
          }}
        >
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: "var(--ink)" }}>{displayName}</div>
            {user.email && <div>{user.email}</div>}
          </div>
          {roles.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {roles.slice(0, 4).map((role) => (
                <span key={role} className="badge badge-neutral">
                  <ShieldCheck size={11} /> {role}
                </span>
              ))}
            </div>
          )}
          <button className="btn btnSm" style={{ width: "100%", justifyContent: "center" }} onClick={logout}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
