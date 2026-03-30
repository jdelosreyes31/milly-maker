import React, { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, Badge, formatCurrency, formatMonth } from "@milly-maker/ui";
import { useDb } from "@/db/hooks/useDb.js";
import { getMonthlyDebitTotals, getMonthlyCreditTotals } from "@/db/queries/checking.js";
import { loadPlanningSettings } from "@/features/planning/PlanningPage.js";
import {
  ComposedChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, Line, ReferenceLine,
} from "recharts";

type RuleScore = "on-track" | "warning" | "over";

export function ForecastPage() {
  const { conn } = useDb();
  const [monthlyDebits, setMonthlyDebits] = useState<{ month: string; total: number }[]>([]);
  const [monthlyCredits, setMonthlyCredits] = useState<{ month: string; total: number }[]>([]);

  // Load from Planning settings; fall back to manual income input
  const planSettings = loadPlanningSettings();
  const planIncome = planSettings.incomeOverride
    ?? (monthlyCredits.length > 0
      ? Math.round(monthlyCredits.slice(-3).reduce((s, c) => s + c.total, 0) / Math.min(3, monthlyCredits.length))
      : 0);
  const spendingTarget = planIncome > 0
    ? Math.round(planIncome * (planSettings.needsPct + planSettings.wantsPct) / 100)
    : 0;

  const [monthlyIncome, setMonthlyIncome] = useState(planSettings.incomeOverride ?? 5000);

  useEffect(() => {
    if (!conn) return;
    void Promise.all([
      getMonthlyDebitTotals(conn),
      getMonthlyCreditTotals(conn),
    ]).then(([debits, credits]) => {
      setMonthlyDebits(debits);
      setMonthlyCredits(credits);
    });
  }, [conn]);

  // Simple 6-month forecast: trailing 3-month average of debits
  const forecastData = useMemo(() => {
    const allMonths = [...new Set([
      ...monthlyDebits.map((d) => d.month),
      ...monthlyCredits.map((c) => c.month),
    ])].sort();

    const debitMap = new Map(monthlyDebits.map((d) => [d.month, d.total]));
    const creditMap = new Map(monthlyCredits.map((c) => [c.month, c.total]));

    // Build historical rows
    const historical = allMonths.map((month) => ({
      month,
      debits: debitMap.get(month) ?? 0,
      credits: creditMap.get(month) ?? 0,
      isProjected: false,
    }));

    // Trailing 3-month average for projection
    const recentDebits = historical.slice(-3).map((h) => h.debits);
    const avgDebits = recentDebits.length > 0
      ? recentDebits.reduce((a, b) => a + b, 0) / recentDebits.length
      : 0;

    // Compute simple slope
    const slope = recentDebits.length >= 2
      ? (recentDebits[recentDebits.length - 1]! - recentDebits[0]!) / (recentDebits.length - 1)
      : 0;

    const latestMonth = allMonths.at(-1);
    const projected = latestMonth
      ? Array.from({ length: 6 }, (_, i) => {
          const m = addMonths(latestMonth, i + 1);
          return {
            month: m,
            debits: Math.max(0, Math.round((avgDebits + slope * (i + 1)) * 100) / 100),
            credits: 0,
            isProjected: true,
          };
        })
      : [];

    return [...historical, ...projected];
  }, [monthlyDebits, monthlyCredits]);

  // 50/30/20 for current month
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthDebits = monthlyDebits.find((d) => d.month === currentMonth)?.total ?? 0;
  const thisMonthCredits = monthlyCredits.find((c) => c.month === currentMonth)?.total ?? 0;
  const savingsThisMonth = Math.max(0, thisMonthCredits - thisMonthDebits);

  const needsPct = monthlyIncome > 0 ? Math.round((thisMonthDebits / monthlyIncome) * 100) : 0;
  const savingsPct = monthlyIncome > 0 ? Math.round((savingsThisMonth / monthlyIncome) * 100) : 0;

  const score: RuleScore =
    needsPct > 55 || savingsPct < 15 ? "over" :
    needsPct > 50 || savingsPct < 20 ? "warning" : "on-track";

  const scoreVariant =
    score === "on-track" ? "success" :
    score === "warning" ? "warning" : "danger";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Forecast</h1>

      {/* Spending vs income */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Spending vs Income — {formatMonth(currentMonth)}</CardTitle>
            <Badge variant={scoreVariant}>{score}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-3">
            <label className="whitespace-nowrap text-sm text-[var(--color-text-muted)]">Monthly Income ($)</label>
            <input
              type="number"
              min="0"
              step="100"
              value={monthlyIncome}
              onChange={(e) => setMonthlyIncome(Number(e.target.value))}
              className="w-32 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Spent</p>
              <p className="text-2xl font-bold">{formatCurrency(thisMonthDebits)}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{needsPct}% of income</p>
              {needsPct > 50 && <p className="mt-1 text-xs text-[var(--color-warning)]">Over 50% of income</p>}
            </div>
            <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Income In</p>
              <p className="text-2xl font-bold text-[var(--color-success)]">{formatCurrency(thisMonthCredits)}</p>
              <p className="text-xs text-[var(--color-text-muted)]">credits this month</p>
            </div>
            <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Net (saved)</p>
              <p className={`text-2xl font-bold ${savingsThisMonth < 0 ? "text-[var(--color-danger)]" : ""}`}>
                {formatCurrency(savingsThisMonth)}
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">{savingsPct}% of income</p>
              {savingsPct < 20 && <p className="mt-1 text-xs text-[var(--color-warning)]">Below 20% savings target</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 6-month spending forecast */}
      <Card>
        <CardHeader>
          <CardTitle>6-Month Spending Forecast</CardTitle>
          <p className="text-xs text-[var(--color-text-muted)]">
            Based on trailing 3-month average. Solid = actual, faded = projected.
            {spendingTarget > 0 && (
              <span className="ml-1 text-[var(--color-warning)]">
                — Dashed line = Planning budget ({planSettings.needsPct + planSettings.wantsPct}% of income)
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent>
          {forecastData.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
              Record checking transactions to see your spending forecast here.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={forecastData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                <Tooltip
                  formatter={(v: number, name: string) => [formatCurrency(v), name]}
                  labelFormatter={formatMonth}
                  contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }}
                />
                <Bar dataKey="debits" name="Debits" radius={[4, 4, 0, 0]}>
                  {forecastData.map((entry, i) => (
                    <Cell key={i} fill={entry.isProjected ? "var(--color-danger)" : "var(--color-chart-1)"} fillOpacity={entry.isProjected ? 0.4 : 0.85} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="credits" name="Credits" stroke="var(--color-success)" strokeWidth={2} dot={false} />
                {spendingTarget > 0 && (
                  <ReferenceLine
                    y={spendingTarget}
                    stroke="var(--color-warning)"
                    strokeDasharray="6 3"
                    strokeWidth={1.5}
                    label={{ value: "Budget", fill: "var(--color-warning)", fontSize: 10, position: "insideTopRight" }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[var(--color-chart-1)]" /> Actual debits</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[var(--color-danger)] opacity-40" /> Projected debits</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[var(--color-success)]" /> Credits</span>
            {spendingTarget > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-0 w-3 border-t-2 border-dashed border-[var(--color-warning)]" /> Planning budget
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function addMonths(yyyyMM: string, n: number): string {
  const [y, m] = yyyyMM.split("-").map(Number) as [number, number];
  const date = new Date(y, m - 1 + n, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
