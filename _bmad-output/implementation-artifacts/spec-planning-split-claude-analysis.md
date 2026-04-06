---
title: 'Planning: Split Claude Analysis into Portfolio Thesis vs. Investment Plan'
type: 'feature'
created: '2026-04-06'
status: 'done'
context: []
baseline_commit: '0782fb07169bf47fd3ce771980c0c6b3299ae60b'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The single "Analyze with Claude" button conflates two different jobs: understanding what strategic bets the portfolio represents versus deciding how to deploy cash right now. The first is strategic and runs off holdings + target weights alone; the second is tactical and needs cash inputs and buy math.

**Approach:** Split into two distinct buttons with separate output cards and separate prompts. "Analyze with Claude" becomes a portfolio thesis read — what economic bets are being made, what narrative the allocation tells, and what risks that implies — with a default investor context of moderate-to-aggressive growth over 7 years (ages 33–40) with a small floor income provider. "Invest with Claude" keeps the current deployment-plan prompt but adds explicit "DO NOT BUY" flagging for positions too small to matter.

## Boundaries & Constraints

**Always:**
- Two separate buttons, two separate streaming output cards; both can be visible simultaneously
- **"Analyze with Claude"** — thesis mode; works off current holdings + planned weights only; can run with no cash entered and even if allocation doesn't sum to 100; bakes in the default investor context (moderate-aggressive, 7yr, 33–40, small floor income) in the system prompt
- **"Invest with Claude"** — deployment mode; rename of the existing button and handler; requires allocationOk to enable (same as today); adds "DO NOT BUY" language to the prompt for positions where the planned buy is < $50 OR the resulting position would be < 0.5% of the post-deploy total portfolio
- Each button has its own `analyzing*` flag and error state so they can be run independently or concurrently
- All existing rules apply (CSS tokens, `.js` imports, streaming pattern, no new stores)

**Ask First:**
- If the user wants the investor context (age, horizon, floor income) to be configurable via a UI input rather than hardcoded — ask before adding that complexity

**Never:**
- Do not merge the two outputs into one card
- Do not require allocationOk for the "Analyze" (thesis) button
- Do not remove the quarterly contribution ladder from "Invest with Claude"

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Run Analyze only | Holdings present, no cash, allocations may not sum to 100 | Thesis card streams; Invest card absent | N/A |
| Run Invest only | allocationOk, cash > 0 | Invest card streams; Thesis card absent | N/A |
| Run both | Run Analyze then Invest (or vice versa) | Both cards visible simultaneously | N/A |
| No holdings or planned holdings | allRows.length === 0 | Both buttons disabled | N/A |
| Position buy < $50 or < 0.5% of new total | Computed in Invest prompt context | Position flagged as "DO NOT BUY — size too small" in prompt; Claude reasons about it | N/A |
| No API key | Either button clicked | Existing inline Settings message; no crash | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/investments/InvestmentPlanningView.tsx` — all changes; split `handleAnalyze` into `handlePortfolioThesis` + `handleInvestPlan`; add separate state pairs; update button labels and disabled conditions; add DO NOT BUY threshold logic to invest prompt

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/features/investments/InvestmentPlanningView.tsx` -- (a) Rename existing analysis state vars: `analysis`→`investPlan`, `analyzing`→`analyzingPlan`, `analysisError`→`investPlanError`; add parallel vars `thesis`, `analyzingThesis`, `thesisError`. (b) Rename `handleAnalyze` → `handleInvestPlan`; update disabled condition to keep `allocationOk` requirement. (c) Add `handlePortfolioThesis` with a new prompt focused on economic thesis, macro bets, and investor-context-aware strategic review; no cash/buy-math in this prompt. (d) Replace single button+card with two button+card pairs. (e) In `handleInvestPlan` prompt, mark each holding where `buy < 50 || buy / newTotal < 0.005` as `[DO NOT BUY — size too small]` in the table row. -- Single file, self-contained

**Acceptance Criteria:**
- Given the Planning view, when I click "Analyze with Claude", then a streaming response appears in a "Portfolio Thesis" card identifying the economic/macro bets the portfolio represents and evaluating them against a 7-year moderate-to-aggressive growth goal with a small floor income provider
- Given the Planning view with allocationOk, when I click "Invest with Claude", then a streaming response appears in an "Investment Plan" card with the deployment plan, ladder, and explicit DO NOT BUY flags for undersized positions
- Given both buttons have been clicked, then both cards are visible on screen simultaneously
- Given a computed buy amount < $50 or < 0.5% of the post-deploy portfolio, when "Invest with Claude" runs, then that holding is flagged DO NOT BUY in Claude's context and Claude reasons about it explicitly
- Given no API key, when either button is clicked, then the inline Settings message appears and no error is thrown
- Given allRows.length === 0, then both buttons are disabled
- Given "Analyze with Claude", it can be run even when cash is empty or allocations don't sum to 100

## Design Notes

**Analyze prompt — system:**
"You are a strategic investment analyst reviewing a portfolio. The investor is 33 years old targeting moderate-to-aggressive growth over a 7-year horizon (to age 40). They have a small floor income provider (covering basic living expenses), which means they can tolerate meaningful volatility but cannot afford a total wipeout of liquid assets. Your job is to read this portfolio the way a macro strategist would — identify what economic thesis or theses the allocation represents, what bets are being made against the broader economy and market structure, and whether those bets are coherent and well-constructed for this investor's profile. Be specific about what each position or group represents thematically. Call out any internal contradictions, missing exposure given the stated thesis, or uncompensated risks."

**Analyze prompt — user message:** Include current holdings + planned holdings table (name, ticker, asset class, current value, current %, target %), total portfolio value, note that [PLANNED] rows are future intentions. Do NOT include cash input or buy math — this is not about today's deploy, it's about the portfolio thesis.

**Invest prompt — DO NOT BUY threshold:** Before building the holdings table, compute `doNotBuy(r) = r.buy < 50 || (newTotal > 0 && r.buy / newTotal < 0.005)`. Append `[DO NOT BUY — size too small]` to the status column for flagged rows. Add to user message: "Positions flagged DO NOT BUY should be explicitly addressed — confirm whether to defer, consolidate, or remove them from the plan."

**Layout:** Two side-by-side buttons (flex row, gap). Thesis card rendered above Invest card when both are visible.

## Verification

**Commands:**
- `pnpm type-check` -- expected: zero TypeScript errors
