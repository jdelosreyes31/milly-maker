import React, { useState, useMemo, useEffect } from "react";
import { Plus, Trash2, Pencil, TrendingUp, ChevronDown, ChevronRight, Landmark } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle,
  Dialog, Input, Select, StatCard, Badge, formatCurrency, formatPercent,
} from "@milly-maker/ui";
import { useInvestments } from "@/db/hooks/useInvestments.js";
import { useDb } from "@/db/hooks/useDb.js";
import {
  ACCOUNT_TYPES, ASSET_CLASSES, CONTRIBUTION_SOURCE_TYPES,
} from "@/db/queries/investments.js";
import { getAllCheckingAccounts } from "@/db/queries/checking.js";
import { getAllSavingsAccounts } from "@/db/queries/savings.js";
import { projectInvestmentGrowth, analyzeAllocation } from "@milly-maker/finance-engine";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";
import type { Investment } from "@/db/queries/investments.js";
import { InvestmentPlanningView } from "./InvestmentPlanningView.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const CHART_COLORS = ["#5b5bd6", "#12b76a", "#f79009", "#0ea5e9", "#f43f5e", "#7c3aed", "#06b6d4"];

const ASSET_CLASS_COLORS: Record<string, string> = {
  stocks:      "#5b5bd6",
  bonds:       "#12b76a",
  cash:        "#0ea5e9",
  real_estate: "#f79009",
  crypto:      "#f43f5e",
  commodities: "#7c3aed",
  other:       "#94a3b8",
};

// ── Account form ──────────────────────────────────────────────────────────────

interface AccountForm {
  name: string; account_type: string; institution: string;
  current_value: string; cost_basis: string;
  monthly_contribution: string; expected_return: string;
}
const EMPTY_ACCOUNT: AccountForm = {
  name: "", account_type: "roth_ira", institution: "",
  current_value: "", cost_basis: "0", monthly_contribution: "0", expected_return: "7",
};

// ── Holding form ──────────────────────────────────────────────────────────────

interface HoldingForm {
  id?: string; investment_id: string;
  name: string; ticker: string; shares: string;
  current_value: string; cost_basis: string; asset_class: string;
}
const emptyHolding = (investmentId: string): HoldingForm => ({
  investment_id: investmentId, name: "", ticker: "", shares: "",
  current_value: "", cost_basis: "0", asset_class: "stocks",
});

// ── Contribution form ─────────────────────────────────────────────────────────

interface ContribForm {
  investment_id: string; amount: string; contribution_date: string;
  source_type: string; source_account_id: string; notes: string;
  update_value: boolean;
}
const emptyContrib = (investmentId = ""): ContribForm => ({
  investment_id: investmentId, amount: "", contribution_date: new Date().toISOString().slice(0, 10),
  source_type: "checking", source_account_id: "", notes: "", update_value: true,
});

// ── Page ──────────────────────────────────────────────────────────────────────

