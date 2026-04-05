import React, { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Zap, Check, RotateCcw, ChevronDown, ChevronRight, Ban } from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
  Badge, formatCurrency, cn,
} from "@milly-maker/ui";
import { useSubscriptions, toMonthly } from "@/db/hooks/useSubscriptions.js";
import type { Subscription, BillingCycle, SubscriptionSourceType } from "@/db/hooks/useSubscriptions.js";
import { useDb } from "@/db/hooks/useDb.js";
import { getAllCheckingAccounts, insertTransaction } from "@/db/queries/checking.js";
import { getAllSavingsAccounts, insertSavingsTransaction } from "@/db/queries/savings.js";
import { getAllDebts } from "@/db/queries/debts.js";

// ── Source account options ──────────────────────────────────────────────────

interface SourceOption {
  value: string; // "checking:id" | "savings:id" | "debt:id"
  label: string;
  type: SubscriptionSourceType;
  id: string;
}

function parseSource(encoded: string): { type: SubscriptionSourceType; id: string } {
  const [type, ...rest] = encoded.split(":");
  return { type: type as SubscriptionSourceType, id: rest.join(":") };
}

function encodeSource(type: SubscriptionSourceType, id: string) {
  return `${type}:${id}`;
}

// ── Form state ──────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  amount: string;
  billing_cycle: BillingCycle;
  billing_day: string;
  source: string;
  category: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  amount: "",
  billing_cycle: "monthly",
  billing_day: "",
  source: "",
  category: "",
  notes: "",
};

const CYCLE_LABELS: Record<BillingCycle, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const CATEGORIES = [
  "Streaming", "Software", "Gaming", "News & Media",
  "Fitness", "Cloud Storage", "Finance", "Utilities", "Other",
];

// ── Component ───────────────────────────────────────────────────────────────

