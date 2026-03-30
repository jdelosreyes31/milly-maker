import React, { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, Badge, formatCurrency, formatMonth } from "@milly-maker/ui";
import { useDb } from "@/db/hooks/useDb.js";
import { getMonthlyTotals } from "@/db/queries/expenses.js";
import { generateBudgetForecast, analyze503020 } from "@milly-maker/finance-engine";
import type { HistoricalExpense, CategorySpend, SpendingBucket } from "@milly-maker/finance-engine";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import { useCategories } from "@/db/hooks/useCategories.js";

// Rough bucket mapping (user can extend later via settings)
const BUCKET_MAP: Record<string, SpendingBucket> = {
  "cat-housing": "needs",
  "cat-utilities": "needs",
  "cat-groceries": "needs",
  "cat-transport": "needs",
  "cat-healthcare": "needs",
  "cat-dining": "wants",
  "cat-entertainment": "wants",
  "cat-subscriptions": "wants",
  "cat-shopping": "wants",
  "cat-other": "wants",
  "cat-savings": "savings",
};

export function ForecastPage() {
  const { conn } = useDb();
  const { expenseCategories } = useCategories();
  const [monthlyTotals, setMonthlyTotals] = useState<{ month: string; category_id: string; category_name: string; total: number }[]>([]);
  const [monthlyIncome, setMonthlyIncome] = useState(5000);

  useEffect(() => {
    if (!conn) return;
    void getMonthlyTotals(conn).then(setMonthlyTotals);
  }, [conn]);

  const historicalExpenses: HistoricalExpense[] = monthlyTotals.map((r) => ({
    month: r.month, categoryId: r.category_id, total: r.total,
  }));

  const forecastPoints = useMemo(
    () =>
      generateBudgetForecast({
        historicalExpenses,
        budgetTargets: expenseCategories.map((c) => ({ categoryId: c.id, targetAmount: 0 })),
        months: 6,
      }),
    [historicalExpenses, expenseCategories]
  );

  // Aggregate across categories per month for chart
  const allMonths = [...new Set(forecastPoints.map((p) => p.month))].sort();
  const chartData = allMonths.map((month) => {
    const pts = forecastPoints.filter((p) => p.month === month);
    const total = pts.reduce((s, p) => s + p.projected, 0);
    const isProjected = pts.some((p) => p.isProjected);
    return { month, total, isProjected };
  });

  // 50/30/20 analysis for current month
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthExpenses: CategorySpend[] = monthlyTotals
    .filter((r) => r.month === currentMonth)
    .map((r) => ({
      categoryId: r.category_id,
      amount: r.total,
      bucket: BUCKET_MAP[r.category_id] ?? "wants",
    }));

  const rule = analyze503020(monthlyIncome, currentMonthExpenses);
  const scoreColor =
    rule.score === "on-track" ? "success" :
    rule.score === "warning" ? "warning" : "danger";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Forecast</h1>

      {/* 50/30/20 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>50/30/20 Rule — {formatMonth(currentMonth)}</CardTitle>
            <Badge variant={scoreColor}>{rule.score}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-3">
            <label className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">Monthly Income ($)</label>
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
            {(["needs", "wants", "savings"] as const).map((bucket) => {
              const data = rule[bucket];
              const over = data.percentage > data.target + 5;
              const warn = !over && data.percentage > data.target;
              return (
                <div key={bucket} className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{bucket}</p>
                  <p className="text-2xl font-bold">{data.percentage}%</p>
                  <p className="text-xs text-[var(--color-text-muted)]">target: {data.target}%</p>
                  <p className="mt-1 text-sm font-medium">{formatCurrency(data.amount)}</p>
                  {over && <p className="mt-1 text-xs text-[var(--color-danger)]">Over by {(data.percentage - data.target).toFixed(1)}%</p>}
                  {warn && <p className="mt-1 text-xs text-[var(--color-warning)]">Slightly over target</p>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 6-month spending forecast */}
      <Card>
        <CardHeader>
          <CardTitle>6-Month Spending Forecast</CardTitle>
          <p className="text-xs text-[var(--color-text-muted)]">Based on your trailing 3-month spending trend. Bars = actual, line = projected.</p>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
              Record at least 1 month of expenses to see your forecast.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} labelFormatter={formatMonth} contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="total" name="Spending" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.isProjected ? "var(--color-chart-1)" : "var(--color-chart-2)"} fillOpacity={entry.isProjected ? 0.5 : 0.9} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <div className="mt-2 flex gap-4 text-xs text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[var(--color-chart-2)]" /> Actual</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[var(--color-chart-1)] opacity-50" /> Projected</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
