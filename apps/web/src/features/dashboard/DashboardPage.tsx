import React, { useEffect, useState } from "react";
import { DollarSign, CreditCard, TrendingUp, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, StatCard, Badge, formatCurrency } from "@milly-maker/ui";
import { useDebts } from "@/db/hooks/useDebts.js";
import { useInvestments } from "@/db/hooks/useInvestments.js";
import { useDb } from "@/db/hooks/useDb.js";
import { getNetWorthHistory } from "@/db/queries/investments.js";
import { getMonthlyTotals } from "@/db/queries/expenses.js";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, Legend,
} from "recharts";

const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#94a3b8"];

export function DashboardPage() {
  const { conn } = useDb();
  const { totalDebt, totalMinPayment } = useDebts();
  const { totalValue, totalMonthlyContribution } = useInvestments();
  const [netWorthHistory, setNetWorthHistory] = useState<{ snapshot_date: string; net_worth: number }[]>([]);
  const [spendingByCategory, setSpendingByCategory] = useState<{ name: string; value: number; color: string }[]>([]);

  const netWorth = totalValue - totalDebt;

  useEffect(() => {
    if (!conn) return;
    void getNetWorthHistory(conn).then((data) =>
      setNetWorthHistory(data.map((d) => ({ snapshot_date: d.snapshot_date, net_worth: d.net_worth })))
    );
  }, [conn, totalValue, totalDebt]);

  useEffect(() => {
    if (!conn) return;
    const now = new Date();
    void getMonthlyTotals(conn).then((data) => {
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const thisMonth = data.filter((d) => d.month === currentMonth);
      // Merge by category_name
      const map = new Map<string, number>();
      for (const row of thisMonth) {
        map.set(row.category_name, (map.get(row.category_name) ?? 0) + row.total);
      }
      setSpendingByCategory(
        Array.from(map.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name, value], i) => ({ name, value, color: CHART_COLORS[i % CHART_COLORS.length]! }))
      );
    });
  }, [conn]);

  const totalMonthlySpend = spendingByCategory.reduce((s, c) => s + c.value, 0);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Net Worth"
          value={formatCurrency(netWorth, true)}
          trend={netWorth >= 0 ? "up" : "down"}
          icon={<DollarSign size={16} />}
          accentColor={netWorth >= 0 ? "var(--color-success)" : "var(--color-danger)"}
        />
        <StatCard
          label="Total Investments"
          value={formatCurrency(totalValue, true)}
          subValue={`+${formatCurrency(totalMonthlyContribution)}/mo`}
          icon={<TrendingUp size={16} />}
          accentColor="var(--color-chart-1)"
        />
        <StatCard
          label="Total Debt"
          value={formatCurrency(totalDebt, true)}
          subValue={`${formatCurrency(totalMinPayment)}/mo min`}
          icon={<CreditCard size={16} />}
          accentColor="var(--color-danger)"
        />
        <StatCard
          label="Spent This Month"
          value={formatCurrency(totalMonthlySpend, true)}
          icon={<Receipt size={16} />}
          accentColor="var(--color-warning)"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Net worth history */}
        <Card>
          <CardHeader><CardTitle>Net Worth Over Time</CardTitle></CardHeader>
          <CardContent>
            {netWorthHistory.length < 2 ? (
              <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
                Update your investments and debts weekly to see your trend here.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={netWorthHistory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                  <XAxis dataKey="snapshot_date" tick={{ fontSize: 10, fill: "var(--color-text-subtle)" }} />
                  <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: "var(--color-text-subtle)" }} />
                  <Tooltip formatter={(v: number) => formatCurrency(v, true)} contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }} />
                  <Area type="monotone" dataKey="net_worth" name="Net Worth" stroke="var(--color-chart-1)" fill="url(#nwGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Spending breakdown */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Spending This Month</CardTitle>
              <Badge variant="muted">{formatCurrency(totalMonthlySpend)}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {spendingByCategory.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
                No expenses recorded this month yet.
              </div>
            ) : (
              <div className="flex gap-4">
                <ResponsiveContainer width="50%" height={160}>
                  <PieChart>
                    <Pie data={spendingByCategory} dataKey="value" cx="50%" cy="50%" outerRadius={65} innerRadius={35}>
                      {spendingByCategory.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-1 flex-col justify-center gap-1.5">
                  {spendingByCategory.slice(0, 6).map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="ml-2 shrink-0 text-[var(--color-text-muted)]">{formatCurrency(c.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick tips */}
      <Card>
        <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--color-text-muted)]">
            Open the <strong className="text-[var(--color-text)]">Claude</strong> panel in the sidebar to ask for personalized financial advice based on your current data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
