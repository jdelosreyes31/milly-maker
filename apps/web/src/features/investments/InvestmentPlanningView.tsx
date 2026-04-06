import React, { useState, useEffect, useRef } from "react";
import { Bot, AlertTriangle, Plus, Trash2, TrendingUp, Wallet } from "lucide-react";
import Anthropic from "@anthropic-ai/sdk";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, formatCurrency } from "@milly-maker/ui";
import { Link } from "@tanstack/react-router";
import type { InvestmentHolding } from "@/db/queries/investments.js";
import { ASSET_CLASSES } from "@/db/queries/investments.js";
import { nanoid } from "@/lib/nanoid.js";

// ── Planned holding (localStorage only, never in DB) ──────────────────────────

interface PlannedHolding {
  id: string;
  name: string;
  ticker: string;
  asset_class: string;
}

const PLAN_STORAGE_KEY = "investmentPlanAllocations";
const PLANNED_HOLDINGS_KEY = "investmentPlanHoldings";

interface StoredPlan {
  cash: string;
  monthlyContribution: string;
  allocations: Record<string, string>;
}

function loadStoredPlan(): StoredPlan {
  try {
    const raw = localStorage.getItem(PLAN_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredPlan;
  } catch { /* ignore */ }
  return { cash: "", monthlyContribution: "", allocations: {} };
}

function loadPlannedHoldings(): PlannedHolding[] {
  try {
    const raw = localStorage.getItem(PLANNED_HOLDINGS_KEY);
    if (raw) return JSON.parse(raw) as PlannedHolding[];
  } catch { /* ignore */ }
  return [];
}

// ── Unified row type ──────────────────────────────────────────────────────────

type PlanRow =
  | (InvestmentHolding & { isPlanned: false })
  | (PlannedHolding & { current_value: 0; isPlanned: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function StreamingCard({
  icon, title, content, streaming, error, endRef,
}: {
  icon: React.ReactNode;
  title: string;
  content: string;
  streaming: boolean;
  error: string | null;
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div className="rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}
      {(content || streaming) && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              {icon}
              <CardTitle>{title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {content ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">
                {content}
              </p>
            ) : (
              <span className="inline-flex gap-1 text-[var(--color-text-muted)]">
                <span className="animate-bounce">·</span>
                <span className="animate-bounce [animation-delay:0.1s]">·</span>
                <span className="animate-bounce [animation-delay:0.2s]">·</span>
              </span>
            )}
            <div ref={endRef} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  holdings: InvestmentHolding[];
  totalValue: number;
  cashAccountsTotal: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InvestmentPlanningView({ holdings, totalValue, cashAccountsTotal }: Props) {
  const [cash, setCash] = useState<string>(
    () => loadStoredPlan().cash || (cashAccountsTotal > 0 ? String(cashAccountsTotal) : "")
  );
  const [monthlyContribution, setMonthlyContribution] = useState<string>(
    () => loadStoredPlan().monthlyContribution
  );
  const [allocations, setAllocations] = useState<Record<string, string>>(
    () => loadStoredPlan().allocations
  );
  const [plannedHoldings, setPlannedHoldings] = useState<PlannedHolding[]>(loadPlannedHoldings);

  // Add planned holding form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTicker, setNewTicker] = useState("");
  const [newAssetClass, setNewAssetClass] = useState("stocks");
  const [nameError, setNameError] = useState("");

  // "Analyze with Claude" — portfolio thesis
  const [thesis, setThesis] = useState("");
  const [analyzingThesis, setAnalyzingThesis] = useState(false);
  const [thesisError, setThesisError] = useState<string | null>(null);
  const thesisEndRef = useRef<HTMLDivElement>(null);

  // "Invest with Claude" — deployment plan
  const [investPlan, setInvestPlan] = useState("");
  const [analyzingPlan, setAnalyzingPlan] = useState(false);
  const [investPlanError, setInvestPlanError] = useState<string | null>(null);
  const investPlanEndRef = useRef<HTMLDivElement>(null);

  // Persist plan inputs
  useEffect(() => {
    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ cash, monthlyContribution, allocations }));
  }, [cash, monthlyContribution, allocations]);

  // Persist planned holdings
  useEffect(() => {
    localStorage.setItem(PLANNED_HOLDINGS_KEY, JSON.stringify(plannedHoldings));
  }, [plannedHoldings]);

  useEffect(() => {
    if (thesis) thesisEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thesis]);

  useEffect(() => {
    if (investPlan) investPlanEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [investPlan]);

  // ── Unified row list ────────────────────────────────────────────────────────

  const allRows: PlanRow[] = [
    ...holdings.map((h) => ({ ...h, isPlanned: false as const })),
    ...plannedHoldings.map((p) => ({ ...p, current_value: 0 as const, isPlanned: true as const })),
  ];

  // ── Buy math ────────────────────────────────────────────────────────────────

  const cashNum = parseFloat(cash) || 0;
  const monthlyNum = parseFloat(monthlyContribution) || 0;
  const newTotal = totalValue + cashNum;

  const rows = allRows.map((r) => {
    const targetPct = parseFloat(allocations[r.id] ?? "") || 0;
    const currentPct = totalValue > 0 ? (r.current_value / totalValue) * 100 : 0;
    const targetValue = newTotal * (targetPct / 100);
    const rawBuy = Math.max(0, targetValue - r.current_value);
    const delta = targetPct - currentPct;
    return { ...r, targetPct, currentPct, rawBuy, delta };
  });

  const totalRawBuy = rows.reduce((s, r) => s + r.rawBuy, 0);
  const scale = cashNum <= 0 ? 0 : totalRawBuy > cashNum ? cashNum / totalRawBuy : 1;
  const rowsWithBuy = rows.map((r) => ({ ...r, buy: r.rawBuy * scale }));
  const totalBuy = rowsWithBuy.reduce((s, r) => s + r.buy, 0);

  const allocationSum = rows.reduce((s, r) => s + r.targetPct, 0);
  const allocationDiff = allocationSum - 100;
  const allocationOk = Math.abs(allocationDiff) < 0.01;

  const hasApiKey = !!localStorage.getItem("anthropicApiKey");

  // ── Shared prompt utilities ─────────────────────────────────────────────────

  function buildClient() {
    const apiKey = localStorage.getItem("anthropicApiKey")!;
    return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  function buildHoldingsTable() {
    return allRows
      .map((r) => {
        const targetPct = parseFloat(allocations[r.id] ?? "") || 0;
        const currentPct = totalValue > 0 ? (r.current_value / totalValue) * 100 : 0;
        const planned = r.isPlanned ? " [PLANNED]" : "";
        const ticker = r.ticker ? ` (${r.ticker})` : "";
        const assetLabel = ASSET_CLASSES.find((a) => a.value === r.asset_class)?.label ?? r.asset_class;
        return `| ${r.name}${ticker} | ${assetLabel} | $${r.current_value.toFixed(2)} | ${currentPct.toFixed(1)}% | ${targetPct.toFixed(1)}%${planned} |`;
      })
      .join("\n");
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  function setAllocation(id: string, value: string) {
    setAllocations((prev) => ({ ...prev, [id]: value }));
  }

  function handleAddPlanned() {
    if (!newName.trim()) { setNameError("Name required"); return; }
    const holding: PlannedHolding = {
      id: nanoid(),
      name: newName.trim(),
      ticker: newTicker.trim(),
      asset_class: newAssetClass,
    };
    setPlannedHoldings((prev) => [...prev, holding]);
    setNewName("");
    setNewTicker("");
    setNewAssetClass("stocks");
    setNameError("");
    setShowAddForm(false);
  }

  function handleDeletePlanned(id: string) {
    setPlannedHoldings((prev) => prev.filter((p) => p.id !== id));
    setAllocations((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  // ── "Analyze with Claude" — portfolio thesis ────────────────────────────────

  async function handlePortfolioThesis() {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey) return;
    setAnalyzingThesis(true);
    setThesis("");
    setThesisError(null);

    try {
      const client = buildClient();

      const holdingsTable = buildHoldingsTable();

      const userMessage =
        `Here is my current portfolio along with my target allocation. Rows marked [PLANNED] are positions I intend to build but don't yet own.

**Portfolio value:** $${totalValue.toFixed(2)}

| Holding | Asset Class | Current Value | Current % | Target % |
|---------|-------------|---------------|-----------|----------|
${holdingsTable}

Read this portfolio as a macro strategist would. What economic thesis or theses does this allocation represent? What bets am I making against the broader economy, interest rates, sector rotation, or market structure? Are those bets coherent with each other, or do any positions work against each other? What am I implicitly betting on that I might not realize? What's missing given the thesis — are there obvious hedges, diversifiers, or complementary positions I haven't included? Call out any concentration risks or uncompensated exposures.`;

      const systemPrompt =
        `You are a macro strategist and portfolio analyst. The investor is 33 years old targeting moderate-to-aggressive growth over a 7-year horizon to age 40. They have a small floor income provider — enough to cover basic living expenses — which means they can tolerate meaningful volatility and drawdowns but cannot afford a complete wipeout of liquid investment assets.

Your job is not to review mechanics or diversification for its own sake. Read this portfolio the way a global macro fund manager would: identify the underlying economic bets, whether the positions are internally consistent, and whether the overall thesis makes sense for someone with this profile and timeline.

Be specific. Name the theses. Reference actual positions. If you see a portfolio that's implicitly betting on AI infrastructure dominance, say so and name which holdings represent that bet. If there's a contradictory position hedging against what the rest of the portfolio is saying, call it out. If the portfolio is missing something obvious given its stated thesis, name it.

[PLANNED] positions are future intentions — include them in your thesis read but note they're not yet owned.`;

      let text = "";
      const stream = await client.messages.stream({
        model: "claude-opus-4-6",
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          text += chunk.delta.text;
          setThesis(text);
        }
      }
    } catch (err) {
      setThesisError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzingThesis(false);
    }
  }

  // ── "Invest with Claude" — deployment plan ──────────────────────────────────

  async function handleInvestPlan() {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey) return;
    setAnalyzingPlan(true);
    setInvestPlan("");
    setInvestPlanError(null);

    try {
      const client = buildClient();

      const holdingRows = rowsWithBuy
        .map((r) => {
          const status =
            r.delta > 1 ? "UNDERWEIGHT" :
            r.delta < -1 ? "OVERWEIGHT" :
            "AT-WEIGHT";
          const unstarted = r.current_value === 0 && r.targetPct > 0 ? " [UNSTARTED]" : "";
          const planned = r.isPlanned ? " [PLANNED]" : "";
          const doNotBuy =
            r.buy > 0 && (r.buy < 50 || (newTotal > 0 && r.buy / newTotal < 0.005))
              ? " [DO NOT BUY — size too small]"
              : "";
          const ticker = r.ticker ? ` (${r.ticker})` : "";
          const assetLabel = ASSET_CLASSES.find((a) => a.value === r.asset_class)?.label ?? r.asset_class;
          return `| ${r.name}${ticker} | ${assetLabel} | $${r.current_value.toFixed(2)} | ${r.currentPct.toFixed(1)}% | ${r.targetPct.toFixed(1)}% | ${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}% | $${r.buy.toFixed(2)} | ${status}${unstarted}${planned}${doNotBuy} |`;
        })
        .join("\n");

      const unstartedPositions = rowsWithBuy.filter((r) => r.current_value === 0 && r.targetPct > 0);
      const underweightPositions = rowsWithBuy.filter((r) => r.delta > 1 && r.current_value > 0);
      const overweightPositions = rowsWithBuy.filter((r) => r.delta < -1);
      const doNotBuyPositions = rowsWithBuy.filter(
        (r) => r.buy > 0 && (r.buy < 50 || (newTotal > 0 && r.buy / newTotal < 0.005))
      );

      const ladderSection =
        monthlyNum > 0
          ? `\n\n**Contribution Ladder — $${monthlyNum.toFixed(2)}/month ($${(monthlyNum * 3).toFixed(2)} per quarter)**\n\nWalk me through 4 quarters (months 1–3, 4–6, 7–9, 10–12). For each quarter, reason about where to deploy the $${(monthlyNum * 3).toFixed(2)} given portfolio drift since the initial deploy, which positions still need building, and when to initiate unstarted or planned positions. Evolve your recommendation quarter to quarter — don't repeat the same instruction.`
          : "";

      const formatList = (items: typeof rowsWithBuy) =>
        items.length > 0
          ? items.map((r) => `${r.name}${r.ticker ? ` (${r.ticker})` : ""} (${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}%)`).join(", ")
          : "None";

      const userMessage =
        `I have $${cashNum.toFixed(2)} to invest today and will contribute $${monthlyNum.toFixed(2)}/month going forward. My total current portfolio value is $${totalValue.toFixed(2)}, and after this deploy it would be $${newTotal.toFixed(2)}.

Rows marked [PLANNED] are future positions I intend to build. Rows marked [DO NOT BUY — size too small] have a computed buy that is either under $50 or under 0.5% of the post-deploy total — address each one explicitly.

| Holding | Asset Class | Current Value | Current % | Target % | Delta | Planned Buy | Status |
|---------|-------------|---------------|-----------|----------|-------|-------------|--------|
${holdingRows}

**Totals:** Portfolio $${totalValue.toFixed(2)} | Cash to deploy $${cashNum.toFixed(2)} | Total planned buys $${totalBuy.toFixed(2)}
**Underweight:** ${formatList(underweightPositions)}
**Overweight:** ${formatList(overweightPositions)}
**Unstarted / planned:** ${unstartedPositions.length > 0 ? unstartedPositions.map((r) => `${r.name}${r.ticker ? ` (${r.ticker})` : ""}${r.isPlanned ? " [planned]" : ""} — target ${r.targetPct}%`).join(", ") : "None"}
**Do Not Buy (size too small):** ${doNotBuyPositions.length > 0 ? doNotBuyPositions.map((r) => `${r.name} ($${r.buy.toFixed(2)})`).join(", ") : "None"}

Review this as my portfolio manager. Evaluate overweight positions as possible strategic choices, not automatic problems. For unstarted and planned positions, tell me at what portfolio size or cash level it makes sense to initiate them. For DO NOT BUY positions, tell me whether to defer, consolidate, or remove them from the plan.${ladderSection}`;

      const systemPrompt =
        `You are a seasoned portfolio manager reviewing an investment deployment plan. You have the user's current holdings, planned future positions, target allocations, and the cash they intend to deploy today. Reason through this the way a CFA would — not just arithmetic.

Evaluate whether planned buys meaningfully close allocation gaps. A conviction overweight is not automatically wrong — assess it strategically. For positions the user hasn't yet started (UNSTARTED or PLANNED), reason about entry timing: portfolio size, cash level, and fit with the overall build strategy.

Positions flagged [DO NOT BUY — size too small] must be addressed explicitly: for each, recommend whether to defer until the portfolio is larger, consolidate into a related position, or remove from the plan entirely.

If monthly contributions are provided, produce a 3-month-interval ladder for 4 quarters. Each quarter's recommendation should evolve — reason about drift, priority shifts, and when to pull the trigger on new positions.

Be direct, opinionated, specific. Reference tickers, dollar amounts, and percentage deltas.`;

      let text = "";
      const stream = await client.messages.stream({
        model: "claude-opus-4-6",
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          text += chunk.delta.text;
          setInvestPlan(text);
        }
      }
    } catch (err) {
      setInvestPlanError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzingPlan(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

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
              label={cashAccountsTotal > 0 ? "Cash to invest ($) — synced from Cash Account" : "Cash to invest ($)"}
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
                const isTooSmall =
                  r.buy > 0 && (r.buy < 50 || (newTotal > 0 && r.buy / newTotal < 0.005));
                return (
                  <tr key={r.id} className="group">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {r.name}
                            {isUnstarted && (
                              <span className="ml-2 inline-flex items-center rounded-full bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-warning)]">
                                {r.isPlanned ? "Planned" : "Unstarted"}
                              </span>
                            )}
                            {isTooSmall && (
                              <span className="ml-2 inline-flex items-center rounded-full bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-danger)]">
                                too small
                              </span>
                            )}
                          </p>
                          {r.ticker && (
                            <p className="font-mono text-xs text-[var(--color-text-muted)]">{r.ticker}</p>
                          )}
                        </div>
                        {r.isPlanned && (
                          <button
                            onClick={() => handleDeletePlanned(r.id)}
                            className="ml-auto shrink-0 rounded p-1 text-[var(--color-text-subtle)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-danger)] transition-opacity"
                            title="Remove planned holding"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
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
                    <td className={`py-2.5 pr-4 text-right tabular-nums font-medium ${isTooSmall ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>
                      {r.buy >= 1 ? formatCurrency(r.buy) : "$0.00"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface-raised)]">
                <td colSpan={5} className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                  Total buys
                </td>
                <td className="py-2 pr-4 text-right tabular-nums font-semibold text-[var(--color-success)]">
                  {formatCurrency(totalBuy)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Add planned holding */}
          <div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
            {!showAddForm ? (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1.5 text-xs text-[var(--color-primary)] hover:underline"
              >
                <Plus size={12} /> Add planned holding
              </button>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-32">
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => { setNewName(e.target.value); setNameError(""); }}
                    placeholder="e.g. Nvidia"
                    className={`w-full rounded border px-2 py-1 text-sm focus:outline-none focus:border-[var(--color-primary)] ${
                      nameError ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"
                    } bg-[var(--color-surface-raised)]`}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddPlanned(); }}
                    autoFocus
                  />
                  {nameError && <p className="mt-0.5 text-xs text-[var(--color-danger)]">{nameError}</p>}
                </div>
                <div className="w-24">
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Ticker</label>
                  <input
                    type="text"
                    value={newTicker}
                    onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                    placeholder="NVDA"
                    className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-sm focus:border-[var(--color-primary)] focus:outline-none"
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddPlanned(); }}
                  />
                </div>
                <div className="w-36">
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Asset class</label>
                  <select
                    value={newAssetClass}
                    onChange={(e) => setNewAssetClass(e.target.value)}
                    className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm focus:border-[var(--color-primary)] focus:outline-none"
                  >
                    {ASSET_CLASSES.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={handleAddPlanned}>Add</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setShowAddForm(false); setNewName(""); setNewTicker(""); setNameError(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Actions + output cards ── */}
      {!hasApiKey ? (
        <div className="rounded-[var(--radius-sm)] bg-[var(--color-warning)]/10 p-4 text-sm">
          <p className="mb-1 font-medium text-[var(--color-warning)]">API key required</p>
          <p className="text-[var(--color-text-muted)]">
            Add your Anthropic API key in{" "}
            <Link to="/settings" className="text-[var(--color-primary)] underline underline-offset-2">
              Settings
            </Link>{" "}
            to enable analysis.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePortfolioThesis}
              disabled={analyzingThesis || allRows.length === 0}
            >
              <TrendingUp size={14} />
              {analyzingThesis ? "Analyzing…" : "Analyze with Claude"}
            </Button>
            <Button
              size="sm"
              onClick={handleInvestPlan}
              disabled={analyzingPlan || !allocationOk || allRows.length === 0}
            >
              <Wallet size={14} />
              {analyzingPlan ? "Planning…" : "Invest with Claude"}
            </Button>
            {!allocationOk && allocationSum > 0 && (
              <span className="text-xs text-[var(--color-text-muted)]">
                Allocations must sum to 100% for Invest
              </span>
            )}
          </div>

          <StreamingCard
            icon={<TrendingUp size={14} className="text-[var(--color-primary)]" />}
            title="Portfolio Thesis"
            content={thesis}
            streaming={analyzingThesis}
            error={thesisError}
            endRef={thesisEndRef}
          />

          <StreamingCard
            icon={<Wallet size={14} className="text-[var(--color-primary)]" />}
            title="Investment Plan"
            content={investPlan}
            streaming={analyzingPlan}
            error={investPlanError}
            endRef={investPlanEndRef}
          />
        </div>
      )}
    </div>
  );
}
