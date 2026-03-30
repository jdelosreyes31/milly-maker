import type { AmortizationRow } from "../types.js";

/**
 * Generate a month-by-month amortization schedule until balance reaches zero.
 * Handles the final partial payment correctly.
 */
export function generateAmortizationSchedule(
  balance: number,
  annualRate: number,
  monthlyPayment: number
): AmortizationRow[] {
  const monthlyRate = annualRate / 12;
  const rows: AmortizationRow[] = [];
  let remaining = balance;
  let month = 1;

  // Guard: if monthly payment doesn't cover interest, infinite loop
  const minRequired = remaining * monthlyRate;
  if (monthlyPayment <= minRequired && monthlyRate > 0) {
    monthlyPayment = minRequired + 1;
  }

  while (remaining > 0.005) {
    const interest = remaining * monthlyRate;
    const payment = Math.min(monthlyPayment, remaining + interest);
    const principal = payment - interest;
    remaining = Math.max(0, remaining - principal);

    rows.push({
      month,
      payment: round2(payment),
      principal: round2(principal),
      interest: round2(interest),
      balance: round2(remaining),
    });

    month++;
    if (month > 1200) break; // safety cap at 100 years
  }

  return rows;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
