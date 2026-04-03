import React, { useEffect, useState, useMemo } from "react";
import { Sankey, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, formatCurrency } from "@milly-maker/ui";
import { useDb } from "@/db/hooks/useDb.js";
import { useSubscriptions, toMonthly } from "@/db/hooks/useSubscriptions.js";
import { useDebts } from "@/db/hooks/useDebts.js";
import { getMonthlyCreditTotals } from "@/db/queries/checking.js";
import { loadPlanningSettings } from "@/features/planning/PlanningPage.js";

// ── Colors ────────────────────────────────────────────────────────────────────

const C = {
  income:    "#5b5bd6",  // indigo
  subs:      "#f43f5e",  // rose
  debt:      "#f79009",  // amber
  savings:   "#12b76a",  // emerald
  disc:      "#0ea5e9",  // sky
  sub_item:  "#fb7185",  // rose lighter
  debt_item: "#fbbf24",  // amber lighter
  sav_sink:  "#34d399",  // emerald lighter
  disc_sink: "#38bdf8",  // sky lighter
  text:      "#101828",  // near-black
};

// ── Custom node ───────────────────────────────────────────────────────────────

function SankeyNode(props: any) {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;
  const { name, color, depth } = payload as { name: string; color: string; depth: number };
  const isSource = depth === 0;
  const isSink = depth === 3;
  const label = name.length > 22 ? name.slice(0, 20) + "…" : name;

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={color} rx={3} opacity={0.92} />
      {isSource && (
        <text
          x={x - 8} y={y + height / 2}
          textAnchor="end" dominantBaseline="middle"
          fontSize={11} fill={C.text} fontFamily="Inter, sans-serif"
        >
          {label}
        </text>
      )}
      {isSink && (
        <text
          x={x + width + 8} y={y + height / 2}
          textAnchor="start" dominantBaseline="middle"
          fontSize={11} fill={C.text} fontFamily="Inter, sans-serif"
        >
          {label}
        </text>
      )}
      {!isSource && !isSink && height >= 16 && (
        <text
          x={x + width / 2} y={y + height / 2}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={Math.min(11, height * 0.45)}
          fill="rgba(255,255,255,0.88)"
          fontFamily="Inter, sans-serif"
          style={{ pointerEvents: "none" }}
        >
          {height >= 22 ? label : ""}
        </text>
      )}
    </g>
  );
}

// ── Custom link ───────────────────────────────────────────────────────────────

function SankeyLink(props: any) {
  const { sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth, payload } = props;
  const color = (payload?.source as any)?.color ?? "#c4b49a";
  return (
    <path
      d={`
        M ${sourceX},${sourceY - linkWidth / 2}
        C ${sourceControlX},${sourceY - linkWidth / 2}
          ${targetControlX},${targetY - linkWidth / 2}
          ${targetX},${targetY - linkWidth / 2}
        L ${targetX},${targetY + linkWidth / 2}
        C ${targetControlX},${targetY + linkWidth / 2}
          ${sourceControlX},${sourceY + linkWidth / 2}
          ${sourceX},${sourceY + linkWidth / 2}
        Z
      `}
      fill={color}
      fillOpacity={0.25}
      stroke={color}
      strokeOpacity={0.15}
      strokeWidth={0.5}
    />
  );
}

// ── Tooltip content ───────────────────────────────────────────────────────────

function SankeyTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const name: string = item?.payload?.name ?? item?.name ?? "";
  const value: number = item?.value ?? 0;
  return (
    <div
      style={{
        backgroundColor: "#ede7d9",
        border: "1px solid #c4b49a",
        borderRadius: "6px",
        fontSize: "12px",
        fontFamily: "Inter, sans-serif",
        padding: "8px 12px",
      }}
    >
      <p style={{ color: C.text, fontWeight: 600, marginBottom: 2 }}>{name}</p>
      <p style={{ color: C.income }}>{formatCurrency(value)}/mo</p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const { conn } = useDb();
  const { subscriptions } = useSubscriptions();
  const { debts } = useDebts();
  const [credits, setCredits] = useState<{ month: string; total: number }[]>([]);

  useEffect(() => {
    if (!conn) return;
    void getMonthlyCreditTotals(conn).then(setCredits);
  }, [conn]);

  const settings = useMemo(() => loadPlanningSettings(), []);

  // Avg monthly income from trailing credits
  const avgMonthlyIncome = useMemo(() => {
    if (credits.length === 0) return 0;
    const last = credits.slice(-6);
    return Math.round(last.reduce((s, c) => s + c.total, 0) / last.length);
  }, [credits]);

  const income = settings.incomeOverride ?? avgMonthlyIncome;

  // Aggregate subscription and debt totals
  const totalSubMonthly = useMemo(
    () => subscriptions.reduce((s, sub) => s + toMonthly(sub.amount, sub.billing_cycle), 0),
    [subscriptions]
  );
  const totalDebtMin = useMemo(
    () => debts.reduce((s, d) => s + d.minimum_payment, 0),
    [debts]
  );
  const savingsTarget = Math.round(income * (settings.savingsPct / 100));
  const remainder = Math.max(0, income - totalSubMonthly - totalDebtMin - savingsTarget);

  // ── Build Sankey nodes + links ──────────────────────────────────────────────

  const sankeyData = useMemo(() => {
    if (income <= 0) return null;

    type SNode = { name: string; color: string; depth: number };
    type SLink = { source: number; target: number; value: number };
    const nodes: SNode[] = [];
    const links: SLink[] = [];
    const idx = () => nodes.length - 1;

    // ── Level 0: income source
    nodes.push({ name: "Paychecks", color: C.income, depth: 0 });
    const sourceIdx = idx();

    // ── Level 1: named buckets (only add if value > 0)
    const subsV   = Math.round(totalSubMonthly * 100) / 100;
    const debtV   = Math.round(totalDebtMin * 100) / 100;
    const savV    = Math.max(0, savingsTarget);
    const discV   = Math.max(0, remainder);

    let subsBucketIdx = -1;
    if (subsV > 0) {
      nodes.push({ name: "Subscriptions", color: C.subs, depth: 1 });
      subsBucketIdx = idx();
      links.push({ source: sourceIdx, target: subsBucketIdx, value: subsV });
    }

    let debtBucketIdx = -1;
    if (debtV > 0) {
      nodes.push({ name: "Debt Payments", color: C.debt, depth: 1 });
      debtBucketIdx = idx();
      links.push({ source: sourceIdx, target: debtBucketIdx, value: debtV });
    }

    let savBucketIdx = -1;
    if (savV > 0) {
      nodes.push({ name: "Savings", color: C.savings, depth: 1 });
      savBucketIdx = idx();
      links.push({ source: sourceIdx, target: savBucketIdx, value: savV });
    }

    let discBucketIdx = -1;
    if (discV > 0) {
      nodes.push({ name: "Discretionary", color: C.disc, depth: 1 });
      discBucketIdx = idx();
      links.push({ source: sourceIdx, target: discBucketIdx, value: discV });
    }

    // ── Level 2 (depth 3): individual items + pass-through sinks
    // Subscriptions → individual sub names
    if (subsBucketIdx >= 0) {
      for (const sub of subscriptions) {
        const v = Math.round(toMonthly(sub.amount, sub.billing_cycle) * 100) / 100;
        if (v > 0) {
          nodes.push({ name: sub.name, color: C.sub_item, depth: 3 });
          links.push({ source: subsBucketIdx, target: idx(), value: v });
        }
      }
    }

    // Debt payments → individual debt names
    if (debtBucketIdx >= 0) {
      for (const debt of debts) {
        if (debt.minimum_payment > 0) {
          nodes.push({ name: debt.name, color: C.debt_item, depth: 3 });
          links.push({ source: debtBucketIdx, target: idx(), value: debt.minimum_payment });
        }
      }
    }

    // Savings pass-through → sink node
    if (savBucketIdx >= 0) {
      nodes.push({ name: `${settings.savingsPct}% to savings`, color: C.sav_sink, depth: 3 });
      links.push({ source: savBucketIdx, target: idx(), value: savV });
    }

    // Discretionary pass-through → sink node
    if (discBucketIdx >= 0) {
      nodes.push({ name: "Flexible spending", color: C.disc_sink, depth: 3 });
      links.push({ source: discBucketIdx, target: idx(), value: discV });
    }

    return { nodes, links };
  }, [income, subscriptions, debts, totalSubMonthly, totalDebtMin, savingsTarget, remainder, settings.savingsPct]);

  // Summary stats for header cards
  const statCards = [
    { label: "Monthly Income",    value: income,           color: C.income },
    { label: "Subscriptions",     value: totalSubMonthly,  color: C.subs  },
    { label: "Debt Minimums",     value: totalDebtMin,     color: C.debt  },
    { label: "Savings Target",    value: savingsTarget,    color: C.savings },
  ];

  const hasData = income > 0 && (subscriptions.length > 0 || debts.length > 0);

  // Chart height scales with number of leaf nodes
  const leafCount = (sankeyData?.nodes.filter((n) => n.depth === 3).length ?? 0);
  const chartHeight = Math.max(320, leafCount * 38 + 80);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Reports</h1>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            style={{ borderLeftWidth: 3, borderLeftColor: color }}
          >
            <p className="text-xs text-[var(--color-text-muted)] mb-1">{label}</p>
            <p className="text-xl font-semibold tabular-nums" style={{ color }}>
              {formatCurrency(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Sankey chart */}
      {!hasData ? (
        <Card>
          <CardContent className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
            Add checking transactions and subscriptions to see your paycheck breakdown.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Monthly Paycheck Breakdown</CardTitle>
            <p className="text-xs text-[var(--color-text-muted)]">
              Where your {formatCurrency(income)} monthly income goes — subscriptions, debt minimums, savings target, and discretionary spending.
            </p>
          </CardHeader>
          <CardContent>
            <div style={{ height: chartHeight }}>
              <ResponsiveContainer width="100%" height="100%">
                <Sankey
                  data={sankeyData!}
                  nodeWidth={18}
                  nodePadding={12}
                  iterations={64}
                  margin={{ top: 8, right: 160, bottom: 8, left: 120 }}
                  node={<SankeyNode />}
                  link={<SankeyLink />}
                />
              </ResponsiveContainer>
            </div>
            <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
              Discretionary = income minus known fixed costs &amp; savings target.
              Savings % is set in the Planning tab ({settings.savingsPct}%).
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
