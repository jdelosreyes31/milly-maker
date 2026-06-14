import React, { useState, useMemo, useEffect } from "react";
import { CheckCircle, AlertTriangle, Loader2, ChevronRight, Trash2 } from "lucide-react";
import { Button, Dialog, Select, formatCurrency } from "@milly-maker/ui";
import { useDb } from "@/db/hooks/useDb.js";
import { parseTradeLog } from "@/lib/tradeLogParser.js";
import { batchProcessTradeLog } from "@/db/queries/investments.js";
import type { TradeEntry } from "@/lib/tradeLogParser.js";
import type { TradeLogResult } from "@/db/queries/investments.js";
import type { Investment } from "@/db/queries/investments.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  investments: Investment[];
  onDone: () => void;
}

type Step = "input" | "review" | "done";

// ── Helpers ───────────────────────────────────────────────────────────────────

function entryLabel(e: TradeEntry): { badge: string; color: string; summary: string } {
  switch (e.type) {
    case "deposit":
      return { badge: "DEPOSIT", color: "bg-blue-100 text-blue-700",
        summary: `${e.description} — ${formatCurrency(e.amount)}` };
    case "buy": {
      const computed = parseFloat((e.shares * e.price).toFixed(2));
      const diff = Math.abs(e.total - computed) > 0.001;
      return { badge: "BUY", color: "bg-green-100 text-green-700",
        summary: `${e.ticker} · ${e.shares} shares @ ${formatCurrency(e.price)}${diff ? ` = ${formatCurrency(e.total)} ✓` : ` = ${formatCurrency(e.total)}`}` };
    }
    case "sell": {
      const computed = parseFloat((e.shares * e.price).toFixed(2));
      const diff = Math.abs(e.total - computed) > 0.001;
      return { badge: "SELL", color: "bg-red-100 text-red-700",
        summary: `${e.ticker} · ${e.shares} shares @ ${formatCurrency(e.price)}${diff ? ` = ${formatCurrency(e.total)} ✓` : ` = ${formatCurrency(e.total)}`}` };
    }
    case "dividend":
      return { badge: "DIV", color: "bg-purple-100 text-purple-700",
        summary: `${e.ticker} — ${formatCurrency(e.amount)}` };
    case "unknown":
      return { badge: "?", color: "bg-amber-100 text-amber-700", summary: e.raw };
  }
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TradeLogScaffold({ open, onClose, investments, onDone }: Props) {
  const { conn } = useDb();

  const [step, setStep] = useState<Step>("input");
  const [investmentId, setInvestmentId] = useState(investments[0]?.id ?? "");
  const [fallbackDate, setFallbackDate] = useState(new Date().toISOString().slice(0, 10));
  const [rawLog, setRawLog] = useState("");
  const [results, setResults] = useState<TradeLogResult[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!investmentId && investments.length > 0) setInvestmentId(investments[0]!.id);
  }, [investments, investmentId]);

  const parseResult = useMemo(() => parseTradeLog(rawLog, fallbackDate), [rawLog, fallbackDate]);
  const { overwrite, entries } = parseResult;

  const validCount  = entries.filter((e) => e.type !== "unknown").length;
  const unknownCount = entries.filter((e) => e.type === "unknown").length;

  const accountOptions = investments.map((inv) => ({
    value: inv.id,
    label: `${inv.name}${inv.institution ? ` (${inv.institution})` : ""}`,
  }));

  function reset() {
    setStep("input"); setRawLog(""); setResults([]);
    setInvestmentId(investments[0]?.id ?? "");
    setFallbackDate(new Date().toISOString().slice(0, 10));
  }

  function handleClose() { reset(); onClose(); }

  async function runImport() {
    if (!conn || !investmentId) return;
    setRunning(true);
    try {
      const res = await batchProcessTradeLog(conn, investmentId, entries, overwrite);
      setResults(res);
      setStep("done");
      onDone();
    } finally {
      setRunning(false);
    }
  }

  // ── Step: Input ─────────────────────────────────────────────────────────

  const stepInput = (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        One transaction per line. Add <code className="text-xs bg-muted px-1 rounded">Overwrite</code> at the top to wipe and replay. Use <code className="text-xs bg-muted px-1 rounded">MM-DD-YYYY</code> date lines to set the date per group.
      </p>
      <div className="rounded-lg bg-muted/40 border p-3 text-xs font-mono text-muted-foreground space-y-0.5">
        <div className="text-amber-600 font-semibold">Overwrite</div>
        <div className="text-[var(--color-primary)] font-semibold">03-30-2026</div>
        <div>Deposit from SoFi Checking 1100</div>
        <div className="text-[var(--color-primary)] font-semibold">04-01-2026</div>
        <div>VTI market buy 1.96 at 230.66 = 451.09</div>
        <div>VTI market sell 1.96 at 234.10 = 458.84</div>
        <div>Dividend From AMLP 3.32</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Investment Account</label>
          <Select value={investmentId} onChange={(e) => setInvestmentId(e.target.value)} options={accountOptions} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Fallback Date <span className="text-[var(--color-text-subtle)]">(used when no date line present)</span>
          </label>
          <input
            type="date" value={fallbackDate}
            onChange={(e) => setFallbackDate(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Trade Log</label>
        <textarea
          className="w-full h-52 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={"Overwrite\n03-30-2026\nDeposit from SoFi Checking 1100\n04-01-2026\nVTI market buy 1.96 at 230.66"}
          value={rawLog}
          onChange={(e) => setRawLog(e.target.value)}
        />
      </div>

      {entries.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {overwrite && (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">⚠ Overwrite</span>
          )}
          <span>{validCount} transaction{validCount !== 1 ? "s" : ""} recognised</span>
          {unknownCount > 0 && <span className="text-amber-600">· {unknownCount} unrecognised</span>}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={handleClose}>Cancel</Button>
        <Button onClick={() => setStep("review")} disabled={entries.length === 0 || !investmentId}>
          Review <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );

  // ── Step: Review ────────────────────────────────────────────────────────

  const selectedAccount = investments.find((i) => i.id === investmentId);

  // Group entries by date for display
  const groupedEntries = useMemo(() => {
    const groups: { date: string; items: { entry: TradeEntry; idx: number }[] }[] = [];
    let currentDate = "";
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.date !== currentDate) {
        currentDate = entry.date;
        groups.push({ date: currentDate, items: [] });
      }
      groups[groups.length - 1]!.items.push({ entry, idx: i });
    }
    return groups;
  }, [entries]);

  const stepReview = (
    <div className="flex flex-col gap-4 min-h-0">
      <div className="text-sm text-muted-foreground shrink-0">
        Importing into <span className="font-medium text-foreground">{selectedAccount?.name}</span>
      </div>

      {overwrite && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-700 shrink-0">
          <Trash2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            <strong>Overwrite mode:</strong> all existing lots, contributions, and holdings for this account will be deleted before importing.
          </span>
        </div>
      )}

      {/* Scrollable date-grouped list */}
      <div className="overflow-y-auto max-h-72 rounded-lg border divide-y divide-border shrink-0">
        {groupedEntries.map((group) => (
          <div key={group.date}>
            <div className="px-3 py-1.5 bg-muted/40 text-[10px] font-semibold text-muted-foreground tracking-wide uppercase">
              {fmtDate(group.date)}
            </div>
            {group.items.map(({ entry, idx }) => {
              const { badge, color, summary } = entryLabel(entry);
              return (
                <div key={idx} className="flex items-center gap-3 px-3 py-2 text-sm border-t border-border/40">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${color}`}>{badge}</span>
                  <span className="text-muted-foreground font-mono text-xs truncate flex-1">{summary}</span>
                  {entry.type === "unknown" && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {unknownCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-700 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{unknownCount} line{unknownCount !== 1 ? "s" : ""} could not be parsed and will be skipped.</span>
        </div>
      )}

      <div className="flex justify-between gap-2 shrink-0">
        <Button variant="ghost" onClick={() => setStep("input")}>← Back</Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button onClick={runImport} disabled={running || validCount === 0}
            className={overwrite ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}>
            {running ? (
              <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Importing…</>
            ) : overwrite ? (
              <>⚠ Overwrite & Import {validCount}</>
            ) : (
              <>Import {validCount} transaction{validCount !== 1 ? "s" : ""}</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  // ── Step: Done ──────────────────────────────────────────────────────────

  const okCount = results.filter((r) => r.status === "ok").length;
  const errorResults = results.filter((r) => r.status === "error");
  const skippedResults = results.filter((r) => r.status === "skipped");

  const stepDone = (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
        <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
        <div>
          <p className="text-sm font-medium text-green-800">
            {okCount} transaction{okCount !== 1 ? "s" : ""} imported successfully
          </p>
          {(errorResults.length > 0 || skippedResults.length > 0) && (
            <p className="text-xs text-green-700 mt-0.5">
              {skippedResults.length > 0 && `${skippedResults.length} skipped`}
              {skippedResults.length > 0 && errorResults.length > 0 && " · "}
              {errorResults.length > 0 && `${errorResults.length} failed`}
            </p>
          )}
        </div>
      </div>

      {errorResults.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-destructive">Errors</p>
          {errorResults.map((r) => (
            <div key={r.index} className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs">
              <p className="font-mono text-red-700">{r.raw}</p>
              <p className="text-red-600 mt-0.5">{r.message}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={() => { reset(); }}>Import More</Button>
        <Button onClick={handleClose}>Done</Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onClose={handleClose} title="Trade Log Import">
      {step === "input" && stepInput}
      {step === "review" && stepReview}
      {step === "done" && stepDone}
    </Dialog>
  );
}
