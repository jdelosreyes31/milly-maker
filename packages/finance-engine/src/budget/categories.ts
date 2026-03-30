import type { CategorySpend, Rule503020Result, RuleScore } from "../types.js";

const TARGETS = { needs: 50, wants: 30, savings: 20 };
const WARNING_THRESHOLD = 5; // within 5% is a warning, over is "over"

export function analyze503020(
  monthlyIncome: number,
  expenses: CategorySpend[]
): Rule503020Result {
  const buckets = { needs: 0, wants: 0, savings: 0 };

  for (const exp of expenses) {
    buckets[exp.bucket] += exp.amount;
  }

  const needs = {
    amount: round2(buckets.needs),
    percentage: monthlyIncome > 0 ? round2((buckets.needs / monthlyIncome) * 100) : 0,
    target: TARGETS.needs,
  };
  const wants = {
    amount: round2(buckets.wants),
    percentage: monthlyIncome > 0 ? round2((buckets.wants / monthlyIncome) * 100) : 0,
    target: TARGETS.wants,
  };
  const savings = {
    amount: round2(buckets.savings),
    percentage: monthlyIncome > 0 ? round2((buckets.savings / monthlyIncome) * 100) : 0,
    target: TARGETS.savings,
  };

  const score: RuleScore = computeScore(needs.percentage, wants.percentage, savings.percentage);

  return { needs, wants, savings, score };
}

function computeScore(needsPct: number, wantsPct: number, savingsPct: number): RuleScore {
  const needsDiff = needsPct - TARGETS.needs;
  const wantsDiff = wantsPct - TARGETS.wants;
  const savingsDiff = TARGETS.savings - savingsPct; // positive = under-saving

  const maxOver = Math.max(needsDiff, wantsDiff, savingsDiff);

  if (maxOver > WARNING_THRESHOLD) return "over";
  if (maxOver > 0) return "warning";
  return "on-track";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
