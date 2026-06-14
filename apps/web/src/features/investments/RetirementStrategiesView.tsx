import React, { useState, useMemo, useEffect } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, Input, Badge, formatCurrency } from "@milly-maker/ui";
import { projectInvestmentGrowth } from "@milly-maker/finance-engine";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  totalValue: number;
  totalMonthlyContribution: number;
  weightedAnnualReturn: number;
}

type Strategy = "traditional" | "coast" | "barista" | "fat";

const STRATEGIES: { key: Strategy; label: string; blurb: string }[] = [
  { key: "traditional", label: "Traditional FIRE", blurb: "Build 25× your annual expenses and live off safe withdrawals — full early retirement." },
  { key: "coast",       label: "Coast FIRE",       blurb: "Have enough invested today that it grows to your number by retirement age, without saving another dollar." },
  { key: "barista",     label: "Barista FIRE",     blurb: "Semi-retire: part-time income covers part of your spending, the portfolio covers the rest." },
  { key: "fat",         label: "Fat FIRE",         blurb: "A larger nest egg funding a more comfortable, higher-spending retirement." },
];

const CURRENT_YEAR = new Date().getFullYear();

// ── Math helpers ───────────────────────────────────────────────────────────────

/** Nest egg needed to fund `annualSpend` at a safe withdrawal rate. */
function fireNumber(annualSpend: number, withdrawalRatePct: number): number {
  if (withdrawalRatePct <= 0) return Infinity;
  return annualSpend / (withdrawalRatePct / 100);
}

/**
 * Years until the portfolio (growing with contributions) reaches `target`.
 * Returns 0 if already there, null if not reached within 80 years.
 */
function yearsToTarget(
  currentValue: number,
  monthlyContribution: number,
  annualReturn: number,
  target: number,
): number | null {
  if (target <= 0) return 0;
  if (currentValue >= target) return 0;
  const proj = projectInvestmentGrowth({
    currentValue, monthlyContribution, annualReturnRate: annualReturn, years: 80,
  });
  const hit = proj.find((p) => p.nominalValue >= target);
  return hit ? Math.round((hit.month / 12) * 10) / 10 : null;
}

// ── Shared verdict card ─────────────────────────────────────────────────────────

interface VerdictProps {
  portfolio: number;
  target: number;
  yearsAway: number | null;
  currentAge: number;
}

