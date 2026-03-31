import React, { useState, useMemo } from "react";
import {
  Plus, Trash2, ChevronDown, ArrowDownLeft, ArrowUpRight,
  Check, X, Minus, Settings2, Trophy, TrendingUp,
} from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle,
  Dialog, Input, Select, Badge, formatCurrency, cn,
} from "@milly-maker/ui";
import { useFantasyAccounts, useFantasyData } from "@/db/hooks/useFantasy.js";
import type { FantasyPlatformType, FantasyTxType, FutureStatus } from "@/db/queries/fantasy.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORM_OPTIONS = [
  { value: "sportsbook",     label: "Sportsbook" },
  { value: "dfs",            label: "DFS" },
  { value: "fantasy_league", label: "Fantasy League" },
  { value: "other",          label: "Other" },
];

const PLATFORM_LABELS: Record<FantasyPlatformType, string> = {
  sportsbook:     "Sportsbook",
  dfs:            "DFS",
  fantasy_league: "Fantasy League",
  other:          "Other",
};

const TX_TYPE_OPTIONS = [
  { value: "deposit", label: "Deposit (money in)" },
  { value: "cashout", label: "Cashout (money out)" },
];

// ── Account dialog ─────────────────────────────────────────────────────────────

interface AccountFormState {
  name: string;
  platform_type: FantasyPlatformType;
  starting_balance: string;
  starting_date: string;
}

interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; platform_type: FantasyPlatformType; starting_balance: number; starting_date: string }) => Promise<void>;
  initial?: AccountFormState;
  title: string;
}

