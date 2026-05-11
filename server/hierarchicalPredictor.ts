/**
 * Hierarchical Prediction Engine — Main Orchestrator
 *
 * Runs all 6 stages in sequence and produces the final unified output:
 *
 *   Stage 1 — Data Completeness Engine
 *   Stage 2 — Pre-Match Identity Engine  (Winner / Goals / BTTS / Tempo / Risk)
 *   Stage 3 — Bucket Family Classifier   (6 families + contradiction detection)
 *   Stage 4 — Outlier Detection          (Group I: True match vs Group II: Accidental)
 *   Stage 5 — Contextual Psychological Engine (motivation, fatigue, style, knockout)
 *   Stage 6 — Final Prediction Pipeline  (ranked scores + market outputs)
 *
 * Entry point: `runHierarchicalPrediction(eventId, row, bucketModels, ctx)`
 */

import { computeCompleteness, type CompletenessReport } from "./dataCompletenessEngine";
import { computeMatchIdentity, type MatchIdentity } from "./matchIdentityEngine";
import { classifyBucketFamily, type FamilyClassification } from "./bucketFamilyClassifier";
import type { TrainedOutcomeModel } from "./scoreOutcomeTrainer";
import { buildFeatureVector, TRAINER_FEATURES } from "./scoreOutcomeTrainer";

// ── BucketPrediction type (mirrors scoreOutcomeTrainer output) ────────────────
export interface BucketPrediction {
  bucketId: string;
  label: string;
  scores: [number, number][];
  confidence: number;
  rawSum: number;
  rawDiff: number;
  roundedSum: number;
  roundedDiff: number;
  isExactHit: boolean;
  trainAccuracy: number;
  fpRate: number;
  homeGoals: number;
  awayGoals: number;
}

// ── Outlier Classification (Stage 4) ─────────────────────────────────────────
export type OutlierGroup = "true_match" | "accidental";

export interface OutlierAssessment {
  group: OutlierGroup;
  groupLabel: string;
  confidence: number;
  chaosIndex: number;         // shots / max(1, goals) — high = wasteful
  dominanceGap: number;       // |home strength - away strength|
  xgAccuracy: number;         // how well xG matches goal expectancy
  reasoning: string[];
}

// ── Contextual Psychological Signals (Stage 5) ────────────────────────────────
export interface PsychSignal {
  kind: string;
  label: string;
  effect: "boosts_goals" | "suppresses_goals" | "shifts_home" | "shifts_away" | "neutral";
  magnitude: number;    // 0..1
  detail: string;
}

export interface PsychContext {
  signals: PsychSignal[];
  goalBoost: number;          // net boost to total goals expectancy
  homeAdvantageBoost: number; // net shift toward home scoring
  suppressionFactor: number;  // 0..1, how much is the game being suppressed
  psychLabel: string;         // e.g. "High pressure cup tie"
}

// ── Final Scoreline Prediction ────────────────────────────────────────────────
export interface ScorelinePrediction {
  scoreline: string;
  homeGoals: number;
  awayGoals: number;
  outcome: "Home Win" | "Away Win" | "Draw";
  confidence: number;          // final composite confidence
  bucketConfidence: number;    // raw bucket model confidence
  familySupport: number;       // 0..1 — how strongly the primary family supports this score
  contradictionPenalty: number;// confidence reduction from contradictions
  isTopPick: boolean;
  reasoning: string[];
}

// ── Market Predictions ────────────────────────────────────────────────────────
export interface MarketPredictions {
  homeWin: { probability: number; confidence: "high" | "medium" | "low" };
  draw:    { probability: number; confidence: "high" | "medium" | "low" };
  awayWin: { probability: number; confidence: "high" | "medium" | "low" };
  btts:    { prediction: "Yes" | "No" | "Unclear"; probability: number };
  over25:  { prediction: "Yes" | "No" | "Unclear"; probability: number };
  over35:  { prediction: "Yes" | "No" | "Unclear"; probability: number };
  correctScore: { score: string; confidence: number };
}

