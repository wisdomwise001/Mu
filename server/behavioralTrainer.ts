/**
 * Behavioral Training System — 8-Stage Hierarchical Football Intelligence Pipeline
 *
 * Philosophy: Models do NOT learn "2-1 happened".
 * They learn: "This match had the behavioral, tactical, statistical,
 * and contextual identity of a natural 2-1 match."
 *
 * Stage 1 — Data Completeness Scoring (weighted training filter)
 * Stage 2 — Feature Engineering (Expectation + Behavioral + Contextual)
 * Stage 3 — Bucket Family Training (6 families)
 * Stage 4 — True vs False Bucket Separation (alignment-based weights)
 * Stage 5 — Contextual Bucket Training (each bucket learns behavior identity)
 * Stage 6 — Hierarchical Model Training (Winner → Goals → BTTS → Tempo → Family → Score)
 * Stage 7 — Contradiction Detection (rule-based impossible combination penalties)
 * Stage 8 — Confidence Calibration (completeness × consistency × odds alignment)
 */

import db from "./db";
import { BUCKET_FAMILIES, type BucketFamilyId } from "./bucketFamilyClassifier";

// ── Behavioral Feature Names ──────────────────────────────────────────────────
export const BEHAVIORAL_FEATURES: string[] = [
  // Statistical (raw averages)
  "home_avg_goals_scored", "home_avg_goals_conceded", "home_avg_xg",
  "home_avg_total_shots", "home_avg_shots_on_target", "home_avg_possession", "home_avg_big_chances",
  "away_avg_goals_scored", "away_avg_goals_conceded", "away_avg_xg",
  "away_avg_total_shots", "away_avg_shots_on_target", "away_avg_possession", "away_avg_big_chances",
  // Form strengths
  "home_form_strength", "home_scoring_strength", "home_defending_strength", "home_form_points", "home_clean_sheets",
  "away_form_strength", "away_scoring_strength", "away_defending_strength", "away_form_points", "away_clean_sheets",
  // Phase/role
  "home_phase_attack", "home_phase_defensive", "away_phase_attack", "away_phase_defensive",
  // PRE-MATCH EXPECTATION (computed, not raw DB cols)
  "fair_home_win_prob", "fair_draw_prob", "fair_away_win_prob",
  "home_expected_goals", "away_expected_goals", "expected_total_goals", "expected_goal_diff",
  "btts_expectation", "tempo_score",
  // BEHAVIORAL (computed behavioral patterns)
  "home_protect_lead_index", "home_comeback_index", "home_collapse_risk", "home_aggression_index",
  "away_protect_lead_index", "away_comeback_index", "away_collapse_risk", "away_aggression_index",
  // CONTEXTUAL
  "ctx_is_knockout", "ctx_motivation_asymmetry", "ctx_fatigue_asymmetry",
  "ctx_home_conservative_coach", "ctx_away_conservative_coach",
  "ctx_odds_gap", "ctx_stage_modifier",
  "home_injury_impact", "away_injury_impact",
];

const D = BEHAVIORAL_FEATURES.length;

