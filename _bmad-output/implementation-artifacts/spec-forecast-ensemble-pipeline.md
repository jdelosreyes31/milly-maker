---
title: 'Forecast Page — 3-Stage Agent Pipeline (Council / Quant / Simulate)'
type: 'feature'
created: '2026-04-11'
status: 'in-progress'
baseline_commit: '368e136d2ed8c042a2cad066b09e658b548b8913'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Forecast page has a single-path simulation and a basic Strategy Thesis button, but lacks a structured multi-stage AI pipeline that separates macro judgment, quant calibration, and ensemble simulation into discrete, sequenced steps.

**Approach:** Add a COUNCIL → QUANT → SIMULATE pipeline above the existing tabs: COUNCIL streams a MacroThesis JSON + narrative; QUANT receives that thesis and streams QuantParams; SIMULATE runs a 10 000-path ensemble (Mulberry32, Student-t ν=5, Cholesky, 3-state Markov, 5 Bernoulli shocks) and upgrades the overview chart to a ComposedChart fan chart.

## Boundaries & Constraints

**Always:**
- Portfolio always live from props + localStorage plannedHoldings (no stale snapshots)
- Single-path simulate() in useMemo untouched — drives quant metrics tabs unchanged
- buildSimContext() is a module-level singleton helper (called once per render, not per button click)
- COUNCIL enabled whenever there is a portfolio; QUANT enabled only after MacroThesis exists; SIMULATE enabled only after QuantParams are applied
- Ensemble N_PATHS = 10 000; PRNG = Mulberry32; shocks = Student-t(ν=5); 3-state Markov (bull/neutral/bear); 5 Bernoulli shocks; Cholesky correlation from asset-class correlations
- Fan chart shows P10/P25/P50/P75/P90 bands + 3 scenario overlays (bull/base/bear)
- Apply button on QUANT result sets quantOverrides state which feeds into simHoldings annualReturn/annualVol
- Existing "Strategy Thesis" card and "Calibrate with Claude" button remain untouched

**Ask First:** None — all decisions pre-approved.

**Never:**
- Do not modify simulate(), calcMetrics(), or any existing useMemo that drives risk/returns/drawdown tabs
- Do not remove or restructure existing UI sections
- Do not add new npm packages

</frozen-after-approval>

## Code Map

- `apps/web/src/features/investments/InvestmentForecastView.tsx` -- sole file; add ensemble engine, MacroThesis/QuantParams types, COUNCIL/QUANT/SIMULATE handlers, fan chart, pipeline card UI

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/investments/InvestmentForecastView.tsx` -- Add 3-stage pipeline: types, Mulberry32 PRNG, Cholesky helper, ensemble simulator, COUNCIL/QUANT/SIMULATE handlers, pipeline card UI with fan chart upgrade

**Acceptance Criteria:**
- Given portfolio has holdings, when COUNCIL clicked, then MacroThesis streams and is displayed as markdown; QUANT button becomes enabled
- Given MacroThesis exists, when QUANT clicked, then QuantParams stream and an Apply button appears; clicking Apply sets quantOverrides state
- Given QuantParams applied, when SIMULATE clicked, fan chart appears in overview tab showing P10/P25/P50/P75/P90 bands and 3 scenario lines
- Given ensemble running, the existing single-path useMemo simulation and all risk metrics tabs are unaffected

## Spec Change Log

## Design Notes

**Mulberry32 PRNG:** `function mulberry32(seed: number) { ... }` — returns a `() => number` in [0,1). Used for all ensemble paths.

**Student-t sampling:** Box-Muller for normal, then divide by sqrt(chi-squared(ν)/ν) approximated as sqrt(gammaSample(ν/2)*2/ν). Simplification: use ratio of two normals scaled approach or pre-generate chi via sum of ν normal squares — use ν=5 so 5 normal squares.

**3-state Markov:** states = [bull, neutral, bear]; transition matrix hardcoded; regime mu/sigma multipliers per state; regime selected each month by PRNG.

**Cholesky:** 7×7 asset class correlation matrix hardcoded; Cholesky decomposed at module level; applied per path per month to correlated normals.

**Fan chart:** recharts ComposedChart with Area bands (P10-P90, P25-P75) + Lines for P50, bull-path, base-path, bear-path.

## Verification

**Commands:**
- `cd /Users/jeffrey.delosreyes/milly-maker && pnpm --filter @milly-maker/web type-check` -- expected: zero TypeScript errors
