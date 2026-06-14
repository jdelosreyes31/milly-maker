// ── Trade Log Parser ──────────────────────────────────────────────────────────
//
// Supported directives (must be on their own line):
//   Overwrite               — wipe account before importing
//   MM-DD-YYYY or MM/DD/YYYY — sets the date for all following transactions
//
// Supported transaction patterns:
//   Deposit from <source> <amount>
//   <ticker> market buy <shares> [shares] at <price>
//   <ticker> market sell <shares> [shares] at <price>
//   Dividend from <ticker> <amount>

export type TradeEntry =
  | { type: "deposit";  raw: string; date: string; description: string; amount: number }
  | { type: "buy";      raw: string; date: string; ticker: string; shares: number; price: number; total: number }
  | { type: "sell";     raw: string; date: string; ticker: string; shares: number; price: number; total: number }
  | { type: "dividend"; raw: string; date: string; ticker: string; amount: number }
  | { type: "unknown";  raw: string; date: string; error: string };

export interface ParseResult {
  overwrite: boolean;
  entries: TradeEntry[];
}

// MM-DD-YYYY or MM/DD/YYYY
const DATE_LINE = /^(\d{2})[-/](\d{2})[-/](\d{4})$/;
const NUM_PAT   = "\\$?([\\d,]+(?:\\.\\d+)?)";

export function parseTradeLog(text: string, fallbackDate: string): ParseResult {
  let overwrite = false;
  let currentDate = fallbackDate;
  const entries: TradeEntry[] = [];

  for (const raw of text.split("\n").map(l => l.trim()).filter(Boolean)) {
    // ── Directives ────────────────────────────────────────────────────────
    if (/^overwrite$/i.test(raw)) { overwrite = true; continue; }

    const dateMatch = DATE_LINE.exec(raw);
    if (dateMatch) {
      // Normalise to YYYY-MM-DD
      currentDate = `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`;
      continue;
    }

    entries.push(parseLine(raw, currentDate));
  }

  return { overwrite, entries };
}

function toNum(s: string): number {
  return parseFloat(s.replace(/,/g, ""));
}

function parseLine(raw: string, date: string): TradeEntry {
  const line = raw.trim();

  // ── Deposit ───────────────────────────────────────────────────────────────
  let m = new RegExp(`^deposit\\s+from\\s+(.+?)\\s+${NUM_PAT}$`, "i").exec(line);
  if (m && m[1] != null && m[2] != null)
    return { type: "deposit", raw, date, description: m[1].trim(), amount: toNum(m[2]) };

  m = new RegExp(`^deposit\\s+${NUM_PAT}\\s+from\\s+(.+)$`, "i").exec(line);
  if (m && m[1] != null && m[2] != null)
    return { type: "deposit", raw, date, description: m[2].trim(), amount: toNum(m[1]) };

  m = new RegExp(`^deposit\\s+${NUM_PAT}$`, "i").exec(line);
  if (m && m[1] != null)
    return { type: "deposit", raw, date, description: "Manual deposit", amount: toNum(m[1]) };

  // ── Buy ───────────────────────────────────────────────────────────────────
  // "VTI market buy 1.96 at 230.66"  or  "VTI market buy 1.96 at 230.66 = 451.09"
  m = new RegExp(
    `^(\\S+)\\s+(?:market\\s+)?buy\\s+${NUM_PAT}\\s+(?:shares?\\s+)?at\\s+${NUM_PAT}(?:\\s*=\\s*${NUM_PAT})?$`, "i"
  ).exec(line);
  if (m && m[1] != null && m[2] != null && m[3] != null) {
    const shares = toNum(m[2]), price = toNum(m[3]);
    const total = m[4] != null ? toNum(m[4]) : parseFloat((shares * price).toFixed(2));
    return { type: "buy", raw, date, ticker: m[1].toUpperCase(), shares, price, total };
  }

  // ── Sell ──────────────────────────────────────────────────────────────────
  // "VTI market sell 1.96 at 234.10"  or  "VTI market sell 1.96 at 234.10 = 458.84"
  m = new RegExp(
    `^(\\S+)\\s+(?:market\\s+)?sell\\s+${NUM_PAT}\\s+(?:shares?\\s+)?at\\s+${NUM_PAT}(?:\\s*=\\s*${NUM_PAT})?$`, "i"
  ).exec(line);
  if (m && m[1] != null && m[2] != null && m[3] != null) {
    const shares = toNum(m[2]), price = toNum(m[3]);
    const total = m[4] != null ? toNum(m[4]) : parseFloat((shares * price).toFixed(2));
    return { type: "sell", raw, date, ticker: m[1].toUpperCase(), shares, price, total };
  }

  // ── Dividend ──────────────────────────────────────────────────────────────
  m = new RegExp(`^dividend\\s+from\\s+(\\S+)\\s+${NUM_PAT}$`, "i").exec(line);
  if (m && m[1] != null && m[2] != null)
    return { type: "dividend", raw, date, ticker: m[1].toUpperCase(), amount: toNum(m[2]) };

  m = new RegExp(`^dividend\\s+${NUM_PAT}\\s+from\\s+(\\S+)$`, "i").exec(line);
  if (m && m[1] != null && m[2] != null)
    return { type: "dividend", raw, date, ticker: m[2].toUpperCase(), amount: toNum(m[1]) };

  m = new RegExp(`^dividend\\s+(\\S+)\\s+${NUM_PAT}$`, "i").exec(line);
  if (m && m[1] != null && m[2] != null && !/^from$/i.test(m[1]))
    return { type: "dividend", raw, date, ticker: m[1].toUpperCase(), amount: toNum(m[2]) };

  return { type: "unknown", raw, date, error: "Unrecognised format" };
}
