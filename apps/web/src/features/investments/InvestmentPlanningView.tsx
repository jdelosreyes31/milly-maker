import React, { useState, useEffect, useRef, useMemo } from "react";
import { AlertTriangle, Plus, Trash2, TrendingUp, Globe2 } from "lucide-react";
import Anthropic from "@anthropic-ai/sdk";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, formatCurrency } from "@milly-maker/ui";
import { Link } from "@tanstack/react-router";
import type { InvestmentHolding } from "@/db/queries/investments.js";
import { ASSET_CLASSES } from "@/db/queries/investments.js";
import { nanoid } from "@/lib/nanoid.js";
import { StrategyIntake } from "./StrategyIntake.js";

// ── Model options ─────────────────────────────────────────────────────────────

const CLAUDE_MODELS = [
  { value: "claude-sonnet-4-5", label: "Sonnet", description: "Faster · recommended" },
  { value: "claude-opus-4-8",   label: "Opus",   description: "Most capable · slower" },
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

// Turn an Anthropic SDK error into something diagnosable: the error class +
// HTTP status. A 401/403 means the API key/billing; a connection error (no
// status) means the request never completed (timeout / dropped / CORS) — not
// the key. A 429 is a rate limit.
function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? `HTTP ${err.status}` : "no HTTP response (connection/timeout)";
    return `${err.name} — ${status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function StreamingCard({
  icon, title, content, streaming, error, endRef, promptPayload, status,
}: {
  icon: React.ReactNode;
  title: string;
  content: string;
  streaming: boolean;
  error: string | null;
  endRef: React.RefObject<HTMLDivElement | null>;
  promptPayload?: PromptPayload;
  status?: string | null;
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
            {streaming && status && (
              <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-primary)]">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-primary)]" />
                <span>{status}</span>
              </div>
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

  // "Invest with Claude" — analyst deposit-allocation plan
  const [buildoutMonths, setBuildoutMonths] = useState("3");
  const [priceNotes, setPriceNotes] = useState("");
  const [investPlan, setInvestPlan] = useState("");
  const [analyzingPlan, setAnalyzingPlan] = useState(false);
  const [investPlanError, setInvestPlanError] = useState<string | null>(null);
  const [investPrompt, setInvestPrompt] = useState<PromptPayload | undefined>();
  const [investActivity, setInvestActivity] = useState<string | null>(null);
  const investPlanEndRef = useRef<HTMLDivElement>(null);

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

  // ── Unified row list ────────────────────────────────────────────────────────

  const allRows: PlanRow[] = [
    ...holdings.map((h) => ({ ...h, isPlanned: false as const })),
    ...plannedHoldings.map((p) => ({ ...p, current_value: p.plannedValue ?? 0, isPlanned: true as const })),
  ];

  const detectedHoldings = useMemo(() => {
    const news = newsTagline.trim();
    if (!news) return [];
    return allRows.filter((r) => {
      if (r.ticker && new RegExp(`\\b${r.ticker}\\b`, "i").test(news)) return true;
      const firstName = r.name.split(/[\s,.(]/)[0] ?? "";
      if (firstName.length >= 4 && new RegExp(`\\b${firstName}\\b`, "i").test(news)) return true;
      return false;
    });
  }, [newsTagline, allRows]);

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

      // Detect portfolio holdings mentioned in the news text
      const mentionedHoldings = news ? allRows.filter((r) => {
        if (r.ticker) {
          // Match ticker as a whole word (case-insensitive, but tickers are usually uppercase)
          const tickerRegex = new RegExp(`\\b${r.ticker}\\b`, "i");
          if (tickerRegex.test(news)) return true;
        }
        // Match company name (first significant word, at least 4 chars to avoid noise)
        const firstName = r.name.split(/[\s,.(]/)[0] ?? "";
        if (firstName.length >= 4) {
          const nameRegex = new RegExp(`\\b${firstName}\\b`, "i");
          if (nameRegex.test(news)) return true;
        }
        return false;
      }) : [];
      const isFocused = mentionedHoldings.length > 0 && mentionedHoldings.length <= 3;

      const newsBlock = news
        ? `**News catalyst:** "${news}"\n\nThis is the macro event or signal you are analyzing the portfolio against. Do not treat it as background color — make it the primary lens for everything that follows.`
        : "";

      const focusedHoldingsList = isFocused
        ? mentionedHoldings.map((h) => `${h.name}${h.ticker ? ` (${h.ticker})` : ""}`).join(", ")
        : "";

      const userMessage = news
        ? isFocused
          ? `${newsBlock}

This news appears to be directly relevant to the following position${mentionedHoldings.length > 1 ? "s" : ""} in my portfolio: **${focusedHoldingsList}**.

Here is my full portfolio for context. Rows marked [PLANNED] are positions I intend to build but don't yet own.

**Portfolio value:** $${totalValue.toFixed(2)}

| Holding | Asset Class | Current Value | Current % | Target % |
|---------|-------------|---------------|-----------|----------|
${holdingsTable}${notesSection}

Focus your analysis on **${focusedHoldingsList}**. Structure your response as:

**1. What this news means for ${focusedHoldingsList}** — what is the real mechanism? Does it change the fundamental thesis, or is it short-term noise? Be specific about how this company/fund is affected.

**2. Magnitude read** — tailwind or headwind, and how significant? Give a directional read on the near-term and long-term impact separately.

**3. Portfolio interaction** — does this news change how this position should be sized relative to the rest of the portfolio? Should the target allocation be reconsidered?

**4. The one thing to watch** — the single follow-on signal that would most change your read.`
          : `${newsBlock}

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
        ? isFocused
          ? `You are a senior equity analyst whose job is to assess the direct impact of a specific news event on a single stock or position. The investor has already identified that this news is relevant to ${focusedHoldingsList} — do not re-litigate that. Go deep on the specific holding.

The investor is 33, growth-oriented, AI-focused, and in the early compounding phase (~$100K milestone 3–4 years out). They want to know whether this news changes the fundamental thesis for this position and what, if anything, they should do about sizing.

Rules:
- Focus almost entirely on the mentioned position(s). Use the broader portfolio only as context for sizing decisions.
- Be opinionated. If this news is bad for the stock, say so directly. If it's a non-event for the fundamental thesis despite the noise, say that too.
- Distinguish between short-term price movement and long-term thesis impact. A 5% gap-down on an earnings miss might be irrelevant to a 3-year thesis — or it might be a signal. Tell the investor which.
- Do not recommend specific buy/sell actions. Do frame the risk/reward change clearly enough that they can decide.
- Be specific. Reference the company's actual business model, not just the sector.`
          : `You are a macro strategist whose job is to translate a specific news event into portfolio-level implications. You are not here to give balanced views — you are here to take the news seriously and tell the investor what it actually means for the positions they hold and the allocation they are targeting.

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

      // Slow, methodical reasoning. Opus 4.8 uses adaptive thinking; Sonnet 4.5
      // (legacy) uses extended thinking with a token budget below max_tokens.
      const thinking: Anthropic.Messages.ThinkingConfigParam =
        model === "claude-sonnet-4-5"
          ? { type: "enabled", budget_tokens: 6000 }
          : { type: "adaptive" };

      let text = "";
      const stream = await client.messages.stream({
        model,
        max_tokens: 16000,
        thinking,
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
      setThesisError(describeApiError(err));
    } finally {
      setAnalyzingThesis(false);
    }
  }

  // ── "Invest with Claude" — analyst deposit-allocation plan ──────────────────
  // Encodes the 3-phase analyst methodology: macro-aware sizing → DCA price
  // awareness → single-name calibration + multi-month cadence. Claude assigns
  // the actual dollar amounts (no pre-computed split fed in).

  async function handleInvestPlan() {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey) return;
    if (!thesis.trim()) {
      setInvestPlanError("Run Analyze first — the deposit plan needs the macro strategist's read to size against.");
      return;
    }
    setAnalyzingPlan(true);
    setInvestPlan("");
    setInvestPlanError(null);
    setInvestActivity(null);

    try {
      const client = buildClient();

      const months = Math.max(1, Math.round(parseFloat(buildoutMonths) || 1));
      const totalOverHorizon = cashNum + monthlyNum * Math.max(0, months - 1);

      // Per-holding facts — current/target weight, cost basis, and unrealized P&L
      // as the DCA signal (below basis = lean in; extended above basis = less urgent).
      const holdingRows = allRows.map((r) => {
        const targetPct = parseFloat(allocations[r.id] ?? "") || 0;
        const currentPct = effectiveTotalValue > 0 ? (r.current_value / effectiveTotalValue) * 100 : 0;
        const ticker = r.ticker ? ` (${r.ticker})` : "";
        const assetLabel = ASSET_CLASSES.find((a) => a.value === r.asset_class)?.label ?? r.asset_class;
        const planned = r.isPlanned ? " [PLANNED]" : "";
        // Cost basis / unrealized only exist for real holdings
        const costBasis = !r.isPlanned ? r.cost_basis : 0;
        const unrealized = !r.isPlanned && costBasis > 0
          ? `${(((r.current_value - costBasis) / costBasis) * 100) >= 0 ? "+" : ""}${(((r.current_value - costBasis) / costBasis) * 100).toFixed(1)}%`
          : "—";
        const shares = !r.isPlanned && r.shares ? r.shares : null;
        const avgCost = shares && costBasis > 0 ? `$${(costBasis / shares).toFixed(2)}` : "—";
        return `| ${r.name}${ticker} | ${assetLabel} | $${r.current_value.toFixed(2)} | ${currentPct.toFixed(1)}% | ${targetPct.toFixed(1)}%${planned} | ${costBasis > 0 ? `$${costBasis.toFixed(2)}` : "—"} | ${unrealized} | ${avgCost} |`;
      }).join("\n");

      const macroBlock = `**Macro strategist notes (from the desk's macro read):**\n${thesis.trim()}`;

      const convictionBlock = notes.trim()
        ? `\n\n**My conviction notes — treat these as deliberate leanings. Respect the conviction itself and weight it heavily, but YOU still decide the actual dollar sizing with your own analytical judgment; note briefly where current data pushes against a lean:**\n${notes.trim()}`
        : "";

      const priceBlock = priceNotes.trim()
        ? `\n\n**Current price / DCA notes:**\n${priceNotes.trim()}`
        : `\n\n**Price / DCA notes:** none provided. Infer DCA opportunities from the Cost Basis / Unrealized columns above — positions below basis or showing losses are candidates to lean into; positions extended above basis have less urgency.`;

      const userMessage =
        `Here is my current portfolio and target allocations. Rows marked [PLANNED] are positions I intend to build but don't yet own.

**This deposit:** $${cashNum.toFixed(2)} — treat as Month 1 of ${months}.
**Planned cadence:** $${monthlyNum.toFixed(2)}/month for ${months} month${months === 1 ? "" : "s"} (~$${totalOverHorizon.toFixed(0)} total over the build-out).
**Portfolio value:** $${effectiveTotalValue.toFixed(2)} → $${(effectiveTotalValue + cashNum).toFixed(2)} after this deposit.

| Holding | Asset Class | Current Value | Current % | Target % | Cost Basis | Unrealized | Avg Cost/sh |
|---------|-------------|---------------|-----------|----------|------------|------------|-------------|
${holdingRows}

${macroBlock}${convictionBlock}${priceBlock}

Research current conditions and how each holding is performing against the thesis it was bought for, decide whether to RAISE / MAINTAIN / REDUCE each holding's target, flag any DCA opportunities to buy at a lower price, then deploy this $${cashNum.toFixed(0)} deposit toward where conviction is rising and where the dips are — NOT as a balance against my existing target weights. The per-holding dollars for THIS deposit must sum to exactly $${cashNum.toFixed(0)}.`;

      const systemPrompt =
        `You are a financial analyst on a strategic wealth investment team. Your job is NOT to balance a deposit against the investor's existing target weights. It is to: (1) research current conditions and judge how each holding is performing against the thesis it was bought for, (2) decide whether to RAISE, MAINTAIN, or REDUCE each holding's target, (3) flag DCA opportunities where a holding can be bought at a lower price, and (4) deploy the incoming deposit toward where conviction is rising and where the dips are. The investor's target % is a starting point you revise — not a number to hit.

Work slowly and methodically — think the deposit through step by step before committing to numbers, the way a desk analyst would. Narrate each phase in a short line of plain text as you work (e.g. "Researching the macro backdrop…", "Now the single-name catalysts…", "Verifying the dollars sum…") so the reader can follow your process.

Process — work through these phases IN ORDER:
1. **Macro research.** Web-search the current backdrop: major index levels and consensus / year-end targets, the rate and inflation path, sector rotation. This sets the near-term view.
2. **Thesis-vs-performance research.** Run a SECOND wave of web searches on each holding and its theme — how is it actually performing, and is the thesis it was bought for intact, strengthening, or breaking? Cover the single names and the thematic sleeves (uranium, copper, oil, semis, etc.). Keep it separate from the macro wave.
3. **Target review — the core step.** For EACH holding, decide RAISE / MAINTAIN / REDUCE its end-state target, justified by the research: thesis strengthening or leadership confirmed → raise; intact → maintain; weakening, over-extended / over-concentrated, or carrying single-name tail risk too large for this book → reduce. The investor's target is a starting guess you are revising, not a number to hit.
4. **DCA pass — independent of targets.** Separately, find the buy-at-a-lower-price opportunities: holdings below the investor's average cost / near lows, or a discount the macro read says won't last. These matter regardless of weight.
5. **Size this deposit, then VERIFY.** Deploy the deposit toward (3) the targets you raised and (4) the DCA dips — fund rising conviction and cheap entries. Confirm the dollars sum to EXACTLY the deposit before you write anything; restate the running total and fix any mismatch first.
6. **Multi-month sketch.** Lay out how the remaining monthly deposits build toward the revised targets.

Operating principles:
- **Research the current economy first.** Your training data is not current and the macro notes may be dated. Before sizing anything, USE THE WEB SEARCH TOOL to verify the present backdrop — major index levels and consensus / year-end targets, the rate and inflation picture, sector rotation, and any catalysts specific to these holdings. Base your near-term view on what you actually find, cite it, and never fabricate figures.
- **Real allocation math.** Assign an actual dollar amount of the deposit to each holding. The amounts MUST sum to exactly the deposit size. Do not return percentages-only.

**This is a capital DEPLOYMENT, not a rebalance.** Do NOT default to "fund the underweights, defer the overweights." A holding's distance from its target weight is background context, not the decision. Specifically: never give a name $0 or a token amount because it is "already at/above target" — neither the investor's stated target NOR a lower target you just calibrated for it — and never on the logic that "buying elsewhere will dilute its weight." Targets are a starting guess; when conviction or the macro read warrants, you may set a holding's end-state target ABOVE the investor's stated number and say so. The question to answer for each dollar is "what does it accomplish?", not "how far is this from target?"

Fund SEVERAL objectives in the same deposit — a normal deposit does more than one of these at once, so don't collapse the whole thing onto a single axis (e.g. only the cheap underweights):
- **Conviction / leadership.** Names the macro read or the investor's conviction notes lean into get funded meaningfully — they can take the largest tranche, staged into strength. Being overweight or extended above basis is NOT a reason to cut them to a token amount.
- **Time-sensitive dips.** A holding below the investor's average cost / near lows, or a discount the macro read says won't last, gets front-loaded NOW. Lean a diversified-ETF dip freely; capture a single-name dip but cap the size.
- **Legging in.** To "leg in" a position is to START it THIS deposit with a small tranche and continue over the following months — it is NOT $0 now and begin later. This is how you DCA into single names without one large entry.
- **No-rush sleeves.** At/above basis, diversified, no catalyst, no conviction lean → THESE are the holdings to underfund or defer this month; future deposits fund them.

- **Single-name risk is a binding constraint for a small/growing book.** Individual companies (not ETFs) carry idiosyncratic tail risk — right-size them and leg them in (start now, small) rather than one big entry. Diversified ETFs can be leaned without that risk.
- **Multi-month build-out.** You are NOT cramming to target in one deposit — plan a sustained build over the horizon. But every deposit, including this one, should already be deploying across the objectives above, not parking capital for later.
- If you dismiss or defer part of the portfolio this deposit, be concise about why.

Output as markdown, in this order:
1. **Near-term view** — a short paragraph grounding the macro backdrop in *current, web-searched* data (cite the index levels / consensus / rates you found), combined with the macro strategist's notes.
2. **Target review** — the core section. A table covering every holding whose target you're changing (plus any you deliberately MAINTAIN for a reason worth stating): Holding | Current target | Verdict (Raise / Maintain / Reduce) | New target | Why (tie it to the research and how the thesis is performing). This — not balancing to the old targets — is what drives the deposit.
3. **DCA opportunities** — a short list of holdings trading below the investor's cost or near lows that are worth buying at the lower price this deposit, each with the level / figure. If there are none, say so in a line.
4. **Finalized model — this deposit (Month 1 of N)** — a table: Holding | This deposit $ | Weight after | Revised target | Logic this month. Order by dollar amount descending. The "This deposit $" column MUST sum to exactly the deposit; state the sum under the table.
5. **Months 2–N build-out** — a bulleted cycle plan showing how the remaining monthly deposits build toward the revised targets (which positions get the next tranches, when single names complete, what's deferred). This is the months-cycle indicator.
6. **Reasoning notes** — a few short paragraphs on the key trade-offs and where one signal overrode another.
7. A one-line caveat that this is analysis to inform decisions, not personalized investment advice.

Be specific — reference tickers and dollar amounts throughout.`;

      setInvestPrompt({ system: systemPrompt, user: userMessage });

      // Slow, methodical reasoning. Opus 4.8 uses adaptive thinking; Sonnet 4.5
      // (legacy) uses extended thinking with a token budget below max_tokens.
      const thinking: Anthropic.Messages.ThinkingConfigParam =
        model === "claude-sonnet-4-5"
          ? { type: "enabled", budget_tokens: 6000 }
          : { type: "adaptive" };

      // Web search lets the analyst ground the near-term view in current economic
      // data (index levels, consensus, rates, sector rotation) instead of stale
      // training data — this is what makes "research the current economy" real.
      // The 20260209 version filters results in-context for accuracy/efficiency.
      const tools: Anthropic.Messages.ToolUnion[] = [
        // Two research waves (macro, then per-holding catalysts) — give it room
        // so it doesn't hit the cap mid-process like a 6-search budget does.
        { type: "web_search_20260209", name: "web_search", max_uses: 10 },
      ];

      let text = "";
      let searchCount = 0;
      setInvestActivity("Thinking through the deposit…");
      const stream = await client.messages.stream({
        model,
        max_tokens: 16000,
        thinking,
        tools,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      for await (const chunk of stream) {
        // Surface what's happening during the silent gaps (thinking / web search)
        // so the user can tell the run is alive rather than stuck.
        if (chunk.type === "content_block_start") {
          const block = chunk.content_block;
          if (block.type === "thinking") {
            setInvestActivity("Thinking through the deposit…");
          } else if (block.type === "server_tool_use" && block.name === "web_search") {
            searchCount += 1;
            setInvestActivity(`Searching the web… (search ${searchCount})`);
          } else if (block.type === "web_search_tool_result") {
            setInvestActivity("Reading search results…");
          } else if (block.type === "text") {
            setInvestActivity("Writing the plan…");
          }
        } else if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          text += chunk.delta.text;
          setInvestPlan(text);
        }
      }
    } catch (err) {
      setInvestPlanError(describeApiError(err));
    } finally {
      setInvestActivity(null);
      setAnalyzingPlan(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">

      {/* ── Strategy intake (This or That) ── */}
      <StrategyIntake holdings={holdings} totalValue={totalValue} />

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
            <Input
              label="Build-out (months)"
              type="number"
              min="1"
              max="24"
              step="1"
              value={buildoutMonths}
              onChange={(e) => setBuildoutMonths(e.target.value)}
              placeholder="3"
              hint="Months to leg the deposit plan over"
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
              <Globe2 size={13} className="absolute left-2.5 top-3 text-[var(--color-text-subtle)] pointer-events-none" />
              <textarea
                value={newsTagline}
                onChange={e => setNewsTagline(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && e.metaKey && !analyzingThesis && allRows.length > 0) void handlePortfolioThesis(); }}
                placeholder="Paste a headline or full article to analyze your positions against it — or leave blank for a general thesis"
                rows={3}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] pl-7 pr-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-primary)] focus:outline-none resize-y"
              />
              {detectedHoldings.length > 0 && detectedHoldings.length <= 3 && (
                <p className="mt-1 text-xs text-[var(--color-primary)]">
                  Focusing analysis on {detectedHoldings.map((h) => h.ticker || h.name).join(", ")}
                </p>
              )}
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
          {/* ── Optional price / DCA notes ── */}
          <textarea
            value={priceNotes}
            onChange={e => setPriceNotes(e.target.value)}
            placeholder="Optional — paste current prices or DCA notes (e.g. 'QQQM 246.08, VGIT at 52-wk lows'). Leave blank to let the analyst infer DCA opportunities from your cost basis."
            rows={2}
            className="w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-primary)] focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleInvestPlan}
              disabled={analyzingPlan || allRows.length === 0 || !(cashNum > 0) || !thesis.trim()}
              title={!thesis.trim()
                ? "Run Analyze first — the deposit plan needs the macro read to size against"
                : "The analyst sizes this deposit across your holdings using the macro read, DCA signals, and your monthly cadence"}
            >
              <TrendingUp size={14} />
              {analyzingPlan ? "Planning…" : "Invest with Claude"}
            </Button>
            <span className="text-xs text-[var(--color-text-muted)]">
              {!thesis.trim()
                ? <span className="text-[var(--color-warning)]">Run Analyze first to attach a macro read</span>
                : cashNum > 0
                  ? `Allocates this $${cashNum.toLocaleString()} deposit · Month 1 of ${Math.max(1, Math.round(parseFloat(buildoutMonths) || 1))} · thinks + web-researches current markets (slower)`
                  : "Enter a cash amount above to plan a deposit"}
            </span>

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
            icon={<TrendingUp size={14} className="text-[var(--color-success)]" />}
            title={`Investment Plan — Month 1 of ${Math.max(1, Math.round(parseFloat(buildoutMonths) || 1))}`}
            content={investPlan}
            streaming={analyzingPlan}
            error={investPlanError}
            endRef={investPlanEndRef}
            promptPayload={investPrompt}
            status={investActivity}
          />

        </div>
      )}
    </div>
  );
}
