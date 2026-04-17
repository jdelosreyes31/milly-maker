import React, { useState, useMemo, useEffect } from "react";
import {
  Plus, Trash2, ChevronDown, ChevronRight,
  ArrowDownLeft, ArrowUpRight,
  Check, X, Minus, Settings2, Trophy, TrendingUp, Link2, ClipboardList, Dices, FileDown,
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
import { useFantasyAccounts, useFantasyData, useFantasyLinks, useUnderdogBets, useUnderdogTargets } from "@/db/hooks/useFantasy.js";
import { useCheckingAccounts } from "@/db/hooks/useChecking.js";
import { useSavingsAccounts } from "@/db/hooks/useSavings.js";
import { useDb } from "@/db/hooks/useDb.js";
import { insertTransaction } from "@/db/queries/checking.js";
import { insertSavingsTransaction } from "@/db/queries/savings.js";
import type {
  FantasyPlatformType, FantasyTxType,
  FutureStatus, SeasonStatus, FantasyContest, FantasyBetSession, UnderdogBet, UnderdogMonthlyTarget,
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
  from_source: boolean;
  source_account_id: string; // "checking:{id}" | "savings:{id}"
}

const EMPTY_TX: TxFormState = {
  type: "deposit", amount: "", description: "",
  transaction_date: new Date().toISOString().slice(0, 10), notes: "",
  from_source: false, source_account_id: "",
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

// ── Bet session dialog ────────────────────────────────────────────────────────

interface BetSessionFormState {
  session_date: string;
  total_bet: string;
  notes: string;
}

const EMPTY_BET_SESSION: BetSessionFormState = {
  session_date: new Date().toISOString().slice(0, 10),
  total_bet: "", notes: "",
};

interface BetSessionDialogProps {
  open: boolean;
  onClose: () => void;
  accountId: string;
  onSave: (data: {
    account_id: string; session_date: string;
    total_bet: number; notes?: string;
  }) => Promise<void>;
}

function BetSessionDialog({ open, onClose, accountId, onSave }: BetSessionDialogProps) {
  const [form, setForm] = useState<BetSessionFormState>(EMPTY_BET_SESSION);
  const [errors, setErrors] = useState<Partial<BetSessionFormState>>({});
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) { setForm(EMPTY_BET_SESSION); setErrors({}); }
  }, [open]);

  const bet = Number(form.total_bet);

  const f = (k: keyof BetSessionFormState, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  async function handleSave() {
    const e: Partial<BetSessionFormState> = {};
    if (!form.session_date) e.session_date = "Required";
    if (form.total_bet === "" || isNaN(bet) || bet < 0) e.total_bet = "Enter a valid amount";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    await onSave({
      account_id: accountId,
      session_date: form.session_date,
      total_bet: bet,
      notes: form.notes.trim() || undefined,
    });
    setSaving(false);
    onClose();
  }


  return (
    <Dialog open={open} onClose={onClose} title="Log Bet Result">
      <div className="flex flex-col gap-4">
        <Input label="Session Date" type="date" value={form.session_date}
          onChange={(e) => f("session_date", e.target.value)} error={errors.session_date} />
        <Input label="Total Bet ($)" type="number" step="0.01" min="0" placeholder="105.00"
          value={form.total_bet} onChange={(e) => f("total_bet", e.target.value)}
          error={errors.total_bet} />
        <Input label="Notes (optional)" placeholder="e.g. Sunday NFL slate"
          value={form.notes} onChange={(e) => f("notes", e.target.value)} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Open Session"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Settle bet session dialog ─────────────────────────────────────────────────

interface SettleBetSessionDialogProps {
  open: boolean;
  onClose: () => void;
  session: FantasyBetSession | null;
  onSettle: (id: string, total_settled: number) => Promise<void>;
}

function SettleBetSessionDialog({ open, onClose, session, onSettle }: SettleBetSessionDialogProps) {
  const [totalSettled, setTotalSettled] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) { setTotalSettled(""); setError(""); }
  }, [open]);

  const settled = Number(totalSettled);
  const net = totalSettled !== "" && !isNaN(settled) && session
    ? Math.round((settled - session.total_bet) * 100) / 100
    : null;

  async function handleSettle() {
    if (totalSettled === "" || isNaN(settled) || settled < 0) {
      setError("Enter a valid amount"); return;
    }
    if (!session) return;
    setSaving(true);
    await onSettle(session.id, settled);
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Settle Bet Session">
      {session && (
        <div className="flex flex-col gap-4">
          <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm">
            <span className="text-[var(--color-text-muted)]">{formatDate(session.session_date)}</span>
            <span className="mx-2 text-[var(--color-text-subtle)]">·</span>
            <span className="font-medium">Bet: {formatCurrency(session.total_bet)}</span>
            {session.notes && <span className="ml-2 text-xs text-[var(--color-text-subtle)]">{session.notes}</span>}
          </div>
          <Input label="Total Settled ($)" type="number" step="0.01" min="0" placeholder="125.00"
            value={totalSettled} onChange={(e) => { setTotalSettled(e.target.value); setError(""); }}
            error={error} />
          {net !== null && (
            <div className={cn(
              "rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium",
              net >= 0 ? "bg-[var(--color-success)]/10 text-[var(--color-success)]"
                       : "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
            )}>
              Net: {net >= 0 ? "+" : ""}{formatCurrency(net)}
              <span className="ml-1 font-normal opacity-75">— balance {net >= 0 ? "grows" : "drops"}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSettle} disabled={saving}>
              {saving ? "Settling…" : "Settle"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ── Contest dialog ────────────────────────────────────────────────────────────

interface ContestFormState {
  description: string;
  entry_fee: string;
  contest_size: string;
  placed_date: string;
  finish_position: string;
  winnings: string;
  settled_date: string;
  notes: string;
}

const EMPTY_CONTEST: ContestFormState = {
  description: "", entry_fee: "", contest_size: "",
  placed_date: new Date().toISOString().slice(0, 10),
  finish_position: "", winnings: "", settled_date: "", notes: "",
};

interface ContestSaveData {
  account_id: string; description: string; entry_fee: number;
  contest_size?: number; finish_position?: number; winnings?: number;
  placed_date: string; settled_date?: string; notes?: string;
}

interface ContestDialogProps {
  open: boolean;
  onClose: () => void;
  accounts: { id: string; name: string; platform_type: FantasyPlatformType }[];
  defaultAccountId: string;
  onSave: (data: ContestSaveData) => Promise<void>;
}

function ContestDialog({ open, onClose, accounts, defaultAccountId, onSave }: ContestDialogProps) {
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [form, setForm] = useState<ContestFormState>(EMPTY_CONTEST);
  const [errors, setErrors] = useState<Partial<ContestFormState>>({});
  const [saving, setSaving] = useState(false);

  const sbAccounts = accounts.filter((a) => !isLeague(a.platform_type));
  const accountOptions = sbAccounts.map((a) => ({ value: a.id, label: a.name }));

  React.useEffect(() => {
    if (open) {
      setAccountId(defaultAccountId);
      setForm(EMPTY_CONTEST);
      setErrors({});
    }
  }, [open, defaultAccountId]);

  async function handleSave() {
    const e: Partial<ContestFormState> = {};
    if (!form.description.trim()) e.description = "Required";
    if (form.entry_fee === "" || isNaN(Number(form.entry_fee)) || Number(form.entry_fee) < 0)
      e.entry_fee = "Enter a valid entry fee";
    if (!form.placed_date) e.placed_date = "Required";
    if (!accountId) e.description = "Select an account";
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    await onSave({
      account_id: accountId,
      description: form.description.trim(),
      entry_fee: Number(form.entry_fee),
      contest_size: form.contest_size ? Number(form.contest_size) : undefined,
      finish_position: form.finish_position ? Number(form.finish_position) : undefined,
      winnings: form.winnings !== "" ? Number(form.winnings) : undefined,
      placed_date: form.placed_date,
      settled_date: form.settled_date || undefined,
      notes: form.notes.trim() || undefined,
    });
    setSaving(false);
    onClose();
  }

  const f = (k: keyof ContestFormState, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  return (
    <Dialog open={open} onClose={onClose} title="Add Contest">
      <div className="flex flex-col gap-4">
        {accountOptions.length > 1 && (
          <Select label="Account" options={accountOptions} value={accountId}
            onChange={(e) => setAccountId(e.target.value)} />
        )}
        <Input label="Description" placeholder="e.g. NFL Sunday Millionaire Week 10"
          value={form.description} onChange={(e) => f("description", e.target.value)}
          error={errors.description} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Entry Fee ($)" type="number" step="0.01" min="0" placeholder="25.00"
            value={form.entry_fee} onChange={(e) => f("entry_fee", e.target.value)}
            error={errors.entry_fee} />
          <Input label="Contest Size (# entrants, optional)" type="number" min="1" placeholder="150"
            value={form.contest_size} onChange={(e) => f("contest_size", e.target.value)} />
        </div>
        <Input label="Date Played" type="date" value={form.placed_date}
          onChange={(e) => f("placed_date", e.target.value)} error={errors.placed_date} />

        <p className="text-xs text-[var(--color-text-muted)]">
          Results — fill in now or leave blank to settle later
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Finish Position (optional)" type="number" min="1" placeholder="42"
            value={form.finish_position} onChange={(e) => f("finish_position", e.target.value)} />
          <Input label="Winnings ($, optional)" type="number" step="0.01" min="0" placeholder="0.00"
            value={form.winnings} onChange={(e) => f("winnings", e.target.value)} />
        </div>
        <Input label="Settled Date (optional)" type="date" value={form.settled_date}
          onChange={(e) => f("settled_date", e.target.value)} />

        <Input label="Notes (optional)" placeholder="Any context" value={form.notes}
          onChange={(e) => f("notes", e.target.value)} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Add Contest"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Contest edit/settle dialog ────────────────────────────────────────────────

interface ContestUpdateData {
  description?: string;
  entry_fee?: number;
  contest_size?: number | null;
  finish_position?: number | null;
  winnings?: number | null;
  placed_date?: string;
  settled_date?: string | null;
  notes?: string | null;
}

interface ContestEditDialogProps {
  contest: FantasyContest | null;
  mode: "settle" | "edit";
  onClose: () => void;
  onSave: (id: string, data: ContestUpdateData) => Promise<void>;
}

function ContestEditDialog({ contest, mode, onClose, onSave }: ContestEditDialogProps) {
  const [description, setDescription] = useState("");
  const [entryFee, setEntryFee] = useState("");
  const [contestSize, setContestSize] = useState("");
  const [finish, setFinish] = useState("");
  const [winnings, setWinnings] = useState("");
  const [placedDate, setPlacedDate] = useState("");
  const [settledDate, setSettledDate] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (contest) {
      setDescription(contest.description);
      setEntryFee(String(contest.entry_fee));
      setContestSize(contest.contest_size != null ? String(contest.contest_size) : "");
      setFinish(contest.finish_position != null ? String(contest.finish_position) : "");
      setWinnings(contest.winnings != null ? String(contest.winnings) : "");
      setPlacedDate(contest.placed_date);
      setSettledDate(contest.settled_date ?? new Date().toISOString().slice(0, 10));
      setNotes(contest.notes ?? "");
      setErrors({});
    }
  }, [contest]);

  async function handleSave() {
    const e: Record<string, string> = {};
    if (mode === "settle") {
      if (winnings === "" || isNaN(Number(winnings)) || Number(winnings) < 0)
        e.winnings = "Enter winnings (0 if you lost)";
      if (!settledDate) e.settledDate = "Required";
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    const data: ContestUpdateData = {
      description: description || undefined,
      entry_fee: entryFee ? Number(entryFee) : undefined,
      contest_size: contestSize ? Number(contestSize) : null,
      finish_position: finish ? Number(finish) : null,
      winnings: winnings !== "" ? Number(winnings) : mode === "settle" ? 0 : null,
      placed_date: placedDate || undefined,
      settled_date: settledDate || null,
      notes: notes || null,
    };
    await onSave(contest!.id, data);
    setSaving(false);
    onClose();
  }

  const isSettle = mode === "settle";
  const title = isSettle ? `Settle: ${contest?.description ?? ""}` : `Edit: ${contest?.description ?? ""}`;

  return (
    <Dialog open={!!contest} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        {!isSettle && (
          <>
            <Input label="Description" value={description} onChange={e => setDescription(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Entry Fee ($)" type="number" step="0.01" min="0" value={entryFee}
                onChange={e => setEntryFee(e.target.value)} />
              <Input label="Contest Size (# entrants)" type="number" min="1" value={contestSize}
                onChange={e => setContestSize(e.target.value)} placeholder="optional" />
            </div>
            <Input label="Date Played" type="date" value={placedDate}
              onChange={e => setPlacedDate(e.target.value)} />
          </>
        )}
        {isSettle && (
          <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm">
            <span className="text-[var(--color-text-muted)]">Entry fee:</span>{" "}
            <strong>{formatCurrency(contest?.entry_fee ?? 0)}</strong>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Finish Position" type="number" min="1" placeholder="42"
            value={finish} onChange={e => setFinish(e.target.value)} />
          <Input label="Winnings ($)" type="number" step="0.01" min="0" placeholder="0.00"
            value={winnings} onChange={e => setWinnings(e.target.value)}
            error={errors.winnings} />
        </div>
        <Input label={isSettle ? "Settled Date" : "Settled Date (leave blank if still open)"}
          type="date" value={settledDate}
          onChange={e => setSettledDate(e.target.value)} error={errors.settledDate} />
        {!isSettle && (
          <Input label="Notes" placeholder="Any context" value={notes}
            onChange={e => setNotes(e.target.value)} />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : isSettle ? "Settle" : "Save Changes"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function FantasyPage() {
  const { accounts, loading: accountsLoading, addAccount, editAccount } = useFantasyAccounts();
  const { links: fundingLinks, removeLink: removeFundingLink, addLink: addFundingLink } = useFantasyLinks();
  const { accounts: checkingAccounts } = useCheckingAccounts();
  const { accounts: savingsAccounts } = useSavingsAccounts();
  const { conn } = useDb();
  const [selectedId, setSelectedId] = useState<string>("ALL");

  const effectiveId = accounts.length === 0 ? "ALL" : selectedId;

  const {
    transactions, openFutures, settledFutures,
    seasons, activeSeasons, settledSeasons,
    contests, betSessions,
    balanceSummary, loading: dataLoading,
    currentBalance, totalOpenStake,
    addTransaction, removeTransaction,
    addFuture, settleFuture, removeFuture,
    addSeason, settleSeason, removeSeason,
    addContest, resolveContest, editContest, removeContest,
    addBetSession, settleBetSession, removeBetSession,
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
  const [contestDialogOpen, setContestDialogOpen] = useState(false);
  const [settleContestTarget, setSettleContestTarget] = useState<FantasyContest | null>(null);
  const [editContestTarget, setEditContestTarget] = useState<FantasyContest | null>(null);
  const [showSettledContests, setShowSettledContests] = useState(false);
  const [betSessionDialogOpen, setBetSessionDialogOpen] = useState(false);
  const [settleBetSessionDialogOpen, setSettleBetSessionDialogOpen] = useState(false);
  const [settlingBetSession, setSettlingBetSession] = useState<FantasyBetSession | null>(null);
  const [winBanners, setWinBanners] = useState<WinBanner[]>([]);
  const [simTab, setSimTab] = useState<"overview" | "bets" | "simulator">("overview");
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);

  async function handleResetAccount(accountId: string) {
    if (!conn) return;
    setResetting(true);
    try {
      // Delete all data associated with this account, FK-safe order
      await conn.query(`
        DELETE FROM checking_fantasy_links
        WHERE fantasy_account_id = '${accountId}'
           OR fantasy_tx_id IN (
             SELECT id FROM fantasy_transactions WHERE account_id = '${accountId}'
           )
      `);
      await conn.query(`DELETE FROM underdog_bets WHERE account_id = '${accountId}'`);
      await conn.query(`DELETE FROM underdog_monthly_targets WHERE account_id = '${accountId}'`);
      await conn.query(`DELETE FROM fantasy_bet_sessions WHERE account_id = '${accountId}'`);
      await conn.query(`DELETE FROM fantasy_contests WHERE account_id = '${accountId}'`);
      await conn.query(`DELETE FROM fantasy_futures WHERE account_id = '${accountId}'`);
      await conn.query(`DELETE FROM fantasy_transactions WHERE account_id = '${accountId}'`);
      await conn.query(`DELETE FROM fantasy_seasons WHERE account_id = '${accountId}'`);
      setResetDialogOpen(false);
      setResetConfirmText("");
    } finally {
      setResetting(false);
    }
  }

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

  // Non-league summary rows — scoped to selected account when not in ALL view
  const sbSummary = useMemo(() => {
    const nonLeague = balanceSummary.filter((a) => !isLeague(a.platform_type));
    return effectiveId === "ALL" ? nonLeague : nonLeague.filter((a) => a.account_id === effectiveId);
  }, [balanceSummary, effectiveId]);

  // Funding links scoped to the selected account (or all if ALL view)
  const visibleFundingLinks = useMemo(() =>
    effectiveId === "ALL"
      ? fundingLinks
      : fundingLinks.filter((l) => l.fantasy_account_id === effectiveId),
  [fundingLinks, effectiveId]);

  // Totals for stat cards
  const perfStats = useMemo(() => {
    // Win payouts from settled futures are stored as type='deposit' with description "Win: …".
    // They are earnings (platform → user), not bank→platform transfers, so they are excluded
    // from "Total Deposited" but included in P&L metrics.
    const sbWinPayouts = transactions
      .filter(t => !isLeague(t.platform_type) && t.type === "deposit" && t.description.startsWith("Win:"))
      .reduce((s, t) => s + t.amount, 0);

    // Sportsbook/DFS: direct deposits + linked deposits that created a fantasy tx are in total_deposited.
    // Orphan links (old manual links with no fantasy_tx_id) are counted separately via orphan_linked_in.
    // starting_balance is an account snapshot (origin point), not a P&L event.
    const sbTotalIn  = sbSummary.reduce((s, a) => s + a.total_deposited + a.orphan_linked_in, 0) - sbWinPayouts;
    const sbTotalOut = sbSummary.reduce((s, a) => s + a.total_cashout, 0);
    const inAccounts = sbSummary.reduce((s, a) => s + a.current_balance, 0);

    // Fantasy leagues: buy-ins ARE explicit money spent, so include them.
    // Won season payouts (potential_payout) count as money received.
    const leagueBuyIn = seasons.reduce((s, se) => s + se.buy_in, 0);
    const leagueWon   = seasons
      .filter((se) => se.status === "won")
      .reduce((s, se) => s + (se.potential_payout ?? 0), 0);

    const totalIn  = sbTotalIn + leagueBuyIn;
    const totalOut = sbTotalOut + leagueWon;
    // Net P&L: bet session wins + future win payouts − open stakes + league outcomes.
    // Deposits and cashouts are neutral fund movements and excluded.
    // starting_balance is pre-existing capital and excluded.
    const bettingPnL = sbSummary.reduce((s, a) => s + (a.net_betting_pnl ?? 0), 0) + sbWinPayouts;
    const sbOpenFuturesStake = sbSummary.reduce((s, a) => s + a.open_futures_stake, 0);
    const netPnL = bettingPnL - sbOpenFuturesStake + leagueWon - leagueBuyIn;
    return { totalIn, totalOut, inAccounts, netPnL, bettingPnL };
  }, [sbSummary, seasons, transactions]);

  // Monthly net per platform (for bar chart)
  const monthlyChartData = useMemo(() => {
    const sbTxs = transactions.filter((tx) => !isLeague(tx.platform_type));
    const byMonth = new Map<string, { dfs: number; sportsbook: number }>();
    for (const tx of sbTxs) {
      const month = tx.transaction_date.slice(0, 7);
      const curr = byMonth.get(month) ?? { dfs: 0, sportsbook: 0 };
      const isWinPayout = tx.type === "deposit" && tx.description.startsWith("Win:");
      const sign = (tx.type === "cashout" || isWinPayout) ? 1 : -1;
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
      const isWinPayout = tx.type === "deposit" && tx.description.startsWith("Win:");
      const sign = (tx.type === "cashout" || isWinPayout) ? 1 : -1;
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

  // Source account options for deposit origin selector
  const sourceAccountOptions = [
    ...checkingAccounts.map((a) => ({ value: `checking:${a.id}`, label: `Checking · ${a.name}` })),
    ...savingsAccounts.map((a) => ({ value: `savings:${a.id}`, label: `Savings · ${a.name}` })),
  ];

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
    const fantasyTxId = await addTransaction({
      account_id: accountId, type: txForm.type,
      amount: Number(txForm.amount), description: txForm.description.trim(),
      transaction_date: txForm.transaction_date,
      notes: txForm.notes.trim() || undefined,
    });

    // Optionally create a matching debit in the source checking/savings account + funding link
    if (txForm.type === "deposit" && txForm.from_source && txForm.source_account_id && conn) {
      const [sourceType, sourceId] = txForm.source_account_id.split(":");
      const desc = txForm.description.trim() || "Fantasy deposit";
      if (sourceType === "checking") {
        const srcTxId = await insertTransaction(conn, {
          account_id: sourceId!,
          type: "debit",
          amount: Number(txForm.amount),
          description: desc,
          transaction_date: txForm.transaction_date,
          notes: txForm.notes.trim() || undefined,
          category: "Fantasy",
        });
        if (srcTxId) {
          // Pass fantasy_tx_id so this link is not double-counted in Total Deposited
          await addFundingLink({ checking_tx_id: srcTxId, fantasy_account_id: accountId, fantasy_tx_id: fantasyTxId ?? undefined });
        }
      } else if (sourceType === "savings") {
        await insertSavingsTransaction(conn, {
          account_id: sourceId!,
          type: "withdrawal",
          amount: Number(txForm.amount),
          description: desc,
          transaction_date: txForm.transaction_date,
          notes: txForm.notes.trim() || undefined,
        });
      }
    }

    setTxSaving(false);
    setTxDialogOpen(false);
  }

  // Settle future
  async function handleSettleFuture(id: string, status: FutureStatus) {
    const future = openFutures.find((f) => f.id === id);
    const today = new Date().toISOString().slice(0, 10);
    let depositAmount: number | null = null;
    if (status === "won" && future && future.potential_payout != null) {
      const accountStart = balanceSummary.find((b) => b.account_id === future.account_id)?.starting_date;
      // Post-start futures had their stake deducted from balance; deposit only profit to avoid double-counting.
      // Pre-start futures were never deducted; deposit the full payout as before.
      const isPostStart = accountStart != null && future.placed_date > accountStart;
      depositAmount = isPostStart ? future.potential_payout - future.stake : future.potential_payout;
    }
    await settleFuture(id, status,
      depositAmount != null && depositAmount > 0
        ? {
            account_id: future!.account_id,
            amount: depositAmount,
            description: `Win: ${future!.description}`,
            date: today,
          }
        : undefined
    );
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
                <strong>{formatCurrency(b.payout)}</strong> deposited to your account balance.
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
            <>
              <button
                onClick={() => { setResetConfirmText(""); setResetDialogOpen(true); }}
                className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-red-500/10 hover:text-[var(--color-danger)]"
                title={`Reset ${selectedAccount.name}`}
              >
                <Trash2 size={15} />
              </button>
              <button
                onClick={() => { setEditingAccount(selectedAccount); setAccountDialogOpen(true); }}
                className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-muted)]"
                title="Edit account"
              >
                <Settings2 size={15} />
              </button>
            </>
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

          {/* DFS/non-league view: Add Contest */}
          {(!viewIsLeague || viewIsAll) && sbAccounts.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setContestDialogOpen(true)}>
              <ClipboardList size={14} /> Add Contest
            </Button>
          )}

          {/* Log Bet Result — single non-league account only */}
          {!viewIsLeague && !viewIsAll && (
            <Button variant="outline" size="sm" onClick={() => setBetSessionDialogOpen(true)}>
              <Dices size={14} /> Log Bet Result
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

      {/* Tab bar — single non-league account only */}
      {!viewIsLeague && !viewIsAll && (
        <div className="flex gap-1 border-b border-[var(--color-border-subtle)]">
          {([
            { key: "overview", label: "Overview" },
            { key: "bets", label: "Bet Log" },
            { key: "simulator", label: "Simulator" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSimTab(key)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                simTab === key
                  ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(viewIsLeague || viewIsAll || simTab === "overview") && (<>
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
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">bet P&L − open stakes + league gains</p>
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

            {betSessions.some((b) => b.total_settled != null) && (
              <Card className="relative overflow-hidden">
                <div className="absolute left-0 top-0 h-full w-1 rounded-l-[var(--radius)]"
                  style={{ backgroundColor: perfStats.bettingPnL >= 0 ? "var(--color-success)" : "var(--color-danger)" }} />
                <CardContent className="p-5 pl-6">
                  <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Betting P&L</p>
                  <p className={cn("mt-1 text-2xl font-bold",
                    perfStats.bettingPnL > 0 ? "text-[var(--color-success)]" : perfStats.bettingPnL < 0 ? "text-[var(--color-danger)]" : ""
                  )}>
                    {perfStats.bettingPnL >= 0 ? "+" : ""}{formatCurrency(perfStats.bettingPnL)}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">bet sessions + future wins</p>
                </CardContent>
              </Card>
            )}
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

      {/* ── Contests (DFS / sportsbook) ───────────────────────────────────── */}
      {!viewIsLeague && contests.length > 0 && (() => {
        const pending  = contests.filter((c) => c.winnings == null && c.finish_position == null);
        const settled  = contests.filter((c) => c.winnings != null || c.finish_position != null);
        const visible  = showSettledContests ? contests : pending.length > 0 ? pending : contests;
        const totalNet = settled.reduce((s, c) => s + (c.winnings ?? 0) - c.entry_fee, 0);

        return (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList size={15} className="text-[var(--color-primary)]" />
                  <CardTitle className="text-sm font-semibold">
                    Contests{pending.length > 0 && ` (${pending.length} pending)`}
                  </CardTitle>
                  {settled.length > 0 && (
                    <span className={`text-xs font-medium ${totalNet >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                      {totalNet >= 0 ? "+" : ""}{formatCurrency(totalNet)} net
                    </span>
                  )}
                </div>
                {settled.length > 0 && (
                  <button
                    onClick={() => setShowSettledContests((v) => !v)}
                    className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    {showSettledContests ? "Hide settled" : `Show all (${contests.length})`}
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)]">
                    <th className="pb-2 text-left font-medium">Description</th>
                    {viewIsAll && <th className="pb-2 text-left font-medium">Account</th>}
                    <th className="pb-2 text-right font-medium">Entry Fee</th>
                    <th className="pb-2 text-right font-medium">Contest Size</th>
                    <th className="pb-2 text-right font-medium">Placed</th>
                    <th className="pb-2 text-right font-medium">Finish</th>
                    <th className="pb-2 text-right font-medium">Winnings</th>
                    <th className="pb-2 text-right font-medium">Net</th>
                    <th className="pb-2 text-right font-medium">Settled</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {visible.map((c) => {
                    const isSettled = c.winnings != null || c.finish_position != null;
                    const net = isSettled ? (c.winnings ?? 0) - c.entry_fee : null;
                    return (
                      <tr key={c.id} className="group">
                        <td className="py-2.5 pr-3 font-medium">{c.description}</td>
                        {viewIsAll && (
                          <td className="py-2.5 pr-3 text-xs text-[var(--color-text-muted)]">{c.account_name}</td>
                        )}
                        <td className="py-2.5 pr-3 text-right text-[var(--color-danger)]">
                          {formatCurrency(c.entry_fee)}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-[var(--color-text-muted)]">
                          {c.contest_size != null ? c.contest_size.toLocaleString() : <span className="text-[var(--color-text-subtle)]">—</span>}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-[var(--color-text-muted)]">
                          {formatDate(c.placed_date)}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-[var(--color-text-muted)]">
                          {c.finish_position != null
                            ? c.contest_size != null
                              ? `${c.finish_position} / ${c.contest_size.toLocaleString()}`
                              : String(c.finish_position)
                            : <span className="text-[var(--color-text-subtle)]">—</span>}
                        </td>
                        <td className="py-2.5 pr-3 text-right">
                          {isSettled
                            ? <span className={(c.winnings ?? 0) > 0 ? "text-[var(--color-success)]" : "text-[var(--color-text-muted)]"}>
                                {formatCurrency(c.winnings ?? 0)}
                              </span>
                            : <span className="text-[var(--color-text-subtle)]">—</span>}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-medium">
                          {net != null
                            ? <span className={net >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
                                {net >= 0 ? "+" : ""}{formatCurrency(net)}
                              </span>
                            : <Badge variant="outline" className="border-amber-500/50 text-amber-500">In Play</Badge>}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-[var(--color-text-muted)]">
                          {c.settled_date ? formatDate(c.settled_date) : <span className="text-[var(--color-text-subtle)]">—</span>}
                        </td>
                        <td className="py-2.5 pl-2">
                          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            {!isSettled ? (
                              <button
                                onClick={() => setSettleContestTarget(c)}
                                className="rounded px-1.5 py-0.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10"
                                title="Settle contest"
                              >
                                Settle
                              </button>
                            ) : (
                              <button
                                onClick={() => setEditContestTarget(c)}
                                className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"
                                title="Edit contest"
                              >
                                <Settings2 size={13} />
                              </button>
                            )}
                            <button
                              onClick={() => removeContest(c.id)}
                              className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
                              title="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })()}

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

      {/* ── Bet Sessions ──────────────────────────────────────────────────── */}
      {!viewIsLeague && betSessions.length > 0 && (() => {
        const openSessions   = betSessions.filter((b) => b.total_settled == null);
        const settledSessions = betSessions.filter((b) => b.total_settled != null);
        const totalNet = settledSessions.reduce((s, b) => s + (b.net ?? 0), 0);
        return (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Dices size={15} className="text-[var(--color-primary)]" />
                <CardTitle className="text-sm font-semibold">Bet Sessions</CardTitle>
                {settledSessions.length > 0 && (
                  <span className={`text-xs font-medium ${totalNet >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                    {totalNet >= 0 ? "+" : ""}{formatCurrency(totalNet)} net
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Open sessions */}
              {openSessions.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Open</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)]">
                        <th className="pb-2 text-left font-medium">Date</th>
                        {viewIsAll && <th className="pb-2 text-left font-medium">Account</th>}
                        <th className="pb-2 text-right font-medium">Total Bet</th>
                        <th className="pb-2 pl-3 text-left font-medium">Notes</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-subtle)]">
                      {openSessions.map((b) => (
                        <tr key={b.id} className="group">
                          <td className="py-2.5 pr-3 text-[var(--color-text-muted)]">{formatDate(b.session_date)}</td>
                          {viewIsAll && <td className="py-2.5 pr-3 text-xs text-[var(--color-text-muted)]">{b.account_name}</td>}
                          <td className="py-2.5 pr-3 text-right">{formatCurrency(b.total_bet)}</td>
                          <td className="py-2.5 pl-3 text-xs text-[var(--color-text-muted)]">
                            {b.notes ?? <span className="text-[var(--color-text-subtle)]">—</span>}
                          </td>
                          <td className="py-2.5 pl-2">
                            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                onClick={() => { setSettlingBetSession(b); setSettleBetSessionDialogOpen(true); }}
                                className="rounded px-2 py-0.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10"
                                title="Settle">
                                Settle
                              </button>
                              <button onClick={() => removeBetSession(b.id)}
                                className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
                                title="Delete">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Settled sessions */}
              {settledSessions.length > 0 && (
                <div>
                  {openSessions.length > 0 && (
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Settled</p>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)]">
                        <th className="pb-2 text-left font-medium">Date</th>
                        {viewIsAll && <th className="pb-2 text-left font-medium">Account</th>}
                        <th className="pb-2 text-right font-medium">Total Bet</th>
                        <th className="pb-2 text-right font-medium">Total Settled</th>
                        <th className="pb-2 text-right font-medium">Net P&L</th>
                        <th className="pb-2 pl-3 text-left font-medium">Notes</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-subtle)]">
                      {settledSessions.map((b) => (
                        <tr key={b.id} className="group">
                          <td className="py-2.5 pr-3 text-[var(--color-text-muted)]">{formatDate(b.session_date)}</td>
                          {viewIsAll && <td className="py-2.5 pr-3 text-xs text-[var(--color-text-muted)]">{b.account_name}</td>}
                          <td className="py-2.5 pr-3 text-right">{formatCurrency(b.total_bet)}</td>
                          <td className="py-2.5 pr-3 text-right">{formatCurrency(b.total_settled!)}</td>
                          <td className="py-2.5 pr-3 text-right font-medium">
                            <span className={(b.net ?? 0) >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
                              {(b.net ?? 0) >= 0 ? "+" : ""}{formatCurrency(b.net ?? 0)}
                            </span>
                          </td>
                          <td className="py-2.5 pl-3 text-xs text-[var(--color-text-muted)]">
                            {b.notes ?? <span className="text-[var(--color-text-subtle)]">—</span>}
                          </td>
                          <td className="py-2.5 pl-2 opacity-0 transition-opacity group-hover:opacity-100">
                            <button onClick={() => removeBetSession(b.id)}
                              className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
                              title="Delete">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

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

      {/* ── Funding Log ─────────────────────────────────────────────────────── */}
      {visibleFundingLinks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Link2 size={15} className="text-[var(--color-primary)]" />
              <CardTitle className="text-sm font-semibold">
                Funding Log ({visibleFundingLinks.length})
              </CardTitle>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Checking transactions that funded this account.
            </p>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)]">
                  <th className="pb-2 text-left font-medium">Description</th>
                  <th className="pb-2 text-left font-medium">Source</th>
                  <th className="pb-2 text-left font-medium">Fantasy Account</th>
                  <th className="pb-2 text-right font-medium">Amount</th>
                  <th className="pb-2 text-right font-medium">Date</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {visibleFundingLinks.map((link) => (
                  <tr key={link.id} className="group">
                    <td className="py-2.5 pr-3 font-medium">{link.description}</td>
                    <td className="py-2.5 pr-3 text-xs text-[var(--color-text-muted)]">{link.source_account_name}</td>
                    <td className="py-2.5 pr-3">
                      <span className="rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-primary)]">
                        {link.fantasy_account_name}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-medium text-[var(--color-danger)]">
                      -{formatCurrency(link.amount)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[var(--color-text-muted)]">
                      {formatDate(link.transaction_date)}
                    </td>
                    <td className="py-2.5 pl-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => removeFundingLink(link.id)}
                        className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
                        title="Remove tag"
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
      </>)}

      {/* ── Bet Log ─────────────────────────────────────────────────────────── */}
      {simTab === "bets" && !viewIsLeague && !viewIsAll && (
        <UnderdogBetLog accountId={effectiveId} />
      )}

      {/* ── Monte Carlo Simulator ────────────────────────────────────────────── */}
      {simTab === "simulator" && !viewIsLeague && !viewIsAll && (
        <MonteCarloSimulator bankroll={currentBalance} payout={3.5} />
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

          {txForm.type === "deposit" && sourceAccountOptions.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] p-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={txForm.from_source}
                  onChange={(e) => setTxForm((f) => ({
                    ...f,
                    from_source: e.target.checked,
                    source_account_id: e.target.checked ? (sourceAccountOptions[0]?.value ?? "") : "",
                  }))}
                  className="accent-[var(--color-primary)]"
                />
                Came from checking / savings
              </label>
              {txForm.from_source && (
                <Select
                  label="Source account"
                  options={sourceAccountOptions}
                  value={txForm.source_account_id}
                  onChange={(e) => setTxForm((f) => ({ ...f, source_account_id: e.target.value }))}
                />
              )}
            </div>
          )}

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

      {/* Log Bet Session */}
      <BetSessionDialog
        open={betSessionDialogOpen}
        onClose={() => setBetSessionDialogOpen(false)}
        accountId={effectiveId}
        onSave={addBetSession}
      />

      {/* Settle Bet Session */}
      <SettleBetSessionDialog
        open={settleBetSessionDialogOpen}
        onClose={() => { setSettleBetSessionDialogOpen(false); setSettlingBetSession(null); }}
        session={settlingBetSession}
        onSettle={settleBetSession}
      />

      {/* Add Contest */}
      <ContestDialog
        open={contestDialogOpen}
        onClose={() => setContestDialogOpen(false)}
        accounts={accounts}
        defaultAccountId={viewIsLeague ? (sbAccounts[0]?.id ?? "") : (effectiveId === "ALL" ? (sbAccounts[0]?.id ?? "") : effectiveId)}
        onSave={addContest}
      />

      {/* Settle Contest */}
      <ContestEditDialog
        contest={settleContestTarget}
        mode="settle"
        onClose={() => setSettleContestTarget(null)}
        onSave={editContest}
      />

      {/* Edit settled contest */}
      <ContestEditDialog
        contest={editContestTarget}
        mode="edit"
        onClose={() => setEditContestTarget(null)}
        onSave={editContest}
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

      {/* ── Reset account confirmation dialog ── */}
      {selectedAccount && (
        <Dialog open={resetDialogOpen} onClose={() => setResetDialogOpen(false)} title={`Reset ${selectedAccount.name}`}>
          <div className="flex flex-col gap-4 p-1">
            <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-sm">
              <p className="font-semibold text-[var(--color-danger)] mb-1">This cannot be undone.</p>
              <p className="text-[var(--color-text-muted)] text-xs leading-relaxed">
                All transactions, futures, seasons, contests, bet sessions, underdog bets, and funding links for <span className="font-semibold text-[var(--color-text)]">{selectedAccount.name}</span> will be permanently deleted. The account itself will remain.
              </p>
            </div>
            <div>
              <label className="block text-xs text-[var(--color-text-muted)] mb-1.5">
                Type <span className="font-mono font-semibold text-[var(--color-text)]">reset</span> to confirm
              </label>
              <input
                type="text"
                value={resetConfirmText}
                onChange={e => setResetConfirmText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && resetConfirmText === "reset") void handleResetAccount(selectedAccount.id); }}
                placeholder="reset"
                autoFocus
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm focus:border-[var(--color-danger)] focus:outline-none font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setResetDialogOpen(false)}
                className="rounded px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleResetAccount(selectedAccount.id)}
                disabled={resetConfirmText !== "reset" || resetting}
                className="rounded bg-[var(--color-danger)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {resetting ? "Resetting…" : `Reset ${selectedAccount.name}`}
              </button>
            </div>
          </div>
        </Dialog>
      )}
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

// ── Underdog Bet Log ──────────────────────────────────────────────────────────

const BET_TYPES = [
  "2 Man Non-Insured",
  "6-Man Insured",
  "3 Man Non Insured",
  "6-Man Non Insured",
  "3 Man Insured",
  "Other",
];

const LEG_DEFAULTS: Record<string, number> = {
  "2 Man Non-Insured": 2,
  "6-Man Insured": 6,
  "6-Man Non Insured": 6,
  "3 Man Non Insured": 3,
  "3 Man Insured": 3,
};

interface BetFormState {
  entry_date: string;
  entry_id: string;
  bet_type: string;
  entry_size: string;
  legs: string;
  oddsjam_hit: string;
  oddsjam_ev: string;
  ev_amount: string;
  legs_hit: string;
  legs_pushed: string;
  settled: string;
  tax: string;
  rescued: boolean;
  promo: string;
  notes: string;
}

const EMPTY_BET_FORM: BetFormState = {
  entry_date: new Date().toISOString().slice(0, 10),
  entry_id: "",
  bet_type: "2 Man Non-Insured",
  entry_size: "",
  legs: "2",
  oddsjam_hit: "",
  oddsjam_ev: "",
  ev_amount: "",
  legs_hit: "",
  legs_pushed: "",
  settled: "",
  tax: "",
  rescued: false,
  promo: "",
  notes: "",
};

function betFormToData(form: BetFormState, accountId: string): Omit<UnderdogBet, "id" | "created_at"> {
  const pct = (s: string) => s !== "" ? parseFloat(s) / 100 : null;
  const num = (s: string) => s !== "" ? parseFloat(s) : null;
  const int = (s: string) => s !== "" ? parseInt(s) : null;
  return {
    account_id: accountId,
    entry_date: form.entry_date,
    entry_id: form.entry_id || null,
    oddsjam_hit: pct(form.oddsjam_hit),
    oddsjam_ev: pct(form.oddsjam_ev),
    ev_amount: num(form.ev_amount),
    bet_type: form.bet_type,
    entry_size: parseFloat(form.entry_size) || 0,
    legs: parseInt(form.legs) || 6,
    legs_hit: int(form.legs_hit),
    legs_pushed: int(form.legs_pushed),
    settled: num(form.settled),
    tax: num(form.tax),
    rescued: form.rescued,
    promo: form.promo || null,
    notes: form.notes || null,
  };
}

function betToForm(b: UnderdogBet): BetFormState {
  const pct = (v: number | null) => v != null ? (v * 100).toFixed(2) : "";
  const num = (v: number | null) => v != null ? String(v) : "";
  return {
    entry_date: b.entry_date,
    entry_id: b.entry_id ?? "",
    bet_type: b.bet_type,
    entry_size: String(b.entry_size),
    legs: String(b.legs),
    oddsjam_hit: pct(b.oddsjam_hit),
    oddsjam_ev: pct(b.oddsjam_ev),
    ev_amount: num(b.ev_amount),
    legs_hit: b.legs_hit != null ? String(b.legs_hit) : "",
    legs_pushed: b.legs_pushed != null ? String(b.legs_pushed) : "",
    settled: b.settled != null ? String(b.settled) : "",
    tax: b.tax != null ? String(b.tax) : "",
    rescued: b.rescued,
    promo: b.promo ?? "",
    notes: b.notes ?? "",
  };
}


// ── Monte Carlo Simulator ──────────────────────────────────────────────────────

interface SimBetRow {
  id: string;
  numBets: string;
  evMin: string;
  evMax: string;
  manualAmount: string;
}

interface SimResult {
  betSummary: { numBets: number; ev: number; amount: number; kelly: number; halfKelly: number }[];
  totalExpectedProfit: number;
  totalStake: number;
  expectedFinal: number;
  mean: number;
  p10: number; p25: number; p50: number; p75: number; p90: number; p99: number;
  ciLo: number; ciHi: number;
  probLoss: number; cvar5: number; sharpe: number; sortino: number;
  riskBands: { label: string; pct: number }[];
  histData: { x: number; count: number }[];
  difference: number;
  pctDiff: number;
}

function kellyFrac(pay: number, ev: number, half: boolean): number {
  const p = 1 / (pay / (1 + ev));
  const q = 1 - p;
  const b = pay - 1;
  const k = (b * p - q) / b;
  return half ? k / 2 : k;
}

function simPercentile(sorted: Float64Array, p: number): number {
  const idx = Math.floor(p * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

const N_SIM_TRIALS = 10_000;

function MonteCarloSimulator({ bankroll: initBankroll, payout: initPayout }: { bankroll: number; payout: number }) {
  const [bankroll, setBankroll] = useState(initBankroll > 0 ? String(initBankroll) : "");
  const [payout, setPayout] = useState(String(initPayout));
  const [rows, setRows] = useState<SimBetRow[]>([
    { id: crypto.randomUUID(), numBets: "75", evMin: "6", evMax: "6", manualAmount: "" },
    { id: crypto.randomUUID(), numBets: "45", evMin: "17", evMax: "17", manualAmount: "" },
  ]);
  const [result, setResult] = useState<SimResult | null>(null);


  function addRow() {
    setRows((r) => [...r, { id: crypto.randomUUID(), numBets: "", evMin: "", evMax: "", manualAmount: "" }]);
  }
  function removeRow(id: string) {
    setRows((r) => r.filter((row) => row.id !== id));
  }
  function updateRow(id: string, field: keyof SimBetRow, value: string) {
    setRows((r) => r.map((row) => row.id === id ? { ...row, [field]: value } : row));
  }

  function runSim() {
    const br = parseFloat(bankroll);
    const pay = parseFloat(payout);
    if (!br || !pay || br <= 0 || pay <= 0) return;

    const betSummary: SimResult["betSummary"] = [];
    const betGroups: { n: number; ev: number; amt: number }[] = [];

    for (const row of rows) {
      const n = parseInt(row.numBets);
      const evMin = parseFloat(row.evMin) / 100;
      const evMax = parseFloat(row.evMax) / 100;
      if (!n || isNaN(evMin) || isNaN(evMax)) continue;
      const ev = (evMin + evMax) / 2;
      const kf = kellyFrac(pay, ev, true);
      const amt = row.manualAmount !== "" ? parseFloat(row.manualAmount) : Math.max(0, Math.round(kf * br * 100) / 100);
      betSummary.push({ numBets: n, ev, amount: amt, kelly: kellyFrac(pay, ev, false), halfKelly: kf });
      betGroups.push({ n, ev, amt });
    }

    const totalStake = betGroups.reduce((s, g) => s + g.n * g.amt, 0);
    const totalExpectedProfit = betGroups.reduce((s, g) => s + g.n * g.amt * g.ev, 0);
    const expectedFinal = br + totalExpectedProfit;

    // Monte Carlo
    const finals = new Float64Array(N_SIM_TRIALS);
    for (let t = 0; t < N_SIM_TRIALS; t++) {
      let bal = br;
      for (const g of betGroups) {
        const ev = g.ev;
        const p = 1 / (pay / (1 + ev));
        for (let i = 0; i < g.n; i++) {
          bal -= g.amt;
          if (Math.random() < p) bal += g.amt * pay;
        }
      }
      finals[t] = bal;
    }
    finals.sort();

    const mean = finals.reduce((s, v) => s + v, 0) / N_SIM_TRIALS;
    const variance = finals.reduce((s, v) => s + (v - mean) ** 2, 0) / N_SIM_TRIALS;
    const std = Math.sqrt(variance);
    const losses = finals.filter((v) => v < br);
    const tail5pct = finals.slice(0, Math.floor(0.05 * N_SIM_TRIALS));
    const cvar5 = tail5pct.length > 0 ? tail5pct.reduce((s, v) => s + v, 0) / tail5pct.length : br;
    const downReturns = Array.from(finals).filter((v) => v < br).map((v) => v - br);
    const downVar = downReturns.length > 0 ? downReturns.reduce((s, v) => s + v ** 2, 0) / downReturns.length : 0;
    const sortino = downVar > 0 ? (mean - br) / Math.sqrt(downVar) : 0;
    const sharpe = std > 0 ? (mean - br) / std : 0;

    const p10 = simPercentile(finals, 0.10);
    const p25 = simPercentile(finals, 0.25);
    const p50 = simPercentile(finals, 0.50);
    const p75 = simPercentile(finals, 0.75);
    const p90 = simPercentile(finals, 0.90);
    const p99 = simPercentile(finals, 0.99);
    const ciLo = simPercentile(finals, 0.025);
    const ciHi = simPercentile(finals, 0.975);
    const probLoss = losses.length / N_SIM_TRIALS;

    // histogram
    const minV = finals[0] ?? 0;
    const maxV = finals[N_SIM_TRIALS - 1] ?? 0;
    const nBins = 30;
    const binW = (maxV - minV) / nBins || 1;
    const bins = Array.from({ length: nBins }, (_, i) => ({ x: minV + i * binW + binW / 2, count: 0 }));
    for (const v of finals) {
      const idx = Math.min(Math.floor((v - minV) / binW), nBins - 1);
      bins[idx]!.count++;
    }

    const riskBands = [
      { label: "Prob Loss", pct: probLoss * 100 },
      { label: "CVaR 5%", pct: ((br - cvar5) / br) * 100 },
    ];

    setResult({
      betSummary, totalExpectedProfit, totalStake, expectedFinal,
      mean, p10, p25, p50, p75, p90, p99,
      ciLo, ciHi, probLoss, cvar5, sharpe, sortino,
      riskBands, histData: bins,
      difference: mean - br,
      pctDiff: br > 0 ? (mean - br) / br * 100 : 0,
    });
  }

  const fmt = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  async function exportPdf() {
    if (!result) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const margin = 14;
    const col = (W - margin * 2) / 2;
    let y = margin;

    // ── Header ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Monte Carlo Simulation Report", margin, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Generated ${new Date().toLocaleString()} · ${N_SIM_TRIALS.toLocaleString()} trials`, margin, y);
    doc.text(`Bankroll: ${fmt(parseFloat(bankroll))} · Payout: ${payout}×`, W - margin, y, { align: "right" });
    y += 6;
    doc.setDrawColor(220);
    doc.line(margin, y, W - margin, y);
    y += 5;

    // ── Kelly Sizing table ──
    doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Kelly Sizing", margin, y);
    y += 5;

    const kellyHeaders = ["# Bets", "EV", "Full Kelly", "Half Kelly", "Bet Amt", "Total Stake"];
    const colWidths = [18, 18, 24, 24, 24, 28];
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(245, 245, 248);
    doc.rect(margin, y - 3.5, W - margin * 2, 5, "F");
    let cx = margin;
    kellyHeaders.forEach((h, i) => { doc.text(h, cx, y); cx += colWidths[i]!; });
    y += 3;
    doc.setFont("helvetica", "normal");
    for (const row of result.betSummary) {
      const cells = [
        String(row.numBets),
        fmtPct(row.ev * 100),
        fmtPct(row.kelly * 100),
        fmtPct(row.halfKelly * 100),
        fmt(row.amount),
        fmt(row.numBets * row.amount),
      ];
      cx = margin;
      cells.forEach((c, i) => { doc.text(c, cx, y); cx += colWidths[i]!; });
      y += 4.5;
    }
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.text(`Total Stake: ${fmt(result.totalStake)}`, margin, y);
    doc.text(`Expected Profit: ${fmt(result.totalExpectedProfit)}`, margin + 60, y);
    doc.text(`Expected Final: ${fmt(result.expectedFinal)}`, margin + 120, y);
    y += 7;

    doc.setDrawColor(220);
    doc.line(margin, y, W - margin, y);
    y += 5;

    // ── Monte Carlo stats grid ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Monte Carlo Distribution", margin, y);
    y += 5;

    const stats = [
      ["Mean",         fmt(result.mean)],
      ["P10",          fmt(result.p10)],
      ["P50 (Median)", fmt(result.p50)],
      ["P90",          fmt(result.p90)],
      ["95% CI Low",   fmt(result.ciLo)],
      ["95% CI High",  fmt(result.ciHi)],
      ["Prob Loss",    fmtPct(result.probLoss * 100)],
      ["CVaR 5%",      fmt(result.cvar5)],
      ["Sharpe",       result.sharpe.toFixed(3)],
      ["Sortino",      result.sortino.toFixed(3)],
      ["E[ΔBR]",       fmt(result.difference)],
      ["E[ΔBR %]",     fmtPct(result.pctDiff)],
    ];

    doc.setFontSize(8);
    stats.forEach(([label, value], i) => {
      const isRight = i % 2 === 1;
      const x = margin + (isRight ? col + 4 : 0);
      if (!isRight) {
        doc.setFillColor(i % 4 < 2 ? 250 : 245, i % 4 < 2 ? 250 : 245, i % 4 < 2 ? 253 : 248);
        doc.rect(margin, y - 3.5, W - margin * 2, 5, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100);
      doc.text(label!, x, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      doc.text(value!, x + col / 2, y);
      if (isRight) y += 5;
    });
    y += 7;

    // ── ASCII histogram ──
    doc.setDrawColor(220);
    doc.line(margin, y, W - margin, y);
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text("Distribution of Final Bankroll", margin, y);
    y += 4;

    const maxCount = Math.max(...result.histData.map(b => b.count));
    const barAreaW = W - margin * 2;
    const barAreaH = 28;
    const barW = barAreaW / result.histData.length;
    const br2 = parseFloat(bankroll);

    result.histData.forEach((bin, i) => {
      const barH = maxCount > 0 ? (bin.count / maxCount) * barAreaH : 0;
      const bx = margin + i * barW;
      const by = y + barAreaH - barH;
      doc.setFillColor(bin.x < br2 ? 239 : 99, bin.x < br2 ? 68 : 102, bin.x < br2 ? 68 : 241);
      doc.setDrawColor(255, 255, 255);
      doc.rect(bx, by, barW - 0.3, barH, "F");
    });
    y += barAreaH + 3;

    // x-axis labels (5 evenly spaced)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(120);
    const labelIdxs = [0, 7, 14, 21, 29];
    for (const li of labelIdxs) {
      const bin = result.histData[li];
      if (!bin) continue;
      const lx = margin + li * barW;
      doc.text(fmt(bin.x), lx, y, { maxWidth: barW * 6 });
    }
    y += 5;

    // ── Footer ──
    doc.setFontSize(7);
    doc.setTextColor(160);
    doc.text("Milly Maker · Monte Carlo Simulator · For informational use only", W / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" });

    doc.save(`mc-sim-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  return (
    <div className="space-y-6">
      {/* Inputs */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5">
        <h3 className="mb-4 text-sm font-semibold text-[var(--color-text-primary)]">Parameters</h3>
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-subtle)]">Bankroll</label>
            <input
              type="number" step="1" value={bankroll}
              onChange={(e) => setBankroll(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none"
              placeholder="e.g. 500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-subtle)]">Payout Multiplier</label>
            <input
              type="number" step="0.1" value={payout}
              onChange={(e) => setPayout(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none"
              placeholder="e.g. 3.5"
            />
          </div>
        </div>

        {/* Bet groups table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-subtle)]">
                <th className="pb-2 pr-3 font-medium"># Bets</th>
                <th className="pb-2 pr-3 font-medium">EV Min %</th>
                <th className="pb-2 pr-3 font-medium">EV Max %</th>
                <th className="pb-2 pr-3 font-medium">Manual Amt</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((row) => (
                <tr key={row.id}>
                  {(["numBets", "evMin", "evMax", "manualAmount"] as const).map((field) => (
                    <td key={field} className="py-1.5 pr-3">
                      <input
                        type="number" step="1" value={row[field]}
                        onChange={(e) => updateRow(row.id, field, e.target.value)}
                        className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 focus:border-[var(--color-primary)] focus:outline-none"
                        placeholder={field === "manualAmount" ? "auto" : ""}
                      />
                    </td>
                  ))}
                  <td className="py-1.5">
                    <button onClick={() => removeRow(row.id)} className="text-[var(--color-text-subtle)] hover:text-red-500">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex gap-3">
          <button
            onClick={addRow}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-subtle)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >+ Add Bet Group</button>
          <button
            onClick={runSim}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >Run Simulation</button>
          {result && (
            <button
              onClick={() => void exportPdf()}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-subtle)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            >
              <FileDown size={12} />
              Export PDF
            </button>
          )}
        </div>
      </div>

      {result && (
        <>
          {/* Kelly summary */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5">
            <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Kelly Sizing</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-subtle)]">
                    <th className="pb-2 pr-4 font-medium"># Bets</th>
                    <th className="pb-2 pr-4 font-medium">EV</th>
                    <th className="pb-2 pr-4 font-medium">Full Kelly</th>
                    <th className="pb-2 pr-4 font-medium">Half Kelly</th>
                    <th className="pb-2 pr-4 font-medium">Bet Amount</th>
                    <th className="pb-2 font-medium">Total Stake</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {result.betSummary.map((row, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-4 font-mono">{row.numBets}</td>
                      <td className="py-1.5 pr-4 font-mono">{fmtPct(row.ev * 100)}</td>
                      <td className="py-1.5 pr-4 font-mono">{fmtPct(row.kelly * 100)}</td>
                      <td className="py-1.5 pr-4 font-mono">{fmtPct(row.halfKelly * 100)}</td>
                      <td className="py-1.5 pr-4 font-mono">{fmt(row.amount)}</td>
                      <td className="py-1.5 font-mono">{fmt(row.numBets * row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4 sm:grid-cols-4">
              <div>
                <div className="text-xs text-[var(--color-text-subtle)]">Total Stake</div>
                <div className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">{fmt(result.totalStake)}</div>
                <div className="text-xs text-[var(--color-text-subtle)]">→ Target Spend</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-subtle)]">Expected Profit</div>
                <div className={cn("font-mono text-sm font-semibold", result.totalExpectedProfit >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]")}>
                  {fmt(result.totalExpectedProfit)}
                </div>
                <div className="text-xs text-[var(--color-text-subtle)]">→ Target P/L</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-subtle)]">Expected Final</div>
                <div className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">{fmt(result.expectedFinal)}</div>
              </div>
            </div>
          </div>

          {/* MC distribution */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5">
            <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Monte Carlo Distribution ({N_SIM_TRIALS.toLocaleString()} trials)</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Mean", value: fmt(result.mean) },
                { label: "P10", value: fmt(result.p10) },
                { label: "P50 (Median)", value: fmt(result.p50) },
                { label: "P90", value: fmt(result.p90) },
                { label: "95% CI Low", value: fmt(result.ciLo) },
                { label: "95% CI High", value: fmt(result.ciHi) },
                { label: "Prob Loss", value: fmtPct(result.probLoss * 100) },
                { label: "CVaR 5%", value: fmt(result.cvar5) },
                { label: "Sharpe", value: result.sharpe.toFixed(3) },
                { label: "Sortino", value: result.sortino.toFixed(3) },
                { label: "E[ΔBR]", value: fmt(result.difference) },
                { label: "E[ΔBR %]", value: fmtPct(result.pctDiff) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-[var(--color-surface)] p-3">
                  <div className="text-xs text-[var(--color-text-subtle)]">{label}</div>
                  <div className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">{value}</div>
                </div>
              ))}
            </div>

            {/* Simple bar histogram */}
            <div className="mt-4">
              <div className="mb-1 text-xs text-[var(--color-text-subtle)]">Distribution of Final Bankroll</div>
              <div className="flex h-24 items-end gap-px overflow-hidden rounded">
                {result.histData.map((bin, i) => {
                  const maxCount = Math.max(...result.histData.map((b) => b.count));
                  const heightPct = maxCount > 0 ? (bin.count / maxCount) * 100 : 0;
                  const isLoss = bin.x < parseFloat(bankroll);
                  return (
                    <div
                      key={i}
                      title={`${fmt(bin.x)}: ${bin.count}`}
                      style={{ height: `${heightPct}%`, flex: 1 }}
                      className={cn("min-h-px", isLoss ? "bg-red-500/60" : "bg-[var(--color-primary)]/60")}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Underdog Bet Log ──────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-");
  return `${MONTH_NAMES[parseInt(m ?? "1") - 1]} ${y}`;
}

/** Returns sorted unique YYYY-MM strings covering all bets + targets + current month */
function buildMonthRange(bets: UnderdogBet[], targets: UnderdogMonthlyTarget[]): string[] {
  const set = new Set<string>();
  const now = new Date().toISOString().slice(0, 7);
  set.add(now);
  for (const b of bets) set.add(b.entry_date.slice(0, 7));
  for (const t of targets) set.add(t.month);
  return [...set].sort();
}

interface MonthRow {
  month: string;
  betTotal: number;
  betsMade: number;
  legs: number;
  legsHit: number;
  legsPushed: number;
  legsHitPct: number | null;
  legsHitPushPct: number | null;
  itmPct: number | null;
  totalEv: number | null;
  totalSettled: number;
  settledBets: number;
  actualPL: number;
  plPct: number | null;
  roiPerBet: number | null;
  // manual / from targets
  targetSpend: number | null;
  targetPL: number | null;
  startingBR: number | null;
  bonuses: number | null;
  // derived
  endingBR: number | null;
  expectedBR: number | null;
  actualGrowthPct: number | null;
}

function buildMonthRows(
  bets: UnderdogBet[],
  targets: UnderdogMonthlyTarget[],
  months: string[]
): MonthRow[] {
  const targetMap = new Map(targets.map((t) => [t.month, t]));

  return months.map((month) => {
    const mb = bets.filter((b) => b.entry_date.startsWith(month));
    const settled = mb.filter((b) => b.settled !== null);

    const betTotal = mb.reduce((s, b) => s + b.entry_size, 0);
    const betsMade = mb.length;
    const legs = mb.reduce((s, b) => s + b.legs, 0);
    const legsHit = mb.reduce((s, b) => s + (b.legs_hit ?? 0), 0);
    const legsPushed = mb.reduce((s, b) => s + (b.legs_pushed ?? 0), 0);
    const legsHitPct = legs > 0 ? legsHit / legs : null;
    const legsHitPushPct = legs > 0 ? (legsHit + legsPushed) / legs : null;

    const wins = settled.filter((b) => (b.settled ?? 0) > b.entry_size).length;
    const itmPct = settled.length > 0 ? wins / settled.length : null;

    const evBets = mb.filter((b) => b.ev_amount != null);
    const totalEv = evBets.length > 0 ? evBets.reduce((s, b) => s + (b.ev_amount ?? 0), 0) : null;
    const totalSettled = settled.reduce((s, b) => s + (b.settled ?? 0), 0);
    const settledEntries = settled.reduce((s, b) => s + b.entry_size, 0);
    const actualPL = totalSettled - settledEntries;
    const plPct = settledEntries > 0 ? actualPL / settledEntries : null;
    const roiPerBet = settled.length > 0 ? actualPL / settled.length : null;

    const t = targetMap.get(month);
    const targetSpend = t?.target_spend ?? null;
    const targetPL = t?.target_pl ?? null;
    const startingBR = t?.starting_br ?? null;
    const bonuses = t?.bonuses ?? null;

    const endingBR = startingBR != null ? startingBR + actualPL : null;
    const expectedBR = startingBR != null && targetPL != null ? startingBR + targetPL : null;
    const actualGrowthPct = endingBR != null && endingBR !== 0 ? actualPL / endingBR : null;

    return {
      month, betTotal, betsMade, legs, legsHit, legsPushed,
      legsHitPct, legsHitPushPct, itmPct,
      totalEv, totalSettled, settledBets: settled.length, actualPL, plPct, roiPerBet,
      targetSpend, targetPL, startingBR, bonuses,
      endingBR, expectedBR, actualGrowthPct,
    };
  });
}

function EditableCell({
  value,
  onSave,
  prefix = "",
  suffix = "",
  placeholder = "—",
}: {
  value: number | null;
  onSave: (v: number | null) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function startEdit() {
    setDraft(value != null ? String(value) : "");
    setEditing(true);
  }

  function commit() {
    const parsed = draft.trim() !== "" ? parseFloat(draft) : null;
    onSave(isNaN(parsed!) ? null : parsed);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        step="0.01"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        className="w-24 rounded border border-[var(--color-primary)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-right text-xs font-mono focus:outline-none"
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      title="Click to edit"
      className="group flex w-full items-center justify-end gap-1 text-right"
    >
      <span className={cn("font-mono text-xs", value == null ? "text-[var(--color-text-subtle)]" : "")}>
        {value != null ? `${prefix}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}` : placeholder}
      </span>
      <span className="opacity-0 group-hover:opacity-50 text-[9px] text-[var(--color-text-subtle)]">✎</span>
    </button>
  );
}

function UnderdogBetLog({ accountId }: { accountId: string }) {
  const { bets, addBet, editBet, removeBet } = useUnderdogBets(accountId);
  const { targets, saveTarget } = useUnderdogTargets(accountId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBet, setEditingBet] = useState<UnderdogBet | null>(null);
  const [form, setForm] = useState<BetFormState>(EMPTY_BET_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ── Monthly summary ────────────────────────────────────────────────────────
  const months = React.useMemo(() => buildMonthRange(bets, targets), [bets, targets]);
  const monthRows = React.useMemo(() => buildMonthRows(bets, targets, months), [bets, targets, months]);

  // ── Bet dialog helpers ─────────────────────────────────────────────────────
  function openAdd() {
    setEditingBet(null);
    setForm({ ...EMPTY_BET_FORM, entry_date: new Date().toISOString().slice(0, 10) });
    setDialogOpen(true);
  }

  function openEdit(b: UnderdogBet) {
    setEditingBet(b);
    setForm(betToForm(b));
    setDialogOpen(true);
  }

  function updateForm(field: keyof BetFormState, value: string | boolean) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "bet_type" && typeof value === "string") {
        const defaultLegs = LEG_DEFAULTS[value];
        if (defaultLegs && prev.legs === String(LEG_DEFAULTS[prev.bet_type] ?? "")) {
          next.legs = String(defaultLegs);
        }
      }
      // Auto-calculate ev_amount from EV% × entry_size
      if (field === "oddsjam_ev" || field === "entry_size") {
        const ev = parseFloat(field === "oddsjam_ev" ? (value as string) : prev.oddsjam_ev);
        const entry = parseFloat(field === "entry_size" ? (value as string) : prev.entry_size);
        if (!isNaN(ev) && !isNaN(entry) && entry > 0) {
          next.ev_amount = ((ev / 100) * entry).toFixed(2);
        }
      }
      return next;
    });
  }

  async function handleSave() {
    if (!form.entry_size || !form.entry_date) return;
    setSaving(true);
    try {
      const data = betFormToData(form, accountId);
      if (editingBet) {
        const { account_id: _a, ...rest } = data;
        await editBet(editingBet.id, rest);
      } else {
        await addBet(data);
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  // ── Totals row (all months) ────────────────────────────────────────────────
  const totals = React.useMemo(() => {
    const settled = bets.filter((b) => b.settled !== null);
    const totalLegs = bets.reduce((s, b) => s + b.legs, 0);
    const totalHit = bets.reduce((s, b) => s + (b.legs_hit ?? 0), 0);
    const totalPushed = bets.reduce((s, b) => s + (b.legs_pushed ?? 0), 0);
    const totalSettled = settled.reduce((s, b) => s + (b.settled ?? 0), 0);
    const settledEntries = settled.reduce((s, b) => s + b.entry_size, 0);
    const actualPL = totalSettled - settledEntries;
    return {
      betTotal: bets.reduce((s, b) => s + b.entry_size, 0),
      betsMade: bets.length,
      legs: totalLegs,
      legsHit: totalHit,
      legsPushed: totalPushed,
      legsHitPct: totalLegs > 0 ? totalHit / totalLegs : null,
      legsHitPushPct: totalLegs > 0 ? (totalHit + totalPushed) / totalLegs : null,
      itmPct: settled.length > 0 ? settled.filter(b => (b.settled ?? 0) > b.entry_size).length / settled.length : null,
      totalEv: bets.filter(b => b.ev_amount != null).reduce((s, b) => s + (b.ev_amount ?? 0), 0),
      totalSettled,
      actualPL,
      plPct: settledEntries > 0 ? actualPL / settledEntries : null,
      roiPerBet: settled.length > 0 ? actualPL / settled.length : null,
    };
  }, [bets]);

  const riskStats = React.useMemo(() => {
    if (bets.length === 0) return null;
    const sorted = [...bets].sort((a, b) => a.entry_date.localeCompare(b.entry_date));

    // Running P&L → drawdown
    let running = 0, peak = 0, maxDrawdown = 0;
    for (const b of sorted) {
      running += (b.settled ?? 0) - b.entry_size;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    const currentDrawdown = peak - running;

    // Max profit day (settled bets grouped by entry_date)
    const byDay = new Map<string, number>();
    for (const b of sorted) {
      if (b.settled !== null) {
        byDay.set(b.entry_date, (byDay.get(b.entry_date) ?? 0) + (b.settled - b.entry_size));
      }
    }
    let maxProfitDay: { date: string; amount: number } | null = null;
    for (const [date, amount] of byDay) {
      if (maxProfitDay === null || amount > maxProfitDay.amount) maxProfitDay = { date, amount };
    }

    // Longest consecutive losing streak (settled bets)
    let streak = 0, maxStreak = 0;
    for (const b of sorted) {
      if (b.settled !== null) {
        if (b.settled - b.entry_size < 0) { streak++; maxStreak = Math.max(maxStreak, streak); }
        else streak = 0;
      }
    }

    return { maxDrawdown, currentDrawdown, maxProfitDay, maxLossStreak: maxStreak };
  }, [bets]);

  const pct = (v: number | null) => v != null ? `${(v * 100).toFixed(2)}%` : "—";
  const cur = (v: number | null) => v != null ? formatCurrency(v) : "—";

  return (
    <div className="flex flex-col gap-5">

      {/* ── Monthly Summary Table ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Monthly Summary</CardTitle>
          <p className="text-[10px] text-[var(--color-text-subtle)]">
            Click <span className="font-medium text-[var(--color-primary)]">Target Spend</span>, <span className="font-medium text-[var(--color-primary)]">Target P/L</span>, <span className="font-medium text-[var(--color-primary)]">Starting BR</span>, and <span className="font-medium text-[var(--color-primary)]">Bonuses</span> cells to edit · Target values come from Simulator tab
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="pb-2 pr-4 text-left sticky left-0 bg-[var(--color-surface)]">Month</th>
                  <th className="pb-2 pr-3 text-right">Bet Total</th>
                  <th className="pb-2 pr-3 text-right">Bets</th>
                  <th className="pb-2 pr-3 text-right">Legs</th>
                  <th className="pb-2 pr-3 text-right">Hit</th>
                  <th className="pb-2 pr-3 text-right">Push</th>
                  <th className="pb-2 pr-3 text-right">Hit%</th>
                  <th className="pb-2 pr-3 text-right">Hit+Push%</th>
                  <th className="pb-2 pr-3 text-right">Win Rate</th>
                  <th className="pb-2 pr-3 text-right">Actual Total EV</th>
                  <th className="pb-2 pr-3 text-right">Settled</th>
                  <th className="pb-2 pr-3 text-right text-[var(--color-primary)]">Target Spend ✎</th>
                  <th className="pb-2 pr-3 text-right text-[var(--color-primary)]">Target P/L ✎</th>
                  <th className="pb-2 pr-3 text-right">Actual P/L</th>
                  <th className="pb-2 pr-3 text-right">P/L%</th>
                  <th className="pb-2 pr-3 text-right">ROI/Bet</th>
                  <th className="pb-2 pr-3 text-right text-[var(--color-primary)]">Starting BR ✎</th>
                  <th className="pb-2 pr-3 text-right">Ending BR</th>
                  <th className="pb-2 pr-3 text-right">Expected BR</th>
                  <th className="pb-2 pr-3 text-right">Net Growth%</th>
                  <th className="pb-2 text-right text-[var(--color-primary)]">Bonuses ✎</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {[...monthRows].reverse().map((row) => {
                  const isCurrentMonth = row.month === new Date().toISOString().slice(0, 7);
                  const hasActivity = row.betsMade > 0 || row.startingBR != null || row.targetSpend != null;
                  if (!hasActivity && !isCurrentMonth) return null;
                  return (
                    <tr key={row.month} className={cn("group", isCurrentMonth && "bg-[var(--color-primary)]/5")}>
                      <td className="py-2 pr-4 font-semibold sticky left-0 bg-[var(--color-surface)] group-[.bg-primary\\/5]:bg-[var(--color-primary)]/5">
                        {monthLabel(row.month)}
                        {isCurrentMonth && <span className="ml-1.5 text-[9px] text-[var(--color-primary)]">now</span>}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">{row.betsMade > 0 ? cur(row.betTotal) : "—"}</td>
                      <td className="py-2 pr-3 text-right">{row.betsMade || "—"}</td>
                      <td className="py-2 pr-3 text-right">{row.legs || "—"}</td>
                      <td className="py-2 pr-3 text-right">{row.legsHit || "—"}</td>
                      <td className="py-2 pr-3 text-right">{row.legsPushed || "—"}</td>
                      <td className="py-2 pr-3 text-right">{pct(row.legsHitPct)}</td>
                      <td className="py-2 pr-3 text-right">{pct(row.legsHitPushPct)}</td>
                      <td className="py-2 pr-3 text-right">{pct(row.itmPct)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{row.totalEv != null ? formatCurrency(row.totalEv) : "—"}</td>
                      <td className="py-2 pr-3 text-right font-mono">{row.settledBets > 0 ? cur(row.totalSettled) : "—"}</td>
                      {/* Editable: target spend */}
                      <td className="py-2 pr-3">
                        <EditableCell value={row.targetSpend} prefix="$"
                          onSave={(v) => saveTarget(row.month, "target_spend", v)} />
                      </td>
                      {/* Editable: target P/L */}
                      <td className="py-2 pr-3">
                        <EditableCell value={row.targetPL} prefix="$"
                          onSave={(v) => saveTarget(row.month, "target_pl", v)} />
                      </td>
                      <td className={cn("py-2 pr-3 text-right font-mono font-semibold",
                        row.settledBets > 0 ? (row.actualPL >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]") : "text-[var(--color-text-subtle)]"
                      )}>
                        {row.settledBets > 0 ? `${row.actualPL >= 0 ? "+" : ""}${formatCurrency(row.actualPL)}` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">{pct(row.plPct)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{row.roiPerBet != null ? formatCurrency(row.roiPerBet) : "—"}</td>
                      {/* Editable: starting bankroll */}
                      <td className="py-2 pr-3">
                        <EditableCell value={row.startingBR} prefix="$"
                          onSave={(v) => saveTarget(row.month, "starting_br", v)} />
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">{cur(row.endingBR)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{cur(row.expectedBR)}</td>
                      <td className={cn("py-2 pr-3 text-right",
                        row.actualGrowthPct != null ? (row.actualGrowthPct >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]") : ""
                      )}>
                        {pct(row.actualGrowthPct)}
                      </td>
                      {/* Editable: bonuses */}
                      <td className="py-2">
                        <EditableCell value={row.bonuses} prefix="$"
                          onSave={(v) => saveTarget(row.month, "bonuses", v)} />
                      </td>
                    </tr>
                  );
                })}

                {/* Totals row */}
                {bets.length > 0 && (
                  <tr className="border-t-2 border-[var(--color-border)] font-semibold">
                    <td className="py-2 pr-4 sticky left-0 bg-[var(--color-surface)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Total</td>
                    <td className="py-2 pr-3 text-right font-mono">{formatCurrency(totals.betTotal)}</td>
                    <td className="py-2 pr-3 text-right">{totals.betsMade}</td>
                    <td className="py-2 pr-3 text-right">{totals.legs}</td>
                    <td className="py-2 pr-3 text-right">{totals.legsHit}</td>
                    <td className="py-2 pr-3 text-right">{totals.legsPushed}</td>
                    <td className="py-2 pr-3 text-right">{pct(totals.legsHitPct)}</td>
                    <td className="py-2 pr-3 text-right">{pct(totals.legsHitPushPct)}</td>
                    <td className="py-2 pr-3 text-right">{pct(totals.itmPct)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{formatCurrency(totals.totalEv)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{formatCurrency(totals.totalSettled)}</td>
                    <td className="py-2 pr-3" />
                    <td className="py-2 pr-3" />
                    <td className={cn("py-2 pr-3 text-right font-mono", totals.actualPL >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]")}>
                      {totals.actualPL >= 0 ? "+" : ""}{formatCurrency(totals.actualPL)}
                    </td>
                    <td className="py-2 pr-3 text-right">{pct(totals.plPct)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{totals.roiPerBet != null ? formatCurrency(totals.roiPerBet) : "—"}</td>
                    <td colSpan={5} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Risk Stats ────────────────────────────────────────────────────────── */}
      {riskStats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: "Max Drawdown",
              value: formatCurrency(riskStats.maxDrawdown),
              sub: "peak → trough",
              danger: riskStats.maxDrawdown > 0,
            },
            {
              label: "Current Drawdown",
              value: formatCurrency(riskStats.currentDrawdown),
              sub: riskStats.currentDrawdown === 0 ? "at peak" : "from peak",
              danger: riskStats.currentDrawdown > 0,
            },
            {
              label: "Best Day",
              value: riskStats.maxProfitDay ? formatCurrency(riskStats.maxProfitDay.amount) : "—",
              sub: riskStats.maxProfitDay ? formatDate(riskStats.maxProfitDay.date) : "no settled bets",
              success: riskStats.maxProfitDay != null && riskStats.maxProfitDay.amount > 0,
            },
            {
              label: "Longest Loss Streak",
              value: riskStats.maxLossStreak > 0 ? `${riskStats.maxLossStreak} bets` : "—",
              sub: "consecutive losses",
              danger: riskStats.maxLossStreak >= 3,
            },
          ].map(({ label, value, sub, danger, success }) => (
            <div key={label} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-subtle)]">{label}</div>
              <div className={cn("mt-1 font-mono text-lg font-semibold",
                danger ? "text-[var(--color-danger)]" : success ? "text-[var(--color-success)]" : "text-[var(--color-text-primary)]"
              )}>{value}</div>
              <div className="text-[10px] text-[var(--color-text-subtle)]">{sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Bet Log ───────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Bet Log
              {bets.filter(b => b.settled === null).length > 0 && (
                <span className="ml-2 text-[10px] font-normal text-[var(--color-text-muted)]">
                  {bets.filter(b => b.settled === null).length} pending
                </span>
              )}
            </CardTitle>
            <Button size="sm" onClick={openAdd}>
              <Plus size={14} /> Log Entry
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {bets.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-text-subtle)]">No bets logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)]">
                    <th className="pb-2 text-left font-medium">Date</th>
                    <th className="pb-2 text-left font-medium">Type</th>
                    <th className="pb-2 text-right font-medium">Entry</th>
                    <th className="pb-2 text-center font-medium">Legs</th>
                    <th className="pb-2 text-center font-medium">Hit / Push</th>
                    <th className="pb-2 text-right font-medium">EV</th>
                    <th className="pb-2 text-right font-medium">Settled</th>
                    <th className="pb-2 text-right font-medium">Tax</th>
                    <th className="pb-2 text-left font-medium">Entry ID</th>
                    <th className="pb-2 pl-4 text-left font-medium border-l border-[var(--color-border)]">Promo</th>
                    <th className="pb-2 text-left font-medium">Notes</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {bets.map((b) => {
                    const isPending = b.settled === null;
                    return (
                      <tr key={b.id} className="group">
                        <td className="py-2 pr-3 text-[var(--color-text-muted)] tabular-nums text-xs">
                          {formatDate(b.entry_date)}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-primary)] whitespace-nowrap">
                            {b.bet_type}
                          </span>
                          {b.rescued && <span className="ml-1 text-[10px] text-[#f79009]" title="Rescued">↩</span>}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-xs">{formatCurrency(b.entry_size)}</td>
                        <td className="py-2 pr-3 text-center text-[var(--color-text-muted)] text-xs">{b.legs}</td>
                        <td className="py-2 pr-3 text-center text-xs">
                          {isPending ? (
                            <span className="text-[var(--color-text-subtle)]">—</span>
                          ) : (
                            <span>
                              <span className={b.legs_hit === b.legs ? "text-[var(--color-success)] font-semibold" : ""}>{b.legs_hit ?? "?"}</span>
                              {(b.legs_pushed ?? 0) > 0 && <span className="text-[var(--color-text-subtle)]">/{b.legs_pushed}p</span>}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right text-[var(--color-text-muted)] text-xs">
                          {b.oddsjam_ev != null ? `${(b.oddsjam_ev * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-xs">
                          {isPending ? (
                            <Badge variant="outline" className="text-[10px]">Pending</Badge>
                          ) : formatCurrency(b.settled ?? 0)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-xs text-[var(--color-danger)]">
                          {b.tax != null ? formatCurrency(b.tax) : <span className="text-[var(--color-text-subtle)]">—</span>}
                        </td>
                        <td className="py-2 pr-3 text-xs text-[var(--color-text-subtle)] font-mono">
                          {b.entry_id ?? "—"}
                        </td>
                        <td className="py-2 pl-4 pr-3 text-xs text-[var(--color-text-subtle)] whitespace-nowrap border-l border-[var(--color-border)]">
                          {b.promo ?? "—"}
                        </td>
                        <td className="py-2 pr-3 text-xs text-[var(--color-text-subtle)] max-w-[200px] truncate">
                          {b.notes ?? "—"}
                        </td>
                        <td className="py-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button onClick={() => openEdit(b)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-text)]">
                            <Settings2 size={13} />
                          </button>
                          <button onClick={() => setConfirmDelete(b.id)} className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editingBet ? "Edit Entry" : "Log Bet Entry"}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.entry_date}
              onChange={(e) => updateForm("entry_date", e.target.value)} />
            <Select label="Bet Type" value={form.bet_type}
              options={BET_TYPES.map((t) => ({ value: t, label: t }))}
              onChange={(e) => updateForm("bet_type", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Entry ($)" type="number" step="0.01" placeholder="12" value={form.entry_size}
              onChange={(e) => updateForm("entry_size", e.target.value)} />
            <Input label="Legs" type="number" min="1" value={form.legs}
              onChange={(e) => updateForm("legs", e.target.value)} />
          </div>

          <div className="border-t border-[var(--color-border-subtle)] pt-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-subtle)]">OddsJam (optional)</p>
            <div className="grid grid-cols-3 gap-3">
              <Input label="% Chance" type="number" step="0.01" placeholder="2.45" value={form.oddsjam_hit}
                onChange={(e) => updateForm("oddsjam_hit", e.target.value)} />
              <Input label="+EV %" type="number" step="0.01" placeholder="8.50" value={form.oddsjam_ev}
                onChange={(e) => updateForm("oddsjam_ev", e.target.value)} />
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">EV Amount ($)</label>
                <div className="flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 font-mono text-sm text-[var(--color-text-muted)]">
                  {form.ev_amount !== "" ? `$${form.ev_amount}` : <span className="text-[var(--color-text-subtle)] italic text-xs">auto</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--color-border-subtle)] pt-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-subtle)]">Result (fill when settled)</p>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Legs Hit" type="number" min="0" placeholder="—" value={form.legs_hit}
                onChange={(e) => updateForm("legs_hit", e.target.value)} />
              <Input label="Legs Pushed" type="number" min="0" placeholder="0" value={form.legs_pushed}
                onChange={(e) => updateForm("legs_pushed", e.target.value)} />
              <Input label="Settled ($)" type="number" step="0.01" placeholder="pending" value={form.settled}
                onChange={(e) => updateForm("settled", e.target.value)} />
            </div>
            <div className="mt-2">
              <Input label="Tax withheld ($, optional)" type="number" step="0.01" min="0" placeholder="0.00" value={form.tax}
                onChange={(e) => updateForm("tax", e.target.value)} />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input type="checkbox" id="rescued-chk" checked={form.rescued}
                onChange={(e) => updateForm("rescued", e.target.checked)}
                className="accent-[var(--color-primary)]" />
              <label htmlFor="rescued-chk" className="text-sm cursor-pointer select-none">Rescued / Rebooted</label>
            </div>
          </div>

          <div className="border-t border-[var(--color-border-subtle)] pt-3 grid grid-cols-2 gap-3">
            <Input label="Promo" placeholder="50% BOOst" value={form.promo}
              onChange={(e) => updateForm("promo", e.target.value)} />
            <Input label="Entry ID (optional)" placeholder="UUID from Underdog" value={form.entry_id}
              onChange={(e) => updateForm("entry_id", e.target.value)} />
          </div>
          <Input label="Notes" placeholder="Any context" value={form.notes}
            onChange={(e) => updateForm("notes", e.target.value)} />

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !form.entry_size || !form.entry_date}>
              {saving ? "Saving…" : editingBet ? "Save Changes" : "Log Entry"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete Entry?">
        <p className="text-sm text-[var(--color-text-muted)]">This entry will be permanently removed.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button size="sm" onClick={async () => { if (confirmDelete) { await removeBet(confirmDelete); setConfirmDelete(null); } }}>
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
