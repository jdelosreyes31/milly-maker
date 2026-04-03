import React, { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, formatCurrency } from "@milly-maker/ui";
import { useDb } from "@/db/hooks/useDb.js";
import { useSubscriptions } from "@/db/hooks/useSubscriptions.js";
import { useDebts } from "@/db/hooks/useDebts.js";
import { getMonthlyCreditTotals } from "@/db/queries/checking.js";
import { loadPlanningSettings } from "@/features/planning/PlanningPage.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FlowCategory {
  name: string;
  amount: number;
  color: string;
  pct: number; // % of income
}

// ── Custom Sankey SVG ─────────────────────────────────────────────────────────

function PaycheckSankey({
  income,
  categories,
}: {
  income: number;
  categories: FlowCategory[];
}) {
  const H = 300;
  const leftX = 0;
  const leftW = 56;
  const rightX = 300;
  const rightW = 56;
  const viewW = rightX + rightW + 180; // extra room for labels

  // Stack right-side segments proportionally
  let cursor = 0;
  const segs = categories.map((cat) => {
    const h = income > 0 ? Math.max((cat.amount / income) * H, cat.amount > 0 ? 4 : 0) : 0;
    const seg = { ...cat, y: cursor, h };
    cursor += h;
    return seg;
  });

  // Left side mirrors same stacking (no crossing paths)
  let leftCursor = 0;
  const paths = segs.map((seg) => {
    const lh = seg.h;
    const ly = leftCursor;
    leftCursor += lh;

    if (seg.h < 1) return null;

    const x1 = leftX + leftW;
    const x2 = rightX;
    const cx = (x1 + x2) / 2;

    return {
      d: [
        `M ${x1} ${ly}`,
        `C ${cx} ${ly}, ${cx} ${seg.y}, ${x2} ${seg.y}`,
        `L ${x2} ${seg.y + seg.h}`,
        `C ${cx} ${seg.y + seg.h}, ${cx} ${ly + lh}, ${x1} ${ly + lh}`,
        `Z`,
      ].join(" "),
      color: seg.color,
      name: seg.name,
      amount: seg.amount,
      pct: seg.pct,
      midY: seg.y + seg.h / 2,
    };
  });

  return (
    <svg
      viewBox={`0 0 ${viewW} ${H}`}
      className="w-full"
      style={{ maxHeight: 320, overflow: "visible" }}
    >
      {/* Left: Paycheck column */}
      <rect x={leftX} y={0} width={leftW} height={H} fill="#a85c2e" rx={4} />
      <text
        x={leftX + leftW / 2}
        y={H / 2 - 8}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#fdf8f2"
        fontSize={10}
        fontFamily="Lora, serif"
        fontWeight="500"
      >
        Paycheck
      </text>
      <text
        x={leftX + leftW / 2}
        y={H / 2 + 8}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#fdf8f2"
        fontSize={9}
        fontFamily="DM Mono, monospace"
      >
        {income > 0 ? formatCurrency(income) : "—"}
      </text>

      {/* Flow paths */}
      {paths.map(
        (p, i) =>
          p && (
            <path
              key={i}
              d={p.d}
              fill={p.color}
              opacity={0.35}
            />
          )
      )}

      {/* Right: Category columns */}
      {segs.map((seg, i) =>
        seg.h >= 1 ? (
          <rect
            key={i}
            x={rightX}
            y={seg.y}
            width={rightW}
            height={seg.h}
            fill={seg.color}
            rx={2}
          />
        ) : null
      )}

      {/* Right labels */}
      {paths.map(
        (p, i) =>
          p && segs[i]!.h >= 8 && (
            <g key={i}>
              <text
                x={rightX + rightW + 10}
                y={p.midY - 5}
                dominantBaseline="middle"
                fill="#28200e"
                fontSize={10}
                fontFamily="Lora, serif"
              >
                {p.name}
              </text>
              <text
                x={rightX + rightW + 10}
                y={p.midY + 7}
                dominantBaseline="middle"
                fill="#7a6850"
                fontSize={9}
                fontFamily="DM Mono, monospace"
              >
                {formatCurrency(p.amount)}{" "}
                <tspan fill="#a89878">({p.pct.toFixed(0)}%)</tspan>
              </text>
            </g>
          )
      )}
    </svg>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const { conn } = useDb();
  const { totalMonthly: subTotal } = useSubscriptions();
  const { totalMinPayment: debtMin } = useDebts();
  const [monthlyCredits, setMonthlyCredits] = useState<{ month: string; total: number }[]>([]);

  useEffect(() => {
    if (!conn) return;
    void getMonthlyCreditTotals(conn).then(setMonthlyCredits);
  }, [conn]);

  const settings = useMemo(() => loadPlanningSettings(), []);

  const autoIncome = useMemo(() => {
    const last3 = monthlyCredits.slice(-3);
    if (last3.length === 0) return 0;
    return Math.round(last3.reduce((s, c) => s + c.total, 0) / last3.length);
  }, [monthlyCredits]);

  const income = settings.incomeOverride ?? autoIncome;

  // After fixed costs, split the remainder using planning percentages
  const fixed = subTotal + debtMin;
  const remaining = Math.max(0, income - fixed);
  const totalPct = settings.needsPct + settings.wantsPct + settings.savingsPct;
  const safePct = totalPct > 0 ? totalPct : 100;

  const savingsAmt  = Math.round((remaining * settings.savingsPct) / safePct);
  const needsAmt    = Math.round((remaining * settings.needsPct)   / safePct);
  const wantsAmt    = Math.round((remaining * settings.wantsPct)   / safePct);
  const unallocated = Math.max(0, remaining - savingsAmt - needsAmt - wantsAmt);

  const categories: FlowCategory[] = [
    { name: "Subscriptions",  amount: subTotal,    color: "#a84040", pct: income > 0 ? (subTotal / income) * 100 : 0 },
    { name: "Debt Minimums",  amount: debtMin,     color: "#7a5090", pct: income > 0 ? (debtMin  / income) * 100 : 0 },
    { name: "Savings",        amount: savingsAmt,  color: "#597a38", pct: income > 0 ? (savingsAmt  / income) * 100 : 0 },
    { name: "Needs",          amount: needsAmt,    color: "#3a688a", pct: income > 0 ? (needsAmt    / income) * 100 : 0 },
    { name: "Wants",          amount: wantsAmt,    color: "#b08828", pct: income > 0 ? (wantsAmt    / income) * 100 : 0 },
    ...(unallocated > 0
      ? [{ name: "Unallocated", amount: unallocated, color: "#a89878", pct: income > 0 ? (unallocated / income) * 100 : 0 }]
      : []),
  ].filter((c) => c.amount > 0);

  const hasData = income > 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Reports</h1>

      {/* Paycheck Flow */}
      <Card>
        <CardHeader>
          <CardTitle>Paycheck Flow</CardTitle>
          <p className="text-xs text-[var(--color-text-muted)]">
            Where each dollar goes — fixed costs deducted first, remainder split by your planning percentages.
            {settings.incomeOverride !== null
              ? " Using manual income override."
              : " Income auto-detected from last 3 months of credits."}
          </p>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
              Add income credits in Checking (or set a manual override in Planning) to see your paycheck flow.
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <PaycheckSankey income={income} categories={categories} />

              {/* Breakdown table */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                    <th className="pb-2 font-medium">Category</th>
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium text-right">Amount / mo</th>
                    <th className="pb-2 font-medium text-right">% of income</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((cat) => (
                    <tr key={cat.name} className="border-b border-[var(--color-border-subtle)] last:border-0">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                          {cat.name}
                        </div>
                      </td>
                      <td className="py-2.5 text-[var(--color-text-muted)]">
                        {cat.name === "Subscriptions" || cat.name === "Debt Minimums"
                          ? "Fixed"
                          : cat.name === "Unallocated"
                          ? "Buffer"
                          : "Discretionary"}
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-medium">
                        {formatCurrency(cat.amount)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">
                        {cat.pct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr className="border-t-2 border-[var(--color-border)]">
                    <td className="pt-3 font-semibold" colSpan={2}>Total</td>
                    <td className="pt-3 text-right tabular-nums font-semibold">
                      {formatCurrency(income)}
                    </td>
                    <td className="pt-3 text-right tabular-nums text-[var(--color-text-muted)]">
                      100%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
