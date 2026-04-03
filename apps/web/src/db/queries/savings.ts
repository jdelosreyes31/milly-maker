import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { nanoid } from "../../lib/nanoid.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SavingsAccountType = "hysa" | "hsa" | "savings" | "other";

export interface SavingsAccount {
  id: string;
  name: string;
  account_type: SavingsAccountType;
  starting_balance: number;
  starting_date: string;
  apr: number;
  is_active: boolean;
}

export type SavingsTransactionType = "deposit" | "withdrawal" | "interest" | "transfer_in";

export interface SavingsTransaction {
  id: string;
  account_id: string;
  type: SavingsTransactionType;
  amount: number;
  description: string;
  transaction_date: string;
  transfer_pair_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface SavingsTransactionWithBalance extends SavingsTransaction {
  running_balance: number;
  account_name: string;
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export async function getAllSavingsAccounts(
  conn: AsyncDuckDBConnection
): Promise<SavingsAccount[]> {
  const result = await conn.query(`
    SELECT id, name, account_type,
           starting_balance::DOUBLE AS starting_balance,
           starting_date::VARCHAR AS starting_date,
           apr::DOUBLE AS apr,
           is_active
    FROM savings_accounts
    WHERE is_active = true
    ORDER BY created_at ASC
  `);
  return result.toArray() as unknown as SavingsAccount[];
}

export async function insertSavingsAccount(
  conn: AsyncDuckDBConnection,
  data: { name: string; account_type: SavingsAccountType; starting_balance: number; starting_date: string; apr: number }
): Promise<string> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO savings_accounts (id, name, account_type, starting_balance, starting_date, apr)
    VALUES ('${id}', '${esc(data.name)}', '${data.account_type}', ${data.starting_balance}, '${data.starting_date}', ${data.apr})
  `);
  return id;
}

export async function updateSavingsAccount(
  conn: AsyncDuckDBConnection,
  id: string,
  data: Partial<{ name: string; account_type: SavingsAccountType; starting_balance: number; starting_date: string; apr: number }>
): Promise<void> {
  const sets: string[] = [];
  if (data.name !== undefined) sets.push(`name = '${esc(data.name)}'`);
  if (data.account_type !== undefined) sets.push(`account_type = '${data.account_type}'`);
  if (data.starting_balance !== undefined) sets.push(`starting_balance = ${data.starting_balance}`);
  if (data.starting_date !== undefined) sets.push(`starting_date = '${data.starting_date}'`);
  if (data.apr !== undefined) sets.push(`apr = ${data.apr}`);
  sets.push("updated_at = now()");
  await conn.query(`UPDATE savings_accounts SET ${sets.join(", ")} WHERE id = '${id}'`);
}

export async function deleteSavingsAccount(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`UPDATE savings_accounts SET is_active = false, updated_at = now() WHERE id = '${id}'`);
}

// ── Transactions ──────────────────────────────────────────────────────────────

export async function getSavingsTransactionsForAccount(
  conn: AsyncDuckDBConnection,
  accountId: string // "ALL" for all accounts
): Promise<SavingsTransactionWithBalance[]> {
  const whereClause = accountId === "ALL" ? "1=1" : `t.account_id = '${accountId}'`;

  const result = await conn.query(`
    SELECT
      t.id,
      t.account_id,
      t.type,
      t.amount::DOUBLE AS amount,
      t.description,
      t.transaction_date::VARCHAR AS transaction_date,
      t.transfer_pair_id,
      t.notes,
      t.created_at::VARCHAR AS created_at,
      a.name AS account_name
    FROM savings_transactions t
    JOIN savings_accounts a ON t.account_id = a.id
    WHERE ${whereClause}
    ORDER BY t.transaction_date ASC, t.created_at ASC
  `);

  const rows = result.toArray() as unknown as Omit<SavingsTransactionWithBalance, "running_balance">[];

  if (accountId === "ALL") {
    return computeRunningBalancesAll(conn, rows);
  }

  const accountResult = await conn.query(`
    SELECT starting_balance::DOUBLE AS starting_balance
    FROM savings_accounts WHERE id = '${accountId}'
  `);
  const account = (accountResult.toArray() as unknown as { starting_balance: number }[])[0];
  const startingBalance = account?.starting_balance ?? 0;

  let running = startingBalance;
  return rows.map((r) => {
    const delta = r.type === "withdrawal" ? -r.amount : r.amount;
    running = Math.round((running + delta) * 100) / 100;
    return { ...r, running_balance: running };
  });
}

async function computeRunningBalancesAll(
  conn: AsyncDuckDBConnection,
  rows: Omit<SavingsTransactionWithBalance, "running_balance">[]
): Promise<SavingsTransactionWithBalance[]> {
  const accountsResult = await conn.query(`
    SELECT id, starting_balance::DOUBLE AS starting_balance
    FROM savings_accounts WHERE is_active = true
  `);
  const accounts = accountsResult.toArray() as unknown as { id: string; starting_balance: number }[];
  const perAccountRunning = new Map(accounts.map((a) => [a.id, a.starting_balance]));

  return rows.map((r) => {
    const prev = perAccountRunning.get(r.account_id) ?? 0;
    const delta = r.type === "withdrawal" ? -r.amount : r.amount;
    const next = Math.round((prev + delta) * 100) / 100;
    perAccountRunning.set(r.account_id, next);

    let combined = 0;
    for (const v of perAccountRunning.values()) combined += v;
    return { ...r, running_balance: Math.round(combined * 100) / 100 };
  });
}

export async function insertSavingsTransaction(
  conn: AsyncDuckDBConnection,
  data: {
    account_id: string;
    type: SavingsTransactionType;
    amount: number;
    description: string;
    transaction_date: string;
    transfer_pair_id?: string;
    notes?: string;
  }
): Promise<void> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO savings_transactions
      (id, account_id, type, amount, description, transaction_date, transfer_pair_id, notes)
    VALUES (
      '${id}',
      '${data.account_id}',
      '${data.type}',
      ${data.amount},
      '${esc(data.description)}',
      '${data.transaction_date}',
      ${data.transfer_pair_id ? `'${data.transfer_pair_id}'` : "NULL"},
      ${data.notes ? `'${esc(data.notes)}'` : "NULL"}
    )
  `);
}

