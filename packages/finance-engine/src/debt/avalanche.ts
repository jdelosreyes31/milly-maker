import type { Debt, DebtPayoffResult, DebtPayoffPlan, MonthlyDebtSnapshot } from "../types.js";
import { generateAmortizationSchedule } from "./amortization.js";

/**
 * Debt Avalanche: pay minimums on all debts, apply extra to highest APR first.
 * When a debt is paid off its freed payment rolls to the next highest APR debt.
 */
export function calculateAvalanche(
  debts: Debt[],
  extraMonthlyPayment: number
): DebtPayoffResult {
  return simulatePayoff([...debts].sort((a, b) => b.apr - a.apr), extraMonthlyPayment);
}

function simulatePayoff(ordered: Debt[], extra: number): DebtPayoffResult {
  // Working state per debt
  const state = ordered.map((d) => ({
    id: d.id,
    balance: d.balance,
    apr: d.apr,
    minPayment: d.minimumPayment,
    paidOff: false,
    payoffMonth: 0,
    totalInterest: 0,
    schedule: [] as { month: number; payment: number; principal: number; interest: number; balance: number }[],
  }));

  const monthlySnapshots: MonthlyDebtSnapshot[] = [];
  let month = 0;
  let availableExtra = extra;

  while (state.some((s) => !s.paidOff)) {
    month++;
    let monthTotalPaid = 0;
    let monthTotalInterest = 0;

    // Find the focus debt (first unpaid in priority order)
    const focusIdx = state.findIndex((s) => !s.paidOff);

    for (let i = 0; i < state.length; i++) {
      const s = state[i]!;
      if (s.paidOff) continue;

      const monthlyRate = s.apr / 12;
      const interest = s.balance * monthlyRate;
      let payment = s.minPayment;

      // Dump extra into focus debt
      if (i === focusIdx) {
        payment += availableExtra;
      }

      payment = Math.min(payment, s.balance + interest);
      const principal = payment - interest;
      s.balance = Math.max(0, s.balance - principal);

      s.totalInterest += interest;
      monthTotalPaid += payment;
      monthTotalInterest += interest;

      s.schedule.push({
        month,
        payment: round2(payment),
        principal: round2(principal),
        interest: round2(interest),
        balance: round2(s.balance),
      });

      if (s.balance < 0.005) {
        s.paidOff = true;
        s.payoffMonth = month;
        // Roll freed minimum into extra for next debt
        availableExtra += s.minPayment;
      }
    }

    monthlySnapshots.push({
      month,
      totalBalance: round2(state.reduce((sum, s) => sum + s.balance, 0)),
      totalPaid: round2(monthTotalPaid),
      totalInterest: round2(monthTotalInterest),
    });

    if (month > 1200) break;
  }

  const plans: DebtPayoffPlan[] = state.map((s) => ({
    debtId: s.id,
    payoffMonth: s.payoffMonth,
    totalInterestPaid: round2(s.totalInterest),
    schedule: s.schedule,
  }));

  return {
    plans,
    totalMonths: month,
    totalInterestPaid: round2(state.reduce((sum, s) => sum + s.totalInterest, 0)),
    monthlyCashflow: monthlySnapshots,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Re-export for convenience
export { simulatePayoff as _simulatePayoff };
