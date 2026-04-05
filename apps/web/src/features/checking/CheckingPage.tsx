import React, { useState, useMemo } from "react";
import {
  Plus, Trash2, ChevronDown, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Pencil, Settings2,
} from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle,
  Dialog, Input, Select, Badge, formatCurrency, cn,
} from "@milly-maker/ui";
import { useCheckingAccounts, useCheckingTransactions } from "@/db/hooks/useChecking.js";
import { useSavingsAccounts } from "@/db/hooks/useSavings.js";
import { useDebts } from "@/db/hooks/useDebts.js";
import { useFantasyAccounts, useFantasyLinks } from "@/db/hooks/useFantasy.js";
import { useSubscriptions } from "@/db/hooks/useSubscriptions.js";
import { useDb } from "@/db/hooks/useDb.js";
import { insertDebtPayment } from "@/db/queries/debts.js";
import { CHECKING_CATEGORIES } from "@/db/queries/checking.js";
import type { TransactionType } from "@/db/queries/checking.js";

// ── Account setup dialog ──────────────────────────────────────────────────────

interface AccountFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; starting_balance: number; starting_date: string }) => Promise<void>;
  initial?: { name: string; starting_balance: string; starting_date: string };
  title: string;
}

function AccountDialog({ open, onClose, onSave, initial, title }: AccountFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [balance, setBalance] = useState(initial?.starting_balance ?? "");
  const [date, setDate] = useState(initial?.starting_date ?? new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setBalance(initial?.starting_balance ?? "");
      setDate(initial?.starting_date ?? new Date().toISOString().slice(0, 10));
      setErrors({});
    }
  }, [open, initial?.name, initial?.starting_balance, initial?.starting_date]);

  async function handleSave() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Required";
    if (balance === "" || isNaN(Number(balance))) e.balance = "Enter a valid amount";
    if (!date) e.date = "Required";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    await onSave({ name: name.trim(), starting_balance: Number(balance), starting_date: date });
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <Input label="Account Name" placeholder="e.g. Chase Checking" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <Input label="Starting Balance ($)" type="number" step="0.01" placeholder="e.g. 2500.00" value={balance} onChange={(e) => setBalance(e.target.value)} error={errors.balance} hint="Enter the balance on your starting date — your origin point." />
        <Input label="Starting Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} hint="All transactions will be tracked from this date forward." />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Account"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Transaction form dialog ───────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: "debit", label: "Debit (money out)" },
  { value: "credit", label: "Credit (money in)" },
  { value: "transfer", label: "Transfer to another account" },
];

interface TxFormState {
  type: TransactionType;
  amount: string;
  description: string;
  transaction_date: string;
  // "checking:{id}" or "savings:{id}" — disambiguates destination table
  transfer_to: string;
  notes: string;
  is_debt_payment: boolean;
  debt_id: string;
  is_fantasy_deposit: boolean;
  fantasy_account_id: string;
  category: string;
}

const EMPTY_TX: TxFormState = {
  type: "debit",
  amount: "",
  description: "",
  transaction_date: new Date().toISOString().slice(0, 10),
  transfer_to: "",
  notes: "",
  is_debt_payment: false,
  debt_id: "",
  is_fantasy_deposit: false,
  fantasy_account_id: "",
  category: "",
};

// ── Main page ─────────────────────────────────────────────────────────────────

