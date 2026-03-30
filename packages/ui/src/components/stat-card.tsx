import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardContent } from "./card.js";

interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  icon?: React.ReactNode;
  accentColor?: string;
  className?: string;
}

function StatCard({ label, value, subValue, trend, trendLabel, icon, accentColor, className }: StatCardProps) {
  const trendColor =
    trend === "up" ? "text-[var(--color-success)]" :
    trend === "down" ? "text-[var(--color-danger)]" :
    "text-[var(--color-text-muted)]";

  const trendSymbol = trend === "up" ? "↑" : trend === "down" ? "↓" : "";

  return (
    <Card className={cn("relative overflow-hidden", className)}>
      {accentColor && (
        <div
          className="absolute left-0 top-0 h-full w-1 rounded-l-[var(--radius)]"
          style={{ backgroundColor: accentColor }}
        />
      )}
      <CardContent className={cn("p-5", accentColor && "pl-6")}>
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              {label}
            </p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {(trendLabel || subValue) && (
              <p className={cn("text-xs", trendColor)}>
                {trendSymbol} {trendLabel ?? subValue}
              </p>
            )}
          </div>
          {icon && (
            <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-2 text-[var(--color-text-muted)]">
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export { StatCard };
