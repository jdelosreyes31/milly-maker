import type { Debt, DebtPayoffResult } from "../types.js";
import { _simulatePayoff } from "./avalanche.js";

/**
 * Debt Snowball: pay minimums on all debts, apply extra to smallest balance first.
 * Same simulation as avalanche — just sorted differently.
 */
export function calculateSnowball(
  debts: Debt[],
  extraMonthlyPayment: number
): DebtPayoffResult {
  return _simulatePayoff(
    [...debts].sort((a, b) => a.balance - b.balance),
    extraMonthlyPayment
  );
}
