import type { HistoricalExpense, BudgetTarget, ForecastDataPoint } from "../types.js";

/**
 * Generate a rolling N-month budget forecast per category.
 * Uses trailing 3-month average as baseline, with a 6-month linear trend applied.
 */
export function generateBudgetForecast(params: {
  historicalExpenses: HistoricalExpense[];
  budgetTargets: BudgetTarget[];
  months: number;
}): ForecastDataPoint[] {
  const { historicalExpenses, budgetTargets, months } = params;

  // Group history by categoryId → sorted months
  const byCategory = new Map<string, { month: string; total: number }[]>();
  for (const exp of historicalExpenses) {
    const list = byCategory.get(exp.categoryId) ?? [];
    list.push({ month: exp.month, total: exp.total });
    byCategory.set(exp.categoryId, list);
  }

  const targetMap = new Map(budgetTargets.map((t) => [t.categoryId, t.targetAmount]));

  const results: ForecastDataPoint[] = [];

  // Determine all unique category IDs
  const allCategories = new Set([
    ...byCategory.keys(),
    ...targetMap.keys(),
  ]);

  // Find the latest historical month to derive future months
  const allMonths = historicalExpenses.map((e) => e.month).sort();
  const latestMonth = allMonths[allMonths.length - 1] ?? formatMonth(new Date());

  for (const categoryId of allCategories) {
    const history = (byCategory.get(categoryId) ?? []).sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    const target = targetMap.get(categoryId) ?? 0;

    // Add historical months as actuals
    for (const h of history) {
      results.push({
        month: h.month,
        categoryId,
        projected: h.total,
        target,
        variance: round2(h.total - target),
        isProjected: false,
      });
    }

    // Compute forecast baseline: trailing 3-month average
    const recent = history.slice(-3).map((h) => h.total);
    const baseline = recent.length > 0
      ? recent.reduce((a, b) => a + b, 0) / recent.length
      : target;

    // Compute 6-month trend (slope via simple linear regression)
    const trendData = history.slice(-6);
    const slope = trendData.length >= 2 ? computeSlope(trendData.map((h) => h.total)) : 0;

    // Project future months
    for (let i = 1; i <= months; i++) {
      const futureMonth = addMonths(latestMonth, i);
      const projected = Math.max(0, baseline + slope * i);
      results.push({
        month: futureMonth,
        categoryId,
        projected: round2(projected),
        target,
        variance: round2(projected - target),
        isProjected: true,
      });
    }
  }

  return results;
}

function computeSlope(values: number[]): number {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * ((values[i] ?? 0) - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function addMonths(yyyyMM: string, n: number): string {
  const [y, m] = yyyyMM.split("-").map(Number) as [number, number];
  const date = new Date(y, m - 1 + n, 1);
  return formatMonth(date);
}

function formatMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
