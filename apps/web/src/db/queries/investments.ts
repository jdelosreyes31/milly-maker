import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { nanoid } from "../../lib/nanoid.js";

export interface Investment {
  id: string;
  name: string;
  account_type: string;
  institution: string | null;
  current_value: number;
  cost_basis: number;
  monthly_contribution: number;
  expected_return: number;
  is_active: boolean;
}

export const ACCOUNT_TYPES = [
  { value: "roth_ira", label: "Roth IRA" },
  { value: "401k", label: "401(k)" },
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "brokerage", label: "Brokerage" },
  { value: "hsa", label: "HSA" },
  { value: "529", label: "529 (Education)" },
  { value: "crypto", label: "Crypto" },
  { value: "savings", label: "Savings" },
  { value: "cash_account", label: "Cash Account" },
  { value: "other", label: "Other" },
];

export async function getAllInvestments(conn: AsyncDuckDBConnection): Promise<Investment[]> {
  const result = await conn.query(`
    SELECT id, name, account_type, institution,
           current_value::DOUBLE AS current_value,
           cost_basis::DOUBLE AS cost_basis,
           monthly_contribution::DOUBLE AS monthly_contribution,
           expected_return::DOUBLE AS expected_return,
           is_active
    FROM investments WHERE is_active = true
    ORDER BY current_value DESC
  `);
  return result.toArray() as unknown as Investment[];
}

