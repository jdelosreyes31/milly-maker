---
title: 'Open Futures Stake Deducted from Balance (Post-Account-Start Only)'
type: 'feature'
created: '2026-04-05'
status: 'done'
baseline_commit: '143923f7818bfaa7a0b67d021bb34c34f19dea4d'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Placing an open future does not affect the account balance, so the displayed balance is overstated — the staked money is still shown as available even though it has been wagered.

**Approach:** Subtract the stakes of open futures from the account's `current_balance`, but only when the future's `placed_date` is strictly after the account's `starting_date`. Futures placed on or before the start date represent pre-existing positions captured in `starting_balance` and must not be double-counted.

## Boundaries & Constraints

**Always:**
- Only open futures (`status = 'open'`) reduce the balance.
- Only futures with `placed_date > account.starting_date` are deducted.
- When a post-start future (`placed_date > starting_date`) is won, the settlement deposit must be `potential_payout - stake` (profit only), because the stake is already "returned" by the deduction disappearing. Pre-start futures (not deducted) continue to deposit the full `potential_payout`.
- The deduction must be per-account, consistent with how all other balance components are scoped.

**Ask First:**
- If the decision arises to show `open_futures_stake` as a separate line in any balance breakdown UI, confirm with the user first.

**Never:**
- Do not add UI validation to the future dialog (the date check is purely a balance calculation concern).
- Do not affect fantasy_league accounts (already excluded from combined balance).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Future placed after account start | `placed_date > starting_date`, status = `open`, stake = $50 | `current_balance` decreases by $50 | N/A |
| Future placed on account start date | `placed_date == starting_date`, stake = $50 | No deduction — balance unchanged | N/A |
| Future placed before account start | `placed_date < starting_date`, stake = $50 | No deduction — balance unchanged | N/A |
| Future settled (won/lost/void) | `status != 'open'` | Not included in stake deduction | N/A |
| No open futures | No futures with `status = 'open'` and `placed_date > starting_date` | `open_futures_stake = 0`, no balance change | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/db/queries/fantasy.ts` -- `FantasyBalanceSummary` type + `getFantasyBalanceSummary` SQL query + `current_balance` formula
- `apps/web/src/features/fantasy/FantasyPage.tsx` -- `handleSettleFuture` — settlement deposit amount for won post-start futures

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/db/queries/fantasy.ts` -- Add `open_futures_stake: number` to `FantasyBalanceSummary` type; add LEFT JOIN in `getFantasyBalanceSummary` to sum open future stakes where `placed_date > a.starting_date`; include `open_futures_stake` in SELECT; subtract it in the `current_balance` TypeScript formula -- open futures reduce available balance but only for post-account-start bets
- [x] `apps/web/src/features/fantasy/FantasyPage.tsx` -- In `handleSettleFuture`, when `status === 'won'` and `potential_payout != null`, check if the future's `placed_date > account.starting_date` (look up account from `balanceSummary`); if yes, deposit `potential_payout - stake`; if no (pre-start future), deposit `potential_payout` as before -- prevents double-counting stake when deduction disappears on settlement

**Acceptance Criteria:**
- Given an account with `starting_date = 2025-01-01` and an open future with `placed_date = 2025-06-01` and `stake = 100`, when balance summary is fetched, then `current_balance` is 100 less than it would be without the future.
- Given the same account with an open future with `placed_date = 2024-12-31` (before start), when balance summary is fetched, then `current_balance` is unchanged.
- Given the same account with an open future with `placed_date = 2025-01-01` (equal to start), when balance summary is fetched, then `current_balance` is unchanged.
- Given an open future that is then settled (won/lost/void), when balance summary is fetched, then `open_futures_stake` does not include that future's stake.
- Given a post-start future with `stake = 100` and `potential_payout = 300` settled as won, when the deposit is created, then it is for $200 (profit only, not $300).
- Given a pre-start future with `stake = 100` and `potential_payout = 300` settled as won, when the deposit is created, then it is for $300 (full payout, unchanged behavior).

## Design Notes

The deduction is computed in SQL via a new LEFT JOIN on `fantasy_futures` filtered by `status = 'open' AND f.placed_date > a.starting_date`. This keeps all balance arithmetic server-side (DuckDB) and consistent with existing components. The `current_balance` is computed client-side in TypeScript and simply needs `- r.open_futures_stake` added.

## Suggested Review Order

**Balance calculation (core change)**

- SQL subquery: sums open future stakes placed strictly after account start date
  [`fantasy.ts:182`](../../apps/web/src/db/queries/fantasy.ts#L182)

- `current_balance` formula: subtracts `open_futures_stake` from existing components
  [`fantasy.ts:200`](../../apps/web/src/db/queries/fantasy.ts#L200)

- Type addition: `open_futures_stake` field on `FantasyBalanceSummary`
  [`fantasy.ts:77`](../../apps/web/src/db/queries/fantasy.ts#L77)

**Settlement correction (double-count fix)**

- Won-future deposit: post-start futures deposit profit only; pre-start deposit full payout
  [`FantasyPage.tsx:1085`](../../apps/web/src/features/fantasy/FantasyPage.tsx#L1085)

## Verification

**Manual checks (if no CLI):**
- In the Fantasy page, add an open future dated after the account's start date; confirm the account balance decreases by the stake amount.
- Add an open future dated before or on the account's start date; confirm the balance does not change.
- Settle an open future; confirm its stake is no longer deducted (settled logic takes over).
