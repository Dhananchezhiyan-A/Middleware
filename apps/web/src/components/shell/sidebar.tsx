"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, Waypoints, X } from "lucide-react";
import { NAV_SECTIONS } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  /** Rendered inside the mobile drawer. */
  mobile?: boolean;
  onNavigate?: () => void;
}

/** Longest matching nav href wins so /leads/processing beats /leads. */
function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const section of NAV_SECTIONS) {
    for (const link of section.links) {
      const matches = pathname === link.href || pathname.startsWith(`${link.href}/`);
      if (matches && (!best || link.href.length > best.length)) best = link.href;
    }
  }
  return best;
}

export function Sidebar({ collapsed, onToggleCollapse, mobile = false, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { can } = useAuth();
  const active = activeHref(pathname);

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-card/60",
        !mobile && collapsed ? "w-[64px]" : "w-[248px]",
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4",
          !mobile && collapsed && "justify-center px-0",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Waypoints className="size-4" />
        </span>
        {(!collapsed || mobile) && (
          <span className="truncate text-sm font-semibold tracking-tight">Lead Middleware</span>
        )}
        {mobile ? (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Close navigation"
            className="ml-auto rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3 scrollbar-thin">
        {NAV_SECTIONS.map((section, index) => {
          const links = section.links.filter((link) => !link.permission || can(link.permission));
          if (links.length === 0) return null;
          return (
            <div key={section.title || index} className="mb-3">
              {section.title && (!collapsed || mobile) ? (
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {section.title}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {links.map((link) => {
                  const Icon = link.icon;
                  const isActive = active === link.href;
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={onNavigate}
                        title={!mobile && collapsed ? link.label : undefined}
                        className={cn(
                          "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
                          !mobile && collapsed && "justify-center px-0",
                          isActive
                            ? "bg-primary/12 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        {(!collapsed || mobile) && <span className="truncate">{link.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-border p-2">
        {!mobile && onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 shrink-0" />
            ) : (
              <PanelLeftClose className="size-4 shrink-0" />
            )}
            {collapsed ? null : <span>Collapse</span>}
          </button>
        ) : null}
      </div>
    </div>
  );
}
