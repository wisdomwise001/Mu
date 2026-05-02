// ─────────────────────────────────────────────────────────────────────────────
// Per-Score-Outcome Model Trainer
// ─────────────────────────────────────────────────────────────────────────────
// Builds a unified linear formula per score-outcome bucket. The user picks one
// of 15 buckets (0-0, 1-0/0-1, 1-1, ...). The trainer:
//   1. Pulls every match in the database that ended in that bucket  (positives)
//   2. Pulls a sample of matches from OTHER buckets                  (negatives)
//   3. Fits two linear models:
//        f_sum(x)  = w_sum  · x  +  b_sum    →  predicts goal_sum   (h+a)
//        f_diff(x) = w_diff · x  +  b_diff   →  predicts |h-a|
//      Each bucket maps to a unique (sum, abs_diff) target, so a match is
//      classified into bucket B iff round(f_sum)=S_B AND round(f_diff)=D_B.
//   4. Loss has three terms:
//        - positive least-squares: pull positives onto the target (sum,diff)
//        - negative margin penalty: push negatives away (only fires when
//          BOTH predicted sum and predicted diff are within ±1 of the target)
//        - L2 regularization: keep the formula compact
//   5. Solves with Adam-style mini-batch gradient descent (no external deps).
//   6. Returns the trained weights, a human-readable formula, and accuracy
//      stats (train hits, false-positive rate against negatives).
// ─────────────────────────────────────────────────────────────────────────────

import db from "./db";

// ── Score buckets ────────────────────────────────────────────────────────────
// Each bucket has a unique (goal_sum, |goal_diff|) signature.
export interface ScoreBucket {
  id: string;          // canonical id (used by API)
  label: string;       // user-facing label
  scores: [number, number][]; // member final scores
  sum: number;         // h + a
  absDiff: number;     // |h - a|
}

export const SCORE_BUCKETS: ScoreBucket[] = [
  { id: "0-0",      label: "0-0",        scores: [[0, 0]],          sum: 0, absDiff: 0 },
  { id: "1-0/0-1",  label: "1-0 / 0-1",  scores: [[1, 0], [0, 1]],  sum: 1, absDiff: 1 },
  { id: "1-1",      label: "1-1",        scores: [[1, 1]],          sum: 2, absDiff: 0 },
  { id: "2-0/0-2",  label: "2-0 / 0-2",  scores: [[2, 0], [0, 2]],  sum: 2, absDiff: 2 },
  { id: "2-1/1-2",  label: "2-1 / 1-2",  scores: [[2, 1], [1, 2]],  sum: 3, absDiff: 1 },
  { id: "2-2",      label: "2-2",        scores: [[2, 2]],          sum: 4, absDiff: 0 },
  { id: "3-0/0-3",  label: "3-0 / 0-3",  scores: [[3, 0], [0, 3]],  sum: 3, absDiff: 3 },
  { id: "3-1/1-3",  label: "3-1 / 1-3",  scores: [[3, 1], [1, 3]],  sum: 4, absDiff: 2 },
  { id: "3-2/2-3",  label: "3-2 / 2-3",  scores: [[3, 2], [2, 3]],  sum: 5, absDiff: 1 },
  { id: "3-3",      label: "3-3",        scores: [[3, 3]],          sum: 6, absDiff: 0 },
  { id: "4-0/0-4",  label: "4-0 / 0-4",  scores: [[4, 0], [0, 4]],  sum: 4, absDiff: 4 },
  { id: "4-1/1-4",  label: "4-1 / 1-4",  scores: [[4, 1], [1, 4]],  sum: 5, absDiff: 3 },
  { id: "4-2/2-4",  label: "4-2 / 2-4",  scores: [[4, 2], [2, 4]],  sum: 6, absDiff: 2 },
  { id: "4-3/3-4",  label: "4-3 / 3-4",  scores: [[4, 3], [3, 4]],  sum: 7, absDiff: 1 },
  { id: "4-4",      label: "4-4",        scores: [[4, 4]],          sum: 8, absDiff: 0 },
];

