import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "data/matches.db");
const db = new Database(DB_PATH);

// ── Score Buckets ─────────────────────────────────────────────────────────────
// 25 independent buckets — each a unique (homeGoals, awayGoals) scoreline.
// signedDiff = homeGoals - awayGoals (positive → home leads, negative → away leads).
// Splitting symmetric pairs like "2-1 / 1-2" into separate models lets the trainer
// learn the directional signal (home-vs-away advantage) rather than treating them
// as interchangeable.
export interface ScoreBucket {
  id: string;
  label: string;
  scores: [number, number][];
  homeGoals: number;
  awayGoals: number;
  sum: number;
  signedDiff: number;
  absDiff: number; // kept for backward-compat with old stored models
}

export const SCORE_BUCKETS: ScoreBucket[] = [
  { id: "0-0", label: "0-0", scores: [[0,0]], homeGoals:0, awayGoals:0, sum:0, signedDiff: 0, absDiff:0 },
  { id: "1-0", label: "1-0", scores: [[1,0]], homeGoals:1, awayGoals:0, sum:1, signedDiff: 1, absDiff:1 },
  { id: "0-1", label: "0-1", scores: [[0,1]], homeGoals:0, awayGoals:1, sum:1, signedDiff:-1, absDiff:1 },
  { id: "1-1", label: "1-1", scores: [[1,1]], homeGoals:1, awayGoals:1, sum:2, signedDiff: 0, absDiff:0 },
  { id: "2-0", label: "2-0", scores: [[2,0]], homeGoals:2, awayGoals:0, sum:2, signedDiff: 2, absDiff:2 },
  { id: "0-2", label: "0-2", scores: [[0,2]], homeGoals:0, awayGoals:2, sum:2, signedDiff:-2, absDiff:2 },
  { id: "2-1", label: "2-1", scores: [[2,1]], homeGoals:2, awayGoals:1, sum:3, signedDiff: 1, absDiff:1 },
  { id: "1-2", label: "1-2", scores: [[1,2]], homeGoals:1, awayGoals:2, sum:3, signedDiff:-1, absDiff:1 },
  { id: "2-2", label: "2-2", scores: [[2,2]], homeGoals:2, awayGoals:2, sum:4, signedDiff: 0, absDiff:0 },
  { id: "3-0", label: "3-0", scores: [[3,0]], homeGoals:3, awayGoals:0, sum:3, signedDiff: 3, absDiff:3 },
  { id: "0-3", label: "0-3", scores: [[0,3]], homeGoals:0, awayGoals:3, sum:3, signedDiff:-3, absDiff:3 },
  { id: "3-1", label: "3-1", scores: [[3,1]], homeGoals:3, awayGoals:1, sum:4, signedDiff: 2, absDiff:2 },
  { id: "1-3", label: "1-3", scores: [[1,3]], homeGoals:1, awayGoals:3, sum:4, signedDiff:-2, absDiff:2 },
  { id: "3-2", label: "3-2", scores: [[3,2]], homeGoals:3, awayGoals:2, sum:5, signedDiff: 1, absDiff:1 },
  { id: "2-3", label: "2-3", scores: [[2,3]], homeGoals:2, awayGoals:3, sum:5, signedDiff:-1, absDiff:1 },
  { id: "3-3", label: "3-3", scores: [[3,3]], homeGoals:3, awayGoals:3, sum:6, signedDiff: 0, absDiff:0 },
  { id: "4-0", label: "4-0", scores: [[4,0]], homeGoals:4, awayGoals:0, sum:4, signedDiff: 4, absDiff:4 },
  { id: "0-4", label: "0-4", scores: [[0,4]], homeGoals:0, awayGoals:4, sum:4, signedDiff:-4, absDiff:4 },
  { id: "4-1", label: "4-1", scores: [[4,1]], homeGoals:4, awayGoals:1, sum:5, signedDiff: 3, absDiff:3 },
  { id: "1-4", label: "1-4", scores: [[1,4]], homeGoals:1, awayGoals:4, sum:5, signedDiff:-3, absDiff:3 },
  { id: "4-2", label: "4-2", scores: [[4,2]], homeGoals:4, awayGoals:2, sum:6, signedDiff: 2, absDiff:2 },
  { id: "2-4", label: "2-4", scores: [[2,4]], homeGoals:2, awayGoals:4, sum:6, signedDiff:-2, absDiff:2 },
  { id: "4-3", label: "4-3", scores: [[4,3]], homeGoals:4, awayGoals:3, sum:7, signedDiff: 1, absDiff:1 },
  { id: "3-4", label: "3-4", scores: [[3,4]], homeGoals:3, awayGoals:4, sum:7, signedDiff:-1, absDiff:1 },
  { id: "4-4", label: "4-4", scores: [[4,4]], homeGoals:4, awayGoals:4, sum:8, signedDiff: 0, absDiff:0 },
];

