import { describe, it, expect } from "vitest";
import { analyze503020 } from "../budget/categories.js";
import { generateBudgetForecast } from "../budget/forecast.js";

describe("analyze503020", () => {
  it("returns on-track when spending matches 50/30/20", () => {
    const result = analyze503020(5000, [
      { categoryId: "housing", amount: 2500, bucket: "needs" },
      { categoryId: "dining",  amount: 1500, bucket: "wants" },
      { categoryId: "savings", amount: 1000, bucket: "savings" },
    ]);
    expect(result.score).toBe("on-track");
    expect(result.needs.percentage).toBe(50);
    expect(result.savings.percentage).toBe(20);
  });

  it("returns warning when slightly over", () => {
    const result = analyze503020(5000, [
      { categoryId: "housing", amount: 2700, bucket: "needs" }, // 54% — 4% over
      { categoryId: "dining",  amount: 1300, bucket: "wants" },
      { categoryId: "savings", amount: 1000, bucket: "savings" },
    ]);
    expect(result.score).toBe("warning");
  });

  it("returns over when significantly over", () => {
    const result = analyze503020(5000, [
      { categoryId: "housing", amount: 3500, bucket: "needs" }, // 70% needs!
      { categoryId: "dining",  amount: 1500, bucket: "wants" },
      { categoryId: "savings", amount: 0,    bucket: "savings" },
    ]);
    expect(result.score).toBe("over");
  });
});

describe("generateBudgetForecast", () => {
  it("produces future months marked as projected", () => {
    const result = generateBudgetForecast({
      historicalExpenses: [
        { month: "2025-01", categoryId: "food", total: 400 },
        { month: "2025-02", categoryId: "food", total: 420 },
        { month: "2025-03", categoryId: "food", total: 410 },
      ],
      budgetTargets: [{ categoryId: "food", targetAmount: 400 }],
      months: 3,
    });

    const projected = result.filter((r) => r.isProjected);
    expect(projected.length).toBe(3);
    projected.forEach((p) => expect(p.month > "2025-03").toBe(true));
  });
});
