---
title: 'Planned Holding Ticker Price Fetch & Deploy Enforcement'
type: 'feature'
created: '2026-04-10'
status: 'done'
baseline_commit: '5adcad2bac547f6c493e36126b9810c182796c27'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deploy calibration allocates dollar amounts to planned holdings without knowing the share price — a $50 suggestion on a $200 stock is meaningless and Claude has no way to catch it.

**Approach:** Proxy Yahoo Finance through Vite to fetch last-known prices for planned tickers when the deploy panel opens. Show the price cosmetically in the deploy table. Pass it into the Claude prompt as a hard constraint, and enforce it post-parse by zeroing sub-share allocations and redistributing the freed share proportionally.

## Boundaries & Constraints

**Always:** Fetch only for planned holdings (`r.isPlanned === true`) with a non-empty `ticker`. Actual holdings already have implicit price via `current_value / shares`. Fetching is best-effort — a failed fetch shows `—` and skips enforcement silently. Vite proxy target is `https://query1.finance.yahoo.com`; path prefix `/yf-api`. State lives in `InvestmentPlanningView` as `tickerPrices: Record<string, number>`. Redistribution of freed share must keep the sum at 1.0.

**Ask First:** Whether to also show price for actual holdings (derived from `current_value / shares`). Not in scope unless requested.

**Never:** No new DB tables. No API key required. No external package additions. Do not break the existing deploy flow when fetch fails.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Planned ticker with valid symbol, cash > share price | Price shown, enforcement passes, calibration unchanged | N/A |
| Sub-share allocation | Claude suggests $40 on a $180 stock | suggestedShare zeroed, share redistributed proportionally to valid positions | Silently enforced, rationale preserved |
| All allocations sub-share | Every position gets zeroed | Redistribution falls back to equal split across non-zero math allocations | Fallback prevents all-zero state |
| Fetch fails (network/CORS/bad ticker) | Yahoo returns 4xx or parse error | `tickerPrices[ticker]` absent, no cosmetic price shown, enforcement skipped for that row | Caught silently, no error surfaced to user |
| No planned holdings in result | All rows are actual holdings | Fetch never fires, no price state, prompt unchanged | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/vite.config.ts` — add `server.proxy` for `/yf-api` → `https://query1.finance.yahoo.com`
- `apps/web/src/features/investments/InvestmentPlanningView.tsx:265` — component state; add `tickerPrices`
- `apps/web/src/features/investments/InvestmentPlanningView.tsx:657` — `handleDeployCalibrate`: augment `holdingsList`, add prompt rule, enforce post-parse
- `apps/web/src/features/investments/InvestmentPlanningView.tsx:1617` — deploy results table row: show `@ $price` under ticker for planned rows

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/vite.config.ts` — ADD `server: { proxy: { "/yf-api": { target: "https://query1.finance.yahoo.com", changeOrigin: true, rewrite: (path) => path.replace(/^\/yf-api/, "") } } }` inside `defineConfig`
- [x] `apps/web/src/features/investments/InvestmentPlanningView.tsx` — ADD `tickerPrices` state (`Record<string, number>`); ADD `useEffect` that fires when `deployResult` changes, collects unique tickers from planned rows, fetches `/yf-api/v7/finance/quote?symbols=...`, parses `quoteResponse.result[].regularMarketPrice` into state; wrap in try/catch (silent on failure)
- [x] `apps/web/src/features/investments/InvestmentPlanningView.tsx` — MODIFY `holdingsList` build in `handleDeployCalibrate` to append `| Share price: $X.XX` for planned rows where `tickerPrices[r.ticker]` exists; ADD rule to `userMsg`: "If a holding has a Share price listed, do not suggest an allocation where the dollar amount is less than that share price — a sub-share deployment is not actionable"
- [x] `apps/web/src/features/investments/InvestmentPlanningView.tsx` — ADD post-parse enforcement: after building `newCalibration`, zero out any entry where `cash * suggestedShare < tickerPrices[ticker]`; redistribute freed share proportionally across remaining non-zero entries; if all zeroed, fall back to equal split across entries with `allocation > 0`
- [x] `apps/web/src/features/investments/InvestmentPlanningView.tsx` — MODIFY deploy table row (line ~1626) to show `@ $214.32` in muted text under the ticker when `tickerPrices[r.ticker]` exists

**Acceptance Criteria:**
- Given a planned holding with ticker NVDA ($880 share price) and $200 deploy cash, when Claude calibrate runs, then NVDA's suggestedShare is zeroed and the freed share redistributes to other positions.
- Given fetch succeeds, when the deploy table renders, then a muted price tag appears under the planned ticker symbol.
- Given Yahoo Finance is unreachable, when the deploy panel opens, then no error is shown and the calibration flow continues normally without price enforcement.
- Given all tickers are actual holdings (no planned), when deployResult changes, then no fetch fires.

## Verification

**Commands:**
- `cd apps/web && npx tsc --noEmit` -- expected: no type errors

**Manual checks:**
- Add a planned holding with a valid ticker, open deploy panel, confirm price appears under ticker.
- Set deploy amount below share price, run Calibrate with Claude, confirm that planned holding receives `—` in Claude $ column.
