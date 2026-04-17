---
title: 'Coast FIRE Calculator Tab'
type: 'feature'
created: '2026-04-10'
status: 'done'
baseline_commit: 'b1961cffbd3f832edaffa09ba94cebbda3e12efb'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to model a "coast FIRE" strategy — aggressively funding the portfolio until a stop year, then letting compounding do the rest without further contributions.

**Approach:** Add a "Coast FIRE" tab to the investments page with a two-phase projection chart (accumulation → coast), key metrics (value at stop, projected retirement value), and editable inputs for stop year, retirement year, monthly contribution, and return rate. Pre-populate inputs from the live portfolio.

## Boundaries & Constraints

**Always:** Pull `currentValue`, `totalMonthlyContribution`, and weighted avg `annualReturn` from the existing `useInvestments` hook as defaults. All calculation is client-side (no Claude API call). Chart must visually distinguish Phase 1 (with contributions) from Phase 2 (coast — no contributions) using a reference line and color change.

**Ask First:** If the user wants a "required coast number" back-solver (given a retirement target, find the stop-year value needed). Not in scope now.

**Never:** No database writes or new DB tables. No Claude AI analysis. Do not modify the finance-engine package. Do not break or re-layout existing tabs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stop year = current year | stopYear = 2026 | Phase 1 is zero months; chart shows pure coast from current value | graceful — chart renders from current year |
| Stop year > retirement year | stopYear > retirementYear | Retirement year snaps to stopYear + 1, shown as validation hint | inline field hint, no crash |
| Return rate = 0 | annualReturn = 0 | Values stay flat after contributions stop | valid — renders flat line |
| No investments yet | totalValue = 0 | Inputs still render; chart shows $0 line | no error state needed |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/investments/InvestmentsPage.tsx` -- adds "Coast FIRE" tab button and renders `<InvestmentCoastFireView>`
- `apps/web/src/features/investments/InvestmentCoastFireView.tsx` -- new component: all calculator logic, inputs, and chart
- `packages/finance-engine/src/index.ts` (or equivalent export) -- `projectInvestmentGrowth` used for both phases (set `monthlyContribution: 0` for phase 2)

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/investments/InvestmentCoastFireView.tsx` -- CREATE new component with two-phase projection logic, editable inputs (stop year, retirement year, monthly contribution, return rate pre-populated from props), AreaChart with a ReferenceLine at the stop year dividing Phase 1 and Phase 2, and stat cards for key metrics
- [x] `apps/web/src/features/investments/InvestmentsPage.tsx` -- ADD "Coast FIRE" to the view union type, add tab button (no `disabled` gate — always accessible), import and render `<InvestmentCoastFireView>` with `totalValue`, `totalMonthlyContribution`, and weighted avg return rate as props

**Acceptance Criteria:**
- Given the investments page loads, when the user clicks "Coast FIRE", then the tab renders with inputs pre-populated from the current portfolio and a two-phase chart.
- Given a stop year and retirement year are set, when any input changes, then the chart and stat cards update immediately (no submit button needed).
- Given stopYear >= retirementYear, when the user sets such a value, then an inline hint corrects the retirement year and the chart remains stable.
- Given phase 1 ends at the stop year, when the chart renders, then a vertical reference line and label mark the transition from accumulation to coast.

## Design Notes

Two-phase projection using `projectInvestmentGrowth`:
- Phase 1: `currentValue`, `monthlyContribution`, `annualReturn`, years = stopYear - currentYear
- Phase 2: `valueAtStop` (phase 1 final nominalValue), `monthlyContribution: 0`, `annualReturn`, years = retirementYear - stopYear
- Concatenate both arrays for a single continuous chart, offsetting month indices for phase 2.
- Use two `Area` fills (e.g. primary color for phase 1, muted for phase 2) OR a single area with a `ReferenceLine` at the stop year x-axis label.
- Stat cards: "Value at Stop", "Projected at Retirement", "Total Contributed (Phase 1)", "Coast Growth".

## Verification

**Commands:**
- `pnpm --filter web tsc --noEmit` -- expected: no type errors

**Manual checks (if no CLI):**
- Tab appears between "Actual" and the right edge; inputs respond to changes; chart shows two visually distinct phases.

## Suggested Review Order

**Entry point — new component**

- Core projection logic: two-phase skip, anchor point when stopYear=now
  [`InvestmentCoastFireView.tsx:27`](../../apps/web/src/features/investments/InvestmentCoastFireView.tsx#L27)

- State init + async-sync effects for props loaded after mount
  [`InvestmentCoastFireView.tsx:83`](../../apps/web/src/features/investments/InvestmentCoastFireView.tsx#L83)

**Chart data construction**

- chartData split: accumulation ≤ stopYear, coast > stopYear (no duplicate boundary point)
  [`InvestmentCoastFireView.tsx:109`](../../apps/web/src/features/investments/InvestmentCoastFireView.tsx#L109)

- Two-area chart with ReferenceLine at stop year for visual phase separation
  [`InvestmentCoastFireView.tsx:220`](../../apps/web/src/features/investments/InvestmentCoastFireView.tsx#L220)

**Tab wiring in InvestmentsPage**

- View union type extended with "coast", weighted avg return hoisted for reuse
  [`InvestmentsPage.tsx:140`](../../apps/web/src/features/investments/InvestmentsPage.tsx#L140)

- "Coast FIRE" tab button (no disabled gate — always accessible)
  [`InvestmentsPage.tsx:393`](../../apps/web/src/features/investments/InvestmentsPage.tsx#L393)

- Render block with props passed from portfolio state
  [`InvestmentsPage.tsx:801`](../../apps/web/src/features/investments/InvestmentsPage.tsx#L801)
