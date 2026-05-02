// ─────────────────────────────────────────────────────────────────────────────
// Highest-Scoring-Half (HSH) Predictor
// ─────────────────────────────────────────────────────────────────────────────
// Answers: which half scores more total goals — first, second, or equal (draw)?
//
// The prediction is driven by two complementary signal families:
//   1. Historical per-half scoring habits:
//        home/away H1 & H2 goal averages, xG, shots, big chances
//        → captures each team's natural "front-loaded / back-loaded" tendency
//   2. Match-day context factors (from halfContext.ts):
//        knockout stage, motivation asymmetry, fatigue, coach sub-patterns,
//        style clash, odds gap, stage modifier
//        → captures situational reasons a match might deviate from habit
//
// Model: 3-class multinomial logistic regression trained with Adam +
//        cross-entropy.  Labels come from the ACTUAL halftime scores stored
//        in the DB (home_ht_goals / away_ht_goals).
// ─────────────────────────────────────────────────────────────────────────────

import db from "./db";

// ── Label types ───────────────────────────────────────────────────────────────
export type HSHLabel = "first" | "second" | "draw";
export const HSH_LABELS: HSHLabel[] = ["first", "second", "draw"];

const LABEL_DISPLAY: Record<HSHLabel, string> = {
  first:  "1st Half",
  second: "2nd Half",
  draw:   "Equal",
};

