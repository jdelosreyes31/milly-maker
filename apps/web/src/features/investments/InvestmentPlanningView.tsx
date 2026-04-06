import React, { useState, useEffect, useRef } from "react";
import { Bot, AlertTriangle } from "lucide-react";
import Anthropic from "@anthropic-ai/sdk";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, formatCurrency } from "@milly-maker/ui";
import { Link } from "@tanstack/react-router";
import type { InvestmentHolding } from "@/db/queries/investments.js";
import { ASSET_CLASSES } from "@/db/queries/investments.js";

const STORAGE_KEY = "investmentPlanAllocations";

interface StoredPlan {
  cash: string;
  monthlyContribution: string;
  allocations: Record<string, string>;
}

function loadStoredPlan(): StoredPlan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredPlan;
  } catch { /* ignore */ }
  return { cash: "", monthlyContribution: "", allocations: {} };
}

interface Props {
  holdings: InvestmentHolding[];
  totalValue: number;
}

export function InvestmentPlanningView({ holdings, totalValue }: Props) {
  const [cash, setCash] = useState(() => loadStoredPlan().cash);
  const [monthlyContribution, setMonthlyContribution] = useState(() => loadStoredPlan().monthlyContribution);
  const [allocations, setAllocations] = useState<Record<string, string>>(() => loadStoredPlan().allocations);
  const [analysis, setAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analysisEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cash, monthlyContribution, allocations }));
  }, [cash, monthlyContribution, allocations]);

  useEffect(() => {
    if (analysis) {
      analysisEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [analysis]);

  const cashNum = parseFloat(cash) || 0;
  const monthlyNum = parseFloat(monthlyContribution) || 0;
  const newTotal = totalValue + cashNum;

  const rows = holdings.map((h) => {
    const targetPct = parseFloat(allocations[h.id] ?? "") || 0;
    const currentPct = totalValue > 0 ? (h.current_value / totalValue) * 100 : 0;
    const targetValue = newTotal * (targetPct / 100);
    const rawBuy = Math.max(0, targetValue - h.current_value);
    const delta = targetPct - currentPct;
    return { ...h, targetPct, currentPct, rawBuy, delta };
  });

  const totalRawBuy = rows.reduce((s, r) => s + r.rawBuy, 0);
  const scale = cashNum <= 0 ? 0 : totalRawBuy > cashNum ? cashNum / totalRawBuy : 1;
  const rowsWithBuy = rows.map((r) => ({ ...r, buy: r.rawBuy * scale }));
  const totalBuy = rowsWithBuy.reduce((s, r) => s + r.buy, 0);

  const allocationSum = rows.reduce((s, r) => s + r.targetPct, 0);
  const allocationDiff = allocationSum - 100;
  const allocationOk = Math.abs(allocationDiff) < 0.01;

  const hasApiKey = !!localStorage.getItem("anthropicApiKey");

  function setAllocation(id: string, value: string) {
    setAllocations((prev) => ({ ...prev, [id]: value }));
  }

  async function handleAnalyze() {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey) return;
    setAnalyzing(true);
    setAnalysis("");
    setAnalysisError(null);

    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

      const holdingRows = rowsWithBuy
        .map((r) => {
          const status =
            r.delta > 1 ? "UNDERWEIGHT" :
            r.delta < -1 ? "OVERWEIGHT" :
            "AT-WEIGHT";
          const unstarted = r.current_value === 0 && r.targetPct > 0 ? " [UNSTARTED]" : "";
          const ticker = r.ticker ? ` (${r.ticker})` : "";
          const assetLabel = ASSET_CLASSES.find((a) => a.value === r.asset_class)?.label ?? r.asset_class;
          return `| ${r.name}${ticker} | ${assetLabel} | $${r.current_value.toFixed(2)} | ${r.currentPct.toFixed(1)}% | ${r.targetPct.toFixed(1)}% | ${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}% | $${r.buy.toFixed(2)} | ${status}${unstarted} |`;
        })
        .join("\n");

      const unstartedPositions = rowsWithBuy.filter((r) => r.current_value === 0 && r.targetPct > 0);
      const underweightPositions = rowsWithBuy.filter((r) => r.delta > 1);
      const overweightPositions = rowsWithBuy.filter((r) => r.delta < -1);

      const ladderSection =
        monthlyNum > 0
          ? `\n\n**Contribution Ladder — $${monthlyNum.toFixed(2)}/month ($${(monthlyNum * 3).toFixed(2)} per quarter)**\n\nWalk me through 4 quarters (months 1–3, 4–6, 7–9, 10–12). For each quarter, reason about where you would deploy the $${(monthlyNum * 3).toFixed(2)} given how the portfolio has drifted since the initial deploy, which positions still need building, and when to initiate any unstarted positions. Don't just repeat the same allocation each quarter — think about what actually changes your recommendation quarter to quarter, and why.`
          : "";

      const formatList = (items: typeof rowsWithBuy) =>
        items.length > 0
          ? items.map((r) => `${r.name}${r.ticker ? ` (${r.ticker})` : ""} (${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}%)`).join(", ")
          : "None";

      const userMessage =
        `I have $${cashNum.toFixed(2)} to invest today and will contribute $${monthlyNum.toFixed(2)}/month going forward. My total current portfolio value is $${totalValue.toFixed(2)}, and after this deploy it would be $${newTotal.toFixed(2)}.

Here is my immediate investment plan:

| Holding | Asset Class | Current Value | Current % | Target % | Delta | Planned Buy | Status |
|---------|-------------|---------------|-----------|----------|-------|-------------|--------|
${holdingRows}

**Totals:** Current portfolio $${totalValue.toFixed(2)} | Cash to deploy $${cashNum.toFixed(2)} | Total planned buys $${totalBuy.toFixed(2)}

**Underweight (need more capital):** ${formatList(underweightPositions)}
**Overweight (above target):** ${formatList(overweightPositions)}
**Unstarted (no current exposure, target > 0):** ${unstartedPositions.length > 0 ? unstartedPositions.map((r) => `${r.name}${r.ticker ? ` (${r.ticker})` : ""} — target ${r.targetPct}%`).join(", ") : "None"}

Please review this as my portfolio manager. Reason through the plan — not just the arithmetic. For overweight positions, evaluate whether staying overweight is a defensible strategic choice rather than flagging it as wrong by default. For unstarted positions, tell me at what portfolio size or cash deployment level it would make practical sense to initiate each one — consider minimum meaningful lot sizes and whether the timing makes sense given what I'm building.${ladderSection}`;

      const systemPrompt =
        `You are a seasoned portfolio manager conducting a full investment plan review. You have the user's complete current holdings, their target allocation, and the cash they intend to deploy. Your job is to reason through this plan the way a CFA would — not just validate the arithmetic.

Consider whether each position is underweight or overweight relative to target, whether the planned buys meaningfully close the gap, and whether going overweight on a specific name or asset class could be a valid strategic choice. A conviction overweight is not automatically wrong — evaluate it on its merits. Flag fractional-share situations as a practical note, not a veto. If a planned buy is too small to meaningfully move the needle, say so specifically.

For unstarted positions (zero current exposure, target > 0), reason about entry timing: at what portfolio size, cash level, or quarter does it make sense to initiate the position? Factor in lot sizes, the position's target weight, and how it fits the overall build.

If monthly contributions are provided, produce a 3-month-interval ladder for 4 quarters. For each quarter, reason about portfolio drift since the initial deploy — what's still underweight, what's shifted, and when to pull the trigger on unstarted positions. Your quarterly recommendations should evolve, not just repeat the same instruction.

Be direct, opinionated, and specific. Reference actual tickers, dollar amounts, and percentage deltas. Don't hedge excessively.`;

      let text = "";

      const stream = await client.messages.stream({
        model: "claude-opus-4-6",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          text += chunk.delta.text;
          setAnalysis(text);
        }
      }
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Inputs ── */}
      <Card>
        <CardHeader>
          <CardTitle>Deploy & Contributions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Cash to invest ($)"
              type="number"
              min="0"
              step="0.01"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              placeholder="0.00"
            />
            <Input
              label="Monthly contribution ($)"
              type="number"
              min="0"
              step="0.01"
              value={monthlyContribution}
              onChange={(e) => setMonthlyContribution(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Allocation table ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Target Allocations</CardTitle>
            <div className="flex items-center gap-2">
              {allocationSum > 0 && !allocationOk && (
                <span className="flex items-center gap-1 text-xs text-[var(--color-warning)]">
                  <AlertTriangle size={12} />
                  {allocationSum.toFixed(1)}% / 100%{" "}
                  ({allocationDiff > 0 ? "+" : ""}{allocationDiff.toFixed(1)}%)
                </span>
              )}
              {allocationOk && allocationSum > 0 && (
                <span className="text-xs text-[var(--color-success)]">100% ✓</span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                <th className="px-4 py-2">Holding</th>
                <th className="py-2 text-right">Current</th>
                <th className="py-2 text-right">Current %</th>
                <th className="py-2 text-right">Target %</th>
                <th className="py-2 text-right">Delta</th>
                <th className="py-2 pr-4 text-right">Buy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {rowsWithBuy.map((r) => {
                const isUnstarted = r.current_value === 0 && r.targetPct > 0;
                const isUnderweight = r.delta > 1;
                const isOverweight = r.delta < -1;
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">
                        {r.name}
                        {isUnstarted && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-warning)]">
                            Unstarted
                          </span>
                        )}
                      </p>
                      {r.ticker && (
                        <p className="font-mono text-xs text-[var(--color-text-muted)]">{r.ticker}</p>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {formatCurrency(r.current_value, true)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">
                      {r.currentPct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 text-right">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={allocations[r.id] ?? ""}
                        onChange={(e) => setAllocation(r.id, e.target.value)}
                        placeholder="0"
                        className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 text-right text-sm tabular-nums focus:border-[var(--color-primary)] focus:outline-none"
                      />
                    </td>
                    <td
                      className={`py-2.5 text-right tabular-nums text-xs font-medium ${
                        isUnderweight
                          ? "text-[var(--color-warning)]"
                          : isOverweight
                          ? "text-[var(--color-danger)]"
                          : "text-[var(--color-text-muted)]"
                      }`}
                    >
                      {r.targetPct > 0
                        ? `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums font-medium text-[var(--color-success)]">
                      {r.buy >= 1 ? formatCurrency(r.buy) : "$0.00"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface-raised)]">
                <td
                  colSpan={5}
                  className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]"
                >
                  Total buys
                </td>
                <td className="py-2 pr-4 text-right tabular-nums font-semibold text-[var(--color-success)]">
                  {formatCurrency(totalBuy)}
                </td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {/* ── Analyze ── */}
      <div className="flex flex-col gap-4">
        {!hasApiKey ? (
          <div className="rounded-[var(--radius-sm)] bg-[var(--color-warning)]/10 p-4 text-sm">
            <p className="mb-1 font-medium text-[var(--color-warning)]">API key required</p>
            <p className="text-[var(--color-text-muted)]">
              Add your Anthropic API key in{" "}
              <Link
                to="/settings"
                className="text-[var(--color-primary)] underline underline-offset-2"
              >
                Settings
              </Link>{" "}
              to enable portfolio analysis.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={handleAnalyze}
              disabled={analyzing || !allocationOk || holdings.length === 0}
            >
              <Bot size={14} />
              {analyzing ? "Analyzing…" : "Analyze with Claude"}
            </Button>
            {!allocationOk && allocationSum > 0 && (
              <span className="text-xs text-[var(--color-text-muted)]">
                Allocations must sum to 100% before analyzing
              </span>
            )}
          </div>
        )}

        {analysisError && (
          <div className="rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
            {analysisError}
          </div>
        )}

        {(analysis || analyzing) && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bot size={14} className="text-[var(--color-primary)]" />
                <CardTitle>Portfolio Analysis</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {analysis ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">
                  {analysis}
                </p>
              ) : (
                <span className="inline-flex gap-1 text-[var(--color-text-muted)]">
                  <span className="animate-bounce">·</span>
                  <span className="animate-bounce [animation-delay:0.1s]">·</span>
                  <span className="animate-bounce [animation-delay:0.2s]">·</span>
                </span>
              )}
              <div ref={analysisEndRef} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
