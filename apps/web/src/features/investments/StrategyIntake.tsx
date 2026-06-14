import React, { useState } from "react";
import Anthropic from "@anthropic-ai/sdk";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent, CardHeader, CardTitle } from "@milly-maker/ui";
import { Compass, Loader2, RotateCcw, ArrowRight } from "lucide-react";
import type { InvestmentHolding } from "@/db/queries/investments.js";
import { ASSET_CLASSES } from "@/db/queries/investments.js";

interface Props {
  holdings: InvestmentHolding[];
  totalValue: number;
}

interface Dilemma {
  id: string;
  tension: string;       // short framing of the trade-off
  a: { label: string; gist: string };
  b: { label: string; gist: string };
  why: string;           // why this matters for them specifically
}

type Pick = "a" | "b" | null;

const MODEL = "claude-opus-4-8";

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
  th: ({ children }: { children?: React.ReactNode }) => <th className="px-3 py-2 font-medium">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="px-3 py-2 text-[var(--color-text)]">{children}</td>,
};

const QUESTION_SYSTEM = `You are a sharp macro strategist running a Socratic intake with an investor before they set a plan. Your goal is NOT to judge — it's to make them think hard about what they're actually trying to do by forcing crisp trade-offs.

You will be given their current portfolio allocation. Produce a set of "This or That" dilemmas — binary forks where each side is a legitimate, defensible strategy, not a right-vs-wrong. Each fork should surface a real tension in how they could run this book (e.g. concentrate vs. diversify, conviction vs. risk control, ride winners vs. take profits, thematic purity vs. hedging, time-in vs. timing, income vs. growth).

Tailor the dilemmas to what their allocation reveals. If the book is clearly AI/tech-concentrated, lean into the dilemmas that an AI-heavy investor actually faces (purity of the AI bet vs. hedging the rate/regime risk; picks-and-shovels vs. application layer; mega-cap safety vs. higher-beta second-order plays like power/memory/networking).

Return ONLY a JSON object, no prose, of the form:
{"dilemmas":[{"id":"q1","tension":"<6-10 word name of the trade-off>","a":{"label":"<short This option, <=6 words>","gist":"<one sentence on what choosing this commits them to>"},"b":{"label":"<short That option, <=6 words>","gist":"<one sentence>"},"why":"<one sentence on why this fork matters given THEIR holdings>"}]}

Produce 6 dilemmas. Keep every string tight.`;

const SYNTH_SYSTEM = `You are a macro strategist debriefing an investor after they answered a set of "This or That" strategy forks. Each answer reveals a preference; together they imply a coherent (or conflicting) strategy.

Given their current allocation and their picks, write a short, sharp desk note that:
1. **Names the strategy their answers reveal** — state, in one or two sentences, the investing personality and mandate their choices add up to.
2. **Flags the tensions** — call out where their picks contradict each other or contradict their current allocation. Be specific.
3. **Translates to a mandate** — 3–5 concrete rules-of-thumb / guardrails that follow from their revealed preferences (e.g. max single-name weight, when to trim, what to add on weakness).
4. **One pointed question back** — end with a single hard question that they still haven't resolved.

Assume an AI-heavy lean is intentional unless their picks say otherwise. Direct, numbers-aware, no fluff, no generic disclaimers. Markdown, tight.`;

function buildAllocationContext(holdings: InvestmentHolding[], totalValue: number): string {
  const classLabel = (c: string) => ASSET_CLASSES.find((a) => a.value === c)?.label ?? c;
  const byClass = new Map<string, number>();
  for (const h of holdings) byClass.set(h.asset_class, (byClass.get(h.asset_class) ?? 0) + h.current_value);
  const classLines = [...byClass.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `  - ${classLabel(c)}: ${totalValue > 0 ? ((v / totalValue) * 100).toFixed(1) : "0"}%`)
    .join("\n") || "  (no holdings yet)";
  const holdingLines = holdings
    .slice()
    .sort((a, b) => b.current_value - a.current_value)
    .map((h) => `  - ${h.name}${h.ticker ? ` (${h.ticker})` : ""} [${classLabel(h.asset_class)}]: ${totalValue > 0 ? ((h.current_value / totalValue) * 100).toFixed(1) : "0"}%`)
    .join("\n") || "  (no holdings yet)";
  return `Current portfolio value: $${totalValue.toFixed(2)}\n\nAllocation by asset class:\n${classLines}\n\nTop positions:\n${holdingLines}`;
}

