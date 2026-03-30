import React, { useState, useMemo } from "react";
import { Plus, Trash2, Pencil, TrendingUp } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle,
  Dialog, Input, Select, StatCard, formatCurrency, formatPercent,
} from "@milly-maker/ui";
import { useInvestments } from "@/db/hooks/useInvestments.js";
import { ACCOUNT_TYPES } from "@/db/queries/investments.js";
import { projectInvestmentGrowth, analyzeAllocation } from "@milly-maker/finance-engine";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";
import type { Investment } from "@/db/queries/investments.js";

interface FormState {
  name: string; account_type: string; institution: string;
  current_value: string; cost_basis: string; monthly_contribution: string; expected_return: string;
}
const EMPTY_FORM: FormState = {
  name: "", account_type: "roth_ira", institution: "", current_value: "",
  cost_basis: "0", monthly_contribution: "0", expected_return: "7",
};

const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6"];

export function InvestmentsPage() {
  const { investments, loading, add, edit, remove, totalValue, totalMonthlyContribution } = useInvestments();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [projYears, setProjYears] = useState("30");

  function openAdd() { setEditingId(null); setForm(EMPTY_FORM); setErrors({}); setDialogOpen(true); }
  function openEdit(inv: Investment) {
    setEditingId(inv.id);
    setForm({
      name: inv.name, account_type: inv.account_type, institution: inv.institution ?? "",
      current_value: String(inv.current_value), cost_basis: String(inv.cost_basis),
      monthly_contribution: String(inv.monthly_contribution),
      expected_return: String(Math.round(inv.expected_return * 100)),
    });
    setErrors({}); setDialogOpen(true);
  }

  function validate(): boolean {
    const e: Partial<FormState> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.current_value || Number(form.current_value) < 0) e.current_value = "Enter current value";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    const data = {
      name: form.name.trim(), account_type: form.account_type,
      institution: form.institution.trim() || null,
      current_value: Number(form.current_value), cost_basis: Number(form.cost_basis),
      monthly_contribution: Number(form.monthly_contribution),
      expected_return: Number(form.expected_return) / 100,
    };
    if (editingId) await edit(editingId, data);
    else await add(data);
    setSaving(false); setDialogOpen(false);
  }

  // Projection: aggregate across all investments
  const years = Number(projYears) || 30;
  const projectionData = useMemo(() => {
    if (investments.length === 0) return [];
    const avgReturn = totalValue > 0
      ? investments.reduce((s, i) => s + i.expected_return * i.current_value, 0) / totalValue
      : 0.07;
    const points = projectInvestmentGrowth({
      currentValue: totalValue,
      monthlyContribution: totalMonthlyContribution,
      annualReturnRate: avgReturn,
      years,
      inflationRate: 0.03,
    });
    // Downsample to yearly for chart readability
    return points.filter((p) => p.month % 12 === 0).map((p) => ({
      year: `Y${p.year}`,
      nominal: p.nominalValue,
      real: p.realValue,
      contributed: p.totalContributed,
    }));
  }, [investments, totalValue, totalMonthlyContribution, years]);

  // Allocation pie
  const allocation = useMemo(
    () => analyzeAllocation(investments.map((i) => ({
      id: i.id, name: i.name, accountType: i.account_type, currentValue: i.current_value, monthlyContribution: i.monthly_contribution,
    }))),
    [investments]
  );

  const pieData = Object.entries(allocation.byType).map(([type, data]) => ({
    name: ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type,
    value: data.value,
    pct: data.percentage,
  }));

  const totalGain = totalValue - investments.reduce((s, i) => s + i.cost_basis, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Investments</h1>
        <Button onClick={openAdd} size="sm"><Plus size={15} /> Add Account</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total Value" value={formatCurrency(totalValue, true)} accentColor="var(--color-success)" icon={<TrendingUp size={16} />} />
        <StatCard label="Monthly Contribution" value={formatCurrency(totalMonthlyContribution)} />
        <StatCard label="Total Gain/Loss" value={formatCurrency(totalGain, true)} trend={totalGain >= 0 ? "up" : "down"} />
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : investments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--color-text-muted)]">
            No investment accounts yet. <button onClick={openAdd} className="text-[var(--color-primary)] underline">Add one</button>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Accounts table */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                      <th className="pb-2">Account</th>
                      <th className="pb-2 text-right">Value</th>
                      <th className="pb-2 text-right">Monthly</th>
                      <th className="pb-2 text-right">Return</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {investments.map((inv) => (
                      <tr key={inv.id} className="group">
                        <td className="py-2.5">
                          <p className="font-medium">{inv.name}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {ACCOUNT_TYPES.find((t) => t.value === inv.account_type)?.label ?? inv.account_type}
                            {inv.institution && ` · ${inv.institution}`}
                          </p>
                        </td>
                        <td className="py-2.5 text-right font-medium text-[var(--color-success)]">{formatCurrency(inv.current_value, true)}</td>
                        <td className="py-2.5 text-right text-[var(--color-text-muted)]">{formatCurrency(inv.monthly_contribution)}</td>
                        <td className="py-2.5 text-right text-[var(--color-text-muted)]">{formatPercent(inv.expected_return * 100)}</td>
                        <td className="py-2.5 pl-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <div className="flex gap-1">
                            <button onClick={() => openEdit(inv)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"><Pencil size={13} /></button>
                            <button onClick={() => remove(inv.id)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          {/* Allocation pie */}
          <Card>
            <CardHeader><CardTitle>Allocation</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={65} innerRadius={35}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v, true)} contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-col gap-1">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      {d.name}
                    </span>
                    <span className="text-[var(--color-text-muted)]">{d.pct}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Projection chart */}
      {investments.length > 0 && projectionData.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Growth Projection</CardTitle>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Nominal vs real (inflation-adjusted, 3% assumed)</p>
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
                  <linearGradient id="nominalGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="realGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: "var(--color-text-subtle)" }} />
                <Tooltip formatter={(v: number) => formatCurrency(v, true)} contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Area type="monotone" dataKey="nominal" name="Nominal" stroke="var(--color-success)" fill="url(#nominalGrad)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="real" name="Real (inflation-adj)" stroke="var(--color-chart-1)" fill="url(#realGrad)" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editingId ? "Edit Account" : "Add Investment Account"}>
        <div className="flex flex-col gap-4">
          <Input label="Account Name" placeholder="e.g. Fidelity Roth IRA" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={errors.name} />
          <Select label="Account Type" options={ACCOUNT_TYPES} value={form.account_type} onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value }))} />
          <Input label="Institution (optional)" placeholder="e.g. Fidelity" value={form.institution} onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Current Value ($)" type="number" min="0" step="0.01" value={form.current_value} onChange={(e) => setForm((f) => ({ ...f, current_value: e.target.value }))} error={errors.current_value} />
            <Input label="Cost Basis ($)" type="number" min="0" step="0.01" value={form.cost_basis} onChange={(e) => setForm((f) => ({ ...f, cost_basis: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Monthly Contribution ($)" type="number" min="0" step="0.01" value={form.monthly_contribution} onChange={(e) => setForm((f) => ({ ...f, monthly_contribution: e.target.value }))} />
            <Input label="Expected Annual Return (%)" type="number" min="0" max="30" step="0.1" value={form.expected_return} onChange={(e) => setForm((f) => ({ ...f, expected_return: e.target.value }))} hint="Default 7% (S&P 500 historical avg)" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Add Account"}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