export function classifyBucket(homeGoals: number, awayGoals: number): string | null {
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  const h = Math.round(homeGoals);
  const a = Math.round(awayGoals);
  for (const b of SCORE_BUCKETS) {
    if (b.scores.some(([sh, sa]) => sh === h && sa === a)) return b.id;
  }
  return null; // any score with a side ≥ 5 falls outside our 15 buckets
}

// ── Feature extraction ───────────────────────────────────────────────────────
// We use a curated subset of features: form, scoring/defending strength, per-half
// xG and possession, plus the new context features. Symmetric pairs (home/away)
// are kept ordered so the model can learn home-advantage too.
export const TRAINER_FEATURES: string[] = [
  // Form & strength
  "home_form_strength", "away_form_strength",
  "home_scoring_strength", "away_scoring_strength",
  "home_defending_strength", "away_defending_strength",
  "home_form_points", "away_form_points",
  "home_clean_sheets", "away_clean_sheets",
  // Full-match averages
  "home_avg_xg", "away_avg_xg",
  "home_avg_goals_scored", "away_avg_goals_scored",
  "home_avg_goals_conceded", "away_avg_goals_conceded",
  "home_avg_big_chances", "away_avg_big_chances",
  "home_avg_total_shots", "away_avg_total_shots",
  "home_avg_shots_on_target", "away_avg_shots_on_target",
  "home_avg_possession", "away_avg_possession",
  // Per-half averages
  "home_h1_avg_goals_scored", "away_h1_avg_goals_scored",
  "home_h1_avg_xg", "away_h1_avg_xg",
  "home_h1_avg_total_shots", "away_h1_avg_total_shots",
  "home_h2_avg_goals_scored", "away_h2_avg_goals_scored",
  "home_h2_avg_xg", "away_h2_avg_xg",
  "home_h2_avg_total_shots", "away_h2_avg_total_shots",
  // Role strengths
  "home_phase_attack", "away_phase_attack",
  "home_phase_defensive", "away_phase_defensive",
  // Injury impact
  "home_injury_impact", "away_injury_impact",
  // ── Context features (NEW — populated by halfContext during bulk upload)
  "ctx_is_knockout",
  "ctx_is_second_leg",
  "ctx_agg_lead_goals",
  "ctx_trailing_needs_goals",
  "ctx_home_motivation", "ctx_away_motivation",
  "ctx_motivation_asymmetry",
  "ctx_home_fatigue_index", "ctx_away_fatigue_index",
  "ctx_fatigue_asymmetry",
  "ctx_home_avg_first_sub", "ctx_away_avg_first_sub",
  "ctx_home_late_subs_rate", "ctx_away_late_subs_rate",
  "ctx_home_conservative_coach", "ctx_away_conservative_coach",
  "ctx_style_clash_weight",
  "ctx_odds_home_win", "ctx_odds_draw", "ctx_odds_away_win",
  "ctx_odds_gap",
  "ctx_stage_modifier",
  "ctx_signal_first_weight", "ctx_signal_second_weight", "ctx_signal_draw_weight",
];

