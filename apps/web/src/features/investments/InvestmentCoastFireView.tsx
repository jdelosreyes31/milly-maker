import React, { useState, useMemo, useEffect } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, Input, formatCurrency } from "@milly-maker/ui";
import { projectInvestmentGrowth } from "@milly-maker/finance-engine";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  totalValue: number;
  totalMonthlyContribution: number;
  weightedAnnualReturn: number;
}

interface ChartPoint {
  label: string;
  value: number;
  phase: "accumulation" | "coast";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

function buildProjection(
  currentValue: number,
  monthlyContribution: number,
  annualReturn: number,
  stopYear: number,
  retirementYear: number,
): { points: ChartPoint[]; valueAtStop: number; totalContributed: number } {
  const phase1Years = Math.max(0, stopYear - CURRENT_YEAR);
  const phase2Years = Math.max(0, retirementYear - stopYear);

  // Phase 1: accumulation with contributions
  // When stopYear === CURRENT_YEAR, skip the projection and anchor at currentValue directly
  const phase1: ChartPoint[] = phase1Years > 0
    ? projectInvestmentGrowth({
        currentValue,
        monthlyContribution,
        annualReturnRate: annualReturn,
        years: phase1Years,
      })
        .filter((p) => p.month % 12 === 0 || p.month === 0)
        .map((p) => ({
          label: `${CURRENT_YEAR + p.year}`,
          value: Math.round(p.nominalValue),
          phase: "accumulation" as const,
        }))
    : [{ label: `${CURRENT_YEAR}`, value: Math.round(currentValue), phase: "accumulation" }];

  const valueAtStop = phase1[phase1.length - 1]?.value ?? currentValue;
  const totalContributed = phase1Years * 12 * monthlyContribution;

  // Phase 2: coast — no contributions
  const phase2Raw = phase2Years > 0
    ? projectInvestmentGrowth({
        currentValue: valueAtStop,
        monthlyContribution: 0,
        annualReturnRate: annualReturn,
        years: phase2Years,
      })
        .filter((p) => p.month % 12 === 0 && p.month > 0)
        .map((p) => ({
          label: `${stopYear + p.year}`,
          value: Math.round(p.nominalValue),
          phase: "coast" as const,
        }))
    : [];

  return { points: [...phase1, ...phase2Raw], valueAtStop, totalContributed };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InvestmentCoastFireView({ totalValue, totalMonthlyContribution, weightedAnnualReturn }: Props) {
  const defaultStopYear = CURRENT_YEAR + 10;
  const defaultRetirementYear = CURRENT_YEAR + 30;

  const [stopYear, setStopYear] = useState(defaultStopYear);
  const [retirementYear, setRetirementYear] = useState(defaultRetirementYear);
  const [monthlyContrib, setMonthlyContrib] = useState(totalMonthlyContribution);
  const [returnRate, setReturnRate] = useState(Math.round(weightedAnnualReturn * 100 * 10) / 10 || 7);

  // Sync inputs when parent portfolio data loads (async DB hook)
  useEffect(() => { setMonthlyContrib(totalMonthlyContribution); }, [totalMonthlyContribution]);
  useEffect(() => {
    const r = Math.round(weightedAnnualReturn * 100 * 10) / 10;
    if (r > 0) setReturnRate(r);
  }, [weightedAnnualReturn]);

  // Clamp retirementYear >= stopYear + 1
  const safeRetirementYear = retirementYear <= stopYear ? stopYear + 1 : retirementYear;
  const retirementYearWarning = retirementYear <= stopYear;

  const { points, valueAtStop, totalContributed } = useMemo(() => buildProjection(
    totalValue,
    monthlyContrib,
    returnRate / 100,
    stopYear,
    safeRetirementYear,
  ), [totalValue, monthlyContrib, returnRate, stopYear, safeRetirementYear]);

  const projectedAtRetirement = points.length > 0 ? (points[points.length - 1]?.value ?? 0) : 0;
  const coastGrowth = projectedAtRetirement - valueAtStop;
  const stopLabel = String(stopYear);

  // Merge into one dataset with two value keys for recharts.
  // stopYear point belongs only to accumulation; coast starts the year after
  // to avoid a duplicate dot/overlap at the boundary.
  const chartData = points.map((p) => {
    const yr = Number(p.label);
    return {
      label: p.label,
      accumulation: yr <= stopYear ? p.value : undefined,
      coast: yr > stopYear ? p.value : undefined,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Inputs */}
      <Card>
        <CardHeader><CardTitle>Coast FIRE Parameters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Input
              label="Stop Contributing (year)"
              type="number"
              min={CURRENT_YEAR}
              max={2100}
              value={String(stopYear)}
              onChange={(e) => setStopYear(Number(e.target.value))}
            />
            <Input
              label="Retire (year)"
              type="number"
              min={stopYear + 1}
              max={2100}
              value={String(retirementYear)}
              onChange={(e) => setRetirementYear(Number(e.target.value))}
              hint={retirementYearWarning ? `Must be after ${stopYear}` : undefined}
            />
            <Input
              label="Monthly Contribution ($)"
              type="number"
              min={0}
              step={100}
              value={String(monthlyContrib)}
              onChange={(e) => setMonthlyContrib(Number(e.target.value))}
            />
            <Input
              label="Annual Return (%)"
              type="number"
              min={0}
              max={30}
              step={0.1}
              value={String(returnRate)}
              onChange={(e) => setReturnRate(Number(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Value at Stop ({stopYear})</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-primary)]">{formatCurrency(valueAtStop)}</p>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Projected at Retirement ({safeRetirementYear})</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-success)]">{formatCurrency(projectedAtRetirement)}</p>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Total Contributed (Phase 1)</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(totalContributed)}</p>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Coast Growth (Phase 2)</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-success)]">{formatCurrency(Math.max(0, coastGrowth))}</p>
        </div>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Two-Phase Projection</CardTitle>
            <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
                Accumulation
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-success)]" />
                Coast
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="gradAccum" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradCoast" x1="0" y1="0" x2="0" y2="1">
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
                x={stopLabel}
                stroke="var(--color-text-muted)"
                strokeDasharray="4 3"
                label={{ value: `Stop ${stopYear}`, position: "insideTopLeft", fontSize: 11, fill: "var(--color-text-muted)" }}
              />
              <Area
                type="monotone"
                dataKey="accumulation"
                stroke="var(--color-primary)"
                strokeWidth={2}
                fill="url(#gradAccum)"
                connectNulls
                dot={false}
                name="Accumulation"
              />
              <Area
                type="monotone"
                dataKey="coast"
                stroke="var(--color-success)"
                strokeWidth={2}
                fill="url(#gradCoast)"
                connectNulls
                dot={false}
                name="Coast"
              />
            </AreaChart>
          </ResponsiveContainer>
          <p className="mt-2 text-center text-xs text-[var(--color-text-muted)]">
            Phase 1: contribute ${monthlyContrib.toLocaleString()}/mo until {stopYear} · Phase 2: no contributions, compound at {returnRate}%/yr until {safeRetirementYear}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
