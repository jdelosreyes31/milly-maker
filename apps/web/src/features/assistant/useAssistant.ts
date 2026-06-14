import { useState, useCallback } from "react";
import Anthropic from "@anthropic-ai/sdk";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { useDb } from "@/db/hooks/useDb.js";
import { getAllDebts } from "@/db/queries/debts.js";
import { getAllInvestments, getAllHoldings } from "@/db/queries/investments.js";
import { getCheckingBalanceSummary, getTransactionsForAccount } from "@/db/queries/checking.js";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

function getDayContext(): string {
  const now = new Date();
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
  const isMonday = now.getDay() === 1;
  const isFriday = now.getDay() === 5;
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  let note = `Today is ${dayName}, ${dateStr}.`;
  if (isMonday) {
    note += " It's Monday — the first trading day of the week. Monday opens frequently gap from Friday's close based on weekend sentiment and last week's price action. A gap-down open on a fundamentally strong stock is often an VWAP-relative entry opportunity, not a red flag.";
  } else if (isFriday) {
    note += " It's Friday — end of the trading week. Consider how current prices will inform Monday's open if held over the weekend.";
  } else if (isWeekend) {
    note += " Markets are closed. Next open is Monday — factor in potential gap from Friday's close when sizing entries.";
  }
  return note;
}

async function buildFinancialContext(conn: AsyncDuckDBConnection): Promise<string> {
  const [debts, investments, holdings, checkingBalances, allTransactions] = await Promise.all([
    getAllDebts(conn),
    getAllInvestments(conn),
    getAllHoldings(conn),
    getCheckingBalanceSummary(conn),
    getTransactionsForAccount(conn, "ALL"),
  ]);

  const totalDebt = debts.reduce((s, d) => s + d.current_balance, 0);
  const totalInvestments = investments.reduce((s, i) => s + i.current_value, 0);
  const totalChecking = checkingBalances.reduce((s, a) => s + a.current_balance, 0);
  const netWorth = totalInvestments + totalChecking - totalDebt;

  // Recent debits (last 10)
  const recentDebits = [...allTransactions]
    .filter((t) => t.type === "debit")
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    .slice(0, 10);

  const debtLines = debts
    .map((d) => `  - ${d.name}: $${d.current_balance.toFixed(2)} @ ${(d.interest_rate * 100).toFixed(2)}% APR, min $${d.minimum_payment}/mo`)
    .join("\n");

  const checkingLines = checkingBalances
    .map((a) => `  - ${a.account_name}: $${a.current_balance.toFixed(2)}`)
    .join("\n");

  const recentDebitLines = recentDebits
    .map((t) => `  - ${t.transaction_date} | ${t.description}: -$${t.amount.toFixed(2)} (${t.account_name})`)
    .join("\n");

  // Build per-account holdings breakdown with price, weight, and gain/loss
  const accountSections = investments.map((inv) => {
    const acctHoldings = holdings.filter((h) => h.investment_id === inv.id);
    if (acctHoldings.length === 0) {
      return `  ${inv.name} (${inv.account_type}): $${inv.current_value.toFixed(2)} — no individual holdings tracked`;
    }

    const holdingLines = acctHoldings.map((h) => {
      const weight = inv.current_value > 0 ? (h.current_value / inv.current_value) * 100 : 0;
      const gainLoss = h.current_value - h.cost_basis;
      const gainLossPct = h.cost_basis > 0 ? (gainLoss / h.cost_basis) * 100 : 0;
      const pricePerShare = h.shares && h.shares > 0 ? h.current_value / h.shares : null;
      const costPerShare = h.shares && h.shares > 0 ? h.cost_basis / h.shares : null;

      const priceLine = pricePerShare != null && costPerShare != null
        ? `, price ~$${pricePerShare.toFixed(2)}/sh (avg cost $${costPerShare.toFixed(2)}/sh)`
        : "";
      const glSign = gainLoss >= 0 ? "+" : "";
      return `    · ${h.ticker ?? h.name}: $${h.current_value.toFixed(2)} (${weight.toFixed(1)}% of acct)${priceLine}, P&L ${glSign}$${gainLoss.toFixed(2)} (${glSign}${gainLossPct.toFixed(1)}%), ${h.shares?.toFixed(4) ?? "?"} shares`;
    }).join("\n");

    return `  ${inv.name} (${inv.account_type}) — $${inv.current_value.toFixed(2)} total, $${inv.monthly_contribution}/mo contribution:\n${holdingLines}`;
  }).join("\n\n");

  return `## User's Current Financial Snapshot

**Trading Day Context:** ${getDayContext()}

**Net Worth:** $${netWorth.toFixed(2)}
**Total Debt:** $${totalDebt.toFixed(2)}
**Total Investments:** $${totalInvestments.toFixed(2)}
**Checking Balance:** $${totalChecking.toFixed(2)}

**Checking Accounts:**
${checkingLines || "  None set up."}

**Recent Debits:**
${recentDebitLines || "  No transactions recorded."}

**Debts:**
${debtLines || "  None tracked."}

**Investment Accounts & Holdings:**
${accountSections || "  None tracked."}
`;
}

