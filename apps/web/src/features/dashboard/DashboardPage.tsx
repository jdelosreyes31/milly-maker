import React, { useEffect, useState } from "react";
import { DollarSign, CreditCard, TrendingUp, Landmark, PiggyBank } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, StatCard, formatCurrency } from "@milly-maker/ui";
import { useDebts } from "@/db/hooks/useDebts.js";
import { useInvestments } from "@/db/hooks/useInvestments.js";
import { useDb } from "@/db/hooks/useDb.js";
import { getNetWorthHistory } from "@/db/queries/investments.js";
import { getCheckingBalanceSummary } from "@/db/queries/checking.js";
import { getSavingsBalanceSummary } from "@/db/queries/savings.js";
import type { SavingsAccountType } from "@/db/queries/savings.js";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, Cell,
} from "recharts";

const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6"];

export function DashboardPage() {
  const { conn } = useDb();
  const { totalDebt, totalMinPayment } = useDebts();
  const { totalValue, totalMonthlyContribution } = useInvestments();
  const [netWorthHistory, setNetWorthHistory] = useState<{ snapshot_date: string; net_worth: number }[]>([]);
  const [checkingAccounts, setCheckingAccounts] = useState<
    { account_id: string; account_name: string; current_balance: number }[]
  >([]);
  const [savingsAccounts, setSavingsAccounts] = useState<
    { account_id: string; account_name: string; account_type: SavingsAccountType; apr: number; current_balance: number }[]
  >([]);

  const netWorth = totalValue - totalDebt;
  const totalChecking = checkingAccounts.reduce((s, a) => s + a.current_balance, 0);
  const totalSavings = savingsAccounts.reduce((s, a) => s + a.current_balance, 0);

  useEffect(() => {
    if (!conn) return;
    void getNetWorthHistory(conn).then((data) =>
      setNetWorthHistory(data.map((d) => ({ snapshot_date: d.snapshot_date, net_worth: d.net_worth })))
    );
  }, [conn, totalValue, totalDebt]);

  useEffect(() => {
    if (!conn) return;
    void getCheckingBalanceSummary(conn).then(setCheckingAccounts);
    void getSavingsBalanceSummary(conn).then(setSavingsAccounts);
  }, [conn]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Net Worth"
          value={formatCurrency(netWorth, true)}
          trend={netWorth >= 0 ? "up" : "down"}
          icon={<DollarSign size={16} />}
          accentColor={netWorth >= 0 ? "var(--color-success)" : "var(--color-danger)"}
        />
        <StatCard
          label="Checking"
          value={formatCurrency(totalChecking, true)}
          subValue={`${checkingAccounts.length} account${checkingAccounts.length !== 1 ? "s" : ""}`}
          icon={<Landmark size={16} />}
          accentColor="var(--color-chart-3)"
        />
        <StatCard
          label="Savings"
          value={formatCurrency(totalSavings, true)}
          subValue={`${savingsAccounts.length} account${savingsAccounts.length !== 1 ? "s" : ""}`}
          icon={<PiggyBank size={16} />}
          accentColor="var(--color-chart-2)"
        />
        <StatCard
          label="Investments"
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
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
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

        {/* Checking account balances */}
        <Card>
          <CardHeader>
            <CardTitle>Checking Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {checkingAccounts.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
                No checking accounts set up yet. Head to Checking to add one.
              </div>
            ) : checkingAccounts.length === 1 ? (
              <div className="flex h-40 items-center justify-center">
                <div className="text-center">
                  <p className="text-xs text-[var(--color-text-muted)] mb-1">{checkingAccounts[0]!.account_name}</p>
                  <p className={`text-3xl font-bold ${checkingAccounts[0]!.current_balance < 0 ? "text-[var(--color-danger)]" : ""}`}>
                    {formatCurrency(checkingAccounts[0]!.current_balance)}
                  </p>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={checkingAccounts.map((a, i) => ({
                    name: a.account_name,
                    balance: a.current_balance,
                    color: CHART_COLORS[i % CHART_COLORS.length]!,
                  }))}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                  <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }} />
                  <Bar dataKey="balance" name="Balance" radius={[4, 4, 0, 0]}>
                    {checkingAccounts.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Savings account balances */}
        <Card>
          <CardHeader>
            <CardTitle>Savings Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {savingsAccounts.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
                No savings accounts set up yet. Head to Savings to add one.
              </div>
            ) : savingsAccounts.length === 1 ? (
              <div className="flex h-40 items-center justify-center">
                <div className="text-center">
                  <p className="text-xs text-[var(--color-text-muted)] mb-1">{savingsAccounts[0]!.account_name}</p>
                  <p className="text-3xl font-bold">{formatCurrency(savingsAccounts[0]!.current_balance)}</p>
                  {savingsAccounts[0]!.apr > 0 && (
                    <p className="mt-1 text-xs text-[var(--color-success)]">
                      {(savingsAccounts[0]!.apr * 100).toFixed(2)}% APR
                      &nbsp;·&nbsp;~{formatCurrency(savingsAccounts[0]!.current_balance * savingsAccounts[0]!.apr)}/yr
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 pt-1">
                {savingsAccounts.map((a, i) => (
                  <div key={a.account_id} className="flex items-center justify-between rounded-[var(--radius)] px-3 py-2 bg-[var(--color-surface-raised)]">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <div>
                        <p className="text-sm font-medium">{a.account_name}</p>
                        {a.apr > 0 && (
                          <p className="text-xs text-[var(--color-success)]">{(a.apr * 100).toFixed(2)}% APR</p>
                        )}
                      </div>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatCurrency(a.current_balance)}</p>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 pt-1 border-t border-[var(--color-border)]">
                  <p className="text-xs text-[var(--color-text-muted)]">Total</p>
                  <p className="text-sm font-bold tabular-nums">{formatCurrency(totalSavings)}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick tip */}
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
