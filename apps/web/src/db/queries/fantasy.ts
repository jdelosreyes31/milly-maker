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
  net_betting_pnl: number;
  orphan_linked_in: number; // checking links with no matching fantasy_tx (old manual links)
  open_futures_stake: number; // stakes of open futures placed after account start date
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
      COALESCE(SUM(CASE WHEN t.type = 'cashout' THEN t.amount ELSE 0.0 END), 0.0)::DOUBLE AS total_cashout,
      COALESCE(bs.net_betting_pnl, 0.0)::DOUBLE AS net_betting_pnl,
      COALESCE(orphan.orphan_linked_in, 0.0)::DOUBLE AS orphan_linked_in,
      COALESCE(of_.open_futures_stake, 0.0)::DOUBLE AS open_futures_stake
    FROM fantasy_accounts a
    LEFT JOIN fantasy_transactions t ON t.account_id = a.id
    LEFT JOIN (
      SELECT account_id,
             SUM(total_settled - total_bet)::DOUBLE AS net_betting_pnl
      FROM fantasy_bet_sessions
      WHERE total_settled IS NOT NULL
      GROUP BY account_id
    ) bs ON bs.account_id = a.id
    LEFT JOIN (
      SELECT cfl.fantasy_account_id,
             SUM(ct.amount)::DOUBLE AS orphan_linked_in
      FROM checking_fantasy_links cfl
      JOIN checking_transactions ct ON cfl.checking_tx_id = ct.id
      WHERE cfl.fantasy_tx_id IS NULL
      GROUP BY cfl.fantasy_account_id
    ) orphan ON orphan.fantasy_account_id = a.id
    LEFT JOIN (
      SELECT f.account_id,
             SUM(f.stake)::DOUBLE AS open_futures_stake
      FROM fantasy_futures f
      JOIN fantasy_accounts fa ON f.account_id = fa.id
      WHERE f.status = 'open'
        AND f.placed_date > fa.starting_date
      GROUP BY f.account_id
    ) of_ ON of_.account_id = a.id
    WHERE a.is_active = true
    GROUP BY a.id, a.name, a.platform_type, a.starting_balance, a.starting_date, a.end_date, a.created_at, bs.net_betting_pnl, orphan.orphan_linked_in, of_.open_futures_stake
    ORDER BY a.created_at ASC
  `);

  const rows = result.toArray() as unknown as Omit<FantasyBalanceSummary, "current_balance">[];
  return rows.map((r) => ({
    ...r,
    current_balance: Math.round(
      (r.starting_balance + r.total_deposited + r.orphan_linked_in - r.total_cashout + r.net_betting_pnl - r.open_futures_stake) * 100
    ) / 100,
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
): Promise<string> {
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
  return id;
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

// ── Contests ──────────────────────────────────────────────────────────────────

export interface FantasyContest {
  id: string;
  account_id: string;
  account_name: string;
  description: string;
  entry_fee: number;
  contest_size: number | null;
  finish_position: number | null;
  winnings: number | null;
  placed_date: string;
  settled_date: string | null;
  notes: string | null;
  created_at: string;
}

export async function getFantasyContests(
  conn: AsyncDuckDBConnection,
  accountId: string
): Promise<FantasyContest[]> {
  const where = accountId === "ALL"
    ? `a.platform_type != 'fantasy_league'`
    : `c.account_id = '${accountId}'`;
  const result = await conn.query(`
    SELECT
      c.id, c.account_id, a.name AS account_name,
      c.description,
      c.entry_fee::DOUBLE        AS entry_fee,
      c.contest_size,
      c.finish_position,
      c.winnings::DOUBLE         AS winnings,
      c.placed_date::VARCHAR     AS placed_date,
      c.settled_date::VARCHAR    AS settled_date,
      c.notes,
      c.created_at::VARCHAR      AS created_at
    FROM fantasy_contests c
    JOIN fantasy_accounts a ON c.account_id = a.id
    WHERE ${where}
    ORDER BY c.placed_date DESC, c.created_at DESC
  `);
  return result.toArray() as unknown as FantasyContest[];
}

export async function insertFantasyContest(
  conn: AsyncDuckDBConnection,
  data: {
    account_id: string;
    description: string;
    entry_fee: number;
    contest_size?: number;
    finish_position?: number;
    winnings?: number;
    placed_date: string;
    settled_date?: string;
    notes?: string;
  }
): Promise<void> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO fantasy_contests
      (id, account_id, description, entry_fee, contest_size, finish_position,
       winnings, placed_date, settled_date, notes)
    VALUES (
      '${id}', '${data.account_id}', '${esc(data.description)}',
      ${data.entry_fee},
      ${data.contest_size != null ? data.contest_size : "NULL"},
      ${data.finish_position != null ? data.finish_position : "NULL"},
      ${data.winnings != null ? data.winnings : "NULL"},
      '${data.placed_date}',
      ${data.settled_date ? `'${data.settled_date}'` : "NULL"},
      ${data.notes ? `'${esc(data.notes)}'` : "NULL"}
    )
  `);
}

