import React, { useEffect, useState, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, formatCurrency } from "@milly-maker/ui";
import { useDb } from "@/db/hooks/useDb.js";
import { getMonthlyCreditTotals, getMonthlyDebitTotals } from "@/db/queries/checking.js";
import { useUIStore } from "@/store/ui.store.js";

export const PLANNING_STORAGE_KEY = "planningSettings";

export interface PlanningSettings {
  incomeOverride: number | null;
  needsPct: number;
  wantsPct: number;
  savingsPct: number;
}

const DEFAULT_SETTINGS: PlanningSettings = {
  incomeOverride: null,
  needsPct: 50,
  wantsPct: 30,
  savingsPct: 20,
};

export function loadPlanningSettings(): PlanningSettings {
  try {
    const raw = localStorage.getItem(PLANNING_STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<PlanningSettings>) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}

type Status = "on-track" | "warning" | "over" | "neutral";

function statusVariant(s: Status): "success" | "warning" | "danger" | "default" {
  if (s === "on-track") return "success";
  if (s === "warning") return "warning";
  if (s === "over") return "danger";
  return "default";
}

export function PlanningPage() {
  const { conn } = useDb();
  const { toggleAssistant, assistantOpen, setPendingAssistantMessage } = useUIStore();

  const [monthlyCredits, setMonthlyCredits] = useState<{ month: string; total: number }[]>([]);
  const [monthlyDebits, setMonthlyDebits] = useState<{ month: string; total: number }[]>([]);
  const [settings, setSettings] = useState<PlanningSettings>(loadPlanningSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!conn) return;
    void Promise.all([
      getMonthlyCreditTotals(conn),
      getMonthlyDebitTotals(conn),
    ]).then(([credits, debits]) => {
      setMonthlyCredits(credits);
      setMonthlyDebits(debits);
    });
  }, [conn]);

  // Auto-detected income: trailing 3-month avg of credits
  const autoIncome = useMemo(() => {
    const last3 = monthlyCredits.slice(-3);
    if (last3.length === 0) return 0;
    return Math.round(last3.reduce((s, c) => s + c.total, 0) / last3.length);
  }, [monthlyCredits]);

  const monthlyIncome = settings.incomeOverride ?? autoIncome;

  // Current month actuals
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthDebits = monthlyDebits.find((d) => d.month === currentMonth)?.total ?? 0;
  const thisMonthCredits = monthlyCredits.find((c) => c.month === currentMonth)?.total ?? 0;
  const actualSavings = Math.max(0, thisMonthCredits - thisMonthDebits);

  // Target allocations
  const targetNeeds = Math.round(monthlyIncome * settings.needsPct / 100);
  const targetWants = Math.round(monthlyIncome * settings.wantsPct / 100);
  const targetSavings = Math.round(monthlyIncome * settings.savingsPct / 100);
  const targetSpending = targetNeeds + targetWants;

  const total = settings.needsPct + settings.wantsPct + settings.savingsPct;
  const isValid = total === 100;

  function updatePct(field: "needsPct" | "wantsPct" | "savingsPct", value: number) {
    setSettings((s) => ({ ...s, [field]: Math.max(0, Math.min(100, value)) }));
    setSaved(false);
  }

  function handleSave() {
    localStorage.setItem(PLANNING_STORAGE_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReviewWithClaude() {
    const spendingPct = monthlyIncome > 0 ? Math.round((thisMonthDebits / monthlyIncome) * 100) : 0;
    const savPct = monthlyIncome > 0 ? Math.round((actualSavings / monthlyIncome) * 100) : 0;

    const msg = `Please review my budget plan:

Monthly Income: ${formatCurrency(monthlyIncome)}
Budget Split: Needs ${settings.needsPct}% (${formatCurrency(targetNeeds)}) | Wants ${settings.wantsPct}% (${formatCurrency(targetWants)}) | Savings ${settings.savingsPct}% (${formatCurrency(targetSavings)})

This Month Actual:
- Total Spending: ${formatCurrency(thisMonthDebits)} (${spendingPct}% of income) vs target of ${formatCurrency(targetSpending)} for needs+wants
- Net Saved: ${formatCurrency(actualSavings)} (${savPct}% of income) vs target of ${formatCurrency(targetSavings)} (${settings.savingsPct}%)

Is this split realistic given my actual spending patterns? What would you adjust, and why?`;

    setPendingAssistantMessage(msg);
    if (!assistantOpen) toggleAssistant();
  }

  function spendingStatus(): Status {
    if (monthlyIncome === 0 || thisMonthDebits === 0) return "neutral";
    const pct = (thisMonthDebits / monthlyIncome) * 100;
    const target = settings.needsPct + settings.wantsPct;
    if (pct > target + 5) return "over";
    if (pct > target) return "warning";
    return "on-track";
  }

  function savingsStatus(): Status {
    if (monthlyIncome === 0) return "neutral";
    const pct = (actualSavings / monthlyIncome) * 100;
    if (pct < settings.savingsPct - 5) return "over";
    if (pct < settings.savingsPct) return "warning";
    return "on-track";
  }

  const BUCKETS = [
    {
      label: "Needs",
      key: "needsPct" as const,
      color: "var(--color-chart-1)",
      description: "Housing, food, utilities, transport",
    },
    {
      label: "Wants",
      key: "wantsPct" as const,
      color: "var(--color-warning)",
      description: "Dining out, entertainment, shopping",
    },
    {
      label: "Savings",
      key: "savingsPct" as const,
      color: "var(--color-success)",
      description: "Emergency fund, investments, debt payoff",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Planning</h1>
        {!isValid && (
          <span className="text-sm text-[var(--color-danger)]">
            Percentages must sum to 100% (currently {total}%)
          </span>
        )}
      </div>

      {/* Income */}
      <Card>
        <CardHeader><CardTitle>Monthly Income</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-4">
              <div className="flex-1 rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-3">
                <p className="text-xs text-[var(--color-text-muted)] mb-1">
                  Auto-detected (last 3 months avg credits)
                </p>
                <p className="text-lg font-semibold">
                  {autoIncome > 0 ? formatCurrency(autoIncome) : "No data yet"}
                </p>
              </div>
              <div className="flex-1">
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                  Manual override
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  placeholder={autoIncome > 0 ? String(autoIncome) : "e.g. 5000"}
                  value={settings.incomeOverride ?? ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? null : Number(e.target.value);
                    setSettings((s) => ({ ...s, incomeOverride: val }));
                    setSaved(false);
                  }}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Using:{" "}
              <span className="font-semibold text-[var(--color-text)]">
                {formatCurrency(monthlyIncome)}/mo
              </span>
              {settings.incomeOverride !== null && (
                <span className="ml-1 text-[var(--color-warning)]">(manual override active)</span>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Budget Split */}
      <Card>
        <CardHeader>
          <CardTitle>Budget Split</CardTitle>
          <p className="text-xs text-[var(--color-text-muted)]">
            Adjust percentages to match your goals. Must total 100%.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-5">
            {BUCKETS.map(({ label, key, color, description }) => (
              <div key={key} className="flex items-center gap-4">
                <div className="w-24 shrink-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)] leading-tight">{description}</p>
                </div>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={settings[key]}
                  onChange={(e) => updatePct(key, Number(e.target.value))}
                  className="w-16 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <span className="text-sm text-[var(--color-text-muted)]">%</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--color-surface-raised)] overflow-hidden">
                  <div
                    className="h-2 rounded-full transition-all duration-200"
                    style={{
                      width: `${Math.min(100, settings[key])}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
                <span className="w-24 text-right text-sm font-semibold">
                  {formatCurrency(Math.round(monthlyIncome * settings[key] / 100))}
                </span>
              </div>
            ))}

            <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3">
              <span className="text-sm text-[var(--color-text-muted)]">Total</span>
              <span
                className={`text-sm font-semibold ${
                  isValid ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                }`}
              >
                {total}%
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* vs Actuals */}
      <Card>
        <CardHeader>
          <CardTitle>vs This Month's Actuals</CardTitle>
          <p className="text-xs text-[var(--color-text-muted)]">
            Spending = all debits. Saved = credits minus debits.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Spending
                </p>
                <Badge variant={statusVariant(spendingStatus())}>{spendingStatus()}</Badge>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(thisMonthDebits)}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                target {formatCurrency(targetSpending)}
                <span className="ml-1">({settings.needsPct + settings.wantsPct}% of income)</span>
              </p>
            </div>
            <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Saved
                </p>
                <Badge variant={statusVariant(savingsStatus())}>{savingsStatus()}</Badge>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(actualSavings)}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                target {formatCurrency(targetSavings)}
                <span className="ml-1">({settings.savingsPct}% of income)</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={!isValid}
          className="rounded-[var(--radius-sm)] bg-[var(--color-primary)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary)]/90 disabled:opacity-40 transition-colors"
        >
          {saved ? "Saved ✓" : "Save Budget"}
        </button>
        <button
          onClick={handleReviewWithClaude}
          disabled={!isValid || monthlyIncome === 0}
          className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-5 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] disabled:opacity-40 transition-colors"
        >
          <Sparkles size={14} className="text-[var(--color-primary)]" />
          Review with Claude
        </button>
      </div>
    </div>
  );
}
