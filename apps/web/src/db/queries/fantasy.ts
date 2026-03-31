import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { nanoid } from "../../lib/nanoid.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FantasyPlatformType = "sportsbook" | "dfs" | "fantasy_league" | "other";
export type FantasyTxType = "deposit" | "cashout";
export type FutureStatus = "open" | "won" | "lost" | "void";
export type SeasonStatus = "active" | "won" | "lost" | "ended";

export interface FantasyAccount {
  id: string;
  name: string;
  platform_type: FantasyPlatformType;
  starting_balance: number;  // buy-in for leagues, actual balance for sportsbook/dfs
  starting_date: string;
  end_date: string | null;
  is_active: boolean;
}

export interface FantasyTransaction {
  id: string;
  account_id: string;
  account_name: string;
  platform_type: FantasyPlatformType;
  type: FantasyTxType;
  amount: number;
  description: string;
  transaction_date: string;
  notes: string | null;
  created_at: string;
}

export interface FantasyFuture {
  id: string;
  account_id: string;
  account_name: string;
  description: string;
  stake: number;
  potential_payout: number | null;
  odds: string | null;
  status: FutureStatus;
  placed_date: string;
  settled_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface FantasySeason {
  id: string;
  account_id: string;
  account_name: string;
  description: string;
  season_year: string | null;
  buy_in: number;
  potential_payout: number | null;
  placement: string | null;
  status: SeasonStatus;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface FantasyBalanceSummary {
  account_id: string;
  account_name: string;
  platform_type: FantasyPlatformType;
  starting_balance: number;
  starting_date: string;
  end_date: string | null;
  current_balance: number;
  total_deposited: number;
  total_cashout: number;
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export async function getAllFantasyAccounts(
  conn: AsyncDuckDBConnection
): Promise<FantasyAccount[]> {
  const result = await conn.query(`
    SELECT id, name, platform_type,
           starting_balance::DOUBLE AS starting_balance,
           starting_date::VARCHAR AS starting_date,
           end_date::VARCHAR AS end_date,
           is_active
    FROM fantasy_accounts
    WHERE is_active = true
    ORDER BY created_at ASC
  `);
  return result.toArray() as unknown as FantasyAccount[];
}

export async function insertFantasyAccount(
  conn: AsyncDuckDBConnection,
  data: {
    name: string;
    platform_type: FantasyPlatformType;
    starting_balance: number;
    starting_date: string;
    end_date?: string;
  }
): Promise<string> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO fantasy_accounts (id, name, platform_type, starting_balance, starting_date, end_date)
    VALUES (
      '${id}', '${esc(data.name)}', '${data.platform_type}',
      ${data.starting_balance}, '${data.starting_date}',
      ${data.end_date ? `'${data.end_date}'` : "NULL"}
    )
  `);
  return id;
}

export async function updateFantasyAccount(
  conn: AsyncDuckDBConnection,
  id: string,
  data: Partial<{
    name: string;
    platform_type: FantasyPlatformType;
    starting_balance: number;
    starting_date: string;
    end_date: string | null;
  }>
): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  if (data.name !== undefined) sets.push(`name = '${esc(data.name)}'`);
  if (data.platform_type !== undefined) sets.push(`platform_type = '${data.platform_type}'`);
  if (data.starting_balance !== undefined) sets.push(`starting_balance = ${data.starting_balance}`);
  if (data.starting_date !== undefined) sets.push(`starting_date = '${data.starting_date}'`);
  if ("end_date" in data) sets.push(`end_date = ${data.end_date ? `'${data.end_date}'` : "NULL"}`);
  await conn.query(`UPDATE fantasy_accounts SET ${sets.join(", ")} WHERE id = '${id}'`);
}

export async function deleteFantasyAccount(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`UPDATE fantasy_accounts SET is_active = false, updated_at = now() WHERE id = '${id}'`);
}

// ── Balance summary ───────────────────────────────────────────────────────────

export async function getFantasyBalanceSummary(
  conn: AsyncDuckDBConnection
): Promise<FantasyBalanceSummary[]> {
  const result = await conn.query(`
    SELECT
      a.id AS account_id,
      a.name AS account_name,
      a.platform_type,
      a.starting_balance::DOUBLE AS starting_balance,
      a.starting_date::VARCHAR AS starting_date,
      a.end_date::VARCHAR AS end_date,
      COALESCE(SUM(CASE WHEN t.type = 'deposit' THEN t.amount ELSE 0.0 END), 0.0)::DOUBLE AS total_deposited,
      COALESCE(SUM(CASE WHEN t.type = 'cashout' THEN t.amount ELSE 0.0 END), 0.0)::DOUBLE AS total_cashout
    FROM fantasy_accounts a
    LEFT JOIN fantasy_transactions t ON t.account_id = a.id
    WHERE a.is_active = true
    GROUP BY a.id, a.name, a.platform_type, a.starting_balance, a.starting_date, a.end_date, a.created_at
    ORDER BY a.created_at ASC
  `);

  const rows = result.toArray() as unknown as Omit<FantasyBalanceSummary, "current_balance">[];
  return rows.map((r) => ({
    ...r,
    current_balance: Math.round((r.starting_balance + r.total_deposited - r.total_cashout) * 100) / 100,
  }));
}

// ── Transactions ──────────────────────────────────────────────────────────────

export async function getFantasyTransactions(
  conn: AsyncDuckDBConnection,
  accountId: string
): Promise<FantasyTransaction[]> {
  const where = accountId === "ALL" ? "1=1" : `t.account_id = '${accountId}'`;
  const result = await conn.query(`
    SELECT
      t.id, t.account_id, a.name AS account_name, a.platform_type, t.type,
      t.amount::DOUBLE AS amount,
      t.description,
      t.transaction_date::VARCHAR AS transaction_date,
      t.notes,
      t.created_at::VARCHAR AS created_at
    FROM fantasy_transactions t
    JOIN fantasy_accounts a ON t.account_id = a.id
    WHERE ${where}
    ORDER BY t.transaction_date DESC, t.created_at DESC
  `);
  return result.toArray() as unknown as FantasyTransaction[];
}

export async function insertFantasyTransaction(
  conn: AsyncDuckDBConnection,
  data: {
    account_id: string;
    type: FantasyTxType;
    amount: number;
    description: string;
    transaction_date: string;
    notes?: string;
  }
): Promise<void> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO fantasy_transactions
      (id, account_id, type, amount, description, transaction_date, notes)
    VALUES (
      '${id}', '${data.account_id}', '${data.type}', ${data.amount},
      '${esc(data.description)}', '${data.transaction_date}',
      ${data.notes ? `'${esc(data.notes)}'` : "NULL"}
    )
  `);
}

export async function deleteFantasyTransaction(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`DELETE FROM fantasy_transactions WHERE id = '${id}'`);
}