function AccountDialog({ open, onClose, onSave, initial, title }: AccountDialogProps) {
  const [form, setForm] = useState<AccountFormState>({
    name: initial?.name ?? "",
    platform_type: initial?.platform_type ?? "sportsbook",
    starting_balance: initial?.starting_balance ?? "0",
    starting_date: initial?.starting_date ?? new Date().toISOString().slice(0, 10),
  });
  const [errors, setErrors] = useState<Partial<AccountFormState>>({});
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) {
      setForm({
        name: initial?.name ?? "",
        platform_type: initial?.platform_type ?? "sportsbook",
        starting_balance: initial?.starting_balance ?? "0",
        starting_date: initial?.starting_date ?? new Date().toISOString().slice(0, 10),
      });
      setErrors({});
    }
  }, [open, initial?.name, initial?.platform_type, initial?.starting_balance, initial?.starting_date]);

  async function handleSave() {
    const e: Partial<AccountFormState> = {};
    if (!form.name.trim()) e.name = "Required";
    if (form.starting_balance === "" || isNaN(Number(form.starting_balance))) e.starting_balance = "Enter a valid amount";
    if (!form.starting_date) e.starting_date = "Required";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    await onSave({
      name: form.name.trim(),
      platform_type: form.platform_type,
      starting_balance: Number(form.starting_balance),
      starting_date: form.starting_date,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <Input label="Account Name" placeholder="e.g. DraftKings, FanDuel" value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={errors.name} />
        <Select label="Platform Type" options={PLATFORM_OPTIONS} value={form.platform_type}
          onChange={(e) => setForm((f) => ({ ...f, platform_type: e.target.value as FantasyPlatformType }))} />
        <Input label="Starting Balance ($)" type="number" step="0.01" placeholder="0.00"
          value={form.starting_balance}
          onChange={(e) => setForm((f) => ({ ...f, starting_balance: e.target.value }))}
          error={errors.starting_balance}
          hint="Current balance in the account on your starting date." />
        <Input label="Starting Date" type="date" value={form.starting_date}
          onChange={(e) => setForm((f) => ({ ...f, starting_date: e.target.value }))} error={errors.starting_date} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Account"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Transaction dialog ─────────────────────────────────────────────────────────

interface TxFormState {
  type: FantasyTxType;
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

// ── Future dialog ──────────────────────────────────────────────────────────────

interface FutureFormState {
  account_id: string;
  description: string;
  stake: string;
  potential_payout: string;
  odds: string;
  placed_date: string;
  notes: string;
}

const EMPTY_FUTURE = (firstAccountId: string): FutureFormState => ({
  account_id: firstAccountId,
  description: "",
  stake: "",
  potential_payout: "",
  odds: "",
  placed_date: new Date().toISOString().slice(0, 10),
  notes: "",
});

interface FutureDialogProps {
  open: boolean;
  onClose: () => void;
  accounts: { id: string; name: string }[];
  defaultAccountId: string;
  onSave: (data: {
    account_id: string;
    description: string;
    stake: number;
    potential_payout?: number;
    odds?: string;
    placed_date: string;
    notes?: string;
  }) => Promise<void>;
}

function FutureDialog({ open, onClose, accounts, defaultAccountId, onSave }: FutureDialogProps) {
  const [form, setForm] = useState<FutureFormState>(EMPTY_FUTURE(defaultAccountId));
  const [errors, setErrors] = useState<Partial<FutureFormState>>({});
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY_FUTURE(defaultAccountId));
      setErrors({});
    }
  }, [open, defaultAccountId]);

  async function handleSave() {
    const e: Partial<FutureFormState> = {};
    if (!form.description.trim()) e.description = "Required";
    if (!form.stake || isNaN(Number(form.stake)) || Number(form.stake) <= 0) e.stake = "Enter a valid stake";
    if (!form.placed_date) e.placed_date = "Required";
    if (form.potential_payout && isNaN(Number(form.potential_payout))) e.potential_payout = "Must be a number";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    await onSave({
      account_id: form.account_id || defaultAccountId,
      description: form.description.trim(),
      stake: Number(form.stake),
      potential_payout: form.potential_payout ? Number(form.potential_payout) : undefined,
      odds: form.odds.trim() || undefined,
      placed_date: form.placed_date,
      notes: form.notes.trim() || undefined,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add Future">
      <div className="flex flex-col gap-4">
        {accounts.length > 1 && (
          <Select
            label="Account"
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            value={form.account_id}
            onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}
          />
        )}
        <Input
          label="Description"
          placeholder="e.g. Chiefs to win Super Bowl LX"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          error={errors.description}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Stake ($)"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="50.00"
            value={form.stake}
            onChange={(e) => setForm((f) => ({ ...f, stake: e.target.value }))}
            error={errors.stake}
          />
          <Input
            label="Odds (optional)"
            placeholder="+500"
            value={form.odds}
            onChange={(e) => setForm((f) => ({ ...f, odds: e.target.value }))}
          />
        </div>
        <Input
          label="Potential Payout ($, optional)"
          type="number"
          step="0.01"
          placeholder="300.00"
          value={form.potential_payout}
          onChange={(e) => setForm((f) => ({ ...f, potential_payout: e.target.value }))}
          error={errors.potential_payout}
          hint="Total amount returned if this bet wins (includes stake)."
        />
        <Input
          label="Placed Date"
          type="date"
          value={form.placed_date}
          onChange={(e) => setForm((f) => ({ ...f, placed_date: e.target.value }))}
          error={errors.placed_date}
        />
        <Input
          label="Notes (optional)"
          placeholder="Any context"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Add Future"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Won banner ─────────────────────────────────────────────────────────────────

interface WonBanner {
  id: string;
  description: string;
  payout: number | null;
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function FantasyPage() {
  const { accounts, loading: accountsLoading, addAccount, editAccount } = useFantasyAccounts();
  const [selectedId, setSelectedId] = useState<string>("ALL");

  const effectiveId = accounts.length === 0 ? "ALL" : selectedId;

  const {
    transactions, openFutures, settledFutures, balanceSummary,
    loading: dataLoading, currentBalance, totalOpenStake,
    addTransaction, removeTransaction,
    addFuture, settleFuture, removeFuture,
  } = useFantasyData(effectiveId);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<typeof accounts[0] | null>(null);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [txForm, setTxForm] = useState<TxFormState>(EMPTY_TX);
  const [txErrors, setTxErrors] = useState<Partial<TxFormState>>({});
  const [txSaving, setTxSaving] = useState(false);
  const [futureDialogOpen, setFutureDialogOpen] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  const [wonBanners, setWonBanners] = useState<WonBanner[]>([]);

  React.useEffect(() => {
    if (accounts.length === 1 && selectedId === "ALL") setSelectedId(accounts[0]!.id);
  }, [accounts, selectedId]);

  const selectedAccount = accounts.find((a) => a.id === effectiveId);
  const totalAllBalance = balanceSummary.reduce((s, a) => s + a.current_balance, 0);
  const selectedLabel = effectiveId === "ALL" ? "All Accounts" : selectedAccount?.name ?? "Select Account";

  // Group transactions by week
  const byWeek = useMemo(() => {
    const map: Record<string, typeof transactions> = {};
    for (const tx of transactions) {
      const week = getMondayOf(tx.transaction_date);
      map[week] = [...(map[week] ?? []), tx];
    }
    return map;
  }, [transactions]);
  const weekKeys = Object.keys(byWeek).sort((a, b) => b.localeCompare(a));

  // Transaction dialog
  function openAddTx() { setTxForm(EMPTY_TX); setTxErrors({}); setTxDialogOpen(true); }

  function validateTx(): boolean {
    const e: Partial<TxFormState> = {};
    if (!txForm.amount || isNaN(Number(txForm.amount)) || Number(txForm.amount) <= 0) e.amount = "Enter a valid amount";
    if (!txForm.description.trim()) e.description = "Required";
    if (!txForm.transaction_date) e.transaction_date = "Required";
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

  // Settle future
  async function handleSettle(futureId: string, status: FutureStatus) {
    const future = openFutures.find((f) => f.id === futureId);
    await settleFuture(futureId, status);
    if (status === "won" && future) {
      setWonBanners((prev) => [...prev, { id: futureId, description: future.description, payout: future.potential_payout }]);
    }
  }

  const statusBadge = (status: FutureStatus) => {
    if (status === "open") return <Badge variant="outline">Open</Badge>;
    if (status === "won") return <Badge variant="success">Won</Badge>;
    if (status === "lost") return <Badge variant="danger">Lost</Badge>;
    return <Badge variant="default">Void</Badge>;
  };

  // No accounts yet
  if (!accountsLoading && accounts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">Fantasy</h1>
        <Card>
          <CardContent className="py-14 text-center">
            <p className="mb-2 text-base font-medium">No fantasy accounts yet</p>
            <p className="mb-6 text-sm text-[var(--color-text-muted)]">
              Add a sportsbook, DFS platform, or fantasy league to start tracking your bucket.
            </p>
            <Button onClick={() => { setEditingAccount(null); setAccountDialogOpen(true); }}>
              <Plus size={15} /> Add Account
            </Button>
          </CardContent>
        </Card>
        <AccountDialog open={accountDialogOpen} onClose={() => setAccountDialogOpen(false)}
          onSave={(d) => addAccount(d)} title="New Fantasy Account" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Won banners */}
      {wonBanners.map((b) => (
        <div key={b.id}
          className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--color-success)] bg-[var(--color-success)]/10 px-4 py-3 text-sm"
        >
          <span>
            <span className="mr-1.5">🎉</span>
            <strong>{b.description}</strong> settled as a win!
            {b.payout != null && (
              <span className="ml-2 text-[var(--color-success)]">
                Add <strong>{formatCurrency(b.payout)}</strong> to Checking as income.
              </span>
            )}
          </span>
          <button onClick={() => setWonBanners((prev) => prev.filter((x) => x.id !== b.id))}
            className="ml-4 rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X size={14} />
          </button>
        </div>
      ))}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Fantasy</h1>

          {/* Dropdown */}
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
                    className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-raised)]",
                      effectiveId === "ALL" && "text-[var(--color-primary)]"
                    )}
                  >
                    <span>All Accounts</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{formatCurrency(totalAllBalance)}</span>
                  </button>
                  <div className="my-1 h-px bg-[var(--color-border-subtle)]" />
                  {accounts.map((a) => {
                    const bal = balanceSummary.find((b) => b.account_id === a.id)?.current_balance ?? 0;
                    return (
                      <button key={a.id}
                        onClick={() => { setSelectedId(a.id); setDropdownOpen(false); }}
                        className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-raised)]",
                          effectiveId === a.id && "text-[var(--color-primary)]"
                        )}
                      >
                        <div className="flex flex-col">
                          <span>{a.name}</span>
                          <span className="text-[10px] text-[var(--color-text-subtle)]">{PLATFORM_LABELS[a.platform_type]}</span>
                        </div>
                        <span className="text-xs text-[var(--color-text-muted)]">{formatCurrency(bal)}</span>
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
          <Button variant="outline" size="sm" onClick={() => setFutureDialogOpen(true)}>
            <Trophy size={14} /> Add Future
          </Button>
          <Button size="sm" onClick={openAddTx}>
            <Plus size={15} /> Deposit / Cashout
          </Button>
        </div>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card className="relative overflow-hidden">
          <div className="absolute left-0 top-0 h-full w-1 rounded-l-[var(--radius)]"
            style={{ backgroundColor: currentBalance >= 0 ? "var(--color-success)" : "var(--color-danger)" }} />
          <CardContent className="p-5 pl-6">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              {effectiveId === "ALL" ? "Combined Balance" : "Account Balance"}
            </p>
            <p className={cn("mt-1 text-2xl font-bold", currentBalance < 0 && "text-[var(--color-danger)]")}>
              {formatCurrency(currentBalance)}
            </p>
            {selectedAccount && (
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                {PLATFORM_LABELS[selectedAccount.platform_type]} · since {formatDate(selectedAccount.starting_date)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Open Futures</p>
            <p className="mt-1 text-2xl font-bold">{openFutures.length}</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
              {formatCurrency(totalOpenStake)} staked
            </p>
          </CardContent>
        </Card>

        {/* Per-account balances in ALL view */}
        {effectiveId === "ALL" && balanceSummary.map((a) => (
          <Card key={a.account_id}>
            <CardContent className="p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">{a.account_name}</p>
              <p className={cn("mt-1 text-xl font-bold", a.current_balance < 0 && "text-[var(--color-danger)]")}>
                {formatCurrency(a.current_balance)}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{PLATFORM_LABELS[a.platform_type]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Open futures section */}
      {openFutures.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Trophy size={15} className="text-[var(--color-primary)]" />
              <CardTitle className="text-sm font-semibold">Open Futures ({openFutures.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)]">
                  <th className="pb-2 text-left font-medium">Description</th>
                  {effectiveId === "ALL" && <th className="pb-2 text-left font-medium">Account</th>}
                  <th className="pb-2 text-right font-medium">Stake</th>
                  <th className="pb-2 text-right font-medium">Odds</th>
                  <th className="pb-2 text-right font-medium">Potential</th>
                  <th className="pb-2 text-right font-medium">Placed</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {openFutures.map((f) => (
                  <tr key={f.id} className="group">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium">{f.description}</span>
                      {f.notes && <p className="text-xs text-[var(--color-text-muted)]">{f.notes}</p>}
                    </td>
                    {effectiveId === "ALL" && (
                      <td className="py-2.5 pr-3 text-xs text-[var(--color-text-muted)]">{f.account_name}</td>
                    )}
                    <td className="py-2.5 pr-3 text-right font-medium">{formatCurrency(f.stake)}</td>
                    <td className="py-2.5 pr-3 text-right text-[var(--color-text-muted)]">
                      {f.odds ?? <span className="text-[var(--color-text-subtle)]">—</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[var(--color-success)]">
                      {f.potential_payout != null
                        ? formatCurrency(f.potential_payout)
                        : <span className="text-[var(--color-text-subtle)]">—</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[var(--color-text-muted)]">
                      {formatDate(f.placed_date)}
                    </td>
                    <td className="py-2.5 pl-2">
                      {/* Settle actions — always visible on desktop, grouped */}
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handleSettle(f.id, "won")}
                          title="Mark as Won"
                          className="rounded p-1 text-[var(--color-text-subtle)] hover:bg-[var(--color-success)]/15 hover:text-[var(--color-success)]"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() => handleSettle(f.id, "lost")}
                          title="Mark as Lost"
                          className="rounded p-1 text-[var(--color-text-subtle)] hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)]"
                        >
                          <X size={13} />
                        </button>
                        <button
                          onClick={() => handleSettle(f.id, "void")}
                          title="Mark as Void"
                          className="rounded p-1 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-muted)]"
                        >
                          <Minus size={13} />
                        </button>
                        <button
                          onClick={() => removeFuture(f.id)}
                          title="Delete"
                          className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
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

      {/* Settled futures (collapsible) */}
      {settledFutures.length > 0 && (
        <div>
          <button
            onClick={() => setShowSettled((v) => !v)}
            className="mb-2 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <TrendingUp size={13} />
            {showSettled ? "Hide" : "Show"} Settled Futures ({settledFutures.length})
          </button>
          {showSettled && (
            <Card>
              <CardContent className="pt-4">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {settledFutures.map((f) => (
                      <tr key={f.id} className="group">
                        <td className="py-2 pr-3 font-medium">{f.description}</td>
                        {effectiveId === "ALL" && (
                          <td className="py-2 pr-3 text-xs text-[var(--color-text-muted)]">{f.account_name}</td>
                        )}
                        <td className="py-2 pr-3">{statusBadge(f.status)}</td>
                        <td className="py-2 pr-3 text-right">{formatCurrency(f.stake)} staked</td>
                        <td className="py-2 pr-3 text-right text-[var(--color-text-muted)]">
                          {f.settled_date ? formatDate(f.settled_date) : "—"}
                        </td>
                        <td className="py-2 pl-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => removeFuture(f.id)}
                            className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
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
          )}
        </div>
      )}

      {/* No futures at all yet */}
      {openFutures.length === 0 && settledFutures.length === 0 && !dataLoading && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-[var(--color-text-muted)]">
            No futures tracked yet.{" "}
            <button onClick={() => setFutureDialogOpen(true)} className="text-[var(--color-primary)] underline">Add your first future</button>.
          </CardContent>
        </Card>
      )}

      {/* Transaction history */}
      {transactions.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            Transaction History
          </h2>
          {weekKeys.map((week) => {
            const items = byWeek[week]!;
            return (
              <Card key={week}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Week of {formatDate(week)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-[var(--color-border-subtle)]">
                      {items.map((tx) => (
                        <tr key={tx.id} className="group">
                          <td className="py-2 pr-3 w-5">
                            {tx.type === "deposit"
                              ? <ArrowDownLeft size={13} className="text-[var(--color-success)]" />
                              : <ArrowUpRight size={13} className="text-[var(--color-danger)]" />}
                          </td>
                          <td className="py-2 pr-3 font-medium">{tx.description}</td>
                          {effectiveId === "ALL" && (
                            <td className="py-2 pr-3 text-xs text-[var(--color-text-muted)]">{tx.account_name}</td>
                          )}
                          <td className="py-2 pr-3">
                            {tx.type === "deposit"
                              ? <Badge variant="success">Deposit</Badge>
                              : <Badge variant="danger">Cashout</Badge>}
                          </td>
                          <td className="py-2 pr-3 text-[var(--color-text-muted)]">{formatDate(tx.transaction_date)}</td>
                          <td className={cn("py-2 pr-3 text-right font-medium",
                            tx.type === "deposit" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                          )}>
                            {tx.type === "deposit" ? "+" : "-"}{formatCurrency(tx.amount)}
                          </td>
                          <td className="py-2 pl-2 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => removeTransaction(tx.id)}
                              className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
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
          })}
        </div>
      )}

      {/* Add transaction dialog */}
      <Dialog open={txDialogOpen} onClose={() => setTxDialogOpen(false)} title="Deposit / Cashout">
        <div className="flex flex-col gap-4">
          <Select label="Type" options={TX_TYPE_OPTIONS} value={txForm.type}
            onChange={(e) => setTxForm((f) => ({ ...f, type: e.target.value as FantasyTxType }))} />
          {effectiveId === "ALL" && accounts.length > 1 && (
            <Select label="Account" options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              value={accounts[0]?.id ?? ""} onChange={() => {}} />
          )}
          <Input label="Amount ($)" type="number" step="0.01" min="0.01" placeholder="0.00"
            value={txForm.amount}
            onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))}
            error={txErrors.amount} />
          <Input
            label="Description"
            placeholder={txForm.type === "deposit" ? "e.g. Initial deposit" : "e.g. Withdrawal to checking"}
            value={txForm.description}
            onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))}
            error={txErrors.description} />
          <Input label="Date" type="date" value={txForm.transaction_date}
            onChange={(e) => setTxForm((f) => ({ ...f, transaction_date: e.target.value }))}
            error={txErrors.transaction_date} />
          <Input label="Notes (optional)" placeholder="Any context" value={txForm.notes}
            onChange={(e) => setTxForm((f) => ({ ...f, notes: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setTxDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveTx} disabled={txSaving}>
              {txSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Add future dialog */}
      <FutureDialog
        open={futureDialogOpen}
        onClose={() => setFutureDialogOpen(false)}
        accounts={accounts}
        defaultAccountId={effectiveId === "ALL" ? (accounts[0]?.id ?? "") : effectiveId}
        onSave={addFuture}
      />

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
          platform_type: editingAccount.platform_type,
          starting_balance: String(editingAccount.starting_balance),
          starting_date: editingAccount.starting_date,
        } : undefined}
        title={editingAccount ? "Edit Account" : "New Fantasy Account"}
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
