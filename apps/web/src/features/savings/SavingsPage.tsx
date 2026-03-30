import React, { useState, useMemo } from "react";
import {
  Plus, Trash2, ChevronDown, ArrowDownLeft, ArrowUpRight,
  ArrowLeftRight, TrendingUp, Settings2,
} from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle,
  Dialog, Input, Select, Badge, formatCurrency, cn,
} from "@milly-maker/ui";
import { useSavingsAccounts, useSavingsTransactions } from "@/db/hooks/useSavings.js";
import type { SavingsAccountType, SavingsTransactionType } from "@/db/queries/savings.js";

// ── Account type options ───────────────────────────────────────────────────────

const ACCOUNT_TYPE_OPTIONS = [
  { value: "hysa", label: "HYSA — High Yield Savings" },
  { value: "hsa", label: "HSA — Health Savings Account" },
  { value: "savings", label: "Savings" },
  { value: "other", label: "Other" },
];

const ACCOUNT_TYPE_LABELS: Record<SavingsAccountType, string> = {
  hysa: "HYSA",
  hsa: "HSA",
  savings: "Savings",
  other: "Savings",
};

// ── Account dialog ─────────────────────────────────────────────────────────────

interface AccountFormState {
  name: string;
  account_type: SavingsAccountType;
  starting_balance: string;
  starting_date: string;
  apr: string;
}

interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    account_type: SavingsAccountType;
    starting_balance: number;
    starting_date: string;
    apr: number;
  }) => Promise<void>;
  initial?: AccountFormState;
  title: string;
}

function AccountDialog({ open, onClose, onSave, initial, title }: AccountDialogProps) {
  const [form, setForm] = useState<AccountFormState>({
    name: initial?.name ?? "",
    account_type: initial?.account_type ?? "hysa",
    starting_balance: initial?.starting_balance ?? "",
    starting_date: initial?.starting_date ?? new Date().toISOString().slice(0, 10),
    apr: initial?.apr ?? "",
  });
  const [errors, setErrors] = useState<Partial<AccountFormState>>({});
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) {
      setForm({
        name: initial?.name ?? "",
        account_type: initial?.account_type ?? "hysa",
        starting_balance: initial?.starting_balance ?? "",
        starting_date: initial?.starting_date ?? new Date().toISOString().slice(0, 10),
        apr: initial?.apr ?? "",
      });
      setErrors({});
    }
  }, [open, initial?.name, initial?.account_type, initial?.starting_balance, initial?.starting_date, initial?.apr]);

  async function handleSave() {
    const e: Partial<AccountFormState> = {};
    if (!form.name.trim()) e.name = "Required";
    if (form.starting_balance === "" || isNaN(Number(form.starting_balance))) e.starting_balance = "Enter a valid amount";
    if (!form.starting_date) e.starting_date = "Required";
    if (form.apr === "" || isNaN(Number(form.apr)) || Number(form.apr) < 0) e.apr = "Enter a valid APR";
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    await onSave({
      name: form.name.trim(),
      account_type: form.account_type,
      starting_balance: Number(form.starting_balance),
      starting_date: form.starting_date,
      apr: Number(form.apr) / 100, // store as decimal
    });
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <Input
          label="Account Name"
          placeholder="e.g. Marcus HYSA"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={errors.name}
        />
        <Select
          label="Account Type"
          options={ACCOUNT_TYPE_OPTIONS}
          value={form.account_type}
          onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value as SavingsAccountType }))}
        />
        <Input
          label="Starting Balance ($)"
          type="number"
          step="0.01"
          placeholder="e.g. 5000.00"
          value={form.starting_balance}
          onChange={(e) => setForm((f) => ({ ...f, starting_balance: e.target.value }))}
          error={errors.starting_balance}
          hint="Balance on your starting date — your origin point."
        />
        <Input
          label="Starting Date"
          type="date"
          value={form.starting_date}
          onChange={(e) => setForm((f) => ({ ...f, starting_date: e.target.value }))}
          error={errors.starting_date}
        />
        <Input
          label="APR (%)"
          type="number"
          step="0.01"
          min="0"
          placeholder="e.g. 4.50"
          value={form.apr}
          onChange={(e) => setForm((f) => ({ ...f, apr: e.target.value }))}
          error={errors.apr}
          hint="Annual percentage rate. Used to project annual interest earned."
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Account"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Transaction dialog ─────────────────────────────────────────────────────────

