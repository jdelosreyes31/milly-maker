import React, { useState, useEffect, useRef } from "react";
import { Bot, AlertTriangle, Plus, Trash2, TrendingUp, Wallet, Users, BarChart3, Globe2, Zap, Download } from "lucide-react";
import Anthropic from "@anthropic-ai/sdk";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, formatCurrency } from "@milly-maker/ui";
import { Link } from "@tanstack/react-router";
import type { InvestmentHolding } from "@/db/queries/investments.js";
import { ASSET_CLASSES } from "@/db/queries/investments.js";
import { nanoid } from "@/lib/nanoid.js";

// ── Model options ─────────────────────────────────────────────────────────────

const CLAUDE_MODELS = [
  { value: "claude-sonnet-4-5", label: "Sonnet", description: "Faster · recommended" },
  { value: "claude-opus-4-6",   label: "Opus",   description: "Most capable · slower" },
] as const;

type ClaudeModel = typeof CLAUDE_MODELS[number]["value"];

// ── Planned holding (localStorage only, never in DB) ──────────────────────────

interface PlannedHolding {
  id: string;
  name: string;
  ticker: string;
  asset_class: string;
  plannedValue?: number;
  pricePerShare?: number;
}

const PLAN_STORAGE_KEY = "investmentPlanAllocations";
const PLANNED_HOLDINGS_KEY = "investmentPlanHoldings";

interface StoredPlan {
  cash: string;
  monthlyContribution: string;
  allocations: Record<string, string>;
  notes: string;
  aggressiveContribution: boolean;
  model: ClaudeModel;
}

