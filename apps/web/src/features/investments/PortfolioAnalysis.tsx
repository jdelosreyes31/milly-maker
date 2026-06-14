import React, { useMemo, useState } from "react";
import Anthropic from "@anthropic-ai/sdk";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, Loader2, RotateCcw } from "lucide-react";
import type {
  Investment,
  InvestmentHolding,
  HoldingLot,
  InvestmentContribution,
} from "@/db/queries/investments.js";
import { ASSET_CLASSES } from "@/db/queries/investments.js";

interface Props {
  holdings: InvestmentHolding[];
  soldHoldings: InvestmentHolding[];
  investments: Investment[];
  lots: HoldingLot[];
  contributions: InvestmentContribution[];
  totalValue: number;
}

const MdComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="mb-3 mt-5 text-base font-semibold text-[var(--color-text)] first:mt-0">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="mb-2 mt-4 text-sm font-semibold text-[var(--color-text)] first:mt-0">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="mb-1.5 mt-3 text-sm font-medium text-[var(--color-text)] first:mt-0">{children}</h3>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 text-sm leading-relaxed text-[var(--color-text)] last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-[var(--color-text)]">{children}</strong>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-3 ml-4 list-disc space-y-1 text-sm text-[var(--color-text)] last:mb-0">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm text-[var(--color-text)] last:mb-0">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
  table: ({ children }: { children?: React.ReactNode }) => <div className="mb-3 overflow-x-auto last:mb-0"><table className="w-full border-collapse text-sm">{children}</table></div>,
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">{children}</thead>,
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody className="divide-y divide-[var(--color-border-subtle)]">{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr className="hover:bg-[var(--color-surface-raised)]/50">{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="px-3 py-2 font-medium">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="px-3 py-2 tabular-nums text-[var(--color-text)]">{children}</td>,
};

const SYSTEM_PROMPT = `You are a seasoned macro strategist writing a candid desk note for a retail investor. You are looking at a snapshot of their portfolio.

You receive: the current holdings with their allocations / cost basis / market value / unrealized P&L, the cash funding history (so you know how much capital went in and over what window), any closed positions, and a transaction log purely as supporting detail.

Analyze in THIS order — do not lead with a play-by-play of their trades:

1. **Read the allocation, infer the thesis.** Start from the CURRENT state — what the portfolio is actually weighted toward right now (sectors, asset classes, individual names, concentration). From that allocation alone, articulate the macro thesis this book is expressing. What regime / view is this positioning a bet on? Name it clearly.
2. **Performance vs. thesis over time.** Using the funding window and P&L, judge how this thesis has played out so far. Total capital in vs. current value, realized + unrealized, which sleeves carried it and which dragged. Be specific with dollars and percentages. Is the thesis working?
3. **The road ahead — mini forecast.** Look forward. Given the current positioning and the macro backdrop (rates, growth, inflation, AI/tech capex cycle, sector rotation), what is the outlook for this book? What are the key risks and tailwinds.
4. **What to watch next quarter.** 3–5 concrete signposts / catalysts the investor should monitor over the next ~3 months that would confirm or break the thesis.
5. **Allocation guidance.** Be opinionated: where should they lean in harder, where should they trim or diversify? Tie each recommendation to the thesis and the road ahead.

Important context about this investor: **they are intentionally going for an AI-heavy lean.** If the allocations look concentrated in AI / semiconductors / hyperscalers / data-center & power infrastructure / AI-adjacent compute, that is the deliberate thesis — treat it as the through-line, evaluate how well the book expresses it, and advise on sharpening it (including the second-order plays: power, memory, networking, cooling, sovereign-AI) and on managing the concentration risk that comes with it.

Style: direct, numbers-first, opinionated but honest about uncertainty. No motivational fluff, no generic disclaimers beyond a one-line caveat that you only see logged marks, not live quotes. Use markdown with short sections and tables where helpful. Keep it tight — a sharp one-page desk note, not an essay.`;

function buildContext(p: Props): string {
  const { holdings, soldHoldings, investments, lots, contributions, totalValue } = p;
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const classLabel = (c: string) => ASSET_CLASSES.find((a) => a.value === c)?.label ?? c;
  const invName = (id: string) => investments.find((i) => i.id === id)?.name ?? "Unknown account";
  const holdingName = (id: string) => {
    const h = holdings.find((x) => x.id === id) ?? soldHoldings.find((x) => x.id === id);
    return h ? `${h.name}${h.ticker ? ` (${h.ticker})` : ""}` : "Unknown";
  };

  // ── Funding timeline (cash deposits only) ──
  const deposits = [...contributions].sort((a, b) => a.contribution_date.localeCompare(b.contribution_date));
  const totalFunded = deposits.reduce((s, c) => s + c.amount, 0);
  const fundingLines = deposits.length
    ? deposits.map((c) => `  - ${c.contribution_date} | +${fmt(c.amount)} into ${c.investment_name ?? invName(c.investment_id)}${c.notes ? ` — ${c.notes}` : ""}`).join("\n")
    : "  (no cash deposits logged)";

  // ── Event counts per holding (buys/sells logged) ──
  const eventsByHolding = new Map<string, { buys: number; sells: number }>();
  for (const l of lots) {
    const e = eventsByHolding.get(l.holding_id) ?? { buys: 0, sells: 0 };
    if (l.transaction_type === "sell") e.sells += 1;
    else e.buys += 1;
    eventsByHolding.set(l.holding_id, e);
  }
  const eventSummary = (id: string) => {
    const e = eventsByHolding.get(id);
    if (!e) return "0 events";
    return `${e.buys + e.sells} events (${e.buys} buy${e.buys !== 1 ? "s" : ""}, ${e.sells} sell${e.sells !== 1 ? "s" : ""})`;
  };

  // ── Current holdings ──
  const totalCost = holdings.reduce((s, h) => s + h.cost_basis, 0);
  const holdingLines = holdings.length
    ? holdings
        .slice()
        .sort((a, b) => b.current_value - a.current_value)
        .map((h) => {
          const pnl = h.current_value - h.cost_basis;
          const ret = h.cost_basis > 0 ? (pnl / h.cost_basis) * 100 : 0;
          const wt = totalValue > 0 ? (h.current_value / totalValue) * 100 : 0;
          return `  - ${h.name}${h.ticker ? ` (${h.ticker})` : ""} [${classLabel(h.asset_class)}] · ${h.shares ?? 0} sh · cost ${fmt(h.cost_basis)} · value ${fmt(h.current_value)} · P&L ${pnl >= 0 ? "+" : ""}${fmt(pnl)} (${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%) · ${wt.toFixed(1)}% of book · ${eventSummary(h.id)}`;
        })
        .join("\n")
    : "  (no open holdings)";

  // ── Closed positions ──
  const closedLines = soldHoldings.length
    ? soldHoldings
        .map((h) => {
          const pnl = h.current_value - h.cost_basis;
          return `  - ${h.name}${h.ticker ? ` (${h.ticker})` : ""} · cost ${fmt(h.cost_basis)} · proceeds ${fmt(h.current_value)} · realized ${pnl >= 0 ? "+" : ""}${fmt(pnl)} · ${eventSummary(h.id)}`;
        })
        .join("\n")
    : "  (none)";

  // ── Transaction log (chronological) ──
  const txLines = [...lots]
    .sort((a, b) => a.purchased_at.localeCompare(b.purchased_at))
    .map((l) => {
      const t = l.transaction_type === "sell" ? "SELL" : "BUY";
      return `  - ${l.purchased_at.slice(0, 10)} | ${t} ${l.shares} ${holdingName(l.holding_id)} @ ${fmt(l.price_per_share)} = ${fmt(l.shares * l.price_per_share)}`;
    })
    .join("\n");

  const totalPnL = totalValue - totalCost;
  const idleCash = totalFunded - totalCost; // funded but not deployed into cost basis (rough proxy)

  // ── Allocation by asset class (current state) ──
  const byClass = new Map<string, number>();
  for (const h of holdings) byClass.set(h.asset_class, (byClass.get(h.asset_class) ?? 0) + h.current_value);
  const allocLines = [...byClass.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cls, val]) => `  - ${classLabel(cls)}: ${fmt(val)} (${totalValue > 0 ? ((val / totalValue) * 100).toFixed(1) : "0"}% of book)`)
    .join("\n") || "  (no open holdings)";

  // ── Funding window ──
  const firstFund = deposits[0]?.contribution_date;
  const lastFund = deposits[deposits.length - 1]?.contribution_date;
  const fundingWindow = firstFund ? `${firstFund} → ${lastFund} (${deposits.length} deposit${deposits.length !== 1 ? "s" : ""})` : "none logged";

  return `## Portfolio snapshot (as of ${new Date().toISOString().slice(0, 10)})

**Current market value (logged marks):** ${fmt(totalValue)}
**Total cost basis (open positions):** ${fmt(totalCost)}
**Unrealized P&L (open):** ${totalPnL >= 0 ? "+" : ""}${fmt(totalPnL)}${totalCost > 0 ? ` (${((totalPnL / totalCost) * 100).toFixed(1)}%)` : ""}
**Total cash funded:** ${fmt(totalFunded)} over funding window ${fundingWindow}
**Approx. uninvested / cash drag (funded − cost basis):** ${fmt(idleCash)}

### Current allocation by asset class (START HERE — this defines the thesis)
${allocLines}

### Open holdings (current positions, weighted)
${holdingLines}

### Closed / realized positions
${closedLines}

### Cash funding timeline (for the "over time" performance read)
${fundingLines}

### Transaction log (SUPPORTING DETAIL ONLY — do not narrate this)
${txLines || "  (no transactions)"}

Note: market values are the investor's logged marks, not live quotes. Reason about thesis and relative positioning, and caveat that you can't see real-time prices.`;
}

