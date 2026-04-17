import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Anthropic from "@anthropic-ai/sdk";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, LineChart, Line, ReferenceLine, PieChart, Pie,
  ComposedChart,
} from "recharts";
import { Bot, Sparkles, Zap, BarChart2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent, CardHeader, CardTitle, Input, formatCurrency } from "@milly-maker/ui";
import type { Investment, InvestmentHolding } from "@/db/queries/investments.js";
import { ASSET_CLASSES } from "@/db/queries/investments.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const RF_ANNUAL = 0.04;
const RF_MONTHLY = RF_ANNUAL / 12;
const BENCHMARK_ANNUAL = 0.095;
const BENCHMARK_VOL = 0.17;
const BENCHMARK_MONTHLY_R = BENCHMARK_ANNUAL / 12;
const BENCHMARK_MONTHLY_VOL = BENCHMARK_VOL / Math.sqrt(12);

const ASSET_VOL: Record<string, number> = {
  stocks: 0.17, bonds: 0.06, cash: 0.005,
  real_estate: 0.15, crypto: 0.70, commodities: 0.30, other: 0.20,
};
const ASSET_DEFAULT_RETURN: Record<string, number> = {
  stocks: 0.08, bonds: 0.04, cash: 0.035,
  real_estate: 0.07, crypto: 0.15, commodities: 0.07, other: 0.07,
};
const ASSET_CLASS_COLORS: Record<string, string> = {
  stocks: "#5b5bd6", bonds: "#12b76a", cash: "#0ea5e9",
  real_estate: "#f79009", crypto: "#f43f5e", commodities: "#7c3aed", other: "#94a3b8",
};

const MILESTONE_LEVELS = [
  25_000, 50_000, 75_000, 100_000, 150_000, 200_000, 250_000, 500_000,
  750_000, 1_000_000, 1_500_000, 2_000_000, 5_000_000,
];

const CLAUDE_MODELS = [
  { value: "claude-sonnet-4-5", label: "Sonnet" },
  { value: "claude-opus-4-6",   label: "Opus" },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SimHolding {
  id: string; name: string; ticker: string | null; asset_class: string;
  startVal: number; targetPct: number; annualReturn: number; annualVol: number;
}
interface DataPoint {
  month: number; label: string; total: number; contributions: number; gains: number;
}
interface Metrics {
  annualizedReturn: number; annualVol: number; sharpe: number; sortino: number;
  maxDD: number; calmar: number; beta: number; alpha: number; treynor: number;
  infoRatio: number; trackingError: number; var95: number; cvar95: number;
  skewness: number; kurtosis: number; winRate: number; bestMonth: number;
  worstMonth: number; gainLossRatio: number; ulcer: number; upi: number;
  rollingSharpe: { month: number; label: string; sharpe: number }[];
  rollingSortino: { month: number; label: string; sortino: number }[];
  distData: { return_pct: number; count: number }[];
  ddSeries: number[];
}
interface ClaudeEstimate {
  annualReturn: number; // decimal e.g. 0.095
  annualVol: number;    // decimal e.g. 0.17
  rationale: string;
}

// ── Pipeline types ────────────────────────────────────────────────────────────

interface MacroThesis {
  regimeAssessment: string;
  shockOverrides: Record<string, number>;
  regimeMuOverrides: Record<string, number>;
  rationale: string;
}

interface QuantParams {
  shockOverrides: Record<string, number>;
  regimeMuOverrides: Record<string, number>;
  regimeSigmaOverrides: Record<string, number>;
  rationale: string;
}

interface EnsembleResult {
  // Fan chart data per month: { month, label, p10, p25, p50, p75, p90, bull, base, bear }
  fanData: FanPoint[];
  terminalP10: number; terminalP25: number; terminalP50: number;
  terminalP75: number; terminalP90: number;
  milestobeProbs: { label: string; value: number; prob: number }[];
  // Terminal distribution stats (same output set as fantasy simulator)
  terminalP2_5: number; terminalP97_5: number; terminalP99: number;
  terminalMean: number; terminalStd: number;
  terminalProbLoss: number;  // fraction of paths ending below start value
  terminalCVaR5: number;     // avg of worst 5% terminal values
  terminalSharpe: number;    // (mean - start) / std
  terminalSortino: number;   // (mean - start) / downside-std
  terminalHistogram: { binStart: number; binEnd: number; count: number }[];
  terminalStartVal: number;  // start value for histogram coloring
}

interface FanPoint {
  month: number; label: string;
  p10: number; p25: number; p50: number; p75: number; p90: number;
  bull: number; base: number; bear: number;
}

// ── Ensemble constants ────────────────────────────────────────────────────────

const N_PATHS = 10_000;

// Asset class order for correlation matrix: stocks, bonds, cash, real_estate, crypto, commodities, other
const AC_ORDER = ["stocks","bonds","cash","real_estate","crypto","commodities","other"] as const;
// Correlation matrix (lower triangle = upper triangle)
const CORR_MATRIX: number[][] = [
  [1.00, -0.20,  0.00,  0.40,  0.30,  0.20,  0.20],
  [-0.20, 1.00,  0.10, -0.10, -0.15,  0.00, -0.05],
  [0.00,  0.10,  1.00,  0.05,  0.00,  0.00,  0.00],
  [0.40, -0.10,  0.05,  1.00,  0.10,  0.30,  0.20],
  [0.30, -0.15,  0.00,  0.10,  1.00,  0.15,  0.20],
  [0.20,  0.00,  0.00,  0.30,  0.15,  1.00,  0.10],
  [0.20, -0.05,  0.00,  0.20,  0.20,  0.10,  1.00],
];

// Markov regime transition matrix [bull, neutral, bear]
// P(next | current) — rows = current, cols = next
const REGIME_TRANS = [
  [0.80, 0.15, 0.05], // bull
  [0.20, 0.60, 0.20], // neutral
  [0.05, 0.35, 0.60], // bear
];
// Regime mu multipliers [bull, neutral, bear]
const REGIME_MU = [1.4, 1.0, 0.2];
// Regime sigma multipliers [bull, neutral, bear]
const REGIME_SIGMA = [0.8, 1.0, 1.8];

// Bernoulli shock params (5 shocks): [prob, mu_hit, sigma_hit]
const SHOCKS: [number, number, number][] = [
  [0.005, -0.12, 0.08], // severe crash
  [0.010, -0.06, 0.04], // moderate crash
  [0.020, -0.03, 0.02], // mild correction
  [0.010,  0.05, 0.03], // positive surprise
  [0.005,  0.10, 0.04], // euphoria spike
];

// ── Cholesky decomposition (7×7) ──────────────────────────────────────────────

function choleskyDecomp(A: number[][]): number[][] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += (L[i]![k] ?? 0) * (L[j]![k] ?? 0);
      if (i === j) L[i]![j] = Math.sqrt(Math.max((A[i]![i] ?? 1) - sum, 1e-12));
      else L[i]![j] = ((A[i]![j] ?? 0) - sum) / (L[j]![j] ?? 1);
    }
  }
  return L;
}
const CHOLESKY_L = choleskyDecomp(CORR_MATRIX);