const TX_TYPE_OPTIONS = [
  { value: "deposit", label: "Deposit (money in)" },
  { value: "withdrawal", label: "Withdrawal (money out)" },
  { value: "interest", label: "Interest earned" },
];

interface TxFormState {
  type: "deposit" | "withdrawal" | "interest";
  amount: string;
  description: string;
  transaction_date: string;
  notes: string;
}

const EMPTY_TX: TxFormState = {
  type: "deposit",
  amount: "",
  description: "",
  transaction_date: new Date().toISOString().slice(0, 10),
  notes: "",
};

// ── Main page ──────────────────────────────────────────────────────────────────

export function SavingsPage() {
  const { accounts, loading: accountsLoading, addAccount, editAccount, removeAccount } = useSavingsAccounts();
  const [selectedId, setSelectedId] = useState<string>("ALL");

  const effectiveId = accounts.length === 0 ? "ALL" : selectedId;

  const {
    transactions, balanceSummary, loading: txLoading,
    addTransaction, removeTransaction, currentBalance,
  } = useSavingsTransactions(effectiveId);

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<typeof accounts[0] | null>(null);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [txForm, setTxForm] = useState<TxFormState>(EMPTY_TX);
  const [txErrors, setTxErrors] = useState<Partial<TxFormState>>({});
  const [txSaving, setTxSaving] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  React.useEffect(() => {
    if (accounts.length === 1 && selectedId === "ALL") {
      setSelectedId(accounts[0]!.id);
    }
  }, [accounts, selectedId]);

  const selectedAccount = accounts.find((a) => a.id === effectiveId);
  const selectedSummary = balanceSummary.find((a) => a.account_id === effectiveId);

  // Projected annual interest for selected account
  const projectedInterest = selectedSummary
    ? Math.round(selectedSummary.current_balance * selectedSummary.apr * 100) / 100
    : 0;

  // Group transactions by week, most recent first
  const byWeek = useMemo(() => {
    const map: Record<string, typeof transactions> = {};
    const sorted = [...transactions].sort((a, b) =>
      b.transaction_date.localeCompare(a.transaction_date) ||
      b.created_at.localeCompare(a.created_at)
    );
    for (const tx of sorted) {
      const week = getMondayOf(tx.transaction_date);
      map[week] = [...(map[week] ?? []), tx];
    }
    return map;
  }, [transactions]);

  const weekKeys = Object.keys(byWeek).sort((a, b) => b.localeCompare(a));

  const totalAllBalance = balanceSummary.reduce((s, a) => s + a.current_balance, 0);

  function openAddTx() {
    setTxForm(EMPTY_TX);
    setTxErrors({});
    setTxDialogOpen(true);
  }

  function validateTx(): boolean {
    const e: Partial<TxFormState> = {};
    if (!txForm.amount || isNaN(Number(txForm.amount)) || Number(txForm.amount) <= 0)
      e.amount = "Enter a valid amount";
    if (!txForm.description.trim()) e.description = "Description is required";
    if (!txForm.transaction_date) e.transaction_date = "Date is required";
    setTxErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSaveTx() {
    if (!validateTx()) return;
    setTxSaving(true);

    const accountId = effectiveId === "ALL" ? (accounts[0]?.id ?? "") : effectiveId;

    await addTransaction({
      account_id: accountId,
      type: txForm.type,
      amount: Number(txForm.amount),
      description: txForm.description.trim(),
      transaction_date: txForm.transaction_date,
      notes: txForm.notes.trim() || undefined,
    });
    setTxSaving(false);
    setTxDialogOpen(false);
  }

  const typeIcon = (type: SavingsTransactionType) => {
    if (type === "deposit" || type === "transfer_in") return <ArrowDownLeft size={13} className="text-[var(--color-success)]" />;
    if (type === "interest") return <TrendingUp size={13} className="text-[var(--color-primary)]" />;
    return <ArrowUpRight size={13} className="text-[var(--color-danger)]" />;
  };

  const typeBadge = (type: SavingsTransactionType) => {
    if (type === "deposit") return <Badge variant="success">Deposit</Badge>;
    if (type === "transfer_in") return <Badge variant="outline">Transfer In</Badge>;
    if (type === "interest") return <Badge variant="default">Interest</Badge>;
    return <Badge variant="danger">Withdrawal</Badge>;
  };

  const selectedLabel =
    effectiveId === "ALL" ? "All Accounts" : selectedAccount?.name ?? "Select Account";

  // No accounts yet
  if (!accountsLoading && accounts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">Savings</h1>
        <Card>
          <CardContent className="py-14 text-center">
            <p className="mb-2 text-base font-medium">No savings accounts yet</p>
            <p className="mb-6 text-sm text-[var(--color-text-muted)]">
              Add your HYSA, HSA, or any savings account with a starting balance and APR.
            </p>
            <Button onClick={() => { setEditingAccount(null); setAccountDialogOpen(true); }}>
              <Plus size={15} /> Add Savings Account
            </Button>
          </CardContent>
        </Card>
        <AccountDialog
          open={accountDialogOpen}
          onClose={() => setAccountDialogOpen(false)}
          onSave={(d) => addAccount(d)}
          title="New Savings Account"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Savings</h1>

          {/* Account dropdown */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--color-surface)]"
            >
              {selectedLabel}
              <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                <div className="absolute left-0 top-full z-20 mt-1 min-w-52 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
                  <button
                    onClick={() => { setSelectedId("ALL"); setDropdownOpen(false); }}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-raised)]",
                      effectiveId === "ALL" && "text-[var(--color-primary)]"
                    )}
                  >
                    <span>All Accounts</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{formatCurrency(totalAllBalance)}</span>
                  </button>

                  <div className="my-1 h-px bg-[var(--color-border-subtle)]" />

                  {accounts.map((a) => {
                    const summary = balanceSummary.find((b) => b.account_id === a.id);
                    return (
                      <button
                        key={a.id}
                        onClick={() => { setSelectedId(a.id); setDropdownOpen(false); }}
                        className={cn(
                          "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-raised)]",
                          effectiveId === a.id && "text-[var(--color-primary)]"
                        )}
                      >
                        <div className="flex flex-col">
                          <span>{a.name}</span>
                          <span className="text-[10px] text-[var(--color-text-subtle)]">
                            {ACCOUNT_TYPE_LABELS[a.account_type]} · {(a.apr * 100).toFixed(2)}% APR
                          </span>
                        </div>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {formatCurrency(summary?.current_balance ?? 0)}
                        </span>
                      </button>
                    );
                  })}

                  <div className="my-1 h-px bg-[var(--color-border-subtle)]" />

                  <button
                    onClick={() => { setEditingAccount(null); setAccountDialogOpen(true); setDropdownOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]"
                  >
                    <Plus size={13} /> Add Account
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedAccount && (
            <button
              onClick={() => { setEditingAccount(selectedAccount); setAccountDialogOpen(true); }}
              className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-muted)]"
              title="Edit account"
            >
              <Settings2 size={15} />
            </button>
          )}
          <Button size="sm" onClick={openAddTx} disabled={accounts.length === 0}>
            <Plus size={15} /> Add Transaction
          </Button>
        </div>
      </div>

      {/* Balance summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {/* Current balance */}
        <Card className="relative overflow-hidden">
          <div className="absolute left-0 top-0 h-full w-1 rounded-l-[var(--radius)]"
            style={{ backgroundColor: "var(--color-success)" }} />
          <CardContent className="p-5 pl-6">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              {effectiveId === "ALL" ? "Combined Balance" : "Current Balance"}
            </p>
            <p className="mt-1 text-2xl font-bold">{formatCurrency(currentBalance)}</p>
            {selectedAccount && (
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                Started {formatDate(selectedAccount.starting_date)} at {formatCurrency(selectedAccount.starting_balance)}
              </p>
            )}
          </CardContent>
        </Card>

        {/* APR + projected interest for single account */}
        {selectedSummary && effectiveId !== "ALL" && (
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">APR</p>
              <p className="mt-1 text-2xl font-bold text-[var(--color-success)]">
                {(selectedSummary.apr * 100).toFixed(2)}%
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                ≈ {formatCurrency(projectedInterest)}/yr projected
              </p>
            </CardContent>
          </Card>
        )}

        {/* Account type badge */}
        {selectedSummary && effectiveId !== "ALL" && (
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Account Type</p>
              <p className="mt-2 text-lg font-bold">{ACCOUNT_TYPE_LABELS[selectedSummary.account_type]}</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                {selectedSummary.account_type === "hysa" && "High Yield Savings"}
                {selectedSummary.account_type === "hsa" && "Health Savings Account"}
                {selectedSummary.account_type === "savings" && "Savings Account"}
                {selectedSummary.account_type === "other" && "Savings Account"}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Per-account balances when viewing ALL */}
        {effectiveId === "ALL" && balanceSummary.map((a) => (
          <Card key={a.account_id}>
            <CardContent className="p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">{a.account_name}</p>
              <p className="mt-1 text-xl font-bold">{formatCurrency(a.current_balance)}</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                {ACCOUNT_TYPE_LABELS[a.account_type]} · {(a.apr * 100).toFixed(2)}% APR
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Transaction list */}
      {txLoading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--color-text-muted)]">
            No transactions yet.{" "}
            <button onClick={openAddTx} className="text-[var(--color-primary)] underline">Add one</button>
            {" "}or transfer from Checking.
          </CardContent>
        </Card>
      ) : (
        weekKeys.map((week) => {
          const items = byWeek[week]!;
          const closingBalance = [...items]
            .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
            .at(-1)?.running_balance ?? 0;

          return (
            <Card key={week}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Week of {formatDate(week)}</CardTitle>
                  <span className="text-sm font-medium text-[var(--color-text-muted)]">
                    Balance: {formatCurrency(closingBalance)}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {items.map((tx) => (
                      <tr key={tx.id} className="group">
                        <td className="py-2 pr-3 w-5">{typeIcon(tx.type)}</td>
                        <td className="py-2 pr-3 font-medium">{tx.description}</td>
                        {effectiveId === "ALL" && (
                          <td className="py-2 pr-3 text-[var(--color-text-muted)] text-xs">{tx.account_name}</td>
                        )}
                        <td className="py-2 pr-3">{typeBadge(tx.type)}</td>
                        <td className="py-2 pr-3 text-[var(--color-text-muted)]">
                          {formatDate(tx.transaction_date)}
                        </td>
                        <td className={cn("py-2 pr-3 text-right font-medium",
                          tx.type === "withdrawal"
                            ? "text-[var(--color-danger)]"
                            : "text-[var(--color-success)]"
                        )}>
                          {tx.type === "withdrawal" ? "-" : "+"}{formatCurrency(tx.amount)}
                        </td>
                        <td className="py-2 pr-3 text-right text-xs text-[var(--color-text-muted)]">
                          {formatCurrency(tx.running_balance)}
                        </td>
                        <td className="py-2 pl-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => removeTransaction(tx.id, tx.transfer_pair_id)}
                            className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
                            title={tx.transfer_pair_id ? "Delete transfer (removes checking debit too)" : "Delete"}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Add transaction dialog */}
      <Dialog open={txDialogOpen} onClose={() => setTxDialogOpen(false)} title="Add Transaction">
        <div className="flex flex-col gap-4">
          <Select
            label="Type"
            options={TX_TYPE_OPTIONS}
            value={txForm.type}
            onChange={(e) => setTxForm((f) => ({ ...f, type: e.target.value as TxFormState["type"] }))}
          />
          {effectiveId === "ALL" && accounts.length > 1 && (
            <Select
              label="Account"
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              value={accounts[0]?.id ?? ""}
              onChange={() => {}}
            />
          )}
          <Input
            label="Amount ($)"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={txForm.amount}
            onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))}
            error={txErrors.amount}
          />
          <Input
            label="Description"
            placeholder={
              txForm.type === "deposit" ? "e.g. Monthly transfer" :
              txForm.type === "interest" ? "e.g. April interest" :
              "e.g. Medical expense"
            }
            value={txForm.description}
            onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))}
            error={txErrors.description}
          />
          <Input
            label="Date"
            type="date"
            value={txForm.transaction_date}
            onChange={(e) => setTxForm((f) => ({ ...f, transaction_date: e.target.value }))}
            error={txErrors.transaction_date}
          />
          <Input
            label="Notes (optional)"
            placeholder="Any extra context"
            value={txForm.notes}
            onChange={(e) => setTxForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setTxDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveTx} disabled={txSaving}>
              {txSaving ? "Saving…" : "Add Transaction"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Add/Edit account dialog */}
      <AccountDialog
        open={accountDialogOpen}
        onClose={() => { setAccountDialogOpen(false); setEditingAccount(null); }}
        onSave={async (d) => {
          if (editingAccount) {
            await editAccount(editingAccount.id, d);
          } else {
            await addAccount(d);
          }
        }}
        initial={editingAccount ? {
          name: editingAccount.name,
          account_type: editingAccount.account_type,
          starting_balance: String(editingAccount.starting_balance),
          starting_date: editingAccount.starting_date,
          apr: String(editingAccount.apr * 100),
        } : undefined}
        title={editingAccount ? "Edit Account" : "New Savings Account"}
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
