import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { nanoid } from "../../lib/nanoid.js";

export interface Debt {
  id: string;
  name: string;
  debt_type: string;
  current_balance: number;
  original_balance: number;
  interest_rate: number;
  minimum_payment: number;
  due_day: number | null;
  is_active: boolean;
}

export interface DebtPayment {
  id: string;
  debt_id: string;
  payment_amount: number;
  payment_date: string;
  principal_paid: number | null;
  interest_paid: number | null;
  notes: string | null;
}

export const DEBT_TYPES = [
  { value: "credit_card", label: "Credit Card" },
  { value: "student_loan", label: "Student Loan" },
  { value: "auto", label: "Auto Loan" },
  { value: "personal", label: "Personal Loan" },
  { value: "mortgage", label: "Mortgage" },
  { value: "medical", label: "Medical" },
  { value: "other", label: "Other" },
];

export async function getAllDebts(conn: AsyncDuckDBConnection): Promise<Debt[]> {
  const result = await conn.query(`
    SELECT id, name, debt_type, current_balance::DOUBLE AS current_balance,
           original_balance::DOUBLE AS original_balance,
           interest_rate::DOUBLE AS interest_rate,
           minimum_payment::DOUBLE AS minimum_payment,
           due_day, is_active
    FROM debts WHERE is_active = true
    ORDER BY current_balance DESC
  `);
  return result.toArray() as unknown as Debt[];
}

export async function insertDebt(
  conn: AsyncDuckDBConnection,
  data: Omit<Debt, "id" | "is_active">
): Promise<string> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO debts (id, name, debt_type, current_balance, original_balance, interest_rate, minimum_payment, due_day)
    VALUES ('${id}', '${esc(data.name)}', '${data.debt_type}',
            ${data.current_balance}, ${data.original_balance},
            ${data.interest_rate}, ${data.minimum_payment},
            ${data.due_day ?? "NULL"})
  `);
  return id;
}

export async function updateDebt(
  conn: AsyncDuckDBConnection,
  id: string,
  data: Partial<Omit<Debt, "id">>
): Promise<void> {
  const sets: string[] = [];
  if (data.name !== undefined) sets.push(`name = '${esc(data.name)}'`);
  if (data.current_balance !== undefined) sets.push(`current_balance = ${data.current_balance}`);
  if (data.interest_rate !== undefined) sets.push(`interest_rate = ${data.interest_rate}`);
  if (data.minimum_payment !== undefined) sets.push(`minimum_payment = ${data.minimum_payment}`);
  if (data.due_day !== undefined) sets.push(`due_day = ${data.due_day ?? "NULL"}`);
  if (data.is_active !== undefined) sets.push(`is_active = ${data.is_active}`);
  sets.push("updated_at = now()");

  await conn.query(`UPDATE debts SET ${sets.join(", ")} WHERE id = '${id}'`);
}

export async function deleteDebt(conn: AsyncDuckDBConnection, id: string): Promise<void> {
  await conn.query(`UPDATE debts SET is_active = false, updated_at = now() WHERE id = '${id}'`);
}

export async function insertDebtPayment(
  conn: AsyncDuckDBConnection,
  data: { debt_id: string; payment_amount: number; payment_date: string; notes?: string }
): Promise<void> {
  const id = nanoid();
  await conn.query(`
    INSERT INTO debt_payments (id, debt_id, payment_amount, payment_date, notes)
    VALUES ('${id}', '${data.debt_id}', ${data.payment_amount}, '${data.payment_date}',
            ${data.notes ? `'${esc(data.notes)}'` : "NULL"})
  `);
  // Update current balance
  await conn.query(`
    UPDATE debts SET
      current_balance = GREATEST(0, current_balance - ${data.payment_amount}),
      updated_at = now()
    WHERE id = '${data.debt_id}'
  `);
}

export async function getDebtPayments(conn: AsyncDuckDBConnection, debtId: string): Promise<DebtPayment[]> {
  const result = await conn.query(`
    SELECT id, debt_id, payment_amount::DOUBLE AS payment_amount,
           payment_date::VARCHAR AS payment_date,
           principal_paid::DOUBLE AS principal_paid,
           interest_paid::DOUBLE AS interest_paid, notes
    FROM debt_payments WHERE debt_id = '${debtId}'
    ORDER BY payment_date DESC
  `);
  return result.toArray() as unknown as DebtPayment[];
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
