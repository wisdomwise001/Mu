/**
 * Prediction Validators — Three intelligent verification layers
 *
 * 1. Score Validator  — Poisson-based achievability check per predicted scoreline.
 *    Verifies the underlying performance & strength can actually produce this score.
 *    Checks whether the opponent can "flip the script" (comeback/steal draw/win).
 *
 * 2. Butterfly Effect Model — Detects non-statistical upset potential.
 *    Learns when the weaker team can win/draw, when a low-scoring match goes high,
 *    and when a non-BTTS match becomes BTTS.
 *
 * 3. Extended Markets — Computes full bet list:
 *    1X2, Double Chance (X1/X2/12), BTTS, Over 2.5/3.5, First to Score,
 *    Each team to score 2+.
 */

// ── Helpers ────────────────────────────────────────────────────────────────
function num(v: any, def = 0): number {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return isNaN(n) ? def : n;
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function round2(v: number): number { return Math.round(v * 100) / 100; }
function round1(v: number): number { return Math.round(v * 10) / 10; }
function pct(v: number): number { return Math.round(clamp(v) * 100); }

/** Poisson probability mass function P(X = k | λ) */
function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  const K = Math.max(0, Math.round(k));
  let result = Math.exp(-lambda);
  for (let i = 1; i <= K; i++) result = result * lambda / i;
  return result;
}

/** P(X >= k | λ) */
function poissonSurvival(k: number, lambda: number): number {
  if (k <= 0) return 1;
  let cdf = 0;
  for (let i = 0; i < k; i++) cdf += poissonPMF(i, lambda);
  return Math.max(0, 1 - cdf);
}

// ── Score Validator ────────────────────────────────────────────────────────
export interface ScoreValidation {
  scoreline: string;
  homeGoals: number;
  awayGoals: number;
  homeExpected: number;
  awayExpected: number;
  homePoisson: number;      // P(home scores exactly homeGoals)
  awayPoisson: number;      // P(away scores exactly awayGoals)
  combinedPoisson: number;  // product (joint probability)
  achievabilityScore: number; // 0-1 relative to the most likely scoreline
  validated: boolean;       // true if achievability > threshold
  flipPotential: number;    // 0-1 chance the loser reverses outcome
  flipSide: "home" | "away" | "none";
  flipSignals: string[];
  riskFactors: string[];
  label: string;            // "Realistic" / "Stretched" / "Unlikely"
}