export function classifyBucket(homeGoals: number, awayGoals: number): ScoreBucket | null {
  return SCORE_BUCKETS.find(
    (b) => b.homeGoals === homeGoals && b.awayGoals === awayGoals
  ) ?? null;
}

// ── Feature names ─────────────────────────────────────────────────────────────
// Must match DB column names exactly (used during training AND prediction).
// HMI = Hidden Match Identity verification layer — derived features that capture
// behavioral identity (chaos vs dominance, pressure, possession asymmetry, etc.)
// so the model can distinguish surface-similar but fundamentally different matches.
export const TRAINER_FEATURES: string[] = [
  // ── Home full-match stats ────────────────────────────────────────────────────
  "home_avg_xg",
  "home_avg_goals_scored",
  "home_avg_goals_conceded",
  "home_avg_big_chances",
  "home_avg_total_shots",
  "home_avg_shots_on_target",
  "home_avg_possession",
  // ── Away full-match stats ────────────────────────────────────────────────────
  "away_avg_xg",
  "away_avg_goals_scored",
  "away_avg_goals_conceded",
  "away_avg_big_chances",
  "away_avg_total_shots",
  "away_avg_shots_on_target",
  "away_avg_possession",
  // ── Per-half home ────────────────────────────────────────────────────────────
  "home_h1_avg_goals_scored",
  "home_h1_avg_xg",
  "home_h1_avg_total_shots",
  "home_h2_avg_goals_scored",
  "home_h2_avg_xg",
  "home_h2_avg_total_shots",
  // ── Per-half away ────────────────────────────────────────────────────────────
  "away_h1_avg_goals_scored",
  "away_h1_avg_xg",
  "away_h1_avg_total_shots",
  "away_h2_avg_goals_scored",
  "away_h2_avg_xg",
  "away_h2_avg_total_shots",
  // ── Form & strength ──────────────────────────────────────────────────────────
  "home_form_strength",
  "home_scoring_strength",
  "home_defending_strength",
  "home_form_points",
  "home_clean_sheets",
  "away_form_strength",
  "away_scoring_strength",
  "away_defending_strength",
  "away_form_points",
  "away_clean_sheets",
  // ── Phase/role strengths ─────────────────────────────────────────────────────
  "home_phase_attack",
  "home_phase_defensive",
  "away_phase_attack",
  "away_phase_defensive",
  // ── Injury impact ────────────────────────────────────────────────────────────
  "home_injury_impact",
  "away_injury_impact",
  // ── Match-day context (half-context endpoint) ─────────────────────────────────
  "ctx_is_knockout",
  "ctx_is_second_leg",
  "ctx_agg_lead_goals",
  "ctx_trailing_needs_goals",
  "ctx_home_motivation",
  "ctx_away_motivation",
  "ctx_motivation_asymmetry",
  "ctx_home_fatigue_index",
  "ctx_away_fatigue_index",
  "ctx_fatigue_asymmetry",
  "ctx_home_avg_first_sub",
  "ctx_away_avg_first_sub",
  "ctx_home_late_subs_rate",
  "ctx_away_late_subs_rate",
  "ctx_home_conservative_coach",
  "ctx_away_conservative_coach",
  "ctx_style_clash_weight",
  "ctx_odds_home_win",
  "ctx_odds_draw",
  "ctx_odds_away_win",
  "ctx_odds_gap",
  "ctx_stage_modifier",
  "ctx_signal_first_weight",
  "ctx_signal_second_weight",
  "ctx_signal_draw_weight",
  // ── HMI: Hidden Match Identity verification features ──────────────────────────
  // Derived at feature-build time from raw stats above.
  // These are NOT stored separately in the DB; they are computed on-the-fly.
  "hmi_chaos_index",          // total shots / max(1, total goals) — high = wasteful/chaotic
  "hmi_dominance_quality",    // (home attack - away defense) - (away attack - home defense)
  "hmi_possession_asymmetry", // |home possession - away possession|
  "hmi_form_momentum",        // home form strength - away form strength
  "hmi_pressure_factor",      // is_knockout + |motivation_asymmetry| composite
  "hmi_conversion_efficiency",// total shots on target / max(1, total shots)
];