export async function insertInvestment(
  conn: AsyncDuckDBConnection,
  data: Omit<Investment, "id" | "is_active">
): Promise<string> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO investments (id, name, account_type, institution, current_value, cost_basis, monthly_contribution, expected_return)
    VALUES ('${id}', '${esc(data.name)}', '${data.account_type}',
            ${data.institution ? `'${esc(data.institution)}'` : "NULL"},
            ${data.current_value}, ${data.cost_basis}, ${data.monthly_contribution}, ${data.expected_return})
  `);
  // Record initial snapshot
  await conn.query(`
    INSERT INTO investment_snapshots (id, investment_id, snapshot_date, value)
    VALUES ('${nanoid()}', '${id}', current_date, ${data.current_value})
  `);
  return id;
}

export async function updateInvestment(
  conn: AsyncDuckDBConnection,
  id: string,
  data: Partial<Omit<Investment, "id">>
): Promise<void> {
  const sets: string[] = [];
  if (data.name !== undefined) sets.push(`name = '${esc(data.name)}'`);
  if (data.current_value !== undefined) sets.push(`current_value = ${data.current_value}`);
  if (data.monthly_contribution !== undefined) sets.push(`monthly_contribution = ${data.monthly_contribution}`);
  if (data.expected_return !== undefined) sets.push(`expected_return = ${data.expected_return}`);
  if (data.institution !== undefined) sets.push(`institution = ${data.institution ? `'${esc(data.institution)}'` : "NULL"}`);
  sets.push("updated_at = now()");

  await conn.query(`UPDATE investments SET ${sets.join(", ")} WHERE id = '${id}'`);

  // Record snapshot when value is updated
  if (data.current_value !== undefined) {
    await conn.query(`
      INSERT OR REPLACE INTO investment_snapshots (id, investment_id, snapshot_date, value)
      VALUES ('${nanoid()}', '${id}', current_date, ${data.current_value})
    `);
  }
}

export async function deleteInvestment(conn: AsyncDuckDBConnection, id: string): Promise<void> {
  await conn.query(`UPDATE investments SET is_active = false, updated_at = now() WHERE id = '${id}'`);
}

export async function getNetWorthHistory(
  conn: AsyncDuckDBConnection
): Promise<{ snapshot_date: string; total_assets: number; total_debts: number; net_worth: number }[]> {
  const result = await conn.query(`
    SELECT snapshot_date::VARCHAR AS snapshot_date,
           total_assets::DOUBLE AS total_assets,
           total_debts::DOUBLE AS total_debts,
           (total_assets - total_debts)::DOUBLE AS net_worth
    FROM net_worth_snapshots
    ORDER BY snapshot_date ASC
  `);
  return result.toArray() as { snapshot_date: string; total_assets: number; total_debts: number; net_worth: number }[];
}

export async function upsertNetWorthSnapshot(conn: AsyncDuckDBConnection): Promise<void> {
  await conn.query(`
    INSERT INTO net_worth_snapshots (id, snapshot_date, total_assets, total_debts)
    SELECT
      '${nanoid()}',
      current_date,
      -- Investments
      COALESCE((SELECT SUM(current_value) FROM investments WHERE is_active = true), 0)
      -- Checking accounts (starting_balance + all credits - all debits/transfers)
      + COALESCE((
          SELECT SUM(bal.b) FROM (
            SELECT a.starting_balance + COALESCE(SUM(
              CASE WHEN t.type = 'credit' THEN t.amount
                   WHEN t.type IN ('debit', 'transfer') THEN -t.amount
                   ELSE 0 END
            ), 0) AS b
            FROM checking_accounts a
            LEFT JOIN checking_transactions t ON t.account_id = a.id
            GROUP BY a.id, a.starting_balance
          ) bal
        ), 0)
      -- Savings accounts (starting_balance + all deposits - all withdrawals)
      + COALESCE((
          SELECT SUM(bal.b) FROM (
            SELECT a.starting_balance + COALESCE(SUM(
              CASE WHEN t.type = 'deposit' THEN t.amount
                   WHEN t.type = 'withdrawal' THEN -t.amount
                   ELSE 0 END
            ), 0) AS b
            FROM savings_accounts a
            LEFT JOIN savings_transactions t ON t.account_id = a.id
            GROUP BY a.id, a.starting_balance
          ) bal
        ), 0),
      COALESCE((SELECT SUM(current_balance) FROM debts WHERE is_active = true), 0)
    ON CONFLICT (snapshot_date) DO UPDATE SET
      total_assets = EXCLUDED.total_assets,
      total_debts  = EXCLUDED.total_debts
  `);
}

// ── Holdings ──────────────────────────────────────────────────────────────────

export interface InvestmentHolding {
  id: string;
  investment_id: string;
  name: string;
  ticker: string | null;
  shares: number | null;
  current_value: number;
  cost_basis: number;
  asset_class: string;
  is_sold: boolean;
}

export const ASSET_CLASSES = [
  { value: "stocks",      label: "Stocks" },
  { value: "bonds",       label: "Bonds" },
  { value: "cash",        label: "Cash / Equiv." },
  { value: "real_estate", label: "Real Estate" },
  { value: "crypto",      label: "Crypto" },
  { value: "commodities", label: "Commodities" },
  { value: "other",       label: "Other" },
];

const HOLDING_COLS = `
  id, investment_id, name, ticker,
  shares::DOUBLE        AS shares,
  current_value::DOUBLE AS current_value,
  cost_basis::DOUBLE    AS cost_basis,
  asset_class,
  COALESCE(is_sold, FALSE) AS is_sold