export function CheckingPage() {
  const { conn } = useDb();
  const { accounts, loading: accountsLoading, addAccount, editAccount, removeAccount } = useCheckingAccounts();
  const { accounts: savingsAccounts } = useSavingsAccounts();
  const { debts } = useDebts();
  const { accounts: fantasyAccounts } = useFantasyAccounts();
  const { addLink: addFantasyLink } = useFantasyLinks();
  const { subscriptions } = useSubscriptions();

  // Selected account: "ALL" or a specific account id
  const [selectedId, setSelectedId] = useState<string>("ALL");

  const effectiveId = accounts.length === 0 ? "ALL" : selectedId;

  const {
    transactions, balanceSummary, loading: txLoading,
    addTransaction, editTransaction, removeTransaction, currentBalance,
  } = useCheckingTransactions(effectiveId);

  // Account dialogs
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<typeof accounts[0] | null>(null);

  // Transaction dialog
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [txForm, setTxForm] = useState<TxFormState>(EMPTY_TX);
  const [txErrors, setTxErrors] = useState<Partial<TxFormState>>({});
  const [txSaving, setTxSaving] = useState(false);

  // Account dropdown open state
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // When accounts load, default to ALL (or first account if only one)
  React.useEffect(() => {
    if (accounts.length === 1 && selectedId === "ALL") {
      setSelectedId(accounts[0]!.id);
    }
  }, [accounts, selectedId]);

  const otherAccounts = accounts.filter((a) => a.id !== (effectiveId === "ALL" ? null : effectiveId));

  // Group transactions by week
  const byWeek = useMemo(() => {
    const map: Record<string, typeof transactions> = {};
    // Sort descending for display
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

  // Origin point for selected single account
  const selectedAccount = accounts.find((a) => a.id === effectiveId);

  // All possible transfer destinations: other checking accounts + all savings accounts
  const transferDestOptions = [
    ...otherAccounts.map((a) => ({ value: `checking:${a.id}`, label: a.name })),
    ...savingsAccounts.map((a) => ({ value: `savings:${a.id}`, label: `Savings: ${a.name}` })),
  ];

  function openAddTx() {
    setEditingTxId(null);
    setTxForm({
      ...EMPTY_TX,
      transfer_to: transferDestOptions[0]?.value ?? "",
    });
    setTxErrors({});
    setTxDialogOpen(true);
  }

  function openEditTx(tx: typeof transactions[0]) {
    setEditingTxId(tx.id);
    setTxForm({
      type: tx.type,
      amount: String(tx.amount),
      description: tx.description,
      transaction_date: tx.transaction_date,
      transfer_to: transferDestOptions[0]?.value ?? "",
      notes: tx.notes ?? "",
      is_debt_payment: false,
      debt_id: "",
      is_fantasy_deposit: false,
      fantasy_account_id: "",
      category: tx.category ?? "",
    });
    setTxErrors({});
    setTxDialogOpen(true);
  }

  function validateTx(): boolean {
    const e: Partial<TxFormState> = {};
    if (!txForm.amount || isNaN(Number(txForm.amount)) || Number(txForm.amount) <= 0)
      e.amount = "Enter a valid amount";
    if (!txForm.description.trim()) e.description = "Description is required";
    if (!txForm.transaction_date) e.transaction_date = "Date is required";
    if (txForm.type === "transfer" && !txForm.transfer_to)
      e.transfer_to = "Select destination account";
    setTxErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSaveTx() {
    if (!validateTx()) return;
    setTxSaving(true);

    if (editingTxId) {
      // ── Edit mode: only update editable fields ───────────────────────────
      await editTransaction(editingTxId, {
        amount: Number(txForm.amount),
        description: txForm.description.trim(),
        transaction_date: txForm.transaction_date,
        category: txForm.category || null,
        notes: txForm.notes.trim() || null,
      });
    } else {
      // ── Add mode ──────────────────────────────────────────────────────────
      const sourceId = effectiveId === "ALL" ? (accounts[0]?.id ?? "") : effectiveId;
      const isSavingsDest = txForm.transfer_to.startsWith("savings:");
      const destId = txForm.transfer_to.replace(/^(checking|savings):/, "");

      const txId = await addTransaction({
        account_id: sourceId,
        type: txForm.type,
        amount: Number(txForm.amount),
        description: txForm.description.trim(),
        transaction_date: txForm.transaction_date,
        transfer_to_account_id: txForm.type === "transfer" && !isSavingsDest ? destId : undefined,
        transfer_to_savings_account_id: txForm.type === "transfer" && isSavingsDest ? destId : undefined,
        category: txForm.category || undefined,
        notes: txForm.notes.trim() || undefined,
      });

      if (txForm.type === "debit" && txForm.is_debt_payment && txForm.debt_id && conn) {
        await insertDebtPayment(conn, {
          debt_id: txForm.debt_id,
          payment_amount: Number(txForm.amount),
          payment_date: txForm.transaction_date,
          checking_tx_id: txId ?? null,
          notes: txForm.notes.trim() || undefined,
        });
      }

      if (txForm.type === "debit" && txForm.is_fantasy_deposit && txForm.fantasy_account_id && txId) {
        await addFantasyLink({
          checking_tx_id: txId,
          fantasy_account_id: txForm.fantasy_account_id,
        });
      }
    }

    setTxSaving(false);
    setTxDialogOpen(false);
  }

  const typeIcon = (type: TransactionType) => {
    if (type === "credit") return <ArrowDownLeft size={13} className="text-[var(--color-success)]" />;
    if (type === "transfer") return <ArrowLeftRight size={13} className="text-[var(--color-info)]" />;
    return <ArrowUpRight size={13} className="text-[var(--color-danger)]" />;
  };

  const typeBadge = (type: TransactionType) => {
    if (type === "credit") return <Badge variant="success">Credit</Badge>;
    if (type === "transfer") return <Badge variant="outline">Transfer</Badge>;
    return <Badge variant="danger">Debit</Badge>;
  };

  const selectedLabel =
    effectiveId === "ALL" ? "All Accounts" : selectedAccount?.name ?? "Select Account";

  const totalAllBalance = balanceSummary.reduce((s, a) => s + a.current_balance, 0);

  // No accounts yet — prompt setup
  if (!accountsLoading && accounts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">Checking</h1>
        <Card>
          <CardContent className="py-14 text-center">
            <p className="mb-2 text-base font-medium">No checking accounts yet</p>
            <p className="mb-6 text-sm text-[var(--color-text-muted)]">
              Set up your first account with a starting balance and date to begin tracking.
            </p>
            <Button onClick={() => { setEditingAccount(null); setAccountDialogOpen(true); }}>
              <Plus size={15} /> Add Checking Account
            </Button>
          </CardContent>
        </Card>
        <AccountDialog
          open={accountDialogOpen}
          onClose={() => setAccountDialogOpen(false)}
          onSave={(d) => addAccount(d)}
          title="New Checking Account"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Checking</h1>

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
                <div className="absolute left-0 top-full z-20 mt-1 min-w-48 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
                  {/* All accounts option */}
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

                  {/* Individual accounts */}
                  {accounts.map((a) => {
                    const bal = balanceSummary.find((b) => b.account_id === a.id)?.current_balance ?? 0;
                    return (
                      <button
                        key={a.id}
                        onClick={() => { setSelectedId(a.id); setDropdownOpen(false); }}
                        className={cn(
                          "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-raised)]",
                          effectiveId === a.id && "text-[var(--color-primary)]"
                        )}
                      >
                        <span>{a.name}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">{formatCurrency(bal)}</span>
                      </button>
                    );
                  })}

                  <div className="my-1 h-px bg-[var(--color-border-subtle)]" />

                  {/* Add account */}
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
            style={{ backgroundColor: currentBalance >= 0 ? "var(--color-success)" : "var(--color-danger)" }} />
          <CardContent className="p-5 pl-6">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              {effectiveId === "ALL" ? "Combined Balance" : "Current Balance"}
            </p>
            <p className={cn("mt-1 text-2xl font-bold", currentBalance < 0 && "text-[var(--color-danger)]")}>
              {formatCurrency(currentBalance)}
            </p>
            {selectedAccount && (
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                Started {formatDate(selectedAccount.starting_date)} at {formatCurrency(selectedAccount.starting_balance)}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Per-account balances when viewing ALL */}
        {effectiveId === "ALL" && balanceSummary.map((a) => (
          <Card key={a.account_id}>
            <CardContent className="p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">{a.account_name}</p>
              <p className={cn("mt-1 text-xl font-bold", a.current_balance < 0 && "text-[var(--color-danger)]")}>
                {formatCurrency(a.current_balance)}
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
            <button onClick={openAddTx} className="text-[var(--color-primary)] underline">Add one</button>.
          </CardContent>
        </Card>
      ) : (
        weekKeys.map((week) => {
          const items = byWeek[week]!;
          // Use the last transaction's running_balance as the week's closing balance
          const closingBalance = [...items].sort((a, b) =>
            a.transaction_date.localeCompare(b.transaction_date)
          ).at(-1)?.running_balance ?? 0;

          return (
            <Card key={week}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">
                    Week of {formatDate(week)}
                  </CardTitle>
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
                        <td className="py-2 pr-3">
                          {tx.category && (
                            <span className="rounded-full bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                              {tx.category}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-[var(--color-text-muted)]">
                          {formatDate(tx.transaction_date)}
                        </td>
                        <td className={cn("py-2 pr-3 text-right font-medium",
                          tx.type === "credit" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                        )}>
                          {tx.type === "credit" ? "+" : "-"}{formatCurrency(tx.amount)}
                        </td>
                        <td className="py-2 pr-3 text-right text-xs text-[var(--color-text-muted)]">
                          {formatCurrency(tx.running_balance)}
                        </td>
                        <td className="py-2 pl-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => openEditTx(tx)}
                              className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-primary)]"
                              title="Edit transaction"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => removeTransaction(tx.id, tx.transfer_pair_id)}
                              className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
                              title="Delete transaction"
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
          );
        })
      )}

      {/* Add / Edit transaction dialog */}
      <Dialog open={txDialogOpen} onClose={() => setTxDialogOpen(false)} title={editingTxId ? "Edit Transaction" : "Add Transaction"}>
        <div className="flex flex-col gap-4">
          {/* Type selector only shown when adding — editing preserves the original type */}
          {!editingTxId && (
            <Select
              label="Type"
              options={TYPE_OPTIONS}
              value={txForm.type}
              onChange={(e) => setTxForm((f) => ({ ...f, type: e.target.value as TransactionType }))}
            />
          )}
          {editingTxId && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Type: <span className="font-medium capitalize text-[var(--color-text)]">{txForm.type}</span>
              {" "}— to change type, delete and re-add.
            </p>
          )}

          {/* Subscription presets — only for debits when adding */}
          {!editingTxId && txForm.type === "debit" && subscriptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Quick fill from subscriptions</p>
              <div className="flex flex-wrap gap-1.5">
                {subscriptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setTxForm((f) => ({
                      ...f,
                      description: s.name,
                      amount: String(s.amount),
                    }))}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      txForm.description === s.name && txForm.amount === String(s.amount)
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text)]"
                    )}
                  >
                    {s.name} · {formatCurrency(s.amount)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Source account selector when viewing ALL */}
          {effectiveId === "ALL" && (
            <Select
              label="Account"
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              value={accounts[0]?.id ?? ""}
              onChange={(e) => setTxForm((f) => ({ ...f, account_id: e.target.value }))}
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
            placeholder={txForm.type === "transfer" ? "e.g. Monthly savings transfer" : txForm.type === "credit" ? "e.g. Paycheck deposit" : "e.g. Whole Foods"}
            value={txForm.description}
            onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))}
            error={txErrors.description}
          />

          {txForm.type !== "transfer" && (
            <Select
              label="Category (optional)"
              options={[
                { value: "", label: "— None —" },
                ...CHECKING_CATEGORIES.map((c) => ({ value: c, label: c })),
              ]}
              value={txForm.category}
              onChange={(e) => setTxForm((f) => ({ ...f, category: e.target.value }))}
            />
          )}

          {!editingTxId && txForm.type === "transfer" && (
            <Select
              label="Transfer To"
              options={transferDestOptions}
              placeholder={transferDestOptions.length === 0 ? "No destinations available" : undefined}
              value={txForm.transfer_to}
              onChange={(e) => setTxForm((f) => ({ ...f, transfer_to: e.target.value }))}
              error={txErrors.transfer_to}
            />
          )}

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

          {!editingTxId && txForm.type === "debit" && debts.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] p-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={txForm.is_debt_payment}
                  onChange={(e) => setTxForm((f) => ({
                    ...f,
                    is_debt_payment: e.target.checked,
                    debt_id: e.target.checked ? (debts[0]?.id ?? "") : "",
                  }))}
                  className="accent-[var(--color-primary)]"
                />
                Apply as debt payment
              </label>
              {txForm.is_debt_payment && (
                <Select
                  label="Debt account"
                  options={debts.map((d) => ({ value: d.id, label: d.name }))}
                  value={txForm.debt_id}
                  onChange={(e) => setTxForm((f) => ({ ...f, debt_id: e.target.value }))}
                />
              )}
            </div>
          )}

          {!editingTxId && txForm.type === "debit" && fantasyAccounts.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] p-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={txForm.is_fantasy_deposit}
                  onChange={(e) => setTxForm((f) => ({
                    ...f,
                    is_fantasy_deposit: e.target.checked,
                    fantasy_account_id: e.target.checked ? (fantasyAccounts[0]?.id ?? "") : "",
                  }))}
                  className="accent-[var(--color-primary)]"
                />
                Tag as fantasy deposit
              </label>
              {txForm.is_fantasy_deposit && (
                <Select
                  label="Fantasy account"
                  options={fantasyAccounts.map((a) => ({ value: a.id, label: a.name }))}
                  value={txForm.fantasy_account_id}
                  onChange={(e) => setTxForm((f) => ({ ...f, fantasy_account_id: e.target.value }))}
                />
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setTxDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveTx} disabled={txSaving}>
              {txSaving ? "Saving…" : editingTxId ? "Save Changes" : "Add Transaction"}
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
          starting_balance: String(editingAccount.starting_balance),
          starting_date: editingAccount.starting_date,
        } : undefined}
        title={editingAccount ? "Edit Account" : "New Checking Account"}
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