function asNumber(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function buildFeatureVector(row: Record<string, any>): number[] {
  return TRAINER_FEATURES.map((f) => asNumber(row[f]));
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
  margin?: number;     // distance from target that counts as "near"
  maxNegSamples?: number; // cap negatives to keep training fast
  /** How much extra weight to give confusable negatives (sum/diff near target).
   *  Higher = the model is forced to draw harder boundaries around similar scores.
   *  Default 2.0. Range 0–5. */
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
  targetDiff: number;
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

  const epochs = opts.epochs ?? 800;
  const lr = opts.learningRate ?? 0.012;
  const l2 = opts.l2 ?? 1e-4;
  // Two competing objectives:
  //   - Positives must land on (S_T, D_T)              (least-squares pull)
  //   - Negatives must NOT land on (S_T, D_T)          (margin push)
  // Higher negPenalty → tighter separation but lower train accuracy.
  // Lower negPenalty → more positives hit but more false positives.
  const negPenalty = opts.negPenalty ?? 1.2;
  const margin = opts.margin ?? 0.5;
  // confusableFocus: boosts gradient weight for negatives whose actual score
  // is close to the target bucket (similar sum OR similar diff). These are
  // the "hard negatives" the model must learn to discriminate from.
  const confusableFocus = opts.confusableFocus ?? 2.0;
  const progress = opts.onProgress ?? (() => {});

  progress(2, "Loading positive samples from database...");

  // Pull positives (matches matching the bucket score)
  const positiveRows: any[] = [];
  for (const [sh, sa] of bucket.scores) {
    const rows = db.prepare(`
      SELECT * FROM match_simulations
      WHERE home_goals = ? AND away_goals = ?
        AND home_avg_xg IS NOT NULL AND away_avg_xg IS NOT NULL
    `).all(sh, sa);
    positiveRows.push(...rows);
  }
  if (positiveRows.length < 5) {
    throw new Error(`Bucket "${bucket.label}" has only ${positiveRows.length} matches in the database — need at least 5 to train. Bulk-upload more dates first.`);
  }

  progress(8, `Found ${positiveRows.length} positive samples. Loading negatives...`);

  // Pull negatives — all non-bucket matches from the database.
  // We split them into two groups:
  //   confusable  — scores whose (sum OR diff) is within ±1 of the target.
  //                 These are the "hard negatives" the model must learn to
  //                 separate from the bucket (e.g. 2-1 vs 2-0 when training 2-1/1-2).
  //   easy        — all other non-bucket matches.
  // We always include ALL confusable negatives, then pad with random easy ones.
  const allOther: any[] = db.prepare(`
    SELECT * FROM match_simulations
    WHERE home_goals IS NOT NULL AND away_goals IS NOT NULL
      AND home_avg_xg IS NOT NULL AND away_avg_xg IS NOT NULL
  `).all();
  const negativeRows = allOther.filter((r: any) => {
    const h = Number(r.home_goals);
    const a = Number(r.away_goals);
    return !bucket.scores.some(([sh, sa]) => sh === h && sa === a);
  });

  const confusableNegs: typeof negativeRows = [];
  const easyNegs: typeof negativeRows = [];
  for (const r of negativeRows) {
    const h = Number(r.home_goals), a = Number(r.away_goals);
    const s = h + a, d = Math.abs(h - a);
    const isConfusable =
      Math.abs(s - bucket.sum) <= 1 || Math.abs(d - bucket.absDiff) <= 1;
    if (isConfusable) confusableNegs.push(r);
    else easyNegs.push(r);
  }
  // Shuffle easy negatives
  for (let i = easyNegs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [easyNegs[i], easyNegs[j]] = [easyNegs[j], easyNegs[i]];
  }
  const maxNegSamples = opts.maxNegSamples ?? Math.min(2000, Math.max(100, positiveRows.length * 3));
  // Fill quota: all confusables first, then easy ones
  const negSampled = [
    ...confusableNegs,
    ...easyNegs.slice(0, Math.max(0, maxNegSamples - confusableNegs.length)),
  ];

  // Compute per-negative similarity weight (how "confusable" each one is).
  // A negative that is only 1 sum/diff step away from the target gets a
  // weight of up to (1 + confusableFocus); distant negatives get weight ≈ 1.
  const negSimWeights = negSampled.map((r: any) => {
    const h = Number(r.home_goals), a = Number(r.away_goals);
    const s = h + a, d = Math.abs(h - a);
    const dSum = Math.abs(s - bucket.sum);
    const dDiff = Math.abs(d - bucket.absDiff);
    return 1 + confusableFocus * Math.exp(-dSum - dDiff);
  });

  progress(15, `Sampled ${negSampled.length} negatives (${confusableNegs.length} confusable). Building feature matrix...`);

  // Build feature matrices
  const Xpos = positiveRows.map(buildFeatureVector);
  const Xneg = negSampled.map(buildFeatureVector);

  // Normalize using the union of all training data (so positives and negatives
  // share the same scale; otherwise the negative-margin penalty is meaningless)
  const Xall = [...Xpos, ...Xneg];
  const { mean, std } = computeNorm(Xall);
  const XposN = normalize(Xpos, mean, std);
  const XnegN = normalize(Xneg, mean, std);

  // Targets per positive sample (actual sum/diff for the matches)
  const ySumPos = positiveRows.map((r: any) => Number(r.home_goals) + Number(r.away_goals));
  const yDiffPos = positiveRows.map((r: any) => Math.abs(Number(r.home_goals) - Number(r.away_goals)));

  // Initialise weights (small random, biases at target)
  const D = TRAINER_FEATURES.length;
  const wSum = new Array(D).fill(0).map(() => (Math.random() - 0.5) * 0.02);
  const wDiff = new Array(D).fill(0).map(() => (Math.random() - 0.5) * 0.02);
  let bSum = bucket.sum;
  let bDiff = bucket.absDiff;

  // Adam optimizer state
  const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
  const mWS = new Array(D).fill(0), vWS = new Array(D).fill(0);
  const mWD = new Array(D).fill(0), vWD = new Array(D).fill(0);
  let mBS = 0, vBS = 0, mBD = 0, vBD = 0;

  progress(20, `Optimizing weights over ${epochs} epochs...`);

  let lastLoss = Infinity;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    // Gradients
    const gWS = new Array(D).fill(0);
    const gWD = new Array(D).fill(0);
    let gBS = 0, gBD = 0;
    let lossPos = 0, lossNeg = 0;

    // ── Positive loss: least squares (per-sample averaged) ─────────────
    const nPos = Math.max(1, XposN.length);
    for (let i = 0; i < XposN.length; i++) {
      const x = XposN[i];
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

    // ── Negative penalty: only fires when BOTH predictions land inside the
    // bucket's rounding box (within ±0.5 of the target sum AND target diff).
    // Use a narrow Gaussian bump so the penalty is essentially zero outside
    // the rounding box, and average over negatives so positives and negatives
    // contribute equal-magnitude gradients.
    // Each negative is additionally scaled by its similarity weight so that
    // confusable negatives (scores 1 step away) push much harder than easy ones.
    const sigma = 0.35; // narrow — bump≈0 once |d|>0.7
    const nNeg = Math.max(1, XnegN.length);
    // Pre-compute total weight for normalisation so the overall magnitude
    // stays comparable regardless of how many confusable negatives exist.
    const totalSimWeight = negSimWeights.reduce((s, w) => s + w, 0) || nNeg;
    for (let i = 0; i < XnegN.length; i++) {
      const x = XnegN[i];
      const fs = dot(wSum, x) + bSum;
      const fd = dot(wDiff, x) + bDiff;
      const dS = fs - bucket.sum;
      const dD = fd - bucket.absDiff;
      const bumpS = Math.exp(-(dS * dS) / (sigma * sigma));
      const bumpD = Math.exp(-(dD * dD) / (sigma * sigma));
      const penalty = bumpS * bumpD;
      // Scale loss contribution by similarity weight (confusable = more pressure)
      const simW = negSimWeights[i];
      lossNeg += penalty * simW;
      // ∂penalty/∂fs = bumpD · bumpS · (-2·dS / σ²)
      // Divide by totalSimWeight to keep overall gradient magnitude stable
      const w = negPenalty * simW / totalSimWeight;
      const dFs = w * -2 * dS / (sigma * sigma) * penalty;
      const dFd = w * -2 * dD / (sigma * sigma) * penalty;
      for (let j = 0; j < D; j++) {
        gWS[j] += dFs * x[j];
        gWD[j] += dFd * x[j];
      }
      gBS += dFs;
      gBD += dFd;
    }

    // ── L2 regularisation ───────────────────────────────────────────────
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
      const mh = mWS[j] / (1 - Math.pow(beta1, t));
      const vh = vWS[j] / (1 - Math.pow(beta2, t));
      wSum[j] -= lr * mh / (Math.sqrt(vh) + eps);

      mWD[j] = beta1 * mWD[j] + (1 - beta1) * gWD[j];
      vWD[j] = beta2 * vWD[j] + (1 - beta2) * gWD[j] * gWD[j];
      const mhd = mWD[j] / (1 - Math.pow(beta1, t));
      const vhd = vWD[j] / (1 - Math.pow(beta2, t));
      wDiff[j] -= lr * mhd / (Math.sqrt(vhd) + eps);
    }
    mBS = beta1 * mBS + (1 - beta1) * gBS;
    vBS = beta2 * vBS + (1 - beta2) * gBS * gBS;
    bSum -= lr * (mBS / (1 - Math.pow(beta1, t))) / (Math.sqrt(vBS / (1 - Math.pow(beta2, t))) + eps);
    mBD = beta1 * mBD + (1 - beta1) * gBD;
    vBD = beta2 * vBD + (1 - beta2) * gBD * gBD;
    bDiff -= lr * (mBD / (1 - Math.pow(beta1, t))) / (Math.sqrt(vBD / (1 - Math.pow(beta2, t))) + eps);

    if (epoch % Math.max(1, Math.floor(epochs / 20)) === 0) {
      const pct = 20 + Math.floor((epoch / epochs) * 70);
      progress(pct, `Epoch ${epoch}/${epochs} — loss ${loss.toFixed(4)} (pos ${(lossPos / Math.max(1, XposN.length)).toFixed(3)}, neg ${(lossNeg / Math.max(1, XnegN.length)).toFixed(3)})`);
      // Yield to event loop so HTTP requests can be served
      await new Promise<void>((r) => setImmediate(r));
    }
    lastLoss = loss;
  }

  progress(92, "Evaluating accuracy on training set...");

  // Evaluate
  let trainHits = 0;
  for (let i = 0; i < XposN.length; i++) {
    const fs = dot(wSum, XposN[i]) + bSum;
    const fd = dot(wDiff, XposN[i]) + bDiff;
    if (Math.round(fs) === bucket.sum && Math.round(fd) === bucket.absDiff) trainHits++;
  }
  let falsePositives = 0;
  for (let i = 0; i < XnegN.length; i++) {
    const fs = dot(wSum, XnegN[i]) + bSum;
    const fd = dot(wDiff, XnegN[i]) + bDiff;
    if (Math.round(fs) === bucket.sum && Math.round(fd) === bucket.absDiff) falsePositives++;
  }
  const trainAccuracy = trainHits / Math.max(1, XposN.length);
  const fpRate = falsePositives / Math.max(1, XnegN.length);

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
    targetDiff: bucket.absDiff,
    sampleCount: positiveRows.length,
    negativeCount: negSampled.length,
    trainHits,
    falsePositives,
    trainAccuracy,
    fpRate,
    formula,
    trainedAt: new Date().toISOString(),
  };

  // Persist
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
      targetDiff: bucket.absDiff,
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
// Outputs a readable equation that scores top contributors first. Coefficients
// are reported in *original feature units* (un-normalised) so the user can
// plug in raw stats and reproduce predictions by hand.
export function formatFormula(
  wSumN: number[],
  wDiffN: number[],
  bSumN: number,
  bDiffN: number,
  bucket: ScoreBucket,
  mean: number[],
  std: number[],
): string {
  // De-normalize: w_orig = w_norm / std,  b_orig = b - Σ (w_norm * mean / std)
  const wSumO: number[] = [];
  const wDiffO: number[] = [];
  let bSumO = bSumN;
  let bDiffO = bDiffN;
  for (let j = 0; j < wSumN.length; j++) {
    const sj = std[j] || 1;
    wSumO.push(wSumN[j] / sj);
    wDiffO.push(wDiffN[j] / sj);
    bSumO -= (wSumN[j] * mean[j]) / sj;
    bDiffO -= (wDiffN[j] * mean[j]) / sj;
  }
  const fmtTerm = (w: number, name: string) => {
    const sign = w >= 0 ? "+" : "−";
    return ` ${sign} ${Math.abs(w).toFixed(4)}·${name}`;
  };
  const sortByAbs = (arr: number[]) =>
    arr.map((w, i) => ({ w, name: TRAINER_FEATURES[i] }))
       .sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  const topSum = sortByAbs(wSumO).slice(0, 12);
  const topDiff = sortByAbs(wDiffO).slice(0, 12);

  const sumLine = `goal_sum  ≈ ${bSumO.toFixed(3)}` + topSum.map((t) => fmtTerm(t.w, t.name)).join("");
  const diffLine = `goal_diff ≈ ${bDiffO.toFixed(3)}` + topDiff.map((t) => fmtTerm(t.w, t.name)).join("");
  const verdictLine = `Match lands in "${bucket.label}" iff round(goal_sum)=${bucket.sum} AND round(goal_diff)=${bucket.absDiff}`;

  return `${sumLine}\n\n${diffLine}\n\n${verdictLine}\n\n(Top 12 features by |weight| shown; full vector saved to DB. Coefficients are in raw feature units — plug stats in directly.)`;
}

