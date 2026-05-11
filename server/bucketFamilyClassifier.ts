/**
 * Bucket Family Classifier + Contradiction Detection Engine — Stage 3
 *
 * Instead of jumping directly to exact scores, matches are first classified
 * into one of 6 broad "bucket families." This massively reduces confusion
 * between similar-looking scorelines (e.g. 1-1 vs 2-1 vs 2-0).
 *
 * Stage also runs Contradiction Detection — flags impossible bucket
 * assignments (e.g. predicting 0-0 when BTTS=74%).
 */

import type { MatchIdentity, WinnerLabel, GoalRangeLabel, BTTSLabel, TempoLabel, RiskLabel } from "./matchIdentityEngine";
import type { BucketPrediction } from "./scoreOutcomeTrainer";

// ── Bucket Family Definitions ─────────────────────────────────────────────────
export type BucketFamilyId =
  | "low_defensive"   // 0-0, 1-0, 0-1
  | "balanced_btts"   // 1-1, 2-1, 1-2
  | "open_high"       // 2-2, 3-1, 1-3, 3-2, 2-3
  | "dominant_home"   // 2-0, 3-0, 4-0, 4-1, 3-1 (home clean sheet)
  | "dominant_away"   // 0-2, 0-3, 0-4, 1-4, 1-3 (away clean sheet)
  | "chaotic";        // 3-3, 4-2, 2-4, 4-3, 3-4, 4-4, 4-2

export interface BucketFamily {
  id: BucketFamilyId;
  label: string;
  description: string;
  scores: string[];        // score IDs that belong here
  psychology: string;      // psychological identity of this family
}

export const BUCKET_FAMILIES: BucketFamily[] = [
  {
    id: "low_defensive",
    label: "Low Scoring / Defensive",
    description: "Tight, cautious match. One goal or none.",
    scores: ["0-0", "1-0", "0-1"],
    psychology: "Fear of losing dominates. Both sides prioritise shape. First goal is decisive.",
  },
  {
    id: "balanced_btts",
    label: "Balanced BTTS",
    description: "Both sides score. Moderate goal total.",
    scores: ["1-1", "2-1", "1-2"],
    psychology: "Competitive match. Both teams create and convert. Momentum shifts matter.",
  },
  {
    id: "open_high",
    label: "Open / High Goals",
    description: "High-tempo both ways. 3-5 total goals.",
    scores: ["2-2", "3-1", "1-3", "3-2", "2-3"],
    psychology: "Transition-heavy. Weak defending or aggressive pressing. Chaotic momentum.",
  },
  {
    id: "dominant_home",
    label: "Home Dominant",
    description: "Home side controls and keeps a clean sheet.",
    scores: ["2-0", "3-0", "4-0", "4-1", "3-1"],
    psychology: "Home side is clearly stronger. Away fails to create or finish. Controlled dominance.",
  },
  {
    id: "dominant_away",
    label: "Away Dominant",
    description: "Away side controls and keeps a clean sheet.",
    scores: ["0-2", "0-3", "0-4", "1-4", "1-3"],
    psychology: "Away side is clearly superior. Home side struggles under pressure.",
  },
  {
    id: "chaotic",
    label: "Chaotic / High Entropy",
    description: "Wild match — 5+ goals, both teams score multiple.",
    scores: ["3-3", "4-2", "2-4", "4-3", "3-4", "4-4"],
    psychology: "Weak defensive mentality. Very high scoring rate. Both teams play open.",
  },
];

export interface FamilyScore {
  family: BucketFamily;
  score: number;         // 0..1 compatibility score
  reasoning: string[];
}

export interface ContradictionFlag {
  type: string;
  severity: "high" | "medium" | "low";
  description: string;
  affectedScores: string[];
  confidenceReduction: number;   // percentage points to reduce confidence
}

export interface FamilyClassification {
  primaryFamily: BucketFamily;
  primaryScore: number;
  secondaryFamily: BucketFamily | null;
  secondaryScore: number;
  allFamilyScores: FamilyScore[];
  contradictions: ContradictionFlag[];
  eligibleBuckets: string[];    // bucket IDs that survive family + contradiction filter
}