export function validatePredictedScore(row: any, homeGoals: number, awayGoals: number): ScoreValidation {
  const homeScoredMean  = num(row.home_avg_goals_scored, 1.4);
  const awayScoredMean  = num(row.away_avg_goals_scored, 1.1);
  const homeConcMean    = num(row.home_avg_goals_conceded, 1.2);
  const awayConcMean    = num(row.away_avg_goals_conceded, 1.4);
  const homeXg          = num(row.home_avg_xg, homeScoredMean);
  const awayXg          = num(row.away_avg_xg, awayScoredMean);
  const homeBigC        = num(row.home_avg_big_chances, 2);
  const awayBigC        = num(row.away_avg_big_chances, 1.5);
  const homeShots       = num(row.home_avg_total_shots, 12);
  const awayShots       = num(row.away_avg_total_shots, 10);
  const homeInjury      = num(row.home_injury_impact, 0);
  const awayInjury      = num(row.away_injury_impact, 0);

  // Adjusted expected goals: blend attack vs opponent defence + xG signal
  const homeExpected = clamp(
    ((homeScoredMean * 0.4 + homeXg * 0.3 + awayConcMean * 0.2 + homeBigC * 0.1)
     * (1 - homeInjury * 0.12)),
    0.1, 5,
  );
  const awayExpected = clamp(
    ((awayScoredMean * 0.4 + awayXg * 0.3 + homeConcMean * 0.2 + awayBigC * 0.1)
     * (1 - awayInjury * 0.12)),
    0.1, 5,
  );

  const homeP = poissonPMF(homeGoals, homeExpected);
  const awayP = poissonPMF(awayGoals, awayExpected);
  const combined = homeP * awayP;

  // Compare against the single most likely scoreline's joint probability
  const homeMostLikely = Math.round(homeExpected);
  const awayMostLikely = Math.round(awayExpected);
  const peakProb = poissonPMF(homeMostLikely, homeExpected) * poissonPMF(awayMostLikely, awayExpected);
  const achievability = peakProb > 0 ? clamp(combined / peakProb) : 0;

  const riskFactors: string[] = [];
  if (homeGoals > homeExpected + 1.5) riskFactors.push(`Home needs ${homeGoals} goals vs ${homeExpected.toFixed(1)} expected — very stretched`);
  if (awayGoals > awayExpected + 1.5) riskFactors.push(`Away needs ${awayGoals} goals vs ${awayExpected.toFixed(1)} expected — very stretched`);
  if (homeGoals === 0 && homeExpected > 1.5) riskFactors.push(`Home shutout unlikely — they average ${homeExpected.toFixed(1)} goals`);
  if (awayGoals === 0 && awayExpected > 1.2) riskFactors.push(`Away shutout unlikely — they average ${awayExpected.toFixed(1)} goals`);
  if (homeInjury > 0.3) riskFactors.push(`Home injury impact ${(homeInjury * 100).toFixed(0)}% may suppress scoring`);
  if (awayInjury > 0.3) riskFactors.push(`Away injury impact ${(awayInjury * 100).toFixed(0)}% may suppress scoring`);

  // ── Flip potential: can the losing side reverse? ──────────────────────
  const isHomeWin = homeGoals > awayGoals;
  const isDraw    = homeGoals === awayGoals;
  const flipSide: "home" | "away" | "none" = isDraw ? "none" : (isHomeWin ? "away" : "home");

  let flipPotential = 0;
  const flipSignals: string[] = [];

  if (flipSide !== "none") {
    const loserCome = flipSide === "away"
      ? num(row.away_gsrm_eri, 0)
      : num(row.home_gsrm_eri, 0);
    const loserShots  = flipSide === "away" ? awayShots : homeShots;
    const loserBigC   = flipSide === "away" ? awayBigC : homeBigC;
    const loserMotiv  = flipSide === "away"
      ? num(row.ctx_away_motivation, 0.5)
      : num(row.ctx_home_motivation, 0.5);
    const winnerFatigue = flipSide === "away"
      ? num(row.ctx_home_fatigue_index, 0)
      : num(row.ctx_away_fatigue_index, 0);
    const collapse = flipSide === "away"
      ? num(row.home_ssbi_zzb, 0)
      : num(row.away_ssbi_zzb, 0);

    flipPotential = clamp(
      loserCome * 0.30
      + (loserShots / 20) * 0.20
      + (loserBigC / 4) * 0.15
      + loserMotiv * 0.15
      + winnerFatigue * 0.15
      + collapse * 0.05,
    );

    if (loserCome > 0.5) flipSignals.push(`${flipSide === "away" ? "Away" : "Home"} has strong comeback resilience`);
    if (winnerFatigue > 0.5) flipSignals.push(`${flipSide === "home" ? "Away" : "Home"} side fatigued — defensive errors possible`);
    if (collapse > 0.4) flipSignals.push(`Winning team has score-state collapse tendency`);
    if (loserMotiv > 0.75) flipSignals.push(`${flipSide} side highly motivated — won't give up`);
  }

  const label = achievability >= 0.60 ? "Realistic"
    : achievability >= 0.30 ? "Stretched"
    : "Unlikely";

  return {
    scoreline: `${homeGoals}-${awayGoals}`,
    homeGoals, awayGoals,
    homeExpected: round2(homeExpected),
    awayExpected: round2(awayExpected),
    homePoisson: round2(homeP * 100),
    awayPoisson: round2(awayP * 100),
    combinedPoisson: round2(combined * 100),
    achievabilityScore: round2(achievability),
    validated: achievability >= 0.30,
    flipPotential: round2(flipPotential),
    flipSide,
    flipSignals,
    riskFactors,
    label,
  };
}

// ── Butterfly Effect Model ─────────────────────────────────────────────────
export interface ButterflyEffect {
  // 1. Upset potential (weaker team wins/draws when stats say otherwise)
  upsetPotential: number;     // 0-1
  upsetLabel: string;
  upsetSignals: string[];

  // 2. Goal inflation risk (low-scoring match goes high)
  goalInflationRisk: number;
  goalInflationLabel: string;
  goalInflationSignals: string[];

  // 3. BTTS flip risk (non-BTTS match becomes BTTS)
  bttsFlipRisk: number;
  bttsFlipLabel: string;
  bttsFlipSignals: string[];