export function InvestmentsPage() {
  const { conn } = useDb();
  const {
    investments, holdings, contributions, loading,
    holdingsByAccount, add, edit, remove,
    addOrEditHolding, removeHolding,
    addContribution, removeContribution,
    totalValue, totalMonthlyContribution, totalHoldings,
  } = useInvestments();

  // Checking/savings accounts for contribution source dropdown
  const [checkingAccounts, setCheckingAccounts] = useState<{ id: string; name: string }[]>([]);
  const [savingsAccounts, setSavingsAccounts] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!conn) return;
    void Promise.all([
      getAllCheckingAccounts(conn),
      getAllSavingsAccounts(conn),
    ]).then(([ca, sa]) => {
      setCheckingAccounts(ca.map((a) => ({ id: a.id, name: a.name })));
      setSavingsAccounts(sa.map((a) => ({ id: a.id, name: a.name })));
    });
  }, [conn]);

  // ── Dialog states ────────────────────────────────────────────────────────
  const [accountDialog, setAccountDialog] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>(EMPTY_ACCOUNT);
  const [accountErrors, setAccountErrors] = useState<Partial<AccountForm>>({});

  const [holdingDialog, setHoldingDialog] = useState(false);
  const [holdingForm, setHoldingForm] = useState<HoldingForm>(emptyHolding(""));
  const [holdingErrors, setHoldingErrors] = useState<Partial<HoldingForm>>({});

  const [contribDialog, setContribDialog] = useState(false);
  const [contribForm, setContribForm] = useState<ContribForm>(emptyContrib());
  const [contribErrors, setContribErrors] = useState<Partial<ContribForm>>({});

  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAllContribs, setShowAllContribs] = useState(false);
  const [view, setView] = useState<"overview" | "planning">("overview");

  // ── Projection ───────────────────────────────────────────────────────────
  const [projYears, setProjYears] = useState("30");
  const years = Number(projYears) || 30;

  const projectionData = useMemo(() => {
    if (investments.length === 0) return [];
    const avgReturn = totalValue > 0
      ? investments.reduce((s, i) => s + i.expected_return * i.current_value, 0) / totalValue
      : 0.07;
    return projectInvestmentGrowth({
      currentValue: totalValue, monthlyContribution: totalMonthlyContribution,
      annualReturnRate: avgReturn, years, inflationRate: 0.03,
    })
      .filter((p) => p.month % 12 === 0)
      .map((p) => ({ year: `Y${p.year}`, nominal: p.nominalValue, real: p.realValue }));
  }, [investments, totalValue, totalMonthlyContribution, years]);

  // ── Allocation: asset class if holdings exist, else account type ─────────
  const allocationData = useMemo(() => {
    if (holdings.length > 0) {
      const byClass: Record<string, number> = {};
      for (const h of holdings) {
        byClass[h.asset_class] = (byClass[h.asset_class] ?? 0) + h.current_value;
      }
      const total = Object.values(byClass).reduce((s, v) => s + v, 0);
      return Object.entries(byClass).map(([cls, val]) => ({
        name: ASSET_CLASSES.find((a) => a.value === cls)?.label ?? cls,
        value: val,
        pct: total > 0 ? Math.round((val / total) * 100) : 0,
        color: ASSET_CLASS_COLORS[cls] ?? "#94a3b8",
      }));
    }
    // Fall back to account type breakdown
    const byType = analyzeAllocation(investments.map((i) => ({
      id: i.id, name: i.name, accountType: i.account_type,
      currentValue: i.current_value, monthlyContribution: i.monthly_contribution,
    }))).byType;
    return Object.entries(byType).map(([type, data], i) => ({
      name: ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type,
      value: data.value, pct: data.percentage,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [holdings, investments]);

  const totalGain = totalValue - investments.reduce((s, i) => s + i.cost_basis, 0);

  // ── Account dialog helpers ───────────────────────────────────────────────
  function openAddAccount() {
    setEditingAccountId(null); setAccountForm(EMPTY_ACCOUNT);
    setAccountErrors({}); setAccountDialog(true);
  }
  function openEditAccount(inv: Investment) {
    setEditingAccountId(inv.id);
    setAccountForm({
      name: inv.name, account_type: inv.account_type, institution: inv.institution ?? "",
      current_value: String(inv.current_value), cost_basis: String(inv.cost_basis),
      monthly_contribution: String(inv.monthly_contribution),
      expected_return: String(Math.round(inv.expected_return * 100)),
    });
    setAccountErrors({}); setAccountDialog(true);
  }
  async function handleSaveAccount() {
    const e: Partial<AccountForm> = {};
    if (!accountForm.name.trim()) e.name = "Required";
    if (!accountForm.current_value || Number(accountForm.current_value) < 0) e.current_value = "Required";
    if (Object.keys(e).length) { setAccountErrors(e); return; }
    setSaving(true);
    const data = {
      name: accountForm.name.trim(), account_type: accountForm.account_type,
      institution: accountForm.institution.trim() || null,
      current_value: Number(accountForm.current_value), cost_basis: Number(accountForm.cost_basis),
      monthly_contribution: Number(accountForm.monthly_contribution),
      expected_return: Number(accountForm.expected_return) / 100,
    };
    if (editingAccountId) await edit(editingAccountId, data); else await add(data);
    setSaving(false); setAccountDialog(false);
  }

  // ── Holding dialog helpers ───────────────────────────────────────────────
  function openAddHolding(investmentId: string) {
    setHoldingForm(emptyHolding(investmentId));
    setHoldingErrors({}); setHoldingDialog(true);
  }
  function openEditHolding(h: ReturnType<typeof holdingsByAccount>[number]) {
    setHoldingForm({
      id: h.id, investment_id: h.investment_id, name: h.name,
      ticker: h.ticker ?? "", shares: h.shares != null ? String(h.shares) : "",
      current_value: String(h.current_value), cost_basis: String(h.cost_basis),
      asset_class: h.asset_class,
    });
    setHoldingErrors({}); setHoldingDialog(true);
  }
  async function handleSaveHolding() {
    const e: Partial<HoldingForm> = {};
    if (!holdingForm.name.trim()) e.name = "Required";
    if (!holdingForm.current_value || Number(holdingForm.current_value) < 0) e.current_value = "Required";
    if (Object.keys(e).length) { setHoldingErrors(e); return; }
    setSaving(true);
    await addOrEditHolding({
      id: holdingForm.id, investment_id: holdingForm.investment_id,
      name: holdingForm.name.trim(),
      ticker: holdingForm.ticker.trim() || null,
      shares: holdingForm.shares ? Number(holdingForm.shares) : null,
      current_value: Number(holdingForm.current_value),
      cost_basis: Number(holdingForm.cost_basis),
      asset_class: holdingForm.asset_class,
    });
    setSaving(false); setHoldingDialog(false);
  }

  // ── Contribution dialog helpers ──────────────────────────────────────────
  function openAddContrib(investmentId = "") {
    setContribForm(emptyContrib(investmentId));
    setContribErrors({}); setContribDialog(true);
  }
  async function handleSaveContrib() {
    const e: Partial<ContribForm> = {};
    if (!contribForm.investment_id) e.investment_id = "Required";
    if (!contribForm.amount || Number(contribForm.amount) <= 0) e.amount = "Enter an amount";
    if (Object.keys(e).length) { setContribErrors(e); return; }
    setSaving(true);
    await addContribution({
      investment_id: contribForm.investment_id,
      amount: Number(contribForm.amount),
      contribution_date: contribForm.contribution_date,
      source_type: contribForm.source_type,
      source_account_id: contribForm.source_account_id || null,
      notes: contribForm.notes.trim() || null,
      update_account_value: contribForm.update_value,
    });
    setSaving(false); setContribDialog(false);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const sourceAccounts =
    contribForm.source_type === "checking" ? checkingAccounts :
    contribForm.source_type === "savings"  ? savingsAccounts  : [];

  const visibleContribs = showAllContribs ? contributions : contributions.slice(0, 8);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Investments</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => openAddContrib()}>
            <Landmark size={14} /> Log Contribution
          </Button>
          <Button size="sm" onClick={openAddAccount}>
            <Plus size={14} /> Add Account
          </Button>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => setView("overview")}
          className={`rounded-[var(--radius-sm)] px-4 py-1.5 text-sm font-medium transition-colors ${
            view === "overview"
              ? "bg-[var(--color-primary)] text-white"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setView("planning")}
          disabled={holdings.length === 0}
          title={holdings.length === 0 ? "Add holdings first" : undefined}
          className={`rounded-[var(--radius-sm)] px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            view === "planning"
              ? "bg-[var(--color-primary)] text-white"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]"
          }`}
        >
          Planning
        </button>
      </div>

      {view === "overview" && (<>
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Value" value={formatCurrency(totalValue, true)} accentColor="var(--color-success)" icon={<TrendingUp size={16} />} />
        <StatCard label="Monthly Contribution" value={formatCurrency(totalMonthlyContribution)} />
        <StatCard label="Total Gain / Loss"
          value={formatCurrency(totalGain, true)}
          trend={totalGain >= 0 ? "up" : "down"}
        />
        <StatCard label="Holdings" value={String(totalHoldings)} />
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : investments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--color-text-muted)]">
            No investment accounts yet.{" "}
            <button onClick={openAddAccount} className="text-[var(--color-primary)] underline">Add one</button>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">

          {/* ── Account list with expandable holdings ── */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            {investments.map((inv) => {
              const acctHoldings = holdingsByAccount(inv.id);
              const isOpen = expanded.has(inv.id);
              const holdingsTotal = acctHoldings.reduce((s, h) => s + h.current_value, 0);
              const gain = inv.current_value - inv.cost_basis;

              return (
                <Card key={inv.id} className="overflow-hidden">
                  {/* Account row */}
                  <div
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-raised)] transition-colors"
                    onClick={() => toggleExpand(inv.id)}
                  >
                    <span className="text-[var(--color-text-subtle)]">
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{inv.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {ACCOUNT_TYPES.find((t) => t.value === inv.account_type)?.label ?? inv.account_type}
                        {inv.institution && ` · ${inv.institution}`}
                        {acctHoldings.length > 0 && ` · ${acctHoldings.length} holdings`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold tabular-nums text-[var(--color-success)]">
                        {formatCurrency(inv.current_value, true)}
                      </p>
                      {gain !== 0 && (
                        <p className={`text-xs tabular-nums ${gain >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                          {gain >= 0 ? "+" : ""}{formatCurrency(gain)}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => openAddContrib(inv.id)}
                        className="rounded p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/8 transition-colors"
                        title="Log contribution"
                      >
                        <Landmark size={13} />
                      </button>
                      <button
                        onClick={() => openEditAccount(inv)}
                        className="rounded p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => remove(inv.id)}
                        className="rounded p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/8 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Holdings drawer */}
                  {isOpen && (
                    <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
                      {acctHoldings.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-text-muted)]">
                              <th className="px-4 py-2">Holding</th>
                              <th className="py-2">Class</th>
                              <th className="py-2 text-right">Shares</th>
                              <th className="py-2 text-right">Value</th>
                              <th className="py-2 w-14" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border-subtle)]">
                            {acctHoldings.map((h) => (
                              <tr key={h.id} className="group">
                                <td className="px-4 py-2">
                                  <p className="font-medium">{h.name}</p>
                                  {h.ticker && <p className="text-xs text-[var(--color-text-muted)] font-mono">{h.ticker}</p>}
                                </td>
                                <td className="py-2">
                                  <span
                                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                                    style={{ backgroundColor: ASSET_CLASS_COLORS[h.asset_class] ?? "#94a3b8" }}
                                  >
                                    {ASSET_CLASSES.find((a) => a.value === h.asset_class)?.label ?? h.asset_class}
                                  </span>
                                </td>
                                <td className="py-2 text-right tabular-nums text-xs text-[var(--color-text-muted)]">
                                  {h.shares != null ? h.shares.toLocaleString() : "—"}
                                </td>
                                <td className="py-2 text-right tabular-nums font-medium">
                                  {formatCurrency(h.current_value, true)}
                                </td>
                                <td className="py-2 pr-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <div className="flex gap-1 justify-end">
                                    <button onClick={() => openEditHolding(h)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-text)]">
                                      <Pencil size={12} />
                                    </button>
                                    <button onClick={() => removeHolding(h.id, h.investment_id)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]">
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {acctHoldings.length > 1 && (
                            <tfoot>
                              <tr className="border-t border-[var(--color-border)]">
                                <td colSpan={3} className="px-4 py-2 text-xs text-[var(--color-text-muted)]">Total</td>
                                <td className="py-2 text-right tabular-nums text-sm font-semibold text-[var(--color-success)]">
                                  {formatCurrency(holdingsTotal, true)}
                                </td>
                                <td />
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      ) : (
                        <p className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                          No holdings tracked yet.
                        </p>
                      )}
                      <div className="px-4 py-2 border-t border-[var(--color-border-subtle)]">
                        <button
                          onClick={() => openAddHolding(inv.id)}
                          className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1"
                        >
                          <Plus size={11} /> Add holding
                        </button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* ── Sidebar: allocation + recent contributions ── */}
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  {holdings.length > 0 ? "Asset Allocation" : "Allocation by Type"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={allocationData} dataKey="value" cx="50%" cy="50%" outerRadius={60} innerRadius={32}>
                      {allocationData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v, true)}
                      contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-col gap-1.5">
                  {allocationData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.color }} />
                        {d.name}
                      </span>
                      <span className="tabular-nums text-[var(--color-text-muted)]">{d.pct}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Monthly contribution target */}
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-[var(--color-text-muted)] mb-1">Planned monthly</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--color-primary)]">
                  {formatCurrency(totalMonthlyContribution)}
                </p>
                <p className="text-xs text-[var(--color-text-subtle)] mt-0.5">
                  across {investments.length} account{investments.length !== 1 ? "s" : ""}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Contributions history ── */}
      {contributions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Contribution History</CardTitle>
              <p className="text-xs text-[var(--color-text-muted)]">
                {contributions.length} event{contributions.length !== 1 ? "s" : ""}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Account</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2 text-right">Amount</th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {visibleContribs.map((c) => (
                  <tr key={c.id} className="group">
                    <td className="py-2 tabular-nums text-[var(--color-text-muted)]">
                      {new Date(c.contribution_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="py-2 font-medium">{c.investment_name}</td>
                    <td className="py-2 text-[var(--color-text-muted)]">
                      {c.source_account_name
                        ? c.source_account_name
                        : CONTRIBUTION_SOURCE_TYPES.find((s) => s.value === c.source_type)?.label ?? c.source_type}
                      {c.notes && <span className="ml-1 text-[var(--color-text-subtle)]">· {c.notes}</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold text-[var(--color-success)]">
                      +{formatCurrency(c.amount)}
                    </td>
                    <td className="py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => removeContribution(c.id)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {contributions.length > 8 && (
              <button
                onClick={() => setShowAllContribs((v) => !v)}
                className="mt-3 text-xs text-[var(--color-primary)] hover:underline"
              >
                {showAllContribs ? "Show less" : `Show all ${contributions.length} contributions`}
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Growth projection ── */}
      {investments.length > 0 && projectionData.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Growth Projection</CardTitle>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Nominal vs real (3% inflation assumed)
                </p>
              </div>
              <div className="w-28 shrink-0">
                <Input label="Years" type="number" min="1" max="50" value={projYears} onChange={(e) => setProjYears(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={projectionData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="nomGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#12b76a" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#12b76a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="realGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5b5bd6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#5b5bd6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                <Tooltip formatter={(v: number) => formatCurrency(v, true)} contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Area type="monotone" dataKey="nominal" name="Nominal" stroke="#12b76a" fill="url(#nomGrad)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="real" name="Real (inflation-adj)" stroke="#5b5bd6" fill="url(#realGrad)" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      </>)}
      {view === "planning" && (
        <InvestmentPlanningView
          holdings={holdings}
          totalValue={totalValue}
          cashAccountsTotal={investments
            .filter((i) => i.account_type === "cash_account")
            .reduce((s, i) => s + i.current_value, 0)}
        />
      )}

      {/* ── Add / Edit Account Dialog ── */}
      <Dialog open={accountDialog} onClose={() => setAccountDialog(false)} title={editingAccountId ? "Edit Account" : "Add Investment Account"}>
        <div className="flex flex-col gap-4">
          <Input label="Account Name" placeholder="e.g. Fidelity Roth IRA" value={accountForm.name} onChange={(e) => setAccountForm((f) => ({ ...f, name: e.target.value }))} error={accountErrors.name} />
          <Select label="Account Type" options={ACCOUNT_TYPES} value={accountForm.account_type} onChange={(e) => setAccountForm((f) => ({ ...f, account_type: e.target.value }))} />
          <Input label="Institution (optional)" placeholder="e.g. Fidelity" value={accountForm.institution} onChange={(e) => setAccountForm((f) => ({ ...f, institution: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Current Value ($)" type="number" min="0" step="0.01" value={accountForm.current_value} onChange={(e) => setAccountForm((f) => ({ ...f, current_value: e.target.value }))} error={accountErrors.current_value} />
            <Input label="Cost Basis ($)" type="number" min="0" step="0.01" value={accountForm.cost_basis} onChange={(e) => setAccountForm((f) => ({ ...f, cost_basis: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Monthly Contribution ($)" type="number" min="0" step="0.01" value={accountForm.monthly_contribution} onChange={(e) => setAccountForm((f) => ({ ...f, monthly_contribution: e.target.value }))} />
            <Input label="Expected Return (%/yr)" type="number" min="0" max="30" step="0.1" value={accountForm.expected_return} onChange={(e) => setAccountForm((f) => ({ ...f, expected_return: e.target.value }))} hint="Default 7%" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setAccountDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveAccount} disabled={saving}>{saving ? "Saving…" : editingAccountId ? "Save" : "Add Account"}</Button>
          </div>
        </div>
      </Dialog>

      {/* ── Add / Edit Holding Dialog ── */}
      <Dialog open={holdingDialog} onClose={() => setHoldingDialog(false)} title={holdingForm.id ? "Edit Holding" : "Add Holding"}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" placeholder="e.g. Vanguard Total Stock" value={holdingForm.name} onChange={(e) => setHoldingForm((f) => ({ ...f, name: e.target.value }))} error={holdingErrors.name} />
            <Input label="Ticker (optional)" placeholder="e.g. VTSAX" value={holdingForm.ticker} onChange={(e) => setHoldingForm((f) => ({ ...f, ticker: e.target.value }))} />
          </div>
          <Select label="Asset Class" options={ASSET_CLASSES} value={holdingForm.asset_class} onChange={(e) => setHoldingForm((f) => ({ ...f, asset_class: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Current Value ($)" type="number" min="0" step="0.01" value={holdingForm.current_value} onChange={(e) => setHoldingForm((f) => ({ ...f, current_value: e.target.value }))} error={holdingErrors.current_value} />
            <Input label="Cost Basis ($)" type="number" min="0" step="0.01" value={holdingForm.cost_basis} onChange={(e) => setHoldingForm((f) => ({ ...f, cost_basis: e.target.value }))} />
          </div>
          <Input label="Shares (optional)" type="number" min="0" step="0.000001" value={holdingForm.shares} onChange={(e) => setHoldingForm((f) => ({ ...f, shares: e.target.value }))} hint="Approximate is fine" />
          <p className="text-xs text-[var(--color-text-muted)]">
            Saving this holding will update the account's total value to the sum of all its holdings.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setHoldingDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveHolding} disabled={saving}>{saving ? "Saving…" : holdingForm.id ? "Save" : "Add Holding"}</Button>
          </div>
        </div>
      </Dialog>

      {/* ── Log Contribution Dialog ── */}
      <Dialog open={contribDialog} onClose={() => setContribDialog(false)} title="Log Contribution">
        <div className="flex flex-col gap-4">
          <Select
            label="Investment Account"
            options={investments.map((i) => ({ value: i.id, label: i.name }))}
            value={contribForm.investment_id}
            onChange={(e) => setContribForm((f) => ({ ...f, investment_id: e.target.value }))}
            error={contribErrors.investment_id}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Amount ($)" type="number" min="0.01" step="0.01" value={contribForm.amount} onChange={(e) => setContribForm((f) => ({ ...f, amount: e.target.value }))} error={contribErrors.amount} />
            <Input label="Date" type="date" value={contribForm.contribution_date} onChange={(e) => setContribForm((f) => ({ ...f, contribution_date: e.target.value }))} />
          </div>
          <Select
            label="Source"
            options={CONTRIBUTION_SOURCE_TYPES}
            value={contribForm.source_type}
            onChange={(e) => setContribForm((f) => ({ ...f, source_type: e.target.value, source_account_id: "" }))}
          />
          {sourceAccounts.length > 0 && (
            <Select
              label="Source Account"
              options={[{ value: "", label: "— select account —" }, ...sourceAccounts.map((a) => ({ value: a.id, label: a.name }))]}
              value={contribForm.source_account_id}
              onChange={(e) => setContribForm((f) => ({ ...f, source_account_id: e.target.value }))}
            />
          )}
          <Input label="Notes (optional)" placeholder="e.g. Q1 max contribution" value={contribForm.notes} onChange={(e) => setContribForm((f) => ({ ...f, notes: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={contribForm.update_value}
              onChange={(e) => setContribForm((f) => ({ ...f, update_value: e.target.checked }))}
              className="accent-[var(--color-primary)]"
            />
            Add this amount to the account's current value
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setContribDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveContrib} disabled={saving}>{saving ? "Saving…" : "Log Contribution"}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
