/**
 * Data Completeness Engine
 *
 * Before any prediction starts, every match must pass through this engine.
 * It scores the quality of available features (0–100%) and assigns a
 * confidence tier. Missing data causes wrong bucket assignment, so this
 * is the foundation of the entire prediction pipeline.
 */

export type ConfidenceTier =
  | "strong"      // 90–100%
  | "reliable"    // 75–89%
  | "moderate"    // 50–74%
  | "unstable";   // < 50%

export interface FeatureCheck {
  key: string;
  label: string;
  present: boolean;
  weight: number;    // importance 0..1 (weights sum to 1 across all checks)
  category: "form" | "stats" | "context" | "odds" | "injury" | "half_stats";
}

export interface CompletenessReport {
  score: number;             // 0..100
  tier: ConfidenceTier;
  tierLabel: string;
  checks: FeatureCheck[];
  presentCount: number;
  totalCount: number;
  missingCritical: string[]; // labels of missing high-weight features
  message: string;
}

const FEATURE_CHECKS: Omit<FeatureCheck, "present">[] = [
  // ── Core form stats (critical) ─────────────────────────────────────────────
  { key: "home_avg_goals_scored",    label: "Home avg goals scored",     weight: 0.065, category: "form" },
  { key: "home_avg_goals_conceded",  label: "Home avg goals conceded",   weight: 0.065, category: "form" },
  { key: "away_avg_goals_scored",    label: "Away avg goals scored",     weight: 0.065, category: "form" },
  { key: "away_avg_goals_conceded",  label: "Away avg goals conceded",   weight: 0.065, category: "form" },
  { key: "home_form_strength",       label: "Home form strength",        weight: 0.04,  category: "form" },
  { key: "away_form_strength",       label: "Away form strength",        weight: 0.04,  category: "form" },
  { key: "home_clean_sheets",        label: "Home clean sheets",         weight: 0.025, category: "form" },
  { key: "away_clean_sheets",        label: "Away clean sheets",         weight: 0.025, category: "form" },

  // ── Match stats (important) ────────────────────────────────────────────────
  { key: "home_avg_xg",              label: "Home xG",                   weight: 0.055, category: "stats" },
  { key: "away_avg_xg",              label: "Away xG",                   weight: 0.055, category: "stats" },
  { key: "home_avg_total_shots",     label: "Home total shots",          weight: 0.03,  category: "stats" },
  { key: "away_avg_total_shots",     label: "Away total shots",          weight: 0.03,  category: "stats" },
  { key: "home_avg_possession",      label: "Home possession",           weight: 0.025, category: "stats" },
  { key: "away_avg_possession",      label: "Away possession",           weight: 0.025, category: "stats" },
  { key: "home_avg_big_chances",     label: "Home big chances",          weight: 0.025, category: "stats" },
  { key: "away_avg_big_chances",     label: "Away big chances",          weight: 0.025, category: "stats" },

  // ── Half-period stats (important for BTTS & goal timing) ──────────────────
  { key: "home_h1_avg_goals_scored", label: "Home 1H goals avg",        weight: 0.025, category: "half_stats" },
  { key: "home_h2_avg_goals_scored", label: "Home 2H goals avg",        weight: 0.025, category: "half_stats" },
  { key: "away_h1_avg_goals_scored", label: "Away 1H goals avg",        weight: 0.025, category: "half_stats" },
  { key: "away_h2_avg_goals_scored", label: "Away 2H goals avg",        weight: 0.025, category: "half_stats" },
  { key: "home_h1_avg_xg",          label: "Home 1H xG",               weight: 0.02,  category: "half_stats" },
  { key: "away_h1_avg_xg",          label: "Away 1H xG",               weight: 0.02,  category: "half_stats" },

  // ── Contextual/psychological features ─────────────────────────────────────
  { key: "ctx_home_motivation",      label: "Home motivation",           weight: 0.04,  category: "context" },
  { key: "ctx_away_motivation",      label: "Away motivation",           weight: 0.04,  category: "context" },
  { key: "ctx_home_fatigue_index",   label: "Home fatigue",              weight: 0.02,  category: "context" },
  { key: "ctx_away_fatigue_index",   label: "Away fatigue",              weight: 0.02,  category: "context" },
  { key: "ctx_stage_modifier",       label: "Stage/competition context", weight: 0.02,  category: "context" },
  { key: "ctx_style_clash_weight",   label: "Style clash signal",        weight: 0.015, category: "context" },

  // ── Odds (very important for identity) ─────────────────────────────────────
  { key: "ctx_odds_home_win",        label: "Home win odds",             weight: 0.05,  category: "odds" },
  { key: "ctx_odds_draw",            label: "Draw odds",                 weight: 0.03,  category: "odds" },
  { key: "ctx_odds_away_win",        label: "Away win odds",             weight: 0.03,  category: "odds" },

  // ── Injury data ────────────────────────────────────────────────────────────
  { key: "home_injury_impact",       label: "Home injury impact",        weight: 0.02,  category: "injury" },
  { key: "away_injury_impact",       label: "Away injury impact",        weight: 0.02,  category: "injury" },
];

function hasValue(row: Record<string, any>, key: string): boolean {
  const v = row[key];
  return v !== null && v !== undefined && v !== "";
}

export function computeCompleteness(row: Record<string, any>): CompletenessReport {
  const checks: FeatureCheck[] = FEATURE_CHECKS.map((def) => ({
    ...def,
    present: hasValue(row, def.key),
  }));

  let weightedScore = 0;
  let totalWeight = 0;
  const missingCritical: string[] = [];

  for (const check of checks) {
    totalWeight += check.weight;
    if (check.present) {
      weightedScore += check.weight;
    } else if (check.weight >= 0.04) {
      missingCritical.push(check.label);
    }
  }

  const score = Math.round((weightedScore / Math.max(totalWeight, 0.001)) * 100);
  const presentCount = checks.filter((c) => c.present).length;
  const totalCount = checks.length;

  let tier: ConfidenceTier;
  let tierLabel: string;
  let message: string;

  if (score >= 90) {
    tier = "strong";
    tierLabel = "Strong Prediction";
    message = "All critical data present. High confidence prediction.";
  } else if (score >= 75) {
    tier = "reliable";
    tierLabel = "Reliable";
    message = "Most data present. Prediction is reliable.";
  } else if (score >= 50) {
    tier = "moderate";
    tierLabel = "Moderate Caution";
    message = "Some data missing. Treat prediction with moderate caution.";
  } else {
    tier = "unstable";
    tierLabel = "Unstable Prediction";
    message = "Significant data gaps. Prediction may be unreliable.";
  }

  return {
    score,
    tier,
    tierLabel,
    checks,
    presentCount,
    totalCount,
    missingCritical,
    message,
  };
}
