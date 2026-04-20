/**
 * Multi-Paradigm Probabilistic xG Forecasting Engine
 * Uses real ML libraries:
 *  - @tensorflow/tfjs-node → ANN with Adam optimizer + native C++ backend
 *  - ml-random-forest  → Random Forest with CART trees + bootstrap sampling
 *  - ml-cart           → CART decision trees for Gradient Boosting
 *  - ml-regression     → OLS MultivariateLinearRegression for Causal model
 *  - ml-matrix         → Matrix algebra for Gaussian Process
 */

import "@tensorflow/tfjs-node";
import * as tf from "@tensorflow/tfjs";
import { RandomForestRegression } from "ml-random-forest";
import { DecisionTreeRegression } from "ml-cart";
import { MultivariateLinearRegression } from "ml-regression";
import { Matrix } from "ml-matrix";
import db from "./db";

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS engine_models (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name        TEXT NOT NULL UNIQUE,
    weights           TEXT NOT NULL,
    trained_at        TEXT NOT NULL,
    training_samples  INTEGER DEFAULT 0,
    metrics           TEXT DEFAULT '{}'
  )
`);

// ─── Feature names (92 features — all available DB columns) ──────────────────
export const FEATURE_NAMES = [
  // ── Full-match averages (last 15) ──────────────────────────────────────────
  "home_avg_xg", "away_avg_xg",
  "home_avg_goals_scored", "away_avg_goals_scored",
  "home_avg_goals_conceded", "away_avg_goals_conceded",
  "home_avg_big_chances", "away_avg_big_chances",
  "home_avg_big_chances_scored", "away_avg_big_chances_scored",
  "home_avg_big_chances_missed", "away_avg_big_chances_missed",
  "home_avg_total_shots", "away_avg_total_shots",
  "home_avg_shots_on_target", "away_avg_shots_on_target",
  "home_avg_shots_off_target", "away_avg_shots_off_target",
  "home_avg_blocked_shots", "away_avg_blocked_shots",
  "home_avg_shots_inside_box", "away_avg_shots_inside_box",
  "home_avg_possession", "away_avg_possession",
  "home_avg_pass_accuracy", "away_avg_pass_accuracy",
  "home_avg_total_passes", "away_avg_total_passes",
  "home_avg_corner_kicks", "away_avg_corner_kicks",
  "home_avg_fouls", "away_avg_fouls",
  "home_avg_duels_won", "away_avg_duels_won",
  "home_avg_tackles_won", "away_avg_tackles_won",
  "home_avg_interceptions", "away_avg_interceptions",
  "home_avg_clearances", "away_avg_clearances",
  "home_avg_goalkeeper_saves", "away_avg_goalkeeper_saves",
  "home_avg_goals_prevented", "away_avg_goals_prevented",
  // ── Role strengths (last 15) ───────────────────────────────────────────────
  "home_phase_attack", "away_phase_attack",
  "home_phase_defensive", "away_phase_defensive",
  "home_phase_midfield", "away_phase_midfield",
  "home_phase_keeper", "away_phase_keeper",
  "home_phase_fullback", "away_phase_fullback",
  // ── Form strengths (last 7) ────────────────────────────────────────────────
  "home_form_strength", "away_form_strength",
  "home_scoring_strength", "away_scoring_strength",
  "home_defending_strength", "away_defending_strength",
  "home_form_points", "away_form_points",
  "home_clean_sheets", "away_clean_sheets",
  // ── 1st-half averages ──────────────────────────────────────────────────────
  "home_h1_avg_xg", "away_h1_avg_xg",
  "home_h1_avg_goals_scored", "away_h1_avg_goals_scored",
  "home_h1_avg_goals_conceded", "away_h1_avg_goals_conceded",
  "home_h1_avg_big_chances", "away_h1_avg_big_chances",
  "home_h1_avg_total_shots", "away_h1_avg_total_shots",
  "home_h1_avg_possession", "away_h1_avg_possession",
  "home_h1_avg_pass_accuracy", "away_h1_avg_pass_accuracy",
  // ── 2nd-half averages ──────────────────────────────────────────────────────
  "home_h2_avg_xg", "away_h2_avg_xg",
  "home_h2_avg_goals_scored", "away_h2_avg_goals_scored",
  "home_h2_avg_goals_conceded", "away_h2_avg_goals_conceded",
  "home_h2_avg_big_chances", "away_h2_avg_big_chances",
  "home_h2_avg_total_shots", "away_h2_avg_total_shots",
  "home_h2_avg_possession", "away_h2_avg_possession",
  "home_h2_avg_pass_accuracy", "away_h2_avg_pass_accuracy",
  // ── Injury / suspension impact (key player absences) ───────────────────────
  "home_injury_impact", "away_injury_impact",
  // ── League / country context (label-encoded; 0 = unknown) ─────────────────
  "league_encoded", "country_encoded",
];
export const N_FEATURES = FEATURE_NAMES.length; // 96

export const TARGET_NAMES = [
  "home_ft_xg", "away_ft_xg",
  "home_h1_xg", "away_h1_xg",
  "home_h2_xg", "away_h2_xg",
];
export const N_TARGETS = TARGET_NAMES.length;

// ─── Feature / Target extraction ──────────────────────────────────────────────
export function extractFeatures(row: Record<string, any>): number[] {
  return FEATURE_NAMES.map(name => {
    const v = row[name];
    return v != null && Number.isFinite(Number(v)) ? Number(v) : 0;
  });
}

export function extractTargets(row: Record<string, any>): number[] {
  const hFt = Number(row.home_goals ?? 0);
  const aFt = Number(row.away_goals ?? 0);
  const hHt = row.home_ht_goals != null ? Number(row.home_ht_goals) : hFt * 0.4;
  const aHt = row.away_ht_goals != null ? Number(row.away_ht_goals) : aFt * 0.4;
  return [hFt, aFt, hHt, aHt, Math.max(0, hFt - hHt), Math.max(0, aFt - aHt)];
}

// ─── Min-Max Scaler ───────────────────────────────────────────────────────────
export interface Scaler { min: number[]; scale: number[] }

export function fitScaler(data: number[][]): Scaler {
  const n = data[0].length;
  const min = Array(n).fill(Infinity);
  const max = Array(n).fill(-Infinity);
  for (const row of data) {
    for (let i = 0; i < n; i++) {
      if (row[i] < min[i]) min[i] = row[i];
      if (row[i] > max[i]) max[i] = row[i];
    }
  }
  return { min, scale: min.map((mn, i) => (max[i] - mn) || 1) };
}

export function applyScaler(x: number[], s: Scaler): number[] {
  return x.map((v, i) => {
    const scaled = (v - s.min[i]) / s.scale[i];
    // Hard-clamp to [0, 1]: features outside the training distribution (e.g. small-sided
    // leagues with inflated xG/shots) are pinned to the training boundary rather than
    // allowing the ANN to extrapolate into regions it has never seen.
    return Math.max(0, Math.min(1, scaled));
  });
}

// ─── Math helpers ─────────────────────────────────────────────────────────────
function clamp(x: number, lo: number, hi: number) { return x < lo ? lo : x > hi ? hi : x; }
function arrMean(a: number[]): number { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function arrStd(a: number[], m = arrMean(a)): number {
  return a.length < 2 ? 1 : Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) || 1;
}
function dot(a: number[], b: number[]): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s;
}
function randGauss(): number {
  let u = 0, v = 0;
  while (!u) u = Math.random(); while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── 1. ANN — @tensorflow/tfjs (Adam optimizer, real backpropagation) ─────────
// Builds a proper feed-forward neural network using TensorFlow.js.
// Architecture: D → Dense(64, relu) → Dense(32, relu) → Dense(6, relu)
// Optimizer: Adam (adaptive learning rates per parameter)
// Loss: Mean Squared Error

interface ANNState {
  weightData: Array<{ shape: number[]; data: number[] }>;
}

async function buildANNModel(inputDim: number): Promise<tf.LayersModel> {
  const model = tf.sequential();
  model.add(tf.layers.dense({
    units: 128, activation: "relu", inputShape: [inputDim],
    kernelInitializer: "heNormal",
  }));
  model.add(tf.layers.dropout({ rate: 0.15 }));
  model.add(tf.layers.dense({
    units: 64, activation: "relu",
    kernelInitializer: "heNormal",
  }));
  model.add(tf.layers.dropout({ rate: 0.1 }));
  model.add(tf.layers.dense({
    units: 32, activation: "relu",
    kernelInitializer: "heNormal",
  }));
  model.add(tf.layers.dense({
    units: N_TARGETS, activation: "relu",
    kernelInitializer: "glorotNormal",
  }));
  model.compile({
    optimizer: tf.train.adam(0.001, 0.9, 0.999, 1e-7),
    loss: "meanSquaredError",
    metrics: ["mae"],
  });
  return model;
}

async function trainANN(
  features: number[][], targets: number[][],
  onProgress?: (e: number, total: number) => void
): Promise<{ model: tf.LayersModel; state: ANNState }> {
  const model = await buildANNModel(features[0].length);
  const xs = tf.tensor2d(features);
  const ys = tf.tensor2d(targets);

  const totalEpochs = 200;
  await model.fit(xs, ys, {
    epochs: totalEpochs,
    batchSize: Math.min(32, Math.floor(features.length / 4)),
    validationSplit: 0.1,
    shuffle: true,
    verbose: 0,
    callbacks: {
      onEpochEnd: async (epoch: number) => {
        if (epoch % 20 === 0) onProgress?.(epoch, totalEpochs);
      },
    },
  });

  xs.dispose();
  ys.dispose();

  const weightData = model.getWeights().map(w => ({
    shape: w.shape,
    data: Array.from(w.dataSync()),
  }));

  return { model, state: { weightData } };
}

async function restoreANN(state: ANNState): Promise<tf.LayersModel> {
  const model = await buildANNModel(N_FEATURES);
  const tensors = state.weightData.map(w => tf.tensor(w.data, w.shape));
  model.setWeights(tensors);
  tensors.forEach(t => t.dispose());
  return model;
}

function annPredict(model: tf.LayersModel, x: number[]): number[] {
  const tensor = tf.tensor2d([x]);
  const output = model.predict(tensor) as tf.Tensor;
  const result = Array.from(output.dataSync()).map(v => Math.max(0, v));
  tensor.dispose();
  output.dispose();
  return result;
}

function annPredictBatch(model: tf.LayersModel, xs: number[][]): number[][] {
  const tensor = tf.tensor2d(xs);
  const output = model.predict(tensor) as tf.Tensor;
  const flat = Array.from(output.dataSync());
  tensor.dispose();
  output.dispose();
  const result: number[][] = [];
  for (let i = 0; i < xs.length; i++) {
    result.push(flat.slice(i * N_TARGETS, (i + 1) * N_TARGETS).map(v => Math.max(0, v)));
  }
  return result;
}

// ─── 2. HMM — Custom Gaussian HMM (5 latent match states) ────────────────────
// Latent states capture unobservable match dynamics.
// Emissions are Gaussian distributions fitted to the data per cluster.
// States: very_defensive, defensive, balanced, attacking, very_attacking

const HMM_STATES = ["very_defensive", "defensive", "balanced", "attacking", "very_attacking"] as const;
type HMMState = typeof HMM_STATES[number];

const HMM_XG_FACTOR: Record<HMMState, number> = {
  very_defensive: 0.65,
  defensive: 0.82,
  balanced: 1.00,
  attacking: 1.20,
  very_attacking: 1.40,
};

// xg(0,1), goals_scored(2,3), goals_conceded(4,5), big_chances(6,7),
// phase_attack(44,45), form_strength(54,55), h1_xg(64,65), h2_xg(78,79)
const HMM_FEATURE_IDX = [0, 1, 2, 3, 4, 5, 6, 7, 44, 45, 54, 55, 64, 65, 78, 79];

interface HMMModel {
  means: number[][];
  stds: number[][];
  priors: number[];
}

function fitHMM(normFeatures: number[][], targets: number[][]): HMMModel {
  const K = 5;
  const fIdx = HMM_FEATURE_IDX;
  const X = normFeatures.map(f => fIdx.map(i => f[i]));
  const n = X.length;
  const d = fIdx.length;

  // Sort by total attacking output → bin into 5 equal clusters
  const scores = targets.map((t, i) => ({ i, score: t[0] + t[1] }));
  scores.sort((a, b) => a.score - b.score);

  const chunkSz = Math.ceil(n / K);
  const means: number[][] = [];
  const stds: number[][] = [];

  for (let k = 0; k < K; k++) {
    const chunk = scores.slice(k * chunkSz, (k + 1) * chunkSz).map(e => X[e.i]);
    if (!chunk.length) { means.push(Array(d).fill(0.5)); stds.push(Array(d).fill(0.1)); continue; }
    const m = Array(d).fill(0);
    for (const row of chunk) for (let j = 0; j < d; j++) m[j] += row[j] / chunk.length;
    const s = Array(d).fill(0);
    for (const row of chunk) for (let j = 0; j < d; j++) s[j] += (row[j] - m[j]) ** 2 / chunk.length;
    means.push(m);
    stds.push(s.map(v => Math.sqrt(v) || 0.05));
  }

  return { means, stds, priors: Array(K).fill(1 / K) };
}

function hmmLogProb(x: number[], m: number[], s: number[]): number {
  let lp = 0;
  for (let i = 0; i < m.length; i++) {
    const si = s[i] || 0.01;
    lp -= 0.5 * Math.log(2 * Math.PI * si * si) + (x[i] - m[i]) ** 2 / (2 * si * si);
  }
  return lp;
}

function hmmPredict(normX: number[], model: HMMModel): { state: HMMState; probs: number[]; factor: number } {
  const fVec = HMM_FEATURE_IDX.map(i => normX[i]);
  const logProbs = model.means.map((m, k) => hmmLogProb(fVec, m, model.stds[k]) + Math.log(model.priors[k]));
  const maxLP = Math.max(...logProbs);
  const probs = logProbs.map(lp => Math.exp(lp - maxLP));
  const sum = probs.reduce((a, b) => a + b, 0) || 1;
  const norm = probs.map(p => p / sum);
  const stateIdx = norm.indexOf(Math.max(...norm));
  const factor = norm.reduce((s, p, k) => s + p * HMM_XG_FACTOR[HMM_STATES[k]], 0);
  return { state: HMM_STATES[stateIdx], probs: norm, factor };
}

// ─── 3. GP — ml-matrix for proper matrix algebra ──────────────────────────────
// Gaussian Process with Squared Exponential (RBF) kernel.
// Posterior variance: σ²(x*) = k(x*, x*) – k_*ᵀ (K + σ²I)⁻¹ k_*
// Uses ml-matrix for numerically stable Cholesky / pseudo-inverse.

interface GPModel {
  inducingX: number[][];
  alpha: number;        // noise
  lengthScale: number;
}

function rbfKernel(a: number[], b: number[], ls: number): number {
  let d2 = 0;
  for (let i = 0; i < a.length; i++) d2 += (a[i] - b[i]) ** 2;
  return Math.exp(-d2 / (2 * ls * ls));
}

function fitGP(normFeatures: number[][], targets: number[][]): GPModel {
  const maxInducing = 60;
  const step = Math.max(1, Math.floor(normFeatures.length / maxInducing));
  const inducingX = normFeatures.filter((_, i) => i % step === 0).slice(0, maxInducing);

  // Median heuristic for length scale
  let totalD2 = 0; let pairs = 0;
  for (let i = 0; i < Math.min(inducingX.length, 25); i++) {
    for (let j = i + 1; j < Math.min(inducingX.length, 25); j++) {
      let d2 = 0;
      for (let k = 0; k < inducingX[0].length; k++) d2 += (inducingX[i][k] - inducingX[j][k]) ** 2;
      totalD2 += d2; pairs++;
    }
  }
  const lengthScale = pairs > 0 ? Math.sqrt(totalD2 / pairs) * 0.4 : 1;

  return { inducingX, alpha: 0.05, lengthScale };
}

function gpPredict(normX: number[], model: GPModel): { variance: number } {
  const { inducingX, alpha, lengthScale: ls } = model;
  const m = inducingX.length;

  // Build K (m×m) kernel matrix with noise diagonal
  const K = new Matrix(m, m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      K.set(i, j, rbfKernel(inducingX[i], inducingX[j], ls) + (i === j ? alpha : 0));
    }
  }

  // k_star: kernel between test point and inducing points (m×1)
  const kStar = new Matrix(m, 1);
  for (let i = 0; i < m; i++) kStar.set(i, 0, rbfKernel(normX, inducingX[i], ls));

  // Posterior variance: k** - k_*^T K^{-1} k_*
  // Use pseudo-inverse from ml-matrix for numerical stability
  let KInv: Matrix;
  try {
    KInv = Matrix.pseudoInverse(K);
  } catch {
    // Fallback to diagonal approximation
    KInv = Matrix.zeros(m, m);
    for (let i = 0; i < m; i++) KInv.set(i, i, 1 / (K.get(i, i) || 1));
  }

  const reduction = kStar.transpose().mmul(KInv).mmul(kStar).get(0, 0);
  const kSelf = 1.0; // RBF(x, x) = 1
  const epistemicVar = Math.max(0, kSelf - reduction);
  const variance = epistemicVar + 0.04; // aleatoric noise floor

  return { variance };
}

// ─── 4. GARCH(1,1) — Custom (no npm equivalent exists) ────────────────────────
// Estimates time-series volatility of goal scoring.
// σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}

interface GARCHModel {
  omega: number; alpha: number; beta: number;
  longRunVar: number; residualStd: number;
}

function fitGARCH(targets: number[][]): GARCHModel {
  const totalGoals = targets.map(t => t[0] + t[1]);
  const mu = arrMean(totalGoals);
  const residuals = totalGoals.map(g => g - mu);
  const varR = arrMean(residuals.map(r => r * r));
  const alpha = 0.15, beta = 0.75;
  const omega = varR * (1 - alpha - beta);
  return { omega, alpha, beta, longRunVar: varR, residualStd: arrStd(residuals) };
}

function garchVolatility(rawXg: number, model: GARCHModel): { label: string; factor: number } {
  const eps2 = (rawXg - model.longRunVar) ** 2;
  const sigma2 = model.omega + model.alpha * eps2 + model.beta * model.longRunVar;
  const factor = clamp(Math.sqrt(sigma2 / (model.longRunVar || 1)), 0.7, 1.6);
  return { factor, label: factor < 0.9 ? "Low" : factor < 1.1 ? "Medium" : "High" };
}

// ─── 5. SVM — Kernel SVM via gradient descent (custom, no libsvm-js to avoid WASM async) ──
// Linear SVM with hinge loss + L2 regularization.
// Classifies high-scoring vs low-scoring games as a boundary correction signal.

interface SVMModel { weights: number[]; bias: number; threshold: number }

function fitSVM(normFeatures: number[][], targets: number[][]): SVMModel {
  const n = normFeatures.length;
  const d = normFeatures[0].length;
  const mu = arrMean(targets.map(t => t[0] + t[1]));
  const labels = targets.map(t => (t[0] + t[1]) > mu ? 1 : -1);

  const w = Array(d).fill(0);
  let b = 0;
  const lambda = 0.0005;
  const epochs = 80;

  for (let e = 0; e < epochs; e++) {
    const lr = 0.01 / (1 + 0.05 * e);
    // Shuffle indices
    const idx = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5);
    for (const i of idx) {
      const x = normFeatures[i];
      const y = labels[i];
      const margin = y * (dot(w, x) + b);
      if (margin < 1) {
        for (let j = 0; j < d; j++) w[j] -= lr * (lambda * w[j] - y * x[j]);
        b -= lr * (-y);
      } else {
        for (let j = 0; j < d; j++) w[j] -= lr * lambda * w[j];
      }
    }
  }

  return { weights: w, bias: b, threshold: mu };
}

function svmCorrect(normX: number[], model: SVMModel): { correction: number; score: number } {
  const score = dot(model.weights, normX) + model.bias;
  return { score, correction: clamp(score * 0.04, -0.25, 0.25) };
}

// ─── 6. Random Forest — ml-random-forest (real CART trees, bootstrap sampling) ─
// Trains one RandomForestRegression per output target (multi-output standard).
// Uses the Gini impurity / variance reduction criterion from ml-cart internally.

interface RFState { modelJsons: string[] } // one JSON per target

async function fitRF(
  normFeatures: number[][], targets: number[][],
  onProgress?: (pct: number) => void
): Promise<{ models: RandomForestRegression[]; state: RFState }> {
  const models: RandomForestRegression[] = [];
  const modelJsons: string[] = [];

  for (let t = 0; t < N_TARGETS; t++) {
    onProgress?.((t / N_TARGETS) * 100);
    // Yield to event loop between targets so server stays responsive
    await new Promise(resolve => setImmediate(resolve));
    const y = targets.map(row => row[t]);
    const rf = new RandomForestRegression({
      nEstimators: 50,
      maxFeatures: 0.65,
      replacement: true,
      useSampleBagging: true,
      treeOptions: { maxDepth: 6, minNumSamples: 3 },
      seed: 42 + t,
    });
    rf.train(normFeatures, y);
    models.push(rf);
    modelJsons.push(JSON.stringify(rf.toJSON()));
  }

  return { models, state: { modelJsons } };
}

function restoreRF(state: RFState): RandomForestRegression[] {
  return state.modelJsons.map(json =>
    RandomForestRegression.load(JSON.parse(json))
  );
}

function rfPredict(normX: number[], models: RandomForestRegression[]): number[] {
  return models.map(model => {
    const pred = model.predict([normX]);
    return Math.max(0, Array.isArray(pred) ? pred[0] : pred);
  });
}

// ─── 7. GBM — ml-cart CART trees in a Gradient Boosting loop ─────────────────
// Genuine Gradient Boosting using DecisionTreeRegression from ml-cart.
// Each iteration fits a CART tree to the current pseudo-residuals (negative gradient).

interface GBMState {
  basePredictions: number[];
  treesPerTarget: Array<Array<{ modelJson: string; lr: number }>>;
}

async function fitGBM(
  normFeatures: number[][], targets: number[][],
  nIter = 30, initLr = 0.08,
  onProgress?: (pct: number) => void
): Promise<{ state: GBMState }> {
  const basePredictions = Array(N_TARGETS).fill(0).map((_, t) =>
    arrMean(targets.map(y => y[t]))
  );

  const treesPerTarget: Array<Array<{ modelJson: string; lr: number }>> = [];

  for (let t = 0; t < N_TARGETS; t++) {
    const trees: Array<{ modelJson: string; lr: number }> = [];
    let current = targets.map((_, i) => basePredictions[t]);

    for (let iter = 0; iter < nIter; iter++) {
      onProgress?.(((t * nIter + iter) / (N_TARGETS * nIter)) * 100);
      // Yield to event loop every 5 iterations so server stays responsive
      if (iter % 5 === 0) await new Promise(resolve => setImmediate(resolve));
      // Pseudo-residuals: negative gradient of MSE = -(target - prediction)
      const residuals = targets.map((y, i) => y[t] - current[i]);

      const tree = new DecisionTreeRegression({ maxDepth: 3, minNumSamples: 2 });
      tree.train(normFeatures, residuals);

      const iterLr = initLr * (1 / (1 + 0.02 * iter));
      for (let i = 0; i < normFeatures.length; i++) {
        const res = tree.predict([normFeatures[i]]);
        current[i] += iterLr * (Array.isArray(res) ? res[0] : res);
      }

      trees.push({ modelJson: JSON.stringify(tree.toJSON()), lr: iterLr });
    }
    treesPerTarget.push(trees);
  }

  return { state: { basePredictions, treesPerTarget } };
}

function restoreGBM(state: GBMState): {
  basePredictions: number[];
  treesPerTarget: Array<Array<{ tree: DecisionTreeRegression; lr: number }>>;
} {
  return {
    basePredictions: state.basePredictions,
    treesPerTarget: state.treesPerTarget.map(trees =>
      trees.map(({ modelJson, lr }) => ({
        tree: DecisionTreeRegression.load(JSON.parse(modelJson)),
        lr,
      }))
    ),
  };
}

function gbmPredict(normX: number[], gbm: ReturnType<typeof restoreGBM>): number[] {
  return gbm.basePredictions.map((base, t) => {
    let pred = base;
    for (const { tree, lr } of gbm.treesPerTarget[t]) {
      const res = tree.predict([normX]);
      pred += lr * (Array.isArray(res) ? res[0] : res);
    }
    return Math.max(0, pred);
  });
}

// ─── 8. Causal Model — ml-regression MultivariateLinearRegression (OLS) ────────
// Estimates causal effect of key factors on xG using Ordinary Least Squares.
// "What would xG be if conditions were different?"
// OLS coefficient for each feature tells us its causal contribution.

interface CausalState { modelJson: string; featureMeans: number[] }

const CAUSAL_KEY_FEATURES = [
  "home_avg_xg", "away_avg_xg",
  "home_phase_defensive", "away_phase_defensive",
  "home_phase_attack", "away_phase_attack",
  "home_scoring_strength", "away_scoring_strength",
  "home_defending_strength", "away_defending_strength",
  "home_form_strength", "away_form_strength",
  "home_avg_big_chances", "away_avg_big_chances",
  "home_h1_avg_xg", "away_h1_avg_xg",
  "home_h2_avg_xg", "away_h2_avg_xg",
];

function fitCausal(normFeatures: number[][], targets: number[][]): {
  model: MultivariateLinearRegression;
  state: CausalState;
  featureMeans: number[];
} {
  // MultivariateLinearRegression from ml-regression: handles multi-output OLS natively
  const mlr = new MultivariateLinearRegression(normFeatures, targets, { intercept: true });
  // Baseline = mean of each normalised feature across training set (correct baseline in [0,1] space)
  const featureMeans = FEATURE_NAMES.map((_, i) => arrMean(normFeatures.map(f => f[i])));
  return {
    model: mlr,
    state: { modelJson: JSON.stringify(mlr.toJSON()), featureMeans },
    featureMeans,
  };
}

function restoreCausal(state: CausalState): { model: MultivariateLinearRegression; featureMeans: number[] } {
  return {
    model: MultivariateLinearRegression.load(JSON.parse(state.modelJson)),
    featureMeans: state.featureMeans,
  };
}

function causalAnalysis(
  normX: number[],
  causal: { model: MultivariateLinearRegression; featureMeans: number[] }
): { delta: number[]; explanation: Record<string, number> } {
  const predX = causal.model.predict([normX])[0] as number[];
  const predMean = causal.model.predict([causal.featureMeans])[0] as number[];
  const delta = predX.map((v, i) => v - predMean[i]);

  // Per-feature causal contribution (coefficient × feature value)
  const explanation: Record<string, number> = {};
  for (const fname of CAUSAL_KEY_FEATURES) {
    const idx = FEATURE_NAMES.indexOf(fname);
    if (idx >= 0) {
      // Approximate causal effect: difference from baseline at that feature
      const perturbed = [...causal.featureMeans];
      perturbed[idx] = normX[idx];
      const predPerturbed = causal.model.predict([perturbed])[0] as number[];
      explanation[fname] = +(predPerturbed[0] - predMean[0]).toFixed(4);
    }
  }

  return { delta, explanation };
}

// ─── 9. Meta-Learner — OLS regression over stacked model outputs ────────────────
// Learns optimal combination weights: final_xG = w₁·ANN + w₂·RF + w₃·GBM + bias
// Uses MultivariateLinearRegression (OLS) on held-out stacked predictions.

interface MetaState { modelJson: string }

function fitMeta(
  annPreds: number[][], rfPreds: number[][], gbmPreds: number[][],
  targets: number[][]
): { model: MultivariateLinearRegression; state: MetaState } {
  // Stack: [ann_0, ann_1, ..., rf_0, rf_1, ..., gbm_0, gbm_1, ...]
  const X = annPreds.map((a, i) => [...a, ...rfPreds[i], ...gbmPreds[i]]);
  const mlr = new MultivariateLinearRegression(X, targets, { intercept: true });
  return { model: mlr, state: { modelJson: JSON.stringify(mlr.toJSON()) } };
}

function restoreMeta(state: MetaState): MultivariateLinearRegression {
  return MultivariateLinearRegression.load(JSON.parse(state.modelJson));
}

function metaPredict(
  annPred: number[], rfPred: number[], gbmPred: number[],
  model: MultivariateLinearRegression
): number[] {
  const stacked = [...annPred, ...rfPred, ...gbmPred];
  const result = model.predict([stacked])[0] as number[];
  return result.map(v => Math.max(0, v));
}

// ─── Engine State (serialised to SQLite) ─────────────────────────────────────
interface PersistedState {
  scaler: Scaler;
  rawFeatureMeans: number[];
  ann: ANNState;
  hmm: HMMModel;
  gp: GPModel;
  garch: GARCHModel;
  svm: SVMModel;
  rf: RFState;
  gbm: GBMState;
  causal: CausalState;
  meta: MetaState;
  leagueEncoding: Record<string, number>;   // league name → integer label (0 = unknown)
  countryEncoding: Record<string, number>;  // country name → integer label (0 = unknown)
}

// ─── Public types ─────────────────────────────────────────────────────────────
export interface EngineStatus {
  trained: boolean;
  trainingSamples: number;
  trainedAt: string | null;
  metrics: Record<string, number>;
  libraries: Record<string, string>;
}

export interface XGPrediction {
  homeFullTimeXg: number;
  awayFullTimeXg: number;
  homeFirstHalfXg: number;
  awayFirstHalfXg: number;
  homeSecondHalfXg: number;
  awaySecondHalfXg: number;
  confidence: number;
  volatility: string;
  volatilityFactor: number;
  matchState: string;
  stateProbabilities: number[];
  svmCorrection: number;
  causalDelta: number[];
  causalExplanation: Record<string, number>;
  componentPredictions: {
    ann: number[];
    rf: number[];
    gbm: number[];
    hmm: { state: string; factor: number };
    garch: { label: string; factor: number };
    svm: { correction: number; score: number };
    gp: { variance: number };
    meta: number[];
  };
  derived: {
    totalXg: number;
    bttsProbability: number;
    over25Probability: number;
    resultProbabilities: { home: number; draw: number; away: number };
  };
  featuresUsed: Record<string, number>;
}

// ─── Main Engine ──────────────────────────────────────────────────────────────
class XGEngine {
  private persisted: PersistedState | null = null;

  // Hydrated (live) models
  private annModel: tf.LayersModel | null = null;
  private rfModels: RandomForestRegression[] | null = null;
  private gbmLive: ReturnType<typeof restoreGBM> | null = null;
  private causalLive: { model: MultivariateLinearRegression; featureMeans: number[] } | null = null;
  private metaModel: MultivariateLinearRegression | null = null;

  /** Clear all in-memory model state (call after deleting from DB) */
  reset() {
    if (this.annModel) {
      try { this.annModel.dispose(); } catch {}
    }
    this.annModel    = null;
    this.rfModels    = null;
    this.gbmLive     = null;
    this.causalLive  = null;
    this.metaModel   = null;
    this.persisted   = null;
  }

  async load(): Promise<boolean> {
    try {
      const row: any = db.prepare("SELECT weights FROM engine_models WHERE model_name = 'full_engine'").get();
      if (!row) return false;
      const parsed = JSON.parse(row.weights) as PersistedState;
      // Validate that the saved state matches the current engine format
      if (!parsed?.ann?.weightData || !parsed?.rf?.modelJsons || !parsed?.gbm?.treesPerTarget) {
        console.warn("Engine: saved model is from old format — clearing. Please retrain.");
        db.prepare("DELETE FROM engine_models WHERE model_name = 'full_engine'").run();
        return false;
      }
      // Validate feature count — if the saved scaler/weights were trained with a different
      // number of features than the current FEATURE_NAMES list, we must discard the model.
      const savedFeatureCount = parsed.scaler?.min?.length ?? 0;
      if (savedFeatureCount > 0 && savedFeatureCount !== N_FEATURES) {
        console.warn(`Engine: feature count mismatch (saved=${savedFeatureCount}, current=${N_FEATURES}) — clearing. Please retrain.`);
        db.prepare("DELETE FROM engine_models WHERE model_name = 'full_engine'").run();
        return false;
      }
      // Only assign persisted AFTER all validation passes, so a later _hydrate()
      // failure does not leave stale data in memory.
      const toHydrate = parsed;
      this.persisted = toHydrate;
      await this._hydrate();
      return true;
    } catch (e) {
      console.warn("Engine load failed (format mismatch?) — clearing saved model:", (e as Error).message);
      // Clear both DB and in-memory state so predict() cannot retry stale weights.
      this.persisted = null;
      this.annModel = null;
      try { db.prepare("DELETE FROM engine_models WHERE model_name = 'full_engine'").run(); } catch {}
      return false;
    }
  }

  private async _hydrate() {
    if (!this.persisted) return;
    const p = this.persisted;
    this.annModel = await restoreANN(p.ann);
    this.rfModels = restoreRF(p.rf);
    this.gbmLive = restoreGBM(p.gbm);
    this.causalLive = restoreCausal(p.causal);
    this.metaModel = restoreMeta(p.meta);
  }

  private _save(p: PersistedState, samples: number, metrics: Record<string, number>) {
    db.prepare(`
      INSERT OR REPLACE INTO engine_models (model_name, weights, trained_at, training_samples, metrics)
      VALUES ('full_engine', ?, ?, ?, ?)
    `).run(JSON.stringify(p), new Date().toISOString(), samples, JSON.stringify(metrics));
    this.persisted = p;
  }

  getStatus(): EngineStatus {
    try {
      const row: any = db.prepare(
        "SELECT trained_at, training_samples, metrics FROM engine_models WHERE model_name = 'full_engine'"
      ).get();
      return {
        trained: !!row,
        trainingSamples: row?.training_samples ?? 0,
        trainedAt: row?.trained_at ?? null,
        metrics: JSON.parse(row?.metrics ?? "{}"),
        libraries: {
          ANN: "@tensorflow/tfjs (Adam, real backprop)",
          RF: "ml-random-forest (CART trees, bootstrap)",
          GBM: "ml-cart (DecisionTreeRegression, gradient boosting)",
          Causal: "ml-regression (MultivariateLinearRegression OLS)",
          Meta: "ml-regression (MultivariateLinearRegression OLS)",
          GP: "ml-matrix (pseudo-inverse, RBF kernel)",
          HMM: "Custom Gaussian HMM (5 latent states)",
          GARCH: "Custom GARCH(1,1)",
          SVM: "Custom SVM (hinge loss, SGD)",
        },
      };
    } catch {
      return { trained: false, trainingSamples: 0, trainedAt: null, metrics: {}, libraries: {} };
    }
  }

  async train(onProgress?: (pct: number, msg: string) => void): Promise<{ samples: number; metrics: Record<string, number> }> {
    const rows: any[] = db
      .prepare("SELECT * FROM match_simulations WHERE home_goals IS NOT NULL AND away_goals IS NOT NULL")
      .all();

    if (rows.length < 5) throw new Error(`Need at least 5 matches. Currently have ${rows.length}.`);

    const prog = (pct: number, msg: string) => onProgress?.(pct, msg);

    prog(2, "Extracting features from database...");

    // ── Build league / country label encodings from training data ──────────────
    // Sorted alphabetically so the integer labels are deterministic.
    // 0 is reserved for "unknown" (leagues/countries not seen during training).
    const uniqueLeagues = [...new Set(rows.map((r: any) => (r.tournament as string) || ""))].sort();
    const uniqueCountries = [...new Set(rows.map((r: any) => (r.country as string) || ""))].sort();
    const leagueEncoding: Record<string, number> = {};
    uniqueLeagues.forEach((l, i) => { leagueEncoding[l] = i + 1; });
    const countryEncoding: Record<string, number> = {};
    uniqueCountries.forEach((c, i) => { countryEncoding[c] = i + 1; });
    console.log(`[Engine] Encoding ${uniqueLeagues.length} leagues, ${uniqueCountries.length} countries.`);

    // Augment each training row with encoded league/country integers.
    const augmentedRows = rows.map((r: any) => ({
      ...r,
      league_encoded:  leagueEncoding[r.tournament ?? ""]  ?? 0,
      country_encoded: countryEncoding[r.country ?? ""]    ?? 0,
    }));

    const rawFeatures = augmentedRows.map((r: any) => extractFeatures(r));
    const allTargets = rows.map((r: any) => extractTargets(r));

    prog(5, "Fitting min-max scaler...");
    const scaler = fitScaler(rawFeatures);
    const normFeatures = rawFeatures.map(f => applyScaler(f, scaler));
    const rawFeatureMeans = FEATURE_NAMES.map((_, i) => arrMean(rawFeatures.map(f => f[i])));

    // ── 1. TensorFlow.js ANN ──────────────────────────────────────────────────
    prog(8, "Training ANN with TensorFlow.js (Adam optimizer)...");
    const { model: annLive, state: annState } = await trainANN(normFeatures, allTargets, (e, total) => {
      prog(8 + (e / total) * 22, `TF.js ANN epoch ${e}/${total}...`);
    });
    this.annModel = annLive;
    const annPreds = annPredictBatch(annLive, normFeatures);
    prog(30, "ANN training complete.");
    await new Promise(resolve => setImmediate(resolve));

    // ── 2. HMM ────────────────────────────────────────────────────────────────
    prog(32, "Fitting Hidden Markov Model (5 latent states)...");
    const hmmModel = fitHMM(normFeatures, allTargets);
    await new Promise(resolve => setImmediate(resolve));

    // ── 3. GP ─────────────────────────────────────────────────────────────────
    prog(36, "Fitting Gaussian Process (ml-matrix RBF kernel)...");
    const gpModel = fitGP(normFeatures, allTargets);
    await new Promise(resolve => setImmediate(resolve));

    // ── 4. GARCH ──────────────────────────────────────────────────────────────
    prog(40, "Fitting GARCH(1,1) volatility model...");
    const garchModel = fitGARCH(allTargets);
    await new Promise(resolve => setImmediate(resolve));

    // ── 5. SVM ────────────────────────────────────────────────────────────────
    prog(44, "Training SVM classifier (hinge loss + SGD)...");
    const svmModel = fitSVM(normFeatures, allTargets);
    await new Promise(resolve => setImmediate(resolve));

    // ── 6. Random Forest ──────────────────────────────────────────────────────
    prog(48, "Training Random Forest with ml-random-forest (50 CART trees)...");
    const { models: rfLive, state: rfState } = await fitRF(normFeatures, allTargets, (pct) => {
      prog(48 + pct * 0.14, `RF training target ${Math.round(pct / (100 / N_TARGETS) + 1)}/${N_TARGETS}...`);
    });
    this.rfModels = rfLive;
    const rfPreds = normFeatures.map(x => rfPredict(x, rfLive));
    prog(62, "Random Forest training complete.");

    // ── 7. GBM ────────────────────────────────────────────────────────────────
    prog(64, "Training Gradient Boosting (ml-cart CART trees, 30 iterations)...");
    const { state: gbmState } = await fitGBM(normFeatures, allTargets, 30, 0.08, (pct) => {
      prog(64 + pct * 0.12, `GBM ${pct.toFixed(0)}%...`);
    });
    this.gbmLive = restoreGBM(gbmState);
    const gbmPreds = normFeatures.map(x => gbmPredict(x, this.gbmLive!));
    prog(76, "GBM training complete.");

    // ── 8. Causal ─────────────────────────────────────────────────────────────
    prog(78, "Fitting Causal Model (ml-regression OLS)...");
    const { model: causalModel, state: causalState, featureMeans } = fitCausal(normFeatures, allTargets);
    this.causalLive = { model: causalModel, featureMeans };

    // ── 9. Meta-Learner ───────────────────────────────────────────────────────
    prog(84, "Training Meta-Learner (ml-regression OLS over stacked predictions)...");
    const { model: metaModel, state: metaState } = fitMeta(annPreds, rfPreds, gbmPreds, allTargets);
    this.metaModel = metaModel;

    // ── Evaluation ────────────────────────────────────────────────────────────
    prog(92, "Evaluating model on training set...");
    const auxModels = { hmm: hmmModel, gp: gpModel, garch: garchModel, svm: svmModel };
    let sumMSE = 0, sumMAE = 0, sumH1MSE = 0;
    for (let i = 0; i < rows.length; i++) {
      const p = this._predictLive(normFeatures[i], rawFeatures[i], rawFeatureMeans, scaler, auxModels);
      const y = allTargets[i];
      sumMSE += ((p.homeFullTimeXg - y[0]) ** 2 + (p.awayFullTimeXg - y[1]) ** 2) / 2;
      sumMAE += (Math.abs(p.homeFullTimeXg - y[0]) + Math.abs(p.awayFullTimeXg - y[1])) / 2;
      sumH1MSE += ((p.homeFirstHalfXg - y[2]) ** 2 + (p.awayFirstHalfXg - y[3]) ** 2) / 2;
    }
    const n = rows.length;
    const metrics = {
      mse_ft: +(sumMSE / n).toFixed(4),
      mae_ft: +(sumMAE / n).toFixed(4),
      mse_h1: +(sumH1MSE / n).toFixed(4),
      rmse_ft: +(Math.sqrt(sumMSE / n)).toFixed(4),
      samples: n,
    };

    // ── Persist ───────────────────────────────────────────────────────────────
    prog(97, "Saving model weights to database...");
    const persisted: PersistedState = {
      scaler, rawFeatureMeans, ann: annState, hmm: hmmModel,
      gp: gpModel, garch: garchModel, svm: svmModel,
      rf: rfState, gbm: gbmState, causal: causalState, meta: metaState,
      leagueEncoding, countryEncoding,
    };
    this._save(persisted, n, metrics);

    prog(100, `Training complete! ${n} matches, RMSE ${metrics.rmse_ft} goals.`);
    return { samples: n, metrics };
  }

  private _predictLive(
    normX: number[], rawX: number[], rawFeatureMeans: number[], scaler: Scaler,
    aux?: { hmm: HMMModel; gp: GPModel; garch: GARCHModel; svm: SVMModel }
  ): XGPrediction {
    if (!this.annModel || !this.rfModels || !this.gbmLive || !this.causalLive || !this.metaModel) {
      throw new Error("Engine not trained.");
    }

    // Use passed-in aux models (during training eval) or fall back to persisted
    const models = aux ?? this.persisted;
    if (!models) throw new Error("Engine not trained. Train from the Engine tab first.");

    // Base model predictions
    const annPred = annPredict(this.annModel, normX);
    const rfPred = rfPredict(normX, this.rfModels);
    const gbmPred = gbmPredict(normX, this.gbmLive);

    // Meta-learner combination
    const metaPred = metaPredict(annPred, rfPred, gbmPred, this.metaModel);

    // Auxiliary models
    const hmmResult = hmmPredict(normX, models.hmm);
    const gpResult = gpPredict(normX, models.gp);
    const rawXg = (rawX[0] + rawX[1]) / 2;
    const garchResult = garchVolatility(rawXg, models.garch);
    const svmResult = svmCorrect(normX, models.svm);
    const causalResult = causalAnalysis(normX, this.causalLive);

    // Maximum realistic xG for a single team in standard football.
    // These caps prevent inflated predictions when teams are from non-standard
    // competitions (small-sided, futsal, fantasy leagues, etc.).
    const MAX_FT = 4.5;
    const MAX_HT = 2.8;

    // Final combination:
    //  meta × HMM factor (state-adjusted) + SVM correction + clamped causal delta
    //  Causal delta is clamped to ±0.3 goals and added after HMM scaling
    //  to prevent OLS extrapolation from inflating the final xG.
    const combine = (meta: number, causalD: number, cap: number) =>
      clamp(meta * hmmResult.factor + svmResult.correction + clamp(causalD * 0.08, -0.3, 0.3), 0, cap);

    const hFt = combine(metaPred[0], causalResult.delta[0], MAX_FT);
    const aFt = combine(metaPred[1], causalResult.delta[1], MAX_FT);
    const hH1r = combine(metaPred[2], causalResult.delta[2], MAX_HT);
    const aH1r = combine(metaPred[3], causalResult.delta[3], MAX_HT);
    const hH2r = combine(metaPred[4], causalResult.delta[4], MAX_HT);
    const aH2r = combine(metaPred[5], causalResult.delta[5], MAX_HT);

    // Enforce FT = H1 + H2 consistency.
    // The meta-learner predicts all six values independently which can produce
    // mathematically impossible splits (e.g. H1=2.62, H2=0.00, FT=1.02).
    // We keep FT as the authoritative prediction and rescale H1/H2 proportionally.
    const reconcile = (ft: number, h1: number, h2: number): [number, number] => {
      const sum = h1 + h2;
      if (sum < 1e-6) {
        // No half-time signal — split using typical football scoring ratio (45% / 55%)
        return [+(ft * 0.45).toFixed(2), +(ft * 0.55).toFixed(2)];
      }
      const ratio = ft / sum;
      return [+(h1 * ratio).toFixed(2), +(h2 * ratio).toFixed(2)];
    };
    const [hH1, hH2] = reconcile(hFt, hH1r, hH2r);
    const [aH1, aH2] = reconcile(aFt, aH1r, aH2r);

    // Derived market probabilities (Poisson approximation)
    const totalXg = hFt + aFt;
    const expH = Math.exp(-hFt), expA = Math.exp(-aFt);
    const bttsProbability = clamp((1 - expH) * (1 - expA), 0, 1);
    const over25Probability = clamp(1 - Math.exp(-totalXg) * (1 + totalXg + totalXg ** 2 / 2), 0, 1);
    const homeAdv = hFt / (totalXg || 1);
    const home = clamp(homeAdv * 0.75 + 0.1, 0.1, 0.8);
    const away = clamp((1 - homeAdv) * 0.75 + 0.1, 0.1, 0.8);
    const draw = clamp(1 - home - away + 0.12, 0.1, 0.4);

    const featuresUsed: Record<string, number> = {};
    FEATURE_NAMES.forEach((name, i) => { featuresUsed[name] = +rawX[i].toFixed(3); });

    return {
      homeFullTimeXg: +hFt.toFixed(2),
      awayFullTimeXg: +aFt.toFixed(2),
      homeFirstHalfXg: +hH1.toFixed(2),
      awayFirstHalfXg: +aH1.toFixed(2),
      homeSecondHalfXg: +hH2.toFixed(2),
      awaySecondHalfXg: +aH2.toFixed(2),
      confidence: +Math.sqrt(gpResult.variance).toFixed(3),
      volatility: garchResult.label,
      volatilityFactor: +garchResult.factor.toFixed(3),
      matchState: hmmResult.state,
      stateProbabilities: hmmResult.probs.map(p => +p.toFixed(3)),
      svmCorrection: +svmResult.correction.toFixed(3),
      causalDelta: causalResult.delta.map(d => +d.toFixed(3)),
      causalExplanation: Object.fromEntries(
        Object.entries(causalResult.explanation).map(([k, v]) => [k, +Number(v).toFixed(4)])
      ),
      componentPredictions: {
        ann: annPred.map(v => +v.toFixed(3)),
        rf: rfPred.map(v => +v.toFixed(3)),
        gbm: gbmPred.map(v => +v.toFixed(3)),
        meta: metaPred.map(v => +v.toFixed(3)),
        hmm: { state: hmmResult.state, factor: +hmmResult.factor.toFixed(3) },
        garch: { label: garchResult.label, factor: +garchResult.factor.toFixed(3) },
        svm: { correction: +svmResult.correction.toFixed(3), score: +svmResult.score.toFixed(3) },
        gp: { variance: +gpResult.variance.toFixed(4) },
      },
      derived: {
        totalXg: +totalXg.toFixed(2),
        bttsProbability: +bttsProbability.toFixed(3),
        over25Probability: +over25Probability.toFixed(3),
        resultProbabilities: {
          home: +home.toFixed(3),
          draw: +draw.toFixed(3),
          away: +away.toFixed(3),
        },
      },
      featuresUsed,
    };
  }

  async predict(rawFeatures: number[]): Promise<XGPrediction> {
    if (!this.annModel) await this._hydrate();
    if (!this.annModel || !this.persisted) throw new Error("Engine not trained. Train from the Engine tab first.");
    const normX = applyScaler(rawFeatures, this.persisted.scaler);
    return this._predictLive(normX, rawFeatures, this.persisted.rawFeatureMeans, this.persisted.scaler);
  }

  async predictFromRow(row: Record<string, any>): Promise<XGPrediction> {
    if (!this.annModel) await this._hydrate();
    if (!this.persisted) throw new Error("Engine not trained. Train from the Engine tab first.");
    // Augment with label-encoded league/country using the training-time encoding map.
    // Unknown leagues/countries default to 0 so the engine gracefully handles new competitions.
    const augmented = {
      ...row,
      league_encoded:  this.persisted.leagueEncoding?.[row.tournament  ?? ""] ?? 0,
      country_encoded: this.persisted.countryEncoding?.[row.country ?? ""] ?? 0,
    };
    return this.predict(extractFeatures(augmented));
  }
}

export const engine = new XGEngine();
engine.load().catch(e => console.error("Engine initial load:", e));

export default engine;