// ── Futures ───────────────────────────────────────────────────────────────────

export async function getFantasyFutures(
  conn: AsyncDuckDBConnection,
  accountId: string,
  statusFilter?: FutureStatus | "all"
): Promise<FantasyFuture[]> {
  const whereParts: string[] = [
    // Only load futures for sportsbook/dfs/other — not fantasy_league accounts
    `a.platform_type != 'fantasy_league'`,
  ];
  if (accountId !== "ALL") whereParts.push(`f.account_id = '${accountId}'`);
  if (statusFilter && statusFilter !== "all") whereParts.push(`f.status = '${statusFilter}'`);

  const result = await conn.query(`
    SELECT
      f.id, f.account_id, a.name AS account_name,
      f.description,
      f.stake::DOUBLE AS stake,
      f.potential_payout::DOUBLE AS potential_payout,
      f.odds, f.status,
      f.placed_date::VARCHAR AS placed_date,
      f.settled_date::VARCHAR AS settled_date,
      f.notes,
      f.created_at::VARCHAR AS created_at
    FROM fantasy_futures f
    JOIN fantasy_accounts a ON f.account_id = a.id
    WHERE ${whereParts.join(" AND ")}
    ORDER BY
      CASE f.status WHEN 'open' THEN 0 ELSE 1 END,
      f.placed_date DESC
  `);
  return result.toArray() as unknown as FantasyFuture[];
}

