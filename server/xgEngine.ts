/**
 * Multi-Paradigm Probabilistic xG Forecasting Engine
 *
 * Architecture:
 *   ANN  → baseline xG (neural network backprop)
 *   HMM  → match-state adjustment (hidden Markov model)
 *   GP   → uncertainty quantification (Gaussian process)
 *   GARCH→ volatility factor (GARCH(1,1))
 *   SVM  → boundary correction (gradient-descent SVM)
 *   RF   → ensemble refinement (random forest)
 *   GBM  → sequential refinement (gradient boosting)
 *   Causal→ delta adjustment (regression-based causal)
 *   Meta → learned combination of all outputs
 */

import db from "./db";

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS engine_models (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name    TEXT NOT NULL UNIQUE,
    weights       TEXT NOT NULL,
    trained_at    TEXT NOT NULL,
    training_samples INTEGER DEFAULT 0,
    metrics       TEXT DEFAULT '{}'
  )
`);

// ─── Feature names (38 features) ─────────────────────────────────────────────
export const FEATURE_NAMES = [
  "home_avg_xg", "away_avg_xg",
  "home_avg_goals_scored", "away_avg_goals_scored",
  "home_avg_goals_conceded", "away_avg_goals_conceded",
  "home_avg_big_chances", "away_avg_big_chances",
  "home_avg_shots_on_target", "away_avg_shots_on_target",
  "home_avg_shots_inside_box", "away_avg_shots_inside_box",
  "home_avg_possession", "away_avg_possession",
  "home_avg_pass_accuracy", "away_avg_pass_accuracy",
  "home_phase_attack", "away_phase_attack",
  "home_phase_defensive", "away_phase_defensive",
  "home_phase_midfield", "away_phase_midfield",
  "home_form_strength", "away_form_strength",
  "home_scoring_strength", "away_scoring_strength",
  "home_defending_strength", "away_defending_strength",
  "home_avg_goalkeeper_saves", "away_avg_goalkeeper_saves",
  "home_h1_avg_xg", "away_h1_avg_xg",
  "home_h1_avg_goals_scored", "away_h1_avg_goals_scored",
  "home_h1_avg_big_chances", "away_h1_avg_big_chances",
  "home_h1_avg_total_shots", "away_h1_avg_total_shots",
];
export const N_FEATURES = FEATURE_NAMES.length;

export const TARGET_NAMES = [
  "home_ft_xg", "away_ft_xg",
  "home_h1_xg", "away_h1_xg",
  "home_h2_xg", "away_h2_xg",
];
export const N_TARGETS = TARGET_NAMES.length;

// ─── Feature / target extraction ──────────────────────────────────────────────
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
  const hH2 = Math.max(0, hFt - hHt);
  const aH2 = Math.max(0, aFt - aHt);
  return [hFt, aFt, hHt, aHt, hH2, aH2];
}

// ─── Math utilities ───────────────────────────────────────────────────────────
function relu(x: number) { return x > 0 ? x : 0; }
function clamp(x: number, lo: number, hi: number) { return x < lo ? lo : x > hi ? hi : x; }
function sigmoid(x: number) { return 1 / (1 + Math.exp(-x)); }

function randGauss(): number {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function vecAdd(a: number[], b: number[]): number[] { return a.map((v, i) => v + b[i]); }
function vecScale(a: number[], s: number): number[] { return a.map(v => v * s); }
function vecSub(a: number[], b: number[]): number[] { return a.map((v, i) => v - b[i]); }

function arrMean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function arrStd(arr: number[], m = arrMean(arr)): number {
  if (arr.length < 2) return 1;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length) || 1;
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
  const scale = min.map((mn, i) => (max[i] - mn) || 1);
  return { min, scale };
}

export function applyScaler(x: number[], scaler: Scaler): number[] {
  return x.map((v, i) => (v - scaler.min[i]) / scaler.scale[i]);
}

// ─── 1. ANN (Artificial Neural Network) ──────────────────────────────────────
// 2-hidden-layer MLP trained with SGD backpropagation
// D → H1 (ReLU) → H2 (ReLU) → O (linear + clamp ≥0)

interface ANNState {
  W1: number[][];
  b1: number[];
  W2: number[][];
  b2: number[];
  W3: number[][];
  b3: number[];
  D: number; H1: number; H2: number; O: number;
}

class ANN {
  W1: number[][];
  b1: number[];
  W2: number[][];
  b2: number[];
  W3: number[][];
  b3: number[];
  D: number; H1: number; H2: number; O: number;

  constructor(D: number, H1: number, H2: number, O: number) {
    this.D = D; this.H1 = H1; this.H2 = H2; this.O = O;
    const s1 = Math.sqrt(2 / D);
    const s2 = Math.sqrt(2 / H1);
    const s3 = Math.sqrt(2 / H2);
    this.W1 = Array.from({ length: H1 }, () => Array.from({ length: D }, () => randGauss() * s1));
    this.b1 = Array(H1).fill(0);
    this.W2 = Array.from({ length: H2 }, () => Array.from({ length: H1 }, () => randGauss() * s2));
    this.b2 = Array(H2).fill(0);
    this.W3 = Array.from({ length: O }, () => Array.from({ length: H2 }, () => randGauss() * s3));
    this.b3 = Array(O).fill(0.5);
  }

  forward(x: number[]): { h1: number[]; h2: number[]; out: number[] } {
    const h1 = this.W1.map((row, i) => relu(dot(row, x) + this.b1[i]));
    const h2 = this.W2.map((row, i) => relu(dot(row, h1) + this.b2[i]));
    const out = this.W3.map((row, i) => Math.max(0, dot(row, h2) + this.b3[i]));
    return { h1, h2, out };
  }

  backward(x: number[], targets: number[], lr: number, lambda = 0.0005): number {
    const { h1, h2, out } = this.forward(x);
    const dOut = out.map((o, i) => 2 * (o - targets[i]) / this.O);

    for (let i = 0; i < this.O; i++) {
      for (let j = 0; j < this.H2; j++)
        this.W3[i][j] -= lr * (dOut[i] * h2[j] + lambda * this.W3[i][j]);
      this.b3[i] -= lr * dOut[i];
    }

    const dH2 = Array(this.H2).fill(0);
    for (let j = 0; j < this.H2; j++) {
      for (let i = 0; i < this.O; i++) dH2[j] += dOut[i] * this.W3[i][j];
      if (h2[j] <= 0) dH2[j] = 0;
    }
    for (let i = 0; i < this.H2; i++) {
      for (let j = 0; j < this.H1; j++)
        this.W2[i][j] -= lr * (dH2[i] * h1[j] + lambda * this.W2[i][j]);
      this.b2[i] -= lr * dH2[i];
    }

    const dH1 = Array(this.H1).fill(0);
    for (let j = 0; j < this.H1; j++) {
      for (let i = 0; i < this.H2; i++) dH1[j] += dH2[i] * this.W2[i][j];
      if (h1[j] <= 0) dH1[j] = 0;
    }
    for (let i = 0; i < this.H1; i++) {
      for (let j = 0; j < this.D; j++)
        this.W1[i][j] -= lr * (dH1[i] * x[j] + lambda * this.W1[i][j]);
      this.b1[i] -= lr * dH1[i];
    }

    return out.reduce((s, o, i) => s + (o - targets[i]) ** 2, 0) / this.O;
  }

  predict(x: number[]): number[] { return this.forward(x).out; }

  toState(): ANNState {
    return { W1: this.W1, b1: this.b1, W2: this.W2, b2: this.b2, W3: this.W3, b3: this.b3, D: this.D, H1: this.H1, H2: this.H2, O: this.O };
  }

  fromState(s: ANNState) {
    this.W1 = s.W1; this.b1 = s.b1; this.W2 = s.W2; this.b2 = s.b2;
    this.W3 = s.W3; this.b3 = s.b3;
  }
}

// ─── 2. HMM (Hidden Markov Model) ────────────────────────────────────────────
// 5 latent match states. Emissions are Gaussian over key offensive feature pairs.
// States: very_defensive, defensive, balanced, attacking, very_attacking
// Each state has a mean vector and diagonal covariance.
// The state probabilities modify the xG scaling factor.

const HMM_STATES = ["very_defensive", "defensive", "balanced", "attacking", "very_attacking"] as const;
type HMMState = typeof HMM_STATES[number];

const HMM_STATE_XG_FACTOR: Record<HMMState, number> = {
  very_defensive: 0.65,
  defensive: 0.80,
  balanced: 1.00,
  attacking: 1.20,
  very_attacking: 1.40,
};

interface HMMModel {
  means: number[][];  // [5 states x 6 features]
  stds: number[][];
  priors: number[];   // [5]
  transition: number[][];  // [5 x 5]
  featureIdx: number[];    // which features to use for emissions
}

// Key features for HMM emissions (indices into feature vector)
const HMM_FEATURES = [0, 1, 2, 3, 4, 5, 16, 17]; // xg, goals, conceded, attack

function hmmEmissionLogProb(x: number[], mean: number[], std: number[]): number {
  let lp = 0;
  for (let i = 0; i < mean.length; i++) {
    const diff = x[i] - mean[i];
    const s = std[i] || 0.01;
    lp -= 0.5 * Math.log(2 * Math.PI * s * s) + (diff * diff) / (2 * s * s);
  }
  return lp;
}

function fitHMM(features: number[][], targets: number[][]): HMMModel {
  const K = 5;
  const n = features.length;
  const fIdx = HMM_FEATURES;
  const d = fIdx.length;

  // Extract sub-features
  const X = features.map(f => fIdx.map(i => f[i]));

  // Init K-means style: divide sorted data into K clusters by home_ft_xg + away_ft_xg
  const sortedIdx = targets.map((t, i) => ({ i, score: t[0] + t[1] }))
    .sort((a, b) => a.score - b.score)
    .map(e => e.i);

  const chunkSize = Math.ceil(n / K);
  const means: number[][] = [];
  const stds: number[][] = [];

  for (let k = 0; k < K; k++) {
    const chunk = sortedIdx.slice(k * chunkSize, (k + 1) * chunkSize).map(i => X[i]);
    if (!chunk.length) {
      means.push(Array(d).fill(0.5));
      stds.push(Array(d).fill(0.3));
      continue;
    }
    const m = Array(d).fill(0);
    for (const row of chunk) for (let j = 0; j < d; j++) m[j] += row[j] / chunk.length;
    const s = Array(d).fill(0);
    for (const row of chunk) for (let j = 0; j < d; j++) s[j] += (row[j] - m[j]) ** 2 / chunk.length;
    means.push(m);
    stds.push(s.map(v => Math.sqrt(v) || 0.05));
  }

  // Uniform priors & transition matrix (slight tendency to stay in same state)
  const priors = Array(K).fill(1 / K);
  const transition = Array.from({ length: K }, (_, k) => {
    const row = Array(K).fill(0.1);
    row[k] = 0.6;
    return row;
  });

  return { means, stds, priors, transition, featureIdx: fIdx };
}

function hmmPredict(x: number[], model: HMMModel): { state: HMMState; stateProbabilities: number[]; xgFactor: number } {
  const fVec = model.featureIdx.map(i => x[i]);
  const logProbs = model.means.map((m, k) => hmmEmissionLogProb(fVec, m, model.stds[k]) + Math.log(model.priors[k]));
  const maxLP = Math.max(...logProbs);
  const probs = logProbs.map(lp => Math.exp(lp - maxLP));
  const sumP = probs.reduce((a, b) => a + b, 0) || 1;
  const normalised = probs.map(p => p / sumP);

  const stateIdx = normalised.indexOf(Math.max(...normalised));
  const state = HMM_STATES[stateIdx];
  const xgFactor = normalised.reduce((s, p, k) => s + p * HMM_STATE_XG_FACTOR[HMM_STATES[k]], 0);

  return { state, stateProbabilities: normalised, xgFactor };
}

// ─── 3. Gaussian Process (uncertainty estimation) ────────────────────────────
// RBF kernel; Nyström approximation using up to 50 inducing points.
// Outputs: posterior variance as confidence measure.

interface GPModel {
  inducingX: number[][];  // up to 50 training points
  inducingY: number[][];  // their targets
  alpha: number;          // noise variance
  lengthScale: number;
}

function rbfKernel(a: number[], b: number[], ls: number): number {
  let d2 = 0;
  for (let i = 0; i < a.length; i++) d2 += (a[i] - b[i]) ** 2;
  return Math.exp(-d2 / (2 * ls * ls));
}

function fitGP(features: number[][], targets: number[][]): GPModel {
  const m = Math.min(50, features.length);
  const step = Math.max(1, Math.floor(features.length / m));
  const inducingX = features.filter((_, i) => i % step === 0).slice(0, m);
  const inducingY = targets.filter((_, i) => i % step === 0).slice(0, m);

  // Estimate length scale from data variance
  let totalVar = 0, cnt = 0;
  for (let i = 0; i < Math.min(inducingX.length, 20); i++) {
    for (let j = i + 1; j < Math.min(inducingX.length, 20); j++) {
      let d2 = 0;
      for (let k = 0; k < inducingX[0].length; k++) d2 += (inducingX[i][k] - inducingX[j][k]) ** 2;
      totalVar += d2; cnt++;
    }
  }
  const lengthScale = cnt > 0 ? Math.sqrt(totalVar / cnt) * 0.5 : 1;

  return { inducingX, inducingY, alpha: 0.01, lengthScale };
}

function gpPredict(x: number[], model: GPModel): { variance: number[] } {
  const ls = model.lengthScale;

  // Kernel between test point and inducing points
  const k_star = model.inducingX.map(xi => rbfKernel(x, xi, ls));

  // Kernel matrix K(Xm, Xm) + noise*I (diagonal approximation)
  const kSelf = 1.0; // rbf(x, x, ls) = 1.0

  // Approximate posterior variance via diagonal GP approximation
  const diagK = model.inducingX.map(xi => rbfKernel(xi, xi, ls) + model.alpha);
  const kInvK = k_star.map((k, i) => k / diagK[i]);
  const reduction = clamp(dot(k_star, kInvK), 0, 0.98);

  // Base variance (epistemic) + aleatoric noise floor
  const epistemicVar = Math.max(0, kSelf - reduction);
  const minNoise = 0.05; // minimum uncertainty floor (~±0.22 goals)

  const variance: number[] = Array(N_TARGETS).fill(epistemicVar + minNoise);

  return { variance };
}

// ─── 4. GARCH(1,1) – Volatility Model ─────────────────────────────────────────
// Tracks time-series variance of residuals to compute a volatility factor.

interface GARCHModel {
  omega: number;
  alpha: number;  // ARCH coefficient
  beta: number;   // GARCH coefficient
  longRunVar: number;
  residualStd: number;
}

function fitGARCH(targets: number[][]): GARCHModel {
  const totalGoals = targets.map(t => t[0] + t[1]); // home + away goals
  const mu = arrMean(totalGoals);
  const residuals = totalGoals.map(g => g - mu);

  // Simple MLE-style estimation via moment matching
  const varResid = arrMean(residuals.map(r => r * r));
  // GARCH(1,1): ω/(1 - α - β) = long-run variance; use α=0.15, β=0.75
  const alpha = 0.15;
  const beta = 0.75;
  const omega = varResid * (1 - alpha - beta);

  return { omega, alpha, beta, longRunVar: varResid, residualStd: arrStd(residuals) };
}

function garchVolatilityFactor(featureXg: number, model: GARCHModel): { factor: number; label: string } {
  // Estimate current conditional variance
  const eps2 = (featureXg - model.longRunVar) ** 2;
  const sigma2 = model.omega + model.alpha * eps2 + model.beta * model.longRunVar;
  const factor = Math.sqrt(sigma2 / (model.longRunVar || 1));
  const label = factor < 0.9 ? "Low" : factor < 1.1 ? "Medium" : "High";
  return { factor: clamp(factor, 0.7, 1.5), label };
}

// ─── 5. SVM (Support Vector Machine) ─────────────────────────────────────────
// Linear SVM for boundary correction (high/low scoring binary classification).
// Trained with hinge loss + L2 reg via SGD.

interface SVMModel {
  weights: number[];
  bias: number;
  threshold: number;
}

function fitSVM(features: number[][], targets: number[][]): SVMModel {
  const n = features.length;
  const d = features[0].length;
  const mu = arrMean(targets.map(t => t[0] + t[1]));

  // Binary labels: +1 = high scoring (total > mu), -1 = low scoring
  const labels = targets.map(t => (t[0] + t[1]) > mu ? 1 : -1);

  const w = Array(d).fill(0);
  let b = 0;
  const lr = 0.01;
  const lambda = 0.001;
  const epochs = 50;

  for (let e = 0; e < epochs; e++) {
    const lrE = lr * (1 / (1 + 0.1 * e));
    for (let i = 0; i < n; i++) {
      const x = features[i];
      const y = labels[i];
      const margin = y * (dot(w, x) + b);
      if (margin < 1) {
        // Hinge loss gradient
        for (let j = 0; j < d; j++) w[j] -= lrE * (lambda * w[j] - y * x[j]);
        b -= lrE * (-y);
      } else {
        for (let j = 0; j < d; j++) w[j] -= lrE * lambda * w[j];
      }
    }
  }

  return { weights: w, bias: b, threshold: mu };
}

function svmCorrection(x: number[], model: SVMModel): { correction: number; score: number } {
  const score = dot(model.weights, x) + model.bias;
  // Map decision score to xG correction: positive → upward correction
  const correction = clamp(score * 0.05, -0.3, 0.3);
  return { correction, score };
}

// ─── 6. Random Forest ─────────────────────────────────────────────────────────
// Ensemble of shallow decision trees with bootstrap sampling.

interface TreeNode {
  feature?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
  value?: number[];
}

function buildTree(X: number[][], Y: number[][], maxDepth: number, featureSubset: number[]): TreeNode {
  if (!X.length) return { value: Array(N_TARGETS).fill(0) };
  if (maxDepth === 0 || X.length <= 2) {
    const val = Array(N_TARGETS).fill(0);
    for (let t = 0; t < N_TARGETS; t++) val[t] = arrMean(Y.map(y => y[t]));
    return { value: val };
  }

  let bestFeature = -1, bestThreshold = 0, bestGain = -Infinity;
  const parentVar = Array(N_TARGETS).fill(0);
  for (let t = 0; t < N_TARGETS; t++) {
    const ym = arrMean(Y.map(y => y[t]));
    parentVar[t] = arrMean(Y.map(y => (y[t] - ym) ** 2));
  }
  const parentImpurity = arrMean(parentVar);

  for (const f of featureSubset) {
    const vals = [...new Set(X.map(x => x[f]))].sort((a, b) => a - b);
    for (let v = 0; v < vals.length - 1; v++) {
      const thresh = (vals[v] + vals[v + 1]) / 2;
      const leftY = Y.filter((_, i) => X[i][f] <= thresh);
      const rightY = Y.filter((_, i) => X[i][f] > thresh);
      if (!leftY.length || !rightY.length) continue;
      let leftImp = 0, rightImp = 0;
      for (let t = 0; t < N_TARGETS; t++) {
        const lm = arrMean(leftY.map(y => y[t]));
        const rm = arrMean(rightY.map(y => y[t]));
        leftImp += arrMean(leftY.map(y => (y[t] - lm) ** 2));
        rightImp += arrMean(rightY.map(y => (y[t] - rm) ** 2));
      }
      leftImp /= N_TARGETS; rightImp /= N_TARGETS;
      const gain = parentImpurity - (leftY.length / X.length) * leftImp - (rightY.length / X.length) * rightImp;
      if (gain > bestGain) { bestGain = gain; bestFeature = f; bestThreshold = thresh; }
    }
  }

  if (bestFeature === -1) {
    const val = Array(N_TARGETS).fill(0);
    for (let t = 0; t < N_TARGETS; t++) val[t] = arrMean(Y.map(y => y[t]));
    return { value: val };
  }

  const leftX = X.filter(x => x[bestFeature] <= bestThreshold);
  const leftY = Y.filter((_, i) => X[i][bestFeature] <= bestThreshold);
  const rightX = X.filter(x => x[bestFeature] > bestThreshold);
  const rightY = Y.filter((_, i) => X[i][bestFeature] > bestThreshold);

  return {
    feature: bestFeature,
    threshold: bestThreshold,
    left: buildTree(leftX, leftY, maxDepth - 1, featureSubset),
    right: buildTree(rightX, rightY, maxDepth - 1, featureSubset),
  };
}

function treePredict(node: TreeNode, x: number[]): number[] {
  if (node.value) return node.value;
  if (x[node.feature!] <= node.threshold!) return treePredict(node.left!, x);
  return treePredict(node.right!, x);
}

interface RFModel { trees: TreeNode[] }

function fitRF(features: number[][], targets: number[][], nTrees = 30): RFModel {
  const n = features.length;
  const d = features[0].length;
  const nFeat = Math.max(1, Math.floor(Math.sqrt(d)));
  const trees: TreeNode[] = [];

  for (let t = 0; t < nTrees; t++) {
    // Bootstrap sample
    const idx = Array.from({ length: n }, () => Math.floor(Math.random() * n));
    const X = idx.map(i => features[i]);
    const Y = idx.map(i => targets[i]);
    // Random feature subset
    const feats = Array.from({ length: d }, (_, i) => i)
      .sort(() => Math.random() - 0.5).slice(0, nFeat + Math.floor(d * 0.3));
    trees.push(buildTree(X, Y, 5, feats));
  }

  return { trees };
}

function rfPredict(x: number[], model: RFModel): number[] {
  const preds = model.trees.map(tree => treePredict(tree, x));
  const avg = Array(N_TARGETS).fill(0);
  for (const p of preds) for (let i = 0; i < N_TARGETS; i++) avg[i] += p[i] / preds.length;
  return avg;
}

// ─── 7. Gradient Boosting Machine ─────────────────────────────────────────────
// Sequential shallow trees that fit residuals. Separate model per output.

interface GBMModel {
  basePrediction: number[];
  trees: Array<{ tree: TreeNode; lr: number }[]>; // [target][iteration]
}

function fitGBM(features: number[][], targets: number[][], nIter = 40, lr = 0.1): GBMModel {
  const n = features.length;
  const basePrediction = Array(N_TARGETS).fill(0);
  for (let t = 0; t < N_TARGETS; t++) basePrediction[t] = arrMean(targets.map(y => y[t]));

  const allTrees: Array<{ tree: TreeNode; lr: number }[]> = Array.from({ length: N_TARGETS }, () => []);

  for (let t = 0; t < N_TARGETS; t++) {
    let current = Array(n).fill(basePrediction[t]);
    const d = features[0].length;
    const nFeat = Math.max(1, Math.floor(Math.sqrt(d)));

    for (let iter = 0; iter < nIter; iter++) {
      const residuals = targets.map((y, i) => [y[t] - current[i]]);
      const feats = Array.from({ length: d }, (_, i) => i)
        .sort(() => Math.random() - 0.5).slice(0, nFeat + Math.floor(d * 0.4));
      const tree = buildTree(features, residuals, 3, feats);

      const iterLr = lr * (1 / (1 + 0.05 * iter));
      for (let i = 0; i < n; i++) {
        current[i] += iterLr * treePredict(tree, features[i])[0];
      }
      allTrees[t].push({ tree, lr: iterLr });
    }
  }

  return { basePrediction, trees: allTrees };
}

function gbmPredict(x: number[], model: GBMModel): number[] {
  return model.basePrediction.map((base, t) => {
    let pred = base;
    for (const { tree, lr } of model.trees[t]) pred += lr * treePredict(tree, x)[0];
    return Math.max(0, pred);
  });
}

// ─── 8. Causal Model (Regression-based) ──────────────────────────────────────
// Estimates the causal effect of key defensive/offensive differences on xG.
// Uses OLS regression coefficients to compute delta adjustments.

interface CausalModel {
  coefficients: number[][];  // [N_TARGETS x D]
  intercepts: number[];
  keyFactors: string[];
}

function fitCausal(features: number[][], targets: number[][]): CausalModel {
  // OLS: β = (X^T X)^{-1} X^T Y via gradient descent
  const n = features.length;
  const d = features[0].length;
  const W = Array.from({ length: N_TARGETS }, () => Array(d).fill(0));
  const b = Array(N_TARGETS).fill(0);
  const lr = 0.001;
  const epochs = 100;

  for (let e = 0; e < epochs; e++) {
    for (let t = 0; t < N_TARGETS; t++) {
      let bGrad = 0;
      const wGrad = Array(d).fill(0);
      for (let i = 0; i < n; i++) {
        const pred = dot(W[t], features[i]) + b[t];
        const err = pred - targets[i][t];
        bGrad += err;
        for (let j = 0; j < d; j++) wGrad[j] += err * features[i][j];
      }
      b[t] -= (lr / n) * bGrad;
      for (let j = 0; j < d; j++) W[t][j] -= (lr / n) * (wGrad[j] + 0.001 * W[t][j]);
    }
  }

  const keyFactors = [
    "home_phase_defensive", "away_phase_defensive",
    "home_scoring_strength", "away_scoring_strength",
    "home_form_strength", "away_form_strength",
  ];

  return { coefficients: W, intercepts: b, keyFactors };
}

function causalDelta(x: number[], baseline: number[], model: CausalModel): { delta: number[]; explanation: Record<string, number> } {
  const delta = Array(N_TARGETS).fill(0);
  for (let t = 0; t < N_TARGETS; t++) {
    const pred = dot(model.coefficients[t], x) + model.intercepts[t];
    const basePred = dot(model.coefficients[t], baseline) + model.intercepts[t];
    delta[t] = pred - basePred;
  }

  const explanation: Record<string, number> = {};
  for (const fname of model.keyFactors) {
    const idx = FEATURE_NAMES.indexOf(fname);
    if (idx >= 0) {
      explanation[fname] = model.coefficients[0][idx] * x[idx];
    }
  }

  return { delta, explanation };
}

// ─── 9. Meta-Learner (Learned Ensemble Combination) ───────────────────────────
// Takes stacked predictions from all base models and learns optimal weights.

interface MetaModel {
  weights: number[][];  // [N_TARGETS x N_base_models]
  biases: number[];
}

function fitMeta(
  annPreds: number[][],
  rfPreds: number[][],
  gbmPreds: number[][],
  targets: number[][]
): MetaModel {
  const n = targets.length;
  const nModels = 3;
  const W = Array.from({ length: N_TARGETS }, () => Array(nModels).fill(1 / nModels));
  const b = Array(N_TARGETS).fill(0);
  const lr = 0.005;
  const epochs = 200;

  for (let e = 0; e < epochs; e++) {
    for (let t = 0; t < N_TARGETS; t++) {
      let bGrad = 0;
      const wGrad = Array(nModels).fill(0);
      for (let i = 0; i < n; i++) {
        const modelPreds = [annPreds[i][t], rfPreds[i][t], gbmPreds[i][t]];
        const pred = dot(W[t], modelPreds) + b[t];
        const err = pred - targets[i][t];
        bGrad += err;
        for (let j = 0; j < nModels; j++) wGrad[j] += err * modelPreds[j];
      }
      b[t] -= (lr / n) * bGrad;
      for (let j = 0; j < nModels; j++) {
        W[t][j] -= (lr / n) * wGrad[j];
        W[t][j] = Math.max(0, W[t][j]); // non-negative weights
      }
      // Normalize weights to sum to ~1
      const sum = W[t].reduce((a, v) => a + v, 0) || 1;
      for (let j = 0; j < nModels; j++) W[t][j] /= sum;
    }
  }

  return { weights: W, biases: b };
}

function metaPredict(
  annPred: number[],
  rfPred: number[],
  gbmPred: number[],
  model: MetaModel
): number[] {
  return Array(N_TARGETS).fill(0).map((_, t) => {
    const preds = [annPred[t], rfPred[t], gbmPred[t]];
    return Math.max(0, dot(model.weights[t], preds) + model.biases[t]);
  });
}

// ─── Engine State ─────────────────────────────────────────────────────────────
export interface EngineState {
  trained: boolean;
  trainingSamples: number;
  trainedAt: string | null;
  metrics: Record<string, number>;
}

interface SerializedEngine {
  scaler: Scaler;
  ann: ANNState;
  hmm: HMMModel;
  gp: GPModel;
  garch: GARCHModel;
  svm: SVMModel;
  rf: RFModel;
  gbm: GBMModel;
  causal: CausalModel;
  meta: MetaModel;
  featureMeans: number[];
}

export interface XGPrediction {
  homeFullTimeXg: number;
  awayFullTimeXg: number;
  homeFirstHalfXg: number;
  awayFirstHalfXg: number;
  homeSecondHalfXg: number;
  awaySecondHalfXg: number;
  confidence: number[];
  volatility: string;
  volatilityFactor: number;
  matchState: string;
  stateProbabilities: number[];
  svmCorrection: number;
  causalDelta: number[];
  causalExplanation: Record<string, number>;
  metaWeights: number[][];
  componentPredictions: {
    ann: number[];
    rf: number[];
    gbm: number[];
    hmm: { state: string; factor: number };
    garch: { label: string; factor: number };
    svm: { correction: number; score: number };
    gp: { variance: number[] };
  };
  derived: {
    totalXg: number;
    bttsProbability: number;
    over25Probability: number;
    resultProbabilities: { home: number; draw: number; away: number };
  };
  featuresUsed: Record<string, number>;
}

// ─── Main Engine Class ────────────────────────────────────────────────────────
class XGEngine {
  private state: SerializedEngine | null = null;

  load(): boolean {
    try {
      const row: any = db.prepare("SELECT weights FROM engine_models WHERE model_name = 'full_engine'").get();
      if (!row) return false;
      this.state = JSON.parse(row.weights);
      return true;
    } catch { return false; }
  }

  save(samples: number, metrics: Record<string, number>) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO engine_models (model_name, weights, trained_at, training_samples, metrics)
      VALUES ('full_engine', ?, ?, ?, ?)
    `).run(JSON.stringify(this.state), now, samples, JSON.stringify(metrics));
  }

  getStatus(): EngineState {
    try {
      const row: any = db.prepare("SELECT trained_at, training_samples, metrics FROM engine_models WHERE model_name = 'full_engine'").get();
      if (!row) return { trained: false, trainingSamples: 0, trainedAt: null, metrics: {} };
      return {
        trained: true,
        trainingSamples: row.training_samples,
        trainedAt: row.trained_at,
        metrics: JSON.parse(row.metrics || "{}"),
      };
    } catch { return { trained: false, trainingSamples: 0, trainedAt: null, metrics: {} }; }
  }

  async train(onProgress?: (pct: number, msg: string) => void): Promise<{ samples: number; metrics: Record<string, number> }> {
    const rows: any[] = db.prepare("SELECT * FROM match_simulations WHERE home_goals IS NOT NULL AND away_goals IS NOT NULL").all();

    if (rows.length < 5) throw new Error(`Need at least 5 matches to train. Currently have ${rows.length}.`);

    const progress = (pct: number, msg: string) => onProgress?.(pct, msg);

    progress(2, "Extracting features...");
    const allFeatures = rows.map(r => extractFeatures(r));
    const allTargets = rows.map(r => extractTargets(r));

    // Fit scaler
    progress(5, "Fitting normalisation scaler...");
    const scaler = fitScaler(allFeatures);
    const normFeatures = allFeatures.map(f => applyScaler(f, scaler));

    // Compute feature means (for causal baseline)
    const featureMeans = FEATURE_NAMES.map((_, i) => arrMean(allFeatures.map(f => f[i])));

    // 1. Train ANN
    progress(10, "Training neural network (ANN)...");
    const ann = new ANN(N_FEATURES, 64, 32, N_TARGETS);
    const epochs = 100;
    for (let e = 0; e < epochs; e++) {
      // Shuffle
      const idx = normFeatures.map((_, i) => i).sort(() => Math.random() - 0.5);
      for (const i of idx) ann.backward(normFeatures[i], allTargets[i], 0.001);
      if (e % 20 === 0) progress(10 + (e / epochs) * 20, `ANN epoch ${e + 1}/${epochs}...`);
    }
    const annState = ann.toState();

    // Collect ANN predictions for meta-learner
    const annPreds = normFeatures.map(f => ann.predict(f));

    // 2. Train HMM
    progress(32, "Fitting Hidden Markov Model (HMM)...");
    const hmm = fitHMM(normFeatures, allTargets);

    // 3. Fit GP
    progress(38, "Fitting Gaussian Process (GP)...");
    const gp = fitGP(normFeatures, allTargets);

    // 4. Fit GARCH
    progress(44, "Fitting GARCH(1,1) volatility model...");
    const garch = fitGARCH(allTargets);

    // 5. Train SVM
    progress(50, "Training Support Vector Machine (SVM)...");
    const svm = fitSVM(normFeatures, allTargets);

    // 6. Train Random Forest
    progress(55, "Training Random Forest (30 trees)...");
    const rf = fitRF(normFeatures, allTargets, 30);
    const rfPreds = normFeatures.map(f => rfPredict(f, rf));

    // 7. Train GBM
    progress(68, "Training Gradient Boosting Machine...");
    const gbm = fitGBM(normFeatures, allTargets, 40, 0.1);
    const gbmPreds = normFeatures.map(f => gbmPredict(f, gbm));

    // 8. Train Causal
    progress(82, "Fitting Causal Model...");
    const causal = fitCausal(normFeatures, allTargets);

    // 9. Train Meta-Learner
    progress(88, "Training Meta-Learner (ensemble combiner)...");
    const meta = fitMeta(annPreds, rfPreds, gbmPreds, allTargets);

    // Compute metrics on training set
    progress(94, "Computing evaluation metrics...");
    let totalMSE = 0, totalMAE = 0;
    const htMSE_arr: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const pred = this._predictFromModels(
        normFeatures[i], allFeatures[i], featureMeans, annState, hmm, gp, garch, svm, rf, gbm, causal, meta, scaler
      );
      const y = allTargets[i];
      const ftErr = (pred.homeFullTimeXg - y[0]) ** 2 + (pred.awayFullTimeXg - y[1]) ** 2;
      totalMSE += ftErr / 2;
      totalMAE += (Math.abs(pred.homeFullTimeXg - y[0]) + Math.abs(pred.awayFullTimeXg - y[1])) / 2;
      htMSE_arr.push(((pred.homeFirstHalfXg - y[2]) ** 2 + (pred.awayFirstHalfXg - y[3]) ** 2) / 2);
    }

    const n = rows.length;
    const metrics = {
      mse_ft: +(totalMSE / n).toFixed(4),
      mae_ft: +(totalMAE / n).toFixed(4),
      mse_h1: +(arrMean(htMSE_arr)).toFixed(4),
      rmse_ft: +(Math.sqrt(totalMSE / n)).toFixed(4),
      samples: n,
    };

    this.state = { scaler, ann: annState, hmm, gp, garch, svm, rf, gbm, causal, meta, featureMeans };
    this.save(n, metrics);

    progress(100, `Training complete! ${n} matches trained.`);
    return { samples: n, metrics };
  }

  private _predictFromModels(
    normX: number[], rawX: number[], featureMeans: number[],
    annState: ANNState, hmm: HMMModel, gp: GPModel, garch: GARCHModel,
    svm: SVMModel, rf: RFModel, gbm: GBMModel, causal: CausalModel,
    meta: MetaModel, scaler: Scaler
  ): XGPrediction {
    // ANN prediction
    const annModel = new ANN(annState.D, annState.H1, annState.H2, annState.O);
    annModel.fromState(annState);
    const annPred = annModel.predict(normX);

    // RF prediction
    const rfPred = rfPredict(normX, rf);

    // GBM prediction
    const gbmPred = gbmPredict(normX, gbm);

    // Meta prediction
    const metaPred = metaPredict(annPred, rfPred, gbmPred, meta);

    // HMM state
    const hmmResult = hmmPredict(normX, hmm);

    // GP uncertainty
    const gpResult = gpPredict(normX, gp);

    // GARCH volatility
    const featureXg = (rawX[0] + rawX[1]) / 2;
    const garchResult = garchVolatilityFactor(featureXg, garch);

    // SVM correction
    const svmResult = svmCorrection(normX, svm);

    // Causal delta
    const normMeans = applyScaler(featureMeans, scaler);
    const causalResult = causalDelta(normX, normMeans, causal);

    // Combine: meta prediction + hmm factor + svm correction + causal delta
    const combine = (metaVal: number, causalD: number) =>
      Math.max(0, (metaVal + causalD) * hmmResult.xgFactor + svmResult.correction);

    const hFt = combine(metaPred[0], causalResult.delta[0]);
    const aFt = combine(metaPred[1], causalResult.delta[1]);
    const hH1 = combine(metaPred[2], causalResult.delta[2]);
    const aH1 = combine(metaPred[3], causalResult.delta[3]);
    const hH2 = combine(metaPred[4], causalResult.delta[4]);
    const aH2 = combine(metaPred[5], causalResult.delta[5]);

    // GP confidence intervals (variance → std dev)
    const confidence = gpResult.variance.map(v => +Math.sqrt(v).toFixed(3));

    // Derived market probabilities
    const totalXg = hFt + aFt;
    const bttsProbability = clamp(1 - Math.exp(-hFt) - Math.exp(-aFt) + Math.exp(-(hFt + aFt)), 0, 1);
    const over25Probability = clamp(1 - Math.exp(-totalXg) * (1 + totalXg + totalXg ** 2 / 2), 0, 1);
    const homeAdv = hFt / (totalXg || 1);
    const home = clamp(homeAdv * 0.8 + 0.1, 0.1, 0.8);
    const away = clamp((1 - homeAdv) * 0.8 + 0.1, 0.1, 0.8);
    const draw = clamp(1 - home - away + 0.15, 0.1, 0.45);

    // Feature summary
    const featuresUsed: Record<string, number> = {};
    FEATURE_NAMES.forEach((name, i) => { featuresUsed[name] = +rawX[i].toFixed(3); });

    return {
      homeFullTimeXg: +hFt.toFixed(2),
      awayFullTimeXg: +aFt.toFixed(2),
      homeFirstHalfXg: +hH1.toFixed(2),
      awayFirstHalfXg: +aH1.toFixed(2),
      homeSecondHalfXg: +hH2.toFixed(2),
      awaySecondHalfXg: +aH2.toFixed(2),
      confidence,
      volatility: garchResult.label,
      volatilityFactor: +garchResult.factor.toFixed(3),
      matchState: hmmResult.state,
      stateProbabilities: hmmResult.stateProbabilities.map(p => +p.toFixed(3)),
      svmCorrection: +svmResult.correction.toFixed(3),
      causalDelta: causalResult.delta.map(d => +d.toFixed(3)),
      causalExplanation: Object.fromEntries(Object.entries(causalResult.explanation).map(([k, v]) => [k, +v.toFixed(3)])),
      metaWeights: meta.weights.map(row => row.map(v => +v.toFixed(3))),
      componentPredictions: {
        ann: annPred.map(v => +v.toFixed(3)),
        rf: rfPred.map(v => +v.toFixed(3)),
        gbm: gbmPred.map(v => +v.toFixed(3)),
        hmm: { state: hmmResult.state, factor: +hmmResult.xgFactor.toFixed(3) },
        garch: { label: garchResult.label, factor: +garchResult.factor.toFixed(3) },
        svm: { correction: +svmResult.correction.toFixed(3), score: +svmResult.score.toFixed(3) },
        gp: { variance: gpResult.variance.map(v => +v.toFixed(4)) },
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

  predict(rawFeatures: number[]): XGPrediction {
    if (!this.state) throw new Error("Engine not trained. Train the engine first.");
    const { scaler, ann, hmm, gp, garch, svm, rf, gbm, causal, meta, featureMeans } = this.state;
    const normX = applyScaler(rawFeatures, scaler);
    return this._predictFromModels(normX, rawFeatures, featureMeans, ann, hmm, gp, garch, svm, rf, gbm, causal, meta, scaler);
  }

  predictFromRow(row: Record<string, any>): XGPrediction {
    const features = extractFeatures(row);
    return this.predict(features);
  }
}

export const engine = new XGEngine();

// Load persisted state at startup
engine.load();

export default engine;