function asNumber(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// ── Feature vector builder ───────────────────────────────────────────────────
// For HMI features, the last 6 are computed from earlier columns in the row.
export function buildFeatureVector(row: Record<string, any>): number[] {
  const base = TRAINER_FEATURES.slice(0, TRAINER_FEATURES.length - 6).map((f) => asNumber(row[f]));

  // Compute HMI features from base stats
  const homeShots       = asNumber(row.home_avg_total_shots);
  const awayShots       = asNumber(row.away_avg_total_shots);
  const homeSoT         = asNumber(row.home_avg_shots_on_target);
  const awaySoT         = asNumber(row.away_avg_shots_on_target);
  const homeGoalsSc     = asNumber(row.home_avg_goals_scored);
  const awayGoalsSc     = asNumber(row.away_avg_goals_scored);
  const homePoss        = asNumber(row.home_avg_possession);
  const awayPoss        = asNumber(row.away_avg_possession);
  const homeFormStr     = asNumber(row.home_form_strength);
  const awayFormStr     = asNumber(row.away_form_strength);
  const homeScoreStr    = asNumber(row.home_scoring_strength);
  const awayScoreStr    = asNumber(row.away_scoring_strength);
  const homeDefStr      = asNumber(row.home_defending_strength);
  const awayDefStr      = asNumber(row.away_defending_strength);
  const isKnockout      = asNumber(row.ctx_is_knockout);
  const motivAsym       = asNumber(row.ctx_motivation_asymmetry);

  const totalShots  = homeShots + awayShots;
  const totalGoals  = homeGoalsSc + awayGoalsSc;
  const totalSoT    = homeSoT + awaySoT;

  const hmi_chaos_index           = totalShots / Math.max(1, totalGoals) - 3;
  const hmi_dominance_quality     = (homeScoreStr - awayDefStr) - (awayScoreStr - homeDefStr);
  const hmi_possession_asymmetry  = Math.abs(homePoss - awayPoss);
  const hmi_form_momentum         = homeFormStr - awayFormStr;
  const hmi_pressure_factor       = isKnockout + Math.abs(motivAsym);
  const hmi_conversion_efficiency = totalSoT / Math.max(1, totalShots);

  return [
    ...base,
    hmi_chaos_index,
    hmi_dominance_quality,
    hmi_possession_asymmetry,
    hmi_form_momentum,
    hmi_pressure_factor,
    hmi_conversion_efficiency,
  ];
}

// ── Stats helpers ────────────────────────────────────────────────────────────
function computeNorm(X: number[][]): { mean: number[]; std: number[] } {
  if (X.length === 0) return { mean: [], std: [] };
  const n = X.length;
  const d = X[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  for (const row of X) for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / Math.max(1, n - 1)) || 1;
  return { mean, std };
}

function normalize(X: number[][], mean: number[], std: number[]): number[][] {
  return X.map((row) => row.map((v, j) => (v - mean[j]) / (std[j] || 1)));
}

function dot(w: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * x[i];
  return s;
}

// ── Trainer ──────────────────────────────────────────────────────────────────
export interface TrainOptions {
  bucketId: string;
  epochs?: number;
  learningRate?: number;
  l2?: number;
  negPenalty?: number;
  margin?: number;
  maxNegSamples?: number;
  confusableFocus?: number;
  onProgress?: (pct: number, msg: string) => void;
}

export interface TrainedOutcomeModel {
  bucket: string;
  weightsSum: number[];
  weightsDiff: number[];
  biasSum: number;
  biasDiff: number;
  normMean: number[];
  normStd: number[];
  featureNames: string[];
  targetSum: number;
  targetDiff: number;       // signedDiff (homeGoals - awayGoals)
  sampleCount: number;
  negativeCount: number;
  trainHits: number;
  falsePositives: number;
  trainAccuracy: number;
  fpRate: number;
  formula: string;
  trainedAt: string;
}

export async function trainBucket(opts: TrainOptions): Promise<TrainedOutcomeModel> {
  const bucket = SCORE_BUCKETS.find((b) => b.id === opts.bucketId);
  if (!bucket) throw new Error(`Unknown bucket: ${opts.bucketId}`);

  const epochs        = opts.epochs        ?? 800;
  const lr            = opts.learningRate  ?? 0.012;
  const l2            = opts.l2            ?? 1e-4;
  const negPenalty    = opts.negPenalty    ?? 1.2;
  const confusableFocus = opts.confusableFocus ?? 2.0;
  const progress      = opts.onProgress    ?? (() => {});

  progress(2, "Loading positive samples from database...");

  // Pull positives (matches matching the exact scoreline)
  const positiveRows: any[] = db.prepare(`
    SELECT * FROM match_simulations
    WHERE home_goals = ? AND away_goals = ?
      AND home_avg_xg IS NOT NULL AND away_avg_xg IS NOT NULL
  `).all(bucket.homeGoals, bucket.awayGoals) as any[];

  if (positiveRows.length < 5) {
    throw new Error(
      `Bucket "${bucket.label}" has only ${positiveRows.length} matches — need at least 5. Bulk-upload more dates first.`
    );
  }

  progress(8, `Found ${positiveRows.length} positive samples. Loading negatives...`);

  const allOther: any[] = db.prepare(`
    SELECT * FROM match_simulations
    WHERE home_goals IS NOT NULL AND away_goals IS NOT NULL
      AND home_avg_xg IS NOT NULL AND away_avg_xg IS NOT NULL
  `).all() as any[];

  const negativeRows = allOther.filter((r: any) =>
    !(Number(r.home_goals) === bucket.homeGoals && Number(r.away_goals) === bucket.awayGoals)
  );

  // Split into confusable (close sum OR close signedDiff) vs easy negatives
  const confusableNegs: typeof negativeRows = [];
  const easyNegs: typeof negativeRows = [];
  for (const r of negativeRows) {
    const h = Number(r.home_goals), a = Number(r.away_goals);
    const s = h + a;
    const sd = h - a; // signed diff
    const isConfusable =
      Math.abs(s - bucket.sum) <= 1 || Math.abs(sd - bucket.signedDiff) <= 1;
    if (isConfusable) confusableNegs.push(r);
    else easyNegs.push(r);
  }

  for (let i = easyNegs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [easyNegs[i], easyNegs[j]] = [easyNegs[j], easyNegs[i]];
  }
  const maxNegSamples = opts.maxNegSamples ?? Math.min(2000, Math.max(100, positiveRows.length * 3));
  const negSampled = [
    ...confusableNegs,
    ...easyNegs.slice(0, Math.max(0, maxNegSamples - confusableNegs.length)),
  ];

  // Per-negative similarity weight (confusable = higher pressure)
  const negSimWeights = negSampled.map((r: any) => {
    const h = Number(r.home_goals), a = Number(r.away_goals);
    const s = h + a, sd = h - a;
    const dSum  = Math.abs(s  - bucket.sum);
    const dDiff = Math.abs(sd - bucket.signedDiff);
    return 1 + confusableFocus * Math.exp(-dSum - dDiff);
  });

  progress(15, `Sampled ${negSampled.length} negatives (${confusableNegs.length} confusable). Building feature matrix...`);

  const Xpos = positiveRows.map(buildFeatureVector);
  const Xneg = negSampled.map(buildFeatureVector);

  const Xall = [...Xpos, ...Xneg];
  const { mean, std } = computeNorm(Xall);
  const XposN = normalize(Xpos, mean, std);
  const XnegN = normalize(Xneg, mean, std);

  // Targets: sum and SIGNED diff (homeGoals - awayGoals)
  const ySumPos  = positiveRows.map(() => bucket.sum);
  const yDiffPos = positiveRows.map(() => bucket.signedDiff);

  const D  = TRAINER_FEATURES.length;
  const wSum  = new Array(D).fill(0).map(() => (Math.random() - 0.5) * 0.02);
  const wDiff = new Array(D).fill(0).map(() => (Math.random() - 0.5) * 0.02);
  let bSum  = bucket.sum;
  let bDiff = bucket.signedDiff;   // ← now signed, not absolute

  const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
  const mWS = new Array(D).fill(0), vWS = new Array(D).fill(0);
  const mWD = new Array(D).fill(0), vWD = new Array(D).fill(0);
  let mBS = 0, vBS = 0, mBD = 0, vBD = 0;

  progress(20, `Optimizing weights over ${epochs} epochs (signed-diff target)...`);

  let lastLoss = Infinity;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    const gWS = new Array(D).fill(0);
    const gWD = new Array(D).fill(0);
    let gBS = 0, gBD = 0;
    let lossPos = 0, lossNeg = 0;

    // Positive loss: least squares
    const nPos = Math.max(1, XposN.length);
    for (let i = 0; i < XposN.length; i++) {
      const x  = XposN[i];
      const fs = dot(wSum, x) + bSum;
      const fd = dot(wDiff, x) + bDiff;
      const eS = fs - ySumPos[i];
      const eD = fd - yDiffPos[i];
      lossPos += eS * eS + eD * eD;
      const w = 2 / nPos;
      for (let j = 0; j < D; j++) {
        gWS[j] += w * eS * x[j];
        gWD[j] += w * eD * x[j];
      }
      gBS += w * eS;
      gBD += w * eD;
    }

    // Negative penalty: Gaussian bump centred on (targetSum, targetSignedDiff)
    const sigma = 0.35;
    const nNeg  = Math.max(1, XnegN.length);
    const totalSimWeight = negSimWeights.reduce((s, w) => s + w, 0) || nNeg;
    for (let i = 0; i < XnegN.length; i++) {
      const x  = XnegN[i];
      const fs = dot(wSum, x) + bSum;
      const fd = dot(wDiff, x) + bDiff;
      const dS = fs - bucket.sum;
      const dD = fd - bucket.signedDiff;   // signed target
      const bumpS   = Math.exp(-(dS * dS) / (sigma * sigma));
      const bumpD   = Math.exp(-(dD * dD) / (sigma * sigma));
      const penalty = bumpS * bumpD;
      const simW    = negSimWeights[i];
      lossNeg += penalty * simW;
      const w    = negPenalty * simW / totalSimWeight;
      const dFs  = w * -2 * dS / (sigma * sigma) * penalty;
      const dFd  = w * -2 * dD / (sigma * sigma) * penalty;
      for (let j = 0; j < D; j++) {
        gWS[j] += dFs * x[j];
        gWD[j] += dFd * x[j];
      }
      gBS += dFs;
      gBD += dFd;
    }

    // L2 regularisation
    for (let j = 0; j < D; j++) {
      gWS[j] += 2 * l2 * wSum[j];
      gWD[j] += 2 * l2 * wDiff[j];
    }

    const loss = (lossPos / nPos) + (negPenalty * lossNeg / totalSimWeight);

    // Adam update
    const t = epoch;
    for (let j = 0; j < D; j++) {
      mWS[j] = beta1 * mWS[j] + (1 - beta1) * gWS[j];
      vWS[j] = beta2 * vWS[j] + (1 - beta2) * gWS[j] * gWS[j];
      wSum[j] -= lr * (mWS[j] / (1 - Math.pow(beta1, t))) / (Math.sqrt(vWS[j] / (1 - Math.pow(beta2, t))) + eps);

      mWD[j] = beta1 * mWD[j] + (1 - beta1) * gWD[j];
      vWD[j] = beta2 * vWD[j] + (1 - beta2) * gWD[j] * gWD[j];
      wDiff[j] -= lr * (mWD[j] / (1 - Math.pow(beta1, t))) / (Math.sqrt(vWD[j] / (1 - Math.pow(beta2, t))) + eps);
    }
    mBS = beta1 * mBS + (1 - beta1) * gBS;
    vBS = beta2 * vBS + (1 - beta2) * gBS * gBS;
    bSum -= lr * (mBS / (1 - Math.pow(beta1, t))) / (Math.sqrt(vBS / (1 - Math.pow(beta2, t))) + eps);
    mBD = beta1 * mBD + (1 - beta1) * gBD;
    vBD = beta2 * vBD + (1 - beta2) * gBD * gBD;
    bDiff -= lr * (mBD / (1 - Math.pow(beta1, t))) / (Math.sqrt(vBD / (1 - Math.pow(beta2, t))) + eps);

    if (epoch % Math.max(1, Math.floor(epochs / 20)) === 0) {
      const pct = 20 + Math.floor((epoch / epochs) * 70);
      progress(pct, `Epoch ${epoch}/${epochs} — loss ${loss.toFixed(4)}`);
      await new Promise<void>((r) => setImmediate(r));
    }
    lastLoss = loss;
  }

  progress(92, "Evaluating accuracy on training set...");

  let trainHits = 0;
  for (let i = 0; i < XposN.length; i++) {
    const fs = dot(wSum, XposN[i]) + bSum;
    const fd = dot(wDiff, XposN[i]) + bDiff;
    if (Math.round(fs) === bucket.sum && Math.round(fd) === bucket.signedDiff) trainHits++;
  }
  let falsePositives = 0;
  for (let i = 0; i < XnegN.length; i++) {
    const fs = dot(wSum, XnegN[i]) + bSum;
    const fd = dot(wDiff, XnegN[i]) + bDiff;
    if (Math.round(fs) === bucket.sum && Math.round(fd) === bucket.signedDiff) falsePositives++;
  }
  const trainAccuracy = trainHits / Math.max(1, XposN.length);
  const fpRate        = falsePositives / Math.max(1, XnegN.length);

  progress(96, "Building formula text...");

  const formula = formatFormula(wSum, wDiff, bSum, bDiff, bucket, mean, std);

  const trained: TrainedOutcomeModel = {
    bucket: bucket.id,
    weightsSum: wSum,
    weightsDiff: wDiff,
    biasSum: bSum,
    biasDiff: bDiff,
    normMean: mean,
    normStd: std,
    featureNames: TRAINER_FEATURES,
    targetSum: bucket.sum,
    targetDiff: bucket.signedDiff,
    sampleCount: positiveRows.length,
    negativeCount: negSampled.length,
    trainHits,
    falsePositives,
    trainAccuracy,
    fpRate,
    formula,
    trainedAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT OR REPLACE INTO engine_outcome_models
      (bucket, weights, sample_count, train_hits, false_positives, train_accuracy, fp_rate, formula, trained_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bucket.id,
    JSON.stringify({
      weightsSum: wSum,
      weightsDiff: wDiff,
      biasSum: bSum,
      biasDiff: bDiff,
      normMean: mean,
      normStd: std,
      featureNames: TRAINER_FEATURES,
      targetSum: bucket.sum,
      targetDiff: bucket.signedDiff,
    }),
    positiveRows.length,
    trainHits,
    falsePositives,
    trainAccuracy,
    fpRate,
    formula,
    trained.trainedAt,
  );

  progress(100, `Done. Train accuracy ${(trainAccuracy * 100).toFixed(1)}%, FP rate ${(fpRate * 100).toFixed(1)}% — final loss ${lastLoss.toFixed(4)}.`);
  return trained;
}

// ── Formula formatting ───────────────────────────────────────────────────────
export function formatFormula(
  wSumN: number[],
  wDiffN: number[],
  bSumN: number,
  bDiffN: number,
  bucket: ScoreBucket,
  mean: number[],
  std: number[],
): string {
  const wSumO: number[] = [];
  const wDiffO: number[] = [];
  let bSumO = bSumN;
  let bDiffO = bDiffN;
  for (let j = 0; j < wSumN.length; j++) {
    const sj = std[j] || 1;
    wSumO.push(wSumN[j] / sj);
    wDiffO.push(wDiffN[j] / sj);
    bSumO  -= (wSumN[j]  * mean[j]) / sj;
    bDiffO -= (wDiffN[j] * mean[j]) / sj;
  }
  const fmtTerm = (w: number, name: string) => {
    const sign = w >= 0 ? "+" : "−";
    return ` ${sign} ${Math.abs(w).toFixed(4)}·${name}`;
  };
  const sortByAbs = (arr: number[]) =>
    arr.map((w, i) => ({ w, name: TRAINER_FEATURES[i] }))
       .sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  const topSum  = sortByAbs(wSumO).slice(0, 12);
  const topDiff = sortByAbs(wDiffO).slice(0, 12);

  const sumLine  = `goal_sum      ≈ ${bSumO.toFixed(3)}` + topSum.map((t) => fmtTerm(t.w, t.name)).join("");
  const diffLine = `signed_diff   ≈ ${bDiffO.toFixed(3)}` + topDiff.map((t) => fmtTerm(t.w, t.name)).join("");
  const verdict  = `Match is "${bucket.label}" iff round(goal_sum)=${bucket.sum} AND round(signed_diff)=${bucket.signedDiff}`;
  const hmiNote  = `HMI features: chaos_index, dominance_quality, possession_asymmetry, form_momentum, pressure_factor, conversion_efficiency`;

  return `${sumLine}\n\n${diffLine}\n\n${verdict}\n\n${hmiNote}\n\n(Top 12 features by |weight| shown; full vector saved to DB. Coefficients in raw feature units.)`;
}

// ── Load all trained bucket models from DB ───────────────────────────────────
export interface LoadedBucketModel {
  bucketId: string;
  label: string;
  homeGoals: number;
  awayGoals: number;
  targetSum: number;
  targetDiff: number;   // signedDiff
  weightsSum: number[];
  weightsDiff: number[];
  biasSum: number;
  biasDiff: number;
  normMean: number[];
  normStd: number[];
  featureNames: string[];
  trainAccuracy: number;
  fpRate: number;
}

export function loadAllBucketModels(): LoadedBucketModel[] {
  const rows: any[] = db.prepare(
    `SELECT bucket, weights, train_accuracy, fp_rate FROM engine_outcome_models`
  ).all() as any[];
  const models: LoadedBucketModel[] = [];
  for (const row of rows) {
    const b = SCORE_BUCKETS.find((s) => s.id === row.bucket);
    if (!b) continue;
    try {
      const w = JSON.parse(row.weights);
      models.push({
        bucketId:     b.id,
        label:        b.label,
        homeGoals:    b.homeGoals,
        awayGoals:    b.awayGoals,
        targetSum:    b.sum,
        targetDiff:   b.signedDiff,
        weightsSum:   w.weightsSum,
        weightsDiff:  w.weightsDiff,
        biasSum:      w.biasSum,
        biasDiff:     w.biasDiff,
        normMean:     w.normMean,
        normStd:      w.normStd,
        featureNames: w.featureNames ?? TRAINER_FEATURES,
        trainAccuracy: row.train_accuracy ?? 0,
        fpRate:        row.fp_rate ?? 1,
      });
    } catch {
      // skip malformed model
    }
  }
  return models;
}

// ── Predict across all trained buckets ───────────────────────────────────────
export interface BucketPrediction {
  bucketId: string;
  label: string;
  homeGoals: number;
  awayGoals: number;
  scores: [number, number][];
  confidence: number;        // 0–100
  rawSum: number;
  rawDiff: number;           // predicted signed diff
  roundedSum: number;
  roundedDiff: number;
  isExactHit: boolean;
  trainAccuracy: number;
  fpRate: number;
}

export function predictAllBuckets(
  row: Record<string, any>,
  models: LoadedBucketModel[],
): BucketPrediction[] {
  if (models.length === 0) return [];

  // Build the full feature vector once (includes HMI derived features)
  const fullFV = buildFeatureVector(row);

  const raw = models.map((m) => {
    const featureNames = m.featureNames ?? TRAINER_FEATURES;
    let xn: number[];
    if (featureNames.length === TRAINER_FEATURES.length) {
      // New-format model — use the pre-built full feature vector directly
      xn = fullFV.map((v, j) => (v - (m.normMean[j] ?? 0)) / (m.normStd[j] || 1));
    } else {
      // Old model without HMI features — look up by feature name
      const x = featureNames.map((f) => asNumber(row[f]));
      xn = x.map((v, j) => (v - (m.normMean[j] ?? 0)) / (m.normStd[j] || 1));
    }
    const fs = dot(m.weightsSum, xn) + m.biasSum;
    const fd = dot(m.weightsDiff, xn) + m.biasDiff;
    const roundedSum  = Math.round(fs);
    const roundedDiff = Math.round(fd);
    const isExactHit  = roundedSum === m.targetSum && roundedDiff === m.targetDiff;
    const dist = Math.sqrt((fs - m.targetSum) ** 2 + (fd - m.targetDiff) ** 2);
    return { m, fs, fd, roundedSum, roundedDiff, isExactHit, dist };
  });

  // Relative confidence scoring: best model always scores 1.0
  const SIGMA_REL = 0.20;
  const minDist = Math.min(...raw.map((r) => r.dist));
  const scored  = raw.map((r) => {
    const relScore = Math.exp(-Math.pow((r.dist - minDist) / SIGMA_REL, 2));
    const absScore = Math.exp(-(r.dist * r.dist) / 0.3);
    return { ...r, rawScore: relScore * absScore };
  });
  const totalScore = scored.reduce((s, r) => s + r.rawScore, 0) || 1;

  const predictions: BucketPrediction[] = scored.map(({ m, fs, fd, roundedSum, roundedDiff, isExactHit, rawScore }) => ({
    bucketId:      m.bucketId,
    label:         m.label,
    homeGoals:     m.homeGoals,
    awayGoals:     m.awayGoals,
    scores:        SCORE_BUCKETS.find((b) => b.id === m.bucketId)?.scores ?? [],
    confidence:    Math.round((rawScore / totalScore) * 1000) / 10,
    rawSum:        Math.round(fs * 100) / 100,
    rawDiff:       Math.round(fd * 100) / 100,
    roundedSum,
    roundedDiff,
    isExactHit,
    trainAccuracy: m.trainAccuracy,
    fpRate:        m.fpRate,
  }));

  predictions.sort((a, b) => b.confidence - a.confidence);
  return predictions;
}

// ── Single-row predict helper (legacy, kept for compat) ─────────────────────
export function predictBucketFromRow(
  row: Record<string, any>,
  model: { weightsSum: number[]; weightsDiff: number[]; biasSum: number; biasDiff: number; normMean: number[]; normStd: number[]; featureNames: string[] },
): { sum: number; diff: number; bucket: string | null } {
  const fv = buildFeatureVector(row);
  const xn = fv.map((v, j) => (v - (model.normMean[j] ?? 0)) / (model.normStd[j] || 1));
  const fs = dot(model.weightsSum, xn) + model.biasSum;
  const fd = dot(model.weightsDiff, xn) + model.biasDiff;
  const sum  = Math.round(fs);
  const diff = Math.round(fd);
  const matched = SCORE_BUCKETS.find((b) => b.sum === sum && b.signedDiff === diff);
  return { sum, diff, bucket: matched ? matched.id : null };
}