  // Overall chaos index
  overallChaosIndex: number;
  chaosLabel: string;
  chaosColor: string;
}

export function computeButterflyEffect(row: any): ButterflyEffect {
  const homeOdds    = num(row.ctx_odds_home_win, 2.0);
  const awayOdds    = num(row.ctx_odds_away_win, 3.0);
  const oddsGap     = num(row.ctx_odds_gap, 0);
  const homeFatigue = num(row.ctx_home_fatigue_index, 0);
  const awayFatigue = num(row.ctx_away_fatigue_index, 0);
  const homeMotiv   = num(row.ctx_home_motivation, 0.5);
  const awayMotiv   = num(row.ctx_away_motivation, 0.5);
  const motivAsym   = Math.abs(num(row.ctx_motivation_asymmetry, 0));
  const fatigueAsym = Math.abs(num(row.ctx_fatigue_asymmetry, 0));
  const styleClash  = num(row.ctx_style_clash_weight, 0);
  const isKnockout  = num(row.ctx_is_knockout, 0);

  // Team performance
  const homeFS  = num(row.home_form_strength, 0.5);
  const awayFS  = num(row.away_form_strength, 0.5);
  const homeSS  = num(row.home_scoring_strength, 0.5);
  const awaySS  = num(row.away_scoring_strength, 0.5);
  const homeDS  = num(row.home_defending_strength, 0.5);
  const awayDS  = num(row.away_defending_strength, 0.5);
  const homeEri = num(row.home_gsrm_eri, 0);
  const awayEri = num(row.away_gsrm_eri, 0);
  const homeZzb = num(row.home_ssbi_zzb, 0);
  const awayZzb = num(row.away_ssbi_zzb, 0);
  const homeGS  = num(row.home_avg_goals_scored, 1.4);
  const awayGS  = num(row.away_avg_goals_scored, 1.1);
  const homeCS  = num(row.home_clean_sheets, 3);
  const awayCS  = num(row.away_clean_sheets, 2);
  const homeM   = num(row.home_matches_analyzed, 15);
  const awayM   = num(row.away_matches_analyzed, 15);
  const homeShots = num(row.home_avg_total_shots, 12);
  const awayShots = num(row.away_avg_total_shots, 10);
  const homeBigC  = num(row.home_avg_big_chances, 2);
  const awayBigC  = num(row.away_avg_big_chances, 1.5);

  // ── 1. Upset Potential ─────────────────────────────────────────────────
  // Who is the underdog? (higher odds = underdog)
  const favoriteIsHome = homeOdds < awayOdds;
  const underdogCome   = favoriteIsHome ? awayEri : homeEri;
  const underdogMotiv  = favoriteIsHome ? awayMotiv : homeMotiv;
  const favFatigue     = favoriteIsHome ? homeFatigue : awayFatigue;
  const favCollapse    = favoriteIsHome ? homeZzb : awayZzb;
  const formGap        = Math.abs(homeFS - awayFS);

  const upsetSignals: string[] = [];
  const upsetPotential = clamp(
    underdogCome * 0.28
    + underdogMotiv * 0.22
    + favFatigue * 0.20
    + favCollapse * 0.15
    + (1 - formGap) * 0.08
    + motivAsym * 0.07,
  );

  if (underdogCome > 0.5) upsetSignals.push(`${favoriteIsHome ? "Away" : "Home"} underdog has strong comeback ability`);
  if (favFatigue > 0.5)   upsetSignals.push(`${favoriteIsHome ? "Home" : "Away"} favourite is fatigued — energy risk`);
  if (favCollapse > 0.4)  upsetSignals.push(`Favourite has score-state collapse tendency`);
  if (underdogMotiv > 0.8) upsetSignals.push(`Underdog is highly motivated — fight expected`);
  if (oddsGap > 0.7)      upsetSignals.push(`Large odds gap — classic park-the-bus + counter setup`);
  if (isKnockout > 0.5)   upsetSignals.push(`Knockout stage — one goal can flip everything`);

  // ── 2. Goal Inflation Risk ─────────────────────────────────────────────
  const expectedTotal     = homeGS + awayGS;
  const bothAggression    = ((homeShots + awayShots) / 28);
  const bothBigChances    = ((homeBigC + awayBigC) / 6);
  const homeCSRate        = homeCS / Math.max(1, homeM);
  const awayCSRate        = awayCS / Math.max(1, awayM);
  const openDefenseSignal = (1 - (homeCSRate + awayCSRate) / 2);
  const dualFatigue       = (homeFatigue + awayFatigue) / 2;

  const goalInflationSignals: string[] = [];
  const goalInflationRisk = clamp(
    styleClash * 0.30
    + bothAggression * 0.25
    + openDefenseSignal * 0.20
    + dualFatigue * 0.15
    + bothBigChances * 0.10,
  );

  if (styleClash > 0.4)       goalInflationSignals.push(`Style clash — counter-attack transitions create extra chances`);
  if (bothAggression > 0.65)  goalInflationSignals.push(`Both teams heavily shot-intensive — goal fest possible`);
  if (openDefenseSignal > 0.7) goalInflationSignals.push(`Both defences leaky — clean sheets rare for either side`);
  if (dualFatigue > 0.5)      goalInflationSignals.push(`Fatigue on both sides leads to defensive errors`);
  if (motivAsym > 0.5)        goalInflationSignals.push(`Motivation asymmetry creates open-game dynamic`);

  // ── 3. BTTS Flip Risk ─────────────────────────────────────────────────
  // Expected to be non-BTTS but conditions exist for both to score
  const awayCanScore    = clamp((awaySS * 0.5 + awayBigC / 5 * 0.3 + (1 - homeDS) * 0.2));
  const homeCanScore    = clamp((homeSS * 0.5 + homeBigC / 5 * 0.3 + (1 - awayDS) * 0.2));
  const underdogAttack  = favoriteIsHome ? awayCanScore : homeCanScore;
  const setpieceThreat  = (homeBigC + awayBigC) / 8; // proxy
  const desperation     = (motivAsym > 0.3 || isKnockout > 0.5) ? 0.2 : 0;

  const bttsFlipSignals: string[] = [];
  const bttsFlipRisk = clamp(
    awayCanScore * 0.30
    + homeCanScore * 0.25
    + underdogAttack * 0.20
    + setpieceThreat * 0.15
    + desperation,
  );

  if (awayCanScore > 0.6)  bttsFlipSignals.push(`Away team has meaningful scoring ability despite being outsiders`);
  if (homeCanScore > 0.7)  bttsFlipSignals.push(`Home team expected to score and is difficult to shut out`);
  if (setpieceThreat > 0.4) bttsFlipSignals.push(`High big-chance creation on both sides — set pieces dangerous`);
  if (desperation > 0)      bttsFlipSignals.push(`Must-win pressure or knockout context forces both teams to attack`);

  const overall = (upsetPotential + goalInflationRisk + bttsFlipRisk) / 3;

  const riskLabel = (v: number) => v >= 0.55 ? "High" : v >= 0.32 ? "Medium" : "Low";
  const chaosLabel = overall >= 0.55 ? "High Chaos" : overall >= 0.32 ? "Moderate" : "Stable";
  const chaosColor = overall >= 0.55 ? "#f87171" : overall >= 0.32 ? "#f59e0b" : "#4ade80";

  return {
    upsetPotential: round2(upsetPotential),
    upsetLabel: riskLabel(upsetPotential),
    upsetSignals,
    goalInflationRisk: round2(goalInflationRisk),
    goalInflationLabel: riskLabel(goalInflationRisk),
    goalInflationSignals,
    bttsFlipRisk: round2(bttsFlipRisk),
    bttsFlipLabel: riskLabel(bttsFlipRisk),
    bttsFlipSignals,
    overallChaosIndex: round2(overall),
    chaosLabel,
    chaosColor,
  };
}