export function classifyBucketFamily(
  identity: MatchIdentity,
  bucketPredictions: BucketPrediction[],
): FamilyClassification {
  const { winner, goalRange, btts, tempo, risk } = identity;

  const familyScores: FamilyScore[] = BUCKET_FAMILIES.map((family) => {
    let score = 0;
    const reasoning: string[] = [];

    // ── low_defensive ──────────────────────────────────────────────────────
    if (family.id === "low_defensive") {
      if (goalRange.label === "very_low")  { score += 0.4; reasoning.push("Very low goal expectancy"); }
      if (goalRange.label === "low")       { score += 0.25; reasoning.push("Low goal expectancy"); }
      if (btts.label === "no")             { score += 0.3; reasoning.push("BTTS unlikely"); }
      if (tempo.label === "defensive")     { score += 0.2; reasoning.push("Defensive tempo expected"); }
      if (risk.label === "conservative")   { score += 0.15; reasoning.push("Conservative risk profile"); }
      if (btts.label === "yes")            { score -= 0.35; reasoning.push("(-) BTTS expected"); }
      if (goalRange.label === "high")      { score -= 0.4; }
      if (goalRange.label === "very_high") { score -= 0.5; }
      if (identity.overallGoalExpectancy < 1.5) { score += 0.2; reasoning.push("Very low total goals expected"); }
    }

    // ── balanced_btts ──────────────────────────────────────────────────────
    if (family.id === "balanced_btts") {
      if (btts.label === "yes")            { score += 0.35; reasoning.push("BTTS expected"); }
      if (btts.label === "fifty_fifty")    { score += 0.15; }
      if (goalRange.label === "medium")    { score += 0.25; reasoning.push("Medium goal range"); }
      if (goalRange.label === "low")       { score += 0.1; }
      if (winner.label === "even")         { score += 0.15; reasoning.push("Evenly matched teams"); }
      if (tempo.label === "controlled")    { score += 0.1; }
      if (tempo.label === "open")          { score += 0.05; }
      if (goalRange.label === "very_low")  { score -= 0.3; }
      if (btts.label === "no")             { score -= 0.3; }
      if (goalRange.label === "very_high") { score -= 0.2; }
    }

    // ── open_high ─────────────────────────────────────────────────────────
    if (family.id === "open_high") {
      if (goalRange.label === "high")      { score += 0.35; reasoning.push("High goal range"); }
      if (goalRange.label === "very_high") { score += 0.2; }
      if (btts.label === "yes")            { score += 0.25; reasoning.push("Both teams score"); }
      if (tempo.label === "open")          { score += 0.2; reasoning.push("Open tempo"); }
      if (risk.label === "aggressive")     { score += 0.15; reasoning.push("Aggressive risk profile"); }
      if (goalRange.label === "very_low")  { score -= 0.4; }
      if (goalRange.label === "low")       { score -= 0.2; }
      if (btts.label === "no")             { score -= 0.25; }
      if (tempo.label === "defensive")     { score -= 0.2; }
    }

    // ── dominant_home ─────────────────────────────────────────────────────
    if (family.id === "dominant_home") {
      if (winner.label === "home_favored" && winner.confidence >= 65) {
        score += 0.35; reasoning.push(`Home strongly favored (${winner.confidence}%)`);
      } else if (winner.label === "home_favored") {
        score += 0.15;
      }
      if (btts.label === "no")             { score += 0.2; reasoning.push("Away unlikely to score"); }
      if (goalRange.label === "medium" || goalRange.label === "high") { score += 0.1; }
      if (risk.label === "conservative" && winner.label === "home_favored") { score += 0.1; reasoning.push("Home controls pace"); }
      if (winner.label === "away_favored") { score -= 0.4; }
      if (winner.label === "even")         { score -= 0.2; }
      if (btts.label === "yes")            { score -= 0.25; }
    }

    // ── dominant_away ─────────────────────────────────────────────────────
    if (family.id === "dominant_away") {
      if (winner.label === "away_favored" && winner.confidence >= 65) {
        score += 0.35; reasoning.push(`Away strongly favored (${winner.confidence}%)`);
      } else if (winner.label === "away_favored") {
        score += 0.15;
      }
      if (btts.label === "no")             { score += 0.2; reasoning.push("Home unlikely to score"); }
      if (goalRange.label === "medium" || goalRange.label === "high") { score += 0.1; }
      if (winner.label === "home_favored") { score -= 0.4; }
      if (winner.label === "even")         { score -= 0.2; }
      if (btts.label === "yes")            { score -= 0.25; }
    }

    // ── chaotic ───────────────────────────────────────────────────────────
    if (family.id === "chaotic") {
      if (goalRange.label === "very_high") { score += 0.45; reasoning.push("Very high goal expectancy"); }
      if (goalRange.label === "high")      { score += 0.15; }
      if (btts.label === "yes")            { score += 0.25; reasoning.push("Both score multiple"); }
      if (tempo.label === "open")          { score += 0.2; reasoning.push("Open tempo"); }
      if (risk.label === "aggressive")     { score += 0.15; reasoning.push("Aggressive profile"); }
      if (goalRange.label === "very_low")  { score -= 0.5; }
      if (goalRange.label === "low")       { score -= 0.35; }
      if (goalRange.label === "medium")    { score -= 0.15; }
      if (tempo.label === "defensive")     { score -= 0.3; }
      if (btts.label === "no")             { score -= 0.3; }
    }

    return { family, score: Math.max(0, Math.min(1, score)), reasoning };
  });

  familyScores.sort((a, b) => b.score - a.score);
  const primary = familyScores[0];
  const secondary = familyScores[1].score > 0.2 ? familyScores[1] : null;

  // ── Contradiction Detection ───────────────────────────────────────────────
  const contradictions: ContradictionFlag[] = [];

  // 1. Predicting 0-0 but BTTS/Over2.5 signal is strong
  const preds0_0 = bucketPredictions.find((b) => b.bucket === "0-0");
  if (preds0_0 && btts.label === "yes" && btts.confidence >= 65) {
    contradictions.push({
      type: "btts_vs_nil_nil",
      severity: "high",
      description: `0-0 predicted but BTTS signal is ${btts.confidence}% confident. Both teams scored regularly in recent matches.`,
      affectedScores: ["0-0"],
      confidenceReduction: 40,
    });
  }

  // 2. High goal expectancy but defensive family is top
  if (primary.family.id === "low_defensive" && identity.overallGoalExpectancy > 2.5) {
    contradictions.push({
      type: "high_expectancy_vs_defensive",
      severity: "medium",
      description: `Low defensive family predicted but expected goals is ${identity.overallGoalExpectancy.toFixed(1)}. Stats suggest more goals.`,
      affectedScores: ["0-0"],
      confidenceReduction: 25,
    });
  }

  // 3. Dominant family but BTTS=Yes
  if ((primary.family.id === "dominant_home" || primary.family.id === "dominant_away") && btts.label === "yes" && btts.confidence >= 68) {
    const affected = primary.family.id === "dominant_home" ? ["2-0", "3-0", "4-0"] : ["0-2", "0-3", "0-4"];
    contradictions.push({
      type: "dominant_vs_btts",
      severity: "medium",
      description: `Clean-sheet dominant family predicted but BTTS is ${btts.confidence}% likely. Away team is scoring regularly.`,
      affectedScores: affected,
      confidenceReduction: 30,
    });
  }

  // 4. Chaotic family but low goal expectancy
  if (primary.family.id === "chaotic" && identity.overallGoalExpectancy < 2.2) {
    contradictions.push({
      type: "chaotic_vs_low_expectancy",
      severity: "high",
      description: `Chaotic family predicted but expected goals is only ${identity.overallGoalExpectancy.toFixed(1)}. Stats don't support 5+ goals.`,
      affectedScores: ["3-3", "4-2", "2-4", "4-3", "3-4"],
      confidenceReduction: 45,
    });
  }

  // 5. Winner mismatch with dominant family
  if (primary.family.id === "dominant_home" && winner.label === "away_favored") {
    contradictions.push({
      type: "winner_vs_dominant_family",
      severity: "high",
      description: "Home dominant family predicted but away team is favored by form/odds.",
      affectedScores: ["2-0", "3-0", "4-0"],
      confidenceReduction: 35,
    });
  }
  if (primary.family.id === "dominant_away" && winner.label === "home_favored") {
    contradictions.push({
      type: "winner_vs_dominant_family",
      severity: "high",
      description: "Away dominant family predicted but home team is favored by form/odds.",
      affectedScores: ["0-2", "0-3", "0-4"],
      confidenceReduction: 35,
    });
  }

  // 6. Over 2.5 signal vs very low expectancy
  if (identity.overallGoalExpectancy < 1.6 && goalRange.label === "very_low" && btts.label === "yes") {
    contradictions.push({
      type: "scoring_vs_low_expectancy",
      severity: "medium",
      description: `BTTS signal is positive but total goal expectancy is only ${identity.overallGoalExpectancy.toFixed(1)}. One team likely dominates.`,
      affectedScores: ["1-1", "2-1", "1-2"],
      confidenceReduction: 20,
    });
  }

  // ── Eligible buckets (surviving after family + contradiction filter) ────────
  // Primary family scores get full weight, secondary family gets reduced weight
  const primaryScoreIds = new Set(primary.family.scores);
  const secondaryScoreIds = new Set(secondary ? secondary.family.scores : []);

  // Build set of contradiction-penalised scores
  const highContradictionScores = new Set<string>();
  for (const c of contradictions) {
    if (c.severity === "high") {
      for (const s of c.affectedScores) highContradictionScores.add(s);
    }
  }

  const eligibleBuckets = bucketPredictions
    .filter((b) => {
      if (highContradictionScores.has(b.bucket)) return false;
      if (primaryScoreIds.has(b.bucket)) return true;
      if (secondaryScoreIds.has(b.bucket)) return true;
      // Allow other high-confidence buckets through (model override)
      return false;
    })
    .map((b) => b.bucket);

  // Always include top-3 bucket model predictions as eligible
  const topBuckets = bucketPredictions.slice(0, 3).map((b) => b.bucket);
  const mergedEligible = [...new Set([...eligibleBuckets, ...topBuckets])].filter(
    (b) => !highContradictionScores.has(b)
  );

  return {
    primaryFamily: primary.family,
    primaryScore: primary.score,
    secondaryFamily: secondary?.family ?? null,
    secondaryScore: secondary?.score ?? 0,
    allFamilyScores: familyScores,
    contradictions,
    eligibleBuckets: mergedEligible,
  };
}
