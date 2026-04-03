import React, { useEffect, useState, useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
  AreaChart, Area,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, formatCurrency } from "@milly-maker/ui";
import { useDb } from "@/db/hooks/useDb.js";
import { getMonthlyCreditTotals, getMonthlyDebitTotals } from "@/db/queries/checking.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", { month: "short", year: "2-digit" });
}

const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
  fontSize: "12px",
  fontFamily: "Lora, serif",
};

// ── Custom tooltip ────────────────────────────────────────────────────────────

function CashFlowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const income   = payload.find((p: any) => p.dataKey === "income")?.value ?? 0;
  const expenses = payload.find((p: any) => p.dataKey === "expenses")?.value ?? 0;
  const net      = income - expenses;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 flex flex-col gap-1">
      <p className="font-semibold text-[var(--color-text)] mb-1">{label}</p>
      <p className="text-[var(--color-chart-2)]">Income:&nbsp;&nbsp;&nbsp;{formatCurrency(income)}</p>
      <p className="text-[var(--color-chart-1)]">Expenses: {formatCurrency(expenses)}</p>
      <p
        className="border-t border-[var(--color-border-subtle)] pt-1 mt-1 font-medium"
        style={{ color: net >= 0 ? "var(--color-success)" : "var(--color-danger)" }}
      >
        Net: {net >= 0 ? "+" : ""}{formatCurrency(net)}
      </p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const { conn } = useDb();
  const [credits, setCredits] = useState<{ month: string; total: number }[]>([]);
  const [debits,  setDebits]  = useState<{ month: string; total: number }[]>([]);

  useEffect(() => {
    if (!conn) return;
    void Promise.all([
      getMonthlyCreditTotals(conn),
      getMonthlyDebitTotals(conn),
    ]).then(([c, d]) => { setCredits(c); setDebits(d); });
  }, [conn]);

  // Merge into unified monthly rows, sorted chronologically
  const monthlyData = useMemo(() => {
    const map = new Map<string, { income: number; expenses: number }>();
    for (const c of credits) map.set(c.month, { income: c.total, expenses: 0 });
    for (const d of debits) {
      const row = map.get(d.month) ?? { income: 0, expenses: 0 };
      row.expenses = d.total;
      map.set(d.month, row);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { income, expenses }]) => ({
        month: fmtMonth(month),
        income:   Math.round(income * 100) / 100,
        expenses: Math.round(expenses * 100) / 100,
        net:      Math.round((income - expenses) * 100) / 100,
      }));
  }, [credits, debits]);

  // Cumulative net cash flow
  const cumulativeData = useMemo(() => {
    let running = 0;
    return monthlyData.map((d) => {
      running += d.net;
      return { month: d.month, cumulative: Math.round(running * 100) / 100 };
    });
  }, [monthlyData]);

  // Summary stats
  const stats = useMemo(() => {
    if (monthlyData.length === 0) return null;
    const n = monthlyData.length;
    const avgIncome   = monthlyData.reduce((s, d) => s + d.income, 0) / n;
    const avgExpenses = monthlyData.reduce((s, d) => s + d.expenses, 0) / n;
    const avgNet      = avgIncome - avgExpenses;
    const totalNet    = monthlyData.reduce((s, d) => s + d.net, 0);
    const posMonths   = monthlyData.filter((d) => d.net > 0).length;
    return { avgIncome, avgExpenses, avgNet, totalNet, posMonths, n };
  }, [monthlyData]);

  const hasData = monthlyData.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Reports</h1>

      {!hasData ? (
        <Card>
          <CardContent className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
            Add transactions in Checking to see your cash flow analysis.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary stat cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "Avg Monthly Income",   value: stats!.avgIncome,   color: "var(--color-success)" },
              { label: "Avg Monthly Spending",  value: stats!.avgExpenses, color: "var(--color-danger)"  },
              { label: "Avg Net Cash Flow",     value: stats!.avgNet,      color: stats!.avgNet >= 0 ? "var(--color-success)" : "var(--color-danger)" },
              { label: "Total Net (all time)",  value: stats!.totalNet,    color: stats!.totalNet >= 0 ? "var(--color-success)" : "var(--color-danger)" },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                style={{ borderLeftWidth: 3, borderLeftColor: color }}
              >
                <p className="text-xs text-[var(--color-text-muted)] mb-1">{label}</p>
                <p className="text-xl font-semibold tabular-nums" style={{ color }}>
                  {value >= 0 ? "" : "–"}{formatCurrency(Math.abs(value))}
                </p>
              </div>
            ))}
          </div>

          {/* Monthly cash flow bar + net line */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Cash Flow</CardTitle>
              <p className="text-xs text-[var(--color-text-muted)]">
                Income vs spending per month.
                Positive net months: {stats!.posMonths} of {stats!.n}.
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "var(--color-text-subtle)", fontFamily: "DM Mono, monospace" }}
                  />
                  <YAxis
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11, fill: "var(--color-text-subtle)", fontFamily: "DM Mono, monospace" }}
                  />
                  <Tooltip content={<CashFlowTooltip />} />
                  <Legend
                    iconType="square"
                    iconSize={10}
                    wrapperStyle={{ fontSize: 12, fontFamily: "Lora, serif", paddingTop: 8 }}
                  />
                  <ReferenceLine y={0} stroke="var(--color-border)" strokeWidth={1.5} />
                  <Bar dataKey="income"   name="Income"   fill="var(--color-chart-2)" radius={[3, 3, 0, 0]} maxBarSize={32} opacity={0.85} />
                  <Bar dataKey="expenses" name="Spending" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} maxBarSize={32} opacity={0.85} />
                  <Line
                    dataKey="net"
                    name="Net"
                    type="monotone"
                    stroke="var(--color-text-muted)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "var(--color-surface)", stroke: "var(--color-text-muted)", strokeWidth: 2 }}
                    strokeDasharray="4 3"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Cumulative net */}
          <Card>
            <CardHeader>
              <CardTitle>Cumulative Net Cash Flow</CardTitle>
              <p className="text-xs text-[var(--color-text-muted)]">
                Running total of income minus spending. A rising line means you're consistently saving.
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={cumulativeData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--color-chart-2)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--color-chart-2)" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "var(--color-text-subtle)", fontFamily: "DM Mono, monospace" }}
                  />
                  <YAxis
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11, fill: "var(--color-text-subtle)", fontFamily: "DM Mono, monospace" }}
                  />
                  <Tooltip
                    formatter={(v: number) => [formatCurrency(v), "Cumulative Net"]}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <ReferenceLine y={0} stroke="var(--color-border)" strokeWidth={1.5} />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    name="Cumulative Net"
                    stroke="var(--color-chart-2)"
                    fill="url(#cumGrad)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "var(--color-surface)", stroke: "var(--color-chart-2)", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
