import React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Landmark,
  PiggyBank,
  Repeat,
  Trophy,
  CreditCard,
  TrendingUp,
  BarChart3,
  BookOpen,
  Settings,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@milly-maker/ui";
import { useUIStore } from "@/store/ui.store.js";
import { AssistantPanel } from "@/features/assistant/AssistantPanel.js";

const NAV_ITEMS = [
  { to: "/",               label: "Dashboard",     icon: LayoutDashboard },
  { to: "/checking",       label: "Checking",      icon: Landmark },
  { to: "/savings",        label: "Savings",       icon: PiggyBank },
  { to: "/subscriptions",  label: "Subscriptions", icon: Repeat },
  { to: "/fantasy",        label: "Fantasy",       icon: Trophy },
  { to: "/debts",       label: "Debts",       icon: CreditCard },
  { to: "/investments", label: "Investments", icon: TrendingUp },
  { to: "/forecast",    label: "Forecast",    icon: BarChart3 },
  { to: "/planning",    label: "Planning",    icon: BookOpen },
];

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { sidebarCollapsed, assistantOpen, toggleSidebar, toggleAssistant } = useUIStore();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-all duration-200",
          sidebarCollapsed ? "w-16" : "w-56"
        )}
      >
        {/* Logo */}
        <div className={cn("flex h-14 items-center border-b border-[var(--color-border)] px-4", sidebarCollapsed && "justify-center px-0")}>
          {!sidebarCollapsed && (
            <span className="text-base font-bold tracking-tight text-[var(--color-primary)]">
              milly maker
            </span>
          )}
          {sidebarCollapsed && (
            <span className="text-lg font-bold text-[var(--color-primary)]">m</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? currentPath === "/" : currentPath.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]",
                  sidebarCollapsed && "justify-center px-0"
                )}
                title={sidebarCollapsed ? label : undefined}
              >
                <Icon size={18} className="shrink-0" />
                {!sidebarCollapsed && label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className="flex flex-col gap-1 border-t border-[var(--color-border)] p-2">
          <button
            onClick={toggleAssistant}
            className={cn(
              "flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors",
              assistantOpen
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]",
              sidebarCollapsed && "justify-center px-0"
            )}
            title={sidebarCollapsed ? "Claude" : undefined}
          >
            <MessageSquare size={18} className="shrink-0" />
            {!sidebarCollapsed && "Claude"}
          </button>

          <Link
            to="/settings"
            className={cn(
              "flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors",
              currentPath === "/settings"
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]",
              sidebarCollapsed && "justify-center px-0"
            )}
            title={sidebarCollapsed ? "Settings" : undefined}
          >
            <Settings size={18} className="shrink-0" />
            {!sidebarCollapsed && "Settings"}
          </Link>

          <button
            onClick={toggleSidebar}
            className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-muted)]"
            title={sidebarCollapsed ? "Expand" : "Collapse"}
          >
            {sidebarCollapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span>Collapse</span></>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </main>

      {/* Assistant slide-in panel */}
      {assistantOpen && <AssistantPanel />}
    </div>
  );
}
