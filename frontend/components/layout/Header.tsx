"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Breadcrumbs } from "./Breadcrumbs";
import { UserMenu } from "./UserMenu";

export function Header({
  onToggleMobile,
  onToggleCollapse,
  collapsed
}: {
  onToggleMobile: () => void;
  onToggleCollapse: () => void;
  collapsed: boolean;
}) {
  return (
    <header className="appHeader">
      <div className="headerLeft">
        <button className="mobileMenuButton" onClick={onToggleMobile} aria-label="Open navigation">
          <Menu size={18} />
        </button>
        <button
          className="btn btnGhost btnSm"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <Breadcrumbs />
      </div>
      <div className="headerRight">
        <UserMenu />
      </div>
    </header>
  );
}
