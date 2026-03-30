import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import schema001 from "./001_initial_schema.sql?raw";
import schema002 from "./002_checking.sql?raw";

const MIGRATIONS: { name: string; sql: string }[] = [
  { name: "001_initial_schema", sql: schema001 },
  { name: "002_checking", sql: schema002 },
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