export async function settleFantasyContest(
  conn: AsyncDuckDBConnection,
  id: string,
  data: { finish_position?: number; winnings: number; settled_date: string }
): Promise<void> {
  const parts = [
    `winnings = ${data.winnings}`,
    `settled_date = '${data.settled_date}'`,
  ];
  if (data.finish_position != null) parts.push(`finish_position = ${data.finish_position}`);
  await conn.query(`UPDATE fantasy_contests SET ${parts.join(", ")} WHERE id = '${id}'`);
}

export async function deleteFantasyContest(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`DELETE FROM fantasy_contests WHERE id = '${id}'`);
}

// ── Bet Sessions ─────────────────────────────────────────────────────────────

export interface FantasyBetSession {
  id: string;
  account_id: string;
  account_name: string;
  session_date: string;
  total_bet: number;
  total_settled: number | null; // null = open (not yet settled)
  net: number | null;           // null when open
  notes: string | null;
  created_at: string;
}

export async function getBetSessions(
  conn: AsyncDuckDBConnection,
  accountId: string
): Promise<FantasyBetSession[]> {
  const where = accountId === "ALL"
    ? `a.platform_type != 'fantasy_league'`
    : `bs.account_id = '${accountId}'`;
  const result = await conn.query(`
    SELECT
      bs.id, bs.account_id, a.name AS account_name,
      bs.session_date::VARCHAR  AS session_date,
      bs.total_bet::DOUBLE      AS total_bet,
      bs.total_settled::DOUBLE  AS total_settled,
      bs.notes,
      bs.created_at::VARCHAR    AS created_at
    FROM fantasy_bet_sessions bs
    JOIN fantasy_accounts a ON bs.account_id = a.id
    WHERE ${where}
    ORDER BY bs.session_date DESC, bs.created_at DESC
  `);
  const rows = result.toArray() as unknown as Omit<FantasyBetSession, "net">[];
  return rows.map((r) => ({
    ...r,
    net: r.total_settled != null
      ? Math.round((r.total_settled - r.total_bet) * 100) / 100
      : null,
  }));
}

export async function insertBetSession(
  conn: AsyncDuckDBConnection,
  data: {
    account_id: string;
    session_date: string;
    total_bet: number;
    total_settled?: number; // optional — omit to create an open session
    notes?: string;
  }
): Promise<void> {
  const id = nanoid();
  const settled = data.total_settled != null ? String(data.total_settled) : "NULL";
  await conn.query(`
    INSERT INTO fantasy_bet_sessions
      (id, account_id, session_date, total_bet, total_settled, notes)
    VALUES (
      '${id}', '${data.account_id}', '${data.session_date}',
      ${data.total_bet}, ${settled},
      ${data.notes ? `'${esc(data.notes)}'` : "NULL"}
    )
  `);
}

export async function settleBetSession(
  conn: AsyncDuckDBConnection,
  id: string,
  total_settled: number,
): Promise<void> {
  await conn.query(`
    UPDATE fantasy_bet_sessions SET total_settled = ${total_settled} WHERE id = '${id}'
  `);
}

export async function deleteBetSession(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`DELETE FROM fantasy_bet_sessions WHERE id = '${id}'`);
}

// ── Checking → Fantasy funding links ─────────────────────────────────────────

export interface FantasyFundingLink {
  id: string;
  checking_tx_id: string;
  fantasy_account_id: string;
  fantasy_account_name: string;
  amount: number;
  transaction_date: string;
  description: string;
  source_account_name: string;
  notes: string | null;
  created_at: string;
}

export async function insertFantasyLink(
  conn: AsyncDuckDBConnection,
  data: { checking_tx_id: string; fantasy_account_id: string; fantasy_tx_id?: string; notes?: string }
): Promise<void> {
  const id = nanoid();
  const notes = data.notes ? `'${esc(data.notes)}'` : "NULL";
  const fantasyTxId = data.fantasy_tx_id ? `'${data.fantasy_tx_id}'` : "NULL";
  await conn.query(`
    INSERT INTO checking_fantasy_links (id, checking_tx_id, fantasy_account_id, fantasy_tx_id, notes)
    VALUES ('${id}', '${data.checking_tx_id}', '${data.fantasy_account_id}', ${fantasyTxId}, ${notes})
  `);
}

export async function getAllFantasyLinks(
  conn: AsyncDuckDBConnection
): Promise<FantasyFundingLink[]> {
  const result = await conn.query(`
    SELECT
      cfl.id,
      cfl.checking_tx_id,
      cfl.fantasy_account_id,
      fa.name                             AS fantasy_account_name,
      ct.amount::DOUBLE                   AS amount,
      ct.transaction_date::VARCHAR        AS transaction_date,
      ct.description,
      ca.name                             AS source_account_name,
      cfl.notes,
      cfl.created_at::VARCHAR             AS created_at
    FROM checking_fantasy_links cfl
    JOIN checking_transactions ct  ON cfl.checking_tx_id     = ct.id
    JOIN checking_accounts     ca  ON ct.account_id          = ca.id
    JOIN fantasy_accounts      fa  ON cfl.fantasy_account_id = fa.id
    ORDER BY ct.transaction_date DESC, cfl.created_at DESC
  `);
  return result.toArray() as unknown as FantasyFundingLink[];
}

export async function deleteFantasyLink(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`DELETE FROM checking_fantasy_links WHERE id = '${id}'`);
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