function loadStoredPlan(): StoredPlan {
  try {
    const raw = localStorage.getItem(PLAN_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredPlan;
  } catch { /* ignore */ }
  return { cash: "", monthlyContribution: "", allocations: {}, notes: "", aggressiveContribution: false, model: "claude-sonnet-4-5" };
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
  | (PlannedHolding & { current_value: number; isPlanned: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

interface PromptPayload { system: string; user: string }

// ── Asset class expected return proxies (for Growth strategy weighting) ─────────

const ASSET_CLASS_RETURNS: Record<string, number> = {
  stocks:               0.10,
  international_stocks: 0.09,
  real_estate:          0.08,
  crypto:               0.15,
  commodities:          0.06,
  bonds:                0.045,
  cash:                 0.025,
  other:                0.07,
};

// ── Deploy allocation result ──────────────────────────────────────────────────

interface DeployAllocation {
  id: string;
  name: string;
  ticker: string;
  assetClass: string;
  currentValue: number;
  currentPct: number;
  targetPct: number;
  allocation: number;   // $ deployed here
  sharePct: number;     // % of total cash
  newValue: number;
  newPct: number;
  tag: "target-split" | "gap-fill" | "return-weighted" | "floor" | "skipped";
}

// ── Optimization result (computed from Claude's structured output) ─────────────

interface OptimizationResult {
  label: string;
  summary: string;
  adjustedItems: { id: string; name: string; ticker: string; targetPct: number }[];
  quarterlySnapshots: { quarter: number; totalValue: number; weights: number[] }[];
  convergedQuarter: number | null;
  originalConvergedQuarter: number | null;
}

function StreamingCard({
  icon, title, content, streaming, error, endRef, promptPayload,
}: {
  icon: React.ReactNode;
  title: string;
  content: string;
  streaming: boolean;
  error: string | null;
  endRef: React.RefObject<HTMLDivElement | null>;
  promptPayload?: PromptPayload;
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
              <div className="prose-sm">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="mb-3 mt-5 text-base font-semibold text-[var(--color-text)] first:mt-0">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="mb-2 mt-4 text-sm font-semibold text-[var(--color-text)] first:mt-0">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="mb-1.5 mt-3 text-sm font-medium text-[var(--color-text)] first:mt-0">{children}</h3>
                    ),
                    p: ({ children }) => (
                      <p className="mb-3 text-sm leading-relaxed text-[var(--color-text)] last:mb-0">{children}</p>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold text-[var(--color-text)]">{children}</strong>
                    ),
                    em: ({ children }) => (
                      <em className="italic text-[var(--color-text-muted)]">{children}</em>
                    ),
                    ul: ({ children }) => (
                      <ul className="mb-3 ml-4 list-disc space-y-1 text-sm text-[var(--color-text)] last:mb-0">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm text-[var(--color-text)] last:mb-0">{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li className="leading-relaxed">{children}</li>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="mb-3 border-l-2 border-[var(--color-border)] pl-3 italic text-[var(--color-text-muted)]">{children}</blockquote>
                    ),
                    code: ({ children, className }) => {
                      const isBlock = className?.includes("language-");
                      return isBlock ? (
                        <code className="block overflow-x-auto rounded bg-[var(--color-surface-raised)] p-3 font-mono text-xs text-[var(--color-text)]">{children}</code>
                      ) : (
                        <code className="rounded bg-[var(--color-surface-raised)] px-1 py-0.5 font-mono text-xs text-[var(--color-text)]">{children}</code>
                      );
                    },
                    table: ({ children }) => (
                      <div className="mb-3 overflow-x-auto last:mb-0">
                        <table className="w-full border-collapse text-sm">{children}</table>
                      </div>
                    ),
                    thead: ({ children }) => (
                      <thead className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">{children}</thead>
                    ),
                    tbody: ({ children }) => (
                      <tbody className="divide-y divide-[var(--color-border-subtle)]">{children}</tbody>
                    ),
                    tr: ({ children }) => (
                      <tr className="hover:bg-[var(--color-surface-raised)]/50">{children}</tr>
                    ),
                    th: ({ children }) => (
                      <th className="px-3 py-2 font-medium">{children}</th>
                    ),
                    td: ({ children }) => (
                      <td className="px-3 py-2 tabular-nums text-[var(--color-text)]">{children}</td>
                    ),
                    hr: () => (
                      <hr className="my-4 border-[var(--color-border-subtle)]" />
                    ),
                  }}
                >
                  {content}
                </ReactMarkdown>
              </div>
            ) : (
              <span className="inline-flex gap-1 text-[var(--color-text-muted)]">
                <span className="animate-bounce">·</span>
                <span className="animate-bounce [animation-delay:0.1s]">·</span>
                <span className="animate-bounce [animation-delay:0.2s]">·</span>
              </span>
            )}
            <div ref={endRef} />
            {promptPayload && content && !streaming && (
              <details className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
                <summary className="cursor-pointer select-none text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]">
                  View prompt sent to Claude
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">System</p>
                    <pre className="whitespace-pre-wrap rounded bg-[var(--color-surface-raised)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-text-muted)]">{promptPayload.system}</pre>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">User</p>
                    <pre className="whitespace-pre-wrap rounded bg-[var(--color-surface-raised)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-text-muted)]">{promptPayload.user}</pre>
                  </div>
                </div>
              </details>
            )}
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
  const [notes, setNotes] = useState<string>(() => loadStoredPlan().notes);
  const [investStrategy, setInvestStrategy] = useState<"balance" | "rebalance" | "growth">("rebalance");
  const [model, setModel] = useState<ClaudeModel>(
    () => loadStoredPlan().model ?? "claude-sonnet-4-5"
  );
  const [plannedHoldings, setPlannedHoldings] = useState<PlannedHolding[]>(loadPlannedHoldings);

  // Add planned holding form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTicker, setNewTicker] = useState("");
  const [newAssetClass, setNewAssetClass] = useState("stocks");
  const [newPlannedValue, setNewPlannedValue] = useState("");
  const [newPricePerShare, setNewPricePerShare] = useState("");
  const [nameError, setNameError] = useState("");

  // "Analyze with Claude" — macro news thesis
  const [newsTagline, setNewsTagline] = useState("");
  const [thesis, setThesis] = useState("");
  const [analyzingThesis, setAnalyzingThesis] = useState(false);
  const [thesisError, setThesisError] = useState<string | null>(null);
  const [thesisPrompt, setThesisPrompt] = useState<PromptPayload | undefined>();
  const [thesisNews, setThesisNews] = useState(""); // news used for the last run (for display)
  const thesisEndRef = useRef<HTMLDivElement>(null);

  // "Invest with Claude" — deployment plan
  const [investPlan, setInvestPlan] = useState("");
  const [analyzingPlan, setAnalyzingPlan] = useState(false);
  const [investPlanError, setInvestPlanError] = useState<string | null>(null);
  const [investPrompt, setInvestPrompt] = useState<PromptPayload | undefined>();
  const investPlanEndRef = useRef<HTMLDivElement>(null);
  const [investOptimizations, setInvestOptimizations] = useState<OptimizationResult[]>([]);

  // "Deploy Capital" — strategy-driven single-contribution breakdown
  const [deployResult, setDeployResult] = useState<DeployAllocation[] | null>(null);
  const [deployStrategy, setDeployStrategy] = useState<"balance" | "rebalance" | "growth">("rebalance");
  const [deployAmount, setDeployAmount] = useState("");
  const [deployCalibration, setDeployCalibration] = useState<Record<string, { suggestedShare: number; rationale: string }>>({});
  const [calibratingDeploy, setCalibratingDeploy] = useState(false);
  const [deployCalibrationError, setDeployCalibrationError] = useState<string | null>(null);
  const [tickerPrices, setTickerPrices] = useState<Record<string, number>>({});

  // "Council" — financial analyst + macro strategist + action summary
  const [analystOutput, setAnalystOutput] = useState("");
  const [strategistOutput, setStrategistOutput] = useState("");
  const [summaryOutput, setSummaryOutput] = useState("");
  const [councilPhase, setCouncilPhase] = useState<"analyst" | "strategist" | "summary" | null>(null);
  const [councilError, setCouncilError] = useState<string | null>(null);
  const [councilAnalystPrompt, setCouncilAnalystPrompt] = useState<PromptPayload | undefined>();
  const [councilStrategistPrompt, setCouncilStrategistPrompt] = useState<PromptPayload | undefined>();
  const [summaryPrompt, setSummaryPrompt] = useState<PromptPayload | undefined>();
  const analystEndRef = useRef<HTMLDivElement>(null);
  const strategistEndRef = useRef<HTMLDivElement>(null);
  const summaryEndRef = useRef<HTMLDivElement>(null);
  const councilOutputRef = useRef<HTMLDivElement>(null);

  // Persist plan inputs
  useEffect(() => {
    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ cash, monthlyContribution, allocations, notes, model }));
  }, [cash, monthlyContribution, allocations, notes, model]);

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


  useEffect(() => {
    if (analystOutput) analystEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [analystOutput]);

  useEffect(() => {
    if (strategistOutput) strategistEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [strategistOutput]);

  useEffect(() => {
    if (summaryOutput) summaryEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [summaryOutput]);

  // ── Unified row list ────────────────────────────────────────────────────────

  const allRows: PlanRow[] = [
    ...holdings.map((h) => ({ ...h, isPlanned: false as const })),
    ...plannedHoldings.map((p) => ({ ...p, current_value: p.plannedValue ?? 0, isPlanned: true as const })),
  ];

  // Fetch last-known share prices for planned holdings when deploy result or rows change
  useEffect(() => {
    if (!deployResult) return;
    const plannedTickers = deployResult
      .filter((r) => {
        const row = allRows.find((ar) => ar.id === r.id);
        return row?.isPlanned && r.ticker;
      })
      .map((r) => r.ticker)
      .filter((t, i, arr) => t && arr.indexOf(t) === i); // unique, non-empty
    if (plannedTickers.length === 0) return;

    void (async () => {
      try {
        const symbols = plannedTickers.join(",");
        const res = await fetch(`/yf-api/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`);
        if (!res.ok) return;
        const json = await res.json() as {
          quoteResponse?: { result?: { symbol: string; regularMarketPrice?: number }[] };
        };
        const results = json.quoteResponse?.result ?? [];
        const prices: Record<string, number> = {};
        for (const q of results) {
          if (q.symbol && typeof q.regularMarketPrice === "number") {
            prices[q.symbol] = q.regularMarketPrice;
          }
        }
        if (Object.keys(prices).length > 0) {
          setTickerPrices((prev) => ({ ...prev, ...prices }));
        }
      } catch {
        // Best-effort — silent failure, no enforcement for missing prices
      }
    })();
  }, [deployResult, allRows]);

  // ── Buy math ────────────────────────────────────────────────────────────────

  const cashNum = parseFloat(cash) || 0;
  const monthlyNum = parseFloat(monthlyContribution) || 0;
  const plannedValueTotal = plannedHoldings.reduce((s, p) => s + (p.plannedValue ?? 0), 0);
  const effectiveTotalValue = totalValue + plannedValueTotal;
  const newTotal = effectiveTotalValue + cashNum;

  const rows = allRows.map((r) => {
    const targetPct = parseFloat(allocations[r.id] ?? "") || 0;
    const currentPct = effectiveTotalValue > 0 ? (r.current_value / effectiveTotalValue) * 100 : 0;
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
        const currentPct = effectiveTotalValue > 0 ? (r.current_value / effectiveTotalValue) * 100 : 0;
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
      plannedValue: parseFloat(newPlannedValue) || undefined,
      pricePerShare: parseFloat(newPricePerShare) || undefined,
    };
    setPlannedHoldings((prev) => [...prev, holding]);
    setNewName("");
    setNewTicker("");
    setNewAssetClass("stocks");
    setNewPlannedValue("");
    setNewPricePerShare("");
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
    const news = newsTagline.trim();
    setThesisNews(news);

    try {
      const client = buildClient();
      const holdingsTable = buildHoldingsTable();
      const notesSection = notes.trim()
        ? `\n\n**Investor conviction notes — treat these as deliberate, do not argue against them:**\n${notes.trim()}`
        : "";

      const newsBlock = news
        ? `**News catalyst:** "${news}"\n\nThis is the macro event or signal you are analyzing the portfolio against. Do not treat it as background color — make it the primary lens for everything that follows.`
        : "";

      const userMessage = news
        ? `${newsBlock}

Here is my current portfolio and target allocation. Rows marked [PLANNED] are positions I intend to build but don't yet own.

**Portfolio value:** $${totalValue.toFixed(2)}

| Holding | Asset Class | Current Value | Current % | Target % |
|---------|-------------|---------------|-----------|----------|
${holdingsTable}${notesSection}

First, make a judgment call: does this headline actually matter to the economy or markets in a way that would move the needle for a retail growth portfolio? If it is a non-event — local news, procedural update, niche sector noise with no real transmission channel to broader markets — say so directly in 1–2 sentences: explain specifically why it doesn't move the needle (e.g. too localized, no demand/supply shock, already priced in, affects a sector not present in the portfolio). If you can cite the likely primary source or a credible outlet that covers this type of story (Reuters, Bloomberg, WSJ, FT, SEC filings, etc.), name it. Then stop. Do not manufacture significance.

If it does matter, structure your response as:

**1. What this news actually means** — cut through the surface. What is the real macro mechanism at play? Who benefits, who gets hurt, over what timeframe? Be specific about the transmission channels.

**2. How each major position lands** — go holding by holding or cluster by cluster. For each, say explicitly: does this news help it, hurt it, or is it largely irrelevant? Give a magnitude read — is this a 5% tailwind or a structural threat? Don't hedge everything.

**3. Target allocation verdict** — given this news, does the current target allocation make sense, or should the investor be questioning any of the weights? If a target looks wrong in this environment, say so and explain why. If the allocation is fine or even well-positioned, say that too.

**4. The one thing to watch** — if you had to name a single variable or follow-on event that would change your read most dramatically, what is it?`
        : `Here is my current portfolio along with my target allocation. Rows marked [PLANNED] are positions I intend to build but don't yet own.

**Portfolio value:** $${totalValue.toFixed(2)}

| Holding | Asset Class | Current Value | Current % | Target % |
|---------|-------------|---------------|-----------|----------|
${holdingsTable}${notesSection}

Read this portfolio as a macro strategist. Don't try to find a single unified thesis — describe the actual mosaic. What distinct economic bets does this collection of positions represent? Where do different clusters point in different directions, and is that a problem or just the natural messiness of a portfolio built with multiple time horizons and conviction levels? What is each major position implicitly saying about the world?

For anything you identify as absent or missing: before calling it out, apply a strict sizing test — a position that would represent less than ~2–3% of this portfolio cannot meaningfully hedge anything or provide real exposure. If a gap passes that test, don't tell me to fill it. Instead, lay out the tradeoff: what exposure I currently have versus what filling the gap would add, what I'd have to give up or dilute to make room for it at meaningful size, and what I stand to gain or lose either way. Let me decide.`;

      const systemPrompt = news
        ? `You are a macro strategist whose job is to translate a specific news event into portfolio-level implications. You are not here to give balanced views — you are here to take the news seriously and tell the investor what it actually means for the positions they hold and the allocation they are targeting.

The investor is 33, growth-oriented, AI-focused, and in the early compounding phase (~$100K milestone 3–4 years out). Contributions matter more than short-term optimization right now. But they still need to know when news changes the risk/reward profile of a position enough to warrant action or re-weighting.

Rules:
- Before anything else, assess whether this headline actually moves the needle for a growth portfolio. Many headlines sound significant but have no meaningful transmission channel to the assets this investor holds. If a headline is noise, say so in 1–2 sentences: name specifically why (too localized, no supply/demand shock, already priced in, affects a sector absent from this portfolio, purely procedural, etc.), and cite the type of source that would cover this story (e.g. "Reuters commodities desk", "SEC EDGAR filing", "local municipal record") so the investor knows where to verify. Then stop — do not stretch to find relevance that isn't there.
- If the headline is genuinely macro-relevant, be opinionated. Do not hedge every statement. If a position looks exposed to this news, say so directly.
- Distinguish between short-term price noise and structural shifts. A tariff headline might move a stock 3% but not change its 3-year thesis — or it might invalidate the thesis entirely. Know the difference and say which it is.
- [PLANNED] positions are future intentions — assess whether this news strengthens or weakens the case for building them.
- Do not recommend specific buy/sell actions. Do frame the risk/reward changes clearly enough that the investor can decide.
- Be specific. Name what each position is doing. Avoid generic portfolio advice.`
        : `You are a macro strategist and portfolio analyst. The investor is 33 years old and has recently finished building the infrastructure for a growth-based portfolio. They are AI-focused with conviction in large-cap dominance, but seek diversification across the portfolio and intend to carry a small bond ballast as a stabilizer. They understand that contributions will heavily drive portfolio growth until the base reaches roughly $100K — likely 3–4 years out — at which point compounding begins to take over. Until then, contribution discipline matters more than short-term return optimization.

Your job is to read this portfolio honestly and present what you see — not to make decisions for the investor. Real portfolios are built over time with different conviction levels, different time horizons, and different underlying bets that don't always point the same direction. That is normal. Do not try to force the holdings into a single coherent theme or flag messiness as a problem unless it creates a genuine strategic conflict.

Read each position or cluster of positions on its own terms first. What is it betting on? Over what time horizon? Then look at how they interact — not to find contradictions to fix, but to understand what the portfolio is actually saying in aggregate.

Contradictions between positions may be intentional: a cyclical bet alongside a defensive position can reflect different time horizons or a hedge, not confusion. Only flag a conflict as a real problem if the positions actively undermine each other in a way that defeats the purpose of both.

[PLANNED] positions are future intentions — include them in your read but note they are not yet owned.

When identifying gaps: your role is not to prescribe. For each gap that clears the sizing threshold, describe the tension — what the investor currently has, what the gap represents in terms of risk or missed exposure, what they would need to give up to fill it at meaningful size, and what they stand to gain or lose in either direction. Present the picture clearly enough that they can make the call themselves. If the gap cannot be filled meaningfully without structural cost, say so and describe what that means for how the portfolio behaves as-is.

Be specific. Name what each position is doing. Avoid generic portfolio advice. This is a thesis read, not a health check.`;

      setThesisPrompt({ system: systemPrompt, user: userMessage });

      let text = "";
      const stream = await client.messages.stream({
        model,
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

  // ── Quarterly convergence math ───────────────────────────────────────────────

  function computeConvergence(
    items: { id: string; name: string; ticker: string; targetPct: number }[],
    startValues: number[],
    monthly: number,
    strategy: "balance" | "rebalance" | "growth",
    maxQuarters = 20,
  ) {
    const CONVERGENCE_THRESHOLD = 1.5; // % within target = converged
    const values = [...startValues];
    const quarterlySnapshots: { quarter: number; totalValue: number; weights: number[] }[] = [];
    let convergedQuarter: number | null = null;

    for (let m = 1; m <= maxQuarters * 3; m++) {
      const total = values.reduce((s, v) => s + v, 0);

      if (strategy === "balance") {
        // Split contribution by target weight each month
        for (let i = 0; i < items.length; i++) {
          values[i] = (values[i] ?? 0) + monthly * ((items[i]?.targetPct ?? 0) / 100);
        }
      } else if (strategy === "rebalance") {
        // Gap-weighted fill: underweight positions get proportionally more
        const gaps = items.map((h, i) => Math.max(h.targetPct / 100 - (values[i] ?? 0) / total, 0.001));
        const gapSum = gaps.reduce((s, g) => s + g, 0);
        for (let i = 0; i < items.length; i++) values[i] = (values[i] ?? 0) + monthly * ((gaps[i] ?? 0) / gapSum);
      } else {
        // Growth: concentrate on most underweight within drift band; quarterly convergence forced
        const isConvergenceQuarter = m % 3 === 0;
        if (isConvergenceQuarter) {
          // Forced quarterly convergence: gap-weighted fill
          const gaps = items.map((h, i) => Math.max(h.targetPct / 100 - (values[i] ?? 0) / total, 0.001));
          const gapSum = gaps.reduce((s, g) => s + g, 0);
          for (let i = 0; i < items.length; i++) values[i] = (values[i] ?? 0) + monthly * ((gaps[i] ?? 0) / gapSum);
        } else {
          // Return-weighted with floor: find most underweight that hasn't breached drift band
          let maxGapIdx = -1, maxGap = -Infinity;
          for (let i = 0; i < items.length; i++) {
            const currentPct = (values[i] ?? 0) / total;
            const target = (items[i]?.targetPct ?? 0) / 100;
            const gap = target - currentPct;
            if (gap > maxGap) { maxGap = gap; maxGapIdx = i; }
          }
          if (maxGapIdx >= 0) {
            values[maxGapIdx] = (values[maxGapIdx] ?? 0) + monthly;
          } else {
            const gaps = items.map((h, i) => Math.max(h.targetPct / 100 - (values[i] ?? 0) / total, 0.001));
            const gapSum = gaps.reduce((s, g) => s + g, 0);
            for (let i = 0; i < items.length; i++) values[i] = (values[i] ?? 0) + monthly * ((gaps[i] ?? 0) / gapSum);
          }
        }
      }

      if (m % 3 === 0) {
        const newTotal = values.reduce((s, v) => s + v, 0);
        const weights = values.map(v => (v / newTotal) * 100);
        quarterlySnapshots.push({ quarter: m / 3, totalValue: newTotal, weights });

        // Check convergence
        if (convergedQuarter === null) {
          const allConverged = items.every((h, i) => Math.abs((weights[i] ?? 0) - h.targetPct) < CONVERGENCE_THRESHOLD);
          if (allConverged) convergedQuarter = m / 3;
        }
        if (convergedQuarter !== null) break;
      }
    }

    return { quarterlySnapshots, convergedQuarter };
  }

  // ── "Deploy Capital" — strategy-driven allocation math ──────────────────────

  // Resolve share price for a planned holding: stored price takes priority over live ticker fetch
  function getSharePrice(holdingId: string, ticker: string): number | undefined {
    const planned = plannedHoldings.find((p) => p.id === holdingId);
    if (planned?.pricePerShare) return planned.pricePerShare;
    if (ticker) return tickerPrices[ticker];
    return undefined;
  }

  // Post-process deploy allocations: zero out planned-holding slots where the
  // dollar amount can't buy even one share, then redistribute freed cash.
  function enforceShareMinimums(items: DeployAllocation[], totalCash: number): DeployAllocation[] {
    let freedCash = 0;
    const adjusted = items.map((r) => {
      const row = allRows.find((ar) => ar.id === r.id);
      if (!row?.isPlanned) return r;
      const sharePrice = getSharePrice(r.id, r.ticker);
      if (sharePrice != null && r.allocation > 0 && r.allocation < sharePrice) {
        freedCash += r.allocation;
        return { ...r, allocation: 0, sharePct: 0, newValue: r.currentValue, tag: "skipped" as const };
      }
      return r;
    });

    if (freedCash <= 0) return adjusted;

    const eligible = adjusted.filter((r) => r.allocation > 0);
    const totalEligible = eligible.reduce((s, r) => s + r.allocation, 0);
    if (totalEligible === 0) return adjusted;

    return adjusted.map((r) => {
      if (r.allocation <= 0) return r;
      const extra = freedCash * (r.allocation / totalEligible);
      const newAlloc = r.allocation + extra;
      const newValue = r.currentValue + newAlloc;
      return { ...r, allocation: newAlloc, sharePct: (newAlloc / totalCash) * 100, newValue };
    });
  }

  function computeDeployment(
    cash: number,
    strategy: "balance" | "rebalance" | "growth",
  ): DeployAllocation[] {
    const eligible = rowsWithBuy.filter(r => r.targetPct > 0);
    const newTotal = effectiveTotalValue + cash;

    if (strategy === "balance") {
      const raw = eligible
        .map(r => {
          const allocation = cash * (r.targetPct / 100);
          const newValue = r.current_value + allocation;
          return {
            id: r.id, name: r.name, ticker: r.ticker ?? "", assetClass: r.asset_class,
            currentValue: r.current_value, currentPct: r.currentPct, targetPct: r.targetPct,
            allocation, sharePct: (allocation / cash) * 100,
            newValue, newPct: (newValue / newTotal) * 100,
            tag: "target-split" as const,
          };
        });
      return enforceShareMinimums(raw, cash).sort((a, b) => b.allocation - a.allocation);
    }

    if (strategy === "rebalance") {
      const gapTotal = eligible.reduce((s, r) => s + Math.max(0, r.delta), 0);
      const raw = eligible
        .map(r => {
          const gap = Math.max(0, r.delta);
          const allocation = gapTotal > 0 ? cash * (gap / gapTotal) : 0;
          const newValue = r.current_value + allocation;
          return {
            id: r.id, name: r.name, ticker: r.ticker ?? "", assetClass: r.asset_class,
            currentValue: r.current_value, currentPct: r.currentPct, targetPct: r.targetPct,
            allocation, sharePct: (allocation / cash) * 100,
            newValue, newPct: (newValue / newTotal) * 100,
            tag: gap > 0 ? "gap-fill" as const : "skipped" as const,
          };
        });
      return enforceShareMinimums(raw, cash).sort((a, b) => b.allocation - a.allocation);
    }

    // Growth: return-weighted with 20% floor reserved for positions >10% below target
    const FLOOR_THRESHOLD = 10; // % delta that triggers floor protection
    const FLOOR_SHARE = 0.20;

    const floorPositions = eligible.filter(r => r.delta > FLOOR_THRESHOLD);
    const mainPositions = eligible.filter(r => r.delta > -5 && r.delta <= FLOOR_THRESHOLD);

    const allocations: Record<string, number> = {};

    if (floorPositions.length > 0) {
      const floorBudget = cash * FLOOR_SHARE;
      const floorGapSum = floorPositions.reduce((s, r) => s + r.delta, 0);
      for (const r of floorPositions) {
        allocations[r.id] = floorBudget * (r.delta / floorGapSum);
      }
    }

    const mainBudget = cash - Object.values(allocations).reduce((s, v) => s + v, 0);
    if (mainPositions.length > 0) {
      const scores = mainPositions.map(r => Math.max(ASSET_CLASS_RETURNS[r.asset_class] ?? 0.07, 0.01));
      const scoreSum = scores.reduce((s, sc) => s + sc, 0);
      mainPositions.forEach((r, i) => {
        allocations[r.id] = (allocations[r.id] ?? 0) + mainBudget * ((scores[i] ?? 0.01) / scoreSum);
      });
    }

    const growthRaw = eligible
      .map(r => {
        const allocation = allocations[r.id] ?? 0;
        const newValue = r.current_value + allocation;
        const isFloor = floorPositions.some(fp => fp.id === r.id);
        const isMain = mainPositions.some(mp => mp.id === r.id);
        return {
          id: r.id, name: r.name, ticker: r.ticker ?? "", assetClass: r.asset_class,
          currentValue: r.current_value, currentPct: r.currentPct, targetPct: r.targetPct,
          allocation, sharePct: (allocation / cash) * 100,
          newValue, newPct: (newValue / newTotal) * 100,
          tag: (isFloor ? "floor" : isMain ? "return-weighted" : "skipped") as DeployAllocation["tag"],
        };
      });
    return enforceShareMinimums(growthRaw, cash)
      .sort((a, b) => b.allocation - a.allocation);
  }

  async function handleDeployCalibrate(result: DeployAllocation[], cash: number) {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey || result.length === 0) return;
    setCalibratingDeploy(true);
    setDeployCalibrationError(null);

    try {
      const client = buildClient();

      const strategyLabel = deployStrategy === "growth"
        ? "Growth (return-weighted by asset class, floor protection for significantly underweight positions)"
        : deployStrategy === "rebalance"
          ? "Rebalance (gap-weighted fill — underweight positions receive proportionally more)"
          : "Balance (split by target weight)";

      const holdingsList = result.map(r => {
        const isPlanned = allRows.find((ar) => ar.id === r.id)?.isPlanned ?? false;
        const sharePrice = isPlanned ? getSharePrice(r.id, r.ticker) : undefined;
        const priceStr = sharePrice != null ? ` | Share price: $${sharePrice.toFixed(2)}` : "";
        return `- id: "${r.id}" | ${r.ticker || r.name} | ${ASSET_CLASSES.find(a => a.value === r.assetClass)?.label ?? r.assetClass} | Current: ${r.currentPct.toFixed(1)}% | Target: ${r.targetPct.toFixed(1)}% | Computed deploy: $${r.allocation.toFixed(0)} (${r.sharePct.toFixed(1)}% of cash) | Method: ${r.tag}${priceStr}`;
      }).join("\n");

      const idsList = result.map(r =>
        `- id: "${r.id}" | ${r.ticker || r.name}`
      ).join("\n");

      const userMsg = `I am deploying $${cash.toFixed(0)} into my portfolio using the ${strategyLabel} strategy.

Portfolio value: $${effectiveTotalValue.toFixed(0)} → $${(effectiveTotalValue + cash).toFixed(0)} post-deploy

Holdings and computed allocation:
${holdingsList}

Review each holding's computed share of the $${cash.toFixed(0)} deployment. For each, return your suggested share (as a decimal fraction of total cash, e.g. 0.25 for 25%) based on:
- Current underweight/overweight status relative to target
- Asset class expected return and risk profile
- Portfolio construction quality — avoid over-concentrating in a single position or asset class in a single deployment
- Sequencing risk — which positions benefit most from early capital (compounding, valuation, momentum)

Holdings with IDs:
${idsList}

Return ONLY a valid JSON array — no markdown, no explanation outside the JSON:
[
  {
    "id": "<holding_id>",
    "ticker": "<ticker or name>",
    "suggestedShare": <decimal 0–1>,
    "rationale": "<1–2 sentence justification>"
  }
]

All suggestedShare values must sum to 1.0 (within 0.01). Do not allocate to holdings at or above target unless there is a strong reason.

If a holding has a "Share price" listed, do not suggest an allocation where (suggestedShare × $${cash.toFixed(0)}) is less than that share price — a sub-share deployment is not actionable.`;

      const systemMsg = `You are a quantitative portfolio manager calibrating a capital deployment plan. Return ONLY valid JSON — no markdown, no explanation outside the array. Every suggestedShare must be a decimal (0.0–1.0). All shares must sum to 1.0. Be realistic and specific. If a holding is already at target, suggestedShare should be 0.`;

      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: systemMsg,
        messages: [{ role: "user", content: userMsg }],
      });

      const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("Claude didn't return a valid JSON array. Try again.");

      const estimates: { id: string; ticker: string; suggestedShare: number; rationale: string }[] = JSON.parse(jsonMatch[0]);

      // Build initial calibration map
      const newCalibration: Record<string, { suggestedShare: number; rationale: string }> = {};
      for (const est of estimates) {
        if (est.id && typeof est.suggestedShare === "number") {
          newCalibration[est.id] = {
            suggestedShare: est.suggestedShare,
            rationale: est.rationale ?? "",
          };
        }
      }

      // Post-parse enforcement: zero out sub-share allocations for planned holdings
      let freedShare = 0;
      for (const r of result) {
        const isPlanned = allRows.find((ar) => ar.id === r.id)?.isPlanned ?? false;
        const sharePrice = isPlanned ? getSharePrice(r.id, r.ticker) : undefined;
        const cal = newCalibration[r.id];
        if (sharePrice != null && cal && cash * cal.suggestedShare < sharePrice) {
          freedShare += cal.suggestedShare;
          newCalibration[r.id] = { suggestedShare: 0, rationale: cal.rationale };
        }
      }

      // Redistribute freed share proportionally to valid (non-zero) entries
      if (freedShare > 0) {
        const validIds = result
          .filter((r) => (newCalibration[r.id]?.suggestedShare ?? 0) > 0)
          .map((r) => r.id);

        if (validIds.length > 0) {
          const totalValid = validIds.reduce((s, id) => s + (newCalibration[id]?.suggestedShare ?? 0), 0);
          for (const id of validIds) {
            const cal = newCalibration[id];
            if (cal) {
              cal.suggestedShare += freedShare * (cal.suggestedShare / totalValid);
            }
          }
        } else {
          // Fallback: equal split across positions with a non-zero math allocation;
          // if none exist (edge case), split equally across all positions
          const fallbackIds = result.filter((r) => r.allocation > 0).map((r) => r.id);
          const targets = fallbackIds.length > 0 ? fallbackIds : result.map((r) => r.id);
          const share = targets.length > 0 ? 1 / targets.length : 0;
          for (const id of targets) {
            const cal = newCalibration[id];
            if (cal) cal.suggestedShare = share;
          }
        }
      }

      setDeployCalibration(newCalibration);
    } catch (err) {
      setDeployCalibrationError(err instanceof Error ? err.message : String(err));
    } finally {
      setCalibratingDeploy(false);
    }
  }

  // ── "Invest with Claude" — deployment plan ──────────────────────────────────

  async function handleInvestPlan() {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey) return;
    setAnalyzingPlan(true);
    setInvestPlan("");
    setInvestPlanError(null);
    setInvestOptimizations([]);

    try {
      const client = buildClient();

      // ── Build current state table ──
      const holdingRows = rowsWithBuy.map((r) => {
        const status = r.delta > 1 ? "UNDERWEIGHT" : r.delta < -1 ? "OVERWEIGHT" : "AT-WEIGHT";
        const unstarted = r.current_value === 0 && r.targetPct > 0 ? " [UNSTARTED]" : "";
        const planned = r.isPlanned ? " [PLANNED]" : "";
        const doNotBuy = r.buy > 0 && (r.buy < 50 || (newTotal > 0 && r.buy / newTotal < 0.005))
          ? " [DO NOT BUY — size too small]" : "";
        const ticker = r.ticker ? ` (${r.ticker})` : "";
        const assetLabel = ASSET_CLASSES.find((a) => a.value === r.asset_class)?.label ?? r.asset_class;
        return `| ${r.name}${ticker} | ${assetLabel} | $${r.current_value.toFixed(2)} | ${r.currentPct.toFixed(1)}% | ${r.targetPct.toFixed(1)}% | ${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}% | ${status}${unstarted}${planned}${doNotBuy} |`;
      }).join("\n");

      const unstartedPositions = rowsWithBuy.filter((r) => r.current_value === 0 && r.targetPct > 0);
      const overweightPositions = rowsWithBuy.filter((r) => r.delta < -1);
      const doNotBuyPositions = rowsWithBuy.filter((r) => r.buy > 0 && (r.buy < 50 || (newTotal > 0 && r.buy / newTotal < 0.005)));

      // ── Compute quarterly convergence schedule ──
      const convergenceItems = rowsWithBuy
        .filter((r) => r.targetPct > 0)
        .map((r) => ({ id: r.id, name: r.name, ticker: r.ticker ?? "", targetPct: r.targetPct }));
      const startValues = rowsWithBuy
        .filter((r) => r.targetPct > 0)
        .map((r) => r.current_value + (cashNum > 0 ? r.buy : 0)); // start from post-deploy values

      let convergenceSection = "";
      let originalConvergedQuarter: number | null = null;
      if (monthlyNum > 0 && convergenceItems.length > 0) {
        const { quarterlySnapshots, convergedQuarter } = computeConvergence(
          convergenceItems, startValues, monthlyNum, investStrategy
        );
        originalConvergedQuarter = convergedQuarter;

        const strategyLabel = investStrategy === "growth"
          ? "Growth (return-weighted, floor protection, quarterly convergence)"
          : investStrategy === "rebalance"
            ? "Rebalance (gap-weighted fill each month)"
            : "Balance (split by target weight each month)";

        // Build header: Holding names truncated
        const colHeaders = convergenceItems.map(h => h.ticker || h.name.split(" ")[0]).join(" | ");
        const targetRow = `| **Target** | — | ${convergenceItems.map(h => `**${h.targetPct.toFixed(1)}%**`).join(" | ")} |`;

        const snapshotRows = quarterlySnapshots.map(snap => {
          const weightCols = snap.weights.map((w, i) => {
            const target = convergenceItems[i]?.targetPct ?? 0;
            const delta = w - target;
            const marker = Math.abs(delta) < 1.5 ? "✓" : delta > 0 ? "▲" : "▼";
            return `${w.toFixed(1)}% ${marker}`;
          }).join(" | ");
          return `| Q${snap.quarter} | $${(snap.totalValue / 1000).toFixed(1)}K | ${weightCols} |`;
        }).join("\n");

        const convergenceNote = convergedQuarter
          ? `All positions converge to within 1.5% of target by **Q${convergedQuarter}** (~${(convergedQuarter / 4).toFixed(1)} years).`
          : `Positions do not fully converge within ${quarterlySnapshots.length} quarters at $${monthlyNum.toFixed(0)}/mo.`;

        convergenceSection = `

## Quarterly Convergence Schedule
**Strategy: ${strategyLabel}**
**Monthly contribution: $${monthlyNum.toFixed(2)}**
${convergenceNote}

| Quarter | Portfolio | ${colHeaders} |
|---------|-----------|${convergenceItems.map(() => "---").join("|")}|
${snapshotRows}
${targetRow}

✓ = within 1.5% of target · ▲ = overweight · ▼ = underweight`;
      }

      const userMessage =
        `I have $${cashNum.toFixed(2)} to deploy today and contribute $${monthlyNum.toFixed(2)}/month. Portfolio: $${effectiveTotalValue.toFixed(2)} → $${newTotal.toFixed(2)} post-deploy.

## Current vs Target Allocation
| Holding | Class | Value | Current% | Target% | Delta | Status |
|---------|-------|-------|----------|---------|-------|--------|
${holdingRows}

**Overweight:** ${overweightPositions.length > 0 ? overweightPositions.map(r => `${r.ticker || r.name} (${r.delta.toFixed(1)}%)`).join(", ") : "None"}
**Unstarted/Planned:** ${unstartedPositions.length > 0 ? unstartedPositions.map(r => `${r.ticker || r.name} → ${r.targetPct}%`).join(", ") : "None"}
**Do Not Buy (too small):** ${doNotBuyPositions.length > 0 ? doNotBuyPositions.map(r => `${r.ticker || r.name} ($${r.buy.toFixed(2)})`).join(", ") : "None"}
${convergenceSection}

Analyze this deployment and contribution plan:
1. **Today's deploy** — how to allocate the $${cashNum.toFixed(2)}, noting any DO NOT BUY positions (defer, consolidate, or remove?), and when to initiate UNSTARTED positions.
2. **Convergence assessment** — based on the quarterly schedule above, evaluate whether the ${investStrategy === "balance" ? "Balance (target-weight split)" : investStrategy === "rebalance" ? "Rebalance (gap-weighted fill)" : "Growth (return-weighted, quarterly convergence)"} strategy is appropriate for this portfolio's size, contribution rate, and composition. Is the convergence pace too slow, too fast, or right? Are there positions where the strategy's sequencing causes a problem?
3. **Optimizations** — identify 1–2 specific improvements to target allocations that would improve convergence quality. For each, briefly explain the rationale in 1-2 sentences.

Be direct. Reference tickers and numbers.

After your analysis, output a JSON block with the exact target allocation adjustments for each optimization. Only include holdings whose target % changes. All adjusted targets across the full portfolio must still sum to 100%.

<optimizations>
[
  {
    "label": "Short label (e.g. Smooth VGIT ramp)",
    "summary": "One sentence explaining what changes and why",
    "adjustedTargets": { "TICKER_OR_NAME": newTargetPct }
  }
]
</optimizations>`;

      const systemPrompt =
        `You are a portfolio manager reviewing a mathematically computed contribution and convergence schedule. The quarterly allocation table is already computed — do not regenerate it. Your job is to interpret it strategically: is the convergence pace right, is the strategy fit appropriate, are there sequencing problems, and what should change. Target allocations are the investor's intended state — do not suggest changing them unless the convergence data reveals a structural problem. Be opinionated and specific. At the end of your response, output the <optimizations> JSON block exactly as instructed — it will be parsed by code, not displayed to the user.`;

      setInvestPrompt({ system: systemPrompt, user: userMessage });

      let text = "";
      const stream = await client.messages.stream({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          text += chunk.delta.text;
          // Strip the <optimizations> block while streaming so it doesn't appear in markdown
          setInvestPlan(text.replace(/<optimizations>[\s\S]*?<\/optimizations>/g, "").trimEnd());
        }
      }

      // ── Parse optimization structured output and compute new schedules ──
      const optMatch = text.match(/<optimizations>([\s\S]*?)<\/optimizations>/);
      if (optMatch && convergenceItems.length > 0) {
        try {
          const opts = JSON.parse(optMatch[1]!.trim()) as {
            label: string;
            summary: string;
            adjustedTargets: Record<string, number>;
          }[];
          const results: OptimizationResult[] = opts.map(opt => {
            // Apply adjusted targets — match by ticker first, then name
            const adjustedItems = convergenceItems.map(item => {
              const newPct =
                opt.adjustedTargets[item.ticker] ??
                opt.adjustedTargets[item.name] ??
                opt.adjustedTargets[item.id];
              return { ...item, targetPct: newPct !== undefined ? newPct : item.targetPct };
            });
            const { quarterlySnapshots, convergedQuarter } = computeConvergence(
              adjustedItems, startValues, monthlyNum, investStrategy,
            );
            return {
              label: opt.label,
              summary: opt.summary,
              adjustedItems,
              quarterlySnapshots,
              convergedQuarter,
              originalConvergedQuarter,
            };
          });
          setInvestOptimizations(results);
        } catch {
          // Malformed JSON from Claude — silently ignore
        }
      }
    } catch (err) {
      setInvestPlanError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzingPlan(false);
    }
  }

  // ── "Council" — financial analyst then macro strategist ─────────────────────

  async function handleCouncil() {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey) return;

    setCouncilPhase("analyst");
    setAnalystOutput("");
    setStrategistOutput("");
    setSummaryOutput("");
    setCouncilError(null);
    setCouncilAnalystPrompt(undefined);
    setCouncilStrategistPrompt(undefined);
    setSummaryPrompt(undefined);

    try {
      const client = buildClient();
      const holdingsTable = buildHoldingsTable();

      // ── Phase 1: Financial Analyst ──────────────────────────────────────────

      // Compute convergence math for the analyst
      const totalTargetValue = newTotal; // post-deploy portfolio is the baseline
      const totalShortfall = allRows.reduce((sum, r) => {
        const targetPct = parseFloat(allocations[r.id] ?? "") || 0;
        const targetAmt = totalTargetValue * (targetPct / 100);
        const gap = Math.max(0, targetAmt - r.current_value);
        return sum + gap;
      }, 0);
      const unstartedCount = allRows.filter(
        (r) => r.current_value === 0 && (parseFloat(allocations[r.id] ?? "") || 0) > 0
      ).length;
      const monthsToConvergence = monthlyNum > 0 ? Math.ceil(totalShortfall / monthlyNum) : null;
      const convergenceStr = monthsToConvergence != null
        ? `~${monthsToConvergence} months (~${(monthsToConvergence / 12).toFixed(1)} years) at $${monthlyNum.toFixed(2)}/month`
        : "unknown (no monthly contribution set)";
      const yr1Total = monthlyNum * 12;
      const yr2Total = monthlyNum * 24;
      const yr3Total = monthlyNum * 36;

      const analystSystem =
        `You are a financial analyst specializing in capital deployment and portfolio construction. Your mandate is growth-first — but with a clear long-term destination: the investor wants full convergence on their target portfolio exposures. Every holding in the portfolio is intentional. The goal is to reach target weight across all positions over time, not just fund the top picks indefinitely.

The tension you must navigate: growth positions come first in the near term, but the deployment plan must actively work toward getting every holding established. Do not leave positions at zero indefinitely. Prioritize ruthlessly in the short run, but build a credible path to full portfolio coverage over the contribution horizon.

Work backward from the total expected contributions to determine when all holdings should effectively exist in the portfolio. Show your math: at the current contribution rate, when does the portfolio reach full coverage? Then reverse-engineer the quarterly ladder from that endpoint — which positions get initiated when, and in what sequence, to reach convergence on schedule without strangling the growth engines?

Be specific. Name positions, dollar amounts, timing, and the reasoning behind sequencing decisions.`;

      const analystUser =
        `Here is the portfolio I need you to deploy capital into. Work backward from my available cash and ongoing monthly contributions to build a growth-first allocation strategy that converges on full target exposure over time.

**Available to deploy today:** $${cashNum.toFixed(2)}
**Monthly contribution:** $${monthlyNum.toFixed(2)}/month
**Year 1 total contributions:** $${yr1Total.toFixed(2)}
**Year 2 cumulative contributions:** $${yr2Total.toFixed(2)}
**Year 3 cumulative contributions:** $${yr3Total.toFixed(2)}
**Current portfolio value:** $${totalValue.toFixed(2)}
**Post-deploy total:** $${newTotal.toFixed(2)}
**Total shortfall to reach target weights:** $${totalShortfall.toFixed(2)}
**Unstarted positions (currently $0):** ${unstartedCount}
**Estimated time to full convergence at current contribution rate:** ${convergenceStr}

| Holding | Asset Class | Current Value | Current % | Target % |
|---------|-------------|---------------|-----------|----------|
${holdingsTable}

Your job: fund the growth engines first — but build a credible, sequenced path to full portfolio coverage. I want every intended holding established in the portfolio eventually; I do not want positions sitting at zero indefinitely. Work backwards from the convergence timeline to determine when each unstarted position gets initiated. Then allocate the $${cashNum.toFixed(2)} today and lay out how the $${monthlyNum.toFixed(2)}/month flows quarter by quarter to reach full coverage on schedule. Make clear what gets priority, when secondary positions get initiated, and why the sequencing is ordered the way it is.`;

      setCouncilAnalystPrompt({ system: analystSystem, user: analystUser });

      let analystText = "";
      const analystStream = await client.messages.stream({
        model,
        max_tokens: 8192,
        system: analystSystem,
        messages: [{ role: "user", content: analystUser }],
      });

      for await (const chunk of analystStream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          analystText += chunk.delta.text;
          setAnalystOutput(analystText);
        }
      }

      // ── Phase 2: Macro Strategist ───────────────────────────────────────────

      setCouncilPhase("strategist");

      const strategistSystem =
        `You are a macro strategist. A financial analyst has just reviewed the same portfolio and made capital deployment recommendations. Your job is not to re-do their work — it's to look at what they've recommended and tell the investor whether the deployment pattern agrees with, contradicts, or is neutral toward the macro thesis the portfolio is expressing.

Read each cluster of positions on its own terms. Do the analyst's deployment priorities reinforce the portfolio's macro bets, or do they inadvertently starve a position that matters to the thesis? Are there positions being underfunded that represent a critical part of the macro view? Are there positions being overfunded relative to what the macro case actually warrants?

Then map a route toward growth: given the thesis this portfolio represents, and given the analyst's deployment plan, where does the portfolio go from here? What does the 2-3 year path look like if the macro thesis plays out?

Be direct. Agree where you agree, push back where the analyst's priorities don't serve the thesis, and call out anything the analyst missed that the macro view demands.`;

      const strategistUser =
        `Here is the portfolio context, followed by the financial analyst's deployment recommendation. Review the analyst's allocation and tell me whether it agrees or disagrees with the portfolio's macro thesis — then give me a route toward growth.

**Portfolio value:** $${totalValue.toFixed(2)} | **Cash to deploy:** $${cashNum.toFixed(2)} | **Monthly:** $${monthlyNum.toFixed(2)}/month

| Holding | Asset Class | Current Value | Current % | Target % |
|---------|-------------|---------------|-----------|----------|
${holdingsTable}

---

**Financial Analyst's Recommendation:**

${analystText}

---

Now weigh in as the macro strategist. Does this deployment pattern serve or undermine the portfolio's macro thesis? What does the analyst get right? Where do you push back? Map the route toward growth from here.`;

      setCouncilStrategistPrompt({ system: strategistSystem, user: strategistUser });

      let strategistText = "";
      const strategistStream = await client.messages.stream({
        model,
        max_tokens: 8192,
        system: strategistSystem,
        messages: [{ role: "user", content: strategistUser }],
      });

      for await (const chunk of strategistStream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          strategistText += chunk.delta.text;
          setStrategistOutput(strategistText);
        }
      }

      // ── Phase 3: Action Summary ─────────────────────────────────────────────

      setCouncilPhase("summary");

      // Build list of unstarted/planned holdings for precise trigger points
      const unstartedList = allRows
        .filter((r) => r.current_value === 0 && (parseFloat(allocations[r.id] ?? "") || 0) > 0)
        .map((r) => {
          const targetPct = parseFloat(allocations[r.id] ?? "") || 0;
          const ticker = r.ticker ? ` (${r.ticker})` : "";
          return `${r.name}${ticker} — target ${targetPct}%`;
        })
        .join("\n");

      const summarySystem =
        `You are a financial advisor giving a client their exact marching orders. Be ruthlessly concise. No jargon, no lengthy explanations, no hedging, no preamble.

Two sections only — formatted exactly as shown. Nothing before Section 1. Nothing after Section 2.

**Section 1 — Day 1**
A bulleted list. Each bullet = one position to buy today, the exact dollar amount, and one sentence max on why. If cash is $0, say so and skip to Section 2.

**Section 2 — Portfolio Milestones**
A bulleted list. Each bullet = one unstarted holding (not yet owned), the precise total portfolio value at which to initiate it (a single dollar figure, not a range), and one sentence on why that trigger makes sense. Order by when they should be initiated (soonest first).

No other content. No summaries, no conclusions, no "in summary", no sign-off.`;

      const summaryUser =
        `Here is the context from our analyst and strategist session. Distill it into marching orders.

**Cash available today:** $${cashNum.toFixed(2)}
**Current portfolio value:** $${totalValue.toFixed(2)}
**Monthly contribution:** $${monthlyNum.toFixed(2)}/month

**Unstarted holdings that need initiation milestones:**
${unstartedList || "None"}

---

ANALYST OUTPUT:
${analystText}

---

STRATEGIST OUTPUT:
${strategistText}

---

Give me Section 1 (Day 1 buys) and Section 2 (precise portfolio value triggers for each unstarted holding). Nothing else.`;

      setSummaryPrompt({ system: summarySystem, user: summaryUser });

      let summaryText = "";
      const summaryStream = await client.messages.stream({
        model,
        max_tokens: 4096,
        system: summarySystem,
        messages: [{ role: "user", content: summaryUser }],
      });

      for await (const chunk of summaryStream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          summaryText += chunk.delta.text;
          setSummaryOutput(summaryText);
        }
      }
    } catch (err) {
      setCouncilError(err instanceof Error ? err.message : String(err));
    } finally {
      setCouncilPhase(null);
    }
  }

  function handleSaveCouncilPdf() {
    const el = councilOutputRef.current;
    if (!el) return;
    const date = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head>
      <title>Investment Council — ${date}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 40px auto; padding: 0 24px; color: #111; line-height: 1.65; font-size: 14px; }
        h1 { font-size: 22px; margin: 0 0 4px; }
        .meta { color: #6b7280; font-size: 13px; margin-bottom: 32px; }
        h2 { font-size: 16px; font-weight: 600; margin: 28px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
        h3 { font-size: 14px; font-weight: 600; margin: 20px 0 6px; }
        p { margin: 0 0 12px; }
        ul, ol { margin: 0 0 12px; padding-left: 20px; }
        li { margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
        th { background: #f9fafb; border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; font-weight: 600; }
        td { border: 1px solid #e5e7eb; padding: 6px 10px; }
        strong { font-weight: 600; }
        em { font-style: italic; }
        code { font-family: monospace; background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
        hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
        .section { margin-bottom: 40px; }
        .section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 12px; }
        .summary-section { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px 24px; margin-bottom: 32px; }
        .summary-section h2 { border-color: #86efac; }
        @media print { body { margin: 20px; } }
      </style>
    </head><body>
      <h1>Investment Council Report</h1>
      <p class="meta">${date} · Portfolio $${totalValue.toFixed(2)} · Cash $${cashNum.toFixed(2)} · $${monthlyNum.toFixed(2)}/mo</p>
      ${el.innerHTML}
      <script>window.onload = function(){ window.print(); }</script>
    </body></html>`);
    win.document.close();
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
          <div className="grid grid-cols-3 gap-4">
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
                      {r.isPlanned ? (
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={r.current_value || ""}
                          placeholder="0.00"
                          onChange={e => {
                            const val = parseFloat(e.target.value) || undefined;
                            setPlannedHoldings(prev => prev.map(p => p.id === r.id ? { ...p, plannedValue: val } : p));
                          }}
                          className="w-24 text-right bg-transparent border-b border-[var(--color-border-subtle)] focus:outline-none focus:border-[var(--color-warning)] text-[var(--color-warning)] tabular-nums placeholder:text-[var(--color-text-subtle)]"
                        />
                      ) : (
                        formatCurrency(r.current_value, true)
                      )}
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
                <div className="w-32">
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Planned value ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={newPlannedValue}
                    onChange={(e) => setNewPlannedValue(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm focus:border-[var(--color-primary)] focus:outline-none"
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddPlanned(); }}
                  />
                </div>
                <div className="w-28">
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Price/share ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newPricePerShare}
                    onChange={(e) => setNewPricePerShare(e.target.value)}
                    placeholder="e.g. 450.00"
                    className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm focus:border-[var(--color-primary)] focus:outline-none"
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddPlanned(); }}
                  />
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={handleAddPlanned}>Add</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setShowAddForm(false); setNewName(""); setNewTicker(""); setNewPlannedValue(""); setNewPricePerShare(""); setNameError(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Conviction notes ── */}
      <Card>
        <CardHeader>
          <CardTitle>Conviction Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Note any intentional conviction positions here — e.g. &quot;I'm intentionally long NVDA despite near-term valuation concerns because I believe AI infrastructure capex has 5+ years of runway and this is the picks-and-shovels play.&quot; Claude will acknowledge these as deliberate holds rather than argue against them."
            rows={3}
            className="w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-primary)] focus:outline-none"
          />
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
          {/* ── News input ── */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Globe2 size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)] pointer-events-none" />
              <input
                type="text"
                value={newsTagline}
                onChange={e => setNewsTagline(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !analyzingThesis && allRows.length > 0) void handlePortfolioThesis(); }}
                placeholder="Paste a news headline to analyze your positions against it — or leave blank for a general thesis"
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] pl-7 pr-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-primary)] focus:outline-none"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePortfolioThesis}
              disabled={analyzingThesis || allRows.length === 0}
            >
              <TrendingUp size={14} />
              {analyzingThesis ? "Analyzing…" : "Analyze"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleInvestPlan}
              disabled={analyzingPlan || !allocationOk || allRows.length === 0}
            >
              <Wallet size={14} />
              {analyzingPlan ? "Planning…" : "Invest with Claude"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCouncil}
              disabled={councilPhase !== null || allRows.length === 0}
              title="Financial Analyst allocates capital, then Macro Strategist weighs in on the thesis"
            >
              <Users size={14} />
              {councilPhase === "analyst" ? "Analyst thinking…" : councilPhase === "strategist" ? "Strategist weighing in…" : councilPhase === "summary" ? "Summarizing…" : "Council"}
            </Button>
            <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-0.5">
              {([
                { value: "balance",   label: "Balance",   title: "Split contributions by target weight each month — simple and consistent" },
                { value: "rebalance", label: "Rebalance", title: "Gap-weighted fill: underweight positions receive proportionally more each month" },
                { value: "growth",   label: "Growth",    title: "Return-weighted contributions; floor protection for significantly underweight positions; quarterly convergence forced" },
              ] as { value: "balance" | "rebalance" | "growth"; label: string; title: string }[]).map(s => (
                <button key={s.value} onClick={() => setInvestStrategy(s.value)} title={s.title}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${investStrategy === s.value ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
                  {s.label}
                </button>
              ))}
            </div>
            {!allocationOk && allocationSum > 0 && (
              <span className="text-xs text-[var(--color-text-muted)]">
                Allocations must sum to 100% for Invest
              </span>
            )}

            {/* Model toggle */}
            <div className="ml-auto flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-0.5">
              {CLAUDE_MODELS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setModel(m.value)}
                  title={m.description}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    model === m.value
                      ? "bg-[var(--color-primary)] text-white"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Deploy Capital ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-[var(--color-primary)]" />
                <CardTitle>Deploy Capital</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3 mb-4">
                <div>
                  <p className="text-xs text-[var(--color-text-muted)] mb-1">Amount to deploy</p>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={deployAmount}
                    onChange={e => { setDeployAmount(e.target.value); setDeployResult(null); setDeployCalibration({}); }}
                    placeholder="e.g. 5000"
                    className="w-32 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1.5 text-sm tabular-nums focus:border-[var(--color-primary)] focus:outline-none"
                  />
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-muted)] mb-1">Strategy</p>
                  <div className="flex gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-0.5">
                    {([
                      { value: "balance",   label: "Balance",   title: "Split by target weight — proportional regardless of current position" },
                      { value: "rebalance", label: "Rebalance", title: "Gap-weighted fill — underweight positions receive proportionally more" },
                      { value: "growth",    label: "Growth",    title: "Return-weighted by asset class with floor protection for significantly underweight positions" },
                    ] as { value: "balance" | "rebalance" | "growth"; label: string; title: string }[]).map(s => (
                      <button key={s.value} onClick={() => { setDeployStrategy(s.value); setDeployResult(null); setDeployCalibration({}); }} title={s.title}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${deployStrategy === s.value ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!(parseFloat(deployAmount) > 0) || allRows.length === 0 || !allocationOk}
                  onClick={() => {
                    const cash = parseFloat(deployAmount) || 0;
                    if (cash <= 0) return;
                    setDeployCalibration({});
                    setDeployResult(computeDeployment(cash, deployStrategy));
                  }}
                >
                  <Zap size={14} />
                  Plan
                </Button>
              </div>

              {deployResult && deployResult.length > 0 && (() => {
                const cash = parseFloat(deployAmount) || 0;
                const newTotal = effectiveTotalValue + cash;
                const totalDeployed = deployResult.reduce((s, r) => s + r.allocation, 0);
                const isCalibrated = Object.keys(deployCalibration).length > 0;
                const tagColors: Record<string, string> = {
                  "target-split":    "text-[var(--color-primary)]",
                  "gap-fill":        "text-[var(--color-success,#22c55e)]",
                  "return-weighted": "text-amber-500",
                  "floor":           "text-blue-400",
                  "skipped":         "text-[var(--color-text-subtle)]",
                };
                const tagLabels: Record<string, string> = {
                  "target-split":    "target split",
                  "gap-fill":        "gap fill",
                  "return-weighted": "return-weighted",
                  "floor":           "floor",
                  "skipped":         "at weight",
                };
                return (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={calibratingDeploy}
                        onClick={() => handleDeployCalibrate(deployResult, cash)}
                      >
                        <Bot size={14} />
                        {calibratingDeploy ? "Calibrating…" : isCalibrated ? "Recalibrate with Claude" : "Calibrate with Claude"}
                      </Button>
                      {isCalibrated && (
                        <p className="text-xs text-[var(--color-primary)]">Claude-calibrated · <span className="text-[var(--color-text-muted)]">blue = suggested allocation</span></p>
                      )}
                      {deployCalibrationError && (
                        <p className="text-xs text-[var(--color-danger)]">{deployCalibrationError}</p>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--color-border)]">
                            <th className="text-left py-1.5 text-[var(--color-text-muted)] font-medium">Holding</th>
                            <th className="text-right py-1.5 pr-3 text-[var(--color-text-muted)] font-medium">Current</th>
                            <th className="text-right py-1.5 pr-3 text-[var(--color-text-muted)] font-medium">Target</th>
                            <th className="text-right py-1.5 pr-3 text-[var(--color-text-muted)] font-medium">Deploy $</th>
                            {isCalibrated && <th className="text-right py-1.5 pr-3 text-[var(--color-primary)] font-medium">Claude $</th>}
                            <th className="text-right py-1.5 pr-3 text-[var(--color-text-muted)] font-medium">After</th>
                            <th className="text-left py-1.5 text-[var(--color-text-muted)] font-medium">Method</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deployResult.map(r => {
                            const cal = deployCalibration[r.id];
                            const claudeAlloc = cal ? cash * cal.suggestedShare : null;
                            const claudeNewPct = claudeAlloc != null ? ((r.currentValue + claudeAlloc) / newTotal) * 100 : null;
                            const isPlannedRow = allRows.find((ar) => ar.id === r.id)?.isPlanned ?? false;
                            const sharePrice = isPlannedRow && r.ticker ? tickerPrices[r.ticker] : undefined;
                            return (
                              <React.Fragment key={r.id}>
                                <tr className="border-b border-[var(--color-border)]/40 hover:bg-[var(--color-surface-raised)]/30">
                                  <td className="py-2 pr-3">
                                    <p className="font-medium text-[var(--color-text)]">{r.name}</p>
                                    {r.ticker && <p className="font-mono text-[10px] text-[var(--color-text-muted)]">{r.ticker}</p>}
                                    {sharePrice != null && (
                                      <p className="text-[10px] text-[var(--color-text-subtle)] tabular-nums">@ ${sharePrice.toFixed(2)}</p>
                                    )}
                                  </td>
                                  <td className="text-right py-2 pr-3 tabular-nums text-[var(--color-text-muted)]">{r.currentPct.toFixed(1)}%</td>
                                  <td className="text-right py-2 pr-3 tabular-nums text-[var(--color-text-muted)]">{r.targetPct.toFixed(1)}%</td>
                                  <td className="text-right py-2 pr-3 tabular-nums font-semibold text-[var(--color-text)]">
                                    {r.allocation >= 1 ? `$${r.allocation.toFixed(0)}` : "—"}
                                  </td>
                                  {isCalibrated && (
                                    <td className="text-right py-2 pr-3 tabular-nums font-semibold text-[var(--color-primary)]">
                                      {claudeAlloc != null && claudeAlloc >= 1 ? `$${claudeAlloc.toFixed(0)}` : "—"}
                                    </td>
                                  )}
                                  <td className={`text-right py-2 pr-3 tabular-nums font-medium ${Math.abs((claudeNewPct ?? r.newPct) - r.targetPct) < 1.5 ? "text-[var(--color-success,#22c55e)]" : (claudeNewPct ?? r.newPct) > r.targetPct ? "text-amber-500" : "text-[var(--color-text)]"}`}>
                                    {(claudeNewPct ?? r.newPct).toFixed(1)}%
                                  </td>
                                  <td className={`py-2 text-[10px] font-medium ${tagColors[r.tag] ?? ""}`}>
                                    {tagLabels[r.tag] ?? r.tag}
                                  </td>
                                </tr>
                                {cal?.rationale && (
                                  <tr className="border-b border-[var(--color-border)]/20 bg-[var(--color-primary)]/5">
                                    <td colSpan={isCalibrated ? 7 : 6} className="py-1.5 px-3 text-[11px] text-[var(--color-primary)]/80 italic">
                                      {cal.rationale}
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface-raised)]/50">
                            <td colSpan={3} className="py-2 text-xs font-medium text-[var(--color-text-muted)]">Total deployed</td>
                            <td className="text-right py-2 pr-3 tabular-nums font-semibold text-[var(--color-text)]">${totalDeployed.toFixed(0)}</td>
                            {isCalibrated && (
                              <td className="text-right py-2 pr-3 tabular-nums font-semibold text-[var(--color-primary)]">
                                ${(Object.values(deployCalibration).reduce((s, c) => s + c.suggestedShare, 0) * cash).toFixed(0)}
                              </td>
                            )}
                            <td className="text-right py-2 pr-3 tabular-nums text-[var(--color-text-muted)]">{((newTotal / effectiveTotalValue - 1) * 100).toFixed(1)}% growth</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <p className="text-[10px] text-[var(--color-text-subtle)]">✓ within 1.5% of target · Deploy $ = strategy math · Claude $ = calibrated suggestion</p>
                  </div>
                );
              })()}

              {!(parseFloat(deployAmount) > 0) && (
                <p className="text-xs text-[var(--color-text-subtle)]">Enter an amount and click Plan to see a strategy-driven allocation breakdown.</p>
              )}
            </CardContent>
          </Card>

          <StreamingCard
            icon={<TrendingUp size={14} className="text-[var(--color-primary)]" />}
            title={thesisNews ? `Macro Read — "${thesisNews}"` : "Portfolio Thesis"}
            content={thesis}
            streaming={analyzingThesis}
            error={thesisError}
            endRef={thesisEndRef}
            promptPayload={thesisPrompt}
          />

          <StreamingCard
            icon={<Wallet size={14} className="text-[var(--color-primary)]" />}
            title="Investment Plan"
            content={investPlan}
            streaming={analyzingPlan}
            error={investPlanError}
            endRef={investPlanEndRef}
            promptPayload={investPrompt}
          />

          {/* ── Computed optimization schedules ── */}
          {investOptimizations.length > 0 && (
            <div className="flex flex-col gap-3">
              {investOptimizations.map((opt, idx) => {
                const colHeaders = opt.adjustedItems.map(h => h.ticker || h.name.split(" ")[0]);
                const convergeNote = opt.convergedQuarter
                  ? `Converges at Q${opt.convergedQuarter} (~${(opt.convergedQuarter / 4).toFixed(1)} yrs)`
                  : `Does not fully converge within ${opt.quarterlySnapshots.length} quarters`;
                const originalNote = opt.originalConvergedQuarter
                  ? ` · original Q${opt.originalConvergedQuarter}`
                  : "";
                return (
                  <Card key={idx}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold text-[var(--color-primary)] uppercase tracking-wide mb-0.5">
                            Optimization {idx + 1}
                          </p>
                          <CardTitle>{opt.label}</CardTitle>
                        </div>
                        <span className="shrink-0 rounded text-xs px-2 py-1 bg-[var(--color-surface-raised)] border border-[var(--color-border)] text-[var(--color-text-muted)] whitespace-nowrap">
                          {convergeNote}{originalNote}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--color-text-muted)] mt-1">{opt.summary}</p>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-[var(--color-border)]">
                              <th className="text-left py-1.5 pr-3 text-[var(--color-text-muted)] font-medium">Qtr</th>
                              <th className="text-right py-1.5 pr-3 text-[var(--color-text-muted)] font-medium">Portfolio</th>
                              {colHeaders.map((h, i) => (
                                <th key={i} className="text-right py-1.5 pr-3 text-[var(--color-text-muted)] font-medium">{h}</th>
                              ))}
                            </tr>
                            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]/50">
                              <td className="py-1.5 pr-3 font-semibold text-[var(--color-text-muted)]">Target</td>
                              <td className="text-right py-1.5 pr-3 text-[var(--color-text-muted)]">—</td>
                              {opt.adjustedItems.map((item, i) => (
                                <td key={i} className="text-right py-1.5 pr-3 font-semibold text-[var(--color-text)]">
                                  {item.targetPct.toFixed(1)}%
                                </td>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {opt.quarterlySnapshots.map(snap => (
                              <tr key={snap.quarter} className="border-b border-[var(--color-border)]/40 hover:bg-[var(--color-surface-raised)]/30">
                                <td className="py-1.5 pr-3 text-[var(--color-text-muted)]">Q{snap.quarter}</td>
                                <td className="text-right py-1.5 pr-3 text-[var(--color-text)]">${(snap.totalValue / 1000).toFixed(1)}K</td>
                                {snap.weights.map((w, i) => {
                                  const target = opt.adjustedItems[i]?.targetPct ?? 0;
                                  const delta = w - target;
                                  const converged = Math.abs(delta) < 1.5;
                                  return (
                                    <td key={i} className={`text-right py-1.5 pr-3 ${converged ? "text-[var(--color-success,#22c55e)]" : delta > 0 ? "text-amber-500" : "text-[var(--color-text-muted)]"}`}>
                                      {w.toFixed(1)}%{converged ? " ✓" : delta > 0 ? " ▲" : " ▼"}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">✓ within 1.5% of target · ▲ overweight · ▼ underweight</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ── Council output ── */}
          {councilError && (
            <div className="rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
              {councilError}
            </div>
          )}
          {(analystOutput || strategistOutput || summaryOutput) && (
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Council Session</p>
              {summaryOutput && councilPhase === null && (
                <button
                  onClick={handleSaveCouncilPdf}
                  className="flex items-center gap-1.5 text-xs text-[var(--color-primary)] hover:underline"
                >
                  <Download size={12} />
                  Save as PDF
                </button>
              )}
            </div>
          )}
          <div ref={councilOutputRef} className="flex flex-col gap-4">
            {(analystOutput || councilPhase === "analyst") && (
              <div className="relative">
                <div className="absolute -left-0.5 top-0 bottom-0 w-0.5 rounded-full bg-[var(--color-warning)]/40" />
                <StreamingCard
                  icon={<BarChart3 size={14} className="text-[var(--color-warning)]" />}
                  title="Financial Analyst — Capital Deployment"
                  content={analystOutput}
                  streaming={councilPhase === "analyst"}
                  error={null}
                  endRef={analystEndRef}
                  promptPayload={councilAnalystPrompt}
                />
              </div>
            )}
            {(strategistOutput || councilPhase === "strategist") && (
              <div className="relative">
                <div className="absolute -left-0.5 top-0 bottom-0 w-0.5 rounded-full bg-[var(--color-primary)]/40" />
                <StreamingCard
                  icon={<Globe2 size={14} className="text-[var(--color-primary)]" />}
                  title="Macro Strategist — Thesis Alignment & Growth Route"
                  content={strategistOutput}
                  streaming={councilPhase === "strategist"}
                  error={null}
                  endRef={strategistEndRef}
                  promptPayload={councilStrategistPrompt}
                />
              </div>
            )}
            {(summaryOutput || councilPhase === "summary") && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/5">
                <StreamingCard
                  icon={<Zap size={14} className="text-[var(--color-success)]" />}
                  title="Action Summary"
                  content={summaryOutput}
                  streaming={councilPhase === "summary"}
                  error={null}
                  endRef={summaryEndRef}
                  promptPayload={summaryPrompt}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
