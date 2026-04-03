import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { nanoid } from "../lib/nanoid.js";
import { PLANNING_STORAGE_KEY } from "../features/planning/PlanningPage.js";

// ── Date helpers ──────────────────────────────────────────────────────────────

function monthsAgo(n: number, day = 1): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
}

function esc(s: string) { return s.replace(/'/g, "''"); }
function q(v: string | number | null) {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${esc(String(v))}'`;
}

// ── Main seed function ────────────────────────────────────────────────────────

export async function seedDatabase(conn: AsyncDuckDBConnection): Promise<void> {

  // ── Checking ────────────────────────────────────────────────────────────────
  const checkId = nanoid();
  await conn.query(`
    INSERT INTO checking_accounts (id, name, starting_balance, starting_date, is_active)
    VALUES (${q(checkId)}, 'Chase Checking', 3500.00, ${q(monthsAgo(7))}, true)
  `);

  // Build 6 months of checking transactions
  const checkTxs: [string, string, number, string][] = [];
  for (let m = 5; m >= 0; m--) {
    // Two paychecks per month
    checkTxs.push(["credit", monthsAgo(m, 1),  3850.00, "Paycheck — direct deposit"]);
    checkTxs.push(["credit", monthsAgo(m, 15), 3850.00, "Paycheck — direct deposit"]);
    // Rent
    checkTxs.push(["debit", monthsAgo(m, 2),  1875.00, "Rent"]);
    // Utilities
    checkTxs.push(["debit", monthsAgo(m, 6),   148.00, "Utilities"]);
    // Groceries
    checkTxs.push(["debit", monthsAgo(m, 10),  420.00 + (m % 3) * 30, "Groceries"]);
    // Dining
    checkTxs.push(["debit", monthsAgo(m, 18),  210.00 + (m % 4) * 45, "Dining & going out"]);
    // Misc
    checkTxs.push(["debit", monthsAgo(m, 22),   95.00, "Gas"]);
  }
  for (const [type, date, amount, desc] of checkTxs) {
    await conn.query(`
      INSERT INTO checking_transactions (id, account_id, type, amount, description, transaction_date)
      VALUES (${q(nanoid())}, ${q(checkId)}, ${q(type)}, ${amount}, ${q(desc)}, ${q(date)})
    `);
  }

  // ── Savings ─────────────────────────────────────────────────────────────────
  const savId = nanoid();
  await conn.query(`
    INSERT INTO savings_accounts (id, name, account_type, starting_balance, starting_date, apr, is_active)
    VALUES (${q(savId)}, 'Marcus HYSA', 'hysa', 6500.00, ${q(monthsAgo(8))}, 0.0450, true)
  `);
  for (let m = 5; m >= 0; m--) {
    await conn.query(`
      INSERT INTO savings_transactions (id, account_id, type, amount, description, transaction_date)
      VALUES (${q(nanoid())}, ${q(savId)}, 'deposit', 500.00, 'Monthly transfer', ${q(monthsAgo(m, 3))})
    `);
    const interest = Math.round((6500 + 500 * (6 - m)) * 0.045 / 12 * 100) / 100;
    await conn.query(`
      INSERT INTO savings_transactions (id, account_id, type, amount, description, transaction_date)
      VALUES (${q(nanoid())}, ${q(savId)}, 'interest', ${interest}, 'Interest payment', ${q(monthsAgo(m, 28))})
    `);
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────
  const subs = [
    { name: "Netflix",          amount: 17.99, billing_day: 5,  category: "Streaming" },
    { name: "Spotify",          amount: 11.99, billing_day: 1,  category: "Streaming" },
    { name: "iCloud+",          amount:  9.99, billing_day: 15, category: "Cloud Storage" },
    { name: "Gym Membership",   amount: 45.00, billing_day: 1,  category: "Fitness" },
    { name: "YouTube Premium",  amount: 13.99, billing_day: 8,  category: "Streaming" },
    { name: "Amazon Prime",     amount: 14.99, billing_day: 20, category: "Software" },
    { name: "ChatGPT Plus",     amount: 20.00, billing_day: 12, category: "Software" },
  ];
  for (const s of subs) {
    await conn.query(`
      INSERT INTO subscriptions (id, name, amount, billing_cycle, billing_day, source_type, source_account_id, category, is_active)
      VALUES (${q(nanoid())}, ${q(s.name)}, ${s.amount}, 'monthly', ${s.billing_day}, 'checking', ${q(checkId)}, ${q(s.category)}, true)
    `);
  }

  // ── Debts ───────────────────────────────────────────────────────────────────
  const debtId1 = nanoid();
  const debtId2 = nanoid();
  await conn.query(`
    INSERT INTO debts (id, name, debt_type, current_balance, original_balance, interest_rate, minimum_payment, due_day, is_active)
    VALUES (${q(debtId1)}, 'Chase Sapphire', 'credit_card', 4200.00, 5000.00, 0.2499, 84.00, 15, true)
  `);
  await conn.query(`
    INSERT INTO debts (id, name, debt_type, current_balance, original_balance, interest_rate, minimum_payment, due_day, is_active)
    VALUES (${q(debtId2)}, 'Federal Student Loan', 'student_loan', 21500.00, 28000.00, 0.0550, 232.00, 20, true)
  `);

  // ── Investments ─────────────────────────────────────────────────────────────
  const inv1 = nanoid(); const inv2 = nanoid(); const inv3 = nanoid();
  await conn.query(`
    INSERT INTO investments (id, name, account_type, current_value, monthly_contribution, is_active)
    VALUES (${q(inv1)}, 'Fidelity 401(k)', '401k', 52000.00, 650.00, true)
  `);
  await conn.query(`
    INSERT INTO investments (id, name, account_type, current_value, monthly_contribution, is_active)
    VALUES (${q(inv2)}, 'Vanguard Roth IRA', 'roth_ira', 14800.00, 500.00, true)
  `);
  await conn.query(`
    INSERT INTO investments (id, name, account_type, current_value, monthly_contribution, is_active)
    VALUES (${q(inv3)}, 'Taxable Brokerage', 'brokerage', 9200.00, 200.00, true)
  `);
  // Net worth snapshots for the chart
  const totalDebts = 4200 + 21500;
  const baseAssets = 52000 + 14800 + 9200 + 6500 + 3500;
  for (let m = 5; m >= 0; m--) {
    const assets = Math.round(baseAssets - m * 1800 + Math.random() * 400);
    await conn.query(`
      INSERT INTO net_worth_snapshots (id, snapshot_date, total_assets, total_debts)
      VALUES (${q(nanoid())}, ${q(monthsAgo(m, 1))}, ${assets}, ${totalDebts})
      ON CONFLICT (snapshot_date) DO NOTHING
    `);
  }

  // ── Fantasy ─────────────────────────────────────────────────────────────────
  const fant1 = nanoid(); const fant2 = nanoid(); const fant3 = nanoid();
  await conn.query(`
    INSERT INTO fantasy_accounts (id, name, platform_type, starting_balance, starting_date, is_active)
    VALUES (${q(fant1)}, 'DraftKings', 'sportsbook', 300.00, ${q(monthsAgo(5))}, true)
  `);
  await conn.query(`
    INSERT INTO fantasy_accounts (id, name, platform_type, starting_balance, starting_date, is_active)
    VALUES (${q(fant2)}, 'FanDuel DFS', 'dfs', 150.00, ${q(monthsAgo(4))}, true)
  `);
  await conn.query(`
    INSERT INTO fantasy_accounts (id, name, platform_type, starting_balance, starting_date, is_active)
    VALUES (${q(fant3)}, 'ESPN Fantasy Football', 'fantasy_league', 0.00, ${q(monthsAgo(6))}, true)
  `);

  // Fantasy transactions
  const fantTxs: [string, string, string, number, string][] = [
    [fant1, "deposit",  monthsAgo(4, 10),  100.00, "Added funds"],
    [fant1, "deposit",  monthsAgo(2, 5),    50.00, "Added funds"],
    [fant1, "cashout",  monthsAgo(1, 20),  200.00, "Withdrawal"],
    [fant2, "deposit",  monthsAgo(3, 8),    50.00, "Added funds"],
    [fant2, "deposit",  monthsAgo(2, 14),   25.00, "Added funds"],
    [fant2, "cashout",  monthsAgo(1, 10),   75.00, "Contest winnings"],
  ];
  for (const [accId, type, date, amount, desc] of fantTxs) {
    await conn.query(`
      INSERT INTO fantasy_transactions (id, account_id, type, amount, description, transaction_date)
      VALUES (${q(nanoid())}, ${q(accId)}, ${q(type)}, ${amount}, ${q(desc)}, ${q(date)})
    `);
  }

  // Futures for DraftKings
  const futures = [
    { status: "open",  stake: 50.00,  payout: 300.00, odds: "+500",  placed: monthsAgo(1, 5),  desc: "Chiefs to win Super Bowl" },
    { status: "won",   stake: 25.00,  payout:  87.50, odds: "+250",  placed: monthsAgo(2, 10), desc: "Mahomes MVP",             settled: monthsAgo(0, 5) },
    { status: "lost",  stake: 30.00,  payout: 180.00, odds: "+500",  placed: monthsAgo(3, 2),  desc: "Lakers NBA Finals",       settled: monthsAgo(1, 15) },
  ];
  for (const f of futures) {
    await conn.query(`
      INSERT INTO fantasy_futures (id, account_id, description, stake, potential_payout, odds, status, placed_date${f.settled ? ", settled_date" : ""})
      VALUES (${q(nanoid())}, ${q(fant1)}, ${q(f.desc)}, ${f.stake}, ${f.payout}, ${q(f.odds)}, ${q(f.status)}, ${q(f.placed)}${f.settled ? `, ${q(f.settled)}` : ""})
    `);
  }

  // Fantasy league season
  await conn.query(`
    INSERT INTO fantasy_seasons (id, account_id, description, season_year, buy_in, potential_payout, status, start_date)
    VALUES (${q(nanoid())}, ${q(fant3)}, '12-team PPR League', '2024', 75.00, 500.00, 'active', ${q(monthsAgo(5))})
  `);

  // ── Planning settings ───────────────────────────────────────────────────────
  localStorage.setItem(PLANNING_STORAGE_KEY, JSON.stringify({
    incomeOverride: 7700,
    needsPct: 50,
    wantsPct: 30,
    savingsPct: 20,
  }));
}
