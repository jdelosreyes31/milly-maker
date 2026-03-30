import type { Investment, AllocationBreakdown } from "../types.js";

export function analyzeAllocation(investments: Investment[]): AllocationBreakdown {
  const totalValue = investments.reduce((sum, inv) => sum + inv.currentValue, 0);

  const byType: AllocationBreakdown["byType"] = {};

  for (const inv of investments) {
    const key = inv.accountType;
    if (!byType[key]) {
      byType[key] = { value: 0, percentage: 0 };
    }
    byType[key]!.value += inv.currentValue;
  }

  if (totalValue > 0) {
    for (const key of Object.keys(byType)) {
      byType[key]!.percentage = round2((byType[key]!.value / totalValue) * 100);
    }
  }

  return { byType, totalValue: round2(totalValue) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