// ── Full Hierarchical Result ──────────────────────────────────────────────────
export interface HierarchicalPredictionResult {
  eventId: number;
  computedAt: string;

  // Stage results
  stage1_completeness: CompletenessReport;
  stage2_identity: MatchIdentity;
  stage3_family: FamilyClassification;
  stage4_outlier: OutlierAssessment;
  stage5_psych: PsychContext;

  // Final output
  primaryPrediction: ScorelinePrediction;
  secondaryPrediction: ScorelinePrediction | null;
  top5: ScorelinePrediction[];
  markets: MarketPredictions;

  // Metadata
  modelsUsed: number;
  dataSource: "live" | "database";
  overallConfidence: number;   // 0..100 composite
  processingMs: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function n(v: any): number {
  if (v === null || v === undefined) return 0;
  const num = Number(v);
  return isNaN(num) ? 0 : num;
}

function dot(w: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += (w[i] || 0) * (x[i] || 0);
  return s;
}

// ── Predict all buckets using trained models ─────────────────────────────────
function runBucketModels(
  row: Record<string, any>,
  models: TrainedOutcomeModel[],
): BucketPrediction[] {
  const fv = buildFeatureVector(row);
  const results: BucketPrediction[] = [];

  for (const model of models) {
    try {
      const D = model.featureNames.length;
      const fvN = fv.map((v, j) => (v - (model.normMean[j] ?? 0)) / ((model.normStd[j] ?? 1) || 1));

      const predSum  = dot(model.weightsSum,  fvN.slice(0, D)) + model.biasSum;
      const predDiff = dot(model.weightsDiff, fvN.slice(0, D)) + model.biasDiff;

      const rSum  = Math.round(predSum);
      const rDiff = Math.round(predDiff);

      // Reconstruct homeGoals and awayGoals from rounded sum+diff
      const homeGoals = Math.max(0, Math.round((rSum + rDiff) / 2));
      const awayGoals = Math.max(0, rSum - homeGoals);

      const isExactHit = rSum === model.targetSum && rDiff === model.targetDiff;

      // Distance-based confidence (closer = more confident)
      const distSum  = Math.abs(predSum - model.targetSum);
      const distDiff = Math.abs(predDiff - model.targetDiff);
      const distance = distSum + distDiff;
      const rawConf  = Math.max(0, (1 - distance / 4) * 100);
      const confidence = clamp(rawConf * model.trainAccuracy, 0, 99);

      results.push({
        bucketId: model.bucket,
        label: model.bucket,
        scores: [[homeGoals, awayGoals]],
        confidence,
        rawSum: predSum,
        rawDiff: predDiff,
        roundedSum: rSum,
        roundedDiff: rDiff,
        isExactHit,
        trainAccuracy: model.trainAccuracy,
        fpRate: model.fpRate,
        homeGoals,
        awayGoals,
      });
    } catch { /* skip broken model */ }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

// ── Stage 4: Outlier Detection ────────────────────────────────────────────────
function detectOutlier(
  row: Record<string, any>,
  identity: MatchIdentity,
): OutlierAssessment {
  const homeShots   = n(row.home_avg_total_shots);
  const awayShots   = n(row.away_avg_total_shots);
  const homeGoalsSc = n(row.home_avg_goals_scored);
  const awayGoalsSc = n(row.away_avg_goals_scored);
  const homeXg      = n(row.home_avg_xg);
  const awayXg      = n(row.away_avg_xg);
  const homeFormStr = n(row.home_form_strength);
  const awayFormStr = n(row.away_form_strength);
  const homeScStr   = n(row.home_scoring_strength);
  const awayScStr   = n(row.away_scoring_strength);
  const homeDefStr  = n(row.home_defending_strength);
  const awayDefStr  = n(row.away_defending_strength);

  const totalShots = homeShots + awayShots;
  const totalGoals = homeGoalsSc + awayGoalsSc;
  const chaosIndex = totalShots / Math.max(1, totalGoals) - 3; // >0 = wasteful
  const dominanceGap = Math.abs(
    (homeScStr - awayDefStr) - (awayScStr - homeDefStr)
  );

  // xG accuracy: how close is xG to actual scored goals
  const homeXgErr = homeXg > 0 ? Math.abs(homeXg - homeGoalsSc) / Math.max(0.1, homeXg) : 0.5;
  const awayXgErr = awayXg > 0 ? Math.abs(awayXg - awayGoalsSc) / Math.max(0.1, awayXg) : 0.5;
  const xgAccuracy = clamp(1 - (homeXgErr + awayXgErr) / 2, 0, 1);

  // Group I (true match): dominant teams, consistent xG, low chaos
  // Group II (accidental): high chaos, xG mismatch, low dominance
  const trueMatchScore =
    (dominanceGap > 0.15 ? 0.35 : 0)
    + (xgAccuracy > 0.7 ? 0.35 : xgAccuracy > 0.5 ? 0.15 : 0)
    + (chaosIndex < 3 ? 0.2 : chaosIndex < 6 ? 0.1 : 0)
    + (Math.abs(homeFormStr - awayFormStr) > 0.1 ? 0.1 : 0);

  const group: OutlierGroup = trueMatchScore >= 0.45 ? "true_match" : "accidental";
  const groupConf = clamp(50 + Math.abs(trueMatchScore - 0.45) * 200, 50, 92);

  const reasoning: string[] = [];
  if (dominanceGap > 0.15) reasoning.push(`Clear strength gap (${dominanceGap.toFixed(2)}) — dominant team pattern`);
  else reasoning.push(`Balanced teams — accidental outcomes possible`);
  if (chaosIndex > 6) reasoning.push(`High shot-to-goal ratio (chaos=${chaosIndex.toFixed(1)}) — wasteful match`);
  if (xgAccuracy > 0.75) reasoning.push(`xG matches goals well — predictable scoring pattern`);
  else if (xgAccuracy < 0.4) reasoning.push(`xG deviates significantly from actual goals — luck factor`);

  return {
    group,
    groupLabel: group === "true_match" ? "Group I — True Match Pattern" : "Group II — Accidental Result",
    confidence: Math.round(groupConf),
    chaosIndex: +chaosIndex.toFixed(2),
    dominanceGap: +dominanceGap.toFixed(3),
    xgAccuracy: +xgAccuracy.toFixed(3),
    reasoning,
  };
}

// ── Stage 5: Contextual Psychological Engine ─────────────────────────────────
function buildPsychContext(row: Record<string, any>, identity: MatchIdentity): PsychContext {
  const signals: PsychSignal[] = [];
  const homeMotiv     = n(row.ctx_home_motivation);
  const awayMotiv     = n(row.ctx_away_motivation);
  const homeFatigue   = n(row.ctx_home_fatigue_index);
  const awayFatigue   = n(row.ctx_away_fatigue_index);
  const isKnockout    = n(row.ctx_is_knockout) > 0.5;
  const isSecondLeg   = n(row.ctx_is_second_leg) > 0.5;
  const oddsGap       = n(row.ctx_odds_gap);
  const styleClash    = n(row.ctx_style_clash_weight);
  const homeCons      = n(row.ctx_home_conservative_coach) > 0.5;
  const awayCons      = n(row.ctx_away_conservative_coach) > 0.5;
  const trailingNeeds = n(row.ctx_trailing_needs_goals) > 0.5;
  const ctxStage      = row.ctx_knockout_stage as string | undefined;
  const homePressure  = row.ctx_home_pressure_status as string | undefined;
  const awayPressure  = row.ctx_away_pressure_status as string | undefined;

  // Motivation signals
  if (homeMotiv > 0.8 && awayMotiv > 0.8) {
    signals.push({
      kind: "dual_motivation",
      label: "Both teams highly motivated",
      effect: "boosts_goals",
      magnitude: 0.6,
      detail: `Home motivation: ${(homeMotiv * 100).toFixed(0)}%, Away: ${(awayMotiv * 100).toFixed(0)}%`,
    });
  } else if (homeMotiv > 0.8) {
    signals.push({
      kind: "home_motivation",
      label: "Home team has high motivation",
      effect: "shifts_home",
      magnitude: 0.5,
      detail: homePressure ? `Status: ${homePressure}` : `Motivation: ${(homeMotiv * 100).toFixed(0)}%`,
    });
  } else if (awayMotiv > 0.8) {
    signals.push({
      kind: "away_motivation",
      label: "Away team has high motivation",
      effect: "shifts_away",
      magnitude: 0.5,
      detail: awayPressure ? `Status: ${awayPressure}` : `Motivation: ${(awayMotiv * 100).toFixed(0)}%`,
    });
  }

  // Low motivation / dead rubber
  if (homeMotiv < 0.25 && awayMotiv < 0.25) {
    signals.push({
      kind: "dead_rubber",
      label: "Dead rubber — both sides have little to play for",
      effect: "suppresses_goals",
      magnitude: 0.45,
      detail: "Low motivation on both sides reduces intensity",
    });
  }

  // Fatigue
  if (homeFatigue > 0.6 && awayFatigue > 0.6) {
    signals.push({
      kind: "dual_fatigue",
      label: "Both teams fatigued — expect error-prone play",
      effect: "boosts_goals",
      magnitude: 0.3,
      detail: `Home fatigue: ${(homeFatigue * 100).toFixed(0)}%, Away: ${(awayFatigue * 100).toFixed(0)}%`,
    });
  } else if (homeFatigue > 0.65) {
    signals.push({
      kind: "home_fatigue",
      label: "Home team fatigued — defensive errors likely",
      effect: "shifts_away",
      magnitude: 0.35,
      detail: `Home fatigue index: ${(homeFatigue * 100).toFixed(0)}%`,
    });
  } else if (awayFatigue > 0.65) {
    signals.push({
      kind: "away_fatigue",
      label: "Away team fatigued",
      effect: "shifts_home",
      magnitude: 0.35,
      detail: `Away fatigue index: ${(awayFatigue * 100).toFixed(0)}%`,
    });
  }

  // Knockout / Cup
  if (isKnockout) {
    const stageLabel = ctxStage ?? "Knockout";
    signals.push({
      kind: "knockout",
      label: `${stageLabel} — knockout caution`,
      effect: "suppresses_goals",
      magnitude: stageLabel === "Final" ? 0.6 : stageLabel === "Semi-final" ? 0.5 : 0.35,
      detail: "Teams typically play defensively in knockout matches to avoid conceding.",
    });
  }

  if (isSecondLeg && trailingNeeds) {
    signals.push({
      kind: "second_leg_trail",
      label: "Trailing team needs goals in second leg",
      effect: "boosts_goals",
      magnitude: 0.7,
      detail: "Trailing side will commit forward — open match expected",
    });
  }

  // Conservative coaches
  if (homeCons && awayCons) {
    signals.push({
      kind: "dual_conservative",
      label: "Both coaches conservative — low scoring expected",
      effect: "suppresses_goals",
      magnitude: 0.4,
      detail: "Both managers tend to make substitutions late and prioritise clean sheets.",
    });
  } else if (homeCons) {
    signals.push({
      kind: "home_conservative",
      label: "Home manager conservative — compact shape",
      effect: "suppresses_goals",
      magnitude: 0.25,
      detail: "Home manager historically makes first subs late.",
    });
  } else if (awayCons) {
    signals.push({
      kind: "away_conservative",
      label: "Away manager conservative — likely to defend",
      effect: "suppresses_goals",
      magnitude: 0.25,
      detail: "Away manager tends not to commit early.",
    });
  }

  // Odds gap / park-the-bus
  if (oddsGap > 0.6) {
    signals.push({
      kind: "underdog_bus",
      label: "Odds gap is very large — underdog likely to park the bus",
      effect: "suppresses_goals",
      magnitude: 0.45,
      detail: `Odds gap index: ${oddsGap.toFixed(2)}. Underdog may sacrifice possession entirely.`,
    });
  }

  // Style clash
  if (styleClash > 0.3) {
    signals.push({
      kind: "style_clash",
      label: "Contrasting play styles — transitional game likely",
      effect: "boosts_goals",
      magnitude: 0.3,
      detail: "One team attacks early while the other counters — goals on transitions.",
    });
  }

  // Net effects
  let goalBoost = 0;
  let homeAdvBoost = 0;
  let suppression = 0;

  for (const s of signals) {
    if (s.effect === "boosts_goals")     goalBoost     += s.magnitude;
    if (s.effect === "suppresses_goals") suppression   += s.magnitude;
    if (s.effect === "shifts_home")      homeAdvBoost  += s.magnitude;
    if (s.effect === "shifts_away")      homeAdvBoost  -= s.magnitude;
  }

  const netGoalBoost = clamp(goalBoost - suppression, -1, 1);

  let psychLabel = "Standard match";
  if (isKnockout && (homeMotiv > 0.75 || awayMotiv > 0.75)) psychLabel = "High-pressure cup tie";
  else if (homeMotiv < 0.25 && awayMotiv < 0.25) psychLabel = "Dead rubber";
  else if (trailingNeeds) psychLabel = "Must-win second leg";
  else if (homeFatigue > 0.6 && awayFatigue > 0.6) psychLabel = "Congested schedule fatigue match";
  else if (oddsGap > 0.6) psychLabel = "Heavy favourite vs park-the-bus underdog";
  else if (goalBoost > 0.4) psychLabel = "High-motivation open contest";
  else if (suppression > 0.4) psychLabel = "Cautious, low-scoring encounter";

  return {
    signals,
    goalBoost: +netGoalBoost.toFixed(3),
    homeAdvantageBoost: +clamp(homeAdvBoost, -1, 1).toFixed(3),
    suppressionFactor: +clamp(suppression / Math.max(0.1, suppression + goalBoost), 0, 1).toFixed(3),
    psychLabel,
  };
}

// ── Stage 6: Final Scoreline Ranking ─────────────────────────────────────────
function buildFinalRanking(
  bucketPredictions: BucketPrediction[],
  family: FamilyClassification,
  psych: PsychContext,
  identity: MatchIdentity,
  outlier: OutlierAssessment,
  completeness: CompletenessReport,
  homeWinProb: number,
  drawProb: number,
  awayWinProb: number,
): ScorelinePrediction[] {
  const eligibleSet = new Set(family.eligibleBuckets);
  const contradictionMap = new Map<string, number>();
  for (const c of family.contradictions) {
    for (const s of c.affectedScores) {
      contradictionMap.set(s, (contradictionMap.get(s) ?? 0) + c.confidenceReduction);
    }
  }

  const primaryFamilySet = new Set(family.primaryFamily.scores);
  const secondaryFamilySet = new Set(family.secondaryFamily?.scores ?? []);

  const results: ScorelinePrediction[] = bucketPredictions.map((bp) => {
    const isEligible = eligibleSet.has(bp.bucketId);
    const contradictionPenalty = contradictionMap.get(bp.bucketId) ?? 0;
    const inPrimary = primaryFamilySet.has(bp.bucketId);
    const inSecondary = secondaryFamilySet.has(bp.bucketId);

    // Family support: primary = 1.0, secondary = 0.6, none = 0.3
    const familySupport = inPrimary ? 1.0 : inSecondary ? 0.6 : 0.3;

    // Outlier adjustment: accidental predictions get reduced confidence
    const outlierFactor = outlier.group === "accidental" ? 0.85 : 1.0;

    // Psychological adjustment on expected goals
    const expectedTotal = identity.expectedHomeGoals + identity.expectedAwayGoals;
    const psychGoalAdjusted = expectedTotal + psych.goalBoost * 0.5;
    const totalGoals = bp.homeGoals + bp.awayGoals;
    const goalProximity = 1 - clamp(Math.abs(totalGoals - psychGoalAdjusted) / 3, 0, 1);
    const psychFactor = 0.8 + goalProximity * 0.2;

    // Result probability weighting
    const outcome: "Home Win" | "Away Win" | "Draw" =
      bp.homeGoals > bp.awayGoals ? "Home Win" :
      bp.homeGoals < bp.awayGoals ? "Away Win" : "Draw";
    const resultProb =
      outcome === "Home Win" ? homeWinProb :
      outcome === "Away Win" ? awayWinProb : drawProb;

    // Completeness factor
    const completenessFactor = 0.6 + (completeness.score / 100) * 0.4;

    // Final confidence
    let finalConf = bp.confidence
      * familySupport
      * outlierFactor
      * psychFactor
      * completenessFactor
      * (1 + resultProb * 0.2)
      - contradictionPenalty;

    // Boost if eligible and matches identity expectation
    if (isEligible) finalConf *= 1.1;

    finalConf = clamp(finalConf, 0, 99);

    const reasoning: string[] = [];
    if (inPrimary) reasoning.push(`Supported by ${family.primaryFamily.label} family`);
    if (inSecondary) reasoning.push(`Partially supported by ${family.secondaryFamily?.label} family`);
    if (contradictionPenalty > 0) reasoning.push(`Contradiction penalty: -${contradictionPenalty}%`);
    if (goalProximity > 0.7) reasoning.push(`Total goals (${totalGoals}) aligns with psychological context`);
    if (outlier.group === "accidental") reasoning.push(`Reduced confidence — match shows accidental result pattern`);

    return {
      scoreline: `${bp.homeGoals}-${bp.awayGoals}`,
      homeGoals: bp.homeGoals,
      awayGoals: bp.awayGoals,
      outcome,
      confidence: Math.round(finalConf * 10) / 10,
      bucketConfidence: Math.round(bp.confidence * 10) / 10,
      familySupport,
      contradictionPenalty,
      isTopPick: false,
      reasoning,
    };
  });

  results.sort((a, b) => b.confidence - a.confidence);
  if (results.length > 0) results[0].isTopPick = true;
  return results;
}

// ── Market probability builder ────────────────────────────────────────────────
function buildMarkets(
  top5: ScorelinePrediction[],
  identity: MatchIdentity,
  homeWinProb: number,
  drawProb: number,
  awayWinProb: number,
): MarketPredictions {
  const pct = (v: number) => clamp(Math.round(v * 100), 0, 100);

  const conf = (p: number): "high" | "medium" | "low" =>
    p >= 0.5 ? "high" : p >= 0.35 ? "medium" : "low";

  // BTTS: check how many top-5 have both teams scoring
  const bttsList = top5.filter((s) => s.homeGoals > 0 && s.awayGoals > 0);
  const bttsWeight = bttsList.reduce((a, b) => a + b.confidence, 0);
  const totalWeight = top5.reduce((a, b) => a + b.confidence, 0) || 1;
  const bttsProb = clamp(bttsWeight / totalWeight, 0, 1);

  let bttsPred: "Yes" | "No" | "Unclear" = "Unclear";
  if (bttsProb >= 0.6) bttsPred = "Yes";
  else if (bttsProb <= 0.4) bttsPred = "No";

  // Over 2.5 / Over 3.5 from expected goals
  const expectedTotal = identity.overallGoalExpectancy;
  const over25Prob = clamp(
    expectedTotal > 3.5 ? 0.82 :
    expectedTotal > 2.8 ? 0.65 :
    expectedTotal > 2.2 ? 0.48 :
    expectedTotal > 1.6 ? 0.32 : 0.18,
    0, 1,
  );
  const over35Prob = clamp(
    expectedTotal > 4.5 ? 0.75 :
    expectedTotal > 3.8 ? 0.55 :
    expectedTotal > 3.0 ? 0.38 :
    expectedTotal > 2.3 ? 0.22 : 0.1,
    0, 1,
  );

  let over25Pred: "Yes" | "No" | "Unclear" = "Unclear";
  if (over25Prob >= 0.6) over25Pred = "Yes";
  else if (over25Prob <= 0.4) over25Pred = "No";

  let over35Pred: "Yes" | "No" | "Unclear" = "Unclear";
  if (over35Prob >= 0.6) over35Pred = "Yes";
  else if (over35Prob <= 0.4) over35Pred = "No";

  const topCS = top5[0];

  return {
    homeWin: { probability: pct(homeWinProb), confidence: conf(homeWinProb) },
    draw:    { probability: pct(drawProb),    confidence: conf(drawProb) },
    awayWin: { probability: pct(awayWinProb), confidence: conf(awayWinProb) },
    btts:    { prediction: bttsPred,  probability: pct(bttsProb) },
    over25:  { prediction: over25Pred, probability: pct(over25Prob) },
    over35:  { prediction: over35Pred, probability: pct(over35Prob) },
    correctScore: { score: topCS?.scoreline ?? "1-1", confidence: topCS?.confidence ?? 0 },
  };
}

// ── Main Entry Point ──────────────────────────────────────────────────────────
export async function runHierarchicalPrediction(
  eventId: number,
  row: Record<string, any>,
  models: TrainedOutcomeModel[],
  options?: {
    homeWinProb?: number;
    drawProb?: number;
    awayWinProb?: number;
    dataSource?: "live" | "database";
  },
): Promise<HierarchicalPredictionResult> {
  const t0 = Date.now();

  // Stage 1: Data Completeness
  const stage1 = computeCompleteness(row);

  // Stage 2: Pre-Match Identity
  const stage2 = computeMatchIdentity(row);

  // Run bucket models
  const bucketPredictions = runBucketModels(row, models);

  // Stage 3: Bucket Family Classification
  const stage3 = classifyBucketFamily(stage2, bucketPredictions);

  // Stage 4: Outlier Detection
  const stage4 = detectOutlier(row, stage2);

  // Stage 5: Psychological Context
  const stage5 = buildPsychContext(row, stage2);

  // Stage 6: Final Ranking
  const homeWinProb = options?.homeWinProb ?? 0.34;
  const drawProb    = options?.drawProb    ?? 0.33;
  const awayWinProb = options?.awayWinProb ?? 0.33;

  const allScorelinesRanked = buildFinalRanking(
    bucketPredictions,
    stage3,
    stage5,
    stage2,
    stage4,
    stage1,
    homeWinProb,
    drawProb,
    awayWinProb,
  );

  const top5 = allScorelinesRanked.slice(0, 5);
  const markets = buildMarkets(top5, stage2, homeWinProb, drawProb, awayWinProb);

  // Overall confidence = weighted average of stage confidences + completeness
  const overallConfidence = Math.round(
    stage1.score * 0.15
    + stage2.winner.confidence * 0.2
    + stage2.goalRange.confidence * 0.15
    + stage2.btts.confidence * 0.1
    + stage3.primaryScore * 100 * 0.25
    + stage4.confidence * 0.15,
  );

  return {
    eventId,
    computedAt: new Date().toISOString(),
    stage1_completeness: stage1,
    stage2_identity: stage2,
    stage3_family: stage3,
    stage4_outlier: stage4,
    stage5_psych: stage5,
    primaryPrediction: top5[0],
    secondaryPrediction: top5[1] ?? null,
    top5,
    markets,
    modelsUsed: models.length,
    dataSource: options?.dataSource ?? "live",
    overallConfidence: clamp(overallConfidence, 0, 100),
    processingMs: Date.now() - t0,
  };
}