const SYSTEM_PROMPT = `You are a direct, numbers-focused personal financial analyst and trading strategist. You have access to the user's live financial data below.

Your job is to give clear, actionable advice. Be concise and specific — use the user's actual numbers. Don't hedge excessively. Don't add motivational fluff. Focus on the math and what to do.

## Debt
When asked about debt payoff, use the avalanche or snowball method as appropriate.

## Investments & Trade Entries
When evaluating whether to buy or add to a position, reason about price relative to VWAP (Volume Weighted Average Price). If the user provides the current price and asks about an entry:
- Price below VWAP = favorable intraday entry — price is tracking below the average paid by all participants today
- Price above VWAP = chasing; consider waiting for a pullback or scaling in
- If the user doesn't have VWAP handy, suggest they check it on their broker/charting tool before sizing in

**Monday opens:** The first trade of the week frequently gaps from Friday's close based on weekend sentiment and last week's accumulated selling pressure. A Monday gap-down on a fundamentally strong growth stock is often a VWAP-relative opportunity — flag this explicitly when the day context shows it's Monday or the weekend.

**Conviction over rebalancing:** Do NOT recommend skipping an add to a strong growth position just because it's already heavily weighted in the portfolio. Portfolio weight is a trailing number — it reflects past performance, not future potential. If a stock has strong momentum, the right answer is usually to strengthen the position, not to artificially limit it for balance. Only flag concentration risk if the position is so large it creates unacceptable downside (e.g. >40% of total net worth in one ticker). Otherwise, lean into winners.

When asked for projections, show the math. When asked about position sizing, use actual dollar amounts from the user's data.`;

export function useAssistant() {
  const { conn } = useDb();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (userText: string) => {
      const apiKey = localStorage.getItem("anthropicApiKey");
      if (!apiKey) {
        setError("No API key. Go to Settings to add your Anthropic API key.");
        return;
      }
      if (!conn) return;

      const newMessages: Message[] = [...messages, { role: "user", content: userText }];
      setMessages(newMessages);
      setStreaming(true);
      setError(null);

      try {
        const context = await buildFinancialContext(conn);
        const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

        let assistantText = "";
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        const stream = await client.messages.stream({
          model: "claude-opus-4-8",
          max_tokens: 2048,
          system: `${SYSTEM_PROMPT}\n\n${context}`,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        });

        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            assistantText += chunk.delta.text;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "assistant", content: assistantText };
              return updated;
            });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        // Remove the empty assistant placeholder on error
        setMessages((prev) => prev.filter((_, i) => i < prev.length - 1));
      } finally {
        setStreaming(false);
      }
    },
    [conn, messages]
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, streaming, error, sendMessage, clearHistory };
}
