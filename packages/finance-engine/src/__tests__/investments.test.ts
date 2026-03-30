import { describe, it, expect } from "vitest";
import { projectInvestmentGrowth } from "../investments/compound.js";
import { analyzeAllocation } from "../investments/portfolio.js";

describe("projectInvestmentGrowth", () => {
  it("returns correct number of data points", () => {
    const result = projectInvestmentGrowth({
      currentValue: 10000,
      monthlyContribution: 500,
      annualReturnRate: 0.07,
      years: 10,
    });
    expect(result.length).toBe(120); // 10 years * 12 months
  });

  it("final value is greater than total contributed (due to compound growth)", () => {
    const result = projectInvestmentGrowth({
      currentValue: 0,
      monthlyContribution: 500,
      annualReturnRate: 0.07,
      years: 30,
    });
    const last = result[result.length - 1]!;
    expect(last.nominalValue).toBeGreaterThan(last.totalContributed);
  });

  it("zero return rate equals total contributed", () => {
    const result = projectInvestmentGrowth({
      currentValue: 0,
      monthlyContribution: 100,
      annualReturnRate: 0,
      years: 5,
    });
    const last = result[result.length - 1]!;
    expect(last.nominalValue).toBeCloseTo(last.totalContributed, 0);
  });

  it("nominal value is higher than real value when inflation > 0", () => {
    const result = projectInvestmentGrowth({
      currentValue: 10000,
      monthlyContribution: 500,
      annualReturnRate: 0.07,
      years: 20,
      inflationRate: 0.03,
    });
    const last = result[result.length - 1]!;
    expect(last.nominalValue).toBeGreaterThan(last.realValue);
  });
});

describe("analyzeAllocation", () => {
  it("computes correct percentages", () => {
    const result = analyzeAllocation([
      { id: "1", name: "Roth IRA", accountType: "roth_ira", currentValue: 50000, monthlyContribution: 500 },
      { id: "2", name: "401k",     accountType: "401k",     currentValue: 50000, monthlyContribution: 1000 },
    ]);
    expect(result.totalValue).toBe(100000);
    expect(result.byType["roth_ira"]!.percentage).toBe(50);
    expect(result.byType["401k"]!.percentage).toBe(50);
  });
});
