import { useState, useCallback } from "react";
import Anthropic from "@anthropic-ai/sdk";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { useDb } from "@/db/hooks/useDb.js";
import { getAllDebts } from "@/db/queries/debts.js";
import { getAllInvestments } from "@/db/queries/investments.js";
import { getCheckingBalanceSummary, getTransactionsForAccount } from "@/db/queries/checking.js";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

async function buildFinancialContext(conn: AsyncDuckDBConnection): Promise<string> {
  const [debts, investments, checkingBalances, allTransactions] = await Promise.all([
    getAllDebts(conn),
    getAllInvestments(conn),
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

  const investmentLines = investments
    .map((i) => `  - ${i.name} (${i.account_type}): $${i.current_value.toFixed(2)}, contributing $${i.monthly_contribution}/mo`)
    .join("\n");

  const checkingLines = checkingBalances
    .map((a) => `  - ${a.account_name}: $${a.current_balance.toFixed(2)}`)
    .join("\n");

  const recentDebitLines = recentDebits
    .map((t) => `  - ${t.transaction_date} | ${t.description}: -$${t.amount.toFixed(2)} (${t.account_name})`)
    .join("\n");

  return `## User's Current Financial Snapshot

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

**Investments:**
${investmentLines || "  None tracked."}
`;
}

const SYSTEM_PROMPT = `You are a direct, numbers-focused personal financial analyst assistant. You have access to the user's live financial data below.

Your job is to give clear, actionable financial advice. Be concise and specific — use the user's actual numbers. Don't hedge excessively. Don't add motivational fluff. Focus on the math and what to do.

When the user asks about debt payoff, use the avalanche or snowball method as appropriate. When discussing investments, use realistic return assumptions. When asked for projections, show the math.`;

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
          model: "claude-opus-4-6",
          max_tokens: 1024,
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