// ── Features ──────────────────────────────────────────────────────────────────
// Ordered by expected importance:
//   (1) Per-half goal/xG/shot averages  — the single strongest predictor
//   (2) Form & strength                 — supporting context
//   (3) Pre-match situational signals   — physiological/tactical reasons
//   (4) Full-match averages             — tie-break fallback
export const HSH_FEATURES: string[] = [
  // Per-half goal averages (primary discriminator)
  "home_h1_avg_goals_scored",    "away_h1_avg_goals_scored",
  "home_h2_avg_goals_scored",    "away_h2_avg_goals_scored",
  // Per-half xG
  "home_h1_avg_xg",              "away_h1_avg_xg",
  "home_h2_avg_xg",              "away_h2_avg_xg",
  // Per-half shots
  "home_h1_avg_total_shots",     "away_h1_avg_total_shots",
  "home_h2_avg_total_shots",     "away_h2_avg_total_shots",
  // Per-half big chances
  "home_h1_avg_big_chances",     "away_h1_avg_big_chances",
  "home_h2_avg_big_chances",     "away_h2_avg_big_chances",
  // Per-half pass accuracy (proxy for control / pressing)
  "home_h1_avg_pass_accuracy",   "away_h1_avg_pass_accuracy",
  "home_h2_avg_pass_accuracy",   "away_h2_avg_pass_accuracy",
  // Form & overall strength
  "home_form_strength",          "away_form_strength",
  "home_scoring_strength",       "away_scoring_strength",
  "home_defending_strength",     "away_defending_strength",
  // Situational context (halfContext signals)
  "ctx_signal_first_weight",     "ctx_signal_second_weight",  "ctx_signal_draw_weight",
  "ctx_is_knockout",
  "ctx_is_second_leg",
  "ctx_trailing_needs_goals",
  "ctx_home_motivation",         "ctx_away_motivation",
  "ctx_motivation_asymmetry",
  "ctx_home_fatigue_index",      "ctx_away_fatigue_index",
  "ctx_fatigue_asymmetry",
  "ctx_home_conservative_coach", "ctx_away_conservative_coach",
  "ctx_home_late_subs_rate",     "ctx_away_late_subs_rate",
  "ctx_odds_gap",
  "ctx_stage_modifier",
  "ctx_style_clash_weight",
  // Full-match averages (supporting fallback)
  "home_avg_goals_scored",       "away_avg_goals_scored",
  "home_avg_xg",                 "away_avg_xg",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function asNumber(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function buildHSHFeatureVector(row: Record<string, any>): number[] {
  return HSH_FEATURES.map((f) => asNumber(row[f]));
}

function computeNorm(X: number[][]): { mean: number[]; std: number[] } {
  if (X.length === 0) return { mean: [], std: [] };
  const n = X.length;
  const d = X[0].length;
  const mean = new Array(d).fill(0);
  const std  = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  for (const row of X) for (let j = 0; j < d; j++) std[j] += Math.pow(row[j] - mean[j], 2);
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / Math.max(1, n - 1)) || 1;
  return { mean, std };
}

function normalizeRow(x: number[], mean: number[], std: number[]): number[] {
  return x.map((v, j) => (v - mean[j]) / (std[j] || 1));
}

function dot(w: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * x[i];
  return s;
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

// ── Trainer ───────────────────────────────────────────────────────────────────
export interface HSHTrainOptions {
  epochs?:       number;
  learningRate?: number;
  l2?:           number;
  onProgress?:   (pct: number, msg: string) => void;
}

export interface TrainedHSHModel {
  weights:      number[][];  // [3][D]  — one weight vector per class
  biases:       number[];    // [3]
  normMean:     number[];
  normStd:      number[];
  featureNames: string[];
  sampleCount:  number;
  trainAccuracy: number;
  classCounts:  [number, number, number]; // [first, second, draw]
  formula:      string;
  trainedAt:    string;
}

export async function trainHSH(opts: HSHTrainOptions = {}): Promise<TrainedHSHModel> {
  const epochs = opts.epochs       ?? 1200;
  const lr     = opts.learningRate ?? 0.015;
  const l2     = opts.l2           ?? 2e-4;
  const prog   = opts.onProgress   ?? (() => {});

  prog(2, "Loading matches with halftime scores from database...");

  const rows: any[] = db.prepare(`
    SELECT * FROM match_simulations
    WHERE home_ht_goals IS NOT NULL
      AND away_ht_goals IS NOT NULL
      AND home_goals    IS NOT NULL
      AND away_goals    IS NOT NULL
      AND home_h1_avg_goals_scored IS NOT NULL
      AND home_h2_avg_goals_scored IS NOT NULL
      AND away_h1_avg_goals_scored IS NOT NULL
      AND away_h2_avg_goals_scored IS NOT NULL
  `).all();

  if (rows.length < 20) {
    throw new Error(
      `Only ${rows.length} match${rows.length !== 1 ? "es" : ""} have halftime scores stored ` +
      `— need at least 20. Bulk-upload more completed matches first.`
    );
  }

  // Label each match: first (0) / second (1) / draw (2)
  const labels: number[] = [];
  let cFirst = 0, cSecond = 0, cDraw = 0;
  for (const r of rows) {
    const h1 = Number(r.home_ht_goals)  + Number(r.away_ht_goals);
    const h2 = (Number(r.home_goals) - Number(r.home_ht_goals)) +
               (Number(r.away_goals) - Number(r.away_ht_goals));
    if      (h1 > h2) { labels.push(0); cFirst++;  }
    else if (h2 > h1) { labels.push(1); cSecond++; }
    else              { labels.push(2); cDraw++;   }
  }

  prog(8, `${rows.length} samples — 1st: ${cFirst}  2nd: ${cSecond}  Equal: ${cDraw}. Building features...`);

  const N  = rows.length;
  const X  = rows.map(buildHSHFeatureVector);
  const D  = HSH_FEATURES.length;
  const { mean, std } = computeNorm(X);
  const Xn = X.map((x) => normalizeRow(x, mean, std));

  prog(14, "Initializing 3-class softmax model (Adam optimiser)...");

  // Weight matrix W[k][j], biases b[k]
  // Warm-start biases at log(class_freq) for faster convergence
  const W: number[][] = Array.from({ length: 3 }, () =>
    Array.from({ length: D }, () => (Math.random() - 0.5) * 0.02)
  );
  const b: number[] = [
    Math.log(Math.max(1, cFirst)  / N),
    Math.log(Math.max(1, cSecond) / N),
    Math.log(Math.max(1, cDraw)   / N),
  ];

  // Adam state
  const beta1 = 0.9, beta2 = 0.999, epsAdam = 1e-8;
  const mW = W.map(() => new Array(D).fill(0));
  const vW = W.map(() => new Array(D).fill(0));
  const mb = new Array(3).fill(0);
  const vb = new Array(3).fill(0);

  prog(20, `Optimising over ${epochs} epochs...`);

  let lastLoss = Infinity;
  const reportEvery = Math.max(1, Math.floor(epochs / 20));

  for (let epoch = 1; epoch <= epochs; epoch++) {
    const gW: number[][] = Array.from({ length: 3 }, () => new Array(D).fill(0));
    const gb = new Array(3).fill(0);
    let loss = 0;

    for (let i = 0; i < N; i++) {
      const x = Xn[i];
      const y = labels[i];

      const logits = W.map((wk, k) => dot(wk, x) + b[k]);
      const probs  = softmax(logits);

      loss -= Math.log(Math.max(1e-12, probs[y]));

      for (let k = 0; k < 3; k++) {
        const delta = probs[k] - (k === y ? 1 : 0);
        for (let j = 0; j < D; j++) gW[k][j] += delta * x[j];
        gb[k] += delta;
      }
    }

    // Average + L2
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < D; j++) gW[k][j] = gW[k][j] / N + 2 * l2 * W[k][j];
      gb[k] /= N;
    }
    loss /= N;
    lastLoss = loss;

    // Adam update
    const bc1 = 1 - Math.pow(beta1, epoch);
    const bc2 = 1 - Math.pow(beta2, epoch);
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < D; j++) {
        mW[k][j] = beta1 * mW[k][j] + (1 - beta1) * gW[k][j];
        vW[k][j] = beta2 * vW[k][j] + (1 - beta2) * Math.pow(gW[k][j], 2);
        W[k][j] -= lr * (mW[k][j] / bc1) / (Math.sqrt(vW[k][j] / bc2) + epsAdam);
      }
      mb[k] = beta1 * mb[k] + (1 - beta1) * gb[k];
      vb[k] = beta2 * vb[k] + (1 - beta2) * Math.pow(gb[k], 2);
      b[k] -= lr * (mb[k] / bc1) / (Math.sqrt(vb[k] / bc2) + epsAdam);
    }

    if (epoch % reportEvery === 0) {
      const pct = 20 + Math.floor((epoch / epochs) * 70);
      prog(pct, `Epoch ${epoch}/${epochs} — loss ${loss.toFixed(4)}`);
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  prog(92, "Evaluating train accuracy...");

  let correct = 0;
  for (let i = 0; i < N; i++) {
    const logits = W.map((wk, k) => dot(wk, Xn[i]) + b[k]);
    if (logits.indexOf(Math.max(...logits)) === labels[i]) correct++;
  }
  const trainAccuracy = correct / N;

  prog(96, "Persisting model...");
  const formula = buildHSHFormula(W, b, mean, std);

  const model: TrainedHSHModel = {
    weights: W, biases: b,
    normMean: mean, normStd: std,
    featureNames: HSH_FEATURES,
    sampleCount: N, trainAccuracy,
    classCounts: [cFirst, cSecond, cDraw],
    formula,
    trainedAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT OR REPLACE INTO engine_hsh_model
      (id, weights, sample_count, train_accuracy, formula, trained_at)
    VALUES (1, ?, ?, ?, ?, ?)
  `).run(
    JSON.stringify({
      weights: W, biases: b,
      normMean: mean, normStd: std,
      featureNames: HSH_FEATURES,
      classCounts: [cFirst, cSecond, cDraw],
    }),
    N, trainAccuracy, formula, model.trainedAt,
  );

  prog(100,
    `Done. Train accuracy ${(trainAccuracy * 100).toFixed(1)}% — loss ${lastLoss.toFixed(4)} ` +
    `(n=${N}: 1st=${cFirst}  2nd=${cSecond}  Equal=${cDraw})`
  );
  return model;
}

// ── Formula text ──────────────────────────────────────────────────────────────
function buildHSHFormula(W: number[][], b: number[], mean: number[], std: number[]): string {
  const K: HSHLabel[] = ["first", "second", "draw"];
  const sections: string[] = [];
  for (let k = 0; k < 3; k++) {
    const wOrig = W[k].map((w, j) => w / (std[j] || 1));
    const bOrig = b[k] - W[k].reduce((s, w, j) => s + (w * mean[j]) / (std[j] || 1), 0);
    const top = wOrig
      .map((w, i) => ({ w, name: HSH_FEATURES[i] }))
      .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
      .slice(0, 8);
    const terms = top
      .map((t) => ` ${t.w >= 0 ? "+" : "−"} ${Math.abs(t.w).toFixed(4)}·${t.name}`)
      .join("");
    sections.push(`logit(${LABEL_DISPLAY[K[k]]}) ≈ ${bOrig.toFixed(3)}${terms}`);
  }
  sections.push("P = softmax(logit_1st, logit_2nd, logit_Equal)");
  sections.push("(Top 8 features per class shown; full vector saved to DB. Coefficients in raw feature units.)");
  return sections.join("\n\n");
}

// ── Load model ────────────────────────────────────────────────────────────────
export interface LoadedHSHModel {
  weights:      number[][];
  biases:       number[];
  normMean:     number[];
  normStd:      number[];
  featureNames: string[];
  classCounts:  [number, number, number];
  trainAccuracy: number;
  sampleCount:  number;
  trainedAt:    string;
}

export function loadHSHModel(): LoadedHSHModel | null {
  const row: any = db.prepare(
    "SELECT * FROM engine_hsh_model WHERE id = 1"
  ).get();
  if (!row) return null;
  try {
    const w = JSON.parse(row.weights);
    return {
      weights:      w.weights,
      biases:       w.biases,
      normMean:     w.normMean,
      normStd:      w.normStd,
      featureNames: w.featureNames ?? HSH_FEATURES,
      classCounts:  w.classCounts  ?? [0, 0, 0],
      trainAccuracy: row.train_accuracy ?? 0,
      sampleCount:  row.sample_count ?? 0,
      trainedAt:    row.trained_at ?? "",
    };
  } catch { return null; }
}

// ── Predict ───────────────────────────────────────────────────────────────────
export interface HSHPrediction {
  prediction:  HSHLabel;
  confidence:  number;  // 0–100 for the leading class
  probs: { first: number; second: number; draw: number };
  keyFactors: {
    feature:      string;
    label:        string;
    contribution: number;
    direction:    "+" | "-";
    pushesTo:     HSHLabel;
  }[];
}

// Maps feature names to human-readable labels
const FEATURE_LABELS: Partial<Record<string, string>> = {
  home_h1_avg_goals_scored:    "Home H1 avg goals",
  away_h1_avg_goals_scored:    "Away H1 avg goals",
  home_h2_avg_goals_scored:    "Home H2 avg goals",
  away_h2_avg_goals_scored:    "Away H2 avg goals",
  home_h1_avg_xg:              "Home H1 xG",
  away_h1_avg_xg:              "Away H1 xG",
  home_h2_avg_xg:              "Home H2 xG",
  away_h2_avg_xg:              "Away H2 xG",
  home_h1_avg_total_shots:     "Home H1 shots",
  away_h1_avg_total_shots:     "Away H1 shots",
  home_h2_avg_total_shots:     "Home H2 shots",
  away_h2_avg_total_shots:     "Away H2 shots",
  home_h1_avg_big_chances:     "Home H1 big chances",
  away_h1_avg_big_chances:     "Away H1 big chances",
  home_h2_avg_big_chances:     "Home H2 big chances",
  away_h2_avg_big_chances:     "Away H2 big chances",
  ctx_signal_first_weight:     "Context → 1st half",
  ctx_signal_second_weight:    "Context → 2nd half",
  ctx_signal_draw_weight:      "Context → Equal",
  ctx_is_knockout:             "Knockout stage",
  ctx_is_second_leg:           "Second leg",
  ctx_trailing_needs_goals:    "Must-score urgency",
  ctx_home_motivation:         "Home motivation",
  ctx_away_motivation:         "Away motivation",
  ctx_motivation_asymmetry:    "Motivation gap",
  ctx_home_fatigue_index:      "Home fatigue",
  ctx_away_fatigue_index:      "Away fatigue",
  ctx_fatigue_asymmetry:       "Fatigue gap",
  ctx_home_conservative_coach: "Home coach parks bus",
  ctx_away_conservative_coach: "Away coach parks bus",
  ctx_home_late_subs_rate:     "Home late-sub rate",
  ctx_away_late_subs_rate:     "Away late-sub rate",
  ctx_odds_gap:                "Odds gap (underdog)",
  ctx_stage_modifier:          "Stage modifier",
  ctx_style_clash_weight:      "Style clash",
  home_form_strength:          "Home form",
  away_form_strength:          "Away form",
  home_scoring_strength:       "Home scoring strength",
  away_scoring_strength:       "Away scoring strength",
  home_avg_goals_scored:       "Home avg goals (full)",
  away_avg_goals_scored:       "Away avg goals (full)",
  home_avg_xg:                 "Home avg xG (full)",
  away_avg_xg:                 "Away avg xG (full)",
};

export function predictHSH(
  row: Record<string, any>,
  model: LoadedHSHModel,
): HSHPrediction {
  const feats = model.featureNames ?? HSH_FEATURES;
  const x  = feats.map((f) => asNumber(row[f]));
  const xn = x.map((v, j) => (v - (model.normMean[j] ?? 0)) / (model.normStd[j] || 1));

  const logits = model.weights.map((wk, k) => dot(wk, xn) + model.biases[k]);
  const probs  = softmax(logits);

  const predIdx = probs.indexOf(Math.max(...probs));
  const prediction = HSH_LABELS[predIdx];
  const confidence = Math.round(probs[predIdx] * 1000) / 10;

  // Key factors: top features by |contribution| to the predicted class logit,
  // then resolve which class the contribution pushes toward
  const wPred = model.weights[predIdx];
  type FactorRaw = { feature: string; raw: number };
  const contribs: FactorRaw[] = xn.map((xj, j) => ({
    feature: feats[j],
    raw: wPred[j] * xj,
  }));
  contribs.sort((a, b) => Math.abs(b.raw) - Math.abs(a.raw));

  const keyFactors = contribs.slice(0, 7).map((c) => {
    // Determine which class this contribution pushes toward
    // by finding the class whose weight has the same sign as c.raw * w[predIdx][j]
    const j = feats.indexOf(c.feature);
    const classContribs = model.weights.map((wk) => wk[j] * xn[j]);
    const pushIdx = classContribs.indexOf(Math.max(...classContribs));
    return {
      feature:      c.feature,
      label:        FEATURE_LABELS[c.feature] ?? c.feature.replace(/_/g, " "),
      contribution: Math.round(Math.abs(c.raw) * 100) / 100,
      direction:    c.raw >= 0 ? "+" as const : "-" as const,
      pushesTo:     HSH_LABELS[pushIdx] ?? prediction,
    };
  });

  return {
    prediction,
    confidence,
    probs: {
      first:  Math.round(probs[0] * 1000) / 10,
      second: Math.round(probs[1] * 1000) / 10,
      draw:   Math.round(probs[2] * 1000) / 10,
    },
    keyFactors,
  };
}
