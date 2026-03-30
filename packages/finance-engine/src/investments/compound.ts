import type { InvestmentProjectionParams, ProjectionDataPoint } from "../types.js";

/**
 * Project investment growth using future value formula with regular contributions.
 * FV = P*(1+r)^n + PMT * (((1+r)^n - 1) / r)
 * where r = monthly rate, n = total months.
 */
export function projectInvestmentGrowth(
  params: InvestmentProjectionParams
): ProjectionDataPoint[] {
  const { currentValue, monthlyContribution, annualReturnRate, years, inflationRate = 0 } = params;

  const monthlyRate = annualReturnRate / 12;
  const monthlyInflation = inflationRate / 12;
  const totalMonths = years * 12;
  const points: ProjectionDataPoint[] = [];

  let nominalValue = currentValue;
  let totalContributed = currentValue;

  for (let m = 1; m <= totalMonths; m++) {
    nominalValue = nominalValue * (1 + monthlyRate) + monthlyContribution;
    totalContributed += monthlyContribution;

    // Real value: deflate by cumulative inflation
    const inflationFactor = Math.pow(1 + monthlyInflation, m);
    const realValue = inflationRate > 0 ? nominalValue / inflationFactor : nominalValue;

    points.push({
      month: m,
      year: Math.floor((m - 1) / 12) + 1,
      nominalValue: round2(nominalValue),
      realValue: round2(realValue),
      totalContributed: round2(totalContributed),
    });
  }

  return points;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
