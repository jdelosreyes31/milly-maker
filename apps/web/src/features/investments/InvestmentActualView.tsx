import React, { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, formatCurrency } from "@milly-maker/ui";
import type { Investment, InvestmentHolding, HoldingLot, InvestmentContribution } from "@/db/queries/investments.js";
import { ASSET_CLASSES } from "@/db/queries/investments.js";

// ── Quant helpers ──────────────────────────────────────────────────────────────

/** Simple holding-period return annualized from first purchase date */
function annualizedReturn(totalReturnFrac: number, daysHeld: number): number | null {
  if (daysHeld <= 0) return null;
  return Math.pow(1 + totalReturnFrac, 365 / daysHeld) - 1;
}

/** Herfindahl-Hirschman Index: sum(wi^2). Range 0–1. Higher = more concentrated. */
function hhi(weights: number[]): number {
  return weights.reduce((s, w) => s + w * w, 0);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  holdings: InvestmentHolding[];
  soldHoldings: InvestmentHolding[];
  investments: Investment[];
  lots: HoldingLot[];
  contributions: InvestmentContribution[];
  totalValue: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ASSET_CLASS_COLORS: Record<string, string> = {
  stocks:      "#5b5bd6",
  bonds:       "#12b76a",
  cash:        "#0ea5e9",
  real_estate: "#f79009",
  crypto:      "#f43f5e",
  commodities: "#7c3aed",
  other:       "#94a3b8",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtShort(v: number) {
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InvestmentActualView({ holdings, soldHoldings, investments, lots, contributions, totalValue }: Props) {
  const totalCostBasis = holdings.reduce((s, h) => s + h.cost_basis, 0);
  const totalPnL = totalValue - totalCostBasis;
  const totalReturn = totalCostBasis > 0 ? (totalPnL / totalCostBasis) * 100 : 0;

  // ── Cost basis timeline from lots ────────────────────────────────────────
  // Build a step-function of cumulative cost basis from each dated lot purchase.
  // Today's current value is the single known endpoint for actual portfolio value.
  const timelineData = useMemo(() => {
    if (lots.length === 0) return [];

    // Group lot costs by date
    const byDate: Record<string, number> = {};
    for (const lot of lots) {
      const d = lot.purchased_at.slice(0, 10); // YYYY-MM-DD
      byDate[d] = (byDate[d] ?? 0) + lot.shares * lot.price_per_share;
    }

    // Sort dates, build cumulative series
    const sorted = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
    let cumCost = 0;
    const points = sorted.map(([date, cost]) => {
      cumCost += cost;
      return { date, label: fmtDate(date), costBasis: cumCost };
    });

    // Add today as the final point showing current value
    const today = new Date().toISOString().slice(0, 10);
    const lastPoint = points[points.length - 1];
    if (lastPoint && lastPoint.date !== today) {
      points.push({
        date: today,
        label: "Today",
        costBasis: lastPoint.costBasis, // cost basis doesn't change — no new lots
      });
    }

    // Attach current value only on the last point
    return points.map((p, i) => ({
      ...p,
      currentValue: i === points.length - 1 ? totalValue : undefined,
    }));
  }, [lots, totalValue]);

  // Earliest purchase date across all lots
  const firstDate = useMemo(() => {
    if (lots.length === 0) return null;
    return lots
      .map(l => l.purchased_at.slice(0, 10))
      .sort()[0] ?? null;
  }, [lots]);

  const daysHeld = firstDate ? daysSince(firstDate) : null;

  // ── Quant stats ──────────────────────────────────────────────────────────
  const quantStats = useMemo(() => {
    const moic = totalCostBasis > 0 ? totalValue / totalCostBasis : null;

    const annRet = (daysHeld && daysHeld > 0 && totalCostBasis > 0)
      ? annualizedReturn(totalPnL / totalCostBasis, daysHeld)
      : null;

    // Win/loss stats across holdings with cost basis
    const withCost = holdings.filter(h => h.cost_basis > 0);
    const winners = withCost.filter(h => h.current_value > h.cost_basis);
    const losers  = withCost.filter(h => h.current_value < h.cost_basis);
    const winRate = withCost.length > 0 ? winners.length / withCost.length : null;

    const avgWinRet = winners.length > 0
      ? winners.reduce((s, h) => s + (h.current_value - h.cost_basis) / h.cost_basis, 0) / winners.length
      : null;
    const avgLossRet = losers.length > 0
      ? losers.reduce((s, h) => s + (h.current_value - h.cost_basis) / h.cost_basis, 0) / losers.length
      : null;
    const glRatio = (avgWinRet !== null && avgLossRet !== null && avgLossRet < 0)
      ? avgWinRet / Math.abs(avgLossRet)
      : null;

    // Portfolio concentration (HHI) using current value weights
    const weights = holdings
      .filter(h => h.current_value > 0)
      .map(h => h.current_value / totalValue);
    const concentration = totalValue > 0 && weights.length > 0 ? hhi(weights) : null;

    // Asset-class P&L attribution
    const byClass: Record<string, { costBasis: number; currentValue: number }> = {};
    for (const h of holdings) {
      const cls = h.asset_class;
      if (!byClass[cls]) byClass[cls] = { costBasis: 0, currentValue: 0 };
      byClass[cls].costBasis    += h.cost_basis;
      byClass[cls].currentValue += h.current_value;
    }
    const classAttribution = Object.entries(byClass)
      .map(([cls, { costBasis, currentValue }]) => ({
        cls,
        label: ASSET_CLASSES.find(a => a.value === cls)?.label ?? cls,
        costBasis,
        currentValue,
        pnl: currentValue - costBasis,
        pnlPct: costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0,
        weight: totalValue > 0 ? (currentValue / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.currentValue - a.currentValue);

    return { moic, annRet, winRate, glRatio, concentration, classAttribution, winCount: winners.length, totalWithCost: withCost.length };
  }, [holdings, totalCostBasis, totalValue, totalPnL, daysHeld]);

  // ── Per-holding performance table ────────────────────────────────────────
  const holdingRows = useMemo(() => {
    const invMap = new Map(investments.map(i => [i.id, i]));
    return holdings
      .filter(h => h.cost_basis > 0 || h.current_value > 0)
      .map(h => {
        const pnl = h.current_value - h.cost_basis;
        const ret = h.cost_basis > 0 ? (pnl / h.cost_basis) * 100 : 0;
        const inv = invMap.get(h.investment_id);
        return { ...h, pnl, ret, accountName: inv?.name ?? "" };
      })
      .sort((a, b) => b.current_value - a.current_value);
  }, [holdings, investments]);

  // ── Per-account summary ──────────────────────────────────────────────────
  const accountRows = useMemo(() => {
    return investments
      .filter(i => i.current_value > 0 || i.cost_basis > 0)
      .map(i => ({
        ...i,
        pnl: i.current_value - i.cost_basis,
        ret: i.cost_basis > 0 ? ((i.current_value - i.cost_basis) / i.cost_basis) * 100 : 0,
      }))
      .sort((a, b) => b.current_value - a.current_value);
  }, [investments]);

  const TOOLTIP_STYLE = {
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontSize: "12px",
    color: "var(--color-text)",
  };

  const hasLots = lots.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1">Total Invested</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(totalCostBasis, true)}</p>
            {daysHeld !== null && (
              <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">
                over {daysHeld} day{daysHeld !== 1 ? "s" : ""}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1">Current Value</p>
            <p className="text-lg font-bold tabular-nums text-[var(--color-success)]">{formatCurrency(totalValue, true)}</p>
            <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">as of today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1">Unrealized P&amp;L</p>
            <p className={`text-lg font-bold tabular-nums ${totalPnL >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
              {totalPnL >= 0 ? "+" : ""}{formatCurrency(totalPnL, true)}
            </p>
            <p className={`text-[10px] mt-0.5 ${totalPnL >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
              {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(2)}% on cost
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1">Purchases Logged</p>
            <p className="text-lg font-bold tabular-nums">{lots.length}</p>
            <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">
              across {holdings.length} holding{holdings.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Quant stats row ── */}
      {(quantStats.moic !== null || quantStats.annRet !== null || quantStats.winRate !== null) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* MOIC */}
          {quantStats.moic !== null && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1">MOIC</p>
                <p className={`text-lg font-bold tabular-nums ${quantStats.moic >= 1 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                  {quantStats.moic.toFixed(2)}×
                </p>
                <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">multiple on invested capital</p>
              </CardContent>
            </Card>
          )}

          {/* Annualized Return */}
          {quantStats.annRet !== null && daysHeld !== null && daysHeld >= 30 && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1">Ann. Return</p>
                <p className={`text-lg font-bold tabular-nums ${quantStats.annRet >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                  {quantStats.annRet >= 0 ? "+" : ""}{(quantStats.annRet * 100).toFixed(1)}%
                </p>
                <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">annualized HPR</p>
              </CardContent>
            </Card>
          )}

          {/* Win Rate */}
          {quantStats.winRate !== null && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1">Win Rate</p>
                <p className={`text-lg font-bold tabular-nums ${quantStats.winRate >= 0.5 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                  {(quantStats.winRate * 100).toFixed(0)}%
                </p>
                <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">
                  {quantStats.winCount} of {quantStats.totalWithCost} holdings profitable
                </p>
              </CardContent>
            </Card>
          )}

          {/* Gain/Loss Ratio */}
          {quantStats.glRatio !== null ? (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1">G/L Ratio</p>
                <p className={`text-lg font-bold tabular-nums ${quantStats.glRatio >= 1 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                  {quantStats.glRatio.toFixed(2)}×
                </p>
                <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">avg gain / avg loss magnitude</p>
              </CardContent>
            </Card>
          ) : quantStats.concentration !== null ? (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1">Concentration</p>
                <p className={`text-lg font-bold tabular-nums ${quantStats.concentration > 0.35 ? "text-[var(--color-danger)]" : quantStats.concentration > 0.2 ? "text-amber-500" : "text-[var(--color-success)]"}`}>
                  {(quantStats.concentration * 100).toFixed(0)}
                </p>
                <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">HHI · lower = more diversified</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {/* ── Asset class attribution ── */}
      {quantStats.classAttribution.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Asset Class Attribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {quantStats.classAttribution.map(({ cls, label, costBasis, pnl, pnlPct, weight }) => (
                <div key={cls} className="flex items-center gap-3">
                  <div className="w-24 shrink-0">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                      style={{ backgroundColor: ASSET_CLASS_COLORS[cls] ?? "#94a3b8" }}
                    >
                      {label}
                    </span>
                  </div>
                  {/* Weight bar */}
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${weight}%`, backgroundColor: ASSET_CLASS_COLORS[cls] ?? "#94a3b8" }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-[var(--color-text-muted)] w-10 text-right">{weight.toFixed(1)}%</span>
                  {costBasis > 0 && (
                    <span className={`text-xs tabular-nums font-semibold w-24 text-right ${pnl >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                      {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Cost basis timeline ── */}
      {hasLots ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Cost Basis Timeline</CardTitle>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Cumulative money invested from logged purchases · today's portfolio value shown as endpoint
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={timelineData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="agCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                <XAxis dataKey="label" tick={{ fill: "var(--color-text-subtle)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  tickFormatter={fmtShort}
                  tick={{ fill: "var(--color-text-subtle)", fontSize: 10 }}
                  axisLine={false} tickLine={false} width={52}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, name: string) => [
                    formatCurrency(v, true),
                    name === "costBasis" ? "Cost Basis" : "Current Value",
                  ]}
                  labelFormatter={label => label}
                />
                {/* Reference line at today's current value for easy visual diff */}
                <ReferenceLine
                  y={totalValue}
                  stroke="var(--color-success)"
                  strokeDasharray="4 3"
                  strokeOpacity={0.5}
                  label={{
                    value: `Current: ${fmtShort(totalValue)}`,
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: "var(--color-success)",
                  }}
                />
                <Area
                  type="stepAfter"
                  dataKey="costBasis"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  fill="url(#agCost)"
                  name="costBasis"
                  connectNulls
                />
                {/* Today's current value as a dot */}
                <Area
                  type="monotone"
                  dataKey="currentValue"
                  stroke="var(--color-success)"
                  strokeWidth={0}
                  fill="var(--color-success)"
                  fillOpacity={1}
                  dot={{ r: 5, fill: "var(--color-success)", strokeWidth: 2, stroke: "var(--color-surface)" }}
                  name="currentValue"
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-[var(--color-text-subtle)] mt-2 text-center">
              To see a full portfolio value curve over time, historical price snapshots would need to be stored — not yet tracked.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">No purchase history yet.</p>
            <p className="text-xs text-[var(--color-text-subtle)] mt-1">
              Use <span className="font-medium">Log Buy</span> (🛒) on any holding to record purchases — they'll appear here as a timeline.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Per-account P&L ── */}
      {accountRows.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)] text-left">
                  <th className="pb-2">Account</th>
                  <th className="pb-2 text-right">Invested</th>
                  <th className="pb-2 text-right">Value</th>
                  <th className="pb-2 text-right">P&amp;L</th>
                  <th className="pb-2 text-right">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {accountRows.map(i => (
                  <tr key={i.id}>
                    <td className="py-2 font-medium">{i.name}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                      {formatCurrency(i.cost_basis)}
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold">
                      {formatCurrency(i.current_value, true)}
                    </td>
                    <td className={`py-2 text-right tabular-nums font-semibold ${i.pnl >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                      {i.pnl >= 0 ? "+" : ""}{formatCurrency(i.pnl)}
                    </td>
                    <td className={`py-2 text-right tabular-nums text-xs font-semibold ${i.ret >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                      {i.ret >= 0 ? "+" : ""}{i.ret.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* ── Per-holding P&L ── */}
      {holdingRows.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Holdings</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)] text-left">
                  <th className="pb-2">Holding</th>
                  <th className="pb-2">Class</th>
                  <th className="pb-2 text-right">Cost Basis</th>
                  <th className="pb-2 text-right">Value</th>
                  <th className="pb-2 text-right">P&amp;L</th>
                  <th className="pb-2 text-right">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {holdingRows.map(h => (
                  <tr key={h.id} className="group">
                    <td className="py-2">
                      <p className="font-medium">{h.name}</p>
                      {h.ticker && <p className="text-xs font-mono text-[var(--color-text-muted)]">{h.ticker}</p>}
                      <p className="text-[10px] text-[var(--color-text-subtle)]">{h.accountName}</p>
                    </td>
                    <td className="py-2">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                        style={{ backgroundColor: ASSET_CLASS_COLORS[h.asset_class] ?? "#94a3b8" }}
                      >
                        {ASSET_CLASSES.find(a => a.value === h.asset_class)?.label ?? h.asset_class}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                      {h.cost_basis > 0 ? formatCurrency(h.cost_basis) : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold">
                      {formatCurrency(h.current_value, true)}
                    </td>
                    <td className={`py-2 text-right tabular-nums font-semibold ${h.pnl >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                      {h.cost_basis > 0 ? `${h.pnl >= 0 ? "+" : ""}${formatCurrency(h.pnl)}` : "—"}
                    </td>
                    <td className={`py-2 text-right tabular-nums text-xs font-semibold ${h.ret >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                      {h.cost_basis > 0 ? `${h.ret >= 0 ? "+" : ""}${h.ret.toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              {holdingRows.length > 1 && (
                <tfoot>
                  <tr className="border-t border-[var(--color-border)]">
                    <td colSpan={2} className="pt-2 text-xs text-[var(--color-text-muted)]">Total</td>
                    <td className="pt-2 text-right tabular-nums text-xs text-[var(--color-text-muted)]">
                      {formatCurrency(totalCostBasis)}
                    </td>
                    <td className="pt-2 text-right tabular-nums text-sm font-semibold text-[var(--color-success)]">
                      {formatCurrency(totalValue, true)}
                    </td>
                    <td className={`pt-2 text-right tabular-nums text-sm font-semibold ${totalPnL >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                      {totalPnL >= 0 ? "+" : ""}{formatCurrency(totalPnL)}
                    </td>
                    <td className={`pt-2 text-right tabular-nums text-xs font-semibold ${totalReturn >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                      {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(2)}%
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>
      )}

      {/* ── Closed / sold positions ── */}
      {soldHoldings.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Closed Positions</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)] text-left">
                  <th className="pb-2">Holding</th>
                  <th className="pb-2">Class</th>
                  <th className="pb-2 text-right">Cost Basis</th>
                  <th className="pb-2 text-right">Proceeds</th>
                  <th className="pb-2 text-right">Realized P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {soldHoldings.map(h => {
                  const pnl = h.current_value - h.cost_basis;
                  const invMap = new Map(investments.map(i => [i.id, i]));
                  const accountName = invMap.get(h.investment_id)?.name ?? "";
                  return (
                    <tr key={h.id} className="opacity-60">
                      <td className="py-2">
                        <p className="font-medium">{h.name}</p>
                        {h.ticker && <p className="text-xs font-mono text-[var(--color-text-muted)]">{h.ticker}</p>}
                        <p className="text-[10px] text-[var(--color-text-subtle)]">{accountName}</p>
                      </td>
                      <td className="py-2">
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                          style={{ backgroundColor: ASSET_CLASS_COLORS[h.asset_class] ?? "#94a3b8" }}
                        >
                          {ASSET_CLASSES.find(a => a.value === h.asset_class)?.label ?? h.asset_class}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                        {h.cost_basis > 0 ? formatCurrency(h.cost_basis) : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums font-semibold">
                        {formatCurrency(h.current_value)}
                      </td>
                      <td className={`py-2 text-right tabular-nums font-semibold ${pnl >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                        {h.cost_basis > 0 ? `${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* ── Purchase log ── */}
      {lots.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Purchase Log</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)] text-left">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Holding</th>
                  <th className="pb-2 text-right">Shares</th>
                  <th className="pb-2 text-right">Price / sh</th>
                  <th className="pb-2 text-right">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {[...lots]
                  .sort((a, b) => b.purchased_at.localeCompare(a.purchased_at))
                  .map(lot => {
                    const holding = holdings.find(h => h.id === lot.holding_id);
                    return (
                      <tr key={lot.id}>
                        <td className="py-2 tabular-nums text-[var(--color-text-muted)]">
                          {new Date(lot.purchased_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td className="py-2">
                          <p className="font-medium">{holding?.name ?? "—"}</p>
                          {holding?.ticker && <p className="text-xs font-mono text-[var(--color-text-muted)]">{holding.ticker}</p>}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {lot.shares.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </td>
                        <td className="py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                          {formatCurrency(lot.price_per_share)}
                        </td>
                        <td className="py-2 text-right tabular-nums font-semibold">
                          {formatCurrency(lot.shares * lot.price_per_share)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
