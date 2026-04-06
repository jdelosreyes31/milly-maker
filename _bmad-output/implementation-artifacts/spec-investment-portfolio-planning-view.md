---
title: 'Investment Portfolio Planning View'
type: 'feature'
created: '2026-04-06'
status: 'done'
context: []
baseline_commit: '85c6a4b1e993a8c7bb8f4da45b2b9e0649e1f43f'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Investments page has no planning mode — there is no way to model how to deploy available cash across existing holdings to hit target portfolio exposures, nor to think through how future contributions should be deployed quarter by quarter.

**Approach:** Add a Planning view toggle inside the Investments page (no new route). The Planning view takes a cash-to-invest amount and a monthly contribution amount, lets the user set a target % per existing holding, computes required buy amounts, and calls Claude to review the plan as an investment manager — reasoning strategically about the immediate deploy and producing a 3-month-interval contribution ladder detailing where each future contribution should go.

## Boundaries & Constraints

**Always:**
- Planning view is a view toggle within `/investments` — not a new route or page
- Holdings data comes from `useInvestments()` (already populated); no new DB tables or migrations
- Target allocations persist in `localStorage` (key: `investmentPlanAllocations`) as `Record<holdingId, targetPct>` — same pattern as `planningSettings`
- Claude integration: use `localStorage.getItem("anthropicApiKey")` + `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true`, streaming response — identical pattern to `useAssistant.ts`
- CSS: CSS custom property tokens only (`var(--color-*)`) — no raw Tailwind color classes
- All imports use `.js` extension; `@/` alias for app-internal imports

**Ask First:**
- If holdings list is empty when the user tries to open Planning view — ask whether to show a prompt to add holdings or simply disable the tab

**Never:**
- No new Zustand store; no new DuckDB queries or migrations
- Do not add a new top-level route for this feature
- Do not attempt to fetch real-time stock prices — all values come from what's already in the DB

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal plan | Cash > 0, target %s sum to 100, all holdings have prices | Each holding shows buy $ amount; total buys ≤ cash input | N/A |
| %s don't sum to 100 | Target pcts sum ≠ 100 | Show inline warning; disable "Analyze" button | Warn inline, don't block editing |
| Cash = 0 | User enters 0 | Buy amounts all = $0; can still run Claude analysis on current allocation | N/A |
| Buy < $1 | Computed buy for a holding is < $1 | Show "$0.00" and flag in Claude context as negligible | N/A |
| Unstarted position | Holding has current value = $0 but target % > 0 | Row shows $0 current, computed buy $, and is labeled "Unstarted"; Claude prompt explicitly identifies it as a new position to evaluate entry timing for | N/A |
| Contribution = 0 | Monthly contribution input is 0 or blank | Ladder section of Claude prompt omitted; analysis covers immediate deploy only | N/A |
| No API key | User clicks Analyze | Show "Add Anthropic API key in Settings" message inline | No crash |
| No holdings | Holdings array empty | Disable Planning tab with tooltip "Add holdings first" | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/investments/InvestmentsPage.tsx` — existing page; add view-toggle state + conditional render of `InvestmentPlanningView`
- `apps/web/src/features/investments/InvestmentPlanningView.tsx` — new component (cash input, per-holding allocation table, buy math, Claude analysis panel)
- `apps/web/src/features/assistant/useAssistant.ts` — reference only: Claude streaming pattern + API key retrieval

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/investments/InvestmentsPage.tsx` -- Add a two-tab toggle ("Overview" / "Planning") below the page header; wrap existing JSX in the Overview branch; render `<InvestmentPlanningView>` in the Planning branch. Pass `holdings` and `totalValue` as props. Disable the Planning tab when `holdings.length === 0` with a `title` tooltip. -- Keeps existing UI unchanged for the default view
- [x] `apps/web/src/features/investments/InvestmentPlanningView.tsx` -- Create component. Section 1: two inputs — cash-to-invest and monthly contribution amount. Section 2: table of holdings rows — each row shows ticker/name, current value, current %, target % input (number, 0–100), computed buy $; footer row shows totals + allocation-sum warning if ≠ 100. Section 3: "Analyze with Claude" button that builds a structured prompt and streams a response inline (no AssistantPanel dependency). Store/load target %s, cash, and monthly contribution from localStorage key `investmentPlanAllocations`. -- Self-contained; no new hooks or stores

**Acceptance Criteria:**
- Given the Investments page, when holdings exist, then an "Overview / Planning" toggle is visible in the header area
- Given the Planning view, when I enter cash and set target %s summing to 100, then each holding row shows a non-negative buy amount and the total buy row equals cash-to-invest (or less if some holdings are already over-weight)
- Given target %s that don't sum to 100, when I view the footer, then a warning badge shows the deviation and the Analyze button is disabled
- Given a valid plan, when I click "Analyze with Claude", then a streaming response appears inline where Claude: (1) reasons through the immediate deploy as a portfolio manager — calling out underweight/overweight positions by name, treating overweight as a strategic choice to evaluate, advising on entry timing for unstarted positions; (2) when monthly contribution > 0, produces a 3-month-interval ladder for Q1–Q4 reasoning about where each quarter's contribution should go given portfolio drift and priority
- Given a monthly contribution of $0, when I click "Analyze with Claude", then the ladder section is omitted and Claude focuses only on the immediate deploy
- Given no Anthropic API key in localStorage, when I click "Analyze with Claude", then an inline message directs me to Settings — no error thrown
- Given the Planning tab is active and I navigate away and back, then my entered cash amount and target %s are restored from localStorage

