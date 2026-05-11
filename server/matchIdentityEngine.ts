/**
 * Pre-Match Identity Engine — Stage 2
 *
 * Before score prediction, this engine determines the fundamental
 * identity of the match across 5 layers:
 *   1. Winner Layer       — Home / Away / Even
 *   2. Goal Range Layer   — Low / Medium / High / Very High
 *   3. BTTS Layer         — Yes / No / 50-50
 *   4. Tempo Layer        — Open / Controlled / Defensive
 *   5. Risk Layer         — Aggressive / Balanced / Conservative
 *
 * Each layer produces a label, confidence %, and an explanation.
 * These layers gate which bucket families are plausible.
 */

export type WinnerLabel = "home_favored" | "away_favored" | "even";
export type GoalRangeLabel = "very_low" | "low" | "medium" | "high" | "very_high";
export type BTTSLabel = "yes" | "no" | "fifty_fifty";
export type TempoLabel = "open" | "controlled" | "defensive";
export type RiskLabel = "aggressive" | "balanced" | "conservative";

export interface IdentityLayer<T extends string> {
  label: T;
  confidence: number;   // 0..100
  detail: string;
  signals: string[];
}

export interface MatchIdentity {
  winner: IdentityLayer<WinnerLabel>;
  goalRange: IdentityLayer<GoalRangeLabel>;
  btts: IdentityLayer<BTTSLabel>;
  tempo: IdentityLayer<TempoLabel>;
  risk: IdentityLayer<RiskLabel>;
  overallGoalExpectancy: number;    // expected total goals
  expectedHomeGoals: number;
  expectedAwayGoals: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function n(v: any): number {
  if (v === null || v === undefined) return 0;
  const num = Number(v);
  return isNaN(num) ? 0 : num;
}

// Convert fractional/decimal odds probability, remove bookmaker margin
function trueProb(homeOdds: number, drawOdds: number, awayOdds: number): {
  homeWin: number; draw: number; awayWin: number;
} {
  if (!homeOdds || !drawOdds || !awayOdds) return { homeWin: 1/3, draw: 1/3, awayWin: 1/3 };
  const rawH = 1 / homeOdds;
  const rawD = 1 / drawOdds;
  const rawA = 1 / awayOdds;
  const total = rawH + rawD + rawA;
  return {
    homeWin: rawH / total,
    draw:    rawD / total,
    awayWin: rawA / total,
  };
}

export function computeMatchIdentity(row: Record<string, any>): MatchIdentity {
  // ── Core stats ───────────────────────────────────────────────────────────
  const homeGoalsSc    = n(row.home_avg_goals_scored);
  const homeGoalsConc  = n(row.home_avg_goals_conceded);
  const awayGoalsSc    = n(row.away_avg_goals_scored);
  const awayGoalsConc  = n(row.away_avg_goals_conceded);
  const homeXg         = n(row.home_avg_xg);
  const awayXg         = n(row.away_avg_xg);
  const homePoss       = n(row.home_avg_possession);
  const awayPoss       = n(row.away_avg_possession);
  const homeShots      = n(row.home_avg_total_shots);
  const awayShots      = n(row.away_avg_total_shots);
  const homeBigCh      = n(row.home_avg_big_chances);
  const awayBigCh      = n(row.away_avg_big_chances);
  const homeClean      = n(row.home_clean_sheets);
  const awayClean      = n(row.away_clean_sheets);
  const homeFormStr    = n(row.home_form_strength);
  const awayFormStr    = n(row.away_form_strength);
  const homeScStr      = n(row.home_scoring_strength);
  const awayScStr      = n(row.away_scoring_strength);
  const homeDefStr     = n(row.home_defending_strength);
  const awayDefStr     = n(row.away_defending_strength);
  const homeFormPts    = n(row.home_form_points);
  const awayFormPts    = n(row.away_form_points);
  const homeMatchesA   = n(row.home_matches_analyzed) || 15;
  const awayMatchesA   = n(row.away_matches_analyzed) || 15;
  const homeInjury     = n(row.home_injury_impact);
  const awayInjury     = n(row.away_injury_impact);
  const homeMotiv      = n(row.ctx_home_motivation);
  const awayMotiv      = n(row.ctx_away_motivation);
  const homeFatigue    = n(row.ctx_home_fatigue_index);
  const awayFatigue    = n(row.ctx_away_fatigue_index);
  const isKnockout     = n(row.ctx_is_knockout);
  const homeCons       = n(row.ctx_home_conservative_coach);
  const awayCons       = n(row.ctx_away_conservative_coach);
  const oddsH          = n(row.ctx_odds_home_win);
  const oddsD          = n(row.ctx_odds_draw);
  const oddsA          = n(row.ctx_odds_away_win);
  const oddsGap        = n(row.ctx_odds_gap);

  const hasOdds = oddsH > 0 && oddsD > 0 && oddsA > 0;
  const { homeWin: oddsHomeWin, draw: oddsDraw, awayWin: oddsAwayWin } =
    hasOdds ? trueProb(oddsH, oddsD, oddsA) : { homeWin: 0, draw: 0, awayWin: 0 };

  // ── LAYER 1: Winner ───────────────────────────────────────────────────────
  // Blend form, scoring/defending differential, and odds probability
  const formAdvantage = (homeFormStr - awayFormStr) * 0.3
    + (homeScStr - awayDefStr - (awayScStr - homeDefStr)) * 0.25
    + (homeFormPts - awayFormPts) * 0.01;

  let oddsWinnerScore = 0;
  if (hasOdds) oddsWinnerScore = oddsHomeWin - oddsAwayWin;

  const combinedWinner = formAdvantage * 0.45 + oddsWinnerScore * 0.55;
  const injuryPenalty = (homeInjury - awayInjury) * 0.1;
  const motivBoost = (homeMotiv - awayMotiv) * 0.05;
  const finalWinner = combinedWinner - injuryPenalty + motivBoost;

  let winnerLabel: WinnerLabel;
  let winnerConf: number;
  const winnerSignals: string[] = [];

  if (finalWinner > 0.08) {
    winnerLabel = "home_favored";
    winnerConf = clamp(50 + finalWinner * 200, 50, 92);
    winnerSignals.push(`Home form advantage: ${(homeFormStr - awayFormStr).toFixed(2)}`);
    if (hasOdds) winnerSignals.push(`Odds: Home ${(oddsHomeWin * 100).toFixed(0)}% vs Away ${(oddsAwayWin * 100).toFixed(0)}%`);
  } else if (finalWinner < -0.08) {
    winnerLabel = "away_favored";
    winnerConf = clamp(50 + Math.abs(finalWinner) * 200, 50, 92);
    winnerSignals.push(`Away form advantage: ${(awayFormStr - homeFormStr).toFixed(2)}`);
    if (hasOdds) winnerSignals.push(`Odds: Away ${(oddsAwayWin * 100).toFixed(0)}% vs Home ${(oddsHomeWin * 100).toFixed(0)}%`);
  } else {
    winnerLabel = "even";
    winnerConf = clamp(50 + (1 - Math.abs(finalWinner) * 10) * 20, 50, 72);
    winnerSignals.push("Evenly matched — form, stats, and odds converge");
    if (hasOdds) winnerSignals.push(`Draw odds: ${(oddsDraw * 100).toFixed(0)}%`);
  }
  if (homeInjury > 0.3) winnerSignals.push(`Home injury impact: ${homeInjury.toFixed(2)}`);
  if (awayInjury > 0.3) winnerSignals.push(`Away injury impact: ${awayInjury.toFixed(2)}`);

  const winnerDetail = winnerLabel === "home_favored"
    ? "Home team holds a meaningful advantage in form and strength."
    : winnerLabel === "away_favored"
    ? "Away team holds a meaningful advantage in form and strength."
    : "Neither team holds a decisive pre-match edge.";

  // ── LAYER 2: Goal Range ───────────────────────────────────────────────────
  // Expected goals from both sides — blend xG, scored/conceded avg, form
  const homeAttackGoals = homeXg > 0
    ? (homeXg * 0.6 + homeGoalsSc * 0.4)
    : homeGoalsSc;
  const awayAttackGoals = awayXg > 0
    ? (awayXg * 0.6 + awayGoalsSc * 0.4)
    : awayGoalsSc;

  // Expected home goals = home attack constrained by away defense
  const expectedHomeGoals = clamp(
    homeAttackGoals * 0.55 + awayGoalsConc * 0.45,
    0, 5
  );
  const expectedAwayGoals = clamp(
    awayAttackGoals * 0.55 + homeGoalsConc * 0.45,
    0, 5
  );
  const expectedTotal = expectedHomeGoals + expectedAwayGoals;

  // Contextual adjustments
  let totalAdj = expectedTotal;
  if (isKnockout) totalAdj *= 0.93; // knockout = slightly fewer goals
  if (homeMotiv > 0.8 && awayMotiv > 0.8) totalAdj *= 1.05; // high stakes both ways
  if (homeFatigue > 0.6 || awayFatigue > 0.6) totalAdj *= 0.95;

  let goalLabel: GoalRangeLabel;
  let goalConf: number;
  const goalSignals: string[] = [];
  goalSignals.push(`Expected home goals: ${expectedHomeGoals.toFixed(2)}`);
  goalSignals.push(`Expected away goals: ${expectedAwayGoals.toFixed(2)}`);

  if (totalAdj < 1.4) {
    goalLabel = "very_low";  goalConf = 65;
    goalSignals.push("Both defences strong, few chances expected");
  } else if (totalAdj < 2.1) {
    goalLabel = "low";  goalConf = 60;
    goalSignals.push("Tightly contested — 1 to 2 goals likely");
  } else if (totalAdj < 2.8) {
    goalLabel = "medium";  goalConf = 65;
    goalSignals.push("Moderate scoring match expected");
  } else if (totalAdj < 3.8) {
    goalLabel = "high";  goalConf = 62;
    goalSignals.push("Open match — 3+ goals likely");
  } else {
    goalLabel = "very_high";  goalConf = 58;
    goalSignals.push("High-scoring encounter expected — both defences exposed");
  }
  if (homeShots > 15 || awayShots > 15) goalSignals.push("High shot volume from at least one team");
  if (homeBigCh > 3 || awayBigCh > 3) goalSignals.push("Big chances profile — clinical finish needed");

  // ── LAYER 3: BTTS ─────────────────────────────────────────────────────────
  const homeScoresRate = homeGoalsSc > 0 ? clamp(homeGoalsSc / 1.5, 0, 1) : 0;
  const awayScoresRate = awayGoalsSc > 0 ? clamp(awayGoalsSc / 1.5, 0, 1) : 0;
  const homeConcedesRate = homeGoalsConc > 0.6 ? 1 : homeGoalsConc / 0.6;
  const awayConcedesRate = awayGoalsConc > 0.6 ? 1 : awayGoalsConc / 0.6;

  // Clean sheet rates hurt BTTS (per 15 matches)
  const homeCleanRate = homeClean / homeMatchesA;
  const awayCleanRate = awayClean / awayMatchesA;

  const bttsRaw = (homeScoresRate * 0.35)
    + (awayScoresRate * 0.35)
    + (homeConcedesRate * 0.15)
    + (awayConcedesRate * 0.15)
    - (homeCleanRate * 0.15)
    - (awayCleanRate * 0.15);

  const bttsProb = clamp(bttsRaw, 0, 1);

  let bttsLabel: BTTSLabel;
  let bttsConf: number;
  const bttsSignals: string[] = [];
  bttsSignals.push(`Home avg scored: ${homeGoalsSc.toFixed(2)}, Away avg scored: ${awayGoalsSc.toFixed(2)}`);
  bttsSignals.push(`Home clean sheets: ${homeClean}/${homeMatchesA}, Away clean sheets: ${awayClean}/${awayMatchesA}`);

  if (bttsProb >= 0.62) {
    bttsLabel = "yes";  bttsConf = clamp(50 + (bttsProb - 0.62) * 300, 52, 85);
    bttsSignals.push("Both teams score regularly — BTTS likely");
  } else if (bttsProb <= 0.42) {
    bttsLabel = "no";  bttsConf = clamp(50 + (0.42 - bttsProb) * 300, 52, 82);
    bttsSignals.push("Clean sheet probability is high — BTTS unlikely");
  } else {
    bttsLabel = "fifty_fifty";  bttsConf = 50;
    bttsSignals.push("50/50 — stats do not clearly favour either way");
  }

  // ── LAYER 4: Tempo ────────────────────────────────────────────────────────
  const combinedShots = homeShots + awayShots;
  const possessionDiff = Math.abs(homePoss - awayPoss);
  const conservativeCoaches = homeCons + awayCons;

  let tempoScore = 0;
  if (combinedShots > 28) tempoScore += 0.35;
  else if (combinedShots > 22) tempoScore += 0.15;
  else if (combinedShots < 16) tempoScore -= 0.25;

  if (possessionDiff < 8) tempoScore += 0.1; // contested
  if (conservativeCoaches >= 2) tempoScore -= 0.2;
  if (conservativeCoaches === 0) tempoScore += 0.1;
  if (isKnockout) tempoScore -= 0.1;
  if (expectedTotal > 3) tempoScore += 0.15;

  let tempoLabel: TempoLabel;
  let tempoConf: number;
  const tempoSignals: string[] = [];
  tempoSignals.push(`Combined shots avg: ${combinedShots.toFixed(1)}`);
  tempoSignals.push(`Possession split: ${homePoss.toFixed(0)}% vs ${awayPoss.toFixed(0)}%`);

  if (tempoScore >= 0.2) {
    tempoLabel = "open"; tempoConf = clamp(55 + tempoScore * 80, 55, 84);
    tempoSignals.push("High shot volume and contested possession — open game");
  } else if (tempoScore <= -0.2) {
    tempoLabel = "defensive"; tempoConf = clamp(55 + Math.abs(tempoScore) * 80, 55, 84);
    tempoSignals.push("Conservative coaches, low shot volume — defensive match");
  } else {
    tempoLabel = "controlled"; tempoConf = 58;
    tempoSignals.push("Moderate tempo — neither fully open nor defensive");
  }

  // ── LAYER 5: Risk ─────────────────────────────────────────────────────────
  // Aggression = high shots, big chances, home attack, motivation
  const riskScore = (combinedShots > 26 ? 0.3 : combinedShots < 18 ? -0.3 : 0)
    + (homeBigCh + awayBigCh > 6 ? 0.2 : 0)
    + ((homeMotiv + awayMotiv) / 2 > 0.7 ? 0.2 : 0)
    + (isKnockout ? -0.15 : 0)
    + (conservativeCoaches > 0 ? -0.15 : 0.1)
    + (oddsGap > 0.5 ? -0.1 : 0); // lopsided game = underdog parks bus

  let riskLabel: RiskLabel;
  let riskConf: number;
  const riskSignals: string[] = [];

  if (riskScore >= 0.25) {
    riskLabel = "aggressive"; riskConf = clamp(52 + riskScore * 100, 52, 84);
    riskSignals.push("High-energy match — both sides taking risks");
    riskSignals.push(`Big chances combined: ${(homeBigCh + awayBigCh).toFixed(1)} per match`);
  } else if (riskScore <= -0.2) {
    riskLabel = "conservative"; riskConf = clamp(52 + Math.abs(riskScore) * 100, 52, 82);
    riskSignals.push("Cautious approach from at least one side");
    if (conservativeCoaches > 0) riskSignals.push("Conservative coaching tendencies detected");
    if (oddsGap > 0.5) riskSignals.push("Underdog likely to park the bus");
  } else {
    riskLabel = "balanced"; riskConf = 56;
    riskSignals.push("Balanced risk profile — attacking and defensive spells expected");
  }
  if (homeMotiv > 0.8) riskSignals.push(`Home very motivated (${(homeMotiv * 100).toFixed(0)}%)`);
  if (awayMotiv > 0.8) riskSignals.push(`Away very motivated (${(awayMotiv * 100).toFixed(0)}%)`);

  return {
    winner: { label: winnerLabel, confidence: Math.round(winnerConf), detail: winnerDetail, signals: winnerSignals },
    goalRange: { label: goalLabel, confidence: Math.round(goalConf), detail: `Expected total: ${totalAdj.toFixed(2)} goals`, signals: goalSignals },
    btts: { label: bttsLabel, confidence: Math.round(bttsConf), detail: `BTTS probability: ${(bttsProb * 100).toFixed(0)}%`, signals: bttsSignals },
    tempo: { label: tempoLabel, confidence: Math.round(tempoConf), detail: "", signals: tempoSignals },
    risk: { label: riskLabel, confidence: Math.round(riskConf), detail: "", signals: riskSignals },
    overallGoalExpectancy: +totalAdj.toFixed(2),
    expectedHomeGoals: +expectedHomeGoals.toFixed(2),
    expectedAwayGoals: +expectedAwayGoals.toFixed(2),
  };
}