export function SubscriptionsPage() {
  const { conn } = useDb();
  const {
    subscriptions, cancelledSubscriptions, totalMonthly,
    addSubscription, editSubscription, removeSubscription,
    restoreSubscription, permanentlyDelete,
  } = useSubscriptions();

  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [paying, setPaying] = useState<Set<string>>(new Set());
  const [paid, setPaid] = useState<Set<string>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);

  const handlePay = useCallback(async (sub: Subscription) => {
    if (!conn || paying.has(sub.id)) return;
    const today = new Date().toISOString().slice(0, 10);
    setPaying((s) => new Set(s).add(sub.id));
    try {
      if (sub.source_type === "checking") {
        await insertTransaction(conn, {
          account_id: sub.source_account_id,
          type: "debit",
          amount: sub.amount,
          description: sub.name,
          transaction_date: today,
        });
      } else if (sub.source_type === "savings") {
        await insertSavingsTransaction(conn, {
          account_id: sub.source_account_id,
          type: "withdrawal",
          amount: sub.amount,
          description: sub.name,
          transaction_date: today,
        });
      }
      setPaid((s) => new Set(s).add(sub.id));
      setTimeout(() => setPaid((s) => { const n = new Set(s); n.delete(sub.id); return n; }), 2000);
    } finally {
      setPaying((s) => { const n = new Set(s); n.delete(sub.id); return n; });
    }
  }, [conn, paying]);

  // Load source accounts once
  useEffect(() => {
    if (!conn) return;
    void Promise.all([
      getAllCheckingAccounts(conn),
      getAllSavingsAccounts(conn),
      getAllDebts(conn),
    ]).then(([checking, savings, debts]) => {
      const opts: SourceOption[] = [
        ...checking.map((a) => ({ value: encodeSource("checking", a.id), label: `Checking — ${a.name}`, type: "checking" as const, id: a.id })),
        ...savings.map((a) => ({ value: encodeSource("savings", a.id), label: `Savings — ${a.name}`, type: "savings" as const, id: a.id })),
        ...debts.map((a) => ({ value: encodeSource("debt", a.id), label: `${a.name} (${a.debt_type})`, type: "debt" as const, id: a.id })),
      ];
      setSourceOptions(opts);
    });
  }, [conn]);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  }

  function openEdit(sub: Subscription) {
    setEditingId(sub.id);
    setForm({
      name: sub.name,
      amount: String(sub.amount),
      billing_cycle: sub.billing_cycle,
      billing_day: sub.billing_day != null ? String(sub.billing_day) : "",
      source: encodeSource(sub.source_type, sub.source_account_id),
      category: sub.category ?? "",
      notes: sub.notes ?? "",
    });
    setErrors({});
    setDialogOpen(true);
  }

  function validate(): boolean {
    const e: Partial<FormState> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0)
      e.amount = "Enter a valid amount";
    if (!form.source) e.source = "Select a source account";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    const { type, id } = parseSource(form.source);
    const data = {
      name: form.name.trim(),
      amount: Number(form.amount),
      billing_cycle: form.billing_cycle,
      billing_day: form.billing_day ? Number(form.billing_day) : null,
      source_type: type,
      source_account_id: id,
      category: form.category.trim() || null,
      notes: form.notes.trim() || null,
    };
    if (editingId) {
      await editSubscription(editingId, data);
    } else {
      await addSubscription(data);
    }
    setDialogOpen(false);
  }

  async function handleCancel(id: string) {
    await removeSubscription(id);
  }

  async function handleRestore(id: string) {
    await restoreSubscription(id);
  }

  async function handleHardDelete(id: string) {
    if (!confirm("Permanently delete this subscription? This cannot be undone.")) return;
    await permanentlyDelete(id);
  }

  const totalYearly = totalMonthly * 12;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Subscriptions</h1>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary)]/90 transition-colors"
        >
          <Plus size={15} /> Add Subscription
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-text-muted)] mb-1">Monthly Total</p>
          <p className="text-2xl font-bold">{formatCurrency(totalMonthly)}</p>
          <p className="text-xs text-[var(--color-text-subtle)] mt-1">
            {subscriptions.length} active subscription{subscriptions.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-text-muted)] mb-1">Annual Total</p>
          <p className="text-2xl font-bold">{formatCurrency(totalYearly)}</p>
          <p className="text-xs text-[var(--color-text-subtle)] mt-1">projected yearly cost</p>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardHeader><CardTitle>Active Subscriptions</CardTitle></CardHeader>
        <CardContent>
          {subscriptions.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-[var(--color-text-muted)]">
              No subscriptions yet. Add one to start tracking.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Amount</th>
                    <th className="pb-2 font-medium">Cycle</th>
                    <th className="pb-2 font-medium">Billing Day</th>
                    <th className="pb-2 font-medium">Source</th>
                    <th className="pb-2 font-medium">Category</th>
                    <th className="pb-2 font-medium text-right">/mo equiv</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((sub) => (
                    <tr
                      key={sub.id}
                      className="border-b border-[var(--color-border-subtle)] last:border-0"
                    >
                      <td className="py-3 font-medium">{sub.name}</td>
                      <td className="py-3 tabular-nums">{formatCurrency(sub.amount)}</td>
                      <td className="py-3">
                        <Badge variant="default">{CYCLE_LABELS[sub.billing_cycle]}</Badge>
                      </td>
                      <td className="py-3 text-[var(--color-text-muted)]">
                        {sub.billing_day ? `${sub.billing_day}th` : "—"}
                      </td>
                      <td className="py-3 text-[var(--color-text-muted)]">
                        {sub.source_account_name ?? sub.source_account_id}
                      </td>
                      <td className="py-3 text-[var(--color-text-muted)]">
                        {sub.category ?? "—"}
                      </td>
                      <td className="py-3 text-right tabular-nums font-medium">
                        {formatCurrency(toMonthly(sub.amount, sub.billing_cycle))}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center justify-end gap-1">
                          {sub.source_type !== "debt" && (
                            <button
                              onClick={() => void handlePay(sub)}
                              disabled={paying.has(sub.id)}
                              title="Log payment now"
                              className={cn(
                                "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                                paid.has(sub.id)
                                  ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                                  : "text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10"
                              )}
                            >
                              {paid.has(sub.id)
                                ? <><Check size={12} /> Paid</>
                                : <><Zap size={12} /> Pay</>}
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(sub)}
                            className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)] transition-colors"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => void handleCancel(sub.id)}
                            title="Cancel subscription"
                            className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-warning)]/10 hover:text-[var(--color-warning)] transition-colors"
                          >
                            <Ban size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancelled subscriptions */}
      {cancelledSubscriptions.length > 0 && (
        <div>
          <button
            onClick={() => setShowCancelled((v) => !v)}
            className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors mb-2"
          >
            {showCancelled
              ? <ChevronDown size={14} />
              : <ChevronRight size={14} />}
            Cancelled ({cancelledSubscriptions.length})
          </button>

          {showCancelled && (
            <Card>
              <CardContent className="pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                      <th className="pb-2 font-medium">Name</th>
                      <th className="pb-2 font-medium">Amount</th>
                      <th className="pb-2 font-medium">Cycle</th>
                      <th className="pb-2 font-medium">Source</th>
                      <th className="pb-2 font-medium">Category</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {cancelledSubscriptions.map((sub) => (
                      <tr key={sub.id} className="border-b border-[var(--color-border-subtle)] last:border-0 opacity-60">
                        <td className="py-3 font-medium line-through">{sub.name}</td>
                        <td className="py-3 tabular-nums">{formatCurrency(sub.amount)}</td>
                        <td className="py-3">
                          <Badge variant="default">{CYCLE_LABELS[sub.billing_cycle]}</Badge>
                        </td>
                        <td className="py-3 text-[var(--color-text-muted)]">
                          {sub.source_account_name ?? sub.source_account_id}
                        </td>
                        <td className="py-3 text-[var(--color-text-muted)]">
                          {sub.category ?? "—"}
                        </td>
                        <td className="py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => void handleRestore(sub.id)}
                              title="Restore subscription"
                              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--color-success)] hover:bg-[var(--color-success)]/10 transition-colors"
                            >
                              <RotateCcw size={12} /> Restore
                            </button>
                            <button
                              onClick={() => void handleHardDelete(sub.id)}
                              title="Permanently delete"
                              className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Add / Edit dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
            <h2 className="mb-4 text-base font-semibold">
              {editingId ? "Edit Subscription" : "Add Subscription"}
            </h2>

            <div className="flex flex-col gap-4">
              {/* Name */}
              <div>
                <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Name</label>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  placeholder="Netflix, Spotify…"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                {errors.name && <p className="mt-1 text-xs text-[var(--color-danger)]">{errors.name}</p>}
              </div>

              {/* Amount + Cycle */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                    placeholder="9.99"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                  {errors.amount && <p className="mt-1 text-xs text-[var(--color-danger)]">{errors.amount}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Billing Cycle</label>
                  <select
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                    value={form.billing_cycle}
                    onChange={(e) => setForm((f) => ({ ...f, billing_cycle: e.target.value as BillingCycle }))}
                  >
                    {(["weekly", "monthly", "quarterly", "yearly"] as BillingCycle[]).map((c) => (
                      <option key={c} value={c}>{CYCLE_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Billing day */}
              <div>
                <label className="mb-1 block text-xs text-[var(--color-text-muted)]">
                  Recurring Day of Month <span className="text-[var(--color-text-subtle)]">(optional)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  placeholder="e.g. 15"
                  value={form.billing_day}
                  onChange={(e) => setForm((f) => ({ ...f, billing_day: e.target.value }))}
                />
              </div>

              {/* Source account */}
              <div>
                <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Source Account</label>
                <select
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                >
                  <option value="">Select account…</option>
                  {sourceOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {errors.source && <p className="mt-1 text-xs text-[var(--color-danger)]">{errors.source}</p>}
              </div>

              {/* Category */}
              <div>
                <label className="mb-1 block text-xs text-[var(--color-text-muted)]">
                  Category <span className="text-[var(--color-text-subtle)]">(optional)</span>
                </label>
                <select
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                >
                  <option value="">None</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1 block text-xs text-[var(--color-text-muted)]">
                  Notes <span className="text-[var(--color-text-subtle)]">(optional)</span>
                </label>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  placeholder="e.g. family plan"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDialogOpen(false)}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface-raised)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                className="rounded-[var(--radius-sm)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary)]/90 transition-colors"
              >
                {editingId ? "Save Changes" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
