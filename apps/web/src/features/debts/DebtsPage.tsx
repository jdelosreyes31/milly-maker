import React, { useState, useMemo } from "react";
import { Plus, Trash2, Pencil, CreditCard, TrendingDown, TrendingUp } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle,
  Dialog, Input, Select, Badge, StatCard, formatCurrency, formatPercent,
} from "@milly-maker/ui";
import { useDebts } from "@/db/hooks/useDebts.js";
import { DEBT_TYPES } from "@/db/queries/debts.js";
import { calculateAvalanche, calculateSnowball } from "@milly-maker/finance-engine";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import type { Debt } from "@/db/queries/debts.js";

// ── Constants ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "log";

// ── Page ──────────────────────────────────────────────────────────────────────

export function DebtsPage() {
  const { debts, debtLog, loading, add, edit, remove, addPayment, addCharge, totalDebt, totalMinPayment } = useDebts();

  const [tab, setTab] = useState<Tab>("overview");

  // ── Debt add/edit dialog ─────────────────────────────────────────────────
  interface DebtForm {
    name: string; debt_type: string; current_balance: string;
    original_balance: string; interest_rate: string; minimum_payment: string; due_day: string;
  }
  const EMPTY_FORM: DebtForm = {
    name: "", debt_type: "credit_card", current_balance: "", original_balance: "",
    interest_rate: "", minimum_payment: "", due_day: "",
  };

  const [debtDialog, setDebtDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [debtForm, setDebtForm] = useState<DebtForm>(EMPTY_FORM);
  const [debtErrors, setDebtErrors] = useState<Partial<DebtForm>>({});
  const [saving, setSaving] = useState(false);

  // ── Charge (interest / fee) dialog ──────────────────────────────────────
  interface ChargeForm {
    debt_id: string; amount: string; charge_date: string;
    entry_type: "interest" | "fee"; notes: string;
  }
  const [chargeDialog, setChargeDialog] = useState(false);
  const [chargeForm, setChargeForm] = useState<ChargeForm>({
    debt_id: "", amount: "", charge_date: new Date().toISOString().slice(0, 10),
    entry_type: "interest", notes: "",
  });
  const [chargeErrors, setChargeErrors] = useState<Partial<ChargeForm>>({});

  // ── Manual payment dialog (standalone, outside of checking) ─────────────
  interface PayForm { debt_id: string; amount: string; payment_date: string; notes: string; }
  const [payDialog, setPayDialog] = useState(false);
  const [payForm, setPayForm] = useState<PayForm>({
    debt_id: "", amount: "", payment_date: new Date().toISOString().slice(0, 10), notes: "",
  });
  const [payErrors, setPayErrors] = useState<Partial<PayForm>>({});

  const [extraPayment, setExtraPayment] = useState("200");

  // ── Debt dialog helpers ──────────────────────────────────────────────────
  function openAdd() { setEditingId(null); setDebtForm(EMPTY_FORM); setDebtErrors({}); setDebtDialog(true); }
  function openEdit(d: Debt) {
    setEditingId(d.id);
    setDebtForm({
      name: d.name, debt_type: d.debt_type,
      current_balance: String(d.current_balance),
      original_balance: String(d.original_balance),
      interest_rate: String(Math.round(d.interest_rate * 10000) / 100),
      minimum_payment: String(d.minimum_payment),
      due_day: d.due_day ? String(d.due_day) : "",
    });
    setDebtErrors({}); setDebtDialog(true);
  }
  async function handleSaveDebt() {
    const e: Partial<DebtForm> = {};
    if (!debtForm.name.trim()) e.name = "Required";
    if (!debtForm.current_balance || Number(debtForm.current_balance) < 0) e.current_balance = "Required";
    if (!debtForm.original_balance || Number(debtForm.original_balance) < 0) e.original_balance = "Required";
    if (!debtForm.interest_rate || Number(debtForm.interest_rate) < 0) e.interest_rate = "Enter APR";
    if (!debtForm.minimum_payment || Number(debtForm.minimum_payment) < 0) e.minimum_payment = "Required";
    if (Object.keys(e).length) { setDebtErrors(e); return; }
    setSaving(true);
    const data = {
      name: debtForm.name.trim(), debt_type: debtForm.debt_type,
      current_balance: Number(debtForm.current_balance),
      original_balance: Number(debtForm.original_balance),
      interest_rate: Number(debtForm.interest_rate) / 100,
      minimum_payment: Number(debtForm.minimum_payment),
      due_day: debtForm.due_day ? Number(debtForm.due_day) : null,
    };
    if (editingId) await edit(editingId, data); else await add(data);
    setSaving(false); setDebtDialog(false);
  }

  // ── Charge dialog helpers ────────────────────────────────────────────────
  function openCharge(debtId: string) {
    setChargeForm({
      debt_id: debtId, amount: "", charge_date: new Date().toISOString().slice(0, 10),
      entry_type: "interest", notes: "",
    });
    setChargeErrors({}); setChargeDialog(true);
  }
  async function handleSaveCharge() {
    const e: Partial<ChargeForm> = {};
    if (!chargeForm.amount || Number(chargeForm.amount) <= 0) e.amount = "Enter amount";
    if (Object.keys(e).length) { setChargeErrors(e); return; }
    setSaving(true);
    await addCharge({
      debt_id: chargeForm.debt_id,
      amount: Number(chargeForm.amount),
      charge_date: chargeForm.charge_date,
      entry_type: chargeForm.entry_type,
      notes: chargeForm.notes.trim() || undefined,
    });
    setSaving(false); setChargeDialog(false);
  }

  // ── Payment dialog helpers ───────────────────────────────────────────────
  function openPay(debtId: string) {
    setPayForm({ debt_id: debtId, amount: "", payment_date: new Date().toISOString().slice(0, 10), notes: "" });
    setPayErrors({}); setPayDialog(true);
  }
  async function handleSavePay() {
    const e: Partial<PayForm> = {};
    if (!payForm.amount || Number(payForm.amount) <= 0) e.amount = "Enter amount";
    if (Object.keys(e).length) { setPayErrors(e); return; }
    setSaving(true);
    await addPayment({
      debt_id: payForm.debt_id,
      payment_amount: Number(payForm.amount),
      payment_date: payForm.payment_date,
      notes: payForm.notes.trim() || undefined,
    });
    setSaving(false); setPayDialog(false);
  }

  // ── Payoff planner ───────────────────────────────────────────────────────
  const engineDebts = debts.map((d) => ({
    id: d.id, name: d.name, balance: d.current_balance,
    apr: d.interest_rate, minimumPayment: d.minimum_payment,
  }));
  const extra = Number(extraPayment) || 0;
  const { avalanche, snowball } = useMemo(() => {
    if (engineDebts.length === 0) return { avalanche: null, snowball: null };
    return { avalanche: calculateAvalanche(engineDebts, extra), snowball: calculateSnowball(engineDebts, extra) };
  }, [engineDebts, extra]);
  const chartData = useMemo(() => {
    if (!avalanche || !snowball) return [];
    const maxM = Math.max(avalanche.totalMonths, snowball.totalMonths);
    return Array.from({ length: maxM }, (_, i) => ({
      month: i + 1,
      avalanche: avalanche.monthlyCashflow[i]?.totalBalance ?? 0,
      snowball: snowball.monthlyCashflow[i]?.totalBalance ?? 0,
    }));
  }, [avalanche, snowball]);

  // ── Log tab stats ────────────────────────────────────────────────────────
  const now = new Date();
  const ytdStart = `${now.getFullYear()}-01-01`;
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const ytdPaid = debtLog
    .filter((e) => e.entry_type === "payment" && e.payment_date >= ytdStart)
    .reduce((s, e) => s + e.payment_amount, 0);
  const ytdInterest = debtLog
    .filter((e) => e.entry_type !== "payment" && e.payment_date >= ytdStart)
    .reduce((s, e) => s + e.payment_amount, 0);
  const monthPaid = debtLog
    .filter((e) => e.entry_type === "payment" && e.payment_date.startsWith(currentMonthStr))
    .reduce((s, e) => s + e.payment_amount, 0);

  // Monthly bar chart data for log tab
  const logChartData = useMemo(() => {
    const byMonth: Record<string, { paid: number; interest: number }> = {};
    for (const e of debtLog) {
      const month = e.payment_date.slice(0, 7);
      if (!byMonth[month]) byMonth[month] = { paid: 0, interest: 0 };
      if (e.entry_type === "payment") byMonth[month]!.paid += e.payment_amount;
      else byMonth[month]!.interest += e.payment_amount;
    }
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month: new Date(month + "-15").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        paid: Math.round(v.paid * 100) / 100,
        interest: Math.round(v.interest * 100) / 100,
      }));
  }, [debtLog]);

  // YTD paid per debt (for debt list badge)
  const ytdPaidByDebt = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of debtLog) {
      if (e.entry_type === "payment" && e.payment_date >= ytdStart) {
        map[e.debt_id] = (map[e.debt_id] ?? 0) + e.payment_amount;
      }
    }
    return map;
  }, [debtLog, ytdStart]);

  const highestApr = debts.reduce<Debt | null>((best, d) => (!best || d.interest_rate > best.interest_rate ? d : best), null);
  const totalPaidEver = debtLog.filter((e) => e.entry_type === "payment").reduce((s, e) => s + e.payment_amount, 0);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Debts</h1>
        <Button onClick={openAdd} size="sm"><Plus size={14} /> Add Debt</Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Debt" value={formatCurrency(totalDebt)} accentColor="var(--color-danger)" icon={<CreditCard size={16} />} />
        <StatCard label="Min. Monthly" value={formatCurrency(totalMinPayment)} subValue="minimum payments" />
        <StatCard label="Paid This Month" value={formatCurrency(monthPaid)} accentColor="var(--color-success)" />
        <StatCard label="Total Paid" value={formatCurrency(totalPaidEver)} subValue="all time" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {(["overview", "log"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === "overview" && (
        <>
          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
          ) : debts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                No debts tracked. <button onClick={openAdd} className="text-[var(--color-primary)] underline">Add one</button>.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader><CardTitle>All Debts</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                      <th className="pb-2">Name</th>
                      <th className="pb-2 text-right">Balance</th>
                      <th className="pb-2 text-right">APR</th>
                      <th className="pb-2 text-right">Min</th>
                      <th className="pb-2 text-right">Paid YTD</th>
                      <th className="pb-2 w-28" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {debts.map((d) => {
                      const paid = ytdPaidByDebt[d.id] ?? 0;
                      const progress = d.original_balance > 0
                        ? Math.min(100, Math.round((1 - d.current_balance / d.original_balance) * 100))
                        : 0;
                      return (
                        <tr key={d.id} className="group">
                          <td className="py-3">
                            <p className="font-medium">{d.name}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="h-1.5 w-24 rounded-full bg-[var(--color-border)]">
                                <div
                                  className="h-1.5 rounded-full bg-[var(--color-success)]"
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-[var(--color-text-subtle)]">{progress}% paid off</span>
                            </div>
                          </td>
                          <td className="py-3 text-right text-[var(--color-danger)] tabular-nums">
                            {formatCurrency(d.current_balance)}
                          </td>
                          <td className="py-3 text-right tabular-nums">
                            <span className={d.interest_rate > 0.15 ? "text-[var(--color-warning)]" : ""}>
                              {formatPercent(d.interest_rate * 100)}
                            </span>
                          </td>
                          <td className="py-3 text-right text-[var(--color-text-muted)] tabular-nums">
                            {formatCurrency(d.minimum_payment)}
                          </td>
                          <td className="py-3 text-right tabular-nums text-[var(--color-success)] text-xs">
                            {paid > 0 ? `+${formatCurrency(paid)}` : "—"}
                          </td>
                          <td className="py-3">
                            <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => openPay(d.id)}
                                className="rounded px-2 py-0.5 text-xs font-medium text-[var(--color-success)] border border-[var(--color-success)]/30 hover:bg-[var(--color-success)]/8 transition-colors"
                              >
                                Pay
                              </button>
                              <button
                                onClick={() => openCharge(d.id)}
                                className="rounded px-2 py-0.5 text-xs font-medium text-[var(--color-warning)] border border-[var(--color-warning)]/30 hover:bg-[var(--color-warning)]/8 transition-colors"
                              >
                                +Interest
                              </button>
                              <button onClick={() => openEdit(d)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"><Pencil size={12} /></button>
                              <button onClick={() => remove(d.id)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"><Trash2 size={12} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Payoff planner */}
          {debts.length > 0 && avalanche && snowball && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Payoff Planner</CardTitle>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Avalanche (highest APR first) vs Snowball (smallest balance first)
                    </p>
                  </div>
                  <div className="w-40 shrink-0">
                    <Input label="Extra monthly ($)" type="number" min="0" value={extraPayment} onChange={(e) => setExtraPayment(e.target.value)} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
                  <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-3">
                    <p className="mb-1 font-medium text-[var(--color-chart-1)]">Avalanche</p>
                    <p>{avalanche.totalMonths} months to debt-free</p>
                    <p className="text-[var(--color-text-muted)]">{formatCurrency(avalanche.totalInterestPaid)} total interest</p>
                    {highestApr && <p className="text-xs text-[var(--color-text-subtle)]">Focus: {highestApr.name}</p>}
                  </div>
                  <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-3">
                    <p className="mb-1 font-medium text-[var(--color-chart-2)]">Snowball</p>
                    <p>{snowball.totalMonths} months to debt-free</p>
                    <p className="text-[var(--color-text-muted)]">{formatCurrency(snowball.totalInterestPaid)} total interest</p>
                    <p className="text-xs text-[var(--color-text-subtle)]">
                      Saves {formatCurrency(Math.abs(snowball.totalInterestPaid - avalanche.totalInterestPaid))} more with Avalanche
                    </p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} label={{ value: "Month", position: "insideBottom", offset: -2, fontSize: 11, fill: "var(--color-text-subtle)" }} />
                    <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} labelFormatter={(l) => `Month ${l}`} contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }} />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Line type="monotone" dataKey="avalanche" name="Avalanche" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="snowball" name="Snowball" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── LOG TAB ── */}
      {tab === "log" && (
        <>
          {/* YTD summary strip */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4" style={{ borderLeftWidth: 3, borderLeftColor: "var(--color-success)" }}>
              <p className="text-xs text-[var(--color-text-muted)] mb-1">Paid YTD</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--color-success)]">{formatCurrency(ytdPaid)}</p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4" style={{ borderLeftWidth: 3, borderLeftColor: "var(--color-warning)" }}>
              <p className="text-xs text-[var(--color-text-muted)] mb-1">Interest Added YTD</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--color-warning)]">{formatCurrency(ytdInterest)}</p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4" style={{ borderLeftWidth: 3, borderLeftColor: ytdPaid > ytdInterest ? "var(--color-success)" : "var(--color-danger)" }}>
              <p className="text-xs text-[var(--color-text-muted)] mb-1">Net YTD</p>
              <p className={`text-xl font-semibold tabular-nums ${ytdPaid > ytdInterest ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                {ytdPaid >= ytdInterest ? "+" : ""}{formatCurrency(ytdPaid - ytdInterest)}
              </p>
            </div>
          </div>

          {/* Monthly chart */}
          {logChartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Monthly Activity</CardTitle>
                <p className="text-xs text-[var(--color-text-muted)]">Payments made vs interest/fees added per month</p>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={logChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                    <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }} />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Bar dataKey="paid" name="Paid" fill="#12b76a" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="interest" name="Interest / Fees" fill="#f79009" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Transaction log table */}
          <Card>
            <CardHeader><CardTitle>Transaction Log</CardTitle></CardHeader>
            <CardContent>
              {debtLog.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                  No entries yet. Log a payment from the Checking tab or use the Pay / +Interest buttons in Overview.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Debt</th>
                      <th className="pb-2">Type</th>
                      <th className="pb-2">Source</th>
                      <th className="pb-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {debtLog.map((e) => {
                      const isPayment = e.entry_type === "payment";
                      return (
                        <tr key={e.id}>
                          <td className="py-2.5 tabular-nums text-[var(--color-text-muted)] whitespace-nowrap">
                            {new Date(e.payment_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                          <td className="py-2.5 font-medium">{e.debt_name}</td>
                          <td className="py-2.5">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              isPayment
                                ? "bg-[var(--color-success)]/12 text-[var(--color-success)]"
                                : e.entry_type === "interest"
                                ? "bg-[var(--color-warning)]/12 text-[var(--color-warning)]"
                                : "bg-[var(--color-danger)]/12 text-[var(--color-danger)]"
                            }`}>
                              {isPayment
                                ? <TrendingDown size={10} />
                                : <TrendingUp size={10} />}
                              {e.entry_type === "payment" ? "Payment" : e.entry_type === "interest" ? "Interest" : "Fee"}
                            </span>
                          </td>
                          <td className="py-2.5 text-[var(--color-text-muted)] text-xs">
                            {e.source_account_name
                              ? <span className="flex items-center gap-1"><CreditCard size={11} />{e.source_account_name}</span>
                              : e.notes || "—"}
                          </td>
                          <td className={`py-2.5 text-right tabular-nums font-semibold ${isPayment ? "text-[var(--color-success)]" : "text-[var(--color-warning)]"}`}>
                            {isPayment ? "-" : "+"}{formatCurrency(e.payment_amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Add/Edit Debt Dialog ── */}
      <Dialog open={debtDialog} onClose={() => setDebtDialog(false)} title={editingId ? "Edit Debt" : "Add Debt"}>
        <div className="flex flex-col gap-4">
          <Input label="Name" placeholder="e.g. Chase Sapphire" value={debtForm.name} onChange={(e) => setDebtForm((f) => ({ ...f, name: e.target.value }))} error={debtErrors.name} />
          <Select label="Type" options={DEBT_TYPES} value={debtForm.debt_type} onChange={(e) => setDebtForm((f) => ({ ...f, debt_type: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Current Balance ($)" type="number" min="0" step="0.01" value={debtForm.current_balance} onChange={(e) => setDebtForm((f) => ({ ...f, current_balance: e.target.value }))} error={debtErrors.current_balance} />
            <Input label="Original Balance ($)" type="number" min="0" step="0.01" value={debtForm.original_balance} onChange={(e) => setDebtForm((f) => ({ ...f, original_balance: e.target.value }))} error={debtErrors.original_balance} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="APR (%)" type="number" min="0" step="0.01" placeholder="e.g. 24.99" value={debtForm.interest_rate} onChange={(e) => setDebtForm((f) => ({ ...f, interest_rate: e.target.value }))} error={debtErrors.interest_rate} />
            <Input label="Min. Payment ($)" type="number" min="0" step="0.01" value={debtForm.minimum_payment} onChange={(e) => setDebtForm((f) => ({ ...f, minimum_payment: e.target.value }))} error={debtErrors.minimum_payment} />
          </div>
          <Input label="Due Day (optional)" type="number" min="1" max="31" placeholder="e.g. 15" value={debtForm.due_day} onChange={(e) => setDebtForm((f) => ({ ...f, due_day: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setDebtDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveDebt} disabled={saving}>{saving ? "Saving…" : editingId ? "Save" : "Add Debt"}</Button>
          </div>
        </div>
      </Dialog>

      {/* ── Add Interest / Fee Dialog ── */}
      <Dialog open={chargeDialog} onClose={() => setChargeDialog(false)} title="Add Charge to Debt">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            This will increase the debt's current balance and appear in the Log.
          </p>
          <Select
            label="Type"
            options={[{ value: "interest", label: "Interest Charge" }, { value: "fee", label: "Fee" }]}
            value={chargeForm.entry_type}
            onChange={(e) => setChargeForm((f) => ({ ...f, entry_type: e.target.value as "interest" | "fee" }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Amount ($)" type="number" min="0.01" step="0.01" value={chargeForm.amount} onChange={(e) => setChargeForm((f) => ({ ...f, amount: e.target.value }))} error={chargeErrors.amount} />
            <Input label="Date" type="date" value={chargeForm.charge_date} onChange={(e) => setChargeForm((f) => ({ ...f, charge_date: e.target.value }))} />
          </div>
          <Input label="Notes (optional)" placeholder="e.g. Monthly statement interest" value={chargeForm.notes} onChange={(e) => setChargeForm((f) => ({ ...f, notes: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setChargeDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveCharge} disabled={saving}>{saving ? "Saving…" : "Add Charge"}</Button>
          </div>
        </div>
      </Dialog>

      {/* ── Manual Payment Dialog ── */}
      <Dialog open={payDialog} onClose={() => setPayDialog(false)} title="Log Payment">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Log a standalone payment. To link a payment to a checking transaction, use the "Apply as debt payment" option when adding a transaction in Checking.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Amount ($)" type="number" min="0.01" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} error={payErrors.amount} />
            <Input label="Date" type="date" value={payForm.payment_date} onChange={(e) => setPayForm((f) => ({ ...f, payment_date: e.target.value }))} />
          </div>
          <Input label="Notes (optional)" value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setPayDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSavePay} disabled={saving}>{saving ? "Saving…" : "Log Payment"}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
