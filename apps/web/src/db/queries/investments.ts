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

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