export async function insertFantasyFuture(
  conn: AsyncDuckDBConnection,
  data: {
    account_id: string;
    description: string;
    stake: number;
    potential_payout?: number;
    odds?: string;
    placed_date: string;
    notes?: string;
  }
): Promise<void> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO fantasy_futures
      (id, account_id, description, stake, potential_payout, odds, placed_date, notes)
    VALUES (
      '${id}', '${data.account_id}', '${esc(data.description)}',
      ${data.stake},
      ${data.potential_payout != null ? data.potential_payout : "NULL"},
      ${data.odds ? `'${esc(data.odds)}'` : "NULL"},
      '${data.placed_date}',
      ${data.notes ? `'${esc(data.notes)}'` : "NULL"}
    )
  `);
}

export async function updateFutureStatus(
  conn: AsyncDuckDBConnection,
  id: string,
  status: FutureStatus
): Promise<void> {
  const settledDate = status !== "open" ? `'${new Date().toISOString().slice(0, 10)}'` : "NULL";
  await conn.query(`
    UPDATE fantasy_futures SET status = '${status}', settled_date = ${settledDate} WHERE id = '${id}'
  `);
}

export async function deleteFantasyFuture(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`DELETE FROM fantasy_futures WHERE id = '${id}'`);
}

// ── Seasons ───────────────────────────────────────────────────────────────────

export async function getFantasySeasons(
  conn: AsyncDuckDBConnection,
  accountId: string // "ALL" or specific league account id
): Promise<FantasySeason[]> {
  const where = accountId === "ALL"
    ? `a.platform_type = 'fantasy_league'`
    : `s.account_id = '${accountId}'`;

  const result = await conn.query(`
    SELECT
      s.id, s.account_id, a.name AS account_name,
      s.description,
      s.season_year,
      s.buy_in::DOUBLE AS buy_in,
      s.potential_payout::DOUBLE AS potential_payout,
      s.placement,
      s.status,
      s.start_date::VARCHAR AS start_date,
      s.end_date::VARCHAR AS end_date,
      s.notes,
      s.created_at::VARCHAR AS created_at
    FROM fantasy_seasons s
    JOIN fantasy_accounts a ON s.account_id = a.id
    WHERE ${where}
    ORDER BY
      CASE s.status WHEN 'active' THEN 0 ELSE 1 END,
      s.start_date DESC
  `);
  return result.toArray() as unknown as FantasySeason[];
}

export async function insertFantasySeason(
  conn: AsyncDuckDBConnection,
  data: {
    account_id: string;
    description: string;
    season_year?: string;
    buy_in: number;
    potential_payout?: number;
    start_date: string;
    end_date?: string;
    notes?: string;
  }
): Promise<void> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO fantasy_seasons
      (id, account_id, description, season_year, buy_in, potential_payout, start_date, end_date, notes)
    VALUES (
      '${id}', '${data.account_id}', '${esc(data.description)}',
      ${data.season_year ? `'${esc(data.season_year)}'` : "NULL"},
      ${data.buy_in},
      ${data.potential_payout != null ? data.potential_payout : "NULL"},
      '${data.start_date}',
      ${data.end_date ? `'${data.end_date}'` : "NULL"},
      ${data.notes ? `'${esc(data.notes)}'` : "NULL"}
    )
  `);
}

export async function updateSeasonStatus(
  conn: AsyncDuckDBConnection,
  id: string,
  status: SeasonStatus,
  placement?: string
): Promise<void> {
  const sets = [`status = '${status}'`];
  if (status !== "active") sets.push(`end_date = COALESCE(end_date, '${new Date().toISOString().slice(0, 10)}')`);
  if (placement) sets.push(`placement = '${esc(placement)}'`);
  await conn.query(`UPDATE fantasy_seasons SET ${sets.join(", ")} WHERE id = '${id}'`);
}

export async function deleteFantasySeason(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`DELETE FROM fantasy_seasons WHERE id = '${id}'`);
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