`;

export async function getHoldingsForAccount(
  conn: AsyncDuckDBConnection,
  investmentId: string
): Promise<InvestmentHolding[]> {
  const result = await conn.query(`
    SELECT ${HOLDING_COLS}
    FROM investment_holdings
    WHERE investment_id = '${investmentId}' AND COALESCE(is_sold, FALSE) = FALSE
    ORDER BY current_value DESC
  `);
  return result.toArray() as unknown as InvestmentHolding[];
}

export async function getAllHoldings(
  conn: AsyncDuckDBConnection
): Promise<InvestmentHolding[]> {
  const result = await conn.query(`
    SELECT ${HOLDING_COLS}
    FROM investment_holdings
    WHERE COALESCE(is_sold, FALSE) = FALSE
    ORDER BY investment_id, current_value DESC
  `);
  return result.toArray() as unknown as InvestmentHolding[];
}

export async function getAllSoldHoldings(
  conn: AsyncDuckDBConnection
): Promise<InvestmentHolding[]> {
  const result = await conn.query(`
    SELECT ${HOLDING_COLS}
    FROM investment_holdings
    WHERE COALESCE(is_sold, FALSE) = TRUE
    ORDER BY investment_id, current_value DESC
  `);
  return result.toArray() as unknown as InvestmentHolding[];
}

export async function sellHolding(
  conn: AsyncDuckDBConnection,
  id: string,
  investmentId: string
): Promise<void> {
  await conn.query(`
    UPDATE investment_holdings
    SET is_sold = TRUE, shares = 0, updated_at = now()
    WHERE id = '${id}'
  `);
  await syncHoldingsTotals(conn, investmentId);
}

export async function upsertHolding(
  conn: AsyncDuckDBConnection,
  data: {
    id?: string;
    investment_id: string;
    name: string;
    ticker: string | null;
    shares: number | null;
    current_value: number;
    cost_basis: number;
    asset_class: string;
  }
): Promise<string> {
  const id = data.id ?? nanoid();
  const ticker = data.ticker ? `'${esc(data.ticker)}'` : "NULL";
  const shares = data.shares != null ? String(data.shares) : "NULL";
  if (data.id) {
    await conn.query(`
      UPDATE investment_holdings SET
        name = '${esc(data.name)}', ticker = ${ticker}, shares = ${shares},
        current_value = ${data.current_value}, cost_basis = ${data.cost_basis},
        asset_class = '${data.asset_class}', updated_at = now()
      WHERE id = '${id}'
    `);
  } else {
    await conn.query(`
      INSERT INTO investment_holdings (id, investment_id, name, ticker, shares, current_value, cost_basis, asset_class)
      VALUES ('${id}', '${data.investment_id}', '${esc(data.name)}', ${ticker}, ${shares},
              ${data.current_value}, ${data.cost_basis}, '${data.asset_class}')
    `);
  }
  // Sync account current_value to sum of holdings
  await syncHoldingsTotals(conn, data.investment_id);
  return id;
}

export async function deleteHolding(
  conn: AsyncDuckDBConnection,
  id: string,
  investmentId: string
): Promise<void> {
  await conn.query(`DELETE FROM investment_holdings WHERE id = '${id}'`);
  await syncHoldingsTotals(conn, investmentId);
}

async function syncHoldingsTotals(
  conn: AsyncDuckDBConnection,
  investmentId: string
): Promise<void> {
  await conn.query(`
    UPDATE investments SET
      current_value = (
        SELECT COALESCE(SUM(current_value), 0)
        FROM investment_holdings
        WHERE investment_id = '${investmentId}'
          AND COALESCE(is_sold, FALSE) = FALSE
      ),
      cost_basis = (
        SELECT COALESCE(SUM(cost_basis), 0)
        FROM investment_holdings
        WHERE investment_id = '${investmentId}'
          AND COALESCE(is_sold, FALSE) = FALSE
      ),
      updated_at = now()
    WHERE id = '${investmentId}'
  `);
}

// ── Contributions ─────────────────────────────────────────────────────────────

export interface InvestmentContribution {
  id: string;
  investment_id: string;
  investment_name: string;
  amount: number;
  contribution_date: string;
  source_type: string;
  source_account_id: string | null;
  source_account_name: string | null;
  notes: string | null;
}

export const CONTRIBUTION_SOURCE_TYPES = [
  { value: "checking", label: "Checking Account" },
  { value: "savings",  label: "Savings Account" },
  { value: "employer", label: "Employer Match" },
  { value: "transfer", label: "Internal Transfer" },
  { value: "other",    label: "Other" },
];

export async function getContributions(
  conn: AsyncDuckDBConnection,
  investmentId?: string
): Promise<InvestmentContribution[]> {
  const where = investmentId ? `WHERE ic.investment_id = '${investmentId}'` : "";
  const result = await conn.query(`
    SELECT
      ic.id,
      ic.investment_id,
      inv.name                                        AS investment_name,
      ic.amount::DOUBLE                               AS amount,
      ic.contribution_date::VARCHAR                   AS contribution_date,
      ic.source_type,
      ic.source_account_id,
      COALESCE(ca.name, sa.name)                      AS source_account_name,
      ic.notes
    FROM investment_contributions ic
    JOIN investments inv ON ic.investment_id = inv.id
    LEFT JOIN checking_accounts ca ON ic.source_type = 'checking' AND ic.source_account_id = ca.id
    LEFT JOIN savings_accounts  sa ON ic.source_type = 'savings'  AND ic.source_account_id = sa.id
    ${where}
    ORDER BY ic.contribution_date DESC, ic.created_at DESC
  `);
  return result.toArray() as unknown as InvestmentContribution[];
}

export async function insertContribution(
  conn: AsyncDuckDBConnection,
  data: {
    investment_id: string;
    amount: number;
    contribution_date: string;
    source_type: string;
    source_account_id: string | null;
    notes: string | null;
    update_account_value: boolean;
  }
): Promise<void> {
  const id = nanoid();
  const srcId = data.source_account_id ? `'${data.source_account_id}'` : "NULL";
  const notes = data.notes ? `'${esc(data.notes)}'` : "NULL";
  await conn.query(`
    INSERT INTO investment_contributions
      (id, investment_id, amount, contribution_date, source_type, source_account_id, notes)
    VALUES ('${id}', '${data.investment_id}', ${data.amount},
            '${data.contribution_date}', '${data.source_type}', ${srcId}, ${notes})
  `);
  if (data.update_account_value) {
    await conn.query(`
      UPDATE investments
      SET current_value = current_value + ${data.amount}, updated_at = now()
      WHERE id = '${data.investment_id}'
    `);
    // Also update any snapshot for today
    await conn.query(`
      INSERT INTO investment_snapshots (id, investment_id, snapshot_date, value, contribution)
      SELECT '${nanoid()}', '${data.investment_id}', '${data.contribution_date}',
             current_value, ${data.amount}
      FROM investments WHERE id = '${data.investment_id}'
      ON CONFLICT DO NOTHING
    `);
  }
}

export async function deleteContribution(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`DELETE FROM investment_contributions WHERE id = '${id}'`);
}

// ── Holding Lots ──────────────────────────────────────────────────────────────

export interface HoldingLot {
  id: string;
  holding_id: string;
  shares: number;
  price_per_share: number;
  purchased_at: string;
  notes: string | null;
  transaction_type: "buy" | "sell";
}

export async function getLotsForHolding(
  conn: AsyncDuckDBConnection,
  holdingId: string
): Promise<HoldingLot[]> {
  const result = await conn.query(`
    SELECT id, holding_id,
           shares::DOUBLE          AS shares,
           price_per_share::DOUBLE AS price_per_share,
           purchased_at::VARCHAR   AS purchased_at,
           notes,
           COALESCE(transaction_type, 'buy') AS transaction_type
    FROM holding_lots
    WHERE holding_id = '${holdingId}'
    ORDER BY purchased_at DESC, created_at DESC
  `);
  return result.toArray() as unknown as HoldingLot[];
}

export async function getAllLots(
  conn: AsyncDuckDBConnection
): Promise<HoldingLot[]> {
  const result = await conn.query(`
    SELECT id, holding_id,
           shares::DOUBLE          AS shares,
           price_per_share::DOUBLE AS price_per_share,
           purchased_at::VARCHAR   AS purchased_at,
           notes,
           COALESCE(transaction_type, 'buy') AS transaction_type
    FROM holding_lots
    ORDER BY purchased_at DESC, created_at DESC
  `);
  return result.toArray() as unknown as HoldingLot[];
}

export async function insertHoldingLot(
  conn: AsyncDuckDBConnection,
  data: {
    holding_id: string;
    investment_id: string;
    shares: number;
    price_per_share: number;
    lot_cost?: number;        // optional override; defaults to shares * price_per_share
    purchased_at: string;
    notes: string | null;
    transaction_type?: "buy" | "sell";
  }
): Promise<void> {
  const id = nanoid();
  const notes = data.notes ? `'${esc(data.notes)}'` : "NULL";
  const txType = data.transaction_type ?? "buy";
  await conn.query(`
    INSERT INTO holding_lots (id, holding_id, shares, price_per_share, purchased_at, notes, transaction_type)
    VALUES ('${id}', '${data.holding_id}', ${data.shares}, ${data.price_per_share},
            '${data.purchased_at}', ${notes}, '${txType}')
  `);
  if (txType === "buy") {
    const lotCost = data.lot_cost ?? data.shares * data.price_per_share;
    await conn.query(`
      UPDATE investment_holdings SET
        shares     = COALESCE(shares, 0) + ${data.shares},
        cost_basis = COALESCE(cost_basis, 0) + ${lotCost},
        updated_at = now()
      WHERE id = '${data.holding_id}'
    `);
    await syncHoldingsTotals(conn, data.investment_id);
  }
}

export async function deleteHoldingLot(
  conn: AsyncDuckDBConnection,
  lotId: string
): Promise<void> {
  await conn.query(`DELETE FROM holding_lots WHERE id = '${lotId}'`);
}

export async function updateHoldingLot(
  conn: AsyncDuckDBConnection,
  data: {
    id: string;
    shares: number;
    price_per_share: number;
    purchased_at: string;
    transaction_type: "buy" | "sell";
  }
): Promise<void> {
  await conn.query(`
    UPDATE holding_lots SET
      shares          = ${data.shares},
      price_per_share = ${data.price_per_share},
      purchased_at    = '${data.purchased_at}',
      transaction_type = '${data.transaction_type}'
    WHERE id = '${data.id}'
  `);
}

/**
 * Recompute a holding's shares / cost_basis / current_value by replaying every
 * lot for that holding in chronological order using avg-cost accounting.
 *
 * Buys add shares and cost (shares × price). Sells remove shares and reduce the
 * cost basis by the average cost per share. current_value is set to the
 * remaining shares valued at the most recent transaction's price per share —
 * matching the convention used when lots are first imported. The holding is
 * marked sold when no shares remain. Account totals are re-synced afterward.
 *
 * Call this after editing or deleting a lot so both the overview and actual
 * views (which read the same holdings table) reflect the change.
 */
export async function recomputeHoldingFromLots(
  conn: AsyncDuckDBConnection,
  holdingId: string
): Promise<void> {
  // Resolve the owning account
  const ownerRes = await conn.query(`
    SELECT investment_id FROM investment_holdings WHERE id = '${holdingId}'
  `);
  const owner = ownerRes.toArray()[0] as { investment_id: string } | undefined;
  if (!owner) return;

  // Replay lots oldest → newest
  const lotsRes = await conn.query(`
    SELECT shares::DOUBLE AS shares,
           price_per_share::DOUBLE AS price_per_share,
           COALESCE(transaction_type, 'buy') AS transaction_type
    FROM holding_lots
    WHERE holding_id = '${holdingId}'
    ORDER BY purchased_at ASC, created_at ASC
  `);
  const lots = lotsRes.toArray() as {
    shares: number; price_per_share: number; transaction_type: string;
  }[];

  let shares = 0;
  let costBasis = 0;
  let lastPrice = 0;

  for (const lot of lots) {
    if (lot.transaction_type === "sell") {
      const avgCost = shares > 0 ? costBasis / shares : 0;
      costBasis = Math.max(0, costBasis - lot.shares * avgCost);
      shares = Math.max(0, shares - lot.shares);
    } else {
      costBasis += lot.shares * lot.price_per_share;
      shares += lot.shares;
    }
    lastPrice = lot.price_per_share;
  }

  shares = Math.max(0, shares);
  costBasis = Math.max(0, costBasis);
  const currentValue = shares * lastPrice;
  const isSold = shares <= 0.000001;

  await conn.query(`
    UPDATE investment_holdings SET
      shares        = ${shares},
      cost_basis    = ${costBasis},
      current_value = ${currentValue},
      is_sold       = ${isSold ? "TRUE" : "FALSE"},
      updated_at    = now()
    WHERE id = '${holdingId}'
  `);

  await syncHoldingsTotals(conn, owner.investment_id);
}

// ── Account Overwrite ─────────────────────────────────────────────────────────

/**
 * Wipe all lots, contributions, and holdings for an investment account
 * so the trade log can be replayed from scratch.
 */
export async function clearAccountForOverwrite(
  conn: AsyncDuckDBConnection,
  investmentId: string
): Promise<void> {
  // Delete all lots belonging to this account's holdings
  await conn.query(`
    DELETE FROM holding_lots
    WHERE holding_id IN (
      SELECT id FROM investment_holdings WHERE investment_id = '${investmentId}'
    )
  `);
  // Delete all holdings
  await conn.query(`DELETE FROM investment_holdings WHERE investment_id = '${investmentId}'`);
  // Delete all contributions
  await conn.query(`DELETE FROM investment_contributions WHERE investment_id = '${investmentId}'`);
  // Zero out the account totals
  await conn.query(`
    UPDATE investments
    SET current_value = 0, cost_basis = 0, updated_at = now()
    WHERE id = '${investmentId}'
  `);
}

// ── Sell Lot ──────────────────────────────────────────────────────────────────

/**
 * Record a partial or full sell of an existing holding.
 * - Inserts a lot with transaction_type='sell'
 * - Decreases holding shares by soldShares (avg-cost basis reduction)
 * - Marks holding is_sold=true if shares reach 0
 * - Does NOT use the "mark whole holding sold" path (that zeroes current_value)
 */
export async function processSellLot(
  conn: AsyncDuckDBConnection,
  data: {
    holding_id: string;
    investment_id: string;
    shares: number;
    price_per_share: number;
    total?: number;           // optional confirmed proceeds; defaults to shares * price_per_share
    transacted_at: string;
    notes: string | null;
  }
): Promise<void> {
  const id = nanoid();
  const notes = data.notes ? `'${esc(data.notes)}'` : "NULL";

  // Insert the sell lot
  await conn.query(`
    INSERT INTO holding_lots (id, holding_id, shares, price_per_share, purchased_at, notes, transaction_type)
    VALUES ('${id}', '${data.holding_id}', ${data.shares}, ${data.price_per_share},
            '${data.transacted_at}', ${notes}, 'sell')
  `);

  // Fetch current holding state
  const holdingRes = await conn.query(`
    SELECT shares::DOUBLE AS shares, cost_basis::DOUBLE AS cost_basis
    FROM investment_holdings WHERE id = '${data.holding_id}'
  `);
  const holding = holdingRes.toArray()[0] as { shares: number; cost_basis: number } | undefined;
  if (!holding) return;

  const prevShares = holding.shares ?? 0;
  const prevCostBasis = holding.cost_basis ?? 0;
  const remainingShares = Math.max(0, prevShares - data.shares);

  // Use confirmed total if provided, otherwise fall back to shares * price
  const effectivePricePerShare = (data.total != null && data.shares > 0)
    ? data.total / data.shares
    : data.price_per_share;

  // Avg-cost basis reduction
  const costPerShare = prevShares > 0 ? prevCostBasis / prevShares : 0;
  const newCostBasis = Math.max(0, remainingShares * costPerShare);
  const newCurrentValue = remainingShares * effectivePricePerShare;
  const isSold = remainingShares <= 0.000001;

  await conn.query(`
    UPDATE investment_holdings SET
      shares        = ${remainingShares},
      cost_basis    = ${newCostBasis},
      current_value = ${newCurrentValue},
      is_sold       = ${isSold ? "TRUE" : "FALSE"},
      updated_at    = now()
    WHERE id = '${data.holding_id}'
  `);

  await syncHoldingsTotals(conn, data.investment_id);
}

// ── Batch Trade Log ───────────────────────────────────────────────────────────

import type { TradeEntry } from "../../lib/tradeLogParser.js";

export interface TradeLogResult {
  index: number;
  raw: string;
  status: "ok" | "error" | "skipped";
  message?: string;
}

/**
 * Process a parsed trade log against a specific investment account.
 * Returns a result per entry. Rolls back nothing on partial failure —
 * each entry is independent so the caller can surface errors to the user.
 */
export async function batchProcessTradeLog(
  conn: AsyncDuckDBConnection,
  investmentId: string,
  entries: TradeEntry[],
  overwrite: boolean
): Promise<TradeLogResult[]> {
  const results: TradeLogResult[] = [];

  if (overwrite) {
    await clearAccountForOverwrite(conn, investmentId);
  }

  // Load current holdings for this account (ticker → holding)
  const holdingRes = await conn.query(`
    SELECT id, ticker, shares::DOUBLE AS shares, cost_basis::DOUBLE AS cost_basis, name
    FROM investment_holdings
    WHERE investment_id = '${investmentId}' AND COALESCE(is_sold, FALSE) = FALSE
  `);
  const holdingRows = holdingRes.toArray() as { id: string; ticker: string | null; shares: number; cost_basis: number; name: string }[];
  const holdingByTicker = new Map(
    holdingRows.filter((h) => h.ticker).map((h) => [h.ticker!.toUpperCase(), h])
  );

  let i = 0;
  for (const entry of entries) {
    const idx = i++;

    if (entry.type === "unknown") {
      results.push({ index: idx, raw: entry.raw, status: "skipped", message: entry.error });
      continue;
    }

    try {
      if (entry.type === "deposit") {
        await insertContribution(conn, {
          investment_id: investmentId,
          amount: entry.amount,
          contribution_date: entry.date,
          source_type: "other",
          source_account_id: null,
          notes: entry.description ? `Deposit – ${entry.description}` : null,
          update_account_value: true,
        });
        results.push({ index: idx, raw: entry.raw, status: "ok" });

      } else if (entry.type === "buy") {
        let holding = holdingByTicker.get(entry.ticker);
        if (!holding) {
          const hid = await upsertHolding(conn, {
            investment_id: investmentId,
            name: entry.ticker,
            ticker: entry.ticker,
            shares: 0,
            current_value: 0,
            cost_basis: 0,
            asset_class: "stocks",
          });
          holding = { id: hid, ticker: entry.ticker, shares: 0, cost_basis: 0, name: entry.ticker };
          holdingByTicker.set(entry.ticker, holding);
        }
        await insertHoldingLot(conn, {
          holding_id: holding.id,
          investment_id: investmentId,
          shares: entry.shares,
          price_per_share: entry.price,
          lot_cost: entry.total,
          purchased_at: entry.date,
          notes: null,
          transaction_type: "buy",
        });
        // Update in-memory cache so subsequent sells in the same batch see updated shares
        const cached = holdingByTicker.get(entry.ticker);
        if (cached) {
          cached.shares = (cached.shares ?? 0) + entry.shares;
          cached.cost_basis = (cached.cost_basis ?? 0) + entry.total;
        }
        // Sync current_value using the confirmed total
        const pricePerShare = entry.shares > 0 ? entry.total / entry.shares : entry.price;
        await conn.query(`
          UPDATE investment_holdings
          SET current_value = shares * ${pricePerShare}, updated_at = now()
          WHERE id = '${holding.id}'
        `);
        results.push({ index: idx, raw: entry.raw, status: "ok" });

      } else if (entry.type === "sell") {
        const holding = holdingByTicker.get(entry.ticker);
        if (!holding) {
          results.push({
            index: idx, raw: entry.raw, status: "error",
            message: `No holding found for ticker "${entry.ticker}". Add a buy first.`,
          });
          continue;
        }
        await processSellLot(conn, {
          holding_id: holding.id,
          investment_id: investmentId,
          shares: entry.shares,
          price_per_share: entry.price,
          total: entry.total,
          transacted_at: entry.date,
          notes: null,
        });
        holding.shares = Math.max(0, holding.shares - entry.shares);
        results.push({ index: idx, raw: entry.raw, status: "ok" });

      } else if (entry.type === "dividend") {
        // Dividends are investment income, not contributions — update account value directly
        await conn.query(`
          UPDATE investments
          SET current_value = current_value + ${entry.amount}, updated_at = now()
          WHERE id = '${investmentId}'
        `);
        results.push({ index: idx, raw: entry.raw, status: "ok" });
      }
    } catch (err) {
      results.push({
        index: idx, raw: entry.raw, status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await upsertNetWorthSnapshot(conn);
  return results;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
