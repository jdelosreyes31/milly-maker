// ── Debt ─────────────────────────────────────────────────────────────────────

export interface Debt {
  id: string;
  name: string;
  balance: number;
  apr: number; // as decimal, e.g. 0.2499 for 24.99%
  minimumPayment: number;
}

export interface AmortizationRow {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

export interface DebtPayoffPlan {
  debtId: string;
  payoffMonth: number;
  totalInterestPaid: number;
  schedule: AmortizationRow[];
}

export interface MonthlyDebtSnapshot {
  month: number;
  totalBalance: number;
  totalPaid: number;
  totalInterest: number;
}

export interface DebtPayoffResult {
  plans: DebtPayoffPlan[];
  totalMonths: number;
  totalInterestPaid: number;
  monthlyCashflow: MonthlyDebtSnapshot[];
}

// ── Investments ───────────────────────────────────────────────────────────────

export interface InvestmentProjectionParams {
  currentValue: number;
  monthlyContribution: number;
  annualReturnRate: number; // e.g. 0.07
  years: number;
  inflationRate?: number; // e.g. 0.03
}

export interface ProjectionDataPoint {
  month: number;
  year: number;
  nominalValue: number;
  realValue: number;
  totalContributed: number;
}

export interface Investment {
  id: string;
  name: string;
  accountType: string;
  currentValue: number;
  monthlyContribution: number;
}

export interface AllocationBreakdown {
  byType: Record<string, { value: number; percentage: number }>;
  totalValue: number;
}

// ── Budget ────────────────────────────────────────────────────────────────────

export interface HistoricalExpense {
  month: string; // "YYYY-MM"
  categoryId: string;
  total: number;
}

export interface BudgetTarget {
  categoryId: string;
  targetAmount: number;
}

export interface ForecastDataPoint {
  month: string; // "YYYY-MM"
  categoryId: string;
  projected: number;
  target: number;
  variance: number; // positive = over budget
  isProjected: boolean; // true = future month
}

export type SpendingBucket = "needs" | "wants" | "savings";

export interface CategorySpend {
  categoryId: string;
  amount: number;
  bucket: SpendingBucket;
}

export type RuleScore = "on-track" | "warning" | "over";

export interface Rule503020Result {
  needs: { amount: number; percentage: number; target: number };
  wants: { amount: number; percentage: number; target: number };
  savings: { amount: number; percentage: number; target: number };
  score: RuleScore;
}