## Design Notes

**Claude prompt structure** — The prompt must be highly specific and treat Claude as a true investment manager, not a math checker. Build it in two parts:

*System:* "You are a seasoned portfolio manager conducting a full investment plan review. You have the user's complete current holdings, their target allocation, and the cash they intend to deploy. Your job is to reason through this plan the way a CFA would — not just validate the arithmetic. Consider whether each position is underweight or overweight relative to the target, whether the planned buys meaningfully close that gap, whether going overweight on a specific name or asset class could be a valid strategic choice (e.g., conviction overweight is not automatically wrong), and whether any individual buy is too small to move the needle. Flag fractional-share situations as a practical note, not a veto. Be direct, opinionated, and specific — reference the actual tickers, dollar amounts, and percentage deltas."

*User message:* Include all of the following:
- Total current portfolio value and total cash to deploy
- Each holding's: name, ticker (if set), asset class, current value, current allocation %, target allocation %, delta (target − current), computed buy $
- An explicit note of which holdings are underweight (delta > 0), at-weight (delta ≈ 0), or overweight (delta < 0)
- Holdings with 0% current exposure but a target > 0 are called out as **unstarted positions** — these are flagged separately so Claude can reason about entry timing
- Monthly contribution amount
- A plain-English statement of what the user is trying to achieve: "I have $X to invest today and will contribute $Y/month going forward. I want to move my portfolio toward [target allocations]. Here is my immediate deploy plan — please review it as my portfolio manager. Then, walk me through a 3-month-interval contribution ladder: for each quarter (months 1–3, 4–6, 7–9, 10–12), tell me what you would do with the $Y * 3 contribution. Don't make this a math exercise — reason through it. Which positions are still underweight and most deserve capital? Have any positions drifted enough to change the priority? When should I initiate unstarted positions? What would change your recommendation?"

**Buy math:**
```
newTotal = totalValue + cash
targetValue(h) = newTotal * (targetPct(h) / 100)
buy(h) = max(0, targetValue(h) - h.current_value)
// Scale down if sum(buys) > cash: scale each buy proportionally
```

**View toggle** — simple `useState<"overview" | "planning">` in `InvestmentsPage`; rendered as two pill-style buttons using `var(--color-primary)` for active state.

## Verification

**Commands:**
- `pnpm type-check` -- expected: zero TypeScript errors

## Suggested Review Order

**View integration (entry point)**

- `view` state; default `"overview"` means zero behavior change for existing users
  [`InvestmentsPage.tsx:116`](../../apps/web/src/features/investments/InvestmentsPage.tsx#L116)

- Toggle buttons; Planning disabled when `holdings.length === 0`
  [`InvestmentsPage.tsx:278`](../../apps/web/src/features/investments/InvestmentsPage.tsx#L278)

- Conditional render; `<>` fragment keeps dialogs always mounted outside both branches
  [`InvestmentsPage.tsx:307`](../../apps/web/src/features/investments/InvestmentsPage.tsx#L307)

**Buy math and allocation logic**

- Lazy `useState` initializers; `loadStoredPlan()` reads localStorage once on mount only
  [`InvestmentPlanningView.tsx:31`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L31)

- `scale = 0` when `cashNum <= 0` enforces spec: cash = 0 → all buys = $0
  [`InvestmentPlanningView.tsx:63`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L63)

- Proportional scale-down when total raw buys exceed available cash
  [`InvestmentPlanningView.tsx:62`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L62)

**Claude prompt construction**

- `handleAnalyze` entry; SDK pattern matches `useAssistant.ts` exactly
  [`InvestmentPlanningView.tsx:77`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L77)

- Holdings table row builder; UNDERWEIGHT / OVERWEIGHT / AT-WEIGHT / [UNSTARTED] classification
  [`InvestmentPlanningView.tsx:87`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L87)

- Contribution ladder conditional; omitted entirely when `monthlyNum = 0`
  [`InvestmentPlanningView.tsx:104`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L104)

- System prompt; investment manager persona, strategic reasoning, conviction-overweight framing
  [`InvestmentPlanningView.tsx:131`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L131)

**Persistence**

- `useEffect` saves full plan state to `investmentPlanAllocations` on every input change
  [`InvestmentPlanningView.tsx:40`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L40)

**UI rendering**

- Allocation table; target % inline input, delta coloring, Unstarted badge per row
  [`InvestmentPlanningView.tsx:164`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L164)

- Allocation sum warning badge; Analyze button disabled until sum reaches 100%
  [`InvestmentPlanningView.tsx:201`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L201)

- No-API-key inline fallback with Settings link
  [`InvestmentPlanningView.tsx:303`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L303)

- Streaming analysis card; `whitespace-pre-wrap` preserves Claude's structured output
  [`InvestmentPlanningView.tsx:341`](../../apps/web/src/features/investments/InvestmentPlanningView.tsx#L341)
