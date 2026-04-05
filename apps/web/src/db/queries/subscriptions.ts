import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { nanoid } from "../../lib/nanoid.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BillingCycle = "weekly" | "monthly" | "quarterly" | "yearly";
export type SubscriptionSourceType = "checking" | "savings" | "debt";

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  billing_cycle: BillingCycle;
  billing_day: number | null;
  source_type: SubscriptionSourceType;
  source_account_id: string;
  source_account_name: string | null;
  category: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

// Monthly-equivalent amount for a subscription
export function toMonthly(amount: number, cycle: BillingCycle): number {
  switch (cycle) {
    case "weekly":    return Math.round(amount * (52 / 12) * 100) / 100;
    case "monthly":   return amount;
    case "quarterly": return Math.round((amount / 3) * 100) / 100;
    case "yearly":    return Math.round((amount / 12) * 100) / 100;
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getAllSubscriptions(
  conn: AsyncDuckDBConnection
): Promise<Subscription[]> {
  const result = await conn.query(`
    SELECT
      s.id,
      s.name,
      s.amount::DOUBLE       AS amount,
      s.billing_cycle,
      s.billing_day,
      s.source_type,
      s.source_account_id,
      COALESCE(ca.name, sa.name, d.name) AS source_account_name,
      s.category,
      s.is_active,
      s.notes,
      s.created_at::VARCHAR  AS created_at
    FROM subscriptions s
    LEFT JOIN checking_accounts ca ON s.source_type = 'checking' AND s.source_account_id = ca.id
    LEFT JOIN savings_accounts  sa ON s.source_type = 'savings'  AND s.source_account_id = sa.id
    LEFT JOIN debts              d  ON s.source_type = 'debt'     AND s.source_account_id = d.id
    WHERE s.is_active = true
    ORDER BY s.created_at ASC
  `);
  return result.toArray() as unknown as Subscription[];
}

export async function insertSubscription(
  conn: AsyncDuckDBConnection,
  data: {
    name: string;
    amount: number;
    billing_cycle: BillingCycle;
    billing_day: number | null;
    source_type: SubscriptionSourceType;
    source_account_id: string;
    category: string | null;
    notes: string | null;
  }
): Promise<string> {
  const id = nanoid();
  const billingDay = data.billing_day != null ? String(data.billing_day) : "NULL";
  const category = data.category ? `'${esc(data.category)}'` : "NULL";
  const notes = data.notes ? `'${esc(data.notes)}'` : "NULL";
  await conn.query(`
    INSERT INTO subscriptions (id, name, amount, billing_cycle, billing_day, source_type, source_account_id, category, notes)
    VALUES (
      '${id}',
      '${esc(data.name)}',
      ${data.amount},
      '${data.billing_cycle}',
      ${billingDay},
      '${data.source_type}',
      '${data.source_account_id}',
      ${category},
      ${notes}
    )
  `);
  return id;
}

export async function updateSubscription(
  conn: AsyncDuckDBConnection,
  id: string,
  data: {
    name: string;
    amount: number;
    billing_cycle: BillingCycle;
    billing_day: number | null;
    source_type: SubscriptionSourceType;
    source_account_id: string;
    category: string | null;
    notes: string | null;
  }
): Promise<void> {
  const billingDay = data.billing_day != null ? String(data.billing_day) : "NULL";
  const category = data.category ? `'${esc(data.category)}'` : "NULL";
  const notes = data.notes ? `'${esc(data.notes)}'` : "NULL";
  await conn.query(`
    UPDATE subscriptions SET
      name              = '${esc(data.name)}',
      amount            = ${data.amount},
      billing_cycle     = '${data.billing_cycle}',
      billing_day       = ${billingDay},
      source_type       = '${data.source_type}',
      source_account_id = '${data.source_account_id}',
      category          = ${category},
      notes             = ${notes}
    WHERE id = '${id}'
  `);
}

export async function cancelSubscription(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`UPDATE subscriptions SET is_active = false WHERE id = '${id}'`);
}

/** @deprecated use cancelSubscription — kept for any existing callers */
export const deleteSubscription = cancelSubscription;

export async function restoreSubscription(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`UPDATE subscriptions SET is_active = true WHERE id = '${id}'`);
}

export async function hardDeleteSubscription(
  conn: AsyncDuckDBConnection,
  id: string
): Promise<void> {
  await conn.query(`DELETE FROM subscriptions WHERE id = '${id}'`);
}

export async function getCancelledSubscriptions(
  conn: AsyncDuckDBConnection
): Promise<Subscription[]> {
  const result = await conn.query(`
    SELECT
      s.id,
      s.name,
      s.amount::DOUBLE       AS amount,
      s.billing_cycle,
      s.billing_day,
      s.source_type,
      s.source_account_id,
      COALESCE(ca.name, sa.name, d.name) AS source_account_name,
      s.category,
      s.is_active,
      s.notes,
      s.created_at::VARCHAR  AS created_at
    FROM subscriptions s
    LEFT JOIN checking_accounts ca ON s.source_type = 'checking' AND s.source_account_id = ca.id
    LEFT JOIN savings_accounts  sa ON s.source_type = 'savings'  AND s.source_account_id = sa.id
    LEFT JOIN debts              d  ON s.source_type = 'debt'     AND s.source_account_id = d.id
    WHERE s.is_active = false
    ORDER BY s.created_at DESC
  `);
  return result.toArray() as unknown as Subscription[];
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
