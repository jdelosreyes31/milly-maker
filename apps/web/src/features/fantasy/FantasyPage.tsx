import React, { useState, useMemo } from "react";
import {
  Plus, Trash2, ChevronDown, ChevronRight,
  ArrowDownLeft, ArrowUpRight,
  Check, X, Minus, Settings2, Trophy, TrendingUp,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import {
  Button, Card, CardContent, CardHeader, CardTitle,
  Dialog, Input, Select, Badge, formatCurrency, cn,
} from "@milly-maker/ui";
import { useFantasyAccounts, useFantasyData } from "@/db/hooks/useFantasy.js";
import type {
  FantasyPlatformType, FantasyTxType,
  FutureStatus, SeasonStatus,
} from "@/db/queries/fantasy.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonth(yyyyMm: string): string {
  const [year, month] = yyyyMm.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString("default", { month: "short", year: "2-digit" });
}

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

const isLeague = (type: FantasyPlatformType) => type === "fantasy_league";

// ── Account dialog ─────────────────────────────────────────────────────────────

interface AccountFormState {
  name: string;
  platform_type: FantasyPlatformType;
  starting_balance: string;
  starting_date: string;
  end_date: string;
}

interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    platform_type: FantasyPlatformType;
    starting_balance: number;
    starting_date: string;
    end_date?: string;
  }) => Promise<void>;
  initial?: AccountFormState;
  title: string;
}

function AccountDialog({ open, onClose, onSave, initial, title }: AccountDialogProps) {
  const [form, setForm] = useState<AccountFormState>(defaultForm(initial));
  const [errors, setErrors] = useState<Partial<AccountFormState>>({});
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) { setForm(defaultForm(initial)); setErrors({}); }
  }, [open, initial?.name, initial?.platform_type, initial?.starting_balance, initial?.starting_date, initial?.end_date]);

  async function handleSave() {
    const e: Partial<AccountFormState> = {};
    if (!form.name.trim()) e.name = "Required";
    if (form.starting_balance === "" || isNaN(Number(form.starting_balance))) {
      e.starting_balance = "Enter a valid amount";
    }
    if (!form.starting_date) e.starting_date = "Required";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    await onSave({
      name: form.name.trim(),
      platform_type: form.platform_type,
      starting_balance: Number(form.starting_balance),
      starting_date: form.starting_date,
      end_date: form.end_date || undefined,
    });
    setSaving(false);
    onClose();
  }

  const league = isLeague(form.platform_type);

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <Input label="Account Name" placeholder="e.g. DraftKings, ESPN League"
          value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={errors.name} />
        <Select label="Platform Type" options={PLATFORM_OPTIONS} value={form.platform_type}
          onChange={(e) => setForm((f) => ({ ...f, platform_type: e.target.value as FantasyPlatformType }))} />
        <Input
          label={league ? "Buy-In ($)" : "Starting Balance ($)"}
          type="number" step="0.01" placeholder="0.00"
          value={form.starting_balance}
          onChange={(e) => setForm((f) => ({ ...f, starting_balance: e.target.value }))}
          error={errors.starting_balance}
          hint={league
            ? "Total amount you're paying into this league. Not counted toward your sportsbook balance."
            : "Your account balance on the starting date."}
        />
        <Input label={league ? "Season Start Date" : "Starting Date"} type="date"
          value={form.starting_date}
          onChange={(e) => setForm((f) => ({ ...f, starting_date: e.target.value }))} error={errors.starting_date} />
        <Input label={league ? "Season End Date (optional)" : "End Date (optional)"} type="date"
          value={form.end_date}
          onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
          hint={league ? "When does this league's season end?" : undefined} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Account"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function defaultForm(initial?: AccountFormState): AccountFormState {
  return {
    name: initial?.name ?? "",
    platform_type: initial?.platform_type ?? "sportsbook",
    starting_balance: initial?.starting_balance ?? "",
    starting_date: initial?.starting_date ?? new Date().toISOString().slice(0, 10),
    end_date: initial?.end_date ?? "",
  };
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
  type: "deposit", amount: "", description: "",
  transaction_date: new Date().toISOString().slice(0, 10), notes: "",
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

interface FutureDialogProps {
  open: boolean;
  onClose: () => void;
  accounts: { id: string; name: string; platform_type: FantasyPlatformType }[];
  defaultAccountId: string;
  onSave: (data: {
    account_id: string; description: string; stake: number;
    potential_payout?: number; odds?: string; placed_date: string; notes?: string;
  }) => Promise<void>;
}