// ── Load all trained bucket models from DB ───────────────────────────────────
export interface LoadedBucketModel {
  bucketId: string;
  label: string;
  targetSum: number;
  targetDiff: number;
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
  ).all();
  const models: LoadedBucketModel[] = [];
  for (const row of rows) {
    const b = SCORE_BUCKETS.find((s) => s.id === row.bucket);
    if (!b) continue;
    try {
      const w = JSON.parse(row.weights);
      models.push({
        bucketId: b.id,
        label: b.label,
        targetSum: b.sum,
        targetDiff: b.absDiff,
        weightsSum: w.weightsSum,
        weightsDiff: w.weightsDiff,
        biasSum: w.biasSum,
        biasDiff: w.biasDiff,
        normMean: w.normMean,
        normStd: w.normStd,
        featureNames: w.featureNames ?? TRAINER_FEATURES,
        trainAccuracy: row.train_accuracy ?? 0,
        fpRate: row.fp_rate ?? 1,
      });
    } catch {
      // skip malformed model
    }
  }
  return models;
}

// ── Predict across all trained buckets ───────────────────────────────────────
// For each model, we run the feature vector through its linear formula and
// measure how close the raw (sum, diff) output is to the bucket's target.
// Confidence = exp(-distance²) — this gives 1.0 at an exact hit and decays
// smoothly as the prediction drifts away. We then softmax-normalise across
// all models so the confidences sum to 100%.
export interface BucketPrediction {
  bucketId: string;
  label: string;
  scores: [number, number][];
  confidence: number;        // 0–100
  rawSum: number;            // linear formula output (goal_sum)
  rawDiff: number;           // linear formula output (goal_diff)
  roundedSum: number;        // round(rawSum)
  roundedDiff: number;       // round(rawDiff)
  isExactHit: boolean;       // whether rounded values match this bucket's target
  trainAccuracy: number;
  fpRate: number;
}

