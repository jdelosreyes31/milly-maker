import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { nanoid } from "../../lib/nanoid.js";

export interface Expense {
  id: string;
  amount: number;
  description: string;
  category_id: string;
  expense_date: string;
  week_start: string;
  notes: string | null;
  created_at: string;
}

export interface ExpenseWithCategory extends Expense {
  category_name: string;
  category_color: string;
}

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function insertExpense(
  conn: AsyncDuckDBConnection,
  data: { amount: number; description: string; category_id: string; expense_date: string; notes?: string }
): Promise<string> {
  const id = nanoid();
  const weekStart = getMondayOf(data.expense_date);
  await conn.query(`
    INSERT INTO expenses (id, amount, description, category_id, expense_date, week_start, notes)
    VALUES ('${id}', ${data.amount}, '${esc(data.description)}', '${data.category_id}',
            '${data.expense_date}', '${weekStart}', ${data.notes ? `'${esc(data.notes)}'` : "NULL"})
  `);
  return id;
}

export async function updateExpense(
  conn: AsyncDuckDBConnection,
  id: string,
  data: { amount: number; description: string; category_id: string; expense_date: string; notes?: string }
): Promise<void> {
  const weekStart = getMondayOf(data.expense_date);
  await conn.query(`
    UPDATE expenses SET
      amount = ${data.amount},
      description = '${esc(data.description)}',
      category_id = '${data.category_id}',
      expense_date = '${data.expense_date}',
      week_start = '${weekStart}',
      notes = ${data.notes ? `'${esc(data.notes)}'` : "NULL"},
      updated_at = now()
    WHERE id = '${id}'
  `);
}

export async function deleteExpense(conn: AsyncDuckDBConnection, id: string): Promise<void> {
  await conn.query(`DELETE FROM expenses WHERE id = '${id}'`);
}

export async function getExpensesByMonth(
  conn: AsyncDuckDBConnection,
  year: number,
  month: number
): Promise<ExpenseWithCategory[]> {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const result = await conn.query(`
    SELECT e.*, c.name AS category_name, c.color AS category_color
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    WHERE strftime(e.expense_date, '%Y-%m') = '${monthStr}'
    ORDER BY e.expense_date DESC, e.created_at DESC
  `);
  return result.toArray() as unknown as ExpenseWithCategory[];
}

export async function getExpensesByWeek(
  conn: AsyncDuckDBConnection,
  weekStart: string
): Promise<ExpenseWithCategory[]> {
  const result = await conn.query(`
    SELECT e.*, c.name AS category_name, c.color AS category_color
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    WHERE e.week_start = '${weekStart}'
    ORDER BY e.expense_date DESC, e.created_at DESC
  `);
  return result.toArray() as unknown as ExpenseWithCategory[];
}

export async function getMonthlyTotals(
  conn: AsyncDuckDBConnection
): Promise<{ month: string; category_id: string; category_name: string; total: number }[]> {
  const result = await conn.query(`
    SELECT
      strftime(e.expense_date, '%Y-%m') AS month,
      e.category_id,
      c.name AS category_name,
      SUM(e.amount)::DOUBLE AS total
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    GROUP BY 1, 2, 3
    ORDER BY 1 DESC, 4 DESC
  `);
  return result.toArray() as { month: string; category_id: string; category_name: string; total: number }[];
}

export async function getRecentWeeks(
  conn: AsyncDuckDBConnection,
  n = 8
): Promise<{ week_start: string; total: number }[]> {
  const result = await conn.query(`
    SELECT week_start, SUM(amount)::DOUBLE AS total
    FROM expenses
    GROUP BY week_start
    ORDER BY week_start DESC
    LIMIT ${n}
  `);
  return result.toArray() as { week_start: string; total: number }[];
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