function FutureDialog({ open, onClose, accounts, defaultAccountId, onSave }: FutureDialogProps) {
  const sbAccounts = accounts.filter((a) => !isLeague(a.platform_type));
  const [form, setForm] = useState<FutureFormState>({
    account_id: defaultAccountId,
    description: "", stake: "", potential_payout: "", odds: "",
    placed_date: new Date().toISOString().slice(0, 10), notes: "",
  });
  const [errors, setErrors] = useState<Partial<FutureFormState>>({});
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) {
      setForm({ account_id: defaultAccountId, description: "", stake: "", potential_payout: "", odds: "",
        placed_date: new Date().toISOString().slice(0, 10), notes: "" });
      setErrors({});
    }
  }, [open, defaultAccountId]);

  async function handleSave() {
    const e: Partial<FutureFormState> = {};
    if (!form.description.trim()) e.description = "Required";
    if (!form.stake || isNaN(Number(form.stake)) || Number(form.stake) <= 0) e.stake = "Enter a valid stake";
    if (!form.placed_date) e.placed_date = "Required";
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
        {sbAccounts.length > 1 && (
          <Select label="Account" options={sbAccounts.map((a) => ({ value: a.id, label: a.name }))}
            value={form.account_id} onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))} />
        )}
        <Input label="Description" placeholder="e.g. Chiefs to win Super Bowl LX"
          value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          error={errors.description} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Stake ($)" type="number" step="0.01" min="0.01" placeholder="50.00"
            value={form.stake} onChange={(e) => setForm((f) => ({ ...f, stake: e.target.value }))}
            error={errors.stake} />
          <Input label="Odds (optional)" placeholder="+500"
            value={form.odds} onChange={(e) => setForm((f) => ({ ...f, odds: e.target.value }))} />
        </div>
        <Input label="Potential Payout ($, optional)" type="number" step="0.01" placeholder="300.00"
          value={form.potential_payout}
          onChange={(e) => setForm((f) => ({ ...f, potential_payout: e.target.value }))}
          hint="Total amount returned if this bet wins (stake included)." />
        <Input label="Placed Date" type="date" value={form.placed_date}
          onChange={(e) => setForm((f) => ({ ...f, placed_date: e.target.value }))} error={errors.placed_date} />
        <Input label="Notes (optional)" placeholder="Any context" value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Add Future"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Season dialog ──────────────────────────────────────────────────────────────

interface SeasonFormState {
  description: string;
  season_year: string;
  buy_in: string;
  potential_payout: string;
  start_date: string;
  end_date: string;
  notes: string;
}

interface SeasonDialogProps {
  open: boolean;
  onClose: () => void;
  accountId: string;
  onSave: (data: {
    account_id: string; description: string; season_year?: string;
    buy_in: number; potential_payout?: number;
    start_date: string; end_date?: string; notes?: string;
  }) => Promise<void>;
}

