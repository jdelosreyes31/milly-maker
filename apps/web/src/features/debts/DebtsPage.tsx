import React, { useState, useMemo } from "react";
import { Plus, Trash2, Pencil, CreditCard } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle,
  Dialog, Input, Select, Badge, StatCard, formatCurrency, formatPercent,
} from "@milly-maker/ui";
import { useDebts } from "@/db/hooks/useDebts.js";
import { DEBT_TYPES } from "@/db/queries/debts.js";
import { calculateAvalanche, calculateSnowball } from "@milly-maker/finance-engine";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import type { Debt } from "@/db/queries/debts.js";

interface FormState {
  name: string; debt_type: string; current_balance: string;
  original_balance: string; interest_rate: string; minimum_payment: string; due_day: string;
}
const EMPTY_FORM: FormState = {
  name: "", debt_type: "credit_card", current_balance: "", original_balance: "",
  interest_rate: "", minimum_payment: "", due_day: "",
};

export function DebtsPage() {
  const { debts, loading, add, edit, remove, totalDebt, totalMinPayment } = useDebts();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [extraPayment, setExtraPayment] = useState("200");

  const debtTypeOptions = DEBT_TYPES;

  function openAdd() { setEditingId(null); setForm(EMPTY_FORM); setErrors({}); setDialogOpen(true); }
  function openEdit(d: Debt) {
    setEditingId(d.id);
    setForm({
      name: d.name, debt_type: d.debt_type,
      current_balance: String(d.current_balance), original_balance: String(d.original_balance),
      interest_rate: String(Math.round(d.interest_rate * 10000) / 100), // store as %, display as %
      minimum_payment: String(d.minimum_payment), due_day: d.due_day ? String(d.due_day) : "",
    });
    setErrors({}); setDialogOpen(true);
  }

  function validate(): boolean {
    const e: Partial<FormState> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.current_balance || Number(form.current_balance) < 0) e.current_balance = "Enter a valid balance";
    if (!form.original_balance || Number(form.original_balance) < 0) e.original_balance = "Enter original balance";
    if (!form.interest_rate || Number(form.interest_rate) < 0) e.interest_rate = "Enter APR (e.g. 24.99)";
    if (!form.minimum_payment || Number(form.minimum_payment) < 0) e.minimum_payment = "Enter minimum payment";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    const data = {
      name: form.name.trim(), debt_type: form.debt_type,
      current_balance: Number(form.current_balance),
      original_balance: Number(form.original_balance),
      interest_rate: Number(form.interest_rate) / 100, // convert % to decimal
      minimum_payment: Number(form.minimum_payment),
      due_day: form.due_day ? Number(form.due_day) : null,
    };
    if (editingId) await edit(editingId, data);
    else await add(data);
    setSaving(false); setDialogOpen(false);
  }

  // Build finance-engine Debt objects
  const engineDebts = debts.map((d) => ({
    id: d.id, name: d.name, balance: d.current_balance,
    apr: d.interest_rate, minimumPayment: d.minimum_payment,
  }));

  const extra = Number(extraPayment) || 0;

  const { avalanche, snowball } = useMemo(() => {
    if (engineDebts.length === 0) return { avalanche: null, snowball: null };
    return {
      avalanche: calculateAvalanche(engineDebts, extra),
      snowball: calculateSnowball(engineDebts, extra),
    };
  }, [engineDebts, extra]);

  // Build chart data: monthly balance for both strategies
  const chartData = useMemo(() => {
    if (!avalanche || !snowball) return [];
    const maxM = Math.max(avalanche.totalMonths, snowball.totalMonths);
    return Array.from({ length: maxM }, (_, i) => {
      const m = i + 1;
      const av = avalanche.monthlyCashflow[i]?.totalBalance ?? 0;
      const sb = snowball.monthlyCashflow[i]?.totalBalance ?? 0;
      return { month: m, avalanche: av, snowball: sb };
    });
  }, [avalanche, snowball]);

  const highestApr = debts.reduce<Debt | null>((best, d) => {
    if (!best || d.interest_rate > best.interest_rate) return d;
    return best;
  }, null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Debts</h1>
        <Button onClick={openAdd} size="sm"><Plus size={15} /> Add Debt</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total Debt" value={formatCurrency(totalDebt)} accentColor="var(--color-danger)" icon={<CreditCard size={16} />} />
        <StatCard label="Min. Monthly" value={formatCurrency(totalMinPayment)} subValue="minimum payments" />
        <StatCard label="# Accounts" value={String(debts.length)} subValue="active debts" />
      </div>

      {/* Debt list */}
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
                  <th className="pb-2">Type</th>
                  <th className="pb-2 text-right">Balance</th>
                  <th className="pb-2 text-right">APR</th>
                  <th className="pb-2 text-right">Min Payment</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {debts.map((d) => (
                  <tr key={d.id} className="group">
                    <td className="py-2.5 font-medium">{d.name}</td>
                    <td className="py-2.5">
                      <Badge variant="outline" className="text-xs">
                        {DEBT_TYPES.find((t) => t.value === d.debt_type)?.label ?? d.debt_type}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right text-[var(--color-danger)]">
                      {formatCurrency(d.current_balance)}
                    </td>
                    <td className="py-2.5 text-right">
                      <span className={d.interest_rate > 0.15 ? "text-[var(--color-warning)]" : ""}>
                        {formatPercent(d.interest_rate * 100)}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-[var(--color-text-muted)]">{formatCurrency(d.minimum_payment)}</td>
                    <td className="py-2.5 pl-3 opacity-0 transition-opacity group-hover:opacity-100">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(d)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"><Pencil size={13} /></button>
                        <button onClick={() => remove(d.id)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Payoff Planner */}
      {debts.length > 0 && (
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
                <Input
                  label="Extra monthly ($)"
                  type="number"
                  min="0"
                  value={extraPayment}
                  onChange={(e) => setExtraPayment(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {avalanche && snowball && (
              <>
                <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
                  <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-3">
                    <p className="mb-1 font-medium text-[var(--color-chart-1)]">Avalanche</p>
                    <p>{avalanche.totalMonths} months debt-free</p>
                    <p className="text-[var(--color-text-muted)]">{formatCurrency(avalanche.totalInterestPaid)} total interest</p>
                    {highestApr && <p className="text-xs text-[var(--color-text-subtle)]">Focus: {highestApr.name}</p>}
                  </div>
                  <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-3">
                    <p className="mb-1 font-medium text-[var(--color-chart-2)]">Snowball</p>
                    <p>{snowball.totalMonths} months debt-free</p>
                    <p className="text-[var(--color-text-muted)]">{formatCurrency(snowball.totalInterestPaid)} total interest</p>
                    <p className="text-xs text-[var(--color-text-subtle)]">
                      Saves {formatCurrency(snowball.totalInterestPaid - avalanche.totalInterestPaid)} more interest with Avalanche
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
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editingId ? "Edit Debt" : "Add Debt"}>
        <div className="flex flex-col gap-4">
          <Input label="Name" placeholder="e.g. Chase Sapphire" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={errors.name} />
          <Select label="Type" options={debtTypeOptions} value={form.debt_type} onChange={(e) => setForm((f) => ({ ...f, debt_type: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Current Balance ($)" type="number" min="0" step="0.01" value={form.current_balance} onChange={(e) => setForm((f) => ({ ...f, current_balance: e.target.value }))} error={errors.current_balance} />
            <Input label="Original Balance ($)" type="number" min="0" step="0.01" value={form.original_balance} onChange={(e) => setForm((f) => ({ ...f, original_balance: e.target.value }))} error={errors.original_balance} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="APR (%)" type="number" min="0" step="0.01" placeholder="e.g. 24.99" value={form.interest_rate} onChange={(e) => setForm((f) => ({ ...f, interest_rate: e.target.value }))} error={errors.interest_rate} />
            <Input label="Min. Payment ($)" type="number" min="0" step="0.01" value={form.minimum_payment} onChange={(e) => setForm((f) => ({ ...f, minimum_payment: e.target.value }))} error={errors.minimum_payment} />
          </div>
          <Input label="Due Day (optional)" type="number" min="1" max="31" placeholder="e.g. 15" value={form.due_day} onChange={(e) => setForm((f) => ({ ...f, due_day: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Add Debt"}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