export async function deleteSavingsTransaction(
  conn: AsyncDuckDBConnection,
  id: string,
  transferPairId: string | null
): Promise<void> {
  if (transferPairId) {
    // Remove both the savings record and any linked checking debit
    await conn.query(`DELETE FROM savings_transactions WHERE transfer_pair_id = '${transferPairId}'`);
    await conn.query(`DELETE FROM checking_transactions WHERE transfer_pair_id = '${transferPairId}'`);
  } else {
    await conn.query(`DELETE FROM savings_transactions WHERE id = '${id}'`);
  }
}

// ── Balance summary ───────────────────────────────────────────────────────────

export async function getSavingsBalanceSummary(
  conn: AsyncDuckDBConnection
): Promise<{ account_id: string; account_name: string; account_type: SavingsAccountType; apr: number; current_balance: number }[]> {
  const result = await conn.query(`
    SELECT
      a.id AS account_id,
      a.name AS account_name,
      a.account_type,
      a.apr::DOUBLE AS apr,
      (
        a.starting_balance
        + COALESCE(SUM(CASE WHEN t.type IN ('deposit', 'transfer_in', 'interest') THEN t.amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type = 'withdrawal' THEN t.amount ELSE 0 END), 0)
      )::DOUBLE AS current_balance
    FROM savings_accounts a
    LEFT JOIN savings_transactions t ON t.account_id = a.id
    WHERE a.is_active = true
    GROUP BY a.id, a.name, a.account_type, a.apr, a.starting_balance, a.created_at
    ORDER BY a.created_at ASC
  `);
  return result.toArray() as unknown as {
    account_id: string;
    account_name: string;
    account_type: SavingsAccountType;
    apr: number;
    current_balance: number;
  }[];
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