export function PortfolioAnalysis(props: Props) {
  const [analysis, setAnalysis] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasData = props.lots.length > 0 || props.holdings.length > 0;

  const context = useMemo(() => buildContext(props), [props]);

  async function run() {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey) {
      setError("No API key found. Add your Anthropic API key in Settings to use this feature.");
      return;
    }
    setStreaming(true);
    setError(null);
    setAnalysis("");
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const stream = await client.messages.stream({
        model: "claude-opus-4-8",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Here is the current state of my portfolio. Start from the allocation, infer my macro thesis, judge how it's done over the funding window, then forecast the road ahead, what to watch next quarter, and where I should lean my allocation.\n\n${context}`,
          },
        ],
      });
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          const text = chunk.delta.text;
          setAnalysis((prev) => prev + text);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles size={14} className="text-[var(--color-primary)]" />
            Macro strategist read
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Claude reads your current allocation to name your macro thesis, grades how it's performed, then forecasts the road ahead and where to lean next quarter.
          </p>
        </div>
        <button
          onClick={() => void run()}
          disabled={streaming || !hasData}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {streaming ? (
            <><Loader2 size={13} className="animate-spin" /> Analyzing…</>
          ) : analysis ? (
            <><RotateCcw size={13} /> Re-analyze</>
          ) : (
            <><Sparkles size={13} /> Analyze with Claude</>
          )}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}

      {analysis && (
        <div className="mt-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]/40 p-4 prose-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MdComponents}>
            {analysis}
          </ReactMarkdown>
          {streaming && <span className="inline-block h-3 w-1.5 animate-pulse bg-[var(--color-primary)] align-middle" />}
        </div>
      )}
    </div>
  );
}
