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
    INSERT OR REPLACE INTO net_worth_snapshots (id, snapshot_date, total_assets, total_debts)
    SELECT
      '${nanoid()}',
      current_date,
      COALESCE((SELECT SUM(current_value) FROM investments WHERE is_active = true), 0),
      COALESCE((SELECT SUM(current_balance) FROM debts WHERE is_active = true), 0)
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

export async function getHoldingsForAccount(
  conn: AsyncDuckDBConnection,
  investmentId: string
): Promise<InvestmentHolding[]> {
  const result = await conn.query(`
    SELECT id, investment_id, name, ticker,
           shares::DOUBLE        AS shares,
           current_value::DOUBLE AS current_value,
           cost_basis::DOUBLE    AS cost_basis,
           asset_class
    FROM investment_holdings
    WHERE investment_id = '${investmentId}'
    ORDER BY current_value DESC
  `);
  return result.toArray() as unknown as InvestmentHolding[];
}

export async function getAllHoldings(
  conn: AsyncDuckDBConnection
): Promise<InvestmentHolding[]> {
  const result = await conn.query(`
    SELECT id, investment_id, name, ticker,
           shares::DOUBLE        AS shares,
           current_value::DOUBLE AS current_value,
           cost_basis::DOUBLE    AS cost_basis,
           asset_class
    FROM investment_holdings
    ORDER BY investment_id, current_value DESC
  `);
  return result.toArray() as unknown as InvestmentHolding[];
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
      ),
      cost_basis = (
        SELECT COALESCE(SUM(cost_basis), 0)
        FROM investment_holdings
        WHERE investment_id = '${investmentId}'
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

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