export function StrategyIntake({ holdings, totalValue }: Props) {
  const [dilemmas, setDilemmas] = useState<Dilemma[]>([]);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [synthesis, setSynthesis] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function client(): Anthropic | null {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey) {
      setError("No API key found. Add your Anthropic API key in Settings to use this feature.");
      return null;
    }
    return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  async function generateQuestions() {
    const c = client();
    if (!c) return;
    setLoadingQuestions(true);
    setError(null);
    setSynthesis("");
    setPicks({});
    setDilemmas([]);
    try {
      const ctx = buildAllocationContext(holdings, totalValue);
      const res = await c.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: QUESTION_SYSTEM,
        messages: [{ role: "user", content: `Here is my current portfolio. Give me the This-or-That forks.\n\n${ctx}` }],
      });
      const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(json) as { dilemmas: Dilemma[] };
      setDilemmas(parsed.dilemmas ?? []);
    } catch (err) {
      setError(`Couldn't generate the forks: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingQuestions(false);
    }
  }

  async function synthesize() {
    const c = client();
    if (!c) return;
    setStreaming(true);
    setError(null);
    setSynthesis("");
    try {
      const ctx = buildAllocationContext(holdings, totalValue);
      const answerLines = dilemmas
        .map((d) => {
          const p = picks[d.id];
          const chosen = p === "a" ? d.a : p === "b" ? d.b : null;
          return `- ${d.tension}: ${chosen ? `chose "${chosen.label}" — ${chosen.gist}` : "skipped"}`;
        })
        .join("\n");
      const stream = await c.messages.stream({
        model: MODEL,
        max_tokens: 4096,
        system: SYNTH_SYSTEM,
        messages: [{ role: "user", content: `${ctx}\n\nMy answers to the forks:\n${answerLines}` }],
      });
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          const t = chunk.delta.text;
          setSynthesis((prev) => prev + t);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
    }
  }

  const answeredCount = dilemmas.filter((d) => picks[d.id]).length;
  const allAnswered = dilemmas.length > 0 && answeredCount === dilemmas.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <Compass size={15} className="text-[var(--color-primary)]" />
              Strategy Intake — This or That
            </CardTitle>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              Before you set a plan, the strategist hands you binary forks tailored to your book — pick a side on each to sharpen what you're really aiming for.
            </p>
          </div>
          {dilemmas.length === 0 && (
            <button
              onClick={() => void generateQuestions()}
              disabled={loadingQuestions}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {loadingQuestions ? <><Loader2 size={13} className="animate-spin" /> Thinking…</> : <><Compass size={13} /> Start intake</>}
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <p className="mb-3 rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">{error}</p>
        )}

        {dilemmas.length === 0 && !loadingQuestions && !error && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Hit <span className="font-medium">Start intake</span> and the strategist will read your current allocation, then pose six trade-offs for you to choose between.
          </p>
        )}

        {dilemmas.length > 0 && (
          <div className="flex flex-col gap-4">
            {dilemmas.map((d, i) => {
              const p = picks[d.id];
              const Option = ({ side, opt }: { side: "a" | "b"; opt: { label: string; gist: string } }) => {
                const active = p === side;
                return (
                  <button
                    onClick={() => setPicks((prev) => ({ ...prev, [d.id]: side }))}
                    className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                        : "border-[var(--color-border)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-surface-raised)]/50"
                    }`}
                  >
                    <p className={`text-sm font-semibold ${active ? "text-[var(--color-primary)]" : "text-[var(--color-text)]"}`}>
                      {side === "a" ? "This" : "That"} · {opt.label}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)] leading-relaxed">{opt.gist}</p>
                  </button>
                );
              };
              return (
                <div key={d.id} className="rounded-xl border border-[var(--color-border-subtle)] p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
                    {i + 1}. {d.tension}
                  </p>
                  <p className="mt-1 mb-3 text-xs text-[var(--color-text-muted)] italic">{d.why}</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Option side="a" opt={d.a} />
                    <Option side="b" opt={d.b} />
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] pt-3">
              <span className="text-xs text-[var(--color-text-muted)]">{answeredCount} / {dilemmas.length} answered</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void generateQuestions()}
                  disabled={loadingQuestions || streaming}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
                >
                  <RotateCcw size={13} /> New forks
                </button>
                <button
                  onClick={() => void synthesize()}
                  disabled={streaming || answeredCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  title={!allAnswered ? "You can submit partial answers, but answering all sharpens the read" : undefined}
                >
                  {streaming ? <><Loader2 size={13} className="animate-spin" /> Synthesizing…</> : <>Reveal my strategy <ArrowRight size={13} /></>}
                </button>
              </div>
            </div>
          </div>
        )}

        {synthesis && (
          <div className="mt-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]/40 p-4 prose-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MdComponents}>{synthesis}</ReactMarkdown>
            {streaming && <span className="inline-block h-3 w-1.5 animate-pulse bg-[var(--color-primary)] align-middle" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