function SeasonDialog({ open, onClose, accountId, onSave }: SeasonDialogProps) {
  const empty: SeasonFormState = {
    description: "", season_year: "", buy_in: "",
    potential_payout: "", start_date: new Date().toISOString().slice(0, 10),
    end_date: "", notes: "",
  };
  const [form, setForm] = useState<SeasonFormState>(empty);
  const [errors, setErrors] = useState<Partial<SeasonFormState>>({});
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) { setForm(empty); setErrors({}); }
  }, [open]);

  async function handleSave() {
    const e: Partial<SeasonFormState> = {};
    if (!form.description.trim()) e.description = "Required";
    if (form.buy_in === "" || isNaN(Number(form.buy_in)) || Number(form.buy_in) < 0) e.buy_in = "Enter a valid buy-in";
    if (!form.start_date) e.start_date = "Required";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    await onSave({
      account_id: accountId,
      description: form.description.trim(),
      season_year: form.season_year.trim() || undefined,
      buy_in: Number(form.buy_in),
      potential_payout: form.potential_payout ? Number(form.potential_payout) : undefined,
      start_date: form.start_date,
      end_date: form.end_date || undefined,
      notes: form.notes.trim() || undefined,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add Season">
      <div className="flex flex-col gap-4">
        <Input label="Description" placeholder="e.g. 2024-25 ESPN Football"
          value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          error={errors.description} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Season Year (optional)" placeholder="e.g. 2024-25"
            value={form.season_year} onChange={(e) => setForm((f) => ({ ...f, season_year: e.target.value }))} />
          <Input label="Buy-In ($)" type="number" step="0.01" placeholder="50.00"
            value={form.buy_in} onChange={(e) => setForm((f) => ({ ...f, buy_in: e.target.value }))}
            error={errors.buy_in} />
        </div>
        <Input label="Prize Pool / Potential Payout ($, optional)" type="number" step="0.01"
          placeholder="500.00" value={form.potential_payout}
          onChange={(e) => setForm((f) => ({ ...f, potential_payout: e.target.value }))} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start Date" type="date" value={form.start_date}
            onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} error={errors.start_date} />
          <Input label="End Date (optional)" type="date" value={form.end_date}
            onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
        </div>
        <Input label="Notes (optional)" placeholder="Any context" value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Add Season"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Win notification banner ────────────────────────────────────────────────────

interface WinBanner { id: string; description: string; payout: number | null; }

// ── Seasons accordion ─────────────────────────────────────────────────────────

interface SeasonsAccordionProps {
  seasons: ReturnType<typeof useFantasyData>["seasons"];
  showAll: boolean;
  onSettle: (id: string, status: SeasonStatus) => void;
  onRemove: (id: string) => void;
  showAccountCol: boolean;
}

function SeasonsAccordion({ seasons, showAll, onSettle, onRemove, showAccountCol }: SeasonsAccordionProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const displayed = showAll ? seasons : seasons.filter((s) => s.status === "active");

  if (displayed.length === 0) return null;

  return (
    <div className="flex flex-col divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      {displayed.map((season) => {
        const open = expanded.has(season.id);
        const statusColor: Record<string, string> = {
          active: "var(--color-primary)",
          won: "var(--color-success)",
          lost: "var(--color-danger)",
          ended: "var(--color-text-muted)",
        };

        return (
          <div key={season.id}>
            {/* Header row — clickable to expand */}
            <button
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-raised)]"
              onClick={() => toggle(season.id)}
            >
              {open
                ? <ChevronDown size={14} className="shrink-0 text-[var(--color-text-muted)]" />
                : <ChevronRight size={14} className="shrink-0 text-[var(--color-text-muted)]" />}

              <span className="flex-1 text-sm font-medium">
                {season.description}
                {season.season_year && (
                  <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">({season.season_year})</span>
                )}
              </span>

              {showAccountCol && (
                <span className="text-xs text-[var(--color-text-muted)]">{season.account_name}</span>
              )}

              {/* Status dot + label */}
              <span className="flex items-center gap-1.5 text-xs font-medium"
                style={{ color: statusColor[season.status] ?? "inherit" }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor[season.status] }} />
                {season.status.charAt(0).toUpperCase() + season.status.slice(1)}
              </span>

              <span className="text-xs text-[var(--color-text-muted)]">{formatCurrency(season.buy_in)} buy-in</span>
            </button>

            {/* Expanded detail panel */}
            {open && (
              <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-6 py-4">
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)]">Buy-In</p>
                    <p className="font-medium">{formatCurrency(season.buy_in)}</p>
                  </div>
                  {season.potential_payout != null && (
                    <div>
                      <p className="text-xs text-[var(--color-text-muted)]">Prize Pool</p>
                      <p className="font-medium text-[var(--color-success)]">{formatCurrency(season.potential_payout)}</p>
                    </div>
                  )}
                  {season.placement && (
                    <div>
                      <p className="text-xs text-[var(--color-text-muted)]">Placement</p>
                      <p className="font-medium">{season.placement}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)]">Start</p>
                    <p className="font-medium">{formatDate(season.start_date)}</p>
                  </div>
                  {season.end_date && (
                    <div>
                      <p className="text-xs text-[var(--color-text-muted)]">End</p>
                      <p className="font-medium">{formatDate(season.end_date)}</p>
                    </div>
                  )}
                  {season.notes && (
                    <div className="col-span-2 sm:col-span-3">
                      <p className="text-xs text-[var(--color-text-muted)]">Notes</p>
                      <p className="text-[var(--color-text-muted)]">{season.notes}</p>
                    </div>
                  )}
                </div>

                {/* Settle actions (only for active seasons) */}
                {season.status === "active" && (
                  <div className="mt-4 flex items-center gap-2">
                    <span className="text-xs text-[var(--color-text-muted)]">Mark as:</span>
                    <button
                      onClick={() => onSettle(season.id, "won")}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--color-success)] hover:bg-[var(--color-success)]/10"
                    >
                      <Check size={12} /> Won
                    </button>
                    <button
                      onClick={() => onSettle(season.id, "lost")}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                    >
                      <X size={12} /> Lost
                    </button>
                    <button
                      onClick={() => onSettle(season.id, "ended")}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"
                    >
                      <Minus size={12} /> Ended
                    </button>
                    <div className="ml-auto">
                      <button onClick={() => onRemove(season.id)}
                        className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
                {season.status !== "active" && (
                  <div className="mt-3 flex justify-end">
                    <button onClick={() => onRemove(season.id)}
                      className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function FantasyPage() {
  const { accounts, loading: accountsLoading, addAccount, editAccount } = useFantasyAccounts();
  const [selectedId, setSelectedId] = useState<string>("ALL");

  const effectiveId = accounts.length === 0 ? "ALL" : selectedId;

  const {
    transactions, openFutures, settledFutures,
    seasons, activeSeasons, settledSeasons,
    balanceSummary, loading: dataLoading,
    currentBalance, totalOpenStake,
    addTransaction, removeTransaction,
    addFuture, settleFuture, removeFuture,
    addSeason, settleSeason, removeSeason,
  } = useFantasyData(effectiveId);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<typeof accounts[0] | null>(null);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [txForm, setTxForm] = useState<TxFormState>(EMPTY_TX);
  const [txErrors, setTxErrors] = useState<Partial<TxFormState>>({});
  const [txSaving, setTxSaving] = useState(false);
  const [futureDialogOpen, setFutureDialogOpen] = useState(false);
  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [showSettledFutures, setShowSettledFutures] = useState(false);
  const [showSettledSeasons, setShowSettledSeasons] = useState(false);
  const [winBanners, setWinBanners] = useState<WinBanner[]>([]);

  React.useEffect(() => {
    if (accounts.length === 1 && selectedId === "ALL") setSelectedId(accounts[0]!.id);
  }, [accounts, selectedId]);

  const selectedAccount = accounts.find((a) => a.id === effectiveId);
  const selectedSummary = balanceSummary.find((a) => a.account_id === effectiveId);

  // What mode is the current view?
  const viewIsLeague = selectedAccount ? isLeague(selectedAccount.platform_type) : false;
  const viewIsAll = effectiveId === "ALL";

  // All non-league accounts (for futures, balance)
  const sbAccounts = accounts.filter((a) => !isLeague(a.platform_type));
  const leagueAccounts = accounts.filter((a) => isLeague(a.platform_type));

  const totalAllBalance = balanceSummary
    .filter((a) => !isLeague(a.platform_type))
    .reduce((s, a) => s + a.current_balance, 0);

  // League buy-ins (informational, not added to balance)
  const totalLeagueBuyIn = balanceSummary
    .filter((a) => isLeague(a.platform_type))
    .reduce((s, a) => s + a.starting_balance, 0);

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

  // ── Performance analytics (sportsbook + DFS only) ──────────────────────────

  // Non-league summary rows
  const sbSummary = useMemo(
    () => balanceSummary.filter((a) => !isLeague(a.platform_type)),
    [balanceSummary]
  );

  // Totals for stat cards
  const perfStats = useMemo(() => {
    const totalIn      = sbSummary.reduce((s, a) => s + a.total_deposited, 0);
    const totalOut     = sbSummary.reduce((s, a) => s + a.total_cashout, 0);
    const inAccounts   = sbSummary.reduce((s, a) => s + a.current_balance, 0);
    // Net P&L: cash you've extracted vs cash you've deposited, plus remaining balance
    const netPnL = totalOut + inAccounts - totalIn;
    return { totalIn, totalOut, inAccounts, netPnL };
  }, [sbSummary]);

  // Monthly net per platform (for bar chart)
  const monthlyChartData = useMemo(() => {
    const sbTxs = transactions.filter((tx) => !isLeague(tx.platform_type));
    const byMonth = new Map<string, { dfs: number; sportsbook: number }>();
    for (const tx of sbTxs) {
      const month = tx.transaction_date.slice(0, 7);
      const curr = byMonth.get(month) ?? { dfs: 0, sportsbook: 0 };
      const sign = tx.type === "cashout" ? 1 : -1;
      const key = tx.platform_type === "dfs" ? "dfs" : "sportsbook";
      curr[key] += sign * tx.amount;
      byMonth.set(month, curr);
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month: fmtMonth(month),
        DFS: Math.round(d.dfs * 100) / 100,
        Sportsbook: Math.round(d.sportsbook * 100) / 100,
      }));
  }, [transactions]);

  // Cumulative P&L over time (for line chart)
  const cumulativeChartData = useMemo(() => {
    const sbTxs = transactions
      .filter((tx) => !isLeague(tx.platform_type))
      .slice()
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    let dfsCum = 0; let sbCum = 0;
    const byMonth = new Map<string, { DFS: number; Sportsbook: number; Combined: number }>();
    for (const tx of sbTxs) {
      const month = tx.transaction_date.slice(0, 7);
      const sign = tx.type === "cashout" ? 1 : -1;
      if (tx.platform_type === "dfs") dfsCum += sign * tx.amount;
      else sbCum += sign * tx.amount;
      byMonth.set(month, {
        DFS: Math.round(dfsCum * 100) / 100,
        Sportsbook: Math.round(sbCum * 100) / 100,
        Combined: Math.round((dfsCum + sbCum) * 100) / 100,
      });
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({ month: fmtMonth(month), ...d }));
  }, [transactions]);

  const hasPerformanceData = !viewIsLeague && (monthlyChartData.length > 0 || sbSummary.length > 0);

  const selectedLabel = effectiveId === "ALL" ? "All Accounts" : selectedAccount?.name ?? "Select Account";

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
      account_id: accountId, type: txForm.type,
      amount: Number(txForm.amount), description: txForm.description.trim(),
      transaction_date: txForm.transaction_date,
      notes: txForm.notes.trim() || undefined,
    });
    setTxSaving(false);
    setTxDialogOpen(false);
  }

  // Settle future
  async function handleSettleFuture(id: string, status: FutureStatus) {
    const future = openFutures.find((f) => f.id === id);
    await settleFuture(id, status);
    if (status === "won" && future) {
      setWinBanners((prev) => [...prev, { id, description: future.description, payout: future.potential_payout }]);
    }
  }

  // Settle season
  async function handleSettleSeason(id: string, status: SeasonStatus) {
    const season = activeSeasons.find((s) => s.id === id);
    await settleSeason(id, status);
    if (status === "won" && season) {
      setWinBanners((prev) => [...prev, { id, description: season.description, payout: season.potential_payout }]);
    }
  }

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

      {/* Win banners */}
      {winBanners.map((b) => (
        <div key={b.id}
          className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--color-success)] bg-[var(--color-success)]/10 px-4 py-3 text-sm"
        >
          <span>
            <span className="mr-1.5">🎉</span>
            <strong>{b.description}</strong> ended as a win!
            {b.payout != null && (
              <span className="ml-2 text-[var(--color-success)]">
                Add <strong>{formatCurrency(b.payout)}</strong> to Checking as income.
              </span>
            )}
          </span>
          <button onClick={() => setWinBanners((prev) => prev.filter((x) => x.id !== b.id))}
            className="ml-4 rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X size={14} />
          </button>
        </div>
      ))}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Fantasy</h1>

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
                    className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-raised)]",
                      effectiveId === "ALL" && "text-[var(--color-primary)]"
                    )}
                  >
                    <span>All Accounts</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{formatCurrency(totalAllBalance)}</span>
                  </button>

                  {/* Sportsbook/DFS accounts */}
                  {sbAccounts.length > 0 && (
                    <>
                      <div className="my-1 h-px bg-[var(--color-border-subtle)]" />
                      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-subtle)]">
                        Sportsbook / DFS
                      </p>
                      {sbAccounts.map((a) => {
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
                    </>
                  )}

                  {/* League accounts */}
                  {leagueAccounts.length > 0 && (
                    <>
                      <div className="my-1 h-px bg-[var(--color-border-subtle)]" />
                      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-subtle)]">
                        Leagues
                      </p>
                      {leagueAccounts.map((a) => {
                        const summary = balanceSummary.find((b) => b.account_id === a.id);
                        return (
                          <button key={a.id}
                            onClick={() => { setSelectedId(a.id); setDropdownOpen(false); }}
                            className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-raised)]",
                              effectiveId === a.id && "text-[var(--color-primary)]"
                            )}
                          >
                            <div className="flex flex-col">
                              <span>{a.name}</span>
                              <span className="text-[10px] text-[var(--color-text-subtle)]">
                                Fantasy League{a.end_date ? ` · ends ${formatDate(a.end_date)}` : ""}
                              </span>
                            </div>
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {formatCurrency(summary?.starting_balance ?? 0)} buy-in
                            </span>
                          </button>
                        );
                      })}
                    </>
                  )}

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

        {/* Action buttons — context-aware */}
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

          {/* League view: Add Season */}
          {(viewIsLeague || (viewIsAll && leagueAccounts.length > 0)) && (
            <Button variant="outline" size="sm" onClick={() => setSeasonDialogOpen(true)}>
              <Trophy size={14} /> Add Season
            </Button>
          )}

          {/* Sportsbook/DFS view: Add Future */}
          {(!viewIsLeague || viewIsAll) && sbAccounts.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setFutureDialogOpen(true)}>
              <TrendingUp size={14} /> Add Future
            </Button>
          )}

          {/* Deposit/Cashout only for non-league accounts */}
          {!viewIsLeague && (
            <Button size="sm" onClick={openAddTx}>
              <Plus size={15} /> Deposit / Cashout
            </Button>
          )}
        </div>
      </div>

      {/* Balance / summary cards */}
      {viewIsLeague && selectedAccount ? (
        // ── League account view ──
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Card className="relative overflow-hidden">
            <div className="absolute left-0 top-0 h-full w-1 rounded-l-[var(--radius)]"
              style={{ backgroundColor: "var(--color-primary)" }} />
            <CardContent className="p-5 pl-6">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Buy-In</p>
              <p className="mt-1 text-2xl font-bold">{formatCurrency(selectedAccount.starting_balance)}</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">Not counted toward sportsbook balance</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Active Seasons</p>
              <p className="mt-1 text-2xl font-bold">{activeSeasons.length}</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{seasons.length} total</p>
            </CardContent>
          </Card>
          {selectedSummary?.end_date && (
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Season End</p>
                <p className="mt-1 text-base font-bold">{formatDate(selectedSummary.end_date)}</p>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        // ── Sportsbook/DFS / All view ──
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Card className="relative overflow-hidden">
            <div className="absolute left-0 top-0 h-full w-1 rounded-l-[var(--radius)]"
              style={{ backgroundColor: currentBalance >= 0 ? "var(--color-success)" : "var(--color-danger)" }} />
            <CardContent className="p-5 pl-6">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                {viewIsAll ? "Combined Balance" : "Account Balance"}
                {viewIsAll && leagueAccounts.length > 0 && (
                  <span className="ml-1 text-[var(--color-text-subtle)] normal-case"> (sportsbook + DFS)</span>
                )}
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
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{formatCurrency(totalOpenStake)} staked</p>
            </CardContent>
          </Card>

          {/* League buy-in summary in ALL view */}
          {viewIsAll && leagueAccounts.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">League Buy-Ins</p>
                <p className="mt-1 text-2xl font-bold">{formatCurrency(totalLeagueBuyIn)}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{leagueAccounts.length} league{leagueAccounts.length !== 1 ? "s" : ""} · {activeSeasons.length} active seasons</p>
              </CardContent>
            </Card>
          )}

          {/* Per-account in ALL view */}
          {viewIsAll && balanceSummary.filter((a) => !isLeague(a.platform_type)).map((a) => (
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
      )}

      {/* ── Performance analytics ────────────────────────────────────────── */}
      {hasPerformanceData && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card className="relative overflow-hidden">
              <div className="absolute left-0 top-0 h-full w-1 rounded-l-[var(--radius)]"
                style={{ backgroundColor: perfStats.netPnL >= 0 ? "var(--color-success)" : "var(--color-danger)" }} />
              <CardContent className="p-5 pl-6">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Net P&L</p>
                <p className={cn("mt-1 text-2xl font-bold",
                  perfStats.netPnL > 0 ? "text-[var(--color-success)]" : perfStats.netPnL < 0 ? "text-[var(--color-danger)]" : ""
                )}>
                  {perfStats.netPnL >= 0 ? "+" : ""}{formatCurrency(perfStats.netPnL)}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">cashouts + balance − deposits</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Total Deposited</p>
                <p className="mt-1 text-2xl font-bold">{formatCurrency(perfStats.totalIn)}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">money sent to platforms</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Total Cashed Out</p>
                <p className="mt-1 text-2xl font-bold text-[var(--color-success)]">{formatCurrency(perfStats.totalOut)}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">money returned to you</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Still In Accounts</p>
                <p className="mt-1 text-2xl font-bold">{formatCurrency(perfStats.inAccounts)}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">current tracked balance</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          {monthlyChartData.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

              {/* Monthly net cash flow by platform */}
              <Card>
                <CardHeader className="pb-0">
                  <CardTitle className="text-sm font-semibold">Monthly Net Cash Flow</CardTitle>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Positive = net cashout that month · Negative = net deposit
                  </p>
                </CardHeader>
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={monthlyChartData} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => `$${Math.abs(v)}`} tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} width={55} />
                      <Tooltip
                        formatter={(val: number, name: string) => [
                          `${val >= 0 ? "+" : ""}${formatCurrency(val)}`,
                          name,
                        ]}
                        contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", fontSize: 12 }}
                        labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                      />
                      <ReferenceLine y={0} stroke="var(--color-border)" />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                      <Bar dataKey="DFS" fill="#6366f1" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Sportsbook" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Cumulative P&L trend */}
              <Card>
                <CardHeader className="pb-0">
                  <CardTitle className="text-sm font-semibold">Cumulative P&L Trend</CardTitle>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Running net of cashouts minus deposits over time
                  </p>
                </CardHeader>
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={cumulativeChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => `${v >= 0 ? "+" : ""}$${Math.abs(v)}`} tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} width={60} />
                      <Tooltip
                        formatter={(val: number, name: string) => [
                          `${val >= 0 ? "+" : ""}${formatCurrency(val)}`,
                          name,
                        ]}
                        contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", fontSize: 12 }}
                        labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                      />
                      <ReferenceLine y={0} stroke="var(--color-border)" strokeDasharray="4 2" label={{ value: "Break-even", position: "insideTopRight", fontSize: 10, fill: "var(--color-text-subtle)" }} />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                      <Line type="monotone" dataKey="DFS" stroke="#6366f1" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="Sportsbook" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="Combined" stroke="var(--color-text-muted)" strokeWidth={2} strokeDasharray="4 2" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

            </div>
          )}
        </>
      )}

      {/* ── Seasons section (league accounts) ─────────────────────────────── */}
      {(viewIsLeague || (viewIsAll && leagueAccounts.length > 0)) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy size={15} className="text-[var(--color-primary)]" />
                <CardTitle className="text-sm font-semibold">
                  Seasons {activeSeasons.length > 0 && `(${activeSeasons.length} active)`}
                </CardTitle>
              </div>
              {settledSeasons.length > 0 && (
                <button
                  onClick={() => setShowSettledSeasons((v) => !v)}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  {showSettledSeasons ? "Hide settled" : `Show all (${seasons.length})`}
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {seasons.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">
                No seasons yet.{" "}
                <button onClick={() => setSeasonDialogOpen(true)} className="text-[var(--color-primary)] underline">
                  Add your first season
                </button>.
              </p>
            ) : (
              <SeasonsAccordion
                seasons={showSettledSeasons ? seasons : seasons.filter((s) => s.status === "active")}
                showAll={showSettledSeasons}
                onSettle={handleSettleSeason}
                onRemove={removeSeason}
                showAccountCol={viewIsAll}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Open Futures (sportsbook/DFS only) ────────────────────────────── */}
      {!viewIsLeague && openFutures.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-[var(--color-primary)]" />
              <CardTitle className="text-sm font-semibold">Open Futures ({openFutures.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)]">
                  <th className="pb-2 text-left font-medium">Description</th>
                  {viewIsAll && <th className="pb-2 text-left font-medium">Account</th>}
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
                    <td className="py-2.5 pr-3 font-medium">{f.description}</td>
                    {viewIsAll && <td className="py-2.5 pr-3 text-xs text-[var(--color-text-muted)]">{f.account_name}</td>}
                    <td className="py-2.5 pr-3 text-right">{formatCurrency(f.stake)}</td>
                    <td className="py-2.5 pr-3 text-right text-[var(--color-text-muted)]">
                      {f.odds ?? <span className="text-[var(--color-text-subtle)]">—</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[var(--color-success)]">
                      {f.potential_payout != null ? formatCurrency(f.potential_payout) : <span className="text-[var(--color-text-subtle)]">—</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[var(--color-text-muted)]">{formatDate(f.placed_date)}</td>
                    <td className="py-2.5 pl-2">
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => handleSettleFuture(f.id, "won")} title="Won"
                          className="rounded p-1 text-[var(--color-text-subtle)] hover:bg-[var(--color-success)]/15 hover:text-[var(--color-success)]">
                          <Check size={13} />
                        </button>
                        <button onClick={() => handleSettleFuture(f.id, "lost")} title="Lost"
                          className="rounded p-1 text-[var(--color-text-subtle)] hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)]">
                          <X size={13} />
                        </button>
                        <button onClick={() => handleSettleFuture(f.id, "void")} title="Void"
                          className="rounded p-1 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-muted)]">
                          <Minus size={13} />
                        </button>
                        <button onClick={() => removeFuture(f.id)} title="Delete"
                          className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]">
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

      {/* Settled futures */}
      {!viewIsLeague && settledFutures.length > 0 && (
        <div>
          <button onClick={() => setShowSettledFutures((v) => !v)}
            className="mb-2 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <TrendingUp size={13} />
            {showSettledFutures ? "Hide" : "Show"} settled futures ({settledFutures.length})
          </button>
          {showSettledFutures && (
            <Card>
              <CardContent className="pt-4">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {settledFutures.map((f) => (
                      <tr key={f.id} className="group">
                        <td className="py-2 pr-3 font-medium">{f.description}</td>
                        {viewIsAll && <td className="py-2 pr-3 text-xs text-[var(--color-text-muted)]">{f.account_name}</td>}
                        <td className="py-2 pr-3">
                          {f.status === "won" ? <Badge variant="success">Won</Badge>
                            : f.status === "lost" ? <Badge variant="danger">Lost</Badge>
                            : <Badge variant="default">Void</Badge>}
                        </td>
                        <td className="py-2 pr-3 text-right">{formatCurrency(f.stake)}</td>
                        <td className="py-2 pr-3 text-right text-[var(--color-text-muted)]">
                          {f.settled_date ? formatDate(f.settled_date) : "—"}
                        </td>
                        <td className="py-2 pl-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <button onClick={() => removeFuture(f.id)}
                            className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]">
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

      {/* Empty state for no futures / seasons */}
      {!viewIsLeague && openFutures.length === 0 && settledFutures.length === 0 && !dataLoading && sbAccounts.length > 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-[var(--color-text-muted)]">
            No futures tracked yet.{" "}
            <button onClick={() => setFutureDialogOpen(true)} className="text-[var(--color-primary)] underline">
              Add your first future
            </button>.
          </CardContent>
        </Card>
      )}

      {/* Transaction history (sportsbook/DFS only) */}
      {!viewIsLeague && transactions.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
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
                          {viewIsAll && <td className="py-2 pr-3 text-xs text-[var(--color-text-muted)]">{tx.account_name}</td>}
                          <td className="py-2 pr-3">
                            {tx.type === "deposit" ? <Badge variant="success">Deposit</Badge> : <Badge variant="danger">Cashout</Badge>}
                          </td>
                          <td className="py-2 pr-3 text-[var(--color-text-muted)]">{formatDate(tx.transaction_date)}</td>
                          <td className={cn("py-2 pr-3 text-right font-medium",
                            tx.type === "deposit" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]")}>
                            {tx.type === "deposit" ? "+" : "-"}{formatCurrency(tx.amount)}
                          </td>
                          <td className="py-2 pl-2 opacity-0 transition-opacity group-hover:opacity-100">
                            <button onClick={() => removeTransaction(tx.id)}
                              className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]">
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

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      {/* Deposit/Cashout */}
      <Dialog open={txDialogOpen} onClose={() => setTxDialogOpen(false)} title="Deposit / Cashout">
        <div className="flex flex-col gap-4">
          <Select label="Type" options={TX_TYPE_OPTIONS} value={txForm.type}
            onChange={(e) => setTxForm((f) => ({ ...f, type: e.target.value as FantasyTxType }))} />
          <Input label="Amount ($)" type="number" step="0.01" min="0.01" placeholder="0.00"
            value={txForm.amount} onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))}
            error={txErrors.amount} />
          <Input label="Description"
            placeholder={txForm.type === "deposit" ? "e.g. Initial deposit" : "e.g. Withdrawal to checking"}
            value={txForm.description} onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))}
            error={txErrors.description} />
          <Input label="Date" type="date" value={txForm.transaction_date}
            onChange={(e) => setTxForm((f) => ({ ...f, transaction_date: e.target.value }))}
            error={txErrors.transaction_date} />
          <Input label="Notes (optional)" placeholder="Any context" value={txForm.notes}
            onChange={(e) => setTxForm((f) => ({ ...f, notes: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setTxDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveTx} disabled={txSaving}>{txSaving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </Dialog>

      {/* Add Future */}
      <FutureDialog
        open={futureDialogOpen}
        onClose={() => setFutureDialogOpen(false)}
        accounts={accounts}
        defaultAccountId={viewIsLeague ? (sbAccounts[0]?.id ?? "") : (effectiveId === "ALL" ? (sbAccounts[0]?.id ?? "") : effectiveId)}
        onSave={addFuture}
      />

      {/* Add Season */}
      <SeasonDialog
        open={seasonDialogOpen}
        onClose={() => setSeasonDialogOpen(false)}
        accountId={viewIsLeague ? effectiveId : (leagueAccounts[0]?.id ?? "")}
        onSave={addSeason}
      />

      {/* Add/Edit Account */}
      <AccountDialog
        open={accountDialogOpen}
        onClose={() => { setAccountDialogOpen(false); setEditingAccount(null); }}
        onSave={async (d) => {
          if (editingAccount) await editAccount(editingAccount.id, d);
          else await addAccount(d);
        }}
        initial={editingAccount ? {
          name: editingAccount.name,
          platform_type: editingAccount.platform_type,
          starting_balance: String(editingAccount.starting_balance),
          starting_date: editingAccount.starting_date,
          end_date: editingAccount.end_date ?? "",
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
    month: "short", day: "numeric", year: "numeric",
  });
}