// ── Extended Markets ───────────────────────────────────────────────────────
export interface ExtendedMarkets {
  // 1X2
  homeWin:  { probability: number; prediction: "Yes" | "No" | "?"; label: string };
  draw:     { probability: number; prediction: "Yes" | "No" | "?"; label: string };
  awayWin:  { probability: number; prediction: "Yes" | "No" | "?"; label: string };

  // Double Chance
  x1:   { probability: number; prediction: "Yes" | "No" | "?"; label: string };  // Home or Draw
  x2:   { probability: number; prediction: "Yes" | "No" | "?"; label: string };  // Away or Draw
  homeOrAway: { probability: number; prediction: "Yes" | "No" | "?"; label: string }; // No Draw

  // Goals
  over25: { probability: number; prediction: "Yes" | "No" | "?"; label: string };
  over35: { probability: number; prediction: "Yes" | "No" | "?"; label: string };

  // BTTS
  btts: { probability: number; prediction: "Yes" | "No" | "?"; label: string };

  // First to score
  firstToScore: {
    homeProbability: number;
    awayProbability: number;
    noGoalProbability: number;
    prediction: "Home" | "Away" | "No Goal";
  };

  // Each team to score 2 or more
  home2Plus: { probability: number; prediction: "Yes" | "No" | "?"; label: string };
  away2Plus: { probability: number; prediction: "Yes" | "No" | "?"; label: string };