export function predictAllBuckets(
  row: Record<string, any>,
  models: LoadedBucketModel[],
): BucketPrediction[] {
  if (models.length === 0) return [];

  // Run each model
  const raw = models.map((m) => {
    const x = (m.featureNames ?? TRAINER_FEATURES).map((f) => asNumber(row[f]));
    const xn = x.map((v, j) => (v - (m.normMean[j] ?? 0)) / (m.normStd[j] || 1));
    const fs = dot(m.weightsSum, xn) + m.biasSum;
    const fd = dot(m.weightsDiff, xn) + m.biasDiff;
    const roundedSum = Math.round(fs);
    const roundedDiff = Math.round(fd);
    const isExactHit = roundedSum === m.targetSum && roundedDiff === m.targetDiff;

    // Distance from this model's own prediction to its target (sum, diff space).
    // A model that predicts exactly (3, 1) for a 2-1/1-2 bucket gets distance=0.
    const dist = Math.sqrt((fs - m.targetSum) ** 2 + (fd - m.targetDiff) ** 2);
    return { m, fs, fd, roundedSum, roundedDiff, isExactHit, dist };
  });

  // ── Relative confidence scoring ───────────────────────────────────────────
  // Problem with the old Gaussian scoring (exp(-d²/σ)):
  //   When all models predict roughly equal distances (common with limited training
  //   data), every raw score is similar and softmax produces near-equal confidences
  //   like 39% / 38% — the user can't tell which bucket the model actually prefers.
  //
  // Fix: score each model relative to the BEST model (smallest distance).
  //   rawScore = exp(-((dist - minDist) / SIGMA_REL)²)
  //   The best model always scores 1.0.  A model 0.3 away from the best scores
  //   exp(-(0.3/0.2)²) ≈ 0.11 — creating a clear spread even for small differences.
  //   Additionally, an absolute quality gate (exp(-dist²/0.3)) prevents a poorly
  //   predicting leader from receiving artificially high confidence.
  const SIGMA_REL = 0.20;
  const minDist = Math.min(...raw.map((r) => r.dist));
  const scored = raw.map((r) => {
    const relScore = Math.exp(-Math.pow((r.dist - minDist) / SIGMA_REL, 2));
    const absScore = Math.exp(-(r.dist * r.dist) / 0.3);  // hard quality gate
    return { ...r, rawScore: relScore * absScore };
  });
  const totalScore = scored.reduce((s, r) => s + r.rawScore, 0) || 1;

  const predictions: BucketPrediction[] = scored.map(({ m, fs, fd, roundedSum, roundedDiff, isExactHit, rawScore }) => ({
    bucketId: m.bucketId,
    label: m.label,
    scores: SCORE_BUCKETS.find((b) => b.id === m.bucketId)?.scores ?? [],
    confidence: Math.round((rawScore / totalScore) * 1000) / 10,
    rawSum: Math.round(fs * 100) / 100,
    rawDiff: Math.round(fd * 100) / 100,
    roundedSum,
    roundedDiff,
    isExactHit,
    trainAccuracy: m.trainAccuracy,
    fpRate: m.fpRate,
  }));

  // Sort by confidence descending
  predictions.sort((a, b) => b.confidence - a.confidence);
  return predictions;
}

// ── Single-row predict helper (legacy, kept for compat) ─────────────────────
export function predictBucketFromRow(
  row: Record<string, any>,
  model: { weightsSum: number[]; weightsDiff: number[]; biasSum: number; biasDiff: number; normMean: number[]; normStd: number[]; featureNames: string[] },
): { sum: number; diff: number; bucket: string | null } {
  const x = model.featureNames.map((f) => asNumber(row[f]));
  const xn = x.map((v, j) => (v - model.normMean[j]) / (model.normStd[j] || 1));
  const fs = dot(model.weightsSum, xn) + model.biasSum;
  const fd = dot(model.weightsDiff, xn) + model.biasDiff;
  const sum = Math.round(fs);
  const diff = Math.round(fd);
  const matched = SCORE_BUCKETS.find((b) => b.sum === sum && b.absDiff === diff);
  return { sum, diff, bucket: matched ? matched.id : null };
}