// ── Mulberry32 PRNG ───────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Student-t(ν=5) via ratio: normal / sqrt(chi2(5)/5)
// chi2(5) = sum of 5 standard normals squared
function studentT5(rand: () => number): number {
  // Box-Muller for normals
  function norm(): number {
    const u1 = Math.max(rand(), 1e-10), u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  const z = norm();
  let chi2 = 0;
  for (let i = 0; i < 5; i++) { const n = norm(); chi2 += n * n; }
  return z / Math.sqrt(chi2 / 5);
}

// ── Sim context builder ───────────────────────────────────────────────────────

interface SimContext {
  holdings: SimHolding[];
  monthly: number;
  months: number;
  strategy: ContribStrategy;
  effectiveTotal: number;
}

function buildSimContext(
  holdings: SimHolding[],
  monthly: number,
  months: number,
  strategy: ContribStrategy,
  effectiveTotal: number,
): SimContext {
  return { holdings, monthly, months, strategy, effectiveTotal };
}

// ── Ensemble simulator ────────────────────────────────────────────────────────

function runEnsemble(
  ctx: SimContext,
  quantParams: QuantParams | null,
  milestoneLevels: number[],
  baselineSeed = 1234,
): EnsembleResult {
  const { holdings, monthly, months } = ctx;
  if (holdings.length === 0 || months === 0) {
    return {
      fanData: [],
      terminalP10: 0, terminalP25: 0, terminalP50: 0, terminalP75: 0, terminalP90: 0,
      milestobeProbs: [],
      terminalP2_5: 0, terminalP97_5: 0, terminalP99: 0,
      terminalMean: 0, terminalStd: 0,
      terminalProbLoss: 0, terminalCVaR5: 0,
      terminalSharpe: 0, terminalSortino: 0,
      terminalHistogram: [], terminalStartVal: 0,
    };
  }

  const n = holdings.length;
  // Map holding asset_class to index in AC_ORDER
  const acIdx = holdings.map(h => {
    const i = (AC_ORDER as readonly string[]).indexOf(h.asset_class);
    return i >= 0 ? i : 6; // default to "other"
  });

  // Per-holding return/vol adjusted by quantParams
  const baseReturns = holdings.map(h => {
    const mu = quantParams?.regimeMuOverrides[h.asset_class] ?? 0;
    return h.annualReturn + mu;
  });
  const baseVols = holdings.map(h => {
    const sigAdj = quantParams?.regimeSigmaOverrides[h.asset_class] ?? 0;
    return Math.max(h.annualVol + sigAdj, 0.001);
  });

  // Shock overrides
  const shockParams = [...SHOCKS];
  if (quantParams?.shockOverrides) {
    const so = quantParams.shockOverrides;
    if (typeof so["crash_prob"] === "number") shockParams[0] = [so["crash_prob"]!, shockParams[0]![1], shockParams[0]![2]];
    if (typeof so["correction_prob"] === "number") shockParams[2] = [so["correction_prob"]!, shockParams[2]![1], shockParams[2]![2]];
  }

  // Store terminal values for each path
  const terminals: number[] = new Array(N_PATHS).fill(0);
  // Store monthly values for fan chart (sample every month, store by path)
  // To avoid N_PATHS * months memory, store running percentile buckets per month
  // Strategy: collect all path values at each month, then compute percentiles
  // Memory: N_PATHS * months floats — for 10k paths × 120 months = 1.2M floats, ~9.6MB, acceptable
  const monthlyMatrix: Float64Array[] = Array.from({ length: months + 1 }, () => new Float64Array(N_PATHS));

  // 3 scenario paths (seeds chosen for bull/base/bear feel)
  const SCENARIO_SEEDS = [9001, 4242, 7777];
  const scenarioTotals: number[][] = [[], [], []];

  // Run N_PATHS
  for (let p = 0; p < N_PATHS; p++) {
    const rand = mulberry32(baselineSeed + p * 31337);
    const vals = holdings.map(h => h.startVal);
    let regime = 1; // start neutral
    const startTotal = vals.reduce((s, v) => s + v, 0);
    (monthlyMatrix[0] as Float64Array)[p] = startTotal;

    for (let m = 1; m <= months; m++) {
      // Markov regime transition
      const tr = REGIME_TRANS[regime]!;
      const rv = rand();
      if (rv < tr[0]!) regime = 0;
      else if (rv < tr[0]! + tr[1]!) regime = 1;
      else regime = 2;

      const muMult = REGIME_MU[regime] ?? 1;
      const sigMult = REGIME_SIGMA[regime] ?? 1;

      // Correlated Student-t shocks via Cholesky
      // Generate 7 independent Student-t(5) samples
      const iid: number[] = Array.from({ length: 7 }, () => studentT5(rand));
      // Apply Cholesky: correlated[i] = sum_j L[i][j] * iid[j]
      const correlated: number[] = Array.from({ length: 7 }, (_, i) => {
        let s = 0;
        for (let j = 0; j <= i; j++) s += (CHOLESKY_L[i]![j] ?? 0) * (iid[j] ?? 0);
        return s;
      });

      // Bernoulli shocks
      let shockMu = 0, shockSig = 0;
      for (const [sp, sm, ss] of shockParams) {
        if (rand() < sp) { shockMu += sm; shockSig += ss; }
      }

      for (let i = 0; i < n; i++) {
        const sig = baseVols[i]! / Math.sqrt(12) * sigMult;
        // Treat baseReturns as CAGR (geometric/compound return target).
        // The arithmetic model (1 + mu + sig*z) with t(5) shocks (Var=5/3) has vol drag of 5/6*sig² per month.
        // Add that back so the median single path compounds at the stated CAGR.
        const mu = baseReturns[i]! / 12 * muMult + (5 / 6) * sig * sig;
        const acI = acIdx[i] ?? 6;
        const z = correlated[acI] ?? iid[acI] ?? 0;
        vals[i] = (vals[i] ?? 0) * (1 + mu + sig * z + shockMu);
        if (shockSig > 0) vals[i] = (vals[i] ?? 0) * (1 + (rand() - 0.5) * 2 * shockSig);
      }
      if (monthly > 0) allocateContribution(holdings, vals, monthly, ctx.strategy, m);

      const total = vals.reduce((s, v) => s + v, 0);
      (monthlyMatrix[m] as Float64Array)[p] = total;
    }
    terminals[p] = (monthlyMatrix[months] as Float64Array)[p]!;
  }

  // Run 3 scenario paths
  for (let s = 0; s < 3; s++) {
    const rand = mulberry32(SCENARIO_SEEDS[s]!);
    const vals = holdings.map(h => h.startVal);
    let regime = s === 0 ? 0 : s === 1 ? 1 : 2; // bull/base/bear start
    scenarioTotals[s]!.push(vals.reduce((a, v) => a + v, 0));
    for (let m = 1; m <= months; m++) {
      const tr = REGIME_TRANS[regime]!;
      const rv = rand();
      if (rv < tr[0]!) regime = 0;
      else if (rv < tr[0]! + tr[1]!) regime = 1;
      else regime = 2;
      const muMult = REGIME_MU[regime] ?? 1;
      const sigMult = REGIME_SIGMA[regime] ?? 1;
      for (let i = 0; i < n; i++) {
        const sig = baseVols[i]! / Math.sqrt(12) * sigMult;
        // Scenario paths use normal z (Var=1), so vol drag is 1/2*sig² per month.
        const mu = baseReturns[i]! / 12 * muMult + 0.5 * sig * sig;
        const u1 = Math.max(rand(), 1e-10), u2 = rand();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        vals[i] = (vals[i] ?? 0) * (1 + mu + sig * z);
      }
      if (monthly > 0) allocateContribution(holdings, vals, monthly, ctx.strategy, m);
      scenarioTotals[s]!.push(vals.reduce((a, v) => a + v, 0));
    }
  }

  // Compute fan data
  const fanData: FanPoint[] = [];
  const pcts = [0.10, 0.25, 0.50, 0.75, 0.90];
  function percentile(arr: Float64Array, p: number): number {
    const sorted = Float64Array.from(arr).sort();
    const idx = Math.floor(p * (sorted.length - 1));
    return sorted[idx] ?? 0;
  }

  for (let m = 0; m <= months; m++) {
    const col = monthlyMatrix[m]!;
    const [p10, p25, p50, p75, p90] = pcts.map(p => percentile(col, p)) as [number,number,number,number,number];
    fanData.push({
      month: m,
      label: m === 0 ? "Start" : m % 12 === 0 ? `Yr ${m / 12}` : "",
      p10, p25, p50, p75, p90,
      bull: scenarioTotals[0]![m] ?? 0,
      base: scenarioTotals[1]![m] ?? 0,
      bear: scenarioTotals[2]![m] ?? 0,
    });
  }

  // Terminal percentiles
  const termCol = Float64Array.from(terminals).sort();
  const [terminalP10, terminalP25, terminalP50, terminalP75, terminalP90] = pcts.map(p => percentile(termCol, p)) as [number,number,number,number,number];
  const terminalP2_5  = percentile(termCol, 0.025);
  const terminalP97_5 = percentile(termCol, 0.975);
  const terminalP99   = percentile(termCol, 0.99);

  // Milestone probabilities
  const startTotal = holdings.reduce((s, h) => s + h.startVal, 0);
  const milestobeProbs = milestoneLevels
    .filter(v => v > startTotal)
    .slice(0, 6)
    .map(v => {
      const label = v >= 1_000_000 ? `$${v / 1_000_000}M` : `$${v / 1_000}K`;
      const hits = terminals.filter(t => t >= v).length;
      return { label, value: v, prob: hits / N_PATHS };
    });

  // ── Terminal distribution stats (matching fantasy tab output) ────────────
  const terminalMean = terminals.reduce((s, v) => s + v, 0) / N_PATHS;
  const terminalVariance = terminals.reduce((s, v) => s + (v - terminalMean) ** 2, 0) / N_PATHS;
  const terminalStd = Math.sqrt(terminalVariance);

  const lossCount = terminals.filter(t => t < startTotal).length;
  const terminalProbLoss = lossCount / N_PATHS;

  const worstCount = Math.max(1, Math.floor(0.05 * N_PATHS));
  const terminalCVaR5 = termCol.slice(0, worstCount).reduce((s, v) => s + v, 0) / worstCount;

  const terminalSharpe = terminalStd > 0 ? (terminalMean - startTotal) / terminalStd : 0;
  const downVar = terminals.filter(t => t < startTotal).reduce((s, t) => s + (t - startTotal) ** 2, 0) / N_PATHS;
  const terminalSortino = downVar > 0 ? (terminalMean - startTotal) / Math.sqrt(downVar) : 0;

  // 30-bin histogram of terminal values
  const minT = termCol[0] ?? 0;
  const maxT = termCol[N_PATHS - 1] ?? 0;
  const binWidth = maxT > minT ? (maxT - minT) / 30 : 1;
  const terminalHistogram: { binStart: number; binEnd: number; count: number }[] = Array.from({ length: 30 }, (_, i) => ({
    binStart: minT + i * binWidth,
    binEnd:   minT + (i + 1) * binWidth,
    count: 0,
  }));
  for (const t of terminals) {
    const bin = Math.min(Math.floor((t - minT) / binWidth), 29);
    terminalHistogram[bin]!.count++;
  }

  return {
    fanData, terminalP10, terminalP25, terminalP50, terminalP75, terminalP90, milestobeProbs,
    terminalP2_5, terminalP97_5, terminalP99,
    terminalMean, terminalStd, terminalProbLoss, terminalCVaR5,
    terminalSharpe, terminalSortino,
    terminalHistogram, terminalStartVal: startTotal,
  };
}

// ── Seeded RNG ────────────────────────────────────────────────────────────────

function makeNormalRng(seed: number) {
  let s = seed;
  function rand() { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; }
  return function () {
    const u1 = rand(), u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

// ── Simulation ────────────────────────────────────────────────────────────────

type ContribStrategy = "balance" | "rebalance" | "growth";

function allocateContribution(
  simHoldings: SimHolding[], values: number[], monthly: number,
  strategy: ContribStrategy, month: number,
) {
  const total = values.reduce((s, v) => s + v, 0);
  const n = simHoldings.length;

  if (strategy === "balance") {
    // Split by target weight every month — always feeding each position at its intended %
    for (let i = 0; i < n; i++) values[i] = (values[i] ?? 0) + monthly * (simHoldings[i]!.targetPct);

  } else if (strategy === "rebalance") {
    // Gap-weighted: underweight positions receive proportionally more
    const gaps = simHoldings.map((h, i) => Math.max(h.targetPct - (values[i] ?? 0) / total, 0.001));
    const gapSum = gaps.reduce((s, g) => s + g, 0);
    for (let i = 0; i < n; i++) values[i] = (values[i] ?? 0) + monthly * ((gaps[i] ?? 0) / gapSum);

  } else {
    // Growth: prioritize by expected return, but protect significantly underweight positions,
    // with quarterly forced convergence for any position >10% below target
    const isConvergenceMonth = month % 3 === 0;
    const currentPcts = values.map(v => v / total);

    // Identify starved positions (>10% below target) — they always get a floor
    const FLOOR_THRESHOLD = 0.10; // 10% below target triggers floor
    const FLOOR_SHARE = 0.20;     // reserve 20% of contribution for floors
    const starved = simHoldings.map((h, i) => (currentPcts[i] ?? 0) < h.targetPct - FLOOR_THRESHOLD);
    const anyStarved = starved.some(Boolean);

    if (isConvergenceMonth) {
      // Quarterly: gap-fill to pull drifted positions back toward target
      const gaps = simHoldings.map((h, i) => Math.max(h.targetPct - (currentPcts[i] ?? 0), 0.001));
      const gapSum = gaps.reduce((s, g) => s + g, 0);
      for (let i = 0; i < n; i++) values[i] = (values[i] ?? 0) + monthly * ((gaps[i] ?? 0) / gapSum);
    } else {
      // Normal growth months: weight by return, floor starved positions
      const growthBudget = anyStarved ? monthly * (1 - FLOOR_SHARE) : monthly;
      const floorBudget  = anyStarved ? monthly * FLOOR_SHARE : 0;

      // Growth allocation: return-weighted, skip positions already over target + 5%
      const scores = simHoldings.map((h, i) => {
        const pct = currentPcts[i] ?? 0;
        return pct < h.targetPct + 0.05 ? Math.max(h.annualReturn, 0.001) : 0;
      });
      const scoreSum = scores.reduce((s, v) => s + v, 0);
      if (scoreSum > 0) {
        for (let i = 0; i < n; i++) values[i] = (values[i] ?? 0) + growthBudget * ((scores[i] ?? 0) / scoreSum);
      } else {
        // All over drift ceiling — fall back to gap fill for growth budget
        const gaps = simHoldings.map((h, i) => Math.max(h.targetPct - (currentPcts[i] ?? 0), 0.001));
        const gs = gaps.reduce((s, g) => s + g, 0);
        for (let i = 0; i < n; i++) values[i] = (values[i] ?? 0) + growthBudget * ((gaps[i] ?? 0) / gs);
      }

      // Floor budget split evenly among starved positions
      if (anyStarved && floorBudget > 0) {
        const starvedCount = starved.filter(Boolean).length;
        for (let i = 0; i < n; i++) {
          if (starved[i]) values[i] = (values[i] ?? 0) + floorBudget / starvedCount;
        }
      }
    }
  }
}

function simulate(simHoldings: SimHolding[], monthly: number, months: number, strategy: ContribStrategy = "balance") {
  const pRng = makeNormalRng(42), bRng = makeNormalRng(99);
  const values = simHoldings.map(h => h.startVal);
  let totalContributions = 0;
  const monthlyReturns: number[] = [], benchReturns: number[] = [];
  const startTotal = values.reduce((s, v) => s + v, 0);
  const data: DataPoint[] = [{ month: 0, label: "Start", total: startTotal, contributions: 0, gains: 0 }];

  for (let m = 1; m <= months; m++) {
    const prevTotal = values.reduce((s, v) => s + v, 0);
    for (let i = 0; i < simHoldings.length; i++) {
      const h = simHoldings[i]!;
      values[i] = (values[i] ?? 0) * (1 + h.annualReturn / 12 + pRng() * (h.annualVol / Math.sqrt(12)) * 0.5);
    }
    if (monthly > 0) allocateContribution(simHoldings, values, monthly, strategy, m);
    totalContributions += monthly;
    const total = values.reduce((s, v) => s + v, 0);
    monthlyReturns.push((total - monthly - prevTotal) / prevTotal);
    benchReturns.push(BENCHMARK_MONTHLY_R + bRng() * BENCHMARK_MONTHLY_VOL * 0.5);
    data.push({ month: m, label: m % 12 === 0 ? `Yr ${m / 12}` : "", total, contributions: totalContributions, gains: total - startTotal - totalContributions });
  }

  const endValuesByAssetClass: Record<string, number> = {};
  for (let i = 0; i < simHoldings.length; i++) {
    const cls = simHoldings[i]!.asset_class;
    endValuesByAssetClass[cls] = (endValuesByAssetClass[cls] ?? 0) + (values[i] ?? 0);
  }
  return { data, monthlyReturns, benchReturns, startTotal, endValuesByAssetClass };
}

// ── Quant Metrics ─────────────────────────────────────────────────────────────

function calcMetrics(monthlyReturns: number[], benchReturns: number[]): Metrics {
  const n = monthlyReturns.length;
  const mean = monthlyReturns.reduce((s, r) => s + r, 0) / n;
  const annualizedReturn = mean * 12;
  const variance = monthlyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  const annualVol = stdDev * Math.sqrt(12);
  const sharpe = annualVol > 0 ? (annualizedReturn - RF_ANNUAL) / annualVol : 0;

  const downsideReturns = monthlyReturns.filter(r => r < RF_MONTHLY);
  const downsideVar = downsideReturns.length > 0
    ? downsideReturns.reduce((s, r) => s + (r - RF_MONTHLY) ** 2, 0) / downsideReturns.length : 0.0001;
  const downsideDev = Math.sqrt(downsideVar) * Math.sqrt(12);
  const sortino = downsideDev > 0 ? (annualizedReturn - RF_ANNUAL) / downsideDev : 0;

  let pk = 1, maxDD = 0, cum = 1;
  const ddSeries: number[] = [];
  for (const r of monthlyReturns) {
    cum *= (1 + r); pk = Math.max(pk, cum);
    const dd = (cum - pk) / pk;
    maxDD = Math.min(maxDD, dd); ddSeries.push(dd);
  }
  const calmar = maxDD !== 0 ? annualizedReturn / Math.abs(maxDD) : 0;

  const benchMean = benchReturns.reduce((s, r) => s + r, 0) / n;
  let cov = 0, benchVarCalc = 0;
  for (let i = 0; i < n; i++) {
    const mr = monthlyReturns[i] ?? 0, br = benchReturns[i] ?? 0;
    cov += (mr - mean) * (br - benchMean);
    benchVarCalc += (br - benchMean) ** 2;
  }
  cov /= (n - 1); benchVarCalc /= (n - 1);
  const beta = benchVarCalc > 0 ? cov / benchVarCalc : 1;
  const alpha = (annualizedReturn - (RF_ANNUAL + beta * (BENCHMARK_ANNUAL - RF_ANNUAL))) * 100;
  const treynor = Math.abs(beta) > 0.01 ? (annualizedReturn - RF_ANNUAL) / beta : 0;

  const excessReturns = monthlyReturns.map((r, i) => r - (benchReturns[i] ?? 0));
  const excessMean = excessReturns.reduce((s, r) => s + r, 0) / n;
  const trackingVar = excessReturns.reduce((s, r) => s + (r - excessMean) ** 2, 0) / (n - 1);
  const trackingError = Math.sqrt(trackingVar) * Math.sqrt(12);
  const infoRatio = trackingError > 0 ? (excessMean * 12) / trackingError : 0;

  const sorted = [...monthlyReturns].sort((a, b) => a - b);
  const varIdx = Math.floor(n * 0.05);
  const var95 = sorted[varIdx] ?? 0;
  const cvar95 = sorted.slice(0, varIdx + 1).reduce((s, r) => s + r, 0) / Math.max(varIdx + 1, 1);

  const skewness = monthlyReturns.reduce((s, r) => s + ((r - mean) / stdDev) ** 3, 0) / n;
  const kurtosis = monthlyReturns.reduce((s, r) => s + ((r - mean) / stdDev) ** 4, 0) / n - 3;

  const winRate = monthlyReturns.filter(r => r > 0).length / n;
  const bestMonth = Math.max(...monthlyReturns);
  const worstMonth = Math.min(...monthlyReturns);
  const posR = monthlyReturns.filter(r => r > 0);
  const negR = monthlyReturns.filter(r => r <= 0);
  const avgGain = posR.length > 0 ? posR.reduce((s, r) => s + r, 0) / posR.length : 0;
  const avgLoss = negR.length > 0 ? negR.reduce((s, r) => s + r, 0) / negR.length : -0.001;
  const gainLossRatio = Math.abs(avgGain / avgLoss);

  const ulcer = Math.sqrt(ddSeries.reduce((s, dd) => s + dd ** 2, 0) / ddSeries.length);
  const upi = ulcer > 0 ? (annualizedReturn - RF_ANNUAL) / ulcer : 0;

  const rollingSharpe: { month: number; label: string; sharpe: number }[] = [];
  const rollingSortino: { month: number; label: string; sortino: number }[] = [];
  for (let i = 11; i < n; i++) {
    const w = monthlyReturns.slice(i - 11, i + 1);
    const wM = w.reduce((s, r) => s + r, 0) / 12;
    const wV = w.reduce((s, r) => s + (r - wM) ** 2, 0) / 11;
    const wS = Math.sqrt(wV) * Math.sqrt(12);
    rollingSharpe.push({ month: i + 1, label: (i + 1) % 12 === 0 ? `Yr ${(i + 1) / 12}` : "", sharpe: wS > 0 ? ((wM * 12) - RF_ANNUAL) / wS : 0 });
    const wDown = w.filter(r => r < RF_MONTHLY);
    const wDD = wDown.length > 0 ? Math.sqrt(wDown.reduce((s, r) => s + (r - RF_MONTHLY) ** 2, 0) / wDown.length) * Math.sqrt(12) : 0.001;
    rollingSortino.push({ month: i + 1, label: (i + 1) % 12 === 0 ? `Yr ${(i + 1) / 12}` : "", sortino: ((wM * 12) - RF_ANNUAL) / wDD });
  }

  const buckets: Record<number, number> = {};
  for (const r of monthlyReturns) { const k = Math.round(r * 100); buckets[k] = (buckets[k] ?? 0) + 1; }
  const distData = Object.entries(buckets).map(([k, v]) => ({ return_pct: +k, count: v })).sort((a, b) => a.return_pct - b.return_pct);

  return { annualizedReturn, annualVol, sharpe, sortino, maxDD, calmar, beta, alpha, treynor, infoRatio, trackingError, var95, cvar95, skewness, kurtosis, winRate, bestMonth, worstMonth, gainLossRatio, ulcer, upi, rollingSharpe, rollingSortino, distData, ddSeries };
}

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtR = (v: number) => v.toFixed(2);

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, accent, tooltip }: {
  label: string; value: string; sub?: string; accent?: string; tooltip?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 cursor-default"
      onMouseEnter={() => tooltip && setShow(true)} onMouseLeave={() => setShow(false)}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1 flex items-center gap-1">
        {label}
        {tooltip && <span className="text-[8px] border border-[var(--color-border)] rounded-full px-1 leading-3">?</span>}
      </p>
      <p className="text-base font-bold tabular-nums font-mono" style={accent ? { color: accent } : undefined}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">{sub}</p>}
      {show && tooltip && (
        <div className="absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 z-20 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[11px] text-[var(--color-text-muted)] leading-relaxed shadow-lg">
          {tooltip}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-2 mt-1">{children}</p>;
}

const CHART_TICK = { fill: "var(--color-text-subtle)", fontSize: 10 };
const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)",
  borderRadius: "8px", fontSize: "12px", color: "var(--color-text)",
};

const MdComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="mb-3 mt-5 text-base font-semibold text-[var(--color-text)] first:mt-0">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="mb-2 mt-4 text-sm font-semibold text-[var(--color-text)] first:mt-0">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="mb-1.5 mt-3 text-sm font-medium text-[var(--color-text)] first:mt-0">{children}</h3>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 text-sm leading-relaxed text-[var(--color-text)] last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-[var(--color-text)]">{children}</strong>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-3 ml-4 list-disc space-y-1 text-sm text-[var(--color-text)] last:mb-0">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm text-[var(--color-text)] last:mb-0">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
  table: ({ children }: { children?: React.ReactNode }) => <div className="mb-3 overflow-x-auto last:mb-0"><table className="w-full border-collapse text-sm">{children}</table></div>,
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">{children}</thead>,
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody className="divide-y divide-[var(--color-border-subtle)]">{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr className="hover:bg-[var(--color-surface-raised)]/50">{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="px-3 py-2 font-medium">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="px-3 py-2 tabular-nums text-[var(--color-text)]">{children}</td>,
};

// ── Planned holdings (from Planning tab via localStorage) ─────────────────────

const PLANNED_HOLDINGS_KEY = "investmentPlanHoldings";

interface StoredPlannedHolding {
  id: string; name: string; ticker: string; asset_class: string; plannedValue?: number;
}

function loadPlannedHoldings(): StoredPlannedHolding[] {
  try {
    const raw = localStorage.getItem(PLANNED_HOLDINGS_KEY);
    if (raw) return JSON.parse(raw) as StoredPlannedHolding[];
  } catch { /* ignore */ }
  return [];
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  holdings: InvestmentHolding[];
  investments: Investment[];
  totalValue: number;
  totalMonthlyContribution: number;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function InvestmentForecastView({ holdings, investments, totalValue, totalMonthlyContribution }: Props) {
  const [monthly, setMonthly] = useState(String(Math.round(totalMonthlyContribution)));
  const [yearsInput, setYearsInput] = useState("10");
  // Committed sim state — only updates when user clicks Simulate
  const [simMonthly, setSimMonthly] = useState(Math.round(totalMonthlyContribution));
  const [simYears, setSimYears] = useState(10);
  const [simStrategy, setSimStrategy] = useState<ContribStrategy>("balance");
  const [strategyDraft, setStrategyDraft] = useState<ContribStrategy>("balance");
  const [activeTab, setActiveTab] = useState<"overview" | "risk" | "returns" | "drawdown">("overview");
  const [model, setModel] = useState<string>("claude-sonnet-4-5");

  // Per-holding overrides (display as %, stored as % string)
  const [overrides, setOverrides] = useState<Record<string, { ret: string; vol: string }>>({});

  // Claude calibration
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [rationales, setRationales] = useState<Record<string, string>>({});

  // ── 3-Stage Pipeline ──────────────────────────────────────────────────────
  // Stage 1: COUNCIL — macro thesis
  const [councilStreaming, setCouncilStreaming] = useState(false);
  const [councilText, setCouncilText] = useState("");
  const [macroThesis, setMacroThesis] = useState<MacroThesis | null>(null);
  const [councilError, setCouncilError] = useState<string | null>(null);
  const councilEndRef = useRef<HTMLDivElement>(null);

  // Stage 2: QUANT — quant params
  const [quantStreaming, setQuantStreaming] = useState(false);
  const [quantText, setQuantText] = useState("");
  const [quantParamsDraft, setQuantParamsDraft] = useState<QuantParams | null>(null);
  const [quantOverrides, setQuantOverrides] = useState<QuantParams | null>(null);
  const [quantError, setQuantError] = useState<string | null>(null);
  const quantEndRef = useRef<HTMLDivElement>(null);

  // Stage 3: SIMULATE — ensemble
  const [ensembleResult, setEnsembleResult] = useState<EnsembleResult | null>(null);
  const [ensembleRunning, setEnsembleRunning] = useState(false);

  useEffect(() => {
    if (councilText) councilEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [councilText]);
  useEffect(() => {
    if (quantText) quantEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [quantText]);

  // Scenario analysis (streaming)
  const [scenario, setScenario] = useState("");
  const [analyzingScenario, setAnalyzingScenario] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const scenarioEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scenario) scenarioEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [scenario]);

  const hasApiKey = !!localStorage.getItem("anthropicApiKey");

  // ── Simulation inputs ─────────────────────────────────────────────────────
  // (defined ahead of handlers so simHoldings etc. are in scope)

  const activeHoldings = holdings.filter(h => h.current_value > 0);
  const invMap = useMemo(() => new Map(investments.map(i => [i.id, i])), [investments]);

  // Effective per-holding params (override → investment expected_return → asset class default)
  const holdingParams = useMemo(() => activeHoldings.map(h => {
    const ov = overrides[h.id];
    const inv = invMap.get(h.investment_id);
    const annualReturn = ov?.ret ? Number(ov.ret) / 100
      : (inv?.expected_return ?? ASSET_DEFAULT_RETURN[h.asset_class] ?? 0.07);
    const annualVol = ov?.vol ? Number(ov.vol) / 100
      : (ASSET_VOL[h.asset_class] ?? 0.20);
    return { h, annualReturn, annualVol };
  }), [activeHoldings, overrides, invMap]);

  const plannedHoldings = useMemo(() => loadPlannedHoldings().filter(p => (p.plannedValue ?? 0) > 0), []);
  const plannedTotal = plannedHoldings.reduce((s, p) => s + (p.plannedValue ?? 0), 0);
  const effectiveTotal = totalValue + plannedTotal;

  const simHoldings = useMemo<SimHolding[]>(() => {
    if (effectiveTotal === 0) return [];
    const actual = holdingParams.map(({ h, annualReturn, annualVol }) => ({
      id: h.id, name: h.name, ticker: h.ticker, asset_class: h.asset_class,
      startVal: h.current_value, targetPct: h.current_value / effectiveTotal,
      annualReturn, annualVol,
    }));
    const planned = plannedHoldings.map(p => {
      const ov = overrides[p.id];
      return {
        id: p.id, name: p.name, ticker: p.ticker || null, asset_class: p.asset_class,
        startVal: p.plannedValue ?? 0, targetPct: (p.plannedValue ?? 0) / effectiveTotal,
        annualReturn: ov?.ret ? Number(ov.ret) / 100 : (ASSET_DEFAULT_RETURN[p.asset_class] ?? 0.07),
        annualVol: ov?.vol ? Number(ov.vol) / 100 : (ASSET_VOL[p.asset_class] ?? 0.20),
      };
    });
    return [...actual, ...planned];
  }, [holdingParams, effectiveTotal, plannedHoldings]);

  const months = simYears * 12;
  const monthlyNum = simMonthly;

  const isDirty = String(simMonthly) !== monthly.trim() || simYears !== (parseInt(yearsInput, 10) || 10) || simStrategy !== strategyDraft;

  const { data, monthlyReturns, benchReturns, startTotal, endValuesByAssetClass } = useMemo(() => {
    if (simHoldings.length === 0) return { data: [], monthlyReturns: [], benchReturns: [], startTotal: 0, endValuesByAssetClass: {} };
    return simulate(simHoldings, monthlyNum, months, simStrategy);
  }, [simHoldings, monthlyNum, months, simStrategy]);

  const metrics = useMemo(() => {
    if (monthlyReturns.length < 12) return null;
    return calcMetrics(monthlyReturns, benchReturns);
  }, [monthlyReturns, benchReturns]);

  const blendedReturn = simHoldings.reduce((s, h) => s + h.annualReturn * (h.startVal / (effectiveTotal || 1)), 0);

  // Annualized return from the monthly returns series — true sim-derived blended return, contribution-agnostic
  const simAnnualizedReturn = metrics ? metrics.annualizedReturn * 100 : null;

  // ── Claude calibration ────────────────────────────────────────────────────

  async function handleCalibrate() {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey || (activeHoldings.length === 0 && plannedHoldings.length === 0)) return;
    setCalibrating(true);
    setCalibrationError(null);

    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

      const actualLines = activeHoldings.map(h => {
        const assetLabel = ASSET_CLASSES.find(a => a.value === h.asset_class)?.label ?? h.asset_class;
        return `- ${h.ticker ?? h.name}${h.ticker ? ` (${h.name})` : ""} | ${assetLabel} | $${h.current_value.toFixed(2)} current value`;
      });
      const plannedLines = plannedHoldings.map(p => {
        const assetLabel = ASSET_CLASSES.find(a => a.value === p.asset_class)?.label ?? p.asset_class;
        return `- ${p.ticker || p.name}${p.ticker ? ` (${p.name})` : ""} | ${assetLabel} | $${(p.plannedValue ?? 0).toFixed(2)} planned value [PLANNED]`;
      });
      const holdingsList = [...actualLines, ...plannedLines].join("\n");

      const actualIds = activeHoldings.map(h => `- id: "${h.id}" | ${h.ticker ?? h.name} | ${ASSET_CLASSES.find(a => a.value === h.asset_class)?.label ?? h.asset_class}`);
      const plannedIds = plannedHoldings.map(p => `- id: "${p.id}" | ${p.ticker || p.name} | ${ASSET_CLASSES.find(a => a.value === p.asset_class)?.label ?? p.asset_class} [PLANNED]`);
      const allIds = [...actualIds, ...plannedIds].join("\n");

      const userMsg = `I need forward-looking annual return and volatility estimates for each of my holdings for a ${simYears}-year portfolio forecast simulation.

Holdings:
${holdingsList}

For each holding, return a JSON array. Use the holding's id field exactly as shown. Be realistic and forward-looking — not just historical averages. Consider current market conditions, sector dynamics, valuation levels, and the forecast horizon. For [PLANNED] holdings, estimate based on the asset class and ticker even though they are not yet purchased.

Return ONLY a valid JSON array in this exact format, nothing else:
[
  {
    "id": "<holding_id>",
    "ticker": "<ticker or name>",
    "annualReturn": <decimal e.g. 0.095 for 9.5%>,
    "annualVol": <decimal e.g. 0.17 for 17%>,
    "rationale": "<1-2 sentence justification>"
  }
]

Holdings with IDs:
${allIds}`;

      const systemMsg = `You are a quantitative portfolio analyst. Return ONLY valid JSON — no markdown, no explanation outside the JSON array. Every annualReturn and annualVol must be a realistic decimal (not a percentage integer). annualVol should reflect expected forward volatility for the asset class, not just historical. Be honest about uncertainty.`;

      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: systemMsg,
        messages: [{ role: "user", content: userMsg }],
      });

      const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
      // Extract JSON array from response (Claude might wrap in ```json blocks)
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("Claude didn't return a valid JSON array. Try again.");

      const estimates: { id: string; ticker: string; annualReturn: number; annualVol: number; rationale: string }[] = JSON.parse(jsonMatch[0]);

      const newOverrides: Record<string, { ret: string; vol: string }> = {};
      const newRationales: Record<string, string> = {};
      for (const est of estimates) {
        if (est.id && typeof est.annualReturn === "number" && typeof est.annualVol === "number") {
          newOverrides[est.id] = {
            ret: (est.annualReturn * 100).toFixed(2),
            vol: (est.annualVol * 100).toFixed(2),
          };
          if (est.rationale) newRationales[est.id] = est.rationale;
        }
      }
      setOverrides(prev => ({ ...prev, ...newOverrides }));
      setRationales(prev => ({ ...prev, ...newRationales }));
    } catch (err) {
      setCalibrationError(err instanceof Error ? err.message : String(err));
    } finally {
      setCalibrating(false);
    }
  }

  // ── Scenario analysis (streaming) ─────────────────────────────────────────

  async function handleScenario() {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey || !metrics) return;
    setAnalyzingScenario(true);
    setScenario("");
    setScenarioError(null);

    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

      // Load target allocations from the Planning tab
      type StoredPlan = { allocations: Record<string, string> };
      let planAllocations: Record<string, string> = {};
      try {
        const raw = localStorage.getItem("investmentPlanAllocations");
        if (raw) planAllocations = (JSON.parse(raw) as StoredPlan).allocations ?? {};
      } catch { /* ignore */ }

      const actualRows = holdingParams.map(({ h, annualReturn, annualVol }) => {
        const assetLabel = ASSET_CLASSES.find(a => a.value === h.asset_class)?.label ?? h.asset_class;
        const currentPct = effectiveTotal > 0 ? (h.current_value / effectiveTotal * 100).toFixed(1) : "0.0";
        const targetPct = planAllocations[h.id] ? `${parseFloat(planAllocations[h.id]!).toFixed(1)}%` : "—";
        return `| ${h.ticker ?? h.name} | ${assetLabel} | ${currentPct}% → ${targetPct} | ${(annualReturn * 100).toFixed(1)}% | ${(annualVol * 100).toFixed(1)}% |`;
      });
      const plannedRows = plannedHoldings.map(p => {
        const ov = overrides[p.id];
        const assetLabel = ASSET_CLASSES.find(a => a.value === p.asset_class)?.label ?? p.asset_class;
        const currentPct = effectiveTotal > 0 ? ((p.plannedValue ?? 0) / effectiveTotal * 100).toFixed(1) : "0.0";
        const targetPct = planAllocations[p.id] ? `${parseFloat(planAllocations[p.id]!).toFixed(1)}%` : "—";
        const annualReturn = ov?.ret ? Number(ov.ret) / 100 : (ASSET_DEFAULT_RETURN[p.asset_class] ?? 0.07);
        const annualVol = ov?.vol ? Number(ov.vol) / 100 : (ASSET_VOL[p.asset_class] ?? 0.20);
        return `| ${p.ticker || p.name} [planned] | ${assetLabel} | ${currentPct}% → ${targetPct} | ${(annualReturn * 100).toFixed(1)}% | ${(annualVol * 100).toFixed(1)}% |`;
      });
      const holdingsTable = [...actualRows, ...plannedRows].join("\n");
      const hasTargets = Object.keys(planAllocations).length > 0;

      // Simplified holdings table for macro thesis — weight only, no current→target comparison
      const macroActualRows = holdingParams.map(({ h, annualReturn, annualVol }) => {
        const assetLabel = ASSET_CLASSES.find(a => a.value === h.asset_class)?.label ?? h.asset_class;
        const weight = effectiveTotal > 0 ? (h.current_value / effectiveTotal * 100).toFixed(1) : "0.0";
        return `| ${h.ticker ?? h.name} | ${assetLabel} | ${weight}% | ${(annualReturn * 100).toFixed(1)}% | ${(annualVol * 100).toFixed(1)}% |`;
      });
      const macroPlannedRows = plannedHoldings.map(p => {
        const ov = overrides[p.id];
        const assetLabel = ASSET_CLASSES.find(a => a.value === p.asset_class)?.label ?? p.asset_class;
        const weight = effectiveTotal > 0 ? ((p.plannedValue ?? 0) / effectiveTotal * 100).toFixed(1) : "0.0";
        const annualReturn = ov?.ret ? Number(ov.ret) / 100 : (ASSET_DEFAULT_RETURN[p.asset_class] ?? 0.07);
        const annualVol = ov?.vol ? Number(ov.vol) / 100 : (ASSET_VOL[p.asset_class] ?? 0.20);
        return `| ${p.ticker || p.name} | ${assetLabel} | ${weight}% | ${(annualReturn * 100).toFixed(1)}% | ${(annualVol * 100).toFixed(1)}% |`;
      });
      const macroHoldingsTable = [...macroActualRows, ...macroPlannedRows].join("\n");

      // Build year snapshots inline (available here since data is in scope via closure over the outer component render)
      const snapYears = Array.from({ length: Math.min(simYears, 10) }, (_, i) => i + 1)
        .map(y => data[y * 12])
        .filter((s): s is DataPoint => s !== undefined);
      const snapshotTable = snapYears.map(s => {
        const yr = s.month / 12;
        const gainsPct = s.contributions > 0 ? ((s.gains / s.contributions) * 100).toFixed(0) : "0";
        return `| Yr ${yr} | $${(s.total / 1000).toFixed(1)}K | $${(s.contributions / 1000).toFixed(1)}K | $${(s.gains / 1000).toFixed(1)}K | ${gainsPct}% gains on contributions |`;
      }).join("\n");

      // End-state allocation by asset class
      const endTotal = endData!.total;
      const endAllocTable = Object.entries(endValuesByAssetClass)
        .sort((a, b) => b[1] - a[1])
        .map(([cls, val]) => {
          const label = ASSET_CLASSES.find(a => a.value === cls)?.label ?? cls;
          return `| ${label} | $${(val / 1000).toFixed(1)}K | ${((val / endTotal) * 100).toFixed(1)}% |`;
        }).join("\n");

      const contribShare = endData!.contributions > 0
        ? ((endData!.contributions / endData!.total) * 100).toFixed(0) : "0";
      const gainsShare = endData!.gains > 0
        ? ((endData!.gains / endData!.total) * 100).toFixed(0) : "0";

      // ── Ensemble context (optional — only when simulation has been run) ──
      let ensembleSection = "";
      if (ensembleResult) {
        const { terminalP10, terminalP25, terminalP50, terminalP75, terminalP90, milestobeProbs } = ensembleResult;
        const milestoneLines = milestobeProbs
          .map(m => `  - ${m.label}: P(reach) ${(m.prob * 100).toFixed(0)}%`)
          .join("\n");
        ensembleSection = `
## Monte Carlo Ensemble (10,000 paths — Markov regime switching + fat-tail returns)
- Terminal P10: $${(terminalP10 / 1000).toFixed(1)}K | P25: $${(terminalP25 / 1000).toFixed(1)}K | P50: $${(terminalP50 / 1000).toFixed(1)}K | P75: $${(terminalP75 / 1000).toFixed(1)}K | P90: $${(terminalP90 / 1000).toFixed(1)}K
- Median outcome: $${(terminalP50 / 1000).toFixed(1)}K | Downside (P10): $${(terminalP10 / 1000).toFixed(1)}K | Upside (P90): $${(terminalP90 / 1000).toFixed(1)}K
- Bull scenario path terminal: $${((ensembleResult.fanData[ensembleResult.fanData.length - 1]?.bull ?? 0) / 1000).toFixed(1)}K
- Bear scenario path terminal: $${((ensembleResult.fanData[ensembleResult.fanData.length - 1]?.bear ?? 0) / 1000).toFixed(1)}K

### Milestone Probabilities
${milestoneLines || "  (no milestones computed)"}`;


        if (quantOverrides) {
          const shockLines = Object.entries(quantOverrides.shockOverrides ?? {})
            .map(([k, v]) => `  - ${k}: p_annual = ${(v * 100).toFixed(2)}%`)
            .join("\n");
          const muLines = Object.entries(quantOverrides.regimeMuOverrides ?? {})
            .map(([k, v]) => `  - ${k}: Δμ = ${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`)
            .join("\n");
          const sigLines = Object.entries(quantOverrides.regimeSigmaOverrides ?? {})
            .map(([k, v]) => `  - ${k}: Δσ = ${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`)
            .join("\n");
          ensembleSection += `

## Active Quant Overrides (applied before simulation)
### Shock overrides
${shockLines || "  (none)"}
### Return (μ) overrides
${muLines || "  (none)"}
### Volatility (σ) overrides
${sigLines || "  (none)"}
Quant rationale: ${quantOverrides.rationale ?? "(none)"}`;
        }
      }

      const strategyDesc = simStrategy === "growth"
        ? "Growth Strategy: return-weighted contributions, floor protection for starved positions, quarterly convergence"
        : simStrategy === "rebalance"
          ? "Rebalance Strategy: gap-weighted fill — underweight positions receive proportionally more each month"
          : "Balance Strategy: contributions split by target weight each month";

      const userMsg = `**Portfolio Simulation — ${simYears}-Year Projection (${strategyDesc})**

## Portfolio Snapshot
- Current value: $${effectiveTotal.toFixed(2)}
- Monthly contribution: $${monthlyNum.toFixed(2)}/mo → $${(monthlyNum * 12).toFixed(0)}/yr
- Total contributions over ${simYears} yrs: $${endData!.contributions.toFixed(0)}

## Holdings
| Holding | Class | Weight | Return Est. | Vol Est. |
|---------|-------|--------|-------------|----------|
${macroHoldingsTable}

## Simulated Growth Trajectory (year-by-year)
| Year | Portfolio | Contributed | Market Gains | Ratio |
|------|-----------|-------------|--------------|-------|
${snapshotTable}

## Projected End State (Year ${simYears})
- **End value: $${endData!.total.toFixed(2)}**
- Contributed: $${endData!.contributions.toFixed(2)} (${contribShare}% of end value)
- Market gains: $${endData!.gains.toFixed(2)} (${gainsShare}% of end value)
- Annualized return: ${(metrics.annualizedReturn * 100).toFixed(2)}%
- Annualized volatility: ${(metrics.annualVol * 100).toFixed(2)}%

## Projected End Allocation by Asset Class
| Asset Class | Value | Weight |
|-------------|-------|--------|
${endAllocTable}

## Risk-Adjusted Metrics (computed over simulated monthly return series)
- Sharpe: ${metrics.sharpe.toFixed(3)} | Sortino: ${metrics.sortino.toFixed(3)} | Calmar: ${metrics.calmar.toFixed(3)} | Treynor: ${metrics.treynor.toFixed(3)}
- Beta: ${metrics.beta.toFixed(3)} | Alpha: ${metrics.alpha.toFixed(2)}% | Info Ratio: ${metrics.infoRatio.toFixed(3)} | Tracking Error: ${(metrics.trackingError * 100).toFixed(2)}%
- Max Drawdown: ${(metrics.maxDD * 100).toFixed(2)}% | VaR 95%: ${(metrics.var95 * 100).toFixed(2)}% | CVaR 95%: ${(metrics.cvar95 * 100).toFixed(2)}%
- Ulcer: ${(metrics.ulcer * 100).toFixed(2)}% | UPI: ${metrics.upi.toFixed(3)} | Win Rate: ${(metrics.winRate * 100).toFixed(0)}% | Gain/Loss: ${metrics.gainLossRatio.toFixed(3)}
- Skew: ${metrics.skewness.toFixed(3)} | Kurt: ${metrics.kurtosis.toFixed(3)} | Best month: +${(metrics.bestMonth * 100).toFixed(2)}% | Worst: ${(metrics.worstMonth * 100).toFixed(2)}%
${ensembleSection}
---

Write a **macro thesis report** on the coherency and growth potential of this portfolio — a top-down judgment of whether what has been built makes sense as a system and whether it is structurally capable of compounding over time.

**Important caveat to incorporate:** Monthly contribution ($${monthlyNum.toFixed(0)}/mo) will dominate portfolio growth over market returns for approximately the first 3 years. Do not interpret early Sharpe or alpha metrics as signals of portfolio quality during this phase — contribution flow, not return generation, is the primary driver. Your thesis should acknowledge this explicitly and shift its quality judgment to the post-year-3 trajectory.

${ensembleResult ? `**Monte Carlo context:** You have been given 10,000-path ensemble results. Use the probabilistic fan (P10/P50/P90) and tail risk (ES10, P(drawdown>20%)) as the primary evidence for growth credibility — not just the deterministic trajectory. Ground your conviction call in the ensemble output.` : ""}

Structure the report as:

1. **Macro thesis** — in 2–3 sentences, what is this portfolio trying to do and does the construction reflect that intent? Evaluate coherency across asset classes, return assumptions, and contribution rate relative to portfolio size.

2. **Growth credibility** — given the simulated trajectory${ensembleResult ? " and probabilistic fan" : ""}, is this portfolio structurally capable of compounding at the projected rate? Identify the key risks or structural weaknesses that could cause it to underperform — be specific and grounded in the numbers.

3. **Asset class coherency** — do the holdings work together or create redundant/conflicting exposures? Evaluate the projected end-state allocation by asset class. Flag any concentration risk or volatility drag that undermines the overall thesis.

4. **One conviction call** — the single most important thing this investor should do or stop doing to strengthen the portfolio's long-term trajectory. Cite a specific metric or simulated number to justify it.

Do not enumerate every holding. Do not hedge everything with "it depends." Write with conviction.`;

      const systemMsg = ensembleResult
        ? `You are a senior portfolio strategist writing a macro thesis review for an investor actively building their portfolio. You have access to both a deterministic single-path simulation AND a 10,000-path Monte Carlo ensemble with regime switching and fat-tail returns. Use the ensemble's probabilistic fan (P10/P50/P90), tail risk metrics (ES10, P(drawdown>20%)), and milestone probabilities as the primary evidence base. Write at the level of a quarterly CIO memo: clear, opinionated, grounded in the data. Every qualitative claim must be traceable to a number in the simulation. Be direct. The investor can handle an honest assessment.`
        : `You are a senior portfolio strategist writing a macro thesis review for an investor actively building their portfolio. Your job is to assess coherency and structural growth potential. Write at the level of a quarterly CIO memo: clear, opinionated, grounded in the data provided. Every qualitative claim must be traceable to a number in the simulation. Be direct. The investor can handle an honest assessment.`;

      let text = "";
      const stream = await client.messages.stream({ model, max_tokens: 8192, system: systemMsg, messages: [{ role: "user", content: userMsg }] });
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          text += chunk.delta.text;
          setScenario(text);
        }
      }
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzingScenario(false);
    }
  }

  // ── Pipeline handlers ─────────────────────────────────────────────────────

  const handleCouncil = useCallback(async () => {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey || simHoldings.length === 0) return;
    setCouncilStreaming(true);
    setCouncilText("");
    setMacroThesis(null);
    setCouncilError(null);
    // Reset downstream
    setQuantText("");
    setQuantParamsDraft(null);
    setQuantOverrides(null);
    setEnsembleResult(null);

    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

      const assetWeights = Object.entries(
        simHoldings.reduce<Record<string, number>>((acc, h) => {
          acc[h.asset_class] = (acc[h.asset_class] ?? 0) + h.startVal;
          return acc;
        }, {})
      ).map(([cls, val]) => {
        const label = ASSET_CLASSES.find(a => a.value === cls)?.label ?? cls;
        return `${label}: ${((val / effectiveTotal) * 100).toFixed(1)}%`;
      }).join(", ");

      const systemMsg = `You are a macro portfolio strategist. Your task is to assess the current market regime and produce a structured thesis for a ${simYears}-year investment horizon. Always respond in two parts: first a freeform markdown narrative thesis (be direct, analytical, opinionated), then a JSON block wrapped in <json>...</json> tags containing your MacroThesis parameters. The narrative comes first, then the JSON.`;

      const userMsg = `Analyze this portfolio for a ${simYears}-year forecast:
- Total value: $${effectiveTotal.toFixed(0)}
- Monthly contribution: $${monthlyNum.toFixed(0)}/mo
- Asset class weights: ${assetWeights}
- Holdings count: ${simHoldings.length}

Write a macro thesis assessing:
1. Current macro regime (bull/neutral/bear) and why
2. Which asset classes benefit vs. suffer in this regime
3. Key tail risks and shock scenarios to model
4. Return/volatility adjustments warranted by macro outlook

Then output exactly this JSON in <json>...</json> tags:
{
  "regimeAssessment": "bull|neutral|bear",
  "shockOverrides": { "crash_prob": 0.005, "correction_prob": 0.02 },
  "regimeMuOverrides": { "stocks": 0.01, "bonds": -0.005, "crypto": 0.02, "real_estate": 0.005, "commodities": 0.01, "cash": 0, "other": 0 },
  "rationale": "1-sentence summary"
}`;

      let text = "";
      const stream = await client.messages.stream({ model, max_tokens: 8192, system: systemMsg, messages: [{ role: "user", content: userMsg }] });
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          text += chunk.delta.text;
          setCouncilText(text);
        }
      }

      // Extract JSON from <json>...</json>
      const jsonMatch = text.match(/<json>([\s\S]*?)<\/json>/);
      if (jsonMatch?.[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]) as MacroThesis;
          setMacroThesis(parsed);
        } catch { /* thesis text still shown */ }
      }
    } catch (err) {
      setCouncilError(err instanceof Error ? err.message : String(err));
    } finally {
      setCouncilStreaming(false);
    }
  }, [simHoldings, effectiveTotal, simYears, monthlyNum, model]);

  const handleQuant = useCallback(async () => {
    const apiKey = localStorage.getItem("anthropicApiKey");
    if (!apiKey || !macroThesis || simHoldings.length === 0) return;
    setQuantStreaming(true);
    setQuantText("");
    setQuantParamsDraft(null);
    setQuantError(null);
    setEnsembleResult(null);

    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

      const holdingsSummary = simHoldings.map(h => {
        const label = ASSET_CLASSES.find(a => a.value === h.asset_class)?.label ?? h.asset_class;
        return `- ${h.ticker ?? h.name} | ${label} | return=${(h.annualReturn*100).toFixed(1)}% vol=${(h.annualVol*100).toFixed(1)}%`;
      }).join("\n");

      const systemMsg = `You are a quantitative risk modeler. You receive a macro thesis and portfolio holdings, then calibrate ensemble simulation parameters. Respond with a brief memo, then output exact JSON in <json>...</json> tags.`;

      const userMsg = `Macro thesis from Council Agent:
- Regime: ${macroThesis.regimeAssessment}
- Rationale: ${macroThesis.rationale}
- Regime mu overrides: ${JSON.stringify(macroThesis.regimeMuOverrides)}
- Shock overrides: ${JSON.stringify(macroThesis.shockOverrides)}

Portfolio holdings:
${holdingsSummary}

Horizon: ${simYears} years | Monthly contribution: $${monthlyNum.toFixed(0)}

As quant agent, calibrate the ensemble simulation parameters. Write a brief calibration memo, then output:
<json>
{
  "shockOverrides": { "crash_prob": 0.005, "correction_prob": 0.02 },
  "regimeMuOverrides": { "stocks": 0.01, "bonds": -0.005, "crypto": 0.02, "real_estate": 0.005, "commodities": 0.01, "cash": 0, "other": 0 },
  "regimeSigmaOverrides": { "stocks": 0.02, "bonds": 0.005, "crypto": 0.10, "real_estate": 0.01, "commodities": 0.02, "cash": 0, "other": 0.01 },
  "rationale": "1-sentence summary of calibration"
}
</json>

regimeMuOverrides = annual return adjustments (decimal, additive to base). regimeSigmaOverrides = annual vol adjustments (additive). Keep values modest and realistic.`;

      let text = "";
      const stream = await client.messages.stream({ model, max_tokens: 4096, system: systemMsg, messages: [{ role: "user", content: userMsg }] });
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          text += chunk.delta.text;
          setQuantText(text);
        }
      }

      const jsonMatch = text.match(/<json>([\s\S]*?)<\/json>/);
      if (jsonMatch?.[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]) as QuantParams;
          setQuantParamsDraft(parsed);
        } catch { /* text still shown */ }
      }
    } catch (err) {
      setQuantError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuantStreaming(false);
    }
  }, [macroThesis, simHoldings, simYears, monthlyNum, model]);

  const handleSimulate = useCallback(() => {
    if (!quantOverrides || simHoldings.length === 0) return;
    setEnsembleRunning(true);
    setEnsembleResult(null);
    // Run in next tick to allow UI to render loading state
    setTimeout(() => {
      try {
        const ctx = buildSimContext(simHoldings, monthlyNum, months, simStrategy, effectiveTotal);
        const result = runEnsemble(ctx, quantOverrides, MILESTONE_LEVELS);
        setEnsembleResult(result);
      } finally {
        setEnsembleRunning(false);
      }
    }, 50);
  }, [quantOverrides, simHoldings, monthlyNum, months, simStrategy, effectiveTotal]);

  // ── Early exit ────────────────────────────────────────────────────────────

  if (activeHoldings.length === 0 && plannedHoldings.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-[var(--color-text-muted)]">
          Add holdings with values, or add planned holdings in the Planning tab.
        </CardContent>
      </Card>
    );
  }

  const endData = data[data.length - 1];
  if (!endData) return null;

  const totalReturn = startTotal > 0 ? ((endData.total - startTotal) / startTotal * 100).toFixed(0) : "0";
  const cagr = simYears > 0 ? ((Math.pow(endData.total / startTotal, 1 / simYears) - 1) * 100).toFixed(1) : "0";
  const yearSnapshots = Array.from({ length: simYears }, (_, i) => i + 1)
    .filter(y => y * 12 <= data.length - 1)
    .map(y => data[y * 12])
    .filter((s): s is DataPoint => s !== undefined);
  const milestones = MILESTONE_LEVELS.filter(v => v > startTotal).slice(0, 6)
    .map(v => {
      const label = v >= 1_000_000 ? `$${v / 1_000_000}M` : `$${v / 1_000}K`;
      const idx = data.findIndex(d => d.total >= v);
      return { label, value: v, monthHit: idx, yearHit: idx > 0 ? (idx / 12).toFixed(1) : null };
    }).filter(m => m.monthHit > 0);
  const ddChartData = metrics?.ddSeries.map((dd, i) => ({ month: i + 1, label: (i + 1) % 12 === 0 ? `Yr ${(i + 1) / 12}` : "", drawdown: dd * 100 })) ?? [];
  const pieData = Object.entries(endValuesByAssetClass).map(([cls, val]) => ({
    name: ASSET_CLASSES.find(a => a.value === cls)?.label ?? cls, value: val,
    color: ASSET_CLASS_COLORS[cls] ?? "#94a3b8",
  })).sort((a, b) => b.value - a.value);
  const totalEndAlloc = pieData.reduce((s, d) => s + d.value, 0);
  const rollingCombined = metrics?.rollingSharpe.map((s, i) => ({ ...s, sortino: metrics.rollingSortino[i]?.sortino ?? 0 })) ?? [];

  return (
    <div className="flex flex-col gap-5">

      {/* ── Inputs row ── */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-44">
              <Input label="Monthly Contribution ($)" type="number" min="0" step="50"
                value={monthly} onChange={e => setMonthly(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { setSimMonthly(Math.max(0, Number(monthly) || 0)); setSimYears(Math.max(1, parseInt(yearsInput, 10) || 10)); setSimStrategy(strategyDraft); } }} />
            </div>
            <div className="w-28">
              <Input label="Forecast Years" type="number" min="1" max="50" step="1"
                value={yearsInput} onChange={e => setYearsInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { setSimMonthly(Math.max(0, Number(monthly) || 0)); setSimYears(Math.max(1, parseInt(yearsInput, 10) || 10)); setSimStrategy(strategyDraft); } }} />
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)] mb-1.5">Contribution Strategy</p>
              <div className="flex gap-1">
                {([
                  { value: "balance",   label: "Balance",   title: "Split contributions by target weight each month — simple and consistent" },
                  { value: "rebalance", label: "Rebalance", title: "Gap-weighted fill: underweight positions receive proportionally more each month" },
                  { value: "growth",   label: "Growth",    title: "Return-weighted contributions; floor protection for significantly underweight positions; quarterly convergence forced" },
                ] as { value: ContribStrategy; label: string; title: string }[]).map(s => (
                  <button key={s.value} onClick={() => setStrategyDraft(s.value)} title={s.title}
                    className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${strategyDraft === s.value ? "bg-[var(--color-surface-raised)] border border-[var(--color-border)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)] mb-1.5">Model</p>
              <div className="flex gap-1">
                {CLAUDE_MODELS.map(m => (
                  <button key={m.value} onClick={() => setModel(m.value)}
                    className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${model === m.value ? "bg-[var(--color-surface-raised)] border border-[var(--color-border)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => { setSimMonthly(Math.max(0, Number(monthly) || 0)); setSimYears(Math.max(1, parseInt(yearsInput, 10) || 10)); setSimStrategy(strategyDraft); }}
              className={`rounded px-4 py-2 text-xs font-semibold transition-colors ${isDirty ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-raised)] border border-[var(--color-border)] text-[var(--color-text-muted)]"}`}
            >
              Simulate
            </button>
            <div className="ml-auto text-right">
              <p className="text-[10px] text-[var(--color-text-subtle)] uppercase tracking-wider">Simulated Return</p>
              <p className="text-sm font-semibold tabular-nums text-[var(--color-primary)]">
                {simAnnualizedReturn !== null ? `${simAnnualizedReturn.toFixed(2)}% / yr` : "—"}
              </p>
              <p className="text-[10px] text-[var(--color-text-subtle)]">{simHoldings.length} holdings{plannedHoldings.length > 0 ? ` (${plannedHoldings.length} planned)` : ""} · Monte Carlo (seed 42)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 3-Stage Agent Pipeline ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap size={15} className="text-[var(--color-primary)]" />
            <CardTitle>Ensemble Pipeline</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Stage buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {/* COUNCIL */}
            <button
              onClick={() => void handleCouncil()}
              disabled={councilStreaming || !hasApiKey || simHoldings.length === 0}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Bot size={12} />
              {councilStreaming ? "Council thinking…" : macroThesis ? "Re-run Council" : "Council"}
            </button>
            {/* QUANT */}
            <button
              onClick={() => void handleQuant()}
              disabled={quantStreaming || !hasApiKey || !macroThesis}
              title={!macroThesis ? "Run Council first" : undefined}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Sparkles size={12} />
              {quantStreaming ? "Quant calibrating…" : quantOverrides ? "Re-run Quant" : "Quant"}
            </button>
            {/* SIMULATE */}
            <button
              onClick={handleSimulate}
              disabled={ensembleRunning || !quantOverrides}
              title={!quantOverrides ? "Apply quant params first" : undefined}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold bg-[var(--color-success)]/10 text-[var(--color-success)] hover:bg-[var(--color-success)]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <BarChart2 size={12} />
              {ensembleRunning ? `Running ${N_PATHS.toLocaleString()} paths…` : ensembleResult ? "Re-simulate" : "Simulate"}
            </button>
            {/* Status badges */}
            <div className="ml-auto flex items-center gap-2">
              {macroThesis && (
                <span className="text-[10px] rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-2 py-0.5 font-semibold">
                  Regime: {macroThesis.regimeAssessment}
                </span>
              )}
              {quantOverrides && (
                <span className="text-[10px] rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)] px-2 py-0.5 font-semibold">
                  Params applied
                </span>
              )}
              {ensembleResult && (
                <span className="text-[10px] rounded-full bg-[#f79009]/10 text-[#f79009] px-2 py-0.5 font-semibold">
                  {N_PATHS.toLocaleString()} paths ✓
                </span>
              )}
            </div>
          </div>

          {/* Council output */}
          {(councilText || councilError) && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]/50 p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-primary)] mb-2">Council — Macro Thesis</p>
              {councilError && <div className="text-xs text-[var(--color-danger)]">{councilError}</div>}
              {councilText && (
                <div className="prose-sm text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MdComponents}>
                    {councilText.replace(/<json>[\s\S]*?<\/json>/, "").trim()}
                  </ReactMarkdown>
                </div>
              )}
              <div ref={councilEndRef} />
            </div>
          )}

          {/* Quant output */}
          {(quantText || quantError) && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]/50 p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-primary)] mb-2">Quant — Calibration Memo</p>
              {quantError && <div className="text-xs text-[var(--color-danger)]">{quantError}</div>}
              {quantText && (
                <div className="prose-sm text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MdComponents}>
                    {quantText.replace(/<json>[\s\S]*?<\/json>/, "").trim()}
                  </ReactMarkdown>
                </div>
              )}
              {/* Apply button */}
              {quantParamsDraft && !quantOverrides && (
                <button
                  onClick={() => setQuantOverrides(quantParamsDraft)}
                  className="mt-3 flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold bg-[var(--color-success)] text-white hover:opacity-90 transition-opacity"
                >
                  <Sparkles size={11} /> Apply Quant Params
                </button>
              )}
              {quantParamsDraft && quantOverrides && (
                <p className="mt-2 text-[10px] text-[var(--color-success)]">Params applied — click Simulate to run ensemble.</p>
              )}
              <div ref={quantEndRef} />
            </div>
          )}

          {/* Ensemble summary */}
          {ensembleResult && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]/50 p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#f79009] mb-3">Ensemble Results — {N_PATHS.toLocaleString()} Paths · Yr {simYears}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 mb-3">
                {([
                  { label: "P10", val: ensembleResult.terminalP10 },
                  { label: "P25", val: ensembleResult.terminalP25 },
                  { label: "P50 (median)", val: ensembleResult.terminalP50 },
                  { label: "P75", val: ensembleResult.terminalP75 },
                  { label: "P90", val: ensembleResult.terminalP90 },
                ] as { label: string; val: number }[]).map(({ label, val }) => (
                  <div key={label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-2 text-center">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-1">{label}</p>
                    <p className="text-sm font-bold tabular-nums font-mono text-[var(--color-text)]">{fmtShort(val)}</p>
                  </div>
                ))}
              </div>
              {ensembleResult.milestobeProbs.length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-text-subtle)] mb-2">Milestone Probabilities</p>
                  <div className="flex flex-wrap gap-3">
                    {ensembleResult.milestobeProbs.map(m => (
                      <div key={m.label} className="text-center min-w-[60px]">
                        <p className="text-xs font-bold font-mono text-[var(--color-primary)]">{m.label}</p>
                        <p className="text-[10px] text-[var(--color-text-subtle)]">{(m.prob * 100).toFixed(0)}%</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!hasApiKey && (
            <p className="text-[10px] text-[var(--color-text-subtle)]">Add API key in Settings to enable Council and Quant stages.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Claude Calibration ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bot size={15} className="text-[var(--color-primary)]" />
              <CardTitle>Return & Volatility Assumptions</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {!hasApiKey && (
                <p className="text-[10px] text-[var(--color-text-subtle)]">Add API key in Settings to enable Claude calibration</p>
              )}
              <button
                onClick={() => void handleCalibrate()}
                disabled={calibrating || !hasApiKey}
                className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Sparkles size={12} />
                {calibrating ? "Calibrating…" : "Calibrate with Claude"}
              </button>
              <button
                onClick={() => { setOverrides({}); setRationales({}); }}
                className="text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
                title="Reset to defaults"
              >
                Reset
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {calibrationError && (
            <div className="mb-3 rounded bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">{calibrationError}</div>
          )}
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th className="pb-2">Holding</th>
                <th className="pb-2">Class</th>
                <th className="pb-2 text-right">Weight</th>
                <th className="pb-2 text-right">Annual Return %</th>
                <th className="pb-2 text-right">Annual Vol %</th>
                <th className="pb-2 pl-3">Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {/* Actual holdings */}
              {holdingParams.map(({ h, annualReturn, annualVol }) => {
                const ov = overrides[h.id];
                const pct = effectiveTotal > 0 ? (h.current_value / effectiveTotal * 100).toFixed(1) : "0.0";
                return (
                  <tr key={h.id}>
                    <td className="py-1.5">
                      <p className="font-medium">{h.name}</p>
                      {h.ticker && <p className="font-mono text-[var(--color-text-muted)]">{h.ticker}</p>}
                    </td>
                    <td className="py-1.5">
                      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white"
                        style={{ backgroundColor: ASSET_CLASS_COLORS[h.asset_class] ?? "#94a3b8" }}>
                        {ASSET_CLASSES.find(a => a.value === h.asset_class)?.label ?? h.asset_class}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">{pct}%</td>
                    <td className="py-1.5 text-right">
                      <input type="number" min="0" max="100" step="0.1"
                        value={ov?.ret ?? (annualReturn * 100).toFixed(2)}
                        onChange={e => setOverrides(prev => ({ ...prev, [h.id]: { ...prev[h.id] ?? { vol: (annualVol * 100).toFixed(2) }, ret: e.target.value } }))}
                        className={`w-16 text-right bg-transparent border-b focus:outline-none tabular-nums ${ov?.ret ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"}`}
                      />
                      <span className="ml-0.5 text-[var(--color-text-subtle)]">%</span>
                    </td>
                    <td className="py-1.5 text-right">
                      <input type="number" min="0" max="200" step="0.1"
                        value={ov?.vol ?? (annualVol * 100).toFixed(2)}
                        onChange={e => setOverrides(prev => ({ ...prev, [h.id]: { ...prev[h.id] ?? { ret: (annualReturn * 100).toFixed(2) }, vol: e.target.value } }))}
                        className={`w-16 text-right bg-transparent border-b focus:outline-none tabular-nums ${ov?.vol ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"}`}
                      />
                      <span className="ml-0.5 text-[var(--color-text-subtle)]">%</span>
                    </td>
                    <td className="py-1.5 pl-3 text-[var(--color-text-muted)] max-w-[260px]">
                      {rationales[h.id] ?? <span className="text-[var(--color-text-subtle)] italic">—</span>}
                    </td>
                  </tr>
                );
              })}
              {/* Planned holdings from Planning tab */}
              {plannedHoldings.map(p => {
                const ov = overrides[p.id];
                const defaultReturn = ASSET_DEFAULT_RETURN[p.asset_class] ?? 0.07;
                const defaultVol = ASSET_VOL[p.asset_class] ?? 0.20;
                const pct = effectiveTotal > 0 ? ((p.plannedValue ?? 0) / effectiveTotal * 100).toFixed(1) : "0.0";
                return (
                  <tr key={p.id} className="opacity-75">
                    <td className="py-1.5">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-[9px] text-[var(--color-warning)]">planned</p>
                      {p.ticker && <p className="font-mono text-[var(--color-text-muted)]">{p.ticker}</p>}
                    </td>
                    <td className="py-1.5">
                      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white"
                        style={{ backgroundColor: ASSET_CLASS_COLORS[p.asset_class] ?? "#94a3b8" }}>
                        {ASSET_CLASSES.find(a => a.value === p.asset_class)?.label ?? p.asset_class}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">{pct}%</td>
                    <td className="py-1.5 text-right">
                      <input type="number" min="0" max="100" step="0.1"
                        value={ov?.ret ?? (defaultReturn * 100).toFixed(2)}
                        onChange={e => setOverrides(prev => ({ ...prev, [p.id]: { ...prev[p.id] ?? { vol: (defaultVol * 100).toFixed(2) }, ret: e.target.value } }))}
                        className={`w-16 text-right bg-transparent border-b focus:outline-none tabular-nums ${ov?.ret ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"}`}
                      />
                      <span className="ml-0.5 text-[var(--color-text-subtle)]">%</span>
                    </td>
                    <td className="py-1.5 text-right">
                      <input type="number" min="0" max="200" step="0.1"
                        value={ov?.vol ?? (defaultVol * 100).toFixed(2)}
                        onChange={e => setOverrides(prev => ({ ...prev, [p.id]: { ...prev[p.id] ?? { ret: (defaultReturn * 100).toFixed(2) }, vol: e.target.value } }))}
                        className={`w-16 text-right bg-transparent border-b focus:outline-none tabular-nums ${ov?.vol ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"}`}
                      />
                      <span className="ml-0.5 text-[var(--color-text-subtle)]">%</span>
                    </td>
                    <td className="py-1.5 pl-3 text-[var(--color-text-muted)] max-w-[260px]">
                      {rationales[p.id] ?? <span className="text-[var(--color-text-subtle)] italic">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-[var(--color-text-subtle)]">
            Values in <span className="text-[var(--color-primary)]">blue</span> are Claude-calibrated or manually overridden. Defaults use investment expected-return + asset-class vol. Edit any cell directly.
          </p>
        </CardContent>
      </Card>

      {/* ── Inner tabs ── */}
      <div className="flex gap-1">
        {(["overview", "risk", "returns", "drawdown"] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors ${activeTab === t ? "bg-[var(--color-surface-raised)] text-[var(--color-text)] border border-[var(--color-border)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* ════════════ OVERVIEW ════════════ */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="End Value" value={fmtShort(endData.total)} sub={`Year ${simYears}`} accent="var(--color-success)" />
            <MetricCard label="Contributed" value={fmtShort(endData.contributions)} sub="future deposits" accent="var(--color-primary)" />
            <MetricCard label="Market Gains" value={`+${fmtShort(Math.max(0, endData.gains))}`} sub={`${((endData.gains / (endData.contributions || 1)) * 100).toFixed(0)}% on deposits`} accent="#f79009" />
            <MetricCard label="CAGR" value={`${cagr}%`} sub={`${totalReturn}% total`} accent="#8b5cf6" />
          </div>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{ensembleResult ? `Portfolio Fan Chart — ${N_PATHS.toLocaleString()} Paths` : "Portfolio Growth"}</CardTitle>
                {ensembleResult && (
                  <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-subtle)]">
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block bg-[var(--color-success)] opacity-40 rounded" />P10–P90</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block bg-[var(--color-success)] opacity-70 rounded" />P25–P75</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block bg-[var(--color-success)] rounded" />P50</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block bg-yellow-400 rounded" />Bull</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block bg-[var(--color-primary)] rounded" />Base</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block bg-[var(--color-danger)] rounded" />Bear</span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {ensembleResult ? (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={ensembleResult.fanData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fanOuter" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.12} />
                        <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="fanInner" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.30} />
                        <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                    <XAxis dataKey="label" tick={CHART_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={fmtShort} tick={CHART_TICK} axisLine={false} tickLine={false} width={52} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v: number, name: string) => {
                        const labels: Record<string, string> = { p10: "P10", p25: "P25", p50: "P50 (median)", p75: "P75", p90: "P90", bull: "Bull scenario", base: "Base scenario", bear: "Bear scenario" };
                        return [fmtShort(v), labels[name] ?? name];
                      }}
                      labelFormatter={l => l || "Start"}
                    />
                    {/* P10-P90 outer band */}
                    <Area type="monotone" dataKey="p10" stroke="none" fill="none" legendType="none" />
                    <Area type="monotone" dataKey="p90" stroke="none" fill="url(#fanOuter)" legendType="none" />
                    {/* P25-P75 inner band */}
                    <Area type="monotone" dataKey="p25" stroke="none" fill="none" legendType="none" />
                    <Area type="monotone" dataKey="p75" stroke="none" fill="url(#fanInner)" legendType="none" />
                    {/* P50 median line */}
                    <Line type="monotone" dataKey="p50" stroke="var(--color-success)" strokeWidth={2} dot={false} name="p50" />
                    {/* Scenario lines */}
                    <Line type="monotone" dataKey="bull" stroke="#eab308" strokeWidth={1} dot={false} strokeDasharray="5 3" name="bull" />
                    <Line type="monotone" dataKey="base" stroke="var(--color-primary)" strokeWidth={1} dot={false} strokeDasharray="5 3" name="base" />
                    <Line type="monotone" dataKey="bear" stroke="var(--color-danger)" strokeWidth={1} dot={false} strokeDasharray="5 3" name="bear" />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fgTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.25} /><stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="fgContrib" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.15} /><stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                    <XAxis dataKey="label" tick={CHART_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={fmtShort} tick={CHART_TICK} axisLine={false} tickLine={false} width={52} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [formatCurrency(v, true), name === "total" ? "Portfolio" : "Contributed"]} labelFormatter={l => l || "Start"} />
                    <Area type="monotone" dataKey="total" stroke="var(--color-success)" strokeWidth={2} fill="url(#fgTotal)" name="total" />
                    <Area type="monotone" dataKey="contributions" stroke="var(--color-primary)" strokeWidth={1.5} fill="url(#fgContrib)" strokeDasharray="4 3" name="contributions" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Year-End Snapshots</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                    <th className="pb-2">Yr</th><th className="pb-2 text-right">Value</th><th className="pb-2 text-right">Contributed</th><th className="pb-2 text-right">Gains</th>
                  </tr></thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {yearSnapshots.map((s, i) => (
                      <tr key={i}>
                        <td className="py-1.5 font-mono font-semibold text-[var(--color-text-muted)]">{i + 1}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums">{fmtShort(s.total)}</td>
                        <td className="py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">{fmtShort(s.contributions)}</td>
                        <td className={`py-1.5 text-right tabular-nums font-semibold ${s.gains >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                          {s.gains >= 0 ? "+" : ""}{fmtShort(s.gains)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Projected Allocation · Yr {simYears}</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2} dataKey="value" stroke="none">
                      {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${formatCurrency(v, true)} · ${((v / totalEndAlloc) * 100).toFixed(1)}%`, ""]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
                  {pieData.map(d => (
                    <span key={d.name} className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                      <span className="w-2 h-2 rounded-sm inline-block" style={{ background: d.color }} />{d.name}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          {milestones.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Milestones</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  {milestones.map((m, i) => (
                    <div key={i} className="text-center min-w-[72px]">
                      <p className="text-sm font-bold font-mono text-[var(--color-primary)]">{m.label}</p>
                      <p className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">at</p>
                      <p className="text-xs font-semibold text-[var(--color-text-muted)]">{m.yearHit} yrs</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Terminal Distribution (same output format as fantasy tab) ── */}
          {ensembleResult && ensembleResult.terminalHistogram.length > 0 && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5">
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
                Monte Carlo Distribution ({N_PATHS.toLocaleString()} paths · Yr {simYears})
              </h3>
              {(() => {
                const totalContributed = monthlyNum * simYears * 12;
                const totalInvested = ensembleResult.terminalStartVal + totalContributed;
                const medianGainVsInvested = ensembleResult.terminalP50 - totalInvested;
                const meanGainVsInvested = ensembleResult.terminalMean - totalInvested;
                return (
                  <>
                    <div className="mb-3 flex gap-4 text-xs text-[var(--color-text-subtle)] border-b border-[var(--color-border)] pb-3">
                      <span>Start: <span className="font-semibold font-mono text-[var(--color-text)]">{fmtShort(ensembleResult.terminalStartVal)}</span></span>
                      <span>+Contributions: <span className="font-semibold font-mono text-[var(--color-text)]">{fmtShort(totalContributed)}</span></span>
                      <span>= Total Invested: <span className="font-semibold font-mono text-[var(--color-text)]">{fmtShort(totalInvested)}</span></span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      {([
                        { label: "Mean",              value: fmtShort(ensembleResult.terminalMean) },
                        { label: "P10",               value: fmtShort(ensembleResult.terminalP10) },
                        { label: "P50 (Median)",      value: fmtShort(ensembleResult.terminalP50) },
                        { label: "P90",               value: fmtShort(ensembleResult.terminalP90) },
                        { label: "95% CI Low",        value: fmtShort(ensembleResult.terminalP2_5) },
                        { label: "95% CI High",       value: fmtShort(ensembleResult.terminalP97_5) },
                        { label: "Prob Loss",         value: `${(ensembleResult.terminalProbLoss * 100).toFixed(1)}%` },
                        { label: "CVaR 5%",           value: fmtShort(ensembleResult.terminalCVaR5) },
                        { label: "Sharpe",            value: ensembleResult.terminalSharpe.toFixed(3) },
                        { label: "Sortino",           value: ensembleResult.terminalSortino.toFixed(3) },
                        { label: "Median vs Invested", value: `${medianGainVsInvested >= 0 ? "+" : ""}${fmtShort(medianGainVsInvested)}` },
                        { label: "Mean vs Invested",   value: `${meanGainVsInvested >= 0 ? "+" : ""}${fmtShort(meanGainVsInvested)}` },
                      ]).map(({ label, value }) => (
                        <div key={label} className="rounded-lg bg-[var(--color-surface)] p-3">
                          <div className="text-xs text-[var(--color-text-subtle)]">{label}</div>
                          <div className="font-mono text-sm font-semibold text-[var(--color-text)]">{value}</div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
              {/* CSS bar histogram — same approach as fantasy tab */}
              <div className="mt-4">
                <div className="mb-1 text-xs text-[var(--color-text-subtle)]">Distribution of Terminal Portfolio Value</div>
                <div className="flex h-24 items-end gap-px overflow-hidden rounded">
                  {(() => {
                    const maxCount = Math.max(...ensembleResult.terminalHistogram.map(b => b.count));
                    return ensembleResult.terminalHistogram.map((bin, i) => {
                      const heightPct = maxCount > 0 ? (bin.count / maxCount) * 100 : 0;
                      const isLoss = bin.binStart < ensembleResult.terminalStartVal;
                      return (
                        <div
                          key={i}
                          title={`~${fmtShort(bin.binStart)}: ${bin.count.toLocaleString()} paths`}
                          style={{ height: `${heightPct}%`, flex: 1 }}
                          className={`min-h-px ${isLoss ? "bg-red-500/60" : "bg-[var(--color-primary)]/60"}`}
                        />
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════ RISK ════════════ */}
      {activeTab === "risk" && metrics && (
        <div className="flex flex-col gap-4">
          <SectionLabel>Risk-Adjusted Return Ratios</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="Sharpe" value={fmtR(metrics.sharpe)} accent={metrics.sharpe > 0.5 ? "var(--color-success)" : "#f79009"} tooltip="(Return − Rf) / Volatility. >1.0 excellent, >0.5 good." />
            <MetricCard label="Sortino" value={fmtR(metrics.sortino)} accent={metrics.sortino > 1 ? "var(--color-success)" : "#f79009"} tooltip="Like Sharpe but only penalizes downside vol. Sortino > Sharpe = positive upside skew." />
            <MetricCard label="Calmar" value={fmtR(metrics.calmar)} accent="var(--color-primary)" tooltip="Annualized return / |Max Drawdown|. >1.0 is strong." />
            <MetricCard label="Treynor" value={fmtR(metrics.treynor)} accent="#8b5cf6" tooltip="Excess return per unit of systematic (beta) risk." />
          </div>
          <SectionLabel>Benchmark Sensitivity (vs S&amp;P 500)</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="Beta" value={fmtR(metrics.beta)} sub="vs S&P 500" tooltip="β=1 moves with market. <1 is defensive." />
            <MetricCard label="Alpha (ann.)" value={`${metrics.alpha >= 0 ? "+" : ""}${metrics.alpha.toFixed(2)}%`} accent={metrics.alpha >= 0 ? "var(--color-success)" : "var(--color-danger)"} tooltip="Return beyond what beta exposure explains (CAPM)." />
            <MetricCard label="Info Ratio" value={fmtR(metrics.infoRatio)} accent="#0ea5e9" tooltip="Excess return / tracking error. >0.5 is notable." />
            <MetricCard label="Tracking Error" value={fmtPct(metrics.trackingError)} tooltip="Std dev of monthly returns vs benchmark." />
          </div>
          <SectionLabel>Tail Risk &amp; Downside</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="VaR (95%)" value={fmtPct(metrics.var95)} accent="var(--color-danger)" tooltip="5th-percentile monthly return — your bad-month floor." />
            <MetricCard label="CVaR (95%)" value={fmtPct(metrics.cvar95)} accent="var(--color-danger)" tooltip="Average loss in the worst 5% of months." />
            <MetricCard label="Max Drawdown" value={fmtPct(metrics.maxDD)} accent="var(--color-danger)" tooltip="Largest simulated peak-to-trough decline." />
            <MetricCard label="Ann. Volatility" value={fmtPct(metrics.annualVol)} accent="#f79009" />
          </div>
          <SectionLabel>Advanced</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="Ulcer Index" value={(metrics.ulcer * 100).toFixed(2) + "%"} accent="#ec4899" tooltip="RMS of drawdowns — captures depth and duration." />
            <MetricCard label="UPI (Martin)" value={fmtR(metrics.upi)} accent="#0ea5e9" tooltip="Excess return / Ulcer Index." />
            <MetricCard label="Gain / Loss" value={fmtR(metrics.gainLossRatio)} accent={metrics.gainLossRatio > 1 ? "var(--color-success)" : "#f79009"} tooltip="Avg gain / |avg loss|. >1 means wins outsize losses." />
            <MetricCard label="Skew / Kurt" value={`${metrics.skewness.toFixed(2)} / ${metrics.kurtosis.toFixed(2)}`} tooltip="Positive skew = fat right tail. Positive kurtosis = fat tails." />
          </div>
          <SectionLabel>Return Profile</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="Ann. Return" value={fmtPct(metrics.annualizedReturn)} accent="var(--color-success)" />
            <MetricCard label="Win Rate" value={`${(metrics.winRate * 100).toFixed(0)}%`} sub="positive months" accent="var(--color-success)" />
            <MetricCard label="Best Month" value={`+${(metrics.bestMonth * 100).toFixed(2)}%`} accent="var(--color-success)" />
            <MetricCard label="Worst Month" value={`${(metrics.worstMonth * 100).toFixed(2)}%`} accent="var(--color-danger)" />
          </div>
        </div>
      )}

      {/* ════════════ RETURNS ════════════ */}
      {activeTab === "returns" && metrics && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Monthly Return Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={metrics.distData} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                  <XAxis dataKey="return_pct" tick={CHART_TICK} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
                  <YAxis tick={CHART_TICK} axisLine={false} tickLine={false} />
                  <ReferenceLine x={0} stroke="var(--color-border)" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, _: string, p: { payload?: { return_pct: number } }) => [`${v} month${v !== 1 ? "s" : ""}`, `${p.payload?.return_pct ?? 0}% return`]} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {metrics.distData.map((e, i) => <Cell key={i} fill={e.return_pct >= 0 ? "var(--color-success)" : "var(--color-danger)"} fillOpacity={0.6} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Rolling 12-Month Sharpe &amp; Sortino</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={rollingCombined} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                  <XAxis dataKey="label" tick={CHART_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={CHART_TICK} axisLine={false} tickLine={false} />
                  <ReferenceLine y={0} stroke="var(--color-border)" />
                  <ReferenceLine y={1} stroke="var(--color-primary)" strokeDasharray="4 4" strokeOpacity={0.4} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [v.toFixed(2), name === "sharpe" ? "Sharpe" : "Sortino"]} />
                  <Line type="monotone" dataKey="sharpe" stroke="var(--color-primary)" strokeWidth={1.5} dot={false} name="sharpe" />
                  <Line type="monotone" dataKey="sortino" stroke="var(--color-success)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="sortino" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ════════════ DRAWDOWN ════════════ */}
      {activeTab === "drawdown" && metrics && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="Max Drawdown" value={fmtPct(metrics.maxDD)} accent="var(--color-danger)" />
            <MetricCard label="Calmar" value={fmtR(metrics.calmar)} accent="var(--color-primary)" />
            <MetricCard label="Ulcer Index" value={(metrics.ulcer * 100).toFixed(2) + "%"} accent="#ec4899" />
            <MetricCard label="CVaR (95%)" value={fmtPct(metrics.cvar95)} accent="var(--color-danger)" />
          </div>
          <Card>
            <CardHeader><CardTitle>Drawdown from Peak (%)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={270}>
                <AreaChart data={ddChartData} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fgDD" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-danger)" stopOpacity={0.2} /><stop offset="100%" stopColor="var(--color-danger)" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                  <XAxis dataKey="label" tick={CHART_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={CHART_TICK} axisLine={false} tickLine={false} domain={["dataMin", 0]} />
                  <ReferenceLine y={0} stroke="var(--color-border)" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(2)}%`, "Drawdown"]} labelFormatter={l => `Month ${l}`} />
                  <Area type="monotone" dataKey="drawdown" stroke="var(--color-danger)" strokeWidth={1.5} fill="url(#fgDD)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ════════════ CLAUDE SCENARIO ANALYSIS ════════════ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bot size={15} className="text-[var(--color-primary)]" />
              <CardTitle>Strategy Thesis</CardTitle>
            </div>
            <button
              onClick={() => void handleScenario()}
              disabled={analyzingScenario || !hasApiKey || !metrics}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Sparkles size={12} />
              {analyzingScenario ? "Analyzing…" : scenario ? "Re-run thesis" : "Run thesis"}
            </button>
          </div>
        </CardHeader>
        {(scenario || analyzingScenario || scenarioError) && (
          <CardContent>
            {scenarioError && (
              <div className="rounded bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)] mb-3">{scenarioError}</div>
            )}
            {(scenario || analyzingScenario) && (
              scenario ? (
                <div className="prose-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MdComponents}>{scenario}</ReactMarkdown>
                </div>
              ) : (
                <span className="inline-flex gap-1 text-[var(--color-text-muted)]">
                  <span className="animate-bounce">·</span>
                  <span className="animate-bounce [animation-delay:0.1s]">·</span>
                  <span className="animate-bounce [animation-delay:0.2s]">·</span>
                </span>
              )
            )}
            <div ref={scenarioEndRef} />
          </CardContent>
        )}
      </Card>

      <p className="text-[10px] text-[var(--color-text-subtle)] text-center leading-relaxed">
        Single-path Monte Carlo (seed 42) · σ×0.5 dampening · benchmark = S&amp;P 500 proxy (9.5% / 17% vol) · not financial advice.
      </p>
    </div>
  );
}
