import { describe, it, expect } from "vitest";
import { generateAmortizationSchedule } from "../debt/amortization.js";
import { calculateAvalanche } from "../debt/avalanche.js";
import { calculateSnowball } from "../debt/snowball.js";
import type { Debt } from "../types.js";

describe("generateAmortizationSchedule", () => {
  it("pays off a simple loan in the expected number of months", () => {
    // $1,000 at 12% APR, $100/month → ~10-11 months
    const schedule = generateAmortizationSchedule(1000, 0.12, 100);
    expect(schedule.length).toBeGreaterThan(9);
    expect(schedule.length).toBeLessThan(13);
    expect(schedule[schedule.length - 1]!.balance).toBe(0);
  });

  it("final balance is zero", () => {
    const schedule = generateAmortizationSchedule(5000, 0.18, 250);
    const last = schedule[schedule.length - 1]!;
    expect(last.balance).toBe(0);
  });

  it("each row principal + interest equals payment", () => {
    const schedule = generateAmortizationSchedule(2000, 0.10, 200);
    for (const row of schedule) {
      expect(row.principal + row.interest).toBeCloseTo(row.payment, 1);
    }
  });
});

describe("calculateAvalanche", () => {
  const debts: Debt[] = [
    { id: "a", name: "Card A", balance: 3000, apr: 0.22, minimumPayment: 60 },
    { id: "b", name: "Card B", balance: 1500, apr: 0.15, minimumPayment: 30 },
    { id: "c", name: "Loan",   balance: 5000, apr: 0.08, minimumPayment: 100 },
  ];

  it("pays off all debts", () => {
    const result = calculateAvalanche(debts, 200);
    expect(result.plans.every((p) => p.payoffMonth > 0)).toBe(true);
    expect(result.totalInterestPaid).toBeGreaterThan(0);
  });

  it("pays off highest APR debt first", () => {
    const result = calculateAvalanche(debts, 200);
    const cardA = result.plans.find((p) => p.debtId === "a")!;
    const loan = result.plans.find((p) => p.debtId === "c")!;
    // Card A (22% APR) should be paid off before the Loan (8% APR)
    expect(cardA.payoffMonth).toBeLessThan(loan.payoffMonth);
  });

  it("avalanche pays less total interest than snowball for same debts+extra", () => {
    const avalanche = calculateAvalanche(debts, 200);
    const snowball = calculateSnowball(debts, 200);
    expect(avalanche.totalInterestPaid).toBeLessThanOrEqual(snowball.totalInterestPaid);
  });
});

describe("calculateSnowball", () => {
  const debts: Debt[] = [
    { id: "a", name: "Small",  balance: 500,  apr: 0.10, minimumPayment: 25 },
    { id: "b", name: "Medium", balance: 2000, apr: 0.15, minimumPayment: 50 },
    { id: "c", name: "Large",  balance: 8000, apr: 0.08, minimumPayment: 200 },
  ];

  it("pays off smallest balance first", () => {
    const result = calculateSnowball(debts, 300);
    const small = result.plans.find((p) => p.debtId === "a")!;
    const large = result.plans.find((p) => p.debtId === "c")!;
    expect(small.payoffMonth).toBeLessThan(large.payoffMonth);
  });
});