  // Draw intelligence (from draw classifier if available, otherwise computed)
  drawProbability: number;
  drawIntelligence: {
    isLikelyDraw: boolean;
    drawScore: number;    // 0-1 composite draw tendency score
    signals: string[];
  };
}

function marketLabel(prob: number, threshold: number = 0.55): "Yes" | "No" | "?" {
  if (prob >= threshold) return "Yes";
  if (prob <= 1 - threshold) return "No";
  return "?";
}

export function buildExtendedMarkets(
  row: any,
  homeWinProb: number,
  drawProb: number,
  awayWinProb: number,
  drawModelScore?: number, // 0-1 from trained draw classifier if available
): ExtendedMarkets {
  const homeGS  = num(row.home_avg_goals_scored, 1.4);
  const awayGS  = num(row.away_avg_goals_scored, 1.1);
  const homeGC  = num(row.home_avg_goals_conceded, 1.2);
  const awayGC  = num(row.away_avg_goals_conceded, 1.4);
  const homeXg  = num(row.home_avg_xg, homeGS);
  const awayXg  = num(row.away_avg_xg, awayGS);
  const homeCS  = num(row.home_clean_sheets, 3);
  const awayCS  = num(row.away_clean_sheets, 2);
  const homeM   = num(row.home_matches_analyzed, 15);
  const awayM   = num(row.away_matches_analyzed, 15);
  const homeShots = num(row.home_avg_total_shots, 12);
  const awayShots = num(row.away_avg_total_shots, 10);
  const homeBigC  = num(row.home_avg_big_chances, 2);
  const awayBigC  = num(row.away_avg_big_chances, 1.5);
  const homeSS  = num(row.home_scoring_strength, 0.5);
  const awaySS  = num(row.away_scoring_strength, 0.5);
  const homeDS  = num(row.home_defending_strength, 0.5);
  const awayDS  = num(row.away_defending_strength, 0.5);
  const homeFS  = num(row.home_form_strength, 0.5);
  const awayFS  = num(row.away_form_strength, 0.5);
  const homeCons = num(row.ctx_home_conservative_coach, 0);
  const awayCons = num(row.ctx_away_conservative_coach, 0);
  const isKO    = num(row.ctx_is_knockout, 0);
  const oddsGap = num(row.ctx_odds_gap, 0);

  // Adjusted expected goals per team (attack vs opponent defense blend)
  const homeExp = clamp((homeGS * 0.4 + homeXg * 0.3 + awayGC * 0.3), 0.1, 5);
  const awayExp = clamp((awayGS * 0.4 + awayXg * 0.3 + homeGC * 0.3), 0.1, 5);
  const totalExp = homeExp + awayExp;

  // BTTS: P(home scores) × P(away scores)
  const homeCSRate = homeCS / Math.max(1, homeM);
  const awayCSRate = awayCS / Math.max(1, awayM);
  const bttsProb = clamp((1 - awayCSRate) * (1 - homeCSRate));

  // Over 2.5 / 3.5 via Poisson
  const over25Prob = clamp(1 - poissonPMF(0, totalExp) - poissonPMF(1, totalExp) - poissonPMF(2, totalExp));
  const over35Prob = clamp(
    1 - poissonPMF(0, totalExp) - poissonPMF(1, totalExp)
    - poissonPMF(2, totalExp) - poissonPMF(3, totalExp),
  );

  // Double chance
  const x1Prob        = clamp(homeWinProb + drawProb);
  const x2Prob        = clamp(awayWinProb + drawProb);
  const homeOrAwayP   = clamp(homeWinProb + awayWinProb);

  // First to score: home is more likely if they have more shots + aggression + strong tempo
  const homeAggression = (homeShots + homeBigC * 2) / (homeShots + homeBigC * 2 + awayShots + awayBigC * 2 + 0.01);
  const noGoalProb     = clamp(poissonPMF(0, homeExp) * poissonPMF(0, awayExp));
  const rawHomeFirst   = (1 - noGoalProb) * homeAggression;
  const rawAwayFirst   = (1 - noGoalProb) * (1 - homeAggression);
  const firstHomeP     = rawHomeFirst;
  const firstAwayP     = rawAwayFirst;

  const firstPred: "Home" | "Away" | "No Goal" =
    noGoalProb > 0.20 ? "No Goal" :
    firstHomeP > firstAwayP ? "Home" : "Away";

  // Team to score 2+: Poisson survival
  const home2PlusP = clamp(poissonSurvival(2, homeExp));
  const away2PlusP = clamp(poissonSurvival(2, awayExp));

  // ── Draw Intelligence ─────────────────────────────────────────────────
  const formBalance     = 1 - Math.abs(homeFS - awayFS);
  const defensiveNature = (homeDS + awayDS) / 2;
  const lowGoalTendency = totalExp < 2.2 ? 0.7 : totalExp < 2.8 ? 0.45 : 0.2;
  const conservatism    = (homeCons + awayCons) / 2;
  const knockoutPenalty = isKO > 0.5 ? -0.15 : 0; // knockouts rarely end in draws (in 90 mins context)

  const drawScore = clamp(
    formBalance * 0.30
    + defensiveNature * 0.20
    + lowGoalTendency * 0.20
    + conservatism * 0.15
    + (1 - oddsGap) * 0.15
    + knockoutPenalty,
  );

  // Blend with model-based draw prob if available
  const finalDrawProb = drawModelScore !== undefined
    ? clamp(drawProb * 0.5 + drawModelScore * 0.5)
    : drawProb;

  const drawSignals: string[] = [];
  if (formBalance > 0.85) drawSignals.push("Evenly matched teams — draw is natural equilibrium");
  if (defensiveNature > 0.6) drawSignals.push("Both defences strong — low scoring, drawn results common");
  if (lowGoalTendency > 0.5) drawSignals.push("Low expected goals increases draw probability");
  if (conservatism > 0.4) drawSignals.push("Conservative coaches — both sides likely to defend leads");
  if (oddsGap < 0.15) drawSignals.push("Odds nearly even — bookmakers see it as a coin flip");
  if (isKO > 0.5) drawSignals.push("Knockout stage may force extra time — 90-min draw possible");

  return {
    homeWin:  { probability: pct(homeWinProb),  prediction: marketLabel(homeWinProb),  label: "1" },
    draw:     { probability: pct(finalDrawProb), prediction: marketLabel(finalDrawProb), label: "X" },
    awayWin:  { probability: pct(awayWinProb),  prediction: marketLabel(awayWinProb),  label: "2" },
    x1:       { probability: pct(x1Prob),        prediction: marketLabel(x1Prob, 0.60), label: "X1 (Home/Draw)" },
    x2:       { probability: pct(x2Prob),        prediction: marketLabel(x2Prob, 0.60), label: "X2 (Away/Draw)" },
    homeOrAway: { probability: pct(homeOrAwayP), prediction: marketLabel(homeOrAwayP, 0.60), label: "12 (No Draw)" },
    over25:   { probability: pct(over25Prob),    prediction: marketLabel(over25Prob),   label: "Over 2.5" },
    over35:   { probability: pct(over35Prob),    prediction: marketLabel(over35Prob),   label: "Over 3.5" },
    btts:     { probability: pct(bttsProb),      prediction: marketLabel(bttsProb),     label: "BTTS" },
    firstToScore: {
      homeProbability: pct(firstHomeP),
      awayProbability: pct(firstAwayP),
      noGoalProbability: pct(noGoalProb),
      prediction: firstPred,
    },
    home2Plus: { probability: pct(home2PlusP), prediction: marketLabel(home2PlusP, 0.45), label: `Home 2+ Goals` },
    away2Plus: { probability: pct(away2PlusP), prediction: marketLabel(away2PlusP, 0.45), label: `Away 2+ Goals` },
    drawProbability: pct(finalDrawProb),
    drawIntelligence: {
      isLikelyDraw: drawScore > 0.55,
      drawScore: round2(drawScore),
      signals: drawSignals,
    },
  };
}