// ── Helper ────────────────────────────────────────────────────────────────────
function num(v: any, def = 0): number {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return isNaN(n) ? def : n;
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Stage 1: Data Completeness Scoring ───────────────────────────────────────
// Returns 0-1 score. Used as a training weight multiplier.
export function computeCompleteness(row: any): number {
  const checks = [
    row.home_avg_xg, row.home_avg_goals_scored, row.home_avg_goals_conceded,
    row.home_avg_total_shots, row.home_avg_possession,
    row.away_avg_xg, row.away_avg_goals_scored, row.away_avg_goals_conceded,
    row.away_avg_total_shots, row.away_avg_possession,
    row.home_h1_avg_possession, row.home_h1_avg_total_shots,
    row.away_h1_avg_possession, row.away_h1_avg_total_shots,
    row.home_form_strength, row.away_form_strength,
    row.home_scoring_strength, row.away_scoring_strength,
    row.home_defending_strength, row.away_defending_strength,
  ];
  const presentCount = checks.filter((v) => v !== null && v !== undefined && v !== 0).length;
  const base = presentCount / checks.length;

  // Bonus for rich contextual data
  const hasOdds = num(row.ctx_odds_home_win) > 1 && num(row.ctx_odds_away_win) > 1;
  const hasHalfStats =
    num(row.home_h1_avg_goals_scored) > 0 || num(row.home_h2_avg_goals_scored) > 0;
  const hasPhase = num(row.home_phase_attack) > 0;

  const bonus = (hasOdds ? 0.1 : 0) + (hasHalfStats ? 0.05 : 0) + (hasPhase ? 0.05 : 0);
  return clamp(base + bonus);
}

// ── Stage 2: Feature Engineering ─────────────────────────────────────────────
export function buildBehavioralVector(row: any): number[] {
  const hGS   = num(row.home_avg_goals_scored);
  const hGC   = num(row.home_avg_goals_conceded);
  const hXg   = num(row.home_avg_xg);
  const hShot = num(row.home_avg_total_shots);
  const hSoT  = num(row.home_avg_shots_on_target);
  const hPoss = num(row.home_avg_possession, 50);
  const hBC   = num(row.home_avg_big_chances);
  const aGS   = num(row.away_avg_goals_scored);
  const aGC   = num(row.away_avg_goals_conceded);
  const aXg   = num(row.away_avg_xg);
  const aShot = num(row.away_avg_total_shots);
  const aSoT  = num(row.away_avg_shots_on_target);
  const aPoss = num(row.away_avg_possession, 50);
  const aBC   = num(row.away_avg_big_chances);

  const hFS   = num(row.home_form_strength);
  const hSS   = num(row.home_scoring_strength);
  const hDS   = num(row.home_defending_strength);
  const hFP   = num(row.home_form_points);
  const hCS   = num(row.home_clean_sheets);
  const aFS   = num(row.away_form_strength);
  const aSS   = num(row.away_scoring_strength);
  const aDS   = num(row.away_defending_strength);
  const aFP   = num(row.away_form_points);
  const aCS   = num(row.away_clean_sheets);

  const hPA   = num(row.home_phase_attack);
  const hPD   = num(row.home_phase_defensive);
  const aPA   = num(row.away_phase_attack);
  const aPD   = num(row.away_phase_defensive);

  const hM    = num(row.home_matches_analyzed, 15);
  const aM    = num(row.away_matches_analyzed, 15);

  // GSRM / SSBI behavioral indicators
  const hEri  = num(row.home_gsrm_eri);  // comeback resilience
  const aEri  = num(row.away_gsrm_eri);
  const hZzb  = num(row.home_ssbi_zzb);  // zero-zero breakability / collapse risk
  const aZzb  = num(row.away_ssbi_zzb);

  // Context
  const ctxKO   = num(row.ctx_is_knockout);
  const ctxHMot = num(row.ctx_home_motivation);
  const ctxAMot = num(row.ctx_away_motivation);
  const ctxMAsm = num(row.ctx_motivation_asymmetry);
  const ctxHFat = num(row.ctx_home_fatigue_index);
  const ctxAFat = num(row.ctx_away_fatigue_index);
  const ctxFAsm = num(row.ctx_fatigue_asymmetry);
  const ctxHCon = num(row.ctx_home_conservative_coach);
  const ctxACon = num(row.ctx_away_conservative_coach);
  const ctxOGap = num(row.ctx_odds_gap);
  const ctxStgM = num(row.ctx_stage_modifier);
  const hInj   = num(row.home_injury_impact);
  const aInj   = num(row.away_injury_impact);

  const oddsHW  = num(row.ctx_odds_home_win);
  const oddsDr  = num(row.ctx_odds_draw);
  const oddsAW  = num(row.ctx_odds_away_win);

  // ── PRE-MATCH EXPECTATION FEATURES ──────────────────────────────────────

  // 1. Fair odds (remove bookmaker margin/vig)
  let fairH = 0.38, fairD = 0.29, fairA = 0.33;
  if (oddsHW > 1 && oddsDr > 1 && oddsAW > 1) {
    const implH = 1 / oddsHW;
    const implD = 1 / oddsDr;
    const implA = 1 / oddsAW;
    const total = implH + implD + implA;
    fairH = implH / total;
    fairD = implD / total;
    fairA = implA / total;
  } else {
    // Fall back to form-derived probabilities
    const hPower = clamp(hSS * 0.5 + hPA * 0.3 + hFP / 30, 0, 1);
    const aPower = clamp(aSS * 0.5 + aPA * 0.3 + aFP / 30, 0, 1);
    const drawTend = clamp(1 - Math.abs(hPower - aPower) - 0.1, 0, 0.4);
    const total = hPower + aPower + drawTend || 1;
    fairH = hPower / total;
    fairA = aPower / total;
    fairD = drawTend / total;
  }

  // 2. Expected goals
  const hAttackQ  = (hGS * 0.4 + hXg * 0.3 + hBC * 0.2 + hPA * 0.5) / 1.4;
  const aAttackQ  = (aGS * 0.4 + aXg * 0.3 + aBC * 0.2 + aPA * 0.5) / 1.4;
  const hDefWeak  = hGC;
  const aDefWeak  = aGC;
  const hExpG     = clamp((hAttackQ + aDefWeak) / 2 * (1 - hInj * 0.15), 0, 5);
  const aExpG     = clamp((aAttackQ + hDefWeak) / 2 * (1 - aInj * 0.15), 0, 5);
  const totalExpG = hExpG + aExpG;
  const diffExpG  = hExpG - aExpG;

  // 3. BTTS expectation
  const hCSRate  = hCS / Math.max(1, hM);
  const aCSRate  = aCS / Math.max(1, aM);
  const btts     = clamp((1 - aCSRate) * (1 - hCSRate));

  // 4. Tempo expectation (normalized total shots / 25)
  const tempo = clamp((hShot + aShot) / 28);

  // ── BEHAVIORAL FEATURES ───────────────────────────────────────────────────

  // Protect-lead index: how much a team prioritises defending over attacking
  const hPLI = hDS / Math.max(0.1, hSS + 0.01);
  const aPLI = aDS / Math.max(0.1, aSS + 0.01);

  // Comeback index (from GSRM resilience — how well team performs under pressure)
  const hCome = clamp(hEri);
  const aCome = clamp(aEri);

  // Collapse risk (from SSBI — tendency for score-line to break down)
  const hColl = clamp(hZzb);
  const aColl = clamp(aZzb);

  // Aggression index: shot volume relative to defensive exposure
  const hAgg = clamp((hShot * 0.5 + hBC) / Math.max(1, hGC * 2 + 1) / 5);
  const aAgg = clamp((aShot * 0.5 + aBC) / Math.max(1, aGC * 2 + 1) / 5);

  return [
    // Statistical
    hGS, hGC, hXg, hShot, hSoT, hPoss, hBC,
    aGS, aGC, aXg, aShot, aSoT, aPoss, aBC,
    // Form
    hFS, hSS, hDS, hFP, hCS,
    aFS, aSS, aDS, aFP, aCS,
    // Phase
    hPA, hPD, aPA, aPD,
    // Pre-match expectation
    fairH, fairD, fairA,
    hExpG, aExpG, totalExpG, diffExpG,
    btts, tempo,
    // Behavioral
    hPLI, hCome, hColl, hAgg,
    aPLI, aCome, aColl, aAgg,
    // Contextual
    ctxKO, ctxMAsm, ctxFAsm,
    ctxHCon, ctxACon,
    ctxOGap, ctxStgM,
    hInj, aInj,
  ];
}

// ── Score → bucket family mapping ────────────────────────────────────────────
function scoreToFamily(homeGoals: number, awayGoals: number): BucketFamilyId | null {
  const scoreId = `${homeGoals}-${awayGoals}`;
  for (const fam of BUCKET_FAMILIES) {
    if (fam.scores.includes(scoreId)) return fam.id;
  }
  return null;
}

// ── Expected family from pre-match features (Stage 4) ────────────────────────
function expectedFamilyFromFeatures(vec: number[]): BucketFamilyId {
  const idx = (name: string) => BEHAVIORAL_FEATURES.indexOf(name);
  const fairH    = vec[idx("fair_home_win_prob")];
  const fairA    = vec[idx("fair_away_win_prob")];
  const fairD    = vec[idx("fair_draw_prob")];
  const totalExp = vec[idx("expected_total_goals")];
  const btts     = vec[idx("btts_expectation")];
  const hPLI     = vec[idx("home_protect_lead_index")];
  const aPLI     = vec[idx("away_protect_lead_index")];

  if (fairH > 0.55 && totalExp < 2.5 && hPLI > 0.9) return "dominant_home";
  if (fairA > 0.55 && totalExp < 2.5 && aPLI > 0.9) return "dominant_away";
  if (totalExp < 1.5 && fairD > 0.28) return "low_defensive";
  if (totalExp > 4.0 && btts > 0.65) return "chaotic";
  if (totalExp > 2.8 && btts > 0.60) return "open_high";
  if (btts > 0.52) return "balanced_btts";
  if (fairH > 0.48) return "dominant_home";
  if (fairA > 0.48) return "dominant_away";
  return "balanced_btts";
}

// ── Stage 4: Training Weight = Completeness × True-Bucket Alignment ──────────
function computeTrainingWeight(row: any, vec: number[]): number {
  const completeness = computeCompleteness(row);

  // Completeness bands (per user spec)
  let completenessW: number;
  if      (completeness >= 0.90) completenessW = 1.00;
  else if (completeness >= 0.75) completenessW = 0.70;
  else if (completeness >= 0.50) completenessW = 0.40;
  else                           completenessW = 0.00; // exclude

  if (completenessW === 0) return 0;

  const actualFamily  = scoreToFamily(num(row.home_goals), num(row.away_goals));
  const expectedFamily = expectedFamilyFromFeatures(vec);

  let alignmentW: number;
  if (!actualFamily) {
    alignmentW = 0.20; // score not in any defined family (edge case)
  } else if (actualFamily === expectedFamily) {
    alignmentW = 1.00; // TRUE BUCKET — train heavily
  } else {
    // Check if they're adjacent/similar
    const adjacent: Record<BucketFamilyId, BucketFamilyId[]> = {
      low_defensive:  ["balanced_btts"],
      balanced_btts:  ["low_defensive", "open_high", "dominant_home", "dominant_away"],
      open_high:      ["balanced_btts", "chaotic", "dominant_home", "dominant_away"],
      dominant_home:  ["balanced_btts", "open_high"],
      dominant_away:  ["balanced_btts", "open_high"],
      chaotic:        ["open_high"],
    };
    const isAdjacent = adjacent[expectedFamily]?.includes(actualFamily) ?? false;
    alignmentW = isAdjacent ? 0.45 : 0.20; // FALSE BUCKET — reduce weight
  }

  return completenessW * alignmentW;
}

// ── Softmax Logistic Regression ───────────────────────────────────────────────
// K classes, D features, sample weights supported.
// weights stored as flat K×D array (row-major).

interface SoftmaxModel {
  modelType: string;
  classes: string[];
  weights: number[];   // K × D flat
  biases: number[];    // K
  normMean: number[];
  normStd: number[];
  featureNames: string[];
  sampleCount: number;
  trueMatchCount: number;
  trainAccuracy: number;
  trainedAt: string;
}

function softmax(z: number[]): number[] {
  const max = Math.max(...z);
  const exps = z.map((v) => Math.exp(v - max));
  const sum  = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

function normStats(X: number[][]): { mean: number[]; std: number[] } {
  const n = X.length, d = X[0]?.length ?? 0;
  const mean = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  const std  = new Array(d).fill(1);
  for (const row of X) for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2 / Math.max(1, n - 1);
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std };
}

function applyNorm(X: number[][], mean: number[], std: number[]): number[][] {
  return X.map((row) => row.map((v, j) => (v - mean[j]) / (std[j] || 1)));
}

async function trainSoftmax(
  X: number[][],       // N × D normalized
  y: number[],         // N class indices
  w: number[],         // N sample weights
  K: number,           // num classes
  opts: { epochs?: number; lr?: number; l2?: number } = {},
  onEpoch?: (pct: number) => void,
): Promise<{ weights: number[]; biases: number[] }> {
  const epochs = opts.epochs ?? 600;
  const lr     = opts.lr    ?? 0.015;
  const l2     = opts.l2    ?? 1e-4;
  const N = X.length;

  // Adam state: weights K×D, biases K
  const weights = new Array(K * D).fill(0).map(() => (Math.random() - 0.5) * 0.02);
  const biases  = new Array(K).fill(0);
  const mW = new Array(K * D).fill(0), vW = new Array(K * D).fill(0);
  const mB = new Array(K).fill(0),     vB = new Array(K).fill(0);
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;

  for (let epoch = 1; epoch <= epochs; epoch++) {
    const gW = new Array(K * D).fill(0);
    const gB = new Array(K).fill(0);

    for (let i = 0; i < N; i++) {
      if (w[i] === 0) continue;
      const x = X[i];
      const z = new Array(K).fill(0);
      for (let k = 0; k < K; k++) {
        for (let j = 0; j < D; j++) z[k] += weights[k * D + j] * x[j];
        z[k] += biases[k];
      }
      const p  = softmax(z);
      const wi = w[i];

      for (let k = 0; k < K; k++) {
        const delta = (p[k] - (k === y[i] ? 1 : 0)) * wi;
        for (let j = 0; j < D; j++) gW[k * D + j] += delta * x[j];
        gB[k] += delta;
      }
    }

    // L2 regularization
    for (let i = 0; i < K * D; i++) gW[i] += 2 * l2 * weights[i];

    // Adam update
    for (let i = 0; i < K * D; i++) {
      mW[i] = b1 * mW[i] + (1 - b1) * gW[i];
      vW[i] = b2 * vW[i] + (1 - b2) * gW[i] * gW[i];
      const mHat = mW[i] / (1 - Math.pow(b1, epoch));
      const vHat = vW[i] / (1 - Math.pow(b2, epoch));
      weights[i] -= lr * mHat / (Math.sqrt(vHat) + eps);
    }
    for (let k = 0; k < K; k++) {
      mB[k] = b1 * mB[k] + (1 - b1) * gB[k];
      vB[k] = b2 * vB[k] + (1 - b2) * gB[k] * gB[k];
      const mHat = mB[k] / (1 - Math.pow(b1, epoch));
      const vHat = vB[k] / (1 - Math.pow(b2, epoch));
      biases[k] -= lr * mHat / (Math.sqrt(vHat) + eps);
    }

    if (epoch % Math.max(1, Math.floor(epochs / 20)) === 0) {
      onEpoch?.(epoch / epochs);
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  return { weights, biases };
}

function predictClass(vec: number[], model: SoftmaxModel): { classIdx: number; label: string; probs: number[] } {
  const xn = vec.map((v, j) => (v - model.normMean[j]) / (model.normStd[j] || 1));
  const K  = model.classes.length;
  const z  = new Array(K).fill(0);
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < D; j++) z[k] += model.weights[k * D + j] * xn[j];
    z[k] += model.biases[k];
  }
  const probs = softmax(z);
  const classIdx = probs.indexOf(Math.max(...probs));
  return { classIdx, label: model.classes[classIdx], probs };
}

function trainAccuracy(X: number[][], y: number[], model: SoftmaxModel): number {
  let hits = 0;
  const xn = X.map((row) => row.map((v, j) => (v - model.normMean[j]) / (model.normStd[j] || 1)));
  for (let i = 0; i < xn.length; i++) {
    const K = model.classes.length;
    const z = new Array(K).fill(0);
    for (let k = 0; k < K; k++) {
      for (let j = 0; j < D; j++) z[k] += model.weights[k * D + j] * xn[i][j];
      z[k] += model.biases[k];
    }
    const probs    = softmax(z);
    const predIdx  = probs.indexOf(Math.max(...probs));
    if (predIdx === y[i]) hits++;
  }
  return hits / Math.max(1, xn.length);
}

// ── Progress state (module-level, like existing trainers) ────────────────────
export let behavioralTrainingProgress = {
  running: false,
  stage: "",
  progress: 0,
  message: "",
  error: null as string | null,
  stageResults: [] as string[],
};

// ── Main orchestrator ─────────────────────────────────────────────────────────
export async function trainBehavioralModels(): Promise<void> {
  behavioralTrainingProgress = {
    running: true, stage: "Loading", progress: 0, message: "Loading training data...",
    error: null, stageResults: [],
  };

  try {
    // ── STAGE 1: Load all rows ──────────────────────────────────────────────
    const allRows: any[] = db.prepare(`
      SELECT * FROM match_simulations
      WHERE home_goals IS NOT NULL AND away_goals IS NOT NULL
        AND home_avg_xg IS NOT NULL AND away_avg_xg IS NOT NULL
    `).all() as any[];

    behavioralTrainingProgress.progress = 3;
    behavioralTrainingProgress.message = `Loaded ${allRows.length} raw matches`;
    await new Promise<void>((r) => setImmediate(r));

    if (allRows.length < 20) {
      throw new Error(`Need at least 20 stored matches to train. Only ${allRows.length} found — bulk-upload more dates from the Processing tab.`);
    }

    // ── STAGE 2: Feature Engineering ───────────────────────────────────────
    behavioralTrainingProgress.stage = "Feature Engineering";
    behavioralTrainingProgress.progress = 5;
    behavioralTrainingProgress.message = "Computing behavioral + expectation features...";
    await new Promise<void>((r) => setImmediate(r));

    const vecs: number[][] = allRows.map(buildBehavioralVector);

    // ── STAGE 4 (integrated into weight computation): True vs False Buckets ─
    behavioralTrainingProgress.progress = 10;
    behavioralTrainingProgress.message = "Computing training weights (completeness + true/false bucket alignment)...";
    await new Promise<void>((r) => setImmediate(r));

    const weights: number[] = allRows.map((row, i) => computeTrainingWeight(row, vecs[i]));
    const usableMask = weights.map((w) => w > 0);
    const usableCount = usableMask.filter(Boolean).length;
    const trueCount   = allRows.filter((row, i) => {
      if (!usableMask[i]) return false;
      return scoreToFamily(num(row.home_goals), num(row.away_goals)) === expectedFamilyFromFeatures(vecs[i]);
    }).length;

    behavioralTrainingProgress.stageResults.push(
      `Stage 1-4: ${allRows.length} raw → ${usableCount} usable (${trueCount} true-bucket, ${usableCount - trueCount} false/chaos)`
    );

    // Normalize features across ALL usable samples
    const usableVecs = vecs.filter((_, i) => usableMask[i]);
    const { mean, std } = normStats(usableVecs.length > 0 ? usableVecs : vecs);
    const Xall = applyNorm(vecs, mean, std);

    // ── Helper to prepare samples for a specific classification task ─────
    function prepareSamples(
      classLabels: string[],
      getLabel: (row: any) => string | null,
    ): { X: number[][]; y: number[]; sw: number[]; trueMatchCount: number } {
      const X: number[][] = [], y: number[] = [], sw: number[] = [];
      let trueCnt = 0;
      for (let i = 0; i < allRows.length; i++) {
        if (!usableMask[i]) continue;
        const label = getLabel(allRows[i]);
        if (label === null) continue;
        const idx = classLabels.indexOf(label);
        if (idx === -1) continue;
        X.push(Xall[i]);
        y.push(idx);
        sw.push(weights[i]);
        if (weights[i] >= 0.70) trueCnt++;
      }
      return { X, y, sw, trueMatchCount: trueCnt };
    }

    // ── STAGE 6 Model 1: Winner (H/D/A) ───────────────────────────────────
    behavioralTrainingProgress.stage = "Winner Model";
    behavioralTrainingProgress.progress = 15;
    behavioralTrainingProgress.message = "Training Winner model (Home / Draw / Away)...";
    await new Promise<void>((r) => setImmediate(r));

    const winnerClasses = ["H", "D", "A"];
    const { X: Xw, y: yw, sw: sww, trueMatchCount: tW } = prepareSamples(
      winnerClasses,
      (row) => num(row.home_goals) > num(row.away_goals) ? "H" :
               num(row.home_goals) === num(row.away_goals) ? "D" : "A"
    );

    const { weights: wW, biases: bW } = await trainSoftmax(Xw, yw, sww, 3, {}, (pct) => {
      behavioralTrainingProgress.progress = 15 + Math.round(pct * 15);
    });
    const winnerModel: SoftmaxModel = {
      modelType: "winner", classes: winnerClasses, weights: wW, biases: bW,
      normMean: mean, normStd: std, featureNames: BEHAVIORAL_FEATURES,
      sampleCount: Xw.length, trueMatchCount: tW,
      trainAccuracy: 0, trainedAt: new Date().toISOString(),
    };
    winnerModel.trainAccuracy = trainAccuracy(Xw, yw, winnerModel);
    behavioralTrainingProgress.stageResults.push(
      `Winner: ${Xw.length} samples → ${(winnerModel.trainAccuracy * 100).toFixed(1)}% train acc`
    );

    // ── STAGE 6 Model 2: Goal Range (low/medium/high) ─────────────────────
    behavioralTrainingProgress.stage = "Goal Range Model";
    behavioralTrainingProgress.progress = 30;
    behavioralTrainingProgress.message = "Training Goal Range model (Low ≤1 / Medium 2-3 / High 4+)...";
    await new Promise<void>((r) => setImmediate(r));

    const goalRangeClasses = ["low", "medium", "high"];
    const { X: Xg, y: yg, sw: swg, trueMatchCount: tG } = prepareSamples(
      goalRangeClasses,
      (row) => {
        const total = num(row.home_goals) + num(row.away_goals);
        return total <= 1 ? "low" : total <= 3 ? "medium" : "high";
      }
    );

    const { weights: wG, biases: bG } = await trainSoftmax(Xg, yg, swg, 3, {}, (pct) => {
      behavioralTrainingProgress.progress = 30 + Math.round(pct * 10);
    });
    const goalRangeModel: SoftmaxModel = {
      modelType: "goal_range", classes: goalRangeClasses, weights: wG, biases: bG,
      normMean: mean, normStd: std, featureNames: BEHAVIORAL_FEATURES,
      sampleCount: Xg.length, trueMatchCount: tG,
      trainAccuracy: 0, trainedAt: new Date().toISOString(),
    };
    goalRangeModel.trainAccuracy = trainAccuracy(Xg, yg, goalRangeModel);
    behavioralTrainingProgress.stageResults.push(
      `Goal Range: ${Xg.length} samples → ${(goalRangeModel.trainAccuracy * 100).toFixed(1)}% train acc`
    );

    // ── STAGE 6 Model 3: BTTS (yes/no) ────────────────────────────────────
    behavioralTrainingProgress.stage = "BTTS Model";
    behavioralTrainingProgress.progress = 40;
    behavioralTrainingProgress.message = "Training BTTS model (Both Teams To Score)...";
    await new Promise<void>((r) => setImmediate(r));

    const bttsClasses = ["no", "yes"];
    const { X: Xb, y: yb, sw: swb, trueMatchCount: tB } = prepareSamples(
      bttsClasses,
      (row) => (num(row.home_goals) > 0 && num(row.away_goals) > 0) ? "yes" : "no"
    );

    const { weights: wB, biases: bBias } = await trainSoftmax(Xb, yb, swb, 2, {}, (pct) => {
      behavioralTrainingProgress.progress = 40 + Math.round(pct * 10);
    });
    const bttsModel: SoftmaxModel = {
      modelType: "btts", classes: bttsClasses, weights: wB, biases: bBias,
      normMean: mean, normStd: std, featureNames: BEHAVIORAL_FEATURES,
      sampleCount: Xb.length, trueMatchCount: tB,
      trainAccuracy: 0, trainedAt: new Date().toISOString(),
    };
    bttsModel.trainAccuracy = trainAccuracy(Xb, yb, bttsModel);
    behavioralTrainingProgress.stageResults.push(
      `BTTS: ${Xb.length} samples → ${(bttsModel.trainAccuracy * 100).toFixed(1)}% train acc`
    );

    // ── STAGE 6 Model 4: Tempo (slow/balanced/high) ───────────────────────
    behavioralTrainingProgress.stage = "Tempo Model";
    behavioralTrainingProgress.progress = 50;
    behavioralTrainingProgress.message = "Training Match Tempo model (Slow / Balanced / High)...";
    await new Promise<void>((r) => setImmediate(r));

    const tempoClasses = ["slow", "balanced", "high"];
    const { X: Xt, y: yt, sw: swt, trueMatchCount: tT } = prepareSamples(
      tempoClasses,
      (row) => {
        // Derive tempo from total shots proxy
        const shots = num(row.home_avg_total_shots) + num(row.away_avg_total_shots);
        return shots < 18 ? "slow" : shots < 26 ? "balanced" : "high";
      }
    );

    const { weights: wT, biases: bT } = await trainSoftmax(Xt, yt, swt, 3, {}, (pct) => {
      behavioralTrainingProgress.progress = 50 + Math.round(pct * 10);
    });
    const tempoModel: SoftmaxModel = {
      modelType: "tempo", classes: tempoClasses, weights: wT, biases: bT,
      normMean: mean, normStd: std, featureNames: BEHAVIORAL_FEATURES,
      sampleCount: Xt.length, trueMatchCount: tT,
      trainAccuracy: 0, trainedAt: new Date().toISOString(),
    };
    tempoModel.trainAccuracy = trainAccuracy(Xt, yt, tempoModel);
    behavioralTrainingProgress.stageResults.push(
      `Tempo: ${Xt.length} samples → ${(tempoModel.trainAccuracy * 100).toFixed(1)}% train acc`
    );

    // ── STAGE 3+5: Bucket Family Model ────────────────────────────────────
    behavioralTrainingProgress.stage = "Family Model";
    behavioralTrainingProgress.progress = 60;
    behavioralTrainingProgress.message = "Training Bucket Family model (6 behavioral families)...";
    await new Promise<void>((r) => setImmediate(r));

    const familyClasses = BUCKET_FAMILIES.map((f) => f.id);
    const { X: Xf, y: yf, sw: swf, trueMatchCount: tF } = prepareSamples(
      familyClasses,
      (row) => scoreToFamily(num(row.home_goals), num(row.away_goals))
    );

    const { weights: wF, biases: bF } = await trainSoftmax(Xf, yf, swf, 6, {}, (pct) => {
      behavioralTrainingProgress.progress = 60 + Math.round(pct * 12);
    });
    const familyModel: SoftmaxModel = {
      modelType: "family", classes: familyClasses, weights: wF, biases: bF,
      normMean: mean, normStd: std, featureNames: BEHAVIORAL_FEATURES,
      sampleCount: Xf.length, trueMatchCount: tF,
      trainAccuracy: 0, trainedAt: new Date().toISOString(),
    };
    familyModel.trainAccuracy = trainAccuracy(Xf, yf, familyModel);
    behavioralTrainingProgress.stageResults.push(
      `Bucket Family: ${Xf.length} samples → ${(familyModel.trainAccuracy * 100).toFixed(1)}% train acc`
    );

    // ── STAGE 6 Exact Score per Family ────────────────────────────────────
    behavioralTrainingProgress.stage = "Exact Score Models";
    behavioralTrainingProgress.progress = 72;
    behavioralTrainingProgress.message = "Training exact score models per bucket family...";
    await new Promise<void>((r) => setImmediate(r));

    const exactModels: SoftmaxModel[] = [];
    for (let fi = 0; fi < BUCKET_FAMILIES.length; fi++) {
      const fam = BUCKET_FAMILIES[fi];
      const scoreClasses = fam.scores;
      const { X: Xe, y: ye, sw: swe, trueMatchCount: tE } = prepareSamples(
        scoreClasses,
        (row) => {
          const sid = `${num(row.home_goals)}-${num(row.away_goals)}`;
          return fam.scores.includes(sid) ? sid : null;
        }
      );

      if (Xe.length < 5) {
        behavioralTrainingProgress.stageResults.push(
          `Exact [${fam.label}]: skipped (only ${Xe.length} samples — need ≥5)`
        );
        behavioralTrainingProgress.progress = 72 + Math.round((fi + 1) / BUCKET_FAMILIES.length * 20);
        continue;
      }

      const K = scoreClasses.length;
      const { weights: wE, biases: bE } = await trainSoftmax(Xe, ye, swe, K, {
        epochs: 400, lr: 0.018,
      }, () => {});

      const model: SoftmaxModel = {
        modelType: `exact_${fam.id}`, classes: scoreClasses, weights: wE, biases: bE,
        normMean: mean, normStd: std, featureNames: BEHAVIORAL_FEATURES,
        sampleCount: Xe.length, trueMatchCount: tE,
        trainAccuracy: 0, trainedAt: new Date().toISOString(),
      };
      model.trainAccuracy = trainAccuracy(Xe, ye, model);
      exactModels.push(model);
      behavioralTrainingProgress.stageResults.push(
        `Exact [${fam.label}]: ${Xe.length} samples → ${(model.trainAccuracy * 100).toFixed(1)}% train acc`
      );
      behavioralTrainingProgress.progress = 72 + Math.round((fi + 1) / BUCKET_FAMILIES.length * 20);
      await new Promise<void>((r) => setImmediate(r));
    }

    // ── Store all models ──────────────────────────────────────────────────
    behavioralTrainingProgress.stage = "Saving";
    behavioralTrainingProgress.progress = 93;
    behavioralTrainingProgress.message = "Saving all models to database...";
    await new Promise<void>((r) => setImmediate(r));

    const saveModel = (m: SoftmaxModel) => {
      db.prepare(`
        INSERT OR REPLACE INTO engine_behavioral_models
          (model_type, weights, classes, sample_count, true_match_count, train_accuracy, trained_at, feature_names)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        m.modelType,
        JSON.stringify({ weights: m.weights, biases: m.biases, normMean: m.normMean, normStd: m.normStd }),
        JSON.stringify(m.classes),
        m.sampleCount,
        m.trueMatchCount,
        m.trainAccuracy,
        m.trainedAt,
        JSON.stringify(m.featureNames),
      );
    };

    [winnerModel, goalRangeModel, bttsModel, tempoModel, familyModel, ...exactModels].forEach(saveModel);

    behavioralTrainingProgress.progress = 100;
    behavioralTrainingProgress.message = "All behavioral models trained and saved.";
    behavioralTrainingProgress.stageResults.push(
      `Total: ${usableCount} usable matches | ${trueCount} true-bucket | ${exactModels.length} exact-score models`
    );
  } catch (err: any) {
    behavioralTrainingProgress.error = err.message;
    behavioralTrainingProgress.message = `Error: ${err.message}`;
  } finally {
    behavioralTrainingProgress.running = false;
  }
}

// ── Load models from DB ───────────────────────────────────────────────────────
export interface LoadedBehavioralModels {
  winner?: SoftmaxModel;
  goalRange?: SoftmaxModel;
  btts?: SoftmaxModel;
  tempo?: SoftmaxModel;
  family?: SoftmaxModel;
  exactByFamily: Record<string, SoftmaxModel>;
  trainedAt: string | null;
}

export function loadBehavioralModels(): LoadedBehavioralModels {
  const rows: any[] = db.prepare("SELECT * FROM engine_behavioral_models").all() as any[];
  const result: LoadedBehavioralModels = { exactByFamily: {}, trainedAt: null };

  for (const r of rows) {
    try {
      const w = JSON.parse(r.weights);
      const m: SoftmaxModel = {
        modelType: r.model_type,
        classes: JSON.parse(r.classes),
        weights: w.weights,
        biases: w.biases,
        normMean: w.normMean,
        normStd: w.normStd,
        featureNames: JSON.parse(r.feature_names ?? "[]") || BEHAVIORAL_FEATURES,
        sampleCount: r.sample_count,
        trueMatchCount: r.true_match_count ?? 0,
        trainAccuracy: r.train_accuracy,
        trainedAt: r.trained_at,
      };
      if (r.trained_at > (result.trainedAt ?? "")) result.trainedAt = r.trained_at;

      if      (r.model_type === "winner")     result.winner     = m;
      else if (r.model_type === "goal_range") result.goalRange  = m;
      else if (r.model_type === "btts")       result.btts       = m;
      else if (r.model_type === "tempo")      result.tempo      = m;
      else if (r.model_type === "family")     result.family     = m;
      else if (r.model_type.startsWith("exact_")) {
        const famId = r.model_type.replace("exact_", "");
        result.exactByFamily[famId] = m;
      }
    } catch { /* skip malformed */ }
  }
  return result;
}

// ── STAGE 7+8: Behavioral Prediction + Contradiction + Confidence ─────────────
export interface BehavioralPrediction {
  winner:   { label: string; probs: Record<string, number>; confidence: number };
  goalRange:{ label: string; probs: Record<string, number>; confidence: number };
  btts:     { label: string; probs: Record<string, number>; confidence: number };
  tempo:    { label: string; probs: Record<string, number>; confidence: number };
  family:   { label: string; id: string; probs: Record<string, number>; confidence: number };
  exactScores: Array<{
    scoreline: string;
    homeGoals: number;
    awayGoals: number;
    probability: number;
    finalConfidence: number;
    contradictionPenalty: number;
    outcome: string;
  }>;
  contradictions: string[];
  calibratedConfidence: number;
  completenessScore: number;
  trueBucketExpected: string;
  dataSource: string;
}

export function predictBehavioral(row: any, models: LoadedBehavioralModels): BehavioralPrediction | null {
  if (!models.winner && !models.family) return null;

  const vec = buildBehavioralVector(row);
  const completeness = computeCompleteness(row);

  // Helper
  const classify = (model: SoftmaxModel) => {
    const r = predictClass(vec, model);
    const probMap: Record<string, number> = {};
    model.classes.forEach((c, i) => { probMap[c] = Math.round(r.probs[i] * 1000) / 10; });
    return { label: r.label, probs: probMap, confidence: Math.round(Math.max(...r.probs) * 100) };
  };

  const winner    = models.winner    ? classify(models.winner)    : { label: "?", probs: {}, confidence: 0 };
  const goalRange = models.goalRange ? classify(models.goalRange) : { label: "?", probs: {}, confidence: 0 };
  const btts      = models.btts      ? classify(models.btts)      : { label: "?", probs: {}, confidence: 0 };
  const tempo     = models.tempo     ? classify(models.tempo)     : { label: "?", probs: {}, confidence: 0 };
  const familyResult = models.family ? classify(models.family)    : { label: "?", probs: {}, confidence: 0 };

  const familyId = familyResult.label as BucketFamilyId;
  const famDef   = BUCKET_FAMILIES.find((f) => f.id === familyId);
  const family   = { ...familyResult, id: familyId };

  // ── Exact scores from the family-specific model ──────────────────────────
  const exactRaw: BehavioralPrediction["exactScores"] = [];

  if (famDef) {
    const exactModel = models.exactByFamily[familyId];
    if (exactModel) {
      const xn  = vec.map((v, j) => (v - exactModel.normMean[j]) / (exactModel.normStd[j] || 1));
      const K   = exactModel.classes.length;
      const z   = new Array(K).fill(0);
      for (let k = 0; k < K; k++) {
        for (let j = 0; j < D; j++) z[k] += exactModel.weights[k * D + j] * xn[j];
        z[k] += exactModel.biases[k];
      }
      const probs = softmax(z);

      exactModel.classes.forEach((scoreId, k) => {
        const [hg, ag] = scoreId.split("-").map(Number);
        exactRaw.push({
          scoreline: scoreId,
          homeGoals: hg,
          awayGoals: ag,
          probability: probs[k],
          finalConfidence: 0, // computed below
          contradictionPenalty: 0,
          outcome: hg > ag ? "Home Win" : hg === ag ? "Draw" : "Away Win",
        });
      });
    } else {
      // Fallback: uniform over family scores
      famDef.scores.forEach((scoreId) => {
        const [hg, ag] = scoreId.split("-").map(Number);
        exactRaw.push({
          scoreline: scoreId, homeGoals: hg, awayGoals: ag,
          probability: 1 / famDef.scores.length,
          finalConfidence: 0, contradictionPenalty: 0,
          outcome: hg > ag ? "Home Win" : hg === ag ? "Draw" : "Away Win",
        });
      });
    }
  }

  // ── STAGE 7: Contradiction Detection ─────────────────────────────────────
  const contradictions: string[] = [];
  const bttsProb      = (btts.probs["yes"] ?? 0) / 100;
  const overGoalProb  = (goalRange.probs["high"] ?? 0) / 100;
  const lowGoalProb   = (goalRange.probs["low"] ?? 0) / 100;
  const winnerLabel   = winner.label;

  // Apply contradiction penalties to exact scores
  exactRaw.forEach((sc) => {
    let penalty = 0;
    const isZeroZero = sc.homeGoals === 0 && sc.awayGoals === 0;
    const isBtts     = sc.homeGoals > 0 && sc.awayGoals > 0;
    const isHighScoring = sc.homeGoals + sc.awayGoals >= 4;
    const isLowScoring  = sc.homeGoals + sc.awayGoals <= 1;

    // 0-0 vs high BTTS expectation
    if (isZeroZero && bttsProb > 0.65) {
      penalty += 0.45;
      if (!contradictions.includes("BTTS strongly expected — 0-0 heavily penalised"))
        contradictions.push("BTTS strongly expected — 0-0 heavily penalised");
    }
    // BTTS required score when low-goal predicted
    if (isBtts && lowGoalProb > 0.65 && sc.homeGoals + sc.awayGoals >= 3) {
      penalty += 0.25;
    }
    // High-scoring when low-goal predicted
    if (isHighScoring && lowGoalProb > 0.60) {
      penalty += 0.40;
      if (!contradictions.includes("Low goals expected — high-scoring scorelines penalised"))
        contradictions.push("Low goals expected — high-scoring scorelines penalised");
    }
    // Low-scoring when high-goal predicted
    if (isLowScoring && overGoalProb > 0.50) {
      penalty += 0.30;
      if (!contradictions.includes("High-goal match expected — 0/1-goal scores penalised"))
        contradictions.push("High-goal match expected — 0/1-goal scores penalised");
    }
    // Winner direction mismatch
    if (winnerLabel === "H" && winner.confidence > 65 && sc.awayGoals > sc.homeGoals) {
      penalty += 0.35;
    }
    if (winnerLabel === "A" && winner.confidence > 65 && sc.homeGoals > sc.awayGoals) {
      penalty += 0.35;
    }
    if (winnerLabel === "D" && winner.confidence > 70 && sc.homeGoals !== sc.awayGoals) {
      penalty += 0.25;
    }

    sc.contradictionPenalty = Math.min(0.85, penalty);
  });

  // ── STAGE 8: Confidence Calibration ──────────────────────────────────────
  // Calibrate final confidence using: completeness × family_confidence × (1 - contradiction)
  // Then normalize so probabilities sum to 1.

  const totalExpG = vec[BEHAVIORAL_FEATURES.indexOf("expected_total_goals")];
  const trueBucketExpected = expectedFamilyFromFeatures(vec);
  const familyAlignBonus = family.id === trueBucketExpected ? 1.15 : 0.85;

  exactRaw.forEach((sc) => {
    const rawP = sc.probability * (1 - sc.contradictionPenalty);
    // Multiply by completeness, family support, and alignment bonus
    sc.finalConfidence = rawP * completeness * (familyResult.confidence / 100) * familyAlignBonus;
  });

  const totalFinal = exactRaw.reduce((s, sc) => s + sc.finalConfidence, 0) || 1;
  exactRaw.forEach((sc) => {
    sc.finalConfidence = Math.round((sc.finalConfidence / totalFinal) * 1000) / 10;
  });

  exactRaw.sort((a, b) => b.finalConfidence - a.finalConfidence);

  // Overall calibrated confidence
  const calibrated = Math.round(
    completeness * 0.3 +
    (familyResult.confidence / 100) * 0.3 +
    (winner.confidence / 100) * 0.2 +
    (btts.confidence / 100) * 0.1 +
    (goalRange.confidence / 100) * 0.1
  ) * 100;

  return {
    winner, goalRange, btts, tempo, family,
    exactScores: exactRaw,
    contradictions,
    calibratedConfidence: Math.min(99, calibrated),
    completenessScore: Math.round(completeness * 100),
    trueBucketExpected,
    dataSource: (row as any)._dataSource ?? "live",
  };
}
