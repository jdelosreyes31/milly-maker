---
title: 'Planning View: Planned Holdings + Cash Account Propagation'
type: 'feature'
created: '2026-04-06'
status: 'done'
context: []
baseline_commit: '103a8b4e3aeddab15fd5dbd62584f0915096c008'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Planning view is locked to holdings already in the DB — there's no way to plan for stocks you *want* to own in the future without polluting Overview with $0 entries. There's also no way to know available cash without manually typing it every time.

**Approach:** (1) Allow adding "planned" holdings (name, ticker, asset class — no value) directly in the Planning view, stored in localStorage, invisible to Overview. (2) Add a `cash_account` investment account type; Planning reads the summed balance of all cash accounts to pre-populate its cash input; contributions logged in Overview flow to it as normal.

## Boundaries & Constraints

**Always:**
- Planned holdings live exclusively in localStorage key `investmentPlanHoldings` as `PlannedHolding[]` — never written to the DB
- Planned holdings always have `current_value = 0`; they appear with the existing "Unstarted" badge plus a delete button (real DB holdings do not get a delete button in Planning)
- Both planned holdings and real DB holdings appear as rows in the allocation table; real holdings are read-only, planned ones are deletable
- `cash_account` is a new entry in the `ACCOUNT_TYPES` constant in `db/queries/investments.ts` — no DB migration required (stored as a string value, backwards-compatible)
- Planning cash input: on mount, if the stored cash value is empty, pre-populate from the sum of all `cash_account` investments' `current_value`. If the user has stored a value, respect it.
- Contributions to cash accounts use the existing contribution log flow in Overview — no new UI needed there
- All existing project rules apply (CSS tokens, `.js` imports, no new Zustand stores, etc.)

**Ask First:**
- If a user has both a stored cash value in localStorage and cash accounts, which should take precedence on subsequent visits — ask before implementing if unclear

**Never:**
- Do not write planned holdings to the DB
- Do not hide cash accounts from Overview (they behave as normal investment accounts in Overview)
- Do not auto-deduct from cash accounts when the user executes a plan — Planning is read-only intent, not execution
- Do not add a new route or Zustand store

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add planned holding | User fills name + optional ticker + asset class in Planning form | Row appears in allocation table as "Unstarted"; persisted to localStorage | Name required — block submit if empty |
| Delete planned holding | User clicks delete on a planned holding row | Row removed from table and from localStorage; its allocation entry also removed | N/A |
| Cash account auto-fill | User has a Cash Account with value $5,000; stored cash is empty | Planning cash input pre-filled with $5,000 on mount | N/A |
| Stored cash overrides | User previously typed $2,000; cash account now shows $6,000 | Stored $2,000 is used — no override | N/A |
| No cash accounts | No investment account with type cash_account | Cash input starts empty (existing behavior) | N/A |
| Mixed rows | Some real holdings, some planned | Table renders both; delete button only on planned rows | N/A |
| Claude prompt | Mix of real + planned holdings | Planned holdings included in table rows; prompt unchanged otherwise | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/db/queries/investments.ts` — add `cash_account` to `ACCOUNT_TYPES`
- `apps/web/src/features/investments/InvestmentsPage.tsx` — compute `cashAccountsTotal` from `investments`; pass to `InvestmentPlanningView`; also pass `investments` if needed for type display
- `apps/web/src/features/investments/InvestmentPlanningView.tsx` — add `cashAccountsTotal` prop; add planned holdings localStorage state; merge into allocation table rows; add inline "add planned holding" form

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/db/queries/investments.ts` -- Add `{ value: "cash_account", label: "Cash Account" }` to `ACCOUNT_TYPES` array -- Enables creating a cash account in Overview via the existing Add Account dialog; no migration needed
- [ ] `apps/web/src/features/investments/InvestmentsPage.tsx` -- Derive `cashAccountsTotal = investments.filter(i => i.account_type === "cash_account").reduce((s, i) => s + i.current_value, 0)` and pass as prop to `InvestmentPlanningView` -- Keeps cash sync logic in the parent where the data lives
- [ ] `apps/web/src/features/investments/InvestmentPlanningView.tsx` -- (a) Add `cashAccountsTotal: number` prop; on mount if stored cash is empty, initialize cash state from `cashAccountsTotal`. (b) Add `PlannedHolding` interface and `investmentPlanHoldings` localStorage key; load/save alongside existing plan state. (c) Add inline "Add planned holding" form (name required, ticker optional, asset class select). (d) Merge planned holdings into allocation table rows: planned rows render "Unstarted" badge + delete button; real rows unchanged. (e) Planned holdings included in Claude prompt rows -- Single file, three concerns: props, planned holdings CRUD, table merge

**Acceptance Criteria:**
- Given no cash accounts in Overview, when I open Planning, then the cash input is empty (existing behavior unchanged)
- Given a Cash Account with balance $3,000 and no stored cash, when I open Planning, then the cash input is pre-filled with $3,000
- Given a stored cash value of $500 in localStorage, when I open Planning regardless of cash account balance, then $500 is shown
- Given I am in Planning, when I fill the "Add planned holding" form with a name and click Add, then a new row appears in the allocation table with the "Unstarted" badge and a delete button, and persists after navigating away and back
- Given a planned holding row, when I click its delete button, then the row is removed from the table and its target % is cleared
- Given a mix of real holdings and planned holdings, when I click "Analyze with Claude", then both appear in the Claude prompt and the analysis reasons about all of them
- Given I log a contribution to a Cash Account in Overview, when I then navigate to Planning, then the cash input reflects the updated balance (if no stored override exists)

## Design Notes

**PlannedHolding shape** (localStorage only):
```typescript
interface PlannedHolding {
  id: string;        // local nanoid()
  name: string;
  ticker: string;    // may be empty string
  asset_class: string;
}
```
Storage key: `investmentPlanHoldings`, value: `PlannedHolding[]`.

**Row merge pattern** — build a unified `PlanRow` type that wraps both sources:
```typescript
type PlanRow = (InvestmentHolding & { isPlanned: false }) | (PlannedHolding & { current_value: 0; isPlanned: true });
```
Derive `currentPct`, `targetPct`, `rawBuy`, `buy` identically for both. Delete button rendered only when `row.isPlanned === true`.

**Cash pre-population** — lazy useState initializer already reads localStorage once. Change to:
```
useState(() => loadStoredPlan().cash || (cashAccountsTotal > 0 ? String(cashAccountsTotal) : ""))
```
This way the prop's value is captured at mount and used only as fallback.

**Add planned holding form** — small inline card below the inputs section. Collapses after submit. Does not open a Dialog — keep it lightweight.

## Verification

**Commands:**
- `pnpm type-check` -- expected: zero TypeScript errors
