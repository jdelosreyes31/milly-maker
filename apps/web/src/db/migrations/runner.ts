import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import schema001 from "./001_initial_schema.sql?raw";
import schema002 from "./002_checking.sql?raw";
import schema003 from "./003_savings.sql?raw";
import schema004 from "./004_fantasy.sql?raw";
import schema005 from "./005_fantasy_amendments.sql?raw";
import schema006 from "./006_subscriptions.sql?raw";
import schema007 from "./007_investment_holdings.sql?raw";
import schema008 from "./008_debt_log.sql?raw";
import schema009 from "./009_fantasy_funding.sql?raw";
import schema010 from "./010_checking_category.sql?raw";
import schema011 from "./011_fantasy_contests.sql?raw";
import schema012 from "./012_fantasy_bet_sessions.sql?raw";
import schema013 from "./013_link_fantasy_tx.sql?raw";
import schema014 from "./014_bet_session_open.sql?raw";
import schema015 from "./015_holding_lots.sql?raw";
import schema016 from "./016_holding_sold.sql?raw";
import schema017 from "./017_underdog_bets.sql?raw";
import schema018 from "./018_underdog_monthly.sql?raw";
import schema019 from "./019_underdog_tax.sql?raw";

const MIGRATIONS: { name: string; sql: string }[] = [
  { name: "001_initial_schema", sql: schema001 },
  { name: "002_checking", sql: schema002 },
  { name: "003_savings", sql: schema003 },
  { name: "004_fantasy", sql: schema004 },
  { name: "005_fantasy_amendments", sql: schema005 },
  { name: "006_subscriptions", sql: schema006 },
  { name: "007_investment_holdings", sql: schema007 },
  { name: "008_debt_log", sql: schema008 },
  { name: "009_fantasy_funding", sql: schema009 },
  { name: "010_checking_category", sql: schema010 },
  { name: "011_fantasy_contests", sql: schema011 },
  { name: "012_fantasy_bet_sessions", sql: schema012 },
  { name: "013_link_fantasy_tx", sql: schema013 },
  { name: "014_bet_session_open", sql: schema014 },
  { name: "015_holding_lots", sql: schema015 },
  { name: "016_holding_sold", sql: schema016 },
  { name: "017_underdog_bets", sql: schema017 },
  { name: "018_underdog_monthly", sql: schema018 },
  { name: "019_underdog_tax", sql: schema019 },
];

export async function runMigrations(conn: AsyncDuckDBConnection): Promise<void> {
  // Ensure __migrations table exists (bootstrapped by migration 001, but we need it before checking)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name       VARCHAR PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT now()
    )
  `);

  const appliedResult = await conn.query("SELECT name FROM __migrations");
  const applied = new Set((appliedResult.toArray() as { name: string }[]).map((r) => r.name));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;

    console.log(`[DB] Applying migration: ${migration.name}`);
    await conn.query(migration.sql);
    await conn.query(
      `INSERT OR IGNORE INTO __migrations (name) VALUES ('${migration.name}')`
    );
    console.log(`[DB] Migration applied: ${migration.name}`);
  }
}