function Verdict({ portfolio, target, yearsAway, currentAge }: VerdictProps) {
  const pct = target > 0 ? (portfolio / target) * 100 : 0;
  const ready = yearsAway === 0;
  const unreachable = yearsAway === null;

  const barColor = ready
    ? "var(--color-success)"
    : pct >= 60 ? "var(--color-primary)" : "var(--color-warning)";

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">Can you FIRE?</p>
          <p className={`mt-1 text-2xl font-bold ${ready ? "text-[var(--color-success)]" : "text-[var(--color-text)]"}`}>
            {ready
              ? "Yes — you're there 🎉"
              : unreachable
                ? "Not on this trajectory"
                : `${yearsAway} year${yearsAway === 1 ? "" : "s"} to go`}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {ready
              ? `Your portfolio covers the ${formatCurrency(target)} target.`
              : unreachable
                ? "Increase contributions, returns, or trim the target to make it reachable within 80 years."
                : `On track to hit ${formatCurrency(target)} around age ${Math.round(currentAge + yearsAway)} (${CURRENT_YEAR + Math.ceil(yearsAway)}).`}
          </p>
        </div>
        <Badge variant={ready ? "success" : "muted"}>{Math.min(999, Math.round(pct))}%</Badge>
      </div>

      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(2, pct))}%`, backgroundColor: barColor }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-[var(--color-text-muted)]">
        <span>{formatCurrency(portfolio)} now</span>
        <span>{formatCurrency(target)} target</span>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>{value}</p>
    </div>
  );
}

// ── Coast chart ─────────────────────────────────────────────────────────────────

/** Project the portfolio with NO further contributions from now to retirement age. */
function buildCoastProjection(currentValue: number, annualReturn: number, years: number) {
  if (years <= 0) {
    return [{ label: `${CURRENT_YEAR}`, value: Math.round(currentValue) }];
  }
  return projectInvestmentGrowth({
    currentValue, monthlyContribution: 0, annualReturnRate: annualReturn, years,
  })
    .filter((p) => p.month % 12 === 0)
    .map((p) => ({ label: `${CURRENT_YEAR + p.year}`, value: Math.round(p.nominalValue) }));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RetirementStrategiesView({ totalValue, totalMonthlyContribution, weightedAnnualReturn }: Props) {
  const [strategy, setStrategy] = useState<Strategy>("traditional");

  // Shared inputs
  const [portfolio, setPortfolio] = useState(totalValue);
  const [currentAge, setCurrentAge] = useState(35);
  const [annualExpenses, setAnnualExpenses] = useState(60000);
  const [monthlyContrib, setMonthlyContrib] = useState(totalMonthlyContribution);
  const [returnRate, setReturnRate] = useState(Math.round(weightedAnnualReturn * 100 * 10) / 10 || 7);
  const [withdrawalRate, setWithdrawalRate] = useState(4);

  // Strategy-specific inputs
  const [retirementAge, setRetirementAge] = useState(65);   // coast
  const [baristaIncome, setBaristaIncome] = useState(25000); // barista part-time annual income
  const [fatExpenses, setFatExpenses] = useState(120000);    // fat annual spend

  // Sync inputs when parent portfolio data loads (async DB hook)
  useEffect(() => { setPortfolio(totalValue); }, [totalValue]);
  useEffect(() => { setMonthlyContrib(totalMonthlyContribution); }, [totalMonthlyContribution]);
  useEffect(() => {
    const r = Math.round(weightedAnnualReturn * 100 * 10) / 10;
    if (r > 0) setReturnRate(r);
  }, [weightedAnnualReturn]);

  const r = returnRate / 100;
  const fullFire = fireNumber(annualExpenses, withdrawalRate);

  // Per-strategy target nest egg
  const target = useMemo(() => {
    switch (strategy) {
      case "traditional": return fullFire;
      case "fat":         return fireNumber(fatExpenses, withdrawalRate);
      case "barista":     return fireNumber(Math.max(0, annualExpenses - baristaIncome), withdrawalRate);
      case "coast": {
        const yearsToRetire = Math.max(0, retirementAge - currentAge);
        return fullFire / Math.pow(1 + r, yearsToRetire);
      }
    }
  }, [strategy, fullFire, fatExpenses, withdrawalRate, annualExpenses, baristaIncome, retirementAge, currentAge, r]);

  const yearsAway = useMemo(
    () => yearsToTarget(portfolio, monthlyContrib, r, target),
    [portfolio, monthlyContrib, r, target],
  );

  // Coast-specific projection (no contributions to retirement)
  const yearsToRetire = Math.max(0, retirementAge - currentAge);
  const coastChart = useMemo(
    () => buildCoastProjection(portfolio, r, yearsToRetire),
    [portfolio, r, yearsToRetire],
  );
  const coastEnding = coastChart[coastChart.length - 1]?.value ?? portfolio;

  const incomeNow = portfolio * (withdrawalRate / 100);
  const activeBlurb = STRATEGIES.find((s) => s.key === strategy)?.blurb ?? "";

  return (
    <div className="flex flex-col gap-6">
      {/* Strategy sub-tabs */}
      <div className="flex flex-wrap gap-1">
        {STRATEGIES.map((s) => (
          <button
            key={s.key}
            onClick={() => setStrategy(s.key)}
            className={`rounded-[var(--radius-sm)] px-4 py-1.5 text-sm font-medium transition-colors ${
              strategy === s.key
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="text-sm text-[var(--color-text-muted)]">{activeBlurb}</p>

      {/* Shared parameters */}
      <Card>
        <CardHeader><CardTitle>Your Numbers</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Input
              label="Portfolio ($)"
              type="number" min={0} step={1000}
              value={String(portfolio)}
              onChange={(e) => setPortfolio(Number(e.target.value))}
            />
            <Input
              label="Current Age"
              type="number" min={18} max={100}
              value={String(currentAge)}
              onChange={(e) => setCurrentAge(Number(e.target.value))}
            />
            <Input
              label="Annual Expenses ($)"
              type="number" min={0} step={1000}
              value={String(annualExpenses)}
              onChange={(e) => setAnnualExpenses(Number(e.target.value))}
            />
            <Input
              label="Monthly Saving ($)"
              type="number" min={0} step={100}
              value={String(monthlyContrib)}
              onChange={(e) => setMonthlyContrib(Number(e.target.value))}
            />
            <Input
              label="Annual Return (%)"
              type="number" min={0} max={30} step={0.1}
              value={String(returnRate)}
              onChange={(e) => setReturnRate(Number(e.target.value))}
            />
            <Input
              label="Withdrawal Rate (%)"
              type="number" min={1} max={10} step={0.1}
              value={String(withdrawalRate)}
              onChange={(e) => setWithdrawalRate(Number(e.target.value))}
              hint="4% rule default"
            />
          </div>

          {/* Strategy-specific inputs */}
          {strategy === "coast" && (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Input
                label="Retirement Age"
                type="number" min={currentAge + 1} max={100}
                value={String(retirementAge)}
                onChange={(e) => setRetirementAge(Number(e.target.value))}
                hint={retirementAge <= currentAge ? "Must be after current age" : undefined}
              />
            </div>
          )}
          {strategy === "barista" && (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Input
                label="Part-time Income ($/yr)"
                type="number" min={0} step={1000}
                value={String(baristaIncome)}
                onChange={(e) => setBaristaIncome(Number(e.target.value))}
                hint="Covered by work, not the portfolio"
              />
            </div>
          )}
          {strategy === "fat" && (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Input
                label="Fat Annual Spend ($)"
                type="number" min={0} step={1000}
                value={String(fatExpenses)}
                onChange={(e) => setFatExpenses(Number(e.target.value))}
                hint="Your comfortable retirement budget"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Verdict */}
      <Verdict portfolio={portfolio} target={target} yearsAway={yearsAway} currentAge={currentAge} />

      {/* Strategy stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {strategy === "traditional" && (<>
          <StatBox label="FIRE Number (25× rule)" value={formatCurrency(target)} accent="var(--color-primary)" />
          <StatBox label="Current Portfolio" value={formatCurrency(portfolio)} />
          <StatBox label="Income at Withdrawal Rate" value={`${formatCurrency(incomeNow)}/yr`} accent="var(--color-success)" />
          <StatBox label="Still Needed" value={formatCurrency(Math.max(0, target - portfolio))} />
        </>)}

        {strategy === "fat" && (<>
          <StatBox label="Fat FIRE Number" value={formatCurrency(target)} accent="var(--color-primary)" />
          <StatBox label="Funds Annual Spend Of" value={`${formatCurrency(fatExpenses)}/yr`} />
          <StatBox label="Income at Withdrawal Rate" value={`${formatCurrency(incomeNow)}/yr`} accent="var(--color-success)" />
          <StatBox label="Still Needed" value={formatCurrency(Math.max(0, target - portfolio))} />
        </>)}

        {strategy === "barista" && (<>
          <StatBox label="Barista FIRE Number" value={formatCurrency(target)} accent="var(--color-primary)" />
          <StatBox label="Portfolio Must Cover" value={`${formatCurrency(Math.max(0, annualExpenses - baristaIncome))}/yr`} />
          <StatBox label="Part-time Covers" value={`${formatCurrency(baristaIncome)}/yr`} accent="var(--color-success)" />
          <StatBox label="Still Needed" value={formatCurrency(Math.max(0, target - portfolio))} />
        </>)}

        {strategy === "coast" && (<>
          <StatBox label={`Coast Number (today)`} value={formatCurrency(target)} accent="var(--color-primary)" />
          <StatBox label="Full FIRE Number" value={formatCurrency(fullFire)} />
          <StatBox label={`Projected at ${retirementAge}`} value={formatCurrency(coastEnding)} accent="var(--color-success)" />
          <StatBox label="vs FIRE Number" value={formatCurrency(coastEnding - fullFire, true)} accent={coastEnding >= fullFire ? "var(--color-success)" : "var(--color-danger)"} />
        </>)}
      </div>

      {/* Coast chart */}
      {strategy === "coast" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Coast Projection (no further saving)</CardTitle>
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-success)]" />
                Portfolio
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={coastChart} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradCoastProj" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `$${v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`}`}
                  tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  width={60}
                />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), ""]}
                  contentStyle={{
                    background: "var(--color-surface-raised)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 12,
                  }}
                />
                <ReferenceLine
                  y={fullFire}
                  stroke="var(--color-primary)"
                  strokeDasharray="4 3"
                  label={{ value: `FIRE ${formatCurrency(fullFire)}`, position: "insideTopRight", fontSize: 11, fill: "var(--color-primary)" }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-success)"
                  strokeWidth={2}
                  fill="url(#gradCoastProj)"
                  dot={false}
                  name="Portfolio"
                />
              </AreaChart>
            </ResponsiveContainer>
            <p className="mt-2 text-center text-xs text-[var(--color-text-muted)]">
              Compounding {formatCurrency(portfolio)} at {returnRate}%/yr for {yearsToRetire} year{yearsToRetire === 1 ? "" : "s"} with no new contributions ·
              {coastEnding >= fullFire
                ? ` reaches your FIRE number — you can coast.`
                : ` falls ${formatCurrency(fullFire - coastEnding)} short — keep saving.`}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
