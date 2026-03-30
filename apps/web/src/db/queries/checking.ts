import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { nanoid } from "../../lib/nanoid.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CheckingAccount {
  id: string;
  name: string;
  starting_balance: number;
  starting_date: string;
  is_active: boolean;
}

export type TransactionType = "debit" | "credit" | "transfer";

export interface CheckingTransaction {
  id: string;
  account_id: string;
  type: TransactionType;
  amount: number;
  description: string;
  transaction_date: string;
  transfer_to_account_id: string | null;
  transfer_pair_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface TransactionWithBalance extends CheckingTransaction {
  running_balance: number;
  account_name: string;
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export async function getAllCheckingAccounts(
  conn: AsyncDuckDBConnection
): Promise<CheckingAccount[]> {
  const result = await conn.query(`
    SELECT id, name,
           starting_balance::DOUBLE AS starting_balance,
           starting_date::VARCHAR AS starting_date,
           is_active
    FROM checking_accounts
    WHERE is_active = true
    ORDER BY created_at ASC
  `);
  return result.toArray() as unknown as CheckingAccount[];
}

export async function insertCheckingAccount(
  conn: AsyncDuckDBConnection,
  data: { name: string; starting_balance: number; starting_date: string }
): Promise<string> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO checking_accounts (id, name, starting_balance, starting_date)
    VALUES ('${id}', '${esc(data.name)}', ${data.starting_balance}, '${data.starting_date}')
  `);
  return id;
}

export async function updateCheckingAccount(
  conn: AsyncDuckDBConnection,
  id: string,
  data: Partial<{ name: string; starting_balance: number; starting_date: string }>
): Promise<void> {
  const sets: string[] = [];
  if (data.name !== undefined) sets.push(`name = '${esc(data.name)}'`);
  if (data.starting_balance !== undefined) sets.push(`starting_balance = ${data.starting_balance}`);
  if (data.starting_date !== undefined) sets.push(`starting_date = '${data.starting_date}'`);
  sets.push("updated_at = now()");
  await conn.query(`UPDATE checking_accounts SET ${sets.join(", ")} WHERE id = '${id}'`);
}

export async function deleteCheckingAccount(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`UPDATE checking_accounts SET is_active = false, updated_at = now() WHERE id = '${id}'`);
}

// ── Transactions ──────────────────────────────────────────────────────────────

export async function getTransactionsForAccount(
  conn: AsyncDuckDBConnection,
  accountId: string // pass 'ALL' to get all accounts
): Promise<TransactionWithBalance[]> {
  const whereClause = accountId === "ALL"
    ? "1=1"
    : `t.account_id = '${accountId}'`;

  const result = await conn.query(`
    SELECT
      t.id,
      t.account_id,
      t.type,
      t.amount::DOUBLE AS amount,
      t.description,
      t.transaction_date::VARCHAR AS transaction_date,
      t.transfer_to_account_id,
      t.transfer_pair_id,
      t.notes,
      t.created_at::VARCHAR AS created_at,
      a.name AS account_name
    FROM checking_transactions t
    JOIN checking_accounts a ON t.account_id = a.id
    WHERE ${whereClause}
    ORDER BY t.transaction_date ASC, t.created_at ASC
  `);

  const rows = result.toArray() as unknown as Omit<TransactionWithBalance, "running_balance">[];

  // If ALL accounts: group running balance per-account, then merge and sort
  // We compute running_balance per account separately and tag each row
  if (accountId === "ALL") {
    return computeRunningBalancesAllAccounts(conn, rows);
  }

  // Single account: get starting balance, compute running balance in order
  const accountResult = await conn.query(`
    SELECT starting_balance::DOUBLE AS starting_balance, starting_date::VARCHAR AS starting_date
    FROM checking_accounts WHERE id = '${accountId}'
  `);
  const account = (accountResult.toArray() as unknown as { starting_balance: number; starting_date: string }[])[0];
  const startingBalance = account?.starting_balance ?? 0;

  let running = startingBalance;
  return rows.map((r) => {
    const delta = r.type === "credit" ? r.amount : -r.amount;
    running = Math.round((running + delta) * 100) / 100;
    return { ...r, running_balance: running };
  });
}

async function computeRunningBalancesAllAccounts(
  conn: AsyncDuckDBConnection,
  rows: Omit<TransactionWithBalance, "running_balance">[]
): Promise<TransactionWithBalance[]> {
  // Fetch all account starting balances
  const accountsResult = await conn.query(`
    SELECT id, starting_balance::DOUBLE AS starting_balance
    FROM checking_accounts WHERE is_active = true
  `);
  const accounts = accountsResult.toArray() as unknown as { id: string; starting_balance: number }[];
  const startingMap = new Map(accounts.map((a) => [a.id, a.starting_balance]));

  // Compute per-account running balance, then for "ALL" view show
  // a combined running balance = sum of all account balances at that point
  const perAccountRunning = new Map<string, number>();
  for (const [id, bal] of startingMap) {
    perAccountRunning.set(id, bal);
  }

  return rows.map((r) => {
    const prev = perAccountRunning.get(r.account_id) ?? 0;
    const delta = r.type === "credit" ? r.amount : -r.amount;
    const next = Math.round((prev + delta) * 100) / 100;
    perAccountRunning.set(r.account_id, next);

    // Combined balance = sum of all current account balances
    let combined = 0;
    for (const v of perAccountRunning.values()) combined += v;

    return { ...r, running_balance: Math.round(combined * 100) / 100 };
  });
}

export async function insertTransaction(
  conn: AsyncDuckDBConnection,
  data: {
    account_id: string;
    type: TransactionType;
    amount: number;
    description: string;
    transaction_date: string;
    transfer_to_account_id?: string;         // destination is a checking account
    transfer_to_savings_account_id?: string; // destination is a savings account
    notes?: string;
  }
): Promise<void> {
  const id = nanoid();
  const pairId = data.type === "transfer" ? nanoid() : null;

  await conn.query(`
    INSERT INTO checking_transactions
      (id, account_id, type, amount, description, transaction_date, transfer_to_account_id, transfer_pair_id, notes)
    VALUES (
      '${id}',
      '${data.account_id}',
      '${data.type}',
      ${data.amount},
      '${esc(data.description)}',
      '${data.transaction_date}',
      ${data.transfer_to_account_id ? `'${data.transfer_to_account_id}'` : "NULL"},
      ${pairId ? `'${pairId}'` : "NULL"},
      ${data.notes ? `'${esc(data.notes)}'` : "NULL"}
    )
  `);

  // Transfer to another checking account: create paired credit there
  if (data.type === "transfer" && data.transfer_to_account_id) {
    const creditId = nanoid();
    await conn.query(`
      INSERT INTO checking_transactions
        (id, account_id, type, amount, description, transaction_date, transfer_to_account_id, transfer_pair_id, notes)
      VALUES (
        '${creditId}',
        '${data.transfer_to_account_id}',
        'credit',
        ${data.amount},
        '${esc(`Transfer from: ${data.description}`)}',
        '${data.transaction_date}',
        NULL,
        '${pairId}',
        ${data.notes ? `'${esc(data.notes)}'` : "NULL"}
      )
    `);
  }

  // Transfer to a savings account: create a transfer_in record there
  if (data.type === "transfer" && data.transfer_to_savings_account_id) {
    const depositId = nanoid();
    await conn.query(`
      INSERT INTO savings_transactions
        (id, account_id, type, amount, description, transaction_date, transfer_pair_id, notes)
      VALUES (
        '${depositId}',
        '${data.transfer_to_savings_account_id}',
        'transfer_in',
        ${data.amount},
        '${esc(`Transfer from checking: ${data.description}`)}',
        '${data.transaction_date}',
        '${pairId}',
        ${data.notes ? `'${esc(data.notes)}'` : "NULL"}
      )
    `);
  }
}

export async function deleteTransaction(
  conn: AsyncDuckDBConnection,
  id: string,
  transferPairId: string | null
): Promise<void> {
  if (transferPairId) {
    // Delete both legs — handles checking↔checking and checking↔savings transfers
    await conn.query(`DELETE FROM checking_transactions WHERE transfer_pair_id = '${transferPairId}'`);
    await conn.query(`DELETE FROM savings_transactions WHERE transfer_pair_id = '${transferPairId}'`);
  } else {
    await conn.query(`DELETE FROM checking_transactions WHERE id = '${id}'`);
  }
}

export async function getCheckingBalanceSummary(
  conn: AsyncDuckDBConnection
): Promise<{ account_id: string; account_name: string; current_balance: number }[]> {
  // For each account: starting_balance + sum of credits - sum of debits
  const result = await conn.query(`
    SELECT
      a.id AS account_id,
      a.name AS account_name,
      (
        a.starting_balance
        + COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type IN ('debit', 'transfer') THEN t.amount ELSE 0 END), 0)
      )::DOUBLE AS current_balance
    FROM checking_accounts a
    LEFT JOIN checking_transactions t ON t.account_id = a.id
    WHERE a.is_active = true
    GROUP BY a.id, a.name, a.starting_balance
    ORDER BY a.created_at ASC
  `);
  return result.toArray() as unknown as { account_id: string; account_name: string; current_balance: number }[];
}

export async function getMonthlyDebitTotals(
  conn: AsyncDuckDBConnection
): Promise<{ month: string; total: number }[]> {
  const result = await conn.query(`
    SELECT
      strftime(transaction_date, '%Y-%m') AS month,
      SUM(amount)::DOUBLE AS total
    FROM checking_transactions
    WHERE type IN ('debit', 'transfer')
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  return result.toArray() as unknown as { month: string; total: number }[];
}

export async function getMonthlyCreditTotals(
  conn: AsyncDuckDBConnection
): Promise<{ month: string; total: number }[]> {
  const result = await conn.query(`
    SELECT
      strftime(transaction_date, '%Y-%m') AS month,
      SUM(amount)::DOUBLE AS total
    FROM checking_transactions
    WHERE type = 'credit'
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  return result.toArray() as unknown as { month: string; total: number }[];
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
