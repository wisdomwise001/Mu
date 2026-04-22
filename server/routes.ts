import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import db from "./db";
import engine, { extractFeatures, FEATURE_NAMES } from "./xgEngine";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SOFASCORE_API = "https://api.sofascore.com/api/v1";

type ProcessingJob = {
  id: string;
  status: "running" | "completed" | "cancelled";
  total: number;
  processed: number;
  stored: number;
  skipped: number;
  failed: number;
  log: string[];
  cancelRequested: boolean;
};

const jobs = new Map<string, ProcessingJob>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function determineScaling(totalShots: number, totalBigChances: number): number {
  if (totalShots > 25 || totalBigChances >= 7) return 0.67;
  if (totalShots < 18 || totalBigChances <= 3) return 0.72;
  return 0.70;
}

function calculateCustomXG(
  shots: number | null,
  bigChances: number | null,
  shotsOnTarget: number | null,
  blockedShots: number | null,
  opponentShots: number | null,
  opponentBigChances: number | null,
): number | null {
  if (shots === null && shotsOnTarget === null && bigChances === null) return null;
  const S = shots ?? 0;
  const BC = bigChances ?? 0;
  const SoT = shotsOnTarget ?? 0;
  const B = blockedShots ?? 0;
  const rawXG = (S * 0.05) + (BC * 0.25) + (SoT * 0.10) - (B * 0.03);
  const totalShots = S + (opponentShots ?? S);
  const totalBC = BC + (opponentBigChances ?? BC);
  const scaling = determineScaling(totalShots, totalBC);
  let xg = rawXG * scaling;
  if (BC === 0 && SoT <= 2) xg = Math.min(xg, 0.60);
  if (BC >= 4) xg = Math.max(xg, 1.50);
  if (S < 10) xg = Math.min(xg, 1.60);
  if (S > 20) xg = Math.min(xg, 3.50);
  if (xg > 4.00) xg = 4.00 + (xg - 4.00) * 0.50;
  return Math.round(xg * 100) / 100;
}

type GoalState = { time: number; homeScore: number; awayScore: number };

type SSBIBreaker = {
  playerId: number;
  name: string;
  zzbGoals: number;
  ddiGoals: number;
  total: number;
  available: boolean | null;
};

type SSBI = {
  zzb: number | null;
  zzbMatches: number;
  lbr: number | null;
  lbrMatches: number;
  ddi: number | null;
  ddiMatches: number;
  keyBreakers: SSBIBreaker[];
};

type GSRM = {
  ecri: number | null;
  eri: number | null;
  tgbi: number | null;
  frqi: number | null;
  ecriMatches: number;
  eriMatches: number;
  tgbiMatches: number;
  frqiMatches: number;
};

type ScoringBucket = {
  label: string;
  scored: number;
  conceded: number;
  scoredPct: number;
  concededPct: number;
};

type MatchNarrative =
  | "unluckyLoss"
  | "wastedDominance"
  | "luckyWin"
  | "smashAndGrab"
  | "dominantWin"
  | "exploitedWeakDef"
  | "outclassed"
  | "comeback"
  | "blewLead"
  | "openTradeoff"
  | "lateShow"
  | "fastStart"
  | "deadlock";

type MatchStory = {
  eventId: number;
  date: number;
  opponent: string;
  venue: "H" | "A";
  result: "W" | "D" | "L";
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number | null;
  xgAgainst: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  bigChances: number | null;
  bigChancesMissed: number | null;
  possession: number | null;
  firstGoalMin: number | null;
  firstConcMin: number | null;
  wasTwoBehind: boolean;
  goalsAfterTwoBehind: number;
  wasTwoAhead: boolean;
  concededAfterTwoAhead: number;
  scoredFirst: boolean;
  concededFirst: boolean;
  goalsAfterScoringFirst: number;
  concededAfterScoringFirst: number;
  goalsAfterConcedingFirst: number;
  concededAfterConcedingFirst: number;
  narratives: MatchNarrative[];
  oneLine: string;
};

type HiddenTruth = {
  key: string;
  label: string;
  value: string;
  detail: string;
  signal: "positive" | "negative" | "neutral";
};

type MatchupCrossRef = {
  key: string;
  headline: string;
  detail: string;
  forSide: "home" | "away" | "both";
};

type SimulationInsights = {
  home: HiddenTruth[];
  away: HiddenTruth[];
  matchup: MatchupCrossRef[];
};

type RecurringPattern = {
  key: MatchNarrative | "always_score_first" | "always_concede_first" | "always_late_show" | "always_fast_start" | "xg_overperformer_streak" | "xg_underperformer_streak" | "comeback_kings" | "frontrunner_chokers";
  label: string;
  count: number;
  total: number;
  evidence: string;
};

type ScoringPatterns = {
  matchesAnalyzed: number;
  matchesWithIncidents: number;
  matchesWithStats: number;
  totalScored: number;
  totalConceded: number;
  avgScored: number | null;
  avgConceded: number | null;
  buckets: ScoringBucket[];
  peakScoringWindow: string | null;
  peakScoringPct: number | null;
  vulnerabilityWindow: string | null;
  vulnerabilityPct: number | null;
  avgFirstGoalMin: number | null;
  avgFirstConcededMin: number | null;
  scoredFirstRate: number | null;
  concededFirstRate: number | null;
  winWhenScoredFirst: number | null;
  winWhenConcededFirst: number | null;
  cleanSheetRate: number | null;
  failedToScoreRate: number | null;
  bttsRate: number | null;
  over25Rate: number | null;
  comebackRate: number | null;
  blownLeadRate: number | null;
  xgPerMatch: number | null;
  xgAgainstPerMatch: number | null;
  xgDelta: number | null;
  defensiveXgDelta: number | null;
  shotsPerMatch: number | null;
  bigChancesPerMatch: number | null;
  bigChancesMissedPerMatch: number | null;
  finishingTag: "Deadly" | "Clinical" | "Reliable" | "Wasteful" | "Flop" | null;
  defensiveTag: "Resolute" | "Solid" | "Average" | "Leaky" | "Sieve" | null;
  styleTags: string[];
  recurringPatterns: RecurringPattern[];
  matchStories: MatchStory[];
  exploitProfile: {
    avgGoalsVsLeakyOpp: number | null;
    matchesVsLeakyOpp: number;
    avgGoalsVsResoluteOpp: number | null;
    matchesVsResoluteOpp: number;
  };
};

const PATTERN_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: "0–15′",  from: 0,  to: 15 },
  { label: "16–30′", from: 15, to: 30 },
  { label: "31–45′", from: 30, to: 46 },
  { label: "46–60′", from: 45, to: 60 },
  { label: "61–75′", from: 60, to: 75 },
  { label: "76–90′", from: 75, to: 200 },
];

function bucketFor(time: number): number {
  for (let i = 0; i < PATTERN_BUCKETS.length; i++) {
    const b = PATTERN_BUCKETS[i];
    if (time > b.from && time <= b.to) return i;
  }
  return Math.max(0, PATTERN_BUCKETS.length - 1);
}

function readMatchStat(statsData: any, side: "home" | "away", names: string[]): number | null {
  const periodData = (statsData?.statistics || []).find((p: any) => p.period === "ALL");
  if (!periodData) return null;
  for (const group of (periodData.groups || [])) {
    for (const item of (group.statisticsItems || [])) {
      const n = (item.name || "").toLowerCase().trim();
      if (names.includes(n)) {
        const raw = side === "home" ? item.home : item.away;
        if (raw === null || raw === undefined || raw === "") continue;
        const str = String(raw).trim();
        const slash = str.indexOf("/");
        const num = slash > 0
          ? parseFloat(str.slice(0, slash).replace(/[^0-9.]/g, ""))
          : parseFloat(str.replace(/[^0-9.\-]/g, ""));
        if (Number.isFinite(num)) return num;
      }
    }
  }
  return null;
}

function buildMatchStory(
  event: any,
  teamId: number,
  incData: any,
  statsData: any,
): MatchStory | null {
  const isHome = event.homeTeam?.id === teamId;
  const isAway = event.awayTeam?.id === teamId;
  if (!isHome && !isAway) return null;

  const side: "home" | "away" = isHome ? "home" : "away";
  const oppSide: "home" | "away" = isHome ? "away" : "home";
  const opponent = isHome ? (event.awayTeam?.shortName || event.awayTeam?.name || "Opp") : (event.homeTeam?.shortName || event.homeTeam?.name || "Opp");

  const goals = incData ? parseGoalTimeline(incData) : [];
  const finalState = goals.length > 0
    ? goals[goals.length - 1]
    : {
        time: 0,
        homeScore: Number(event.homeScore?.current ?? event.homeScore?.normaltime ?? 0) || 0,
        awayScore: Number(event.awayScore?.current ?? event.awayScore?.normaltime ?? 0) || 0,
      };
  const goalsFor = isHome ? finalState.homeScore : finalState.awayScore;
  const goalsAgainst = isHome ? finalState.awayScore : finalState.homeScore;
  const result: "W" | "D" | "L" = goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";

  const xgFor = readMatchStat(statsData, side, ["expected goals", "xg"]);
  const xgAgainst = readMatchStat(statsData, oppSide, ["expected goals", "xg"]);
  const shots = readMatchStat(statsData, side, ["total shots", "shots"]);
  const shotsOnTarget = readMatchStat(statsData, side, ["shots on target"]);
  const bigChances = readMatchStat(statsData, side, ["big chances"]);
  const bigChancesMissed = readMatchStat(statsData, side, ["big chances missed"]);
  const possession = readMatchStat(statsData, side, ["ball possession"]);

  let firstGoalMin: number | null = null;
  let firstConcMin: number | null = null;
  let everBehind = false, everLed = false;
  let wasTwoBehind = false, wasTwoAhead = false;
  let goalsAfterTwoBehind = 0, concededAfterTwoAhead = 0;
  let goalsAfterScoringFirst = 0, concededAfterScoringFirst = 0;
  let goalsAfterConcedingFirst = 0, concededAfterConcedingFirst = 0;
  let scoredFirst = false, concededFirst = false;
  let prev = { time: 0, homeScore: 0, awayScore: 0 };
  for (const g of goals) {
    const tF = isHome ? g.homeScore : g.awayScore;
    const oF = isHome ? g.awayScore : g.homeScore;
    const tP = isHome ? prev.homeScore : prev.awayScore;
    const oP = isHome ? prev.awayScore : prev.homeScore;
    const teamGoalNow = tF > tP;
    const oppGoalNow  = oF > oP;
    if (teamGoalNow && firstGoalMin === null) {
      firstGoalMin = g.time;
      if (firstConcMin === null) scoredFirst = true;
    }
    if (oppGoalNow && firstConcMin === null) {
      firstConcMin = g.time;
      if (firstGoalMin === null) concededFirst = true;
    }
    if (oF > tF) everBehind = true;
    if (tF > oF) everLed = true;

    // Track goals after going 2 behind / 2 ahead
    if (wasTwoBehind && teamGoalNow) goalsAfterTwoBehind++;
    if (wasTwoAhead && oppGoalNow) concededAfterTwoAhead++;

    // Track post-first-goal flow
    if (scoredFirst && firstGoalMin !== null && g.time > firstGoalMin) {
      if (teamGoalNow) goalsAfterScoringFirst++;
      if (oppGoalNow)  concededAfterScoringFirst++;
    }
    if (concededFirst && firstConcMin !== null && g.time > firstConcMin) {
      if (teamGoalNow) goalsAfterConcedingFirst++;
      if (oppGoalNow)  concededAfterConcedingFirst++;
    }

    // Update behind/ahead-by-2 flags AFTER counting (so first goal that puts opp 2 up doesn't immediately count)
    if (oF - tF >= 2) wasTwoBehind = true;
    if (tF - oF >= 2) wasTwoAhead = true;

    prev = g;
  }

  const narratives: MatchNarrative[] = [];
  if (xgFor != null) {
    if (result === "L" && xgFor - goalsFor >= 0.7 && xgFor >= 1.4) narratives.push("unluckyLoss");
    if (result === "W" && goalsFor - xgFor >= 0.7) narratives.push("luckyWin");
  }
  if ((shots != null && shots >= 14) || (bigChances != null && bigChances >= 3)) {
    if ((result === "L" || result === "D") && goalsFor <= 1) narratives.push("wastedDominance");
  }
  if (result === "W" && xgFor != null && xgFor < 1.0 && goalsAgainst <= 1) narratives.push("smashAndGrab");
  if (result === "W" && (possession ?? 0) >= 58 && (shots ?? 0) >= 13 && goalsFor - goalsAgainst >= 2) narratives.push("dominantWin");
  if (result === "W" && goalsFor - goalsAgainst >= 3) narratives.push("exploitedWeakDef");
  if (result === "L" && goalsAgainst - goalsFor >= 2 && (possession ?? 50) <= 42) narratives.push("outclassed");
  if (everBehind && (result === "W" || result === "D")) narratives.push("comeback");
  if (everLed && result !== "W") narratives.push("blewLead");
  if (goalsFor + goalsAgainst >= 4) narratives.push("openTradeoff");
  if (firstGoalMin != null && firstGoalMin >= 70 && goalsFor > 0) narratives.push("lateShow");
  if (firstGoalMin != null && firstGoalMin <= 15 && goalsFor > 0) narratives.push("fastStart");
  if (goalsFor === 0 && goalsAgainst === 0) narratives.push("deadlock");

  let oneLine = `${venueChar(side)} vs ${opponent} · ${goalsFor}-${goalsAgainst} ${result}`;
  if (xgFor != null && xgAgainst != null) {
    oneLine += ` · xG ${xgFor.toFixed(1)}-${xgAgainst.toFixed(1)}`;
  }
  if (narratives.length > 0) {
    const top = narratives.slice(0, 2).map(narrativeLabel).join(", ");
    oneLine += ` — ${top}`;
  }

  return {
    eventId: event.id,
    date: Number(event.startTimestamp) || 0,
    opponent,
    venue: isHome ? "H" : "A",
    result,
    goalsFor,
    goalsAgainst,
    xgFor,
    xgAgainst,
    shots,
    shotsOnTarget,
    bigChances,
    bigChancesMissed,
    possession,
    firstGoalMin,
    firstConcMin,
    wasTwoBehind,
    goalsAfterTwoBehind,
    wasTwoAhead,
    concededAfterTwoAhead,
    scoredFirst,
    concededFirst,
    goalsAfterScoringFirst,
    concededAfterScoringFirst,
    goalsAfterConcedingFirst,
    concededAfterConcedingFirst,
    narratives,
    oneLine,
  };
}

function venueChar(side: "home" | "away"): string {
  return side === "home" ? "H" : "A";
}

function narrativeLabel(n: MatchNarrative): string {
  const map: Record<MatchNarrative, string> = {
    unluckyLoss: "unlucky loss",
    wastedDominance: "wasted dominance",
    luckyWin: "lucky win",
    smashAndGrab: "smash & grab",
    dominantWin: "dominant win",
    exploitedWeakDef: "exploited weak defence",
    outclassed: "outclassed",
    comeback: "comeback",
    blewLead: "blew lead",
    openTradeoff: "open trade-off",
    lateShow: "late show",
    fastStart: "fast start",
    deadlock: "deadlock",
  };
  return map[n];
}

function computeScoringPatterns(
  events: any[],
  teamId: number,
  incidentsByEventId: Map<number, any>,
  statsByEventId: Map<number, any>,
  avgXgScored: number | null,
): ScoringPatterns {
  const buckets = PATTERN_BUCKETS.map((b) => ({
    label: b.label, scored: 0, conceded: 0, scoredPct: 0, concededPct: 0,
  }));

  let totalScored = 0;
  let totalConceded = 0;
  let firstGoalSum = 0, firstGoalCount = 0;
  let firstConcSum = 0, firstConcCount = 0;
  let scoredFirst = 0, concededFirst = 0;
  let winsScoredFirst = 0, winsConcededFirst = 0;
  let cleanSheets = 0, failedToScore = 0, btts = 0, over25 = 0;
  let comebacks = 0, blownLeads = 0;
  let matchesWithIncidents = 0;
  let finalGoalsFor = 0, finalGoalsAgainst = 0, finalCount = 0;

  for (const event of events) {
    const isHome = event.homeTeam?.id === teamId;
    const isAway = event.awayTeam?.id === teamId;
    if (!isHome && !isAway) continue;

    const incData = incidentsByEventId.get(event.id);
    const goals = incData ? parseGoalTimeline(incData) : [];

    const finalState = goals.length > 0
      ? goals[goals.length - 1]
      : {
          time: 0,
          homeScore: Number(event.homeScore?.current ?? event.homeScore?.normaltime ?? 0) || 0,
          awayScore: Number(event.awayScore?.current ?? event.awayScore?.normaltime ?? 0) || 0,
        };
    const teamFinal = isHome ? finalState.homeScore : finalState.awayScore;
    const oppFinal  = isHome ? finalState.awayScore : finalState.homeScore;
    finalGoalsFor += teamFinal;
    finalGoalsAgainst += oppFinal;
    finalCount++;

    if (teamFinal === 0) failedToScore++;
    if (oppFinal === 0) cleanSheets++;
    if (teamFinal > 0 && oppFinal > 0) btts++;
    if (teamFinal + oppFinal >= 3) over25++;

    if (goals.length === 0) continue;
    matchesWithIncidents++;

    const tS = (g: GoalState) => isHome ? g.homeScore : g.awayScore;
    const oS = (g: GoalState) => isHome ? g.awayScore : g.homeScore;

    let prev: GoalState = { time: 0, homeScore: 0, awayScore: 0 };
    let firstTeamGoalMin: number | null = null;
    let firstOppGoalMin: number | null = null;
    let everBehind = false;
    let everLed = false;

    for (const g of goals) {
      const teamScoredNow = tS(g) > tS(prev);
      const oppScoredNow  = oS(g) > oS(prev);
      const idx = bucketFor(g.time);
      if (teamScoredNow) {
        buckets[idx].scored++;
        totalScored++;
        if (firstTeamGoalMin === null) firstTeamGoalMin = g.time;
      }
      if (oppScoredNow) {
        buckets[idx].conceded++;
        totalConceded++;
        if (firstOppGoalMin === null) firstOppGoalMin = g.time;
      }
      if (oS(g) > tS(g)) everBehind = true;
      if (tS(g) > oS(g)) everLed = true;
      prev = g;
    }

    if (firstTeamGoalMin !== null && (firstOppGoalMin === null || firstTeamGoalMin < firstOppGoalMin)) {
      scoredFirst++;
      firstGoalSum += firstTeamGoalMin;
      firstGoalCount++;
      if (teamFinal > oppFinal) winsScoredFirst++;
      if (oppFinal > teamFinal || (everLed && teamFinal <= oppFinal)) blownLeads++;
    }
    if (firstOppGoalMin !== null && (firstTeamGoalMin === null || firstOppGoalMin < firstTeamGoalMin)) {
      concededFirst++;
      firstConcSum += firstOppGoalMin;
      firstConcCount++;
      if (teamFinal > oppFinal) winsConcededFirst++;
      if (everBehind && teamFinal >= oppFinal) comebacks++;
    }
  }

  buckets.forEach((b) => {
    b.scoredPct   = totalScored   > 0 ? Math.round((b.scored   / totalScored)   * 1000) / 10 : 0;
    b.concededPct = totalConceded > 0 ? Math.round((b.conceded / totalConceded) * 1000) / 10 : 0;
  });

  const matchesAnalyzed = events.length;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : null;

  let peakIdx = -1, peakVal = -1;
  let vulnIdx = -1, vulnVal = -1;
  buckets.forEach((b, i) => {
    if (b.scored   > peakVal) { peakVal = b.scored;   peakIdx = i; }
    if (b.conceded > vulnVal) { vulnVal = b.conceded; vulnIdx = i; }
  });

  const avgScored   = finalCount > 0 ? r1(finalGoalsFor / finalCount)     : null;
  const avgConceded = finalCount > 0 ? r1(finalGoalsAgainst / finalCount) : null;
  const xgDelta = (avgScored != null && avgXgScored != null) ? r1(avgScored - avgXgScored) : null;

  let finishingTag: ScoringPatterns["finishingTag"] = null;
  if (xgDelta != null) {
    if (xgDelta >= 0.45) finishingTag = "Deadly";
    else if (xgDelta >= 0.2) finishingTag = "Clinical";
    else if (xgDelta >= -0.2) finishingTag = "Reliable";
    else if (xgDelta >= -0.45) finishingTag = "Wasteful";
    else finishingTag = "Flop";
  }

  const styleTags: string[] = [];
  const peakLabel = peakIdx >= 0 ? PATTERN_BUCKETS[peakIdx].label : null;
  const vulnLabel = vulnIdx >= 0 ? PATTERN_BUCKETS[vulnIdx].label : null;

  if (peakLabel === "0–15′" && totalScored >= 5) styleTags.push(`Lightning starters — wizards at ${peakLabel} explosions`);
  if (peakLabel === "76–90′" && totalScored >= 5) styleTags.push(`Late finishers — most damage in ${peakLabel}`);
  if ((peakLabel === "31–45′" || peakLabel === "46–60′") && totalScored >= 5) styleTags.push(`Slow burners — peak window ${peakLabel}`);
  if (vulnLabel === "0–15′" && totalConceded >= 4) styleTags.push(`Slow to wake — leak goals in ${vulnLabel}`);
  if (vulnLabel === "76–90′" && totalConceded >= 4) styleTags.push(`Fade late — concede most in ${vulnLabel}`);

  const sFirst = pct(scoredFirst, matchesAnalyzed);
  const cFirst = pct(concededFirst, matchesAnalyzed);
  if (sFirst != null && sFirst >= 60) styleTags.push(`Score first ${sFirst}% of matches — front-foot starters`);
  if (cFirst != null && cFirst >= 55) styleTags.push(`Concede first ${cFirst}% — chasing games often`);

  if (avgScored != null && avgScored >= 2.0) styleTags.push(`Heavy scorers · ${avgScored} goals/match`);
  if (avgConceded != null && avgConceded >= 1.7) styleTags.push(`Leaky defence · ${avgConceded} conceded/match`);
  if (avgScored != null && avgScored < 1.0) styleTags.push(`Goal-shy · only ${avgScored} scored/match`);
  if (avgConceded != null && avgConceded < 0.8) styleTags.push(`Stingy · only ${avgConceded} conceded/match`);

  if (finishingTag === "Deadly")  styleTags.push(`Deadly finishers — beating xG by +${xgDelta}/match`);
  if (finishingTag === "Clinical") styleTags.push(`Clinical edge — over xG by +${xgDelta}/match`);
  if (finishingTag === "Wasteful") styleTags.push(`Wasteful — under xG by ${xgDelta}/match`);
  if (finishingTag === "Flop")     styleTags.push(`Flop in front of goal — under xG by ${xgDelta}/match`);

  const csRate  = pct(cleanSheets, matchesAnalyzed);
  const f2sRate = pct(failedToScore, matchesAnalyzed);
  const bttsRt  = pct(btts, matchesAnalyzed);
  const o25Rt   = pct(over25, matchesAnalyzed);
  if (csRate  != null && csRate  >= 35) styleTags.push(`${csRate}% clean-sheet rate`);
  if (f2sRate != null && f2sRate >= 35) styleTags.push(`Blank ${f2sRate}% of matches`);
  if (bttsRt  != null && bttsRt  >= 65) styleTags.push(`BTTS in ${bttsRt}% — open games`);
  if (o25Rt   != null && o25Rt   >= 65) styleTags.push(`Over 2.5 in ${o25Rt}% — high-scoring style`);

  // ── Per-match stories ─────────────────────────────────────────────────
  const matchStories: MatchStory[] = [];
  let xgForSum = 0, xgForCount = 0;
  let xgAgainstSum = 0, xgAgainstCount = 0;
  let shotsSum = 0, shotsCount = 0;
  let bcSum = 0, bcCount = 0;
  let bcMissedSum = 0, bcMissedCount = 0;
  let goalsVsLeakySum = 0, vsLeakyCount = 0;
  let goalsVsResoluteSum = 0, vsResoluteCount = 0;

  for (const event of events) {
    const incData = incidentsByEventId.get(event.id);
    const statsData = statsByEventId.get(event.id);
    const story = buildMatchStory(event, teamId, incData, statsData);
    if (!story) continue;
    matchStories.push(story);

    if (story.xgFor != null)            { xgForSum += story.xgFor; xgForCount++; }
    if (story.xgAgainst != null)        { xgAgainstSum += story.xgAgainst; xgAgainstCount++; }
    if (story.shots != null)            { shotsSum += story.shots; shotsCount++; }
    if (story.bigChances != null)       { bcSum += story.bigChances; bcCount++; }
    if (story.bigChancesMissed != null) { bcMissedSum += story.bigChancesMissed; bcMissedCount++; }

    // Opponent leakiness proxy: opponent xG conceded in this match (= our xgFor) high → opp's defence porous
    if (story.xgFor != null) {
      if (story.xgFor >= 1.7 || story.goalsAgainst >= 0) {
        // Use our created xG as proxy for opponent leakiness when high
        if (story.xgFor >= 1.6) {
          goalsVsLeakySum += story.goalsFor;
          vsLeakyCount++;
        } else if (story.xgFor <= 0.9) {
          goalsVsResoluteSum += story.goalsFor;
          vsResoluteCount++;
        }
      }
    }
  }
  matchStories.sort((a, b) => b.date - a.date);

  const matchesWithStats = matchStories.filter(s => s.xgFor != null).length;
  const xgPerMatch = xgForCount > 0 ? r1(xgForSum / xgForCount) : (avgXgScored != null ? r1(avgXgScored) : null);
  const xgAgainstPerMatch = xgAgainstCount > 0 ? r1(xgAgainstSum / xgAgainstCount) : null;
  const xgDelta2 = (avgScored != null && xgPerMatch != null) ? r1(avgScored - xgPerMatch) : xgDelta;
  const defensiveXgDelta = (avgConceded != null && xgAgainstPerMatch != null) ? r1(xgAgainstPerMatch - avgConceded) : null;
  const shotsPerMatch = shotsCount > 0 ? r1(shotsSum / shotsCount) : null;
  const bigChancesPerMatch = bcCount > 0 ? r1(bcSum / bcCount) : null;
  const bigChancesMissedPerMatch = bcMissedCount > 0 ? r1(bcMissedSum / bcMissedCount) : null;

  let defensiveTag: ScoringPatterns["defensiveTag"] = null;
  if (defensiveXgDelta != null && avgConceded != null) {
    if (avgConceded <= 0.7 && defensiveXgDelta >= 0)      defensiveTag = "Resolute";
    else if (avgConceded <= 1.1)                          defensiveTag = "Solid";
    else if (avgConceded <= 1.5)                          defensiveTag = "Average";
    else if (avgConceded <= 2.0)                          defensiveTag = "Leaky";
    else                                                  defensiveTag = "Sieve";
  }

  // ── Recurring narrative patterns ──────────────────────────────────────
  const narrCounts = new Map<MatchNarrative, number>();
  matchStories.forEach(s => s.narratives.forEach(n => narrCounts.set(n, (narrCounts.get(n) || 0) + 1)));

  const recurring: RecurringPattern[] = [];
  const recurringLabels: Partial<Record<MatchNarrative, string>> = {
    unluckyLoss:     "Unlucky losses — high xG, no return",
    wastedDominance: "Wasted dominance — lots of shots, few goals",
    luckyWin:        "Lucky wins — overperforming xG",
    smashAndGrab:    "Smash-&-grab wins on low xG",
    dominantWin:     "Dominant wins — possession + finishing",
    exploitedWeakDef:"Devastating vs weak defences",
    outclassed:      "Outclassed performances",
    comeback:        "Comeback merchants",
    blewLead:        "Blown leads",
    openTradeoff:    "Open, high-scoring trade-offs",
    lateShow:        "Late shows — winner after 70′",
    fastStart:       "Fast starters — score in opening 15′",
    deadlock:        "Goalless deadlocks",
  };
  const N = matchStories.length;
  narrCounts.forEach((count, key) => {
    if (count < 2) return;
    const label = recurringLabels[key] || narrativeLabel(key);
    recurring.push({
      key,
      label,
      count,
      total: N,
      evidence: `${count}/${N} matches`,
    });
  });
  recurring.sort((a, b) => b.count - a.count);

  // Streak detections
  const recent = matchStories.slice(0, Math.min(5, matchStories.length));
  const recentUnlucky = recent.filter(s => s.narratives.includes("unluckyLoss") || s.narratives.includes("wastedDominance")).length;
  if (recentUnlucky >= 2) {
    recurring.unshift({
      key: "xg_underperformer_streak",
      label: `Hot streak of bad luck — ${recentUnlucky}/${recent.length} recent matches`,
      count: recentUnlucky,
      total: recent.length,
      evidence: "Created lots, finished few — primed for a regression-to-mean explosion",
    });
  }
  const recentLucky = recent.filter(s => s.narratives.includes("luckyWin") || s.narratives.includes("smashAndGrab")).length;
  if (recentLucky >= 2) {
    recurring.unshift({
      key: "xg_overperformer_streak",
      label: `Riding their luck — ${recentLucky}/${recent.length} recent overperformances`,
      count: recentLucky,
      total: recent.length,
      evidence: "Winning above the underlying numbers — vulnerable to a correction",
    });
  }
  const comebackCount = narrCounts.get("comeback") || 0;
  if (comebackCount >= 3) {
    recurring.unshift({
      key: "comeback_kings",
      label: `Comeback kings — ${comebackCount}/${N} matches rescued from behind`,
      count: comebackCount, total: N,
      evidence: "Don't write them off when conceding first",
    });
  }
  const blewCount = narrCounts.get("blewLead") || 0;
  if (blewCount >= 3) {
    recurring.unshift({
      key: "frontrunner_chokers",
      label: `Front-runner chokers — ${blewCount}/${N} leads dropped`,
      count: blewCount, total: N,
      evidence: "Cannot kill games when ahead",
    });
  }
  if (sFirst != null && sFirst >= 70) {
    recurring.unshift({
      key: "always_score_first", label: `Always score first — ${sFirst.toFixed(0)}% of matches`,
      count: scoredFirst, total: matchesAnalyzed, evidence: "Front-foot starters by default",
    });
  }
  if (cFirst != null && cFirst >= 65) {
    recurring.unshift({
      key: "always_concede_first", label: `Always concede first — ${cFirst.toFixed(0)}% of matches`,
      count: concededFirst, total: matchesAnalyzed, evidence: "Slow into matches, chasing games often",
    });
  }
  const fastStartCount = narrCounts.get("fastStart") || 0;
  if (fastStartCount >= 4) {
    recurring.unshift({ key: "always_fast_start", label: `Fast-start habit — ${fastStartCount}/${N} matches with 0–15′ goals`, count: fastStartCount, total: N, evidence: "Set the tempo immediately" });
  }
  const lateShowCount = narrCounts.get("lateShow") || 0;
  if (lateShowCount >= 3) {
    recurring.unshift({ key: "always_late_show", label: `Late-show habit — ${lateShowCount}/${N} matches decided after 70′`, count: lateShowCount, total: N, evidence: "Nervy until the final whistle" });
  }

  // Exploit profile narrative additions
  if (vsLeakyCount >= 2) {
    const avg = r1(goalsVsLeakySum / vsLeakyCount);
    if (avg >= 2.0) styleTags.push(`Devastating vs leaky opponents — ${avg} goals/match in ${vsLeakyCount} such fixtures`);
  }
  if (vsResoluteCount >= 2) {
    const avg = r1(goalsVsResoluteSum / vsResoluteCount);
    if (avg <= 0.5) styleTags.push(`Stifled by tight defences — only ${avg} goals/match in ${vsResoluteCount} such fixtures`);
  }
  if (bigChancesMissedPerMatch != null && bigChancesMissedPerMatch >= 1.5) {
    styleTags.push(`Wasteful in front of goal — ${bigChancesMissedPerMatch} big chances missed/match`);
  }
  if (defensiveTag === "Resolute") styleTags.push(`Resolute back-line — concede only ${avgConceded}/match`);
  if (defensiveTag === "Sieve")    styleTags.push(`Sieve at the back — ${avgConceded} conceded/match`);

  return {
    matchesAnalyzed,
    matchesWithIncidents,
    matchesWithStats,
    totalScored,
    totalConceded,
    avgScored,
    avgConceded,
    buckets,
    peakScoringWindow: peakVal > 0 ? peakLabel : null,
    peakScoringPct: peakVal > 0 && totalScored > 0 ? Math.round((peakVal / totalScored) * 1000) / 10 : null,
    vulnerabilityWindow: vulnVal > 0 ? vulnLabel : null,
    vulnerabilityPct: vulnVal > 0 && totalConceded > 0 ? Math.round((vulnVal / totalConceded) * 1000) / 10 : null,
    avgFirstGoalMin:      firstGoalCount > 0 ? r1(firstGoalSum / firstGoalCount) : null,
    avgFirstConcededMin:  firstConcCount > 0 ? r1(firstConcSum / firstConcCount) : null,
    scoredFirstRate:    sFirst,
    concededFirstRate:  cFirst,
    winWhenScoredFirst:    pct(winsScoredFirst, scoredFirst),
    winWhenConcededFirst:  pct(winsConcededFirst, concededFirst),
    cleanSheetRate:    csRate,
    failedToScoreRate: f2sRate,
    bttsRate: bttsRt,
    over25Rate: o25Rt,
    comebackRate:  pct(comebacks, concededFirst),
    blownLeadRate: pct(blownLeads, scoredFirst),
    xgPerMatch,
    xgAgainstPerMatch,
    xgDelta: xgDelta2,
    defensiveXgDelta,
    shotsPerMatch,
    bigChancesPerMatch,
    bigChancesMissedPerMatch,
    finishingTag,
    defensiveTag,
    styleTags,
    recurringPatterns: recurring,
    matchStories,
    exploitProfile: {
      avgGoalsVsLeakyOpp:    vsLeakyCount    > 0 ? r1(goalsVsLeakySum / vsLeakyCount)       : null,
      matchesVsLeakyOpp:     vsLeakyCount,
      avgGoalsVsResoluteOpp: vsResoluteCount > 0 ? r1(goalsVsResoluteSum / vsResoluteCount) : null,
      matchesVsResoluteOpp:  vsResoluteCount,
    },
  };
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function pointsForResult(r: "W" | "D" | "L"): number {
  return r === "W" ? 3 : r === "D" ? 1 : 0;
}

function computeHiddenTruths(patterns: ScoringPatterns): HiddenTruth[] {
  const truths: HiddenTruth[] = [];
  // Stories arrive sorted DESC by date — work with ASC for sequence analysis
  const asc = [...patterns.matchStories].sort((a, b) => a.date - b.date);
  if (asc.length === 0) return truths;

  const r1 = (v: number) => Math.round(v * 10) / 10;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : null;

  // ── Luck index (offensive) — avg(goalsFor − xgFor) ─────────────────
  const xgPairs = asc.filter(s => s.xgFor != null);
  if (xgPairs.length >= 4) {
    const luck = xgPairs.reduce((s, x) => s + (x.goalsFor - (x.xgFor as number)), 0) / xgPairs.length;
    const sign = luck > 0 ? "+" : "";
    if (Math.abs(luck) >= 0.4) {
      truths.push({
        key: "luck_index",
        label: "Luck factor (attack)",
        value: `${sign}${r2(luck)}/match`,
        detail: luck > 0
          ? "Outscoring the underlying chances — riding form that historically reverts."
          : "Underscoring the underlying chances — sat on the wrong side of variance.",
        signal: luck > 0 ? "positive" : "negative",
      });
    } else if (Math.abs(luck) >= 0.2) {
      truths.push({
        key: "luck_index",
        label: "Luck factor (attack)",
        value: `${sign}${r2(luck)}/match`,
        detail: luck > 0 ? "Mildly overperforming xG." : "Mildly underperforming xG.",
        signal: "neutral",
      });
    }
  }

  // ── Defensive luck — avg(xgAgainst − goalsAgainst) ─────────────────
  const xgaPairs = asc.filter(s => s.xgAgainst != null);
  if (xgaPairs.length >= 4) {
    const dluck = xgaPairs.reduce((s, x) => s + ((x.xgAgainst as number) - x.goalsAgainst), 0) / xgaPairs.length;
    if (Math.abs(dluck) >= 0.4) {
      const sign = dluck > 0 ? "+" : "";
      truths.push({
        key: "luck_index_def",
        label: "Luck factor (defence)",
        value: `${sign}${r2(dluck)}/match`,
        detail: dluck > 0
          ? "Conceding fewer than the chances allowed — keeper/finishing variance bailing them out."
          : "Conceding more than the chances suggest — punished above expectation.",
        signal: dluck > 0 ? "positive" : "negative",
      });
    }
  }

  // ── Volatility — stdev of goal differential ────────────────────────
  if (asc.length >= 5) {
    const diffs = asc.map(s => s.goalsFor - s.goalsAgainst);
    const sd = stdev(diffs);
    if (sd >= 1.8) {
      truths.push({
        key: "volatility",
        label: "Performance volatility",
        value: `σ ${r2(sd)} goals`,
        detail: "Wild swings between matches — performance hard to predict from one match to the next.",
        signal: "negative",
      });
    } else if (sd <= 1.0) {
      truths.push({
        key: "volatility",
        label: "Performance volatility",
        value: `σ ${r2(sd)} goals`,
        detail: "Steady, repeatable output — what you see is what you get.",
        signal: "positive",
      });
    }
  }

  // ── Bounce-back DNA after a loss ───────────────────────────────────
  let postLossSamples = 0, postLossWins = 0, postLossLosses = 0;
  for (let i = 0; i < asc.length - 1; i++) {
    if (asc[i].result === "L") {
      postLossSamples++;
      if (asc[i + 1].result === "W") postLossWins++;
      if (asc[i + 1].result === "L") postLossLosses++;
    }
  }
  if (postLossSamples >= 3) {
    const winRate = pct(postLossWins, postLossSamples)!;
    const lossRate = pct(postLossLosses, postLossSamples)!;
    if (winRate >= 60) {
      truths.push({
        key: "bounce_back",
        label: "Reaction after a loss",
        value: `${winRate}% win-rate (${postLossWins}/${postLossSamples})`,
        detail: "Bounce-back mentality — losses spark a response.",
        signal: "positive",
      });
    } else if (lossRate >= 50) {
      truths.push({
        key: "bounce_back",
        label: "Reaction after a loss",
        value: `${lossRate}% loss-rate (${postLossLosses}/${postLossSamples})`,
        detail: "Spiral risk — bad results tend to compound, not correct.",
        signal: "negative",
      });
    } else {
      truths.push({
        key: "bounce_back",
        label: "Reaction after a loss",
        value: `${winRate}% win / ${lossRate}% loss`,
        detail: "Mixed reaction — neither a clear bounce nor a clear spiral.",
        signal: "neutral",
      });
    }
  }

  // ── Complacency after a win ────────────────────────────────────────
  let postWinSamples = 0, postWinWins = 0, postWinNonWins = 0;
  for (let i = 0; i < asc.length - 1; i++) {
    if (asc[i].result === "W") {
      postWinSamples++;
      if (asc[i + 1].result === "W") postWinWins++;
      else postWinNonWins++;
    }
  }
  if (postWinSamples >= 3) {
    const w = pct(postWinWins, postWinSamples)!;
    const nw = pct(postWinNonWins, postWinSamples)!;
    if (w >= 60) {
      truths.push({
        key: "post_win",
        label: "Reaction after a win",
        value: `${w}% follow-up wins (${postWinWins}/${postWinSamples})`,
        detail: "Confidence carries — winning culture stacks results.",
        signal: "positive",
      });
    } else if (nw >= 65) {
      truths.push({
        key: "post_win",
        label: "Reaction after a win",
        value: `${nw}% slip-ups (${postWinNonWins}/${postWinSamples})`,
        detail: "Complacency tax — wins rarely chained, drop-off after success.",
        signal: "negative",
      });
    }
  }

  // ── Post-draw response ─────────────────────────────────────────────
  let postDrawSamples = 0, postDrawWins = 0;
  for (let i = 0; i < asc.length - 1; i++) {
    if (asc[i].result === "D") {
      postDrawSamples++;
      if (asc[i + 1].result === "W") postDrawWins++;
    }
  }
  if (postDrawSamples >= 2) {
    const w = pct(postDrawWins, postDrawSamples)!;
    if (w >= 60) {
      truths.push({
        key: "post_draw",
        label: "Reaction after a draw",
        value: `${w}% next-match wins`,
        detail: "Use draws as a springboard — frustration converts to a win.",
        signal: "positive",
      });
    } else if (w === 0) {
      truths.push({
        key: "post_draw",
        label: "Reaction after a draw",
        value: `0/${postDrawSamples} wins after a draw`,
        detail: "Draws drift into stagnation rather than a kick.",
        signal: "negative",
      });
    }
  }

  // ── Mixed-result whiplash (recent W/L oscillation) ─────────────────
  const last5 = asc.slice(-5);
  if (last5.length === 5) {
    let switches = 0;
    for (let i = 1; i < last5.length; i++) {
      if (last5[i].result !== last5[i - 1].result) switches++;
    }
    if (switches >= 4) {
      truths.push({
        key: "whiplash",
        label: "Form rhythm",
        value: `${switches}/4 result switches in last 5`,
        detail: "Whiplash form — never two of the same result in a row, mindset shifting match-to-match.",
        signal: "negative",
      });
    } else if (switches <= 1) {
      const dominant = last5[last5.length - 1].result;
      truths.push({
        key: "whiplash",
        label: "Form rhythm",
        value: `${dominant}-heavy run`,
        detail: dominant === "W" ? "Settled into winning rhythm." : dominant === "L" ? "Stuck in a losing rut." : "Stuck in a draw groove.",
        signal: dominant === "W" ? "positive" : "negative",
      });
    }
  }

  // ── Mindset vs strong / weak opps (xGA proxy) ──────────────────────
  const vsStrong = asc.filter(s => s.xgAgainst != null && (s.xgAgainst as number) >= 1.7);
  const vsWeak   = asc.filter(s => s.xgAgainst != null && (s.xgAgainst as number) <= 0.8);
  if (vsStrong.length >= 3) {
    const pts = vsStrong.reduce((s, x) => s + pointsForResult(x.result), 0);
    const ppm = pts / vsStrong.length;
    if (ppm <= 0.6) {
      truths.push({
        key: "vs_strong",
        label: "Mindset vs strong sides",
        value: `${r2(ppm)} pts/match (${vsStrong.length} fixtures)`,
        detail: "Stage fright — visibly shrink against high-pressure opposition.",
        signal: "negative",
      });
    } else if (ppm >= 1.8) {
      truths.push({
        key: "vs_strong",
        label: "Mindset vs strong sides",
        value: `${r2(ppm)} pts/match`,
        detail: "Rise to the occasion — perform above their level vs strong sides.",
        signal: "positive",
      });
    }
  }
  if (vsWeak.length >= 3) {
    const pts = vsWeak.reduce((s, x) => s + pointsForResult(x.result), 0);
    const ppm = pts / vsWeak.length;
    if (ppm >= 2.4) {
      truths.push({
        key: "vs_weak",
        label: "Mindset vs lesser sides",
        value: `${r2(ppm)} pts/match`,
        detail: "Bully smaller opponents — cash in when chances drop in their lap.",
        signal: "positive",
      });
    } else if (ppm <= 1.2) {
      truths.push({
        key: "vs_weak",
        label: "Mindset vs lesser sides",
        value: `${r2(ppm)} pts/match`,
        detail: "Underperform when expected to win — trip over weaker opposition.",
        signal: "negative",
      });
    }
  }

  // ── Home / Away mindset ────────────────────────────────────────────
  const homeMatches = asc.filter(s => s.venue === "H");
  const awayMatches = asc.filter(s => s.venue === "A");
  if (homeMatches.length >= 3 && awayMatches.length >= 3) {
    const hPpm = homeMatches.reduce((s, x) => s + pointsForResult(x.result), 0) / homeMatches.length;
    const aPpm = awayMatches.reduce((s, x) => s + pointsForResult(x.result), 0) / awayMatches.length;
    const gap = hPpm - aPpm;
    if (gap >= 1.2) {
      truths.push({
        key: "home_away_mindset",
        label: "Travel mindset",
        value: `H ${r2(hPpm)} vs A ${r2(aPpm)} pts/match`,
        detail: "Different team on the road — fortress at home, travel-sick away.",
        signal: "negative",
      });
    } else if (gap <= -0.6) {
      truths.push({
        key: "home_away_mindset",
        label: "Travel mindset",
        value: `A ${r2(aPpm)} vs H ${r2(hPpm)} pts/match`,
        detail: "Better travellers than hosts — thrive away from home pressure.",
        signal: "positive",
      });
    } else if (gap >= 0.4 && gap < 1.2) {
      truths.push({
        key: "home_away_mindset",
        label: "Travel mindset",
        value: `H ${r2(hPpm)} vs A ${r2(aPpm)} pts/match`,
        detail: "Modest home tilt — perform fairly evenly home and away.",
        signal: "neutral",
      });
    }
  }

  // ── Give-up strength: response after going 2 behind ───────────────
  const twoBehindMatches = asc.filter(s => s.wasTwoBehind);
  if (twoBehindMatches.length >= 2) {
    const goalsBack = twoBehindMatches.reduce((s, x) => s + x.goalsAfterTwoBehind, 0);
    const avgBack = goalsBack / twoBehindMatches.length;
    if (avgBack >= 1.0) {
      truths.push({
        key: "give_up_strength",
        label: "Fight when 2 behind",
        value: `${r2(avgBack)} goals back/match (${twoBehindMatches.length} cases)`,
        detail: "Refuse to fold — keep swinging even from a two-goal hole.",
        signal: "positive",
      });
    } else if (avgBack <= 0.3) {
      truths.push({
        key: "give_up_strength",
        label: "Fight when 2 behind",
        value: `${r2(avgBack)} goals back/match`,
        detail: "Heads drop early — once two down, the game is over for them.",
        signal: "negative",
      });
    }
  }

  // ── Protect-lead strength: response after going 2 ahead ───────────
  const twoAheadMatches = asc.filter(s => s.wasTwoAhead);
  if (twoAheadMatches.length >= 2) {
    const concBack = twoAheadMatches.reduce((s, x) => s + x.concededAfterTwoAhead, 0);
    const avgConc = concBack / twoAheadMatches.length;
    if (avgConc <= 0.3) {
      truths.push({
        key: "protect_lead",
        label: "Game-management with a 2-goal lead",
        value: `${r2(avgConc)} conceded/match`,
        detail: "Slam the door shut — rarely give up goals once two ahead.",
        signal: "positive",
      });
    } else if (avgConc >= 1.0) {
      truths.push({
        key: "protect_lead",
        label: "Game-management with a 2-goal lead",
        value: `${r2(avgConc)} conceded/match`,
        detail: "Switch off when comfortable — let opponents back into matches they shouldn't.",
        signal: "negative",
      });
    }
  }

  // ── Discipline after scoring first ────────────────────────────────
  const sfMatches = asc.filter(s => s.scoredFirst);
  if (sfMatches.length >= 3) {
    const concAfter = sfMatches.reduce((s, x) => s + x.concededAfterScoringFirst, 0) / sfMatches.length;
    if (concAfter >= 1.2) {
      truths.push({
        key: "post_scoring_first",
        label: "Discipline after scoring first",
        value: `${r2(concAfter)} conceded after going 1-0 up`,
        detail: "Drop tempo when ahead — invite pressure they don't need.",
        signal: "negative",
      });
    } else if (concAfter <= 0.4) {
      truths.push({
        key: "post_scoring_first",
        label: "Discipline after scoring first",
        value: `${r2(concAfter)} conceded after going 1-0 up`,
        detail: "Press on after the opener — kill matches early.",
        signal: "positive",
      });
    }
  }

  // ── Decision-making after conceding first ─────────────────────────
  const cfMatches = asc.filter(s => s.concededFirst);
  if (cfMatches.length >= 3) {
    const goalsAfter = cfMatches.reduce((s, x) => s + x.goalsAfterConcedingFirst, 0) / cfMatches.length;
    const concAfter  = cfMatches.reduce((s, x) => s + x.concededAfterConcedingFirst, 0) / cfMatches.length;
    if (goalsAfter >= 1.3 && goalsAfter > concAfter) {
      truths.push({
        key: "post_conceding_first",
        label: "Response after conceding first",
        value: `${r2(goalsAfter)} scored vs ${r2(concAfter)} conceded`,
        detail: "Switch into attack mode after going behind — calculated, not panicked.",
        signal: "positive",
      });
    } else if (concAfter >= goalsAfter + 0.6) {
      truths.push({
        key: "post_conceding_first",
        label: "Response after conceding first",
        value: `${r2(goalsAfter)} scored vs ${r2(concAfter)} conceded`,
        detail: "Concede in clusters — a goal against tends to invite a second.",
        signal: "negative",
      });
    }
  }

  // ── Style-of-play timing fingerprint ──────────────────────────────
  if (patterns.peakScoringWindow && patterns.vulnerabilityWindow) {
    const peak = patterns.peakScoringWindow;
    const vuln = patterns.vulnerabilityWindow;
    if (peak === "76–90′" && vuln === "76–90′") {
      truths.push({
        key: "style_timing",
        label: "Late-game character",
        value: `Peak & weak both ${peak}`,
        detail: "Final 15 minutes are chaos — equally likely to win or lose it late.",
        signal: "neutral",
      });
    } else if (peak === "0–15′" && (vuln === "76–90′" || vuln === "61–75′")) {
      truths.push({
        key: "style_timing",
        label: "Style timing fingerprint",
        value: `Score early, fade late`,
        detail: "Front-load energy — opening burst, end-game vulnerability.",
        signal: "negative",
      });
    } else if ((peak === "61–75′" || peak === "76–90′") && (vuln === "0–15′" || vuln === "16–30′")) {
      truths.push({
        key: "style_timing",
        label: "Style timing fingerprint",
        value: `Slow into matches, dangerous late`,
        detail: "Need a feel for the game — once in rhythm, late surge is real.",
        signal: "neutral",
      });
    }
  }

  return truths;
}

function tagDirection(tag: string | null): "good" | "bad" | null {
  if (!tag) return null;
  if (["Deadly", "Clinical", "Resolute", "Solid"].includes(tag)) return "good";
  if (["Wasteful", "Flop", "Leaky", "Sieve"].includes(tag)) return "bad";
  return null;
}

function computeMatchupCrossRefs(
  homeName: string,
  awayName: string,
  homePatterns: ScoringPatterns,
  awayPatterns: ScoringPatterns,
  homeHidden: HiddenTruth[],
  awayHidden: HiddenTruth[],
): MatchupCrossRef[] {
  const refs: MatchupCrossRef[] = [];

  const sides: Array<{ name: string; opp: string; pat: ScoringPatterns; oppPat: ScoringPatterns; hidden: HiddenTruth[]; oppHidden: HiddenTruth[]; key: "home" | "away" }> = [
    { name: homeName, opp: awayName, pat: homePatterns, oppPat: awayPatterns, hidden: homeHidden, oppHidden: awayHidden, key: "home" },
    { name: awayName, opp: homeName, pat: awayPatterns, oppPat: homePatterns, hidden: awayHidden, oppHidden: homeHidden, key: "away" },
  ];

  // ── Pattern-vs-tag collisions ─────────────────────────────────────
  for (const s of sides) {
    const pat = s.pat;
    const oppDef = s.oppPat.defensiveTag;
    const oppFin = s.oppPat.finishingTag;

    const has = (k: string) => pat.recurringPatterns.some(r => r.key === k);
    const oppHas = (k: string) => s.oppPat.recurringPatterns.some(r => r.key === k);

    if (has("unluckyLoss") && (oppDef === "Leaky" || oppDef === "Sieve")) {
      refs.push({
        key: `${s.key}_unlucky_vs_leaky`,
        forSide: s.key,
        headline: `${s.name}'s unlucky-loss streak meets ${s.opp}'s ${oppDef.toLowerCase()} back-line`,
        detail: "Created chances pattern colliding with a defence that lets chances become goals.",
      });
    }
    if (has("wastedDominance") && (oppDef === "Resolute" || oppDef === "Solid")) {
      refs.push({
        key: `${s.key}_wasted_vs_resolute`,
        forSide: s.key,
        headline: `${s.name}'s wasted-dominance habit vs ${s.opp}'s ${oppDef.toLowerCase()} defence`,
        detail: "Volume-without-end-product trait runs into a defence built to soak it up.",
      });
    }
    if (has("xg_underperformer_streak") && (oppDef === "Leaky" || oppDef === "Sieve")) {
      refs.push({
        key: `${s.key}_under_xg_vs_leaky`,
        forSide: s.key,
        headline: `${s.name}'s under-xG streak meets a ${oppDef.toLowerCase()} back-line`,
        detail: "Mean-reversion candidate facing a defence that historically forgives.",
      });
    }
    if (has("xg_overperformer_streak") && (oppDef === "Resolute" || oppDef === "Solid")) {
      refs.push({
        key: `${s.key}_over_xg_vs_resolute`,
        forSide: s.key,
        headline: `${s.name}'s over-xG run meets ${s.opp}'s ${oppDef.toLowerCase()} defence`,
        detail: "Hot-finishing trend collides with a defence that has been compressing chance quality.",
      });
    }
    if (has("comeback_kings") && oppHas("frontrunner_chokers")) {
      refs.push({
        key: `${s.key}_comeback_vs_choker`,
        forSide: "both",
        headline: `${s.name}'s comeback DNA collides with ${s.opp}'s lead-blowing trait`,
        detail: "If the script flips after an early opener, both teams have form for losing the plot in opposite directions.",
      });
    }
    if (has("frontrunner_chokers") && oppHas("comeback_kings")) {
      // covered by mirrored side; skip duplicate
    }
    if (has("always_score_first") && oppHas("always_concede_first")) {
      refs.push({
        key: `${s.key}_first_blood_lock`,
        forSide: "both",
        headline: `${s.name} usually draws first blood; ${s.opp} usually concedes first`,
        detail: "Habits of both teams point in the same direction on opening-goal control.",
      });
    }
    if (has("smashAndGrab") && (oppFin === "Wasteful" || oppFin === "Flop")) {
      refs.push({
        key: `${s.key}_grab_vs_wasteful`,
        forSide: s.key,
        headline: `${s.name}'s smash-&-grab habit meets ${s.opp}'s ${oppFin.toLowerCase()} finishing`,
        detail: "Low-chance opportunism on one side, struggle to convert on the other.",
      });
    }
    if (has("exploitedWeakDef") && (oppDef === "Leaky" || oppDef === "Sieve")) {
      refs.push({
        key: `${s.key}_steamroll_vs_sieve`,
        forSide: s.key,
        headline: `${s.name} repeatedly punish weak defences — ${s.opp} arrive ${oppDef.toLowerCase()}`,
        detail: "Profile of damage-dealer crossing paths with profile of damage-taker.",
      });
    }
    if (has("always_late_show") && oppHas("always_late_show")) {
      refs.push({
        key: `late_show_collision`,
        forSide: "both",
        headline: `Both teams settle matches after 70′`,
        detail: "Two late-show profiles together — game is unlikely to be over before the closing stretch.",
      });
    }
    if (has("always_fast_start") && oppHas("always_fast_start")) {
      refs.push({
        key: `fast_start_collision`,
        forSide: "both",
        headline: `Both teams habitually score in opening 15′`,
        detail: "Two front-foot starters meeting — opening exchanges weighted with intent.",
      });
    }
  }

  // ── Hidden-truth-vs-hidden-truth comparisons ───────────────────────
  function pickByKey(arr: HiddenTruth[], k: string): HiddenTruth | undefined {
    return arr.find(t => t.key === k);
  }
  const compareKeys: { key: string; nice: string }[] = [
    { key: "luck_index",          nice: "Luck factor (attack)" },
    { key: "luck_index_def",      nice: "Luck factor (defence)" },
    { key: "volatility",          nice: "Volatility" },
    { key: "bounce_back",         nice: "Reaction after a loss" },
    { key: "post_win",            nice: "Reaction after a win" },
    { key: "post_draw",           nice: "Reaction after a draw" },
    { key: "vs_strong",           nice: "Mindset vs strong sides" },
    { key: "vs_weak",             nice: "Mindset vs lesser sides" },
    { key: "home_away_mindset",   nice: "Travel mindset" },
    { key: "give_up_strength",    nice: "Fight when 2 behind" },
    { key: "protect_lead",        nice: "Game-management with a lead" },
    { key: "post_scoring_first",  nice: "Discipline after scoring first" },
    { key: "post_conceding_first",nice: "Response after conceding first" },
    { key: "style_timing",        nice: "Style timing fingerprint" },
    { key: "whiplash",            nice: "Form rhythm" },
  ];
  for (const c of compareKeys) {
    const h = pickByKey(homeHidden, c.key);
    const a = pickByKey(awayHidden, c.key);
    if (!h && !a) continue;

    let headline = "";
    let detail = "";
    if (h && a) {
      // Both teams have this trait — direct juxtaposition
      if (h.signal !== a.signal && (h.signal === "positive" || a.signal === "positive")) {
        const pos = h.signal === "positive" ? homeName : awayName;
        const neg = h.signal === "positive" ? awayName : homeName;
        headline = `${c.nice}: ${pos} edge`;
        detail = `${homeName}: ${h.value} — ${h.detail.replace(/[.\s]+$/, "")}. ${awayName}: ${a.value} — ${a.detail.replace(/[.\s]+$/, "")}.`;
      } else {
        headline = `${c.nice}: both teams flagged`;
        detail = `${homeName}: ${h.value} — ${h.detail.replace(/[.\s]+$/, "")}. ${awayName}: ${a.value} — ${a.detail.replace(/[.\s]+$/, "")}.`;
      }
    } else if (h) {
      headline = `${c.nice}: only ${homeName} flagged`;
      detail   = `${homeName}: ${h.value} — ${h.detail} ${awayName} shows no clear trait here.`;
    } else if (a) {
      headline = `${c.nice}: only ${awayName} flagged`;
      detail   = `${awayName}: ${a!.value} — ${a!.detail} ${homeName} shows no clear trait here.`;
    }
    refs.push({
      key: `cmp_${c.key}`,
      forSide: "both",
      headline,
      detail,
    });
  }

  // Deduplicate by key (collisions emitted from both sides)
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

function parseGoalTimeline(incidentsData: any): GoalState[] {
  const incidents: any[] = incidentsData?.incidents || [];
  const goals: GoalState[] = [];
  for (const inc of incidents) {
    const type = (inc.incidentType || inc.type || "").toLowerCase();
    if (type === "goal" || type === "penalty") {
      const h = Number(inc.homeScore);
      const a = Number(inc.awayScore);
      const t = Number(inc.time) || 0;
      if (Number.isFinite(h) && Number.isFinite(a) && h + a > 0) {
        goals.push({ time: t, homeScore: h, awayScore: a });
      }
    }
  }
  return goals.sort((a, b) => a.time - b.time);
}

function computeGSRM(events: any[], teamId: number, incidentsByEventId: Map<number, any>): GSRM {
  let ecriScore = 0, ecriCount = 0;
  let eriScore = 0, eriCount = 0;
  let tgbiScore = 0, tgbiCount = 0;
  let frqiScore = 0, frqiCount = 0;

  for (const event of events) {
    const isHome = event.homeTeam?.id === teamId;
    const isAway = event.awayTeam?.id === teamId;
    if (!isHome && !isAway) continue;

    const incData = incidentsByEventId.get(event.id);
    if (!incData) continue;

    const goals = parseGoalTimeline(incData);
    if (goals.length === 0) continue;

    const tS = (g: GoalState) => isHome ? g.homeScore : g.awayScore;
    const oS = (g: GoalState) => isHome ? g.awayScore : g.homeScore;

    const finalState = goals[goals.length - 1];
    const finalTeam = tS(finalState);
    const finalOpp = oS(finalState);

    // ── ECRI: Opponent scores first before min 30 → does team respond? ────
    if (goals.length > 0) {
      const firstGoal = goals[0];
      const oppScoredFirst = oS(firstGoal) > tS(firstGoal);
      if (oppScoredFirst && firstGoal.time <= 30) {
        ecriCount++;
        const teamScoredAfter = goals.some(g => tS(g) > tS(firstGoal) && g.time > firstGoal.time);
        if (teamScoredAfter) {
          const firstTeamGoal = goals.find(g => tS(g) > tS(firstGoal) && g.time > firstGoal.time);
          const responseMinutes = firstTeamGoal ? firstTeamGoal.time - firstGoal.time : 90;
          const speedFactor = responseMinutes <= 20 ? 1.0 : responseMinutes <= 40 ? 0.7 : 0.4;
          ecriScore += speedFactor;
        }
      }
    }

    // ── ERI: Team was leading, gets equalized → do they push for winner? ──
    let prev: GoalState = { time: 0, homeScore: 0, awayScore: 0 };
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i];
      const oppScoredNow = oS(g) > oS(prev);
      const teamWasLeadingBefore = tS(prev) > oS(prev);
      const nowTied = tS(g) === oS(g);
      if (oppScoredNow && teamWasLeadingBefore && nowTied) {
        eriCount++;
        const after = goals.slice(i + 1);
        if (after.some(g2 => tS(g2) > oS(g2))) {
          eriScore += 1.0;
        } else if (!after.some(g2 => oS(g2) > tS(g2))) {
          eriScore += 0.3;
        }
      }
      prev = g;
    }

    // ── TGBI: Team leads by 2+ → attack more or sit back? ────────────────
    const twoGoalMoment = goals.find(g => tS(g) - oS(g) >= 2);
    if (twoGoalMoment) {
      tgbiCount++;
      const extraScored = finalTeam - tS(twoGoalMoment);
      const extraConceded = finalOpp - oS(twoGoalMoment);
      const netMargin = extraScored - extraConceded;
      tgbiScore += Math.max(0, Math.min(10, 5 + netMargin * 1.5));
    }

    // ── FRQI: When trailing → how clinical/determined is the response? ───
    const everBehind = goals.some(g => oS(g) > tS(g));
    if (everBehind) {
      frqiCount++;
      let maxDeficit = 0;
      let scoredWhileBehind = false;
      let prevState: GoalState = { time: 0, homeScore: 0, awayScore: 0 };
      for (const g of goals) {
        const deficit = oS(g) - tS(g);
        if (deficit > maxDeficit) maxDeficit = deficit;
        if (tS(g) > tS(prevState) && oS(prevState) > tS(prevState)) scoredWhileBehind = true;
        prevState = g;
      }
      let frqiMatch = 0;
      if (scoredWhileBehind) frqiMatch += 0.5;
      if (finalTeam >= finalOpp) frqiMatch += 0.5;
      if (maxDeficit >= 2 && finalTeam >= finalOpp) frqiMatch += 0.3;
      frqiScore += Math.min(1.3, frqiMatch);
    }
  }

  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    ecri: ecriCount > 0 ? r1((ecriScore / ecriCount) * 10) : null,
    eri: eriCount > 0 ? r1((eriScore / eriCount) * 10) : null,
    tgbi: tgbiCount > 0 ? r1(tgbiScore / tgbiCount) : null,
    frqi: frqiCount > 0 ? r1((frqiScore / frqiCount / 1.3) * 10) : null,
    ecriMatches: ecriCount,
    eriMatches: eriCount,
    tgbiMatches: tgbiCount,
    frqiMatches: frqiCount,
  };
}

function computeSSBI(
  events: any[],
  teamId: number,
  incidentsByEventId: Map<number, any>,
  missingPlayerIds: Set<number>,
): SSBI {
  let zzbScore = 0, zzbCount = 0;
  let lbrScore = 0, lbrCount = 0;
  let ddiScore = 0, ddiCount = 0;

  const breakerMap = new Map<number, { name: string; zzbGoals: number; ddiGoals: number }>();

  for (const event of events) {
    const isHome = event.homeTeam?.id === teamId;
    const isAway = event.awayTeam?.id === teamId;
    if (!isHome && !isAway) continue;

    const incData = incidentsByEventId.get(event.id);
    if (!incData) continue;

    const incidents: any[] = incData?.incidents || [];

    type GoalEntry = {
      time: number;
      homeScore: number;
      awayScore: number;
      teamScored: boolean;
      scorerId?: number;
      scorerName?: string;
    };

    const goals: GoalEntry[] = [];
    let prevH = 0, prevA = 0;

    const sortedInc = [...incidents].sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));

    for (const inc of sortedInc) {
      const type = (inc.incidentType || inc.type || "").toLowerCase();
      if (type !== "goal" && type !== "penalty") continue;
      const h = Number(inc.homeScore);
      const a = Number(inc.awayScore);
      const t = Number(inc.time) || 0;
      if (!Number.isFinite(h) || !Number.isFinite(a)) continue;

      const homeScored = h > prevH;
      const awayScored = a > prevA;
      let teamScored = false;
      if (homeScored && isHome) teamScored = true;
      else if (awayScored && isAway) teamScored = true;
      else if (!homeScored && !awayScored && inc.isHome !== undefined) {
        teamScored = isHome ? !!inc.isHome : !inc.isHome;
      }

      goals.push({
        time: t,
        homeScore: h,
        awayScore: a,
        teamScored,
        scorerId: inc.player?.id ? Number(inc.player.id) : undefined,
        scorerName: inc.player?.shortName || inc.player?.name || undefined,
      });
      prevH = h;
      prevA = a;
    }

    const tS = (g: GoalEntry) => isHome ? g.homeScore : g.awayScore;
    const oS = (g: GoalEntry) => isHome ? g.awayScore : g.homeScore;

    // ── 0-0 Break Index ───────────────────────────────────────────────────
    zzbCount++;
    if (goals.length === 0) {
      zzbScore += 1;
    } else {
      const firstGoal = goals[0];
      if (firstGoal.teamScored) {
        const t = firstGoal.time;
        const score = t <= 20 ? 10 : t <= 35 ? 8.5 : t <= 60 ? 6 : t <= 80 ? 4 : 3;
        zzbScore += score;
        if (firstGoal.scorerId) {
          const b = breakerMap.get(firstGoal.scorerId) || { name: firstGoal.scorerName || "Unknown", zzbGoals: 0, ddiGoals: 0 };
          b.zzbGoals++;
          breakerMap.set(firstGoal.scorerId, b);
        }
      } else {
        zzbScore += 2;
      }
    }

    // ── 1-0 Lead Break Response ───────────────────────────────────────────
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i];
      if (g.teamScored && tS(g) === 1 && oS(g) === 0) {
        lbrCount++;
        const after = goals.slice(i + 1);
        const teamAfter = after.filter((g2) => g2.teamScored);
        const oppAfter = after.filter((g2) => !g2.teamScored);
        if (teamAfter.length > 0) {
          const diff = teamAfter[0].time - g.time;
          lbrScore += diff <= 15 ? 10 : diff <= 30 ? 8 : 6;
        } else if (oppAfter.length === 0) {
          lbrScore += 7;
        } else {
          const diff = oppAfter[0].time - g.time;
          lbrScore += diff <= 15 ? 2 : 4;
        }
        break;
      }
    }

    // ── 1-1 Draw Disruption Index ─────────────────────────────────────────
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i];
      if (tS(g) === 1 && oS(g) === 1) {
        ddiCount++;
        const after = goals.slice(i + 1);
        const teamAfter = after.filter((g2) => g2.teamScored);
        const oppAfter = after.filter((g2) => !g2.teamScored);
        if (teamAfter.length > 0) {
          const diff = teamAfter[0].time - g.time;
          ddiScore += diff <= 15 ? 10 : diff <= 30 ? 9 : 7;
          if (teamAfter[0].scorerId) {
            const b = breakerMap.get(teamAfter[0].scorerId) || { name: teamAfter[0].scorerName || "Unknown", zzbGoals: 0, ddiGoals: 0 };
            b.ddiGoals++;
            breakerMap.set(teamAfter[0].scorerId, b);
          }
        } else if (oppAfter.length > 0) {
          ddiScore += 2;
        } else {
          ddiScore += 3;
        }
        break;
      }
    }
  }

  const r1 = (v: number) => Math.round(v * 10) / 10;

  const keyBreakers: SSBIBreaker[] = Array.from(breakerMap.entries())
    .map(([playerId, data]) => ({
      playerId,
      name: data.name,
      zzbGoals: data.zzbGoals,
      ddiGoals: data.ddiGoals,
      total: data.zzbGoals + data.ddiGoals,
      available: missingPlayerIds.size > 0 ? !missingPlayerIds.has(playerId) : null,
    }))
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    zzb: zzbCount > 0 ? r1(zzbScore / zzbCount) : null,
    zzbMatches: zzbCount,
    lbr: lbrCount > 0 ? r1(lbrScore / lbrCount) : null,
    lbrMatches: lbrCount,
    ddi: ddiCount > 0 ? r1(ddiScore / ddiCount) : null,
    ddiMatches: ddiCount,
    keyBreakers,
  };
}

function injectCustomXGIntoStatistics(data: any): any {
  if (!data?.statistics) return data;
  const statistics: any[] = data.statistics;

  for (const period of statistics) {
    const groups: any[] = period.groups || [];

    const getStatVal = (side: "home" | "away", names: string[]): number | null => {
      for (const group of groups) {
        for (const item of (group.statisticsItems || [])) {
          const n = (item.name || "").toLowerCase().trim();
          if (names.some(name => n === name || n.includes(name))) {
            const raw = String(item[side] ?? "").replace(/[^0-9.\-]/g, "");
            const v = parseFloat(raw);
            return Number.isFinite(v) ? v : null;
          }
        }
      }
      return null;
    };

    const homeShots = getStatVal("home", ["total shots", "shots total"]);
    const awayShots = getStatVal("away", ["total shots", "shots total"]);
    const homeBC = getStatVal("home", ["big chances"]);
    const awayBC = getStatVal("away", ["big chances"]);
    const homeSoT = getStatVal("home", ["shots on target"]);
    const awaySoT = getStatVal("away", ["shots on target"]);
    const homeBlocked = getStatVal("home", ["blocked shots"]);
    const awayBlocked = getStatVal("away", ["blocked shots"]);

    const homeXG = calculateCustomXG(homeShots, homeBC, homeSoT, homeBlocked, awayShots, awayBC);
    const awayXG = calculateCustomXG(awayShots, awayBC, awaySoT, awayBlocked, homeShots, homeBC);

    if (homeXG === null && awayXG === null) continue;

    let xgItem: any = null;
    let targetGroup: any = null;

    for (const group of groups) {
      for (const item of (group.statisticsItems || [])) {
        const n = (item.name || "").toLowerCase().trim();
        if (n.includes("expected goals") || n === "xg") {
          xgItem = item;
          targetGroup = group;
          break;
        }
      }
      if (xgItem) break;
    }

    if (xgItem) {
      xgItem.home = homeXG !== null ? String(homeXG) : xgItem.home;
      xgItem.away = awayXG !== null ? String(awayXG) : xgItem.away;
    } else {
      const shotsGroup = groups.find(g => {
        const name = (g.groupName || "").toLowerCase();
        return name.includes("shot") || name.includes("attack");
      }) || groups[0];

      if (shotsGroup) {
        if (!shotsGroup.statisticsItems) shotsGroup.statisticsItems = [];
        shotsGroup.statisticsItems.unshift({
          name: "Expected Goals (xG)",
          home: homeXG !== null ? String(homeXG) : "0.00",
          away: awayXG !== null ? String(awayXG) : "0.00",
          statisticsType: "positive",
        });
      }
    }
  }

  return data;
}

const SOFASCORE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.sofascore.com/",
  Origin: "https://www.sofascore.com",
  "Cache-Control": "no-cache",
};

async function fetchSofaScore(endpoint: string) {
  const url = `${SOFASCORE_API}${endpoint}`;
  const res = await fetch(url, { headers: SOFASCORE_HEADERS });
  if (!res.ok) {
    throw new Error(`SofaScore API error: ${res.status}`);
  }
  return res.json();
}

async function fetchTeamLastEvents(teamId: number): Promise<any[]> {
  const pages = [0, 1, 2];
  const results = await Promise.allSettled(
    pages.map((page) => fetchSofaScore(`/team/${teamId}/events/last/${page}`))
  );
  const seen = new Set<number>();
  const events: any[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const event of result.value?.events || []) {
        if (event?.id && !seen.has(event.id)) {
          seen.add(event.id);
          events.push(event);
        }
      }
    }
  }
  return events;
}

function readEventScore(score: any): number | null {
  const value = Number(score?.current ?? score?.display ?? score?.normaltime);
  return Number.isFinite(value) ? value : null;
}

function selectLastPlayedTeamMatches(events: any[], teamId: number, currentStartTimestamp?: number): any[] {
  return events
    .filter((event: any) => {
      const startTimestamp = Number(event.startTimestamp);
      const isTeamMatch = event.homeTeam?.id === teamId || event.awayTeam?.id === teamId;
      const isBeforeCurrent = currentStartTimestamp ? startTimestamp < currentStartTimestamp : true;
      const hasScore = readEventScore(event.homeScore) !== null && readEventScore(event.awayScore) !== null;
      const isFinished = event.status?.type === "finished" || hasScore;
      return isTeamMatch && isBeforeCurrent && isFinished;
    })
    .sort((a: any, b: any) => Number(b.startTimestamp || 0) - Number(a.startTimestamp || 0))
    .slice(0, 15);
}

async function proxyImage(imageUrl: string, res: Response) {
  try {
    const response = await fetch(imageUrl, { headers: SOFASCORE_HEADERS });
    if (!response.ok) {
      return res.status(response.status).send("Image not found");
    }
    const contentType = response.headers.get("content-type") || "image/png";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(500).send("Error fetching image");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Causal Analysis — explicit "why did each result happen?" layer
// ─────────────────────────────────────────────────────────────────────────

type CausalCause =
  | "DefensiveStructure"
  | "TacticalDeadlock"
  | "AttackingDominance"
  | "ClinicalFinishing"
  | "FinishingInefficiency"
  | "OpponentWastefulness"
  | "DefensiveCollapse"
  | "LateDropOff"
  | "EarlyShock"
  | "GameStateControl"
  | "OpponentClass";

type Repeatability = "repeatable" | "variance" | "mixed";

const CAUSE_LABEL: Record<CausalCause, string> = {
  DefensiveStructure:    "Defensive structure",
  TacticalDeadlock:      "Tactical deadlock",
  AttackingDominance:    "Attacking dominance",
  ClinicalFinishing:     "Clinical finishing",
  FinishingInefficiency: "Finishing inefficiency",
  OpponentWastefulness:  "Opponent wastefulness",
  DefensiveCollapse:     "Defensive collapse",
  LateDropOff:           "Late drop-off",
  EarlyShock:            "Early shock",
  GameStateControl:      "Game-state control",
  OpponentClass:         "Outclassed by opponent",
};

const CAUSE_DEFAULT_REPEAT: Record<CausalCause, Repeatability> = {
  DefensiveStructure: "repeatable",
  TacticalDeadlock: "repeatable",
  AttackingDominance: "repeatable",
  ClinicalFinishing: "variance",
  FinishingInefficiency: "variance",
  OpponentWastefulness: "variance",
  DefensiveCollapse: "variance",
  LateDropOff: "mixed",
  EarlyShock: "mixed",
  GameStateControl: "repeatable",
  OpponentClass: "repeatable",
};

type CausalMatch = {
  eventId: number;
  date: number;
  opponent: string;
  venue: "H" | "A";
  scoreline: string;
  result: "W" | "D" | "L";
  primaryCause: CausalCause;
  primaryLabel: string;
  secondaryCauses: CausalCause[];
  repeatability: Repeatability;
  reason: string;
  bttsHit: boolean;
  bttsReason: string;
  bttsRepeatability: Repeatability;
  over25Hit: boolean;
  ouReason: string;
  ouRepeatability: Repeatability;
};

type CausalProfile = {
  matchesAnalyzed: number;
  causes: { cause: CausalCause; label: string; count: number; pct: number; repeatability: Repeatability }[];
  repeatableShare: number;
  varianceShare: number;
  mixedShare: number;
  bttsTrueRate: number | null;
  bttsRepeatableShare: number | null;
  over25TrueRate: number | null;
  over25RepeatableShare: number | null;
  topReasons: string[];
  matches: CausalMatch[];
  predictionLeans: {
    btts: { lean: string; confidence: number; reason: string };
    ou25: { lean: string; confidence: number; reason: string };
    scorelineShape: string;
  };
  summary: string;
};

function classifyCausalMatch(s: MatchStory): CausalMatch {
  const xgF = s.xgFor;
  const xgA = s.xgAgainst;
  const possession = s.possession ?? 50;
  const r1 = (v: number) => Math.round(v * 10) / 10;

  let primary: CausalCause;
  let repeatability: Repeatability;
  const secondaries: CausalCause[] = [];
  let reason = "";

  if (s.result === "W") {
    if (xgF != null && s.goalsFor - xgF >= 0.7 && (s.bigChances ?? 0) <= 2) {
      primary = "ClinicalFinishing"; repeatability = "variance";
      reason = `Won by overperforming xG (+${r1(s.goalsFor - xgF)}) on limited chances`;
    } else if (xgF != null && xgA != null && xgF >= 1.6 && xgF - xgA >= 0.6 && possession >= 53) {
      primary = "AttackingDominance"; repeatability = "repeatable";
      reason = `Controlled tempo and converted (xG ${r1(xgF)}–${r1(xgA)}, ${Math.round(possession)}% possession)`;
    } else if (xgA != null && xgA <= 0.8 && s.goalsAgainst === 0) {
      primary = "DefensiveStructure"; repeatability = "repeatable";
      reason = `Clean sheet earned through defensive control (xGA ${r1(xgA)})`;
    } else if (xgA != null && xgA >= 1.6 && s.goalsAgainst <= 1) {
      primary = "OpponentWastefulness"; repeatability = "variance";
      reason = `Opponent created ${r1(xgA)} xG but failed to punish`;
    } else if (s.firstGoalMin != null && s.firstGoalMin >= 75) {
      primary = "LateDropOff"; repeatability = "mixed";
      reason = `Late winner (${s.firstGoalMin}′) decided a tight match`;
      secondaries.push("ClinicalFinishing");
    } else {
      primary = "AttackingDominance"; repeatability = "mixed";
      reason = `Win without a standout statistical signal — mixed factors`;
    }
  } else if (s.result === "D") {
    if (s.goalsFor === 0 && s.goalsAgainst === 0) {
      if (xgF != null && xgA != null && xgF <= 1.0 && xgA <= 1.0 && (s.shots ?? 12) <= 11) {
        primary = "TacticalDeadlock"; repeatability = "repeatable";
        reason = `Genuine stalemate — both sides ≤1.0 xG, chances neutralised`;
      } else if (xgF != null && xgF >= 1.5) {
        primary = "FinishingInefficiency"; repeatability = "variance";
        reason = `Created ${r1(xgF)} xG but couldn't convert — finishing failure`;
      } else if (xgA != null && xgA >= 1.5) {
        primary = "OpponentWastefulness"; repeatability = "variance";
        reason = `Bailed out — opponent missed ${r1(xgA)} xG of chances`;
      } else {
        primary = "TacticalDeadlock"; repeatability = "mixed";
        reason = `Cagey goalless draw with limited chances either way`;
      }
    } else if (xgF != null && xgF - s.goalsFor >= 0.7) {
      primary = "FinishingInefficiency"; repeatability = "variance";
      reason = `Dropped points by underperforming xG (-${r1(xgF - s.goalsFor)})`;
    } else if (s.firstConcMin != null && s.firstConcMin >= 75) {
      primary = "LateDropOff"; repeatability = "mixed";
      reason = `Conceded late (${s.firstConcMin}′) to drop points from a winning position`;
    } else if (xgF != null && xgA != null && Math.abs(xgF - xgA) <= 0.4) {
      primary = "TacticalDeadlock"; repeatability = "repeatable";
      reason = `Even xG battle (${r1(xgF)}–${r1(xgA)}) ended fairly level`;
    } else {
      primary = "TacticalDeadlock"; repeatability = "mixed";
      reason = `Honours-even contest`;
    }
  } else { // L
    if (xgF != null && xgF - s.goalsFor >= 0.8 && xgF >= 1.4) {
      primary = "FinishingInefficiency"; repeatability = "variance";
      reason = `Lost despite ${r1(xgF)} xG created — punished for missed chances`;
    } else if (xgA != null && s.goalsAgainst - xgA >= 0.7 && s.goalsAgainst >= 2) {
      primary = "DefensiveCollapse"; repeatability = "variance";
      reason = `Conceded ${s.goalsAgainst} on only ${r1(xgA)} xGA — clinical opponent`;
    } else if (xgA != null && xgF != null && xgA - xgF >= 0.7 && possession <= 45) {
      primary = "OpponentClass"; repeatability = "repeatable";
      reason = `Outclassed across the board (xG ${r1(xgF)}–${r1(xgA)}, ${Math.round(possession)}% possession)`;
    } else if (s.firstConcMin != null && s.firstConcMin >= 75 && (s.goalsFor + s.goalsAgainst) <= 2) {
      primary = "LateDropOff"; repeatability = "mixed";
      reason = `Lost to a late goal (${s.firstConcMin}′) in a tight game`;
    } else if (s.firstConcMin != null && s.firstConcMin <= 15) {
      primary = "EarlyShock"; repeatability = "mixed";
      reason = `Conceded early (${s.firstConcMin}′) and never recovered`;
    } else {
      primary = "OpponentClass"; repeatability = "mixed";
      reason = `Beaten by the better side on the day`;
    }
  }

  // Secondary tags from narratives / signals
  if (s.firstConcMin != null && s.firstConcMin <= 15 && primary !== "EarlyShock") secondaries.push("EarlyShock");
  if (s.narratives.includes("blewLead")) secondaries.push("LateDropOff");
  if (s.narratives.includes("comeback")) secondaries.push("GameStateControl");
  if (s.narratives.includes("dominantWin") && primary !== "AttackingDominance") secondaries.push("GameStateControl");

  // BTTS cause
  const bttsHit = s.goalsFor > 0 && s.goalsAgainst > 0;
  let bttsReason = ""; let bttsRep: Repeatability = "mixed";
  if (bttsHit) {
    const bothCreated = xgF != null && xgA != null && xgF >= 1.0 && xgA >= 1.0;
    if (bothCreated) { bttsReason = "Both sides genuinely created (BTTS via chance creation)"; bttsRep = "repeatable"; }
    else { bttsReason = "BTTS via finishing variance — at least one side scored from limited chances"; bttsRep = "variance"; }
  } else if (s.goalsFor === 0 && s.goalsAgainst === 0) {
    if (xgF != null && xgF >= 1.3) { bttsReason = "No-BTTS via own finishing failure"; bttsRep = "variance"; }
    else { bttsReason = "No-BTTS via tactical stalemate (both sides quiet)"; bttsRep = "repeatable"; }
  } else if (s.goalsAgainst === 0) {
    if (xgA != null && xgA <= 0.9) { bttsReason = "Clean sheet earned through defensive control"; bttsRep = "repeatable"; }
    else { bttsReason = "Clean sheet thanks to opponent wastefulness"; bttsRep = "variance"; }
  } else { // s.goalsFor === 0
    if (xgF != null && xgF >= 1.3) { bttsReason = "Failed to score despite creating — finishing failure"; bttsRep = "variance"; }
    else { bttsReason = "Failed to score — chances were absent"; bttsRep = "repeatable"; }
  }

  // O/U 2.5 cause
  const total = s.goalsFor + s.goalsAgainst;
  const over25 = total >= 3;
  const xgTotal = (xgF ?? 0) + (xgA ?? 0);
  let ouReason = ""; let ouRep: Repeatability = "mixed";
  if (over25) {
    if (xgF != null && xgA != null && xgTotal >= 2.6) {
      ouReason = `Open game by chances (combined xG ${r1(xgTotal)})`; ouRep = "repeatable";
    } else {
      ouReason = `Over 2.5 driven by finishing variance — chances scarce`; ouRep = "variance";
    }
  } else {
    if (xgF != null && xgA != null && xgTotal <= 2.2) {
      ouReason = `Low-event game (combined xG ${r1(xgTotal)})`; ouRep = "repeatable";
    } else if (xgF != null && xgA != null && xgTotal >= 2.6) {
      ouReason = `Under 2.5 via finishing failure — ${r1(xgTotal)} xG didn't convert`; ouRep = "variance";
    } else {
      ouReason = `Under 2.5 with mixed signals`; ouRep = "mixed";
    }
  }

  return {
    eventId: s.eventId,
    date: s.date,
    opponent: s.opponent,
    venue: s.venue,
    scoreline: `${s.goalsFor}–${s.goalsAgainst}`,
    result: s.result,
    primaryCause: primary,
    primaryLabel: CAUSE_LABEL[primary],
    secondaryCauses: Array.from(new Set(secondaries)),
    repeatability,
    reason,
    bttsHit,
    bttsReason,
    bttsRepeatability: bttsRep,
    over25Hit: over25,
    ouReason,
    ouRepeatability: ouRep,
  };
}

function computeCausalAnalysis(patterns: ScoringPatterns): CausalProfile {
  const matches = patterns.matchStories.map(classifyCausalMatch);
  const N = matches.length;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : 0;

  // Cause counts
  const counts = new Map<CausalCause, number>();
  matches.forEach(m => counts.set(m.primaryCause, (counts.get(m.primaryCause) || 0) + 1));
  const causes = Array.from(counts.entries())
    .map(([cause, count]) => ({
      cause, label: CAUSE_LABEL[cause], count, pct: pct(count, N),
      repeatability: CAUSE_DEFAULT_REPEAT[cause],
    }))
    .sort((a, b) => b.count - a.count);

  // Repeatability shares
  const rep = matches.filter(m => m.repeatability === "repeatable").length;
  const variance = matches.filter(m => m.repeatability === "variance").length;
  const mixed = matches.filter(m => m.repeatability === "mixed").length;

  // BTTS / OU repeatable shares
  const bttsHits = matches.filter(m => m.bttsHit).length;
  const bttsRepeatable = matches.filter(m => m.bttsRepeatability === "repeatable").length;
  const ouHits = matches.filter(m => m.over25Hit).length;
  const ouRepeatable = matches.filter(m => m.ouRepeatability === "repeatable").length;

  // Top human reasons (deduped, first 4)
  const topReasons: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const key = m.primaryLabel + "|" + m.repeatability;
    if (seen.has(key)) continue;
    seen.add(key);
    topReasons.push(`${m.primaryLabel} (${m.repeatability}) — e.g. ${m.scoreline} vs ${m.opponent}: ${m.reason}`);
    if (topReasons.length >= 4) break;
  }

  // ── Forward-looking leans ────────────────────────────────────────────
  // BTTS lean: weight repeatable BTTS evidence over variance evidence
  const bttsRepYes = matches.filter(m => m.bttsHit && m.bttsRepeatability === "repeatable").length;
  const bttsRepNo  = matches.filter(m => !m.bttsHit && m.bttsRepeatability === "repeatable").length;
  let bttsLean = "Toss-up", bttsConf = 0, bttsReason = "Insufficient repeatable signal";
  if (bttsRepYes + bttsRepNo > 0) {
    const yesShare = bttsRepYes / (bttsRepYes + bttsRepNo);
    bttsConf = Math.round(Math.abs(yesShare - 0.5) * 200);
    if (yesShare >= 0.7)      { bttsLean = "Yes";       bttsReason = `${bttsRepYes}/${bttsRepYes + bttsRepNo} repeatable BTTS-yes results — both sides regularly creating`; }
    else if (yesShare >= 0.55){ bttsLean = "Lean Yes";  bttsReason = `Repeatable signal slightly favours BTTS (${bttsRepYes}/${bttsRepYes + bttsRepNo})`; }
    else if (yesShare <= 0.3) { bttsLean = "No";        bttsReason = `${bttsRepNo}/${bttsRepYes + bttsRepNo} repeatable no-BTTS results — defensive control or low chance creation`; }
    else if (yesShare <= 0.45){ bttsLean = "Lean No";   bttsReason = `Repeatable signal slightly favours no-BTTS (${bttsRepNo}/${bttsRepYes + bttsRepNo})`; }
    else                      { bttsLean = "Toss-up";   bttsReason = "Repeatable evidence roughly even"; }
  }

  const ouRepOver  = matches.filter(m => m.over25Hit  && m.ouRepeatability === "repeatable").length;
  const ouRepUnder = matches.filter(m => !m.over25Hit && m.ouRepeatability === "repeatable").length;
  let ouLean = "Toss-up", ouConf = 0, ouReason = "Insufficient repeatable signal";
  if (ouRepOver + ouRepUnder > 0) {
    const overShare = ouRepOver / (ouRepOver + ouRepUnder);
    ouConf = Math.round(Math.abs(overShare - 0.5) * 200);
    if (overShare >= 0.7)       { ouLean = "Over";        ouReason = `${ouRepOver}/${ouRepOver + ouRepUnder} matches were genuine open games by chance creation`; }
    else if (overShare >= 0.55) { ouLean = "Lean Over";   ouReason = `Repeatable signal slightly favours Over 2.5`; }
    else if (overShare <= 0.3)  { ouLean = "Under";       ouReason = `${ouRepUnder}/${ouRepOver + ouRepUnder} matches were genuine low-event games`; }
    else if (overShare <= 0.45) { ouLean = "Lean Under";  ouReason = `Repeatable signal slightly favours Under 2.5`; }
    else                        { ouLean = "Toss-up";     ouReason = "Repeatable evidence roughly even"; }
  }

  // Scoreline shape
  const xgFor = patterns.xgPerMatch;
  const xgAg  = patterns.xgAgainstPerMatch;
  const deadlockShare = pct(matches.filter(m => m.primaryCause === "TacticalDeadlock").length, N);
  let shape = "Mixed-profile contest";
  if (xgFor != null && xgAg != null) {
    const tot = xgFor + xgAg;
    if (tot <= 2.0 || deadlockShare >= 30) shape = "Cagey low-scoring profile (0-0 / 1-0 / 1-1 most likely)";
    else if (tot >= 3.0)                   shape = "Open & high-scoring profile (2-1 / 2-2 / 3-1 in range)";
    else                                   shape = "Balanced moderate-scoring profile (1-1 / 2-1 / 1-0 in range)";
  }

  // High-level summary
  const repeatableShare = pct(rep, N);
  const varianceShare   = pct(variance, N);
  const dominantCause = causes[0]?.label ?? "—";
  const summary =
    `Last ${N} matches dominated by **${dominantCause.toLowerCase()}** (${causes[0]?.pct ?? 0}%). ` +
    `${repeatableShare}% of results explained by repeatable causes, ${varianceShare}% by variance/luck.`;

  return {
    matchesAnalyzed: N,
    causes,
    repeatableShare,
    varianceShare,
    mixedShare: pct(mixed, N),
    bttsTrueRate: pct(bttsHits, N),
    bttsRepeatableShare: pct(bttsRepeatable, N),
    over25TrueRate: pct(ouHits, N),
    over25RepeatableShare: pct(ouRepeatable, N),
    topReasons,
    matches,
    predictionLeans: {
      btts: { lean: bttsLean, confidence: bttsConf, reason: bttsReason },
      ou25: { lean: ouLean, confidence: ouConf, reason: ouReason },
      scorelineShape: shape,
    },
    summary,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.get(
    "/api/sport/:sport/scheduled-events/:date",
    async (req: Request, res: Response) => {
      try {
        const { sport, date } = req.params;
        const data = await fetchSofaScore(
          `/sport/${sport}/scheduled-events/${date}`,
        );
        res.json(data);
      } catch (error: any) {
        console.error("Error fetching scheduled events:", error.message);
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get("/api/event/:eventId", async (req: Request, res: Response) => {
    try {
      const data = await fetchSofaScore(`/event/${req.params.eventId}`);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get(
    "/api/event/:eventId/incidents",
    async (req: Request, res: Response) => {
      try {
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/incidents`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/lineups",
    async (req: Request, res: Response) => {
      try {
        const { eventId } = req.params;
        const [eventResult, currentLineupsResult] = await Promise.allSettled([
          fetchSofaScore(`/event/${eventId}`),
          fetchSofaScore(`/event/${eventId}/lineups`),
        ]);

        const eventData: any = eventResult.status === "fulfilled" ? eventResult.value : null;
        const currentLineups: any = currentLineupsResult.status === "fulfilled" ? currentLineupsResult.value : null;
        const event = eventData?.event;
        const homeTeamId = Number(event?.homeTeam?.id);
        const awayTeamId = Number(event?.awayTeam?.id);

        const hasProviderLineup = (side: "home" | "away") =>
          (currentLineups?.[side]?.players || []).some((entry: any) => !entry.substitute);

        if (!event || !homeTeamId || !awayTeamId || (hasProviderLineup("home") && hasProviderLineup("away"))) {
          return res.json(currentLineups || { confirmed: false, home: { players: [] }, away: { players: [] } });
        }

        const [homeEventsAll, awayEventsAll] = await Promise.all([
          fetchTeamLastEvents(homeTeamId),
          fetchTeamLastEvents(awayTeamId),
        ]);

        const currentStartTimestamp = Number(event?.startTimestamp) || undefined;
        const homeLast15: any[] = selectLastPlayedTeamMatches(
          homeEventsAll,
          homeTeamId,
          currentStartTimestamp,
        );
        const awayLast15: any[] = selectLastPlayedTeamMatches(
          awayEventsAll,
          awayTeamId,
          currentStartTimestamp,
        );
        const historicalEventIds = Array.from(
          new Set([...homeLast15, ...awayLast15].map((pastEvent: any) => pastEvent.id).filter(Boolean)),
        );
        const historicalLineupResults = await Promise.allSettled(
          historicalEventIds.map((id) => fetchSofaScore(`/event/${id}/lineups`)),
        );
        const lineupsByEventId = new Map<number, any>();
        historicalEventIds.forEach((id, index) => {
          const result = historicalLineupResults[index];
          if (result.status === "fulfilled") lineupsByEventId.set(id, result.value);
        });

        type PlayerHistory = {
          playerId: number;
          name: string;
          position: string;
          appearances: number;
          starts: number;
          last5Appearances: number;
          last5Starts: number;
          weightedAppearances: number;
          weightedStarts: number;
          sameVenueStarts: number;
          ratings: number[];
          recentRatings: number[];
          latestPlayer: any;
          jerseyNumber?: number;
        };

        function getTeamSide(pastEvent: any, teamId: number): "home" | "away" | null {
          if (pastEvent.homeTeam?.id === teamId) return "home";
          if (pastEvent.awayTeam?.id === teamId) return "away";
          return null;
        }

        function recencyWeight(index: number): number {
          if (index < 5) return 3;
          if (index < 10) return 2;
          return 1;
        }

        function playerRole(position?: string): "keeper" | "defender" | "midfielder" | "attacker" {
          const value = (position || "").toLowerCase();
          if (value === "g" || value.includes("goal")) return "keeper";
          if (value.startsWith("d")) return "defender";
          if (value.startsWith("m")) return "midfielder";
          return "attacker";
        }

        function round1(value: number): number {
          return Math.round(value * 10) / 10;
        }

        function average(values: number[]): number | null {
          return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        }

        function readScore(score: any): number | null {
          const value = Number(score?.current ?? score?.display ?? score?.normaltime);
          return Number.isFinite(value) ? value : null;
        }

        function calculateTeamForm(events: any[], teamId: number) {
          const results = events
            .map((event: any) => {
              const side = getTeamSide(event, teamId);
              if (!side) return null;
              const homeScore = readScore(event.homeScore);
              const awayScore = readScore(event.awayScore);
              if (homeScore === null || awayScore === null) return null;
              const goalsFor = side === "home" ? homeScore : awayScore;
              const goalsAgainst = side === "home" ? awayScore : homeScore;
              const margin = goalsFor - goalsAgainst;
              const isWin = margin > 0;
              const isDraw = margin === 0;
              const isCleanSheet = goalsAgainst === 0;
              const isNilNil = goalsFor === 0 && goalsAgainst === 0;
              let points = isWin ? 3 : isDraw ? 1 : 0;
              if (isWin && margin >= 2) points += 2;
              if (isCleanSheet) points += 1;
              if (isDraw) points -= 1;
              if (isNilNil) points -= 1;
              return {
                points,
                goalsFor,
                goalsAgainst,
                result: isWin ? "W" : isDraw ? "D" : "L",
                cleanSheet: isCleanSheet,
                margin,
              };
            })
            .filter(Boolean) as {
              points: number;
              goalsFor: number;
              goalsAgainst: number;
              result: "W" | "D" | "L";
              cleanSheet: boolean;
              margin: number;
            }[];

          const matches = results.length;
          const totalPoints = results.reduce((sum, result) => sum + result.points, 0);
          const goalsFor = results.reduce((sum, result) => sum + result.goalsFor, 0);
          const goalsAgainst = results.reduce((sum, result) => sum + result.goalsAgainst, 0);
          const cleanSheets = results.filter((result) => result.cleanSheet).length;
          const bigWins = results.filter((result) => result.margin >= 2).length;
          const goalsForPerMatch = matches > 0 ? goalsFor / matches : 0;
          const goalsAgainstPerMatch = matches > 0 ? goalsAgainst / matches : 0;
          const cleanSheetRate = matches > 0 ? cleanSheets / matches : 0;
          const scoringRate = matches > 0 ? results.filter((result) => result.goalsFor > 0).length / matches : 0;

          return {
            formPoints: totalPoints,
            formStrength: matches > 0 ? round1(clamp(4 + (totalPoints / (matches * 6)) * 6, 3, 10)) : null,
            scoringStrength: matches > 0 ? round1(clamp(4 + (goalsForPerMatch / 2.5) * 4 + scoringRate * 1.2 + (bigWins / matches) * 0.8, 3, 10)) : null,
            defendingStrength: matches > 0 ? round1(clamp(4 + cleanSheetRate * 3.4 + Math.max(0, 2 - goalsAgainstPerMatch) * 1.3, 3, 10)) : null,
            goalsFor,
            goalsAgainst,
            cleanSheets,
            matches,
            recentForm: results.slice(0, 7).map((result) => result.result),
          };
        }

        function readRating(entry: any): number | null {
          const value = Number(entry.statistics?.rating ?? entry.avgRating);
          return Number.isFinite(value) && value > 0 ? value : null;
        }

        function parseFormationParts(formation?: string): number[] {
          return (formation || "")
            .split("-")
            .map((part) => Number(part.trim()))
            .filter((value) => Number.isFinite(value) && value > 0);
        }

        function deriveFormationFromPlayers(players: any[]): string {
          const defenders = players.filter((entry) => playerRole(entry.position) === "defender").length;
          const midfielders = players.filter((entry) => playerRole(entry.position) === "midfielder").length;
          const attackers = players.filter((entry) => playerRole(entry.position) === "attacker").length;
          if (defenders && midfielders && attackers) return `${defenders}-${midfielders}-${attackers}`;
          return "4-3-3";
        }

        function getUnavailableIds(side: "home" | "away"): Set<number> {
          return new Set(
            (currentLineups?.[side]?.missingPlayers || [])
              .map((entry: any) => Number(entry.player?.id))
              .filter(Boolean),
          );
        }

        function collectTeamHistory(
          events: any[],
          teamId: number,
          targetVenueSide: "home" | "away",
        ): { history: Map<number, PlayerHistory>; formation: string; formationMatches: number } {
          const history = new Map<number, PlayerHistory>();
          const formationScores = new Map<string, { score: number; matches: number }>();

          events.forEach((pastEvent, index) => {
            const side = getTeamSide(pastEvent, teamId);
            if (!side) return;
            const lineup = lineupsByEventId.get(pastEvent.id)?.[side];
            const players = lineup?.players || [];
            const starters = players.filter((entry: any) => !entry.substitute);
            const weight = recencyWeight(index);
            const venueMultiplier = side === targetVenueSide ? 1.25 : 1;
            const formation = lineup?.formation || deriveFormationFromPlayers(starters);

            if (formation && starters.length >= 9) {
              const current = formationScores.get(formation) || { score: 0, matches: 0 };
              current.score += weight * venueMultiplier;
              current.matches += 1;
              formationScores.set(formation, current);
            }

            players.forEach((entry: any) => {
              const playerId = Number(entry.player?.id);
              if (!playerId) return;
              const substitute = !!entry.substitute;
              const current = history.get(playerId) || {
                playerId,
                name: entry.player?.shortName || entry.player?.name || "Player",
                position: entry.position || entry.player?.position || "",
                appearances: 0,
                starts: 0,
                last5Appearances: 0,
                last5Starts: 0,
                weightedAppearances: 0,
                weightedStarts: 0,
                sameVenueStarts: 0,
                ratings: [],
                recentRatings: [],
                latestPlayer: entry.player,
                jerseyNumber: entry.jerseyNumber || entry.player?.jerseyNumber,
              };

              current.appearances += 1;
              current.weightedAppearances += weight;
              if (!substitute) {
                current.starts += 1;
                current.weightedStarts += weight * venueMultiplier;
                if (side === targetVenueSide) current.sameVenueStarts += 1;
              }
              if (index < 5) {
                current.last5Appearances += 1;
                if (!substitute) current.last5Starts += 1;
              }
              const rating = readRating(entry);
              if (rating) {
                current.ratings.push(rating);
                if (index < 5) current.recentRatings.push(rating);
              }
              current.position = current.position || entry.position || entry.player?.position || "";
              current.latestPlayer = entry.player || current.latestPlayer;
              current.jerseyNumber = current.jerseyNumber || entry.jerseyNumber || entry.player?.jerseyNumber;
              history.set(playerId, current);
            });
          });

          const preferredFormation = Array.from(formationScores.entries()).sort((a, b) => b[1].score - a[1].score)[0];
          return {
            history,
            formation: preferredFormation?.[0] || "4-3-3",
            formationMatches: preferredFormation?.[1].matches || 0,
          };
        }

        function buildLikelyLineup(side: "home" | "away", events: any[], teamId: number) {
          const unavailableIds = getUnavailableIds(side);
          const { history, formation, formationMatches } = collectTeamHistory(events, teamId, side);
          const formationParts = parseFormationParts(formation);
          const defenderCount = formationParts[0] || 4;
          const attackerCount = formationParts.length > 1 ? formationParts[formationParts.length - 1] : 3;
          const midfielderCount = Math.max(10 - defenderCount - attackerCount, 0);
          const availablePlayers = Array.from(history.values()).filter((player) => !unavailableIds.has(player.playerId));
          const matchesAnalyzed = events.length || 1;
          const recentMatchCount = Math.min(5, matchesAnalyzed);

          const predictedRating = (player: PlayerHistory) => {
            const recentAverage = average(player.recentRatings);
            const fullAverage = average(player.ratings);
            if (recentAverage && fullAverage) return round1(recentAverage * 0.6 + fullAverage * 0.4);
            if (recentAverage || fullAverage) return round1(recentAverage || fullAverage || 6);
            const startRate = player.starts / matchesAnalyzed;
            const recentStartRate = recentMatchCount > 0 ? player.last5Starts / recentMatchCount : 0;
            return round1(Math.max(5.8, Math.min(7.4, 5.8 + startRate * 0.8 + recentStartRate * 0.8)));
          };

          const lineupScore = (player: PlayerHistory) => {
            const rating = predictedRating(player);
            const coreBonus = player.starts >= 12 ? 14 : player.starts >= 10 ? 8 : 0;
            return (
              player.weightedStarts * 4.5 +
              player.last5Starts * 7 +
              player.sameVenueStarts * 1.6 +
              player.weightedAppearances * 0.8 +
              rating * 2 +
              coreBonus
            );
          };

          const confidence = (player: PlayerHistory) => {
            const startRate = player.starts / matchesAnalyzed;
            const recentStartRate = recentMatchCount > 0 ? player.last5Starts / recentMatchCount : 0;
            const score = startRate * 0.45 + recentStartRate * 0.4 + Math.min(1, player.sameVenueStarts / 5) * 0.15;
            if (score >= 0.72 || player.starts >= 12) return "High";
            if (score >= 0.42 || player.last5Starts >= 2) return "Medium";
            return "Low";
          };

          const usedIds = new Set<number>();
          const takeRole = (role: "keeper" | "defender" | "midfielder" | "attacker", count: number) => {
            const selected = availablePlayers
              .filter((player) => !usedIds.has(player.playerId) && playerRole(player.position) === role)
              .sort((a, b) => lineupScore(b) - lineupScore(a))
              .slice(0, count);
            selected.forEach((player) => usedIds.add(player.playerId));
            return selected;
          };

          const starters = [
            ...takeRole("keeper", 1),
            ...takeRole("defender", defenderCount),
            ...takeRole("midfielder", midfielderCount),
            ...takeRole("attacker", attackerCount),
          ];

          if (starters.length < 11) {
            const fallbackPlayers = availablePlayers
              .filter((player) => !usedIds.has(player.playerId))
              .sort((a, b) => lineupScore(b) - lineupScore(a))
              .slice(0, 11 - starters.length);
            fallbackPlayers.forEach((player) => usedIds.add(player.playerId));
            starters.push(...fallbackPlayers);
          }

          const substitutes = availablePlayers
            .filter((player) => !usedIds.has(player.playerId))
            .sort((a, b) => lineupScore(b) - lineupScore(a))
            .slice(0, 12);

          const toEntry = (player: PlayerHistory, substitute: boolean) => {
            const rating = predictedRating(player);
            return {
              player: player.latestPlayer || { id: player.playerId, shortName: player.name, name: player.name },
              position: player.position || "M",
              substitute,
              jerseyNumber: Number(player.jerseyNumber) || 0,
              statistics: { rating },
              avgRating: rating,
              predictionConfidence: confidence(player),
              likelyLineupReason: substitute
                ? `Bench candidate: ${player.appearances}/15 appearances, ${player.last5Appearances}/5 recent appearances`
                : player.starts >= 12
                ? `Core starter: ${player.starts}/15 starts and available`
                : player.last5Starts >= 3
                ? `Recent starter: ${player.last5Starts}/5 starts and fits ${formation}`
                : `Best available ${playerRole(player.position)} for ${formation}`,
              lineupScore: round1(lineupScore(player)),
            };
          };

          return {
            formation,
            players: [...starters.map((player) => toEntry(player, false)), ...substitutes.map((player) => toEntry(player, true))],
            missingPlayers: currentLineups?.[side]?.missingPlayers || [],
            isLikely: true,
            lineupSource: "weighted_last_15_recent_5_availability_model",
            predictionSummary: {
              matchesAnalyzed: events.length,
              formationMatches,
              unavailableCount: unavailableIds.size,
              method: "Last 15 weighted 3x/2x/1x, current venue formation preference, last 5 activity, injury/suspension removal, role-by-role selection",
            },
          };
        }

        const home = hasProviderLineup("home") ? currentLineups.home : buildLikelyLineup("home", homeLast15, homeTeamId);
        const away = hasProviderLineup("away") ? currentLineups.away : buildLikelyLineup("away", awayLast15, awayTeamId);

        res.json({
          confirmed: hasProviderLineup("home") && hasProviderLineup("away") ? currentLineups?.confirmed ?? false : false,
          home,
          away,
          source: "provider_lineups_with_weighted_likely_lineup_fallback",
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/player-simulation",
    async (req: Request, res: Response) => {
      try {
        const { eventId } = req.params;
        const homeTeamId = Number(req.query.homeTeamId);
        const awayTeamId = Number(req.query.awayTeamId);

        if (!homeTeamId || !awayTeamId) {
          return res.status(400).json({ error: "homeTeamId and awayTeamId are required" });
        }

        const [[currentEventResult, currentLineupsResult], homeEvents, awayEvents] = await Promise.all([
          Promise.allSettled([
            fetchSofaScore(`/event/${eventId}`),
            fetchSofaScore(`/event/${eventId}/lineups`),
          ]),
          fetchTeamLastEvents(homeTeamId),
          fetchTeamLastEvents(awayTeamId),
        ]);

        const currentEvent: any = currentEventResult.status === "fulfilled" ? currentEventResult.value?.event : null;
        const currentLineups: any = currentLineupsResult.status === "fulfilled" ? currentLineupsResult.value : null;
        const currentStartTimestamp = Number(currentEvent?.startTimestamp) || undefined;
        const homeLast15 = selectLastPlayedTeamMatches(homeEvents, homeTeamId, currentStartTimestamp);
        const awayLast15 = selectLastPlayedTeamMatches(awayEvents, awayTeamId, currentStartTimestamp);

        const historicalEventIds = Array.from(
          new Set([...homeLast15, ...awayLast15].map((event: any) => event.id).filter(Boolean)),
        );

        const historicalLineupResults = await Promise.allSettled(
          historicalEventIds.map((id) => fetchSofaScore(`/event/${id}/lineups`)),
        );

        const lineupsByEventId = new Map<number, any>();
        historicalEventIds.forEach((id, index) => {
          const result = historicalLineupResults[index];
          if (result.status === "fulfilled") lineupsByEventId.set(id, result.value);
        });

        const last15EventIds = Array.from(new Set([...homeLast15, ...awayLast15].map((e: any) => e.id).filter(Boolean)));

        const [statsResults, incidentsResults] = await Promise.all([
          Promise.allSettled(last15EventIds.map((id) => fetchSofaScore(`/event/${id}/statistics`))),
          Promise.allSettled(last15EventIds.map((id) => fetchSofaScore(`/event/${id}/incidents`))),
        ]);
        const statsByEventId = new Map<number, any>();
        const incidentsByEventId = new Map<number, any>();
        last15EventIds.forEach((id, index) => {
          const sRes = statsResults[index];
          if (sRes.status === "fulfilled") statsByEventId.set(id, sRes.value);
          const iRes = incidentsResults[index];
          if (iRes.status === "fulfilled") incidentsByEventId.set(id, iRes.value);
        });

        function parseStatNum(value: any): number | null {
          if (value === null || value === undefined || value === "") return null;
          const str = String(value).trim();
          // Handle "X/Y" fraction format — return the numerator (e.g. "518/639" → 518)
          const slashIdx = str.indexOf("/");
          if (slashIdx > 0) {
            const numerator = parseFloat(str.slice(0, slashIdx).replace(/[^0-9.]/g, ""));
            return Number.isFinite(numerator) ? numerator : null;
          }
          const clean = str.replace(/[^0-9.\-]/g, "");
          const num = parseFloat(clean);
          return Number.isFinite(num) ? num : null;
        }

        function extractPeriodStats(statisticsData: any, side: "home" | "away", period: "ALL" | "1ST" | "2ND"): Record<string, number> {
          const statMap: Record<string, number> = {};
          const periodData = (statisticsData?.statistics || []).find((p: any) => p.period === period);
          if (!periodData) return statMap;
          for (const group of (periodData.groups || [])) {
            for (const item of (group.statisticsItems || [])) {
              const rawName = (item.name || "").toLowerCase().trim();
              if (!rawName) continue;
              const val = parseStatNum(item[side]);
              if (val !== null) statMap[rawName] = val;
              // Also derive a percentage variant from API-provided percentage or value/total
              const sidePct = side === "home" ? item.homePercentage : item.awayPercentage;
              const sideVal = side === "home" ? item.homeValue : item.awayValue;
              const sideTotal = side === "home" ? item.homeTotal : item.awayTotal;
              if (sidePct !== null && sidePct !== undefined && Number.isFinite(Number(sidePct))) {
                statMap[rawName + " %"] = Number(sidePct);
              } else if (sideVal != null && sideTotal != null && Number(sideTotal) > 0) {
                const pct = Math.round((Number(sideVal) / Number(sideTotal)) * 1000) / 10;
                statMap[rawName + " %"] = pct;
              }
            }
          }
          return statMap;
        }

        type PeriodStats = {
          avgGoalsScored: number | null;
          avgGoalsConceded: number | null;
          avgPossession: number | null;
          avgXg: number | null;
          avgBigChances: number | null;
          avgTotalShots: number | null;
          avgShotsOnTarget: number | null;
          avgShotsOffTarget: number | null;
          avgBlockedShots: number | null;
          avgShotsInsideBox: number | null;
          avgBigChancesScored: number | null;
          avgBigChancesMissed: number | null;
          avgCornerKicks: number | null;
          avgGoalkeeperSaves: number | null;
          avgGoalsPrevented: number | null;
          avgPassAccuracy: number | null;
          avgTacklesWon: number | null;
          avgInterceptions: number | null;
          avgClearances: number | null;
          avgFouls: number | null;
          avgTotalPasses: number | null;
          avgTouchesInOppositionBox: number | null;
          avgDuelsWon: number | null;
          avgXgGotPerMatch: number | null;
          matchesWithStats: number;
        };

        type TeamMatchStats = {
          all: PeriodStats;
          firstHalf: PeriodStats;
          secondHalf: PeriodStats;
          matchesAnalyzed: number;
        };

        function buildPeriodSamples(
          events: any[],
          teamId: number,
          period: "ALL" | "1ST" | "2ND",
          goalScoreKey: "full" | "period1" | "period2",
        ): { samples: Record<string, number[]>; matchesWithStats: number; goalScored: number[]; goalConceded: number[] } {
          const samples: Record<string, number[]> = {};
          const goalScored: number[] = [];
          const goalConceded: number[] = [];
          let matchesWithStats = 0;

          const addS = (key: string, val: number | null) => {
            if (val !== null) { if (!samples[key]) samples[key] = []; samples[key].push(val); }
          };

          const readGoalScore = (score: any): number | null => {
            if (goalScoreKey === "full") {
              const v = Number(score?.current ?? score?.display ?? score?.normaltime);
              return Number.isFinite(v) ? v : null;
            }
            const v = Number(score?.[goalScoreKey]);
            return Number.isFinite(v) ? v : null;
          };

          events.forEach((event: any) => {
            const isHome = event.homeTeam?.id === teamId;
            const isAway = event.awayTeam?.id === teamId;
            if (!isHome && !isAway) return;
            const side: "home" | "away" = isHome ? "home" : "away";
            const oppSide: "home" | "away" = isHome ? "away" : "home";

            const teamGoals = readGoalScore(isHome ? event.homeScore : event.awayScore);
            const oppGoals = readGoalScore(isHome ? event.awayScore : event.homeScore);
            if (teamGoals !== null) goalScored.push(teamGoals);
            if (oppGoals !== null) goalConceded.push(oppGoals);

            const statsData = statsByEventId.get(event.id);
            if (!statsData) return;
            const s = extractPeriodStats(statsData, side, period);
            if (Object.keys(s).length === 0) return;
            matchesWithStats += 1;
            const get = (keys: string[]): number | null => {
              for (const k of keys) {
                const found = Object.keys(s).find((name) => name === k || name.includes(k));
                if (found !== undefined) return s[found];
              }
              return null;
            };
            const opp = extractPeriodStats(statsData, oppSide, period);
            const oppGet = (keys: string[]): number | null => {
              for (const k of keys) {
                const found = Object.keys(opp).find((name) => name === k || name.includes(k));
                if (found !== undefined) return opp[found];
              }
              return null;
            };
            addS("possession", get(["ball possession"]));
            const customXG = calculateCustomXG(
              get(["total shots", "shots total"]),
              get(["big chances"]),
              get(["shots on target"]),
              get(["blocked shots"]),
              oppGet(["total shots", "shots total"]),
              oppGet(["big chances"]),
            );
            addS("xg", customXG);

            if (customXG !== null && teamGoals !== null) {
              const resultFactor = (oppGoals !== null && teamGoals > oppGoals) ? 1.05
                : (oppGoals !== null && teamGoals === oppGoals) ? 1.00 : 0.95;
              const xgGot = (0.7 * customXG + 0.3 * teamGoals) * resultFactor;
              addS("xgGotPerMatch", Math.round(xgGot * 100) / 100);
            }

            addS("bigChances", get(["big chances"]));
            addS("totalShots", get(["total shots", "shots total"]));
            addS("shotsOnTarget", get(["shots on target"]));
            addS("shotsOffTarget", get(["shots off target"]));
            addS("blockedShots", get(["blocked shots"]));
            addS("shotsInsideBox", get(["shots inside box"]));
            addS("bigChancesScored", get(["big chances scored"]));
            addS("bigChancesMissed", get(["big chances missed"]));
            addS("cornerKicks", get(["corner kicks"]));
            addS("goalkeeperSaves", get(["goalkeeper saves"]));
            addS("goalsPrevented", get(["goals prevented"]));
            // Pass accuracy: try direct stat first, then compute from accurate/total ratio
            const directPassAcc = get(["pass accuracy", "passes %", "accurate passes %"]);
            const accuratePassesCount = get(["accurate passes"]);
            const totalPassesCount = get(["total passes", "passes"]);
            if (directPassAcc !== null) {
              addS("passAccuracy", directPassAcc);
            } else if (accuratePassesCount !== null && totalPassesCount !== null && totalPassesCount > 0) {
              addS("passAccuracy", Math.round((accuratePassesCount / totalPassesCount) * 1000) / 10);
            }
            addS("totalPasses", totalPassesCount);
            addS("tacklesWon", get(["tackles won", "tackles %", "tackles won %"]));
            addS("interceptions", get(["interceptions"]));
            addS("clearances", get(["clearances"]));
            addS("fouls", get(["fouls"]));
            addS("touchesOpBox", get(["touches in opposition box", "touches in opp. box"]));
            addS("duelsWon", get(["total duels won", "duels won", "duels %", "duels"]));
          });

          return { samples, matchesWithStats, goalScored, goalConceded };
        }

        function avgArr(vals: number[]): number | null {
          return vals.length > 0 ? round1(vals.reduce((s2, v) => s2 + v, 0) / vals.length) : null;
        }

        function periodStatsToPeriodStats(
          events: any[],
          teamId: number,
          period: "ALL" | "1ST" | "2ND",
          goalScoreKey: "full" | "period1" | "period2",
        ): PeriodStats {
          const { samples, matchesWithStats, goalScored, goalConceded } = buildPeriodSamples(events, teamId, period, goalScoreKey);
          const avg = (key: string): number | null => {
            const vals = samples[key];
            return vals && vals.length > 0 ? round1(vals.reduce((s2, v) => s2 + v, 0) / vals.length) : null;
          };
          return {
            avgGoalsScored: avgArr(goalScored),
            avgGoalsConceded: avgArr(goalConceded),
            avgPossession: avg("possession"),
            avgXg: avg("xg"),
            avgBigChances: avg("bigChances"),
            avgTotalShots: avg("totalShots"),
            avgShotsOnTarget: avg("shotsOnTarget"),
            avgShotsOffTarget: avg("shotsOffTarget"),
            avgBlockedShots: avg("blockedShots"),
            avgShotsInsideBox: avg("shotsInsideBox"),
            avgBigChancesScored: avg("bigChancesScored"),
            avgBigChancesMissed: avg("bigChancesMissed"),
            avgCornerKicks: avg("cornerKicks"),
            avgGoalkeeperSaves: avg("goalkeeperSaves"),
            avgGoalsPrevented: avg("goalsPrevented"),
            avgPassAccuracy: avg("passAccuracy"),
            avgTacklesWon: avg("tacklesWon"),
            avgInterceptions: avg("interceptions"),
            avgClearances: avg("clearances"),
            avgFouls: avg("fouls"),
            avgTotalPasses: avg("totalPasses"),
            avgTouchesInOppositionBox: avg("touchesOpBox"),
            avgDuelsWon: avg("duelsWon"),
            avgXgGotPerMatch: avg("xgGotPerMatch"),
            matchesWithStats,
          };
        }

        function computeTeamMatchStats(events: any[], teamId: number): TeamMatchStats {
          return {
            all: periodStatsToPeriodStats(events, teamId, "ALL", "full"),
            firstHalf: periodStatsToPeriodStats(events, teamId, "1ST", "period1"),
            secondHalf: periodStatsToPeriodStats(events, teamId, "2ND", "period2"),
            matchesAnalyzed: events.length,
          };
        }

        type PlayerHistory = {
          playerId: number;
          name: string;
          position: string;
          appearances: number;
          starts: number;
          ratings: number[];
          recentRatings: number[];
          statTotals: Record<string, number>;
          statSamples: number;
          last5Appearances: number;
          last5Starts: number;
          lastPlayedTimestamp: number;
          latestPlayer: any;
          jerseyNumber?: number;
        };

        function getTeamSide(event: any, teamId: number): "home" | "away" | null {
          if (event.homeTeam?.id === teamId) return "home";
          if (event.awayTeam?.id === teamId) return "away";
          return null;
        }

        function clamp(value: number, min: number, max: number): number {
          return Math.max(min, Math.min(max, value));
        }

        function round1(value: number): number {
          return Math.round(value * 10) / 10;
        }

        function readStat(stats: any, key: string): number {
          const value = Number(stats?.[key]);
          return Number.isFinite(value) ? value : 0;
        }

        function safeRatio(numerator: number, denominator: number): number | null {
          return denominator > 0 ? numerator / denominator : null;
        }

        function scaleVolume(value: number, goodValue: number): number {
          return clamp(4 + (value / goodValue) * 4, 4, 10);
        }

        function average(values: number[]): number | null {
          return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        }

        function readScore(score: any): number | null {
          const value = Number(score?.current ?? score?.display ?? score?.normaltime);
          return Number.isFinite(value) ? value : null;
        }

        function calculateTeamForm(events: any[], teamId: number) {
          const results = events
            .map((event: any) => {
              const side = getTeamSide(event, teamId);
              if (!side) return null;
              const homeScore = readScore(event.homeScore);
              const awayScore = readScore(event.awayScore);
              if (homeScore === null || awayScore === null) return null;
              const goalsFor = side === "home" ? homeScore : awayScore;
              const goalsAgainst = side === "home" ? awayScore : homeScore;
              const margin = goalsFor - goalsAgainst;
              const isWin = margin > 0;
              const isDraw = margin === 0;
              const isCleanSheet = goalsAgainst === 0;
              const isNilNil = goalsFor === 0 && goalsAgainst === 0;
              let points = isWin ? 3 : isDraw ? 1 : 0;
              if (isWin && margin >= 2) points += 2;
              if (isCleanSheet) points += 1;
              if (isDraw) points -= 1;
              if (isNilNil) points -= 1;
              return {
                points,
                goalsFor,
                goalsAgainst,
                result: isWin ? "W" : isDraw ? "D" : "L",
                cleanSheet: isCleanSheet,
                margin,
              };
            })
            .filter(Boolean) as {
              points: number;
              goalsFor: number;
              goalsAgainst: number;
              result: "W" | "D" | "L";
              cleanSheet: boolean;
              margin: number;
            }[];

          const matches = results.length;
          const totalPoints = results.reduce((sum, result) => sum + result.points, 0);
          const goalsFor = results.reduce((sum, result) => sum + result.goalsFor, 0);
          const goalsAgainst = results.reduce((sum, result) => sum + result.goalsAgainst, 0);
          const cleanSheets = results.filter((result) => result.cleanSheet).length;
          const bigWins = results.filter((result) => result.margin >= 2).length;
          const goalsForPerMatch = matches > 0 ? goalsFor / matches : 0;
          const goalsAgainstPerMatch = matches > 0 ? goalsAgainst / matches : 0;
          const cleanSheetRate = matches > 0 ? cleanSheets / matches : 0;
          const scoringRate = matches > 0 ? results.filter((result) => result.goalsFor > 0).length / matches : 0;

          return {
            formPoints: totalPoints,
            formStrength: matches > 0 ? round1(clamp(4 + (totalPoints / (matches * 6)) * 6, 3, 10)) : null,
            scoringStrength: matches > 0 ? round1(clamp(4 + (goalsForPerMatch / 2.5) * 4 + scoringRate * 1.2 + (bigWins / matches) * 0.8, 3, 10)) : null,
            defendingStrength: matches > 0 ? round1(clamp(4 + cleanSheetRate * 3.4 + Math.max(0, 2 - goalsAgainstPerMatch) * 1.3, 3, 10)) : null,
            goalsFor,
            goalsAgainst,
            cleanSheets,
            matches,
            recentForm: results.slice(0, 7).map((result) => result.result),
          };
        }

        function parseFormationParts(formation?: string): number[] {
          if (!formation) return [];
          return formation
            .split("-")
            .map((part) => Number(part.trim()))
            .filter((value) => Number.isFinite(value) && value > 0);
        }

        function deriveFormationFromPlayers(players: any[]): string {
          const defenders = players.filter((entry) => playerRole(entry.position) === "defender").length;
          const midfielders = players.filter((entry) => playerRole(entry.position) === "midfielder").length;
          const attackers = players.filter((entry) => playerRole(entry.position) === "attacker").length;
          if (defenders && midfielders && attackers) return `${defenders}-${midfielders}-${attackers}`;
          return "4-3-3";
        }

        function getMissingPlayerIds(side: "home" | "away"): Set<number> {
          const missingPlayers = currentLineups?.[side]?.missingPlayers || [];
          return new Set(
            missingPlayers
              .filter((entry: any) => {
                const text = `${entry.type || ""} ${entry.reason || ""}`.toLowerCase();
                return text.includes("injur") || text.includes("suspend") || text.includes("doubt") || text.includes("unavailable");
              })
              .map((entry: any) => Number(entry.player?.id))
              .filter(Boolean),
          );
        }

        function collectTeamHistory(events: any[], teamId: number): Map<number, PlayerHistory> {
          const history = new Map<number, PlayerHistory>();

          events.forEach((event: any, eventIndex: number) => {
            const side = getTeamSide(event, teamId);
            if (!side) return;

            const lineup = lineupsByEventId.get(event.id);
            const players = lineup?.[side]?.players || [];

            players.forEach((entry: any) => {
              const playerId = Number(entry.player?.id);
              if (!playerId) return;

              const current = history.get(playerId) || {
                playerId,
                name: entry.player?.shortName || entry.player?.name || "Player",
                position: entry.position || "",
                appearances: 0,
                starts: 0,
                ratings: [],
                recentRatings: [],
                statTotals: {},
                statSamples: 0,
                last5Appearances: 0,
                last5Starts: 0,
                lastPlayedTimestamp: 0,
                latestPlayer: entry.player,
                jerseyNumber: entry.jerseyNumber,
              };

              current.appearances += 1;
              if (!entry.substitute) current.starts += 1;
              if (eventIndex < 5) {
                current.last5Appearances += 1;
                if (!entry.substitute) current.last5Starts += 1;
              }
              if (entry.statistics) {
                current.statSamples += 1;
                Object.entries(entry.statistics).forEach(([key, rawValue]) => {
                  if (key === "ratingVersions" || key === "statisticsType") return;
                  const value = Number(rawValue);
                  if (Number.isFinite(value)) {
                    current.statTotals[key] = (current.statTotals[key] || 0) + value;
                  }
                });
              }
              const rating = Number(entry.statistics?.rating);
              if (Number.isFinite(rating) && rating > 0) {
                current.ratings.push(rating);
                if (eventIndex < 5) current.recentRatings.push(rating);
              }
              current.position = current.position || entry.position || "";
              current.latestPlayer = current.latestPlayer || entry.player;
              current.jerseyNumber = current.jerseyNumber || entry.jerseyNumber;
              current.lastPlayedTimestamp = Math.max(current.lastPlayedTimestamp, Number(event.startTimestamp) || 0);
              history.set(playerId, current);
            });
          });

          return history;
        }

        function calculateMetrics(player: any, history?: PlayerHistory) {
          const currentRating = Number(player.statistics?.rating);
          const ratings = history?.ratings || [];
          const recentRatings = history?.recentRatings || [];
          const avgRating =
            ratings.length > 0
              ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
              : Number.isFinite(currentRating) && currentRating > 0
              ? currentRating
              : null;
          const recentAvg =
            recentRatings.length > 0
              ? recentRatings.reduce((sum, rating) => sum + rating, 0) / recentRatings.length
              : avgRating;
          const appearances = history?.appearances || 0;
          const starts = history?.starts || 0;
          const statSamples = history?.statSamples || 0;
          const stat = (key: string) => (statSamples > 0 ? (history?.statTotals[key] || 0) / statSamples : readStat(player.statistics, key));
          const totalDuelWon = stat("duelWon") + stat("aerialWon");
          const totalDuelLost = stat("duelLost") + stat("aerialLost") + stat("challengeLost");
          const duelRate = safeRatio(totalDuelWon, totalDuelWon + totalDuelLost);
          const passAccuracy = safeRatio(stat("accuratePass"), stat("totalPass"));
          const longBallAccuracy = safeRatio(stat("accurateLongBalls"), stat("totalLongBalls"));
          const crossAccuracy = safeRatio(stat("accurateCross"), stat("totalCross"));
          const tackleRate = safeRatio(stat("wonTackle"), stat("totalTackle"));
          const defensiveActions =
            stat("interceptionWon") +
            stat("ballRecovery") +
            stat("totalClearance") * 0.55 +
            stat("wonTackle") * 0.9 +
            stat("outfielderBlock") * 0.8;
          const reliability = clamp(
            (passAccuracy !== null ? passAccuracy * 10 : avgRating || 6) -
              stat("errorLeadToAShot") * 2.2 -
              stat("possessionLostCtrl") * 0.08 -
              stat("dispossessed") * 0.22,
            3,
            10,
          );
          const defensiveStrength = average([
            duelRate !== null ? duelRate * 10 : NaN,
            scaleVolume(defensiveActions, 8),
            reliability,
            clamp(6 + stat("defensiveValueNormalized") * 6, 3, 10),
          ].filter(Number.isFinite));
          const attackActions =
            stat("goals") * 2.4 +
            stat("expectedGoals") * 2 +
            stat("onTargetScoringAttempt") * 0.75 +
            stat("totalShots") * 0.25 +
            stat("bigChanceCreated") * 1.4 +
            stat("keyPass") * 0.75 +
            stat("expectedAssists") * 2.4 +
            stat("wonContest") * 0.35 -
            stat("bigChanceMissed") * 0.55;
          const attackStrength = average([
            scaleVolume(attackActions, 5.2),
            clamp(6 + stat("shotValueNormalized") * 5, 3, 10),
            clamp(6 + stat("dribbleValueNormalized") * 5, 3, 10),
            avgRating || NaN,
          ].filter(Number.isFinite));
          const midfieldActions =
            stat("totalProgression") * 0.08 +
            stat("passValueNormalized") * 4 +
            stat("keyPass") * 0.7 +
            stat("expectedAssists") * 2 +
            stat("ballRecovery") * 0.45 +
            stat("interceptionWon") * 0.7 +
            stat("totalBallCarriesDistance") * 0.018 +
            stat("progressiveBallCarriesCount") * 0.7;
          const midfieldStrength = average([
            scaleVolume(midfieldActions, 6),
            reliability,
            passAccuracy !== null ? passAccuracy * 10 : NaN,
            avgRating || NaN,
          ].filter(Number.isFinite));
          const keeperActions =
            stat("saves") * 1.1 +
            stat("savedShotsFromInsideTheBox") * 1.2 +
            stat("goalsPrevented") * 2.2 +
            stat("keeperSaveValue") * 4 +
            stat("goodHighClaim") * 0.8 +
            stat("accurateKeeperSweeper") * 0.8;
          const keeperStrength = average([
            scaleVolume(keeperActions, 4),
            longBallAccuracy !== null ? longBallAccuracy * 10 : NaN,
            clamp(6 + stat("goalkeeperValueNormalized") * 6, 3, 10),
            avgRating || NaN,
          ].filter(Number.isFinite));
          const fullbackActions =
            stat("totalCross") * 0.35 +
            stat("accurateCross") * 1.1 +
            stat("totalBallCarriesDistance") * 0.02 +
            stat("progressiveBallCarriesCount") * 0.75 +
            stat("totalProgression") * 0.07 +
            stat("wonTackle") * 0.7 +
            stat("ballRecovery") * 0.35;
          const fullbackStrength = average([
            scaleVolume(fullbackActions, 5.5),
            crossAccuracy !== null ? crossAccuracy * 10 : NaN,
            tackleRate !== null ? tackleRate * 10 : NaN,
            reliability,
          ].filter(Number.isFinite));
          const consistency =
            ratings.length > 1
              ? 10 - clamp(
                  Math.sqrt(
                    ratings.reduce((sum, rating) => sum + Math.pow(rating - (avgRating || rating), 2), 0) /
                      ratings.length,
                  ) * 2,
                  0,
                  3,
                )
              : ratings.length === 1
              ? 7
              : 5;
          const performance = avgRating ? clamp(avgRating, 4, 10) : 0;
          const experience = clamp(4 + (appearances / 15) * 4 + (starts / 15) * 2, appearances > 0 ? 4 : 0, 10);
          const intelligence = avgRating
            ? clamp(avgRating * 0.62 + consistency * 0.22 + (recentAvg || avgRating) * 0.16, 4, 10)
            : 0;
          const decision = avgRating
            ? clamp((recentAvg || avgRating) * 0.42 + consistency * 0.32 + experience * 0.26, 4, 10)
            : 0;
          const overall = avgRating
            ? clamp(performance * 0.42 + intelligence * 0.22 + decision * 0.2 + experience * 0.16, 4, 10)
            : 0;

          return {
            overall: overall ? round1(overall) : null,
            experience: experience ? round1(experience) : null,
            decision: decision ? round1(decision) : null,
            intelligence: intelligence ? round1(intelligence) : null,
            performance: performance ? round1(performance) : null,
            defensiveStrength: defensiveStrength ? round1(defensiveStrength) : null,
            attackStrength: attackStrength ? round1(attackStrength) : null,
            midfieldStrength: midfieldStrength ? round1(midfieldStrength) : null,
            keeperStrength: keeperStrength ? round1(keeperStrength) : null,
            fullbackStrength: fullbackStrength ? round1(fullbackStrength) : null,
            appearances,
            starts,
            averageRating: avgRating ? round1(avgRating) : null,
            statSamples,
            dataConfidence: ratings.length >= 8 ? "High" : ratings.length >= 3 ? "Medium" : ratings.length > 0 || statSamples > 0 ? "Low" : "Unavailable",
          };
        }

        function playerRole(position?: string): "keeper" | "defender" | "midfielder" | "attacker" {
          const value = (position || "").toLowerCase();
          if (value === "g" || value.includes("goal")) return "keeper";
          if (value.startsWith("d")) return "defender";
          if (value.startsWith("m")) return "midfielder";
          return "attacker";
        }

        function roleAwareScore(entry: any): number | null {
          const role = playerRole(entry.original?.position);
          const metrics = entry.metrics;
          if (role === "keeper") return metrics.keeperStrength || metrics.defensiveStrength || metrics.overall;
          if (role === "defender") return metrics.defensiveStrength || metrics.fullbackStrength || metrics.overall;
          if (role === "midfielder") return metrics.midfieldStrength || metrics.overall;
          return metrics.attackStrength || metrics.overall;
        }

        function preferredFormation(events: any[], teamId: number): string {
          const formationScores = new Map<string, number>();
          events.forEach((event: any, index: number) => {
            const side = getTeamSide(event, teamId);
            if (!side) return;
            const lineup = lineupsByEventId.get(event.id)?.[side];
            const starters = (lineup?.players || []).filter((entry: any) => !entry.substitute);
            const formation = lineup?.formation || deriveFormationFromPlayers(starters);
            if (!formation || starters.length < 9) return;
            const recencyWeight = Math.max(1, 15 - index);
            formationScores.set(formation, (formationScores.get(formation) || 0) + recencyWeight);
          });

          return Array.from(formationScores.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "4-3-3";
        }

        function buildLikelyLineup(
          side: "home" | "away",
          events: any[],
          teamId: number,
          history: Map<number, PlayerHistory>,
        ) {
          const formation = preferredFormation(events, teamId);
          const formationParts = parseFormationParts(formation);
          const defenderCount = formationParts[0] || 4;
          const attackerCount = formationParts.length > 1 ? formationParts[formationParts.length - 1] : 3;
          const midfielderCount = Math.max(10 - defenderCount - attackerCount, 0);
          const missingIds = getMissingPlayerIds(side);
          const activeLast5Ids = new Set(
            Array.from(history.values())
              .filter((player) => player.last5Appearances > 0)
              .map((player) => player.playerId),
          );
          const candidates = Array.from(history.values()).filter((player) => !missingIds.has(player.playerId));
          const ratingAvg = (player: PlayerHistory) =>
            player.ratings.length > 0 ? player.ratings.reduce((sum, rating) => sum + rating, 0) / player.ratings.length : 6;
          const candidateScore = (player: PlayerHistory) =>
            player.starts * 2.2 +
            player.appearances * 0.8 +
            player.last5Starts * 4 +
            player.last5Appearances * 2.2 +
            ratingAvg(player) * 2 +
            (activeLast5Ids.has(player.playerId) ? 5 : 0);
          const usedIds = new Set<number>();
          const takeRole = (role: "keeper" | "defender" | "midfielder" | "attacker", count: number) => {
            const selected = candidates
              .filter((player) => !usedIds.has(player.playerId) && playerRole(player.position) === role)
              .sort((a, b) => candidateScore(b) - candidateScore(a))
              .slice(0, count);
            selected.forEach((player) => usedIds.add(player.playerId));
            return selected;
          };

          const picked = [
            ...takeRole("keeper", 1),
            ...takeRole("defender", defenderCount),
            ...takeRole("midfielder", midfielderCount),
            ...takeRole("attacker", attackerCount),
          ];
          const fallbackNeeded = Math.max(0, 11 - picked.length);
          if (fallbackNeeded > 0) {
            const extra = candidates
              .filter((player) => !usedIds.has(player.playerId))
              .sort((a, b) => candidateScore(b) - candidateScore(a))
              .slice(0, fallbackNeeded);
            extra.forEach((player) => usedIds.add(player.playerId));
            picked.push(...extra);
          }

          const substitutes = candidates
            .filter((player) => !usedIds.has(player.playerId))
            .sort((a, b) => candidateScore(b) - candidateScore(a))
            .slice(0, 12);

          const toEntry = (player: PlayerHistory, substitute: boolean) => ({
            player: player.latestPlayer || { id: player.playerId, shortName: player.name, name: player.name },
            position: player.position || "M",
            substitute,
            jerseyNumber: player.jerseyNumber || 0,
            statistics: {
              rating: ratingAvg(player),
            },
            likelyLineupReason: substitute
              ? "Bench option from last 15 match involvement"
              : player.last5Appearances > 0
              ? "Active in last 5 and fits preferred formation"
              : "Best available historical fit for preferred formation",
          });

          return {
            formation,
            players: [...picked.map((player) => toEntry(player, false)), ...substitutes.map((player) => toEntry(player, true))],
            missingPlayers: currentLineups?.[side]?.missingPlayers || [],
            isLikely: true,
            lineupSource: "preferred_formation_last_15_active_last_5",
            unavailableCount: missingIds.size,
            activeLast5Count: activeLast5Ids.size,
          };
        }

        function enrichSide(side: "home" | "away", history: Map<number, PlayerHistory>, events: any[], teamId: number) {
          const existingTeam = currentLineups?.[side];
          const hasProviderLineup = (existingTeam?.players || []).some((entry: any) => !entry.substitute);
          const team = hasProviderLineup ? existingTeam : buildLikelyLineup(side, events, teamId, history);
          const teamForm = calculateTeamForm(events, teamId);
          const players = (team?.players || []).map((entry: any) => {
            const playerId = Number(entry.player?.id);
            return {
              playerId,
              position: entry.position || null,
              metrics: calculateMetrics(entry, history.get(playerId)),
            };
          });

          const starters = players.filter((entry: any) => {
            const original = (team?.players || []).find((player: any) => Number(player.player?.id) === entry.playerId);
            return original && !original.substitute;
          }).map((entry: any) => ({
            ...entry,
            original: (team?.players || []).find((player: any) => Number(player.player?.id) === entry.playerId),
          }));
          const availableRatings = starters
            .map(roleAwareScore)
            .filter((rating: number | null) => typeof rating === "number") as number[];
          const teamStrength =
            availableRatings.length > 0
              ? round1(availableRatings.reduce((sum, rating) => sum + rating, 0) / availableRatings.length)
              : null;
          const roleScores = {
            defensiveStrength: starters
              .filter((entry: any) => ["keeper", "defender"].includes(playerRole(entry.original?.position)))
              .map((entry: any) => entry.metrics.defensiveStrength || entry.metrics.keeperStrength)
              .filter((rating: number | null) => typeof rating === "number") as number[],
            attackStrength: starters
              .filter((entry: any) => playerRole(entry.original?.position) === "attacker")
              .map((entry: any) => entry.metrics.attackStrength)
              .filter((rating: number | null) => typeof rating === "number") as number[],
            midfieldStrength: starters
              .filter((entry: any) => playerRole(entry.original?.position) === "midfielder")
              .map((entry: any) => entry.metrics.midfieldStrength)
              .filter((rating: number | null) => typeof rating === "number") as number[],
            keeperStrength: starters
              .filter((entry: any) => playerRole(entry.original?.position) === "keeper")
              .map((entry: any) => entry.metrics.keeperStrength)
              .filter((rating: number | null) => typeof rating === "number") as number[],
            fullbackStrength: starters
              .filter((entry: any) => playerRole(entry.original?.position) === "defender")
              .map((entry: any) => entry.metrics.fullbackStrength)
              .filter((rating: number | null) => typeof rating === "number") as number[],
          };
          const averageRole = (values: number[]) => (values.length > 0 ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null);

          // ── Injury / suspension report ──────────────────────────────────
          const rawMissing: any[] = currentLineups?.[side]?.missingPlayers || [];
          const injuryReport = rawMissing.map((entry: any) => {
            const pid = Number(entry.player?.id);
            const ph = history.get(pid);
            const avgRating =
              ph && ph.ratings.length > 0
                ? round1(ph.ratings.reduce((s: number, r: number) => s + r, 0) / ph.ratings.length)
                : null;
            const last5Rating =
              ph && ph.recentRatings.length > 0
                ? round1(ph.recentRatings.reduce((s: number, r: number) => s + r, 0) / ph.recentRatings.length)
                : null;
            const effectiveRating = last5Rating ?? avgRating ?? 0;
            const isKeyPlayer = effectiveRating >= 7.0 && (ph?.last5Appearances ?? 0) >= 1;
            const typeStr = `${entry.type || ""} ${entry.reason || ""}`.toLowerCase();
            const isSuspended =
              typeStr.includes("suspend") || typeStr.includes("card") || typeStr.includes("ban");
            return {
              name: entry.player?.shortName || entry.player?.name || "Unknown",
              type: isSuspended ? "suspension" : "injury",
              reason: entry.reason || entry.type || "Unavailable",
              avgRating,
              last5Rating,
              isKeyPlayer,
              position: ph?.position || "",
              last5Appearances: ph?.last5Appearances ?? 0,
              last5Starts: ph?.last5Starts ?? 0,
            };
          });
          const keyMissing = injuryReport.filter((p: any) => p.isKeyPlayer);
          const injuryImpact =
            keyMissing.length > 0
              ? round1(
                  Math.min(
                    keyMissing.reduce(
                      (sum: number, p: any) => sum + (p.last5Rating ?? p.avgRating ?? 7),
                      0,
                    ) /
                      keyMissing.length *
                      0.7 +
                      keyMissing.length * 0.5,
                    10,
                  ),
                )
              : 0;
          const injuredList = injuryReport.filter((p: any) => p.type === "injury");
          const suspendedList = injuryReport.filter((p: any) => p.type === "suspension");

          return {
            formation: team?.formation || null,
            lineup: team,
            lineupSource: hasProviderLineup ? "provider_predicted_or_confirmed" : team?.lineupSource,
            isLikelyLineup: !hasProviderLineup,
            unavailableCount: team?.unavailableCount || 0,
            activeLast5Count: team?.activeLast5Count || 0,
            players,
            teamStrength,
            formStrength: teamForm.formStrength,
            scoringStrength: teamForm.scoringStrength,
            defendingStrength: teamForm.defendingStrength,
            formPoints: teamForm.formPoints,
            formSummary: teamForm,
            phaseStrengths: {
              defensiveStrength: averageRole(roleScores.defensiveStrength),
              attackStrength: averageRole(roleScores.attackStrength),
              midfieldStrength: averageRole(roleScores.midfieldStrength),
              keeperStrength: averageRole(roleScores.keeperStrength),
              fullbackStrength: averageRole(roleScores.fullbackStrength),
            },
            matchesAnalyzed: side === "home" ? homeLast15.length : awayLast15.length,
            injuredPlayers: injuredList,
            suspendedPlayers: suspendedList,
            injuryImpact,
          };
        }

        const homeHistory = collectTeamHistory(homeLast15, homeTeamId);
        const awayHistory = collectTeamHistory(awayLast15, awayTeamId);
        const homeTeamMatchStats = computeTeamMatchStats(homeLast15, homeTeamId);
        const awayTeamMatchStats = computeTeamMatchStats(awayLast15, awayTeamId);
        const homeGSRM = computeGSRM(homeLast15, homeTeamId, incidentsByEventId);
        const awayGSRM = computeGSRM(awayLast15, awayTeamId, incidentsByEventId);

        const homeMissingIds = new Set<number>(
          (currentLineups?.home?.missingPlayers || [])
            .map((entry: any) => Number(entry.player?.id))
            .filter(Boolean),
        );
        const awayMissingIds = new Set<number>(
          (currentLineups?.away?.missingPlayers || [])
            .map((entry: any) => Number(entry.player?.id))
            .filter(Boolean),
        );
        const homeSSBI = computeSSBI(homeLast15, homeTeamId, incidentsByEventId, homeMissingIds);
        const awaySSBI = computeSSBI(awayLast15, awayTeamId, incidentsByEventId, awayMissingIds);

        const homePatterns = computeScoringPatterns(homeLast15, homeTeamId, incidentsByEventId, statsByEventId, homeTeamMatchStats?.all?.avgXg ?? null);
        const awayPatterns = computeScoringPatterns(awayLast15, awayTeamId, incidentsByEventId, statsByEventId, awayTeamMatchStats?.all?.avgXg ?? null);

        const homeCausal = computeCausalAnalysis(homePatterns);
        const awayCausal = computeCausalAnalysis(awayPatterns);

        const homeSide = enrichSide("home", homeHistory, homeLast15, homeTeamId);
        const awaySide = enrichSide("away", awayHistory, awayLast15, awayTeamId);

        const homeHidden = computeHiddenTruths(homePatterns);
        const awayHidden = computeHiddenTruths(awayPatterns);
        const homeName = currentEvent?.homeTeam?.shortName || currentEvent?.homeTeam?.name || "Home";
        const awayName = currentEvent?.awayTeam?.shortName || currentEvent?.awayTeam?.name || "Away";
        const matchupCrossRefs = computeMatchupCrossRefs(homeName, awayName, homePatterns, awayPatterns, homeHidden, awayHidden);
        const simulationInsights: SimulationInsights = { home: homeHidden, away: awayHidden, matchup: matchupCrossRefs };

        res.json({
          home: { ...homeSide, teamMatchStats: homeTeamMatchStats, gsrm: homeGSRM, ssbi: homeSSBI, scoringPatterns: homePatterns, causalAnalysis: homeCausal },
          away: { ...awaySide, teamMatchStats: awayTeamMatchStats, gsrm: awayGSRM, ssbi: awaySSBI, scoringPatterns: awayPatterns, causalAnalysis: awayCausal },
          simulationInsights,
          confirmed: currentLineups?.confirmed ?? null,
          source: "last_15_role_based_lineup_statistics_with_likely_lineup_fallback",
        });
      } catch (error: any) {
        console.error("Error building player simulation:", error.message);
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/statistics",
    async (req: Request, res: Response) => {
      try {
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/statistics`,
        );
        res.json(injectCustomXGIntoStatistics(data));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/best-players",
    async (req: Request, res: Response) => {
      try {
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/best-players`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/h2h/events",
    async (req: Request, res: Response) => {
      try {
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/h2h/events`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/odds/1/all",
    async (req: Request, res: Response) => {
      try {
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/odds/1/all`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/unique-tournament/:tournamentId/season/:seasonId/standings/total",
    async (req: Request, res: Response) => {
      try {
        const { tournamentId, seasonId } = req.params;
        const data = await fetchSofaScore(
          `/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/team/:teamId/events/last/:page",
    async (req: Request, res: Response) => {
      try {
        const { teamId, page } = req.params;
        const data = await fetchSofaScore(
          `/team/${teamId}/events/last/${page}`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/team/:teamId/image",
    async (req: Request, res: Response) => {
      await proxyImage(
        `https://api.sofascore.app/api/v1/team/${req.params.teamId}/image`,
        res,
      );
    },
  );

  app.get(
    "/api/unique-tournament/:tournamentId/image",
    async (req: Request, res: Response) => {
      await proxyImage(
        `https://api.sofascore.app/api/v1/unique-tournament/${req.params.tournamentId}/image`,
        res,
      );
    },
  );

  app.get(
    "/api/player/:playerId/image",
    async (req: Request, res: Response) => {
      await proxyImage(
        `https://api.sofascore.app/api/v1/player/${req.params.playerId}/image`,
        res,
      );
    },
  );

  app.get("/api/ai-insight", async (req: Request, res: Response) => {
    try {
      const { eventId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, tournamentName } = req.query as Record<string, string>;

      if (!homeTeamId || !awayTeamId) {
        return res.status(400).json({ error: "homeTeamId and awayTeamId are required" });
      }

      // ── Helpers ─────────────────────────────────────────────────────────────

      function parseFractionalOdds(value?: string): number | null {
        if (!value) return null;
        const parts = value.split("/");
        if (parts.length === 2) {
          const n = parseFloat(parts[0]), d = parseFloat(parts[1]);
          if (!isNaN(n) && !isNaN(d) && d !== 0) return Math.round((n / d + 1) * 100) / 100;
        }
        const dec = parseFloat(value);
        return isNaN(dec) ? null : dec;
      }

      function extractFTOdds(oddsData: any): { home: number | null; draw: number | null; away: number | null } {
        const empty = { home: null, draw: null, away: null };
        if (!oddsData?.markets) return empty;
        const ftMarket =
          oddsData.markets.find((m: any) =>
            (m.marketName || "").toLowerCase().includes("full time")
          ) || oddsData.markets[0];
        if (!ftMarket?.choices) return empty;
        const choices = ftMarket.choices as any[];
        const find = (names: string[]) =>
          choices.find((c) => names.includes((c.name || "").toLowerCase()));
        return {
          home: parseFractionalOdds(find(["1", "home"])?.fractionalValue),
          draw: parseFractionalOdds(find(["x", "draw"])?.fractionalValue),
          away: parseFractionalOdds(find(["2", "away"])?.fractionalValue),
        };
      }

      // ── Fetch base data ──────────────────────────────────────────────────────

      const [homeEvents, awayEvents, [eventOddsResult, eventDataResult]] = await Promise.all([
        fetchTeamLastEvents(homeTeamId),
        fetchTeamLastEvents(awayTeamId),
        Promise.allSettled([
          eventId ? fetchSofaScore(`/event/${eventId}/odds/1/all`) : Promise.resolve(null),
          eventId ? fetchSofaScore(`/event/${eventId}`) : Promise.resolve(null),
        ]),
      ]);

      const currentMatchOddsRaw = eventOddsResult.status === "fulfilled" ? eventOddsResult.value : null;
      const currentEvent = eventDataResult.status === "fulfilled" ? (eventDataResult.value as any)?.event : null;

      const currentStartTimestamp = Number(currentEvent?.startTimestamp) || undefined;
      const last15Home = selectLastPlayedTeamMatches(homeEvents, homeTeamId, currentStartTimestamp);
      const last15Away = selectLastPlayedTeamMatches(awayEvents, awayTeamId, currentStartTimestamp);

      // ── Fetch odds for every historical match (for TMP B & D pillars) ────────

      const allPastEventIds = Array.from(
        new Set([...last15Home, ...last15Away].map((m: any) => m.id as number))
      );

      const pastOddsResults = await Promise.allSettled(
        allPastEventIds.map((id) => fetchSofaScore(`/event/${id}/odds/1/all`))
      );

      const pastOddsMap = new Map<number, { home: number | null; draw: number | null; away: number | null }>();
      allPastEventIds.forEach((id, idx) => {
        const result = pastOddsResults[idx];
        pastOddsMap.set(id, result.status === "fulfilled" ? extractFTOdds(result.value) : { home: null, draw: null, away: null });
      });

      // ── Summarise each match ─────────────────────────────────────────────────

      function summarizeMatch(match: any, teamId: number) {
        const isHome = match.homeTeam?.id === Number(teamId);
        const teamScore = isHome
          ? match.homeScore?.display ?? match.homeScore?.current ?? 0
          : match.awayScore?.display ?? match.awayScore?.current ?? 0;
        const oppScore = isHome
          ? match.awayScore?.display ?? match.awayScore?.current ?? 0
          : match.homeScore?.display ?? match.homeScore?.current ?? 0;
        const teamHtGoals = isHome
          ? match.homeScore?.period1 ?? null
          : match.awayScore?.period1 ?? null;
        const oppHtGoals = isHome
          ? match.awayScore?.period1 ?? null
          : match.homeScore?.period1 ?? null;
        const htResult: "winning" | "losing" | "level" =
          teamHtGoals === null || oppHtGoals === null
            ? "level"
            : teamHtGoals > oppHtGoals
            ? "winning"
            : teamHtGoals < oppHtGoals
            ? "losing"
            : "level";

        const opponent = isHome
          ? match.awayTeam?.name || match.awayTeam?.shortName
          : match.homeTeam?.name || match.homeTeam?.shortName;
        let result: "W" | "D" | "L" = "D";
        if (match.winnerCode === 1) result = isHome ? "W" : "L";
        else if (match.winnerCode === 2) result = isHome ? "L" : "W";

        const date = new Date(match.startTimestamp * 1000).toISOString().split("T")[0];
        const competition = match.tournament?.uniqueTournament?.name || match.tournament?.name || "Unknown";
        const totalGoals = teamScore + oppScore;

        return {
          eventId: match.id as number,
          date,
          result,
          score: `${teamScore}-${oppScore}`,
          htResult,
          side: isHome ? "Home" : "Away",
          isHome,
          opponent,
          competition,
          totalGoals,
          cleanSheet: oppScore === 0,
          scored: teamScore > 0,
          goalsScored: teamScore,
          goalsConceded: oppScore,
        };
      }

      const homeSummaries = last15Home.map((m: any) => summarizeMatch(m, Number(homeTeamId)));
      const awaySummaries = last15Away.map((m: any) => summarizeMatch(m, Number(awayTeamId)));

      // ── TMP Calculation ──────────────────────────────────────────────────────
      // TMP = Box A (result) + Box B (odds performance) + Box C (match control) + Box D (opponent strength)

      function calculateTMP(summaries: ReturnType<typeof summarizeMatch>[]) {
        let boxA = 0, boxB = 0, boxC = 0, boxD = 0;
        const breakdown: string[] = [];

        for (const s of summaries) {
          // Box A — Result Efficiency
          const aPoints = s.result === "W" ? 14 : s.result === "D" ? 6 : -12;
          boxA += aPoints;

          // Box B — Odds Performance (team's own odds for this match)
          const matchOdds = pastOddsMap.get(s.eventId);
          const teamOdds = matchOdds ? (s.isHome ? matchOdds.home : matchOdds.away) : null;
          const oppOdds  = matchOdds ? (s.isHome ? matchOdds.away : matchOdds.home) : null;

          if (teamOdds !== null) {
            const role = teamOdds >= 2.81 ? "underdog" : teamOdds >= 2.01 ? "balanced" : "favourite";
            let bPoints = 0;
            if (s.result === "W")      bPoints = role === "underdog" ? 15 : role === "balanced" ? 10 : 5;
            else if (s.result === "D") bPoints = role === "underdog" ? 10 : role === "balanced" ? 6 : -4;
            else                       bPoints = role === "underdog" ? -5 : role === "balanced" ? -2 : -10;
            boxB += bPoints;
          }

          // Box C — Match Control (HT → FT)
          const ht = s.htResult, ft = s.result;
          if      (ht === "losing"  && ft === "W") boxC += 10; // comeback
          else if (ht === "winning" && ft === "W") boxC += 8;  // held on
          else if (ht === "level"   && ft === "W") boxC += 6;  // second-half winner
          else if (ht === "losing"  && ft === "D") boxC += 5;  // salvaged draw
          else if (ht === "level"   && ft === "D") boxC += 3;
          else if (ht === "winning" && ft === "D") boxC -= 4;  // dropped points
          else if (ht === "level"   && ft === "L") boxC -= 6;
          else if (ht === "winning" && ft === "L") boxC -= 8;  // total collapse

          // Box D — Opponent Strength (opponent's odds as proxy for quality)
          if (oppOdds !== null) {
            const tier = oppOdds < 1.6 ? "top" : oppOdds <= 2.5 ? "mid" : "bottom";
            let dPoints = 0;
            if      (s.result === "W") dPoints = tier === "top" ? 12 : tier === "mid" ? 8 : 4;
            else if (s.result === "D") dPoints = tier === "top" ? 8  : tier === "mid" ? 5 : 2;
            else                       dPoints = tier === "top" ? -6 : tier === "mid" ? -4 : -2;
            boxD += dPoints;
          }

          breakdown.push(`[${s.date}] ${s.result} vs ${s.opponent} (${s.side}) A:${aPoints}`);
        }

        const total = boxA + boxB + boxC + boxD;
        const momentum = total >= 300 ? "High" : total >= 150 ? "Medium" : "Low";
        return { total, boxA, boxB, boxC, boxD, momentum, oddsAvailable: pastOddsMap.size > 0 };
      }

      const homeTMP = calculateTMP(homeSummaries);
      const awayTMP  = calculateTMP(awaySummaries);

      // ── Aggregate stats ──────────────────────────────────────────────────────

      function computeStats(summaries: ReturnType<typeof summarizeMatch>[]) {
        const played = summaries.length;
        if (played === 0) return null;
        const wins   = summaries.filter(s => s.result === "W").length;
        const draws  = summaries.filter(s => s.result === "D").length;
        const losses = summaries.filter(s => s.result === "L").length;
        const gf     = summaries.reduce((a, s) => a + s.goalsScored,   0);
        const ga     = summaries.reduce((a, s) => a + s.goalsConceded, 0);
        const cs     = summaries.filter(s => s.cleanSheet).length;
        const fts    = summaries.filter(s => !s.scored).length;
        const btts   = summaries.filter(s => s.scored && !s.cleanSheet).length;
        const over25 = summaries.filter(s => s.totalGoals > 2).length;
        const hm = summaries.filter(s => s.side === "Home");
        const am = summaries.filter(s => s.side === "Away");
        const hw = hm.filter(s => s.result === "W").length;
        const aw = am.filter(s => s.result === "W").length;
        const hd = hm.filter(s => s.result === "D").length;
        const ad = am.filter(s => s.result === "D").length;
        const comebacks  = summaries.filter(s => s.htResult === "losing"  && s.result === "W").length;
        const collapses  = summaries.filter(s => s.htResult === "winning" && s.result === "L").length;
        const droppedPts = summaries.filter(s => s.htResult === "winning" && s.result === "D").length;
        return {
          played, wins, draws, losses, gf, ga,
          avgGF: Math.round(gf / played * 100) / 100,
          avgGA: Math.round(ga / played * 100) / 100,
          cs, fts, btts, over25,
          homeRecord: `${hw}W-${hm.length - hw - hd}L-${hd}D`,
          awayRecord: `${aw}W-${am.length - aw - ad}L-${ad}D`,
          last5Form: summaries.slice(0, 5).map(s => s.result).join(""),
          comebacks, collapses, droppedPts,
        };
      }

      const homeStats = computeStats(homeSummaries);
      const awayStats  = computeStats(awaySummaries);

      // ── Current match odds (for value assessment) ────────────────────────────

      const currentMatchOdds = extractFTOdds(currentMatchOddsRaw);

      // ── Build prompt ─────────────────────────────────────────────────────────

      const tmpOddsNote = homeTMP.oddsAvailable
        ? "TMP Boxes B & D are computed from actual historical odds for each match."
        : "TMP Boxes B & D could not be computed (historical odds unavailable); only Boxes A & C are scored.";

      const prompt = `You are an elite football betting analyst combining deep statistical reasoning with market intelligence. Your job is to find profitable betting markets for the following match — not just based on surface form, but by integrating momentum quality, opponent weighting, resilience, and value against the current odds.

═══════════════════════════════════════════
MATCH: ${homeTeamName} vs ${awayTeamName}
COMPETITION: ${tournamentName || "Unknown"}
${currentEvent ? `DATE: ${new Date(currentEvent.startTimestamp * 1000).toISOString().split("T")[0]}` : ""}
${currentMatchOdds.home ? `CURRENT ODDS: Home ${currentMatchOdds.home} | Draw ${currentMatchOdds.draw} | Away ${currentMatchOdds.away}` : ""}
═══════════════════════════════════════════

━━━ TEAM MOMENTUM PERFORMANCE (TMP) ━━━
TMP is a 0–400 composite score: quality and character of results, not just wins/losses.
Pillar A = Result Efficiency | B = Odds Performance | C = Match Control (HT→FT) | D = Opponent Strength
${tmpOddsNote}

${homeTeamName} TMP: ${homeTMP.total} (${homeTMP.momentum} momentum)
  └ A:${homeTMP.boxA} B:${homeTMP.boxB} C:${homeTMP.boxC} D:${homeTMP.boxD}
  └ Ratings: 300+=High · 150-299=Medium · <150=Low

${awayTeamName} TMP: ${awayTMP.total} (${awayTMP.momentum} momentum)
  └ A:${awayTMP.boxA} B:${awayTMP.boxB} C:${awayTMP.boxC} D:${awayTMP.boxD}

TMP Gap: ${Math.abs(homeTMP.total - awayTMP.total)} points in favour of ${homeTMP.total >= awayTMP.total ? homeTeamName : awayTeamName}

━━━ ${homeTeamName?.toUpperCase()} — LAST ${homeSummaries.length} MATCHES ━━━
Record: ${homeStats?.wins}W ${homeStats?.draws}D ${homeStats?.losses}L | GF:${homeStats?.gf} GA:${homeStats?.ga} | Avg GF:${homeStats?.avgGF} GA:${homeStats?.avgGA}
Home: ${homeStats?.homeRecord} | Away: ${homeStats?.awayRecord} | Last 5: ${homeStats?.last5Form}
Clean Sheets: ${homeStats?.cs}/${homeStats?.played} | Failed to Score: ${homeStats?.fts}/${homeStats?.played}
BTTS: ${homeStats?.btts}/${homeStats?.played} | Over 2.5: ${homeStats?.over25}/${homeStats?.played}
Resilience: ${homeStats?.comebacks} comebacks | Collapses: ${homeStats?.collapses} | Dropped leads: ${homeStats?.droppedPts}

Match log (newest first):
${homeSummaries.map((m, i) => {
  const odds = pastOddsMap.get(m.eventId);
  const teamOdds = odds ? (m.isHome ? odds.home : odds.away) : null;
  const oppOdds  = odds ? (m.isHome ? odds.away : odds.home) : null;
  return `${i + 1}. [${m.date}] ${m.side} vs ${m.opponent} (${m.competition}): ${m.result} ${m.score} | HT:${m.htResult}${teamOdds ? ` | OwnOdds:${teamOdds}` : ""}${oppOdds ? ` OppOdds:${oppOdds}` : ""}`;
}).join("\n")}

━━━ ${awayTeamName?.toUpperCase()} — LAST ${awaySummaries.length} MATCHES ━━━
Record: ${awayStats?.wins}W ${awayStats?.draws}D ${awayStats?.losses}L | GF:${awayStats?.gf} GA:${awayStats?.ga} | Avg GF:${awayStats?.avgGF} GA:${awayStats?.avgGA}
Home: ${awayStats?.homeRecord} | Away: ${awayStats?.awayRecord} | Last 5: ${awayStats?.last5Form}
Clean Sheets: ${awayStats?.cs}/${awayStats?.played} | Failed to Score: ${awayStats?.fts}/${awayStats?.played}
BTTS: ${awayStats?.btts}/${awayStats?.played} | Over 2.5: ${awayStats?.over25}/${awayStats?.played}
Resilience: ${awayStats?.comebacks} comebacks | Collapses: ${awayStats?.collapses} | Dropped leads: ${awayStats?.droppedPts}

Match log (newest first):
${awaySummaries.map((m, i) => {
  const odds = pastOddsMap.get(m.eventId);
  const teamOdds = odds ? (m.isHome ? odds.home : odds.away) : null;
  const oppOdds  = odds ? (m.isHome ? odds.away : odds.home) : null;
  return `${i + 1}. [${m.date}] ${m.side} vs ${m.opponent} (${m.competition}): ${m.result} ${m.score} | HT:${m.htResult}${teamOdds ? ` | OwnOdds:${teamOdds}` : ""}${oppOdds ? ` OppOdds:${oppOdds}` : ""}`;
}).join("\n")}

━━━ ANALYSIS FRAMEWORK ━━━
Reason carefully through each of these before forming predictions:

1. TMP MOMENTUM GAP: What does the TMP gap signal? A large gap (>80 pts) is significant. Interpret the pillar breakdown — is one team winning against weak opponents (high A, low D) or consistently beating expectations (high B)?

2. MATCH CONTROL PATTERN (Box C): Teams with high C scores are resilient fighters. Teams with negative C scores collapse under pressure. How will this dynamic play out?

3. OPPONENT QUALITY FILTER (Box D): Strip away wins vs weak opponents. What does each team's record look like against mid-to-top opponents only?

4. HOME/AWAY CONTEXT: This team plays at home — do home/away splits match or contradict the overall form story?

5. GOALS ENVIRONMENT: Combine both teams' avg GF and GA, BTTS rate, Over 2.5 rate. What total goals environment does this matchup create?

6. VALUE VS CURRENT ODDS: If current odds are provided, does the statistical picture suggest the market has over or under-priced either side? A statistically stronger team priced shorter than their TMP warrants is bad value; one priced longer is good value.

7. RED FLAGS: Identify any data points that should prevent you from betting a market confidently (e.g. high variance, near-zero BTTS, wildly different competition levels in recent matches).

Output ONLY a valid JSON object. No markdown, no code blocks, no explanation outside the JSON:
{
  "summary": "3-sentence sharp overview integrating TMP scores and the most decisive statistical contrast",
  "tmpInterpretation": "1-2 sentences explaining what the TMP gap and pillar breakdown tells you about momentum quality",
  "homeTeamAnalysis": {
    "form": "trend description integrating TMP pillar insights",
    "strengths": ["specific stat-backed strength 1", "specific stat-backed strength 2"],
    "weaknesses": ["specific stat-backed weakness 1", "specific stat-backed weakness 2"],
    "keyTrend": "the single most predictively powerful trend for this match"
  },
  "awayTeamAnalysis": {
    "form": "trend description integrating TMP pillar insights",
    "strengths": ["specific stat-backed strength 1", "specific stat-backed strength 2"],
    "weaknesses": ["specific stat-backed weakness 1", "specific stat-backed weakness 2"],
    "keyTrend": "the single most predictively powerful trend for this match"
  },
  "predictions": [
    {
      "market": "Match Result (1X2)",
      "pick": "Home Win / Draw / Away Win",
      "confidence": 75,
      "reasoning": "detailed reasoning referencing TMP, form, opponent quality, and what could invalidate it"
    },
    {
      "market": "Goals Over/Under 2.5",
      "pick": "Over 2.5 / Under 2.5",
      "confidence": 70,
      "reasoning": "detailed reasoning referencing both teams' scoring/conceding and BTTS rates"
    },
    {
      "market": "Both Teams to Score",
      "pick": "Yes / No",
      "confidence": 65,
      "reasoning": "detailed reasoning"
    },
    {
      "market": "Double Chance",
      "pick": "1X / X2 / 12",
      "confidence": 80,
      "reasoning": "detailed reasoning"
    }
  ],
  "bestBet": {
    "market": "market name",
    "pick": "pick",
    "confidence": 82,
    "reasoning": "why this is the most statistically robust bet and what would invalidate it"
  },
  "riskFactors": ["specific risk 1 with data reasoning", "specific risk 2"],
  "dataConfidence": "High / Medium / Low"
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 6000,
      });

      const rawContent = response.choices[0]?.message?.content || "{}";

      let parsed: any;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("AI did not return valid JSON");
        }
      }

      res.json({
        analysis: parsed,
        dataStats: {
          homeMatchesAnalyzed: homeSummaries.length,
          awayMatchesAnalyzed: awaySummaries.length,
          homeStats,
          awayStats,
          homeTMP,
          awayTMP,
        },
      });
    } catch (error: any) {
      console.error("Error generating AI insight:", error.message);
      const message = String(error?.message || "");
      const isAuthError =
        error?.status === 401 ||
        message.toLowerCase().includes("api key") ||
        message.toLowerCase().includes("authorization");
      res.status(isAuthError ? 503 : 500).json({
        error: isAuthError
          ? "AI insight is not available right now. Please check the AI key and URL, then try again."
          : "AI insight could not be generated right now. Please try again.",
      });
    }
  });

  // ─── Simulation AI Chat — ask questions grounded in the per-fixture stats ─
  app.post("/api/event/:eventId/sim-chat", async (req: Request, res: Response) => {
    try {
      const { messages, simContext, homeTeamName, awayTeamName } = req.body as {
        messages: { role: "user" | "assistant"; content: string }[];
        simContext: any;
        homeTeamName: string;
        awayTeamName: string;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "messages array required" });
      }
      if (!simContext) {
        return res.status(400).json({ error: "simContext required" });
      }

      const contextJson = JSON.stringify(simContext, null, 2);

      const systemPrompt =
`You are an elite football match analyst embedded inside the Simulation tab of a fixture analysis app.
You have FULL access to the per-team statistical and behavioural profile of both teams below — last-15
role strengths, recent-form strengths, scoring & conceding patterns, GSRM behavioural patterns, SSBI
state-breakability, scoring patterns, **causal analysis** (why each result happened, repeatable vs
variance), hidden truths, matchup cross-references, and team match stats.

The fixture is: ${homeTeamName} (home) vs ${awayTeamName} (away).

────────────────────────── DATA CONTEXT ──────────────────────────
${contextJson}
──────────────────────────────────────────────────────────────────

Your job:
1. NEVER use surface averages alone. Always reason from the underlying CAUSE of each team's results.
2. Walk through your reasoning STEP BY STEP — factor by factor, effect by effect:
   • What kind of results has each team produced and WHY (defensive structure, tactical deadlock,
     finishing inefficiency, opponent class, variance, late drop-off, etc.)?
   • Which of those causes are REPEATABLE and which are VARIANCE (luck) — discount variance.
   • How does each team behave across game states (0-0, 1-0 up, 1-1, trailing, 2 ahead, 2 behind)?
   • How do their patterns COLLIDE — e.g. front-runner choker meets a comeback specialist, fast
     starters meet slow-to-wake defenders, leaky defence vs clinical attack, etc.
   • Opponent quality — a team destroying weak opposition may struggle vs relentless ones, and
     vice-versa. Adjust expectations accordingly.
   • Behavioural / psychological signals from the hidden truths (complacency, stage fright,
     bounce-back, post-loss reactions, travel mindset).
3. Produce a clear MATCH INSIGHT with the following sections:
   • Step-by-step reasoning for each team
   • Pattern collision (how the two profiles meet)
   • **Likely full-time scoreline** (give 2-3 most likely scorelines with reasoning)
   • **Match result lean** (Home / Draw / Away with confidence and why)
   • **First-half scoreline lean**
   • **Second-half scoreline lean**
   • **BTTS lean** (Yes / No with reasoning grounded in repeatable causes)
   • **Total goals lean** (Over/Under 2.5 with reasoning)
   • **Risk factors** (what would invalidate the read — e.g. variance regression, key injuries,
     game-state behaviour twist)
4. Be specific. Quote numbers, percentages, repeatability tags, and named patterns from the context.
   Do not invent stats — only use what is in the context.
5. If the user asks a follow-up question, answer it grounded in the context, citing the same
   underlying causes. Stay in plain analyst language — no jargon dumps.

Format with clear markdown headings (### for sections). Keep it punchy but thorough.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        max_completion_tokens: 6000,
      });

      const assistantText = response.choices[0]?.message?.content || "";
      res.json({ message: { role: "assistant", content: assistantText } });
    } catch (error: any) {
      console.error("sim-chat error:", error?.message);
      const msg = String(error?.message || "");
      const isAuth = error?.status === 401 || /api key|authorization/i.test(msg);
      res.status(isAuth ? 503 : 500).json({
        error: isAuth
          ? "AI chat is not available right now. Please check the AI key and try again."
          : "AI chat could not generate a response right now. Please try again.",
      });
    }
  });

  // ─── xG Engine: status ────────────────────────────────────────────────────
  app.get("/api/engine/status", (_req: Request, res: Response) => {
    try {
      res.json(engine.getStatus());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── xG Engine: train ─────────────────────────────────────────────────────
  let engineTrainingJob: { running: boolean; progress: number; message: string; error: string | null } = {
    running: false, progress: 0, message: "Idle", error: null
  };

  app.post("/api/engine/train", async (_req: Request, res: Response) => {
    if (engineTrainingJob.running) {
      return res.status(409).json({ error: "Training already in progress" });
    }
    engineTrainingJob = { running: true, progress: 0, message: "Starting...", error: null };
    res.json({ started: true });

    (async () => {
      try {
        await engine.train((pct, msg) => {
          engineTrainingJob.progress = pct;
          engineTrainingJob.message = msg;
        });
        engineTrainingJob.running = false;
        engineTrainingJob.progress = 100;
        engineTrainingJob.message = "Training complete!";
      } catch (err: any) {
        engineTrainingJob.running = false;
        engineTrainingJob.error = err.message;
        engineTrainingJob.message = "Training failed";
      }
    })();
  });

  app.get("/api/engine/training-progress", (_req: Request, res: Response) => {
    res.json(engineTrainingJob);
  });

  // ─── xG Engine: delete all saved models (fresh start) ────────────────────
  app.delete("/api/engine/models", (_req: Request, res: Response) => {
    try {
      db.prepare("DELETE FROM engine_models").run();
      engine.reset();
      res.json({ success: true, message: "All saved engine models cleared. Ready to retrain." });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── xG Engine: predict for stored match ──────────────────────────────────
  app.get("/api/engine/predict/:eventId", async (req: Request, res: Response) => {
    try {
      // Fail fast: no point fetching SofaScore data if there's no trained model
      if (!engine.isTrained()) {
        return res.status(400).json({ error: "Engine not trained. Train from the Engine tab first." });
      }

      const eventId = Number(req.params.eventId);

      // 1. Check DB for match metadata (scores, teams)
      const dbRow: any = db.prepare("SELECT * FROM match_simulations WHERE event_id = ?").get(eventId);

      // Resolve team IDs from query params or DB row
      const homeTeamId = Number(req.query.homeTeamId) || dbRow?.home_team_id;
      const awayTeamId = Number(req.query.awayTeamId) || dbRow?.away_team_id;
      const homeTeamName = String(req.query.homeTeamName || dbRow?.home_team_name || "Home");
      const awayTeamName = String(req.query.awayTeamName || dbRow?.away_team_name || "Away");

      let row: any = null;

      // 2. Always build feature row from fresh simulation data when team IDs are available
      if (homeTeamId && awayTeamId) {
        // Fetch team stats via the player-simulation endpoint
        const serverPort = process.env.PORT || 5000;
        const baseUrl = `http://localhost:${serverPort}`;
        const simRes = await fetch(
          `${baseUrl}/api/event/${eventId}/player-simulation?homeTeamId=${homeTeamId}&awayTeamId=${awayTeamId}`,
          { signal: AbortSignal.timeout(8000) }
        );

        if (!simRes.ok) {
          // Sim data unavailable — will fall back to DB row below
          console.warn(`[engine/predict] sim fetch failed (${simRes.status}) — falling back to DB row`);
        } else {

        const sim: any = await simRes.json();
        const h = sim.home;
        const a = sim.away;
        const hStats    = h?.teamMatchStats?.all;
        const hStats1h  = h?.teamMatchStats?.firstHalf;
        const hStats2h  = h?.teamMatchStats?.secondHalf;
        const aStats    = a?.teamMatchStats?.all;
        const aStats1h  = a?.teamMatchStats?.firstHalf;
        const aStats2h  = a?.teamMatchStats?.secondHalf;
        const hPhase    = h?.phaseStrengths;
        const aPhase    = a?.phaseStrengths;
        const hForm     = h?.formSummary;
        const aForm     = a?.formSummary;

        // Build a synthetic feature row matching ALL 92 engine features
        row = {
          event_id: eventId,
          home_team_id: homeTeamId,
          home_team_name: homeTeamName,
          away_team_id: awayTeamId,
          away_team_name: awayTeamName,
          home_goals: null,
          away_goals: null,
          result: null,
          match_date: new Date().toISOString().slice(0, 10),
          tournament: String(req.query.tournamentName || dbRow?.tournament || ""),
          country:    String(req.query.country    || dbRow?.country    || ""),

          // ── Home full-match averages ──────────────────────────────────────
          home_avg_xg:                  hStats?.avgXg                  ?? null,
          home_avg_goals_scored:        hStats?.avgGoalsScored          ?? null,
          home_avg_goals_conceded:      hStats?.avgGoalsConceded        ?? null,
          home_avg_big_chances:         hStats?.avgBigChances           ?? null,
          home_avg_big_chances_scored:  hStats?.avgBigChancesScored     ?? null,
          home_avg_big_chances_missed:  hStats?.avgBigChancesMissed     ?? null,
          home_avg_total_shots:         hStats?.avgTotalShots           ?? null,
          home_avg_shots_on_target:     hStats?.avgShotsOnTarget        ?? null,
          home_avg_shots_off_target:    hStats?.avgShotsOffTarget       ?? null,
          home_avg_blocked_shots:       hStats?.avgBlockedShots         ?? null,
          home_avg_shots_inside_box:    hStats?.avgShotsInsideBox       ?? null,
          home_avg_possession:          hStats?.avgPossession           ?? null,
          home_avg_pass_accuracy:       hStats?.avgPassAccuracy         ?? null,
          home_avg_total_passes:        hStats?.avgTotalPasses          ?? null,
          home_avg_corner_kicks:        hStats?.avgCornerKicks          ?? null,
          home_avg_fouls:               hStats?.avgFouls                ?? null,
          home_avg_duels_won:           hStats?.avgDuelsWon             ?? null,
          home_avg_tackles_won:         hStats?.avgTacklesWon           ?? null,
          home_avg_interceptions:       hStats?.avgInterceptions        ?? null,
          home_avg_clearances:          hStats?.avgClearances           ?? null,
          home_avg_goalkeeper_saves:    hStats?.avgGoalkeeperSaves      ?? null,
          home_avg_goals_prevented:     hStats?.avgGoalsPrevented       ?? null,

          // ── Home role strengths ───────────────────────────────────────────
          home_phase_attack:            hPhase?.attackStrength          ?? null,
          home_phase_defensive:         hPhase?.defensiveStrength       ?? null,
          home_phase_midfield:          hPhase?.midfieldStrength        ?? null,
          home_phase_keeper:            hPhase?.keeperStrength          ?? null,
          home_phase_fullback:          hPhase?.fullbackStrength        ?? null,

          // ── Home form (last 7) ────────────────────────────────────────────
          home_form_strength:           h?.formStrength                 ?? null,
          home_scoring_strength:        h?.scoringStrength              ?? null,
          home_defending_strength:      h?.defendingStrength            ?? null,
          home_form_points:             hForm?.formPoints               ?? h?.formPoints ?? null,
          home_clean_sheets:            hForm?.cleanSheets              ?? null,

          // ── Home 1st-half averages ────────────────────────────────────────
          home_h1_avg_xg:               hStats1h?.avgXg                 ?? null,
          home_h1_avg_goals_scored:     hStats1h?.avgGoalsScored        ?? null,
          home_h1_avg_goals_conceded:   hStats1h?.avgGoalsConceded      ?? null,
          home_h1_avg_big_chances:      hStats1h?.avgBigChances         ?? null,
          home_h1_avg_total_shots:      hStats1h?.avgTotalShots         ?? null,
          home_h1_avg_possession:       hStats1h?.avgPossession         ?? null,
          home_h1_avg_pass_accuracy:    hStats1h?.avgPassAccuracy       ?? null,

          // ── Home 2nd-half averages ────────────────────────────────────────
          home_h2_avg_xg:               hStats2h?.avgXg                 ?? null,
          home_h2_avg_goals_scored:     hStats2h?.avgGoalsScored        ?? null,
          home_h2_avg_goals_conceded:   hStats2h?.avgGoalsConceded      ?? null,
          home_h2_avg_big_chances:      hStats2h?.avgBigChances         ?? null,
          home_h2_avg_total_shots:      hStats2h?.avgTotalShots         ?? null,
          home_h2_avg_possession:       hStats2h?.avgPossession         ?? null,
          home_h2_avg_pass_accuracy:    hStats2h?.avgPassAccuracy       ?? null,

          // ── Away full-match averages ──────────────────────────────────────
          away_avg_xg:                  aStats?.avgXg                   ?? null,
          away_avg_goals_scored:        aStats?.avgGoalsScored          ?? null,
          away_avg_goals_conceded:      aStats?.avgGoalsConceded        ?? null,
          away_avg_big_chances:         aStats?.avgBigChances           ?? null,
          away_avg_big_chances_scored:  aStats?.avgBigChancesScored     ?? null,
          away_avg_big_chances_missed:  aStats?.avgBigChancesMissed     ?? null,
          away_avg_total_shots:         aStats?.avgTotalShots           ?? null,
          away_avg_shots_on_target:     aStats?.avgShotsOnTarget        ?? null,
          away_avg_shots_off_target:    aStats?.avgShotsOffTarget       ?? null,
          away_avg_blocked_shots:       aStats?.avgBlockedShots         ?? null,
          away_avg_shots_inside_box:    aStats?.avgShotsInsideBox       ?? null,
          away_avg_possession:          aStats?.avgPossession           ?? null,
          away_avg_pass_accuracy:       aStats?.avgPassAccuracy         ?? null,
          away_avg_total_passes:        aStats?.avgTotalPasses          ?? null,
          away_avg_corner_kicks:        aStats?.avgCornerKicks          ?? null,
          away_avg_fouls:               aStats?.avgFouls                ?? null,
          away_avg_duels_won:           aStats?.avgDuelsWon             ?? null,
          away_avg_tackles_won:         aStats?.avgTacklesWon           ?? null,
          away_avg_interceptions:       aStats?.avgInterceptions        ?? null,
          away_avg_clearances:          aStats?.avgClearances           ?? null,
          away_avg_goalkeeper_saves:    aStats?.avgGoalkeeperSaves      ?? null,
          away_avg_goals_prevented:     aStats?.avgGoalsPrevented       ?? null,

          // ── Away role strengths ───────────────────────────────────────────
          away_phase_attack:            aPhase?.attackStrength          ?? null,
          away_phase_defensive:         aPhase?.defensiveStrength       ?? null,
          away_phase_midfield:          aPhase?.midfieldStrength        ?? null,
          away_phase_keeper:            aPhase?.keeperStrength          ?? null,
          away_phase_fullback:          aPhase?.fullbackStrength        ?? null,

          // ── Away form (last 7) ────────────────────────────────────────────
          away_form_strength:           a?.formStrength                 ?? null,
          away_scoring_strength:        a?.scoringStrength              ?? null,
          away_defending_strength:      a?.defendingStrength            ?? null,
          away_form_points:             aForm?.formPoints               ?? a?.formPoints ?? null,
          away_clean_sheets:            aForm?.cleanSheets              ?? null,

          // ── Away 1st-half averages ────────────────────────────────────────
          away_h1_avg_xg:               aStats1h?.avgXg                 ?? null,
          away_h1_avg_goals_scored:     aStats1h?.avgGoalsScored        ?? null,
          away_h1_avg_goals_conceded:   aStats1h?.avgGoalsConceded      ?? null,
          away_h1_avg_big_chances:      aStats1h?.avgBigChances         ?? null,
          away_h1_avg_total_shots:      aStats1h?.avgTotalShots         ?? null,
          away_h1_avg_possession:       aStats1h?.avgPossession         ?? null,
          away_h1_avg_pass_accuracy:    aStats1h?.avgPassAccuracy       ?? null,

          // ── Away 2nd-half averages ────────────────────────────────────────
          away_h2_avg_xg:               aStats2h?.avgXg                 ?? null,
          away_h2_avg_goals_scored:     aStats2h?.avgGoalsScored        ?? null,
          away_h2_avg_goals_conceded:   aStats2h?.avgGoalsConceded      ?? null,
          away_h2_avg_big_chances:      aStats2h?.avgBigChances         ?? null,
          away_h2_avg_total_shots:      aStats2h?.avgTotalShots         ?? null,
          away_h2_avg_possession:       aStats2h?.avgPossession         ?? null,
          away_h2_avg_pass_accuracy:    aStats2h?.avgPassAccuracy       ?? null,

          // ── GSRM (Game State Resilience Metrics) ──────────────────────────
          home_gsrm_ecri:               sim.home?.gsrm?.ecri            ?? null,
          away_gsrm_ecri:               sim.away?.gsrm?.ecri            ?? null,
          home_gsrm_eri:                sim.home?.gsrm?.eri             ?? null,
          away_gsrm_eri:                sim.away?.gsrm?.eri             ?? null,
          home_gsrm_tgbi:               sim.home?.gsrm?.tgbi            ?? null,
          away_gsrm_tgbi:               sim.away?.gsrm?.tgbi            ?? null,
          home_gsrm_frqi:               sim.home?.gsrm?.frqi            ?? null,
          away_gsrm_frqi:               sim.away?.gsrm?.frqi            ?? null,

          // ── SSBI (Score State Breakability Index) ─────────────────────────
          home_ssbi_zzb:                sim.home?.ssbi?.zzb             ?? null,
          away_ssbi_zzb:                sim.away?.ssbi?.zzb             ?? null,
          home_ssbi_lbr:                sim.home?.ssbi?.lbr             ?? null,
          away_ssbi_lbr:                sim.away?.ssbi?.lbr             ?? null,
          home_ssbi_ddi:                sim.home?.ssbi?.ddi             ?? null,
          away_ssbi_ddi:                sim.away?.ssbi?.ddi             ?? null,
        };

        // Merge real scores / result from DB row if this match has been played
        if (dbRow) {
          row.home_goals    = dbRow.home_goals    ?? null;
          row.away_goals    = dbRow.away_goals    ?? null;
          row.home_ht_goals = dbRow.home_ht_goals ?? null;
          row.away_ht_goals = dbRow.away_ht_goals ?? null;
          row.result        = dbRow.result        ?? null;
          row.tournament    = dbRow.tournament    || row.tournament;
          row.match_date    = dbRow.match_date    || row.match_date;
        }
        } // close else (sim ok)
      } // close if (homeTeamId && awayTeamId)

      // 3. Fall back to DB row if fresh sim was unavailable
      if (!row && dbRow) row = dbRow;

      if (!row) {
        return res.status(404).json({
          error: "Match not found. Provide homeTeamId and awayTeamId to predict for upcoming matches.",
        });
      }

      const prediction = await engine.predictFromRow(row);
      res.json({
        prediction,
        matchInfo: {
          homeTeam: row.home_team_name,
          awayTeam: row.away_team_name,
          homeGoals: row.home_goals ?? null,
          awayGoals: row.away_goals ?? null,
          result: row.result ?? null,
          matchDate: row.match_date,
          tournament: row.tournament,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── xG Engine: predict from raw simulation features ──────────────────────
  app.post("/api/engine/predict-features", async (req: Request, res: Response) => {
    try {
      const features = req.body as Record<string, any>;
      const prediction = await engine.predictFromRow(features);
      res.json({ prediction });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Database: list stored matches ────────────────────────────────────────
  app.get("/api/database/matches", (req: Request, res: Response) => {
    try {
      const { search, date, sport, limit = "100", offset = "0" } = req.query as Record<string, string>;
      let query = "SELECT * FROM match_simulations WHERE 1=1";
      const params: any[] = [];
      if (search) {
        query += " AND (home_team_name LIKE ? OR away_team_name LIKE ? OR tournament LIKE ?)";
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (date) {
        query += " AND match_date = ?";
        params.push(date);
      }
      if (sport) {
        query += " AND sport = ?";
        params.push(sport);
      }
      query += " ORDER BY processed_at DESC LIMIT ? OFFSET ?";
      params.push(Number(limit), Number(offset));
      const rows = db.prepare(query).all(...params);
      const countQuery = query.replace(/SELECT \*/, "SELECT COUNT(*) as total").replace(/ORDER BY.*/, "");
      const total = (db.prepare(countQuery).get(...params.slice(0, -2)) as any)?.total ?? 0;
      res.json({ matches: rows, total });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Database: delete a match ─────────────────────────────────────────────
  app.delete("/api/database/match/:eventId", (req: Request, res: Response) => {
    try {
      const info = db.prepare("DELETE FROM match_simulations WHERE event_id = ?").run(Number(req.params.eventId));
      if (info.changes === 0) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Database: clear all records ──────────────────────────────────────────
  app.delete("/api/database/clear-all", (_req: Request, res: Response) => {
    try {
      const info = db.prepare("DELETE FROM match_simulations").run();
      res.json({ success: true, deleted: info.changes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Database: stats summary ─────────────────────────────────────────────
  app.get("/api/database/stats", (_req: Request, res: Response) => {
    try {
      const total = (db.prepare("SELECT COUNT(*) as c FROM match_simulations").get() as any)?.c ?? 0;
      const byResult = db.prepare("SELECT result, COUNT(*) as c FROM match_simulations GROUP BY result").all();
      res.json({ total, byResult });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Processing: start job ────────────────────────────────────────────────
  app.post("/api/database/process-date", async (req: Request, res: Response) => {
    try {
      const { date, sport = "football" } = req.body as { date: string; sport?: string };
      if (!date) return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });

      const sofaDate = date;
      const eventsData = await fetchSofaScore(`/sport/${sport}/scheduled-events/${sofaDate}`);
      const allEvents: any[] = eventsData?.events || [];

      // SofaScore returns events across multiple dates (adjacent days due to timezones).
      // Only process events that actually fall on the selected date based on their startTimestamp.
      const finishedEvents = allEvents.filter((e: any) => {
        const type = e.status?.type;
        if (type !== "finished") return false;
        // Verify the event's actual date matches the selected date
        if (e.startTimestamp) {
          const eventDate = new Date(e.startTimestamp * 1000).toISOString().slice(0, 10);
          if (eventDate !== date) return false;
        }
        return true;
      });

      if (finishedEvents.length === 0) {
        return res.json({ jobId: null, message: "No finished matches found for this date", total: 0 });
      }

      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const job: ProcessingJob = {
        id: jobId,
        status: "running",
        total: finishedEvents.length,
        processed: 0,
        stored: 0,
        skipped: 0,
        failed: 0,
        log: [],
        cancelRequested: false,
      };
      jobs.set(jobId, job);

      const serverPort = process.env.PORT || 5000;
      const baseUrl = `http://localhost:${serverPort}`;

      (async () => {
        for (const event of finishedEvents) {
          if (job.cancelRequested) {
            job.status = "cancelled";
            break;
          }

          const eventId = event.id;
          const homeTeamId = event.homeTeam?.id;
          const awayTeamId = event.awayTeam?.id;
          const homeTeamName = event.homeTeam?.name || event.homeTeam?.shortName || "Unknown";
          const awayTeamName = event.awayTeam?.name || event.awayTeam?.shortName || "Unknown";
          const tournament = event.tournament?.uniqueTournament?.name || event.tournament?.name || "";
          const country = event.tournament?.category?.name || event.tournament?.uniqueTournament?.category?.name || "";
          const startTimestamp = event.startTimestamp;
          const matchDate = date;

          // Skip if already stored
          const existing = db.prepare("SELECT id FROM match_simulations WHERE event_id = ?").get(eventId);
          if (existing) {
            job.skipped++;
            job.processed++;
            job.log.push(`⏭ Skipped (already stored): ${homeTeamName} vs ${awayTeamName}`);
            continue;
          }

          const homeScore = event.homeScore?.current ?? event.homeScore?.display ?? null;
          const awayScore = event.awayScore?.current ?? event.awayScore?.display ?? null;
          if (homeScore === null || awayScore === null) {
            job.skipped++;
            job.processed++;
            job.log.push(`⏭ Skipped (no score): ${homeTeamName} vs ${awayTeamName}`);
            continue;
          }

          const hGoals = Number(homeScore);
          const aGoals = Number(awayScore);
          const result = hGoals > aGoals ? "H" : hGoals === aGoals ? "D" : "A";

          // Halftime scores
          const hHtGoals = event.homeScore?.period1 != null ? Number(event.homeScore.period1) : null;
          const aHtGoals = event.awayScore?.period1 != null ? Number(event.awayScore.period1) : null;

          try {
            // Anti-blocking: 2.5s delay between each match
            await sleep(2500);

            const simRes = await fetch(
              `${baseUrl}/api/event/${eventId}/player-simulation?homeTeamId=${homeTeamId}&awayTeamId=${awayTeamId}`,
              { signal: AbortSignal.timeout(60000) }
            );

            if (!simRes.ok) {
              throw new Error(`Simulation HTTP ${simRes.status}`);
            }

            const sim: any = await simRes.json();
            const h = sim.home;
            const a = sim.away;
            const hStats = h?.teamMatchStats?.all;
            const hStats1h = h?.teamMatchStats?.firstHalf;
            const hStats2h = h?.teamMatchStats?.secondHalf;
            const aStats = a?.teamMatchStats?.all;
            const aStats1h = a?.teamMatchStats?.firstHalf;
            const aStats2h = a?.teamMatchStats?.secondHalf;
            const hPhase = h?.phaseStrengths;
            const aPhase = a?.phaseStrengths;
            const hForm = h?.formSummary;
            const aForm = a?.formSummary;

            // ── Incomplete data check ────────────────────────────────────────
            // Require the full-match AND per-half key stats to be present for
            // both teams. We test actual averages that will be stored — if any
            // critical field is null the row is display-useless (shows "—").
            // Full-match: xG + possession + total shots (all required)
            // Per-half:   possession + total shots (xG is absent for many leagues;
            //             pass accuracy can be absent too — only poss+shots checked)
            const missingStats: string[] = [];
            if (hStats?.avgXg == null)            missingStats.push(`${homeTeamName} full-match xG`);
            if (hStats?.avgPossession == null)     missingStats.push(`${homeTeamName} full-match possession`);
            if (hStats?.avgTotalShots == null)     missingStats.push(`${homeTeamName} full-match shots`);
            if (aStats?.avgXg == null)            missingStats.push(`${awayTeamName} full-match xG`);
            if (aStats?.avgPossession == null)     missingStats.push(`${awayTeamName} full-match possession`);
            if (aStats?.avgTotalShots == null)     missingStats.push(`${awayTeamName} full-match shots`);
            if (hStats1h?.avgPossession == null)   missingStats.push(`${homeTeamName} 1H possession`);
            if (hStats1h?.avgTotalShots == null)   missingStats.push(`${homeTeamName} 1H shots`);
            if (hStats2h?.avgPossession == null)   missingStats.push(`${homeTeamName} 2H possession`);
            if (hStats2h?.avgTotalShots == null)   missingStats.push(`${homeTeamName} 2H shots`);
            if (aStats1h?.avgPossession == null)   missingStats.push(`${awayTeamName} 1H possession`);
            if (aStats1h?.avgTotalShots == null)   missingStats.push(`${awayTeamName} 1H shots`);
            if (aStats2h?.avgPossession == null)   missingStats.push(`${awayTeamName} 2H possession`);
            if (aStats2h?.avgTotalShots == null)   missingStats.push(`${awayTeamName} 2H shots`);
            if (missingStats.length > 0) {
              job.skipped++;
              job.processed++;
              job.log.push(`⏭ Skipped (incomplete stats — missing: ${missingStats.slice(0, 3).join(", ")}${missingStats.length > 3 ? ` +${missingStats.length - 3} more` : ""}): ${homeTeamName} vs ${awayTeamName}`);
              continue;
            }

            // ── Injury / suspension data ─────────────────────────────────────
            const hInjured = JSON.stringify(h?.injuredPlayers ?? []);
            const aSuspended = JSON.stringify(a?.suspendedPlayers ?? []);
            const hSuspended = JSON.stringify(h?.suspendedPlayers ?? []);
            const aInjured = JSON.stringify(a?.injuredPlayers ?? []);
            const hInjuryImpact = h?.injuryImpact ?? 0;
            const aInjuryImpact = a?.injuryImpact ?? 0;

            // GSRM metrics
            const hGsrmEcri = sim.home?.gsrm?.ecri ?? null;
            const aGsrmEcri = sim.away?.gsrm?.ecri ?? null;
            const hGsrmEri  = sim.home?.gsrm?.eri  ?? null;
            const aGsrmEri  = sim.away?.gsrm?.eri  ?? null;
            const hGsrmTgbi = sim.home?.gsrm?.tgbi ?? null;
            const aGsrmTgbi = sim.away?.gsrm?.tgbi ?? null;
            const hGsrmFrqi = sim.home?.gsrm?.frqi ?? null;
            const aGsrmFrqi = sim.away?.gsrm?.frqi ?? null;
            // SSBI metrics
            const hSsbiZzb = sim.home?.ssbi?.zzb ?? null;
            const aSsbiZzb = sim.away?.ssbi?.zzb ?? null;
            const hSsbiLbr = sim.home?.ssbi?.lbr ?? null;
            const aSsbiLbr = sim.away?.ssbi?.lbr ?? null;
            const hSsbiDdi = sim.home?.ssbi?.ddi ?? null;
            const aSsbiDdi = sim.away?.ssbi?.ddi ?? null;

            db.prepare(`
              INSERT OR REPLACE INTO match_simulations (
                event_id, home_team_id, home_team_name, away_team_id, away_team_name,
                tournament, country, sport, match_date, start_timestamp,
                home_goals, away_goals, result,
                home_phase_defensive, home_phase_attack, home_phase_midfield, home_phase_keeper, home_phase_fullback,
                home_form_strength, home_scoring_strength, home_defending_strength,
                home_form_points, home_goals_for, home_goals_against, home_clean_sheets, home_recent_form,
                home_avg_goals_scored, home_avg_goals_conceded, home_avg_xg, home_avg_possession,
                home_avg_big_chances, home_avg_total_shots, home_avg_shots_on_target, home_avg_shots_off_target,
                home_avg_blocked_shots, home_avg_shots_inside_box, home_avg_big_chances_scored, home_avg_big_chances_missed,
                home_avg_corner_kicks, home_avg_fouls, home_avg_total_passes, home_avg_pass_accuracy,
                home_avg_duels_won, home_avg_tackles_won, home_avg_interceptions, home_avg_clearances,
                home_avg_goalkeeper_saves, home_avg_goals_prevented, home_matches_analyzed,
                away_phase_defensive, away_phase_attack, away_phase_midfield, away_phase_keeper, away_phase_fullback,
                away_form_strength, away_scoring_strength, away_defending_strength,
                away_form_points, away_goals_for, away_goals_against, away_clean_sheets, away_recent_form,
                away_avg_goals_scored, away_avg_goals_conceded, away_avg_xg, away_avg_possession,
                away_avg_big_chances, away_avg_total_shots, away_avg_shots_on_target, away_avg_shots_off_target,
                away_avg_blocked_shots, away_avg_shots_inside_box, away_avg_big_chances_scored, away_avg_big_chances_missed,
                away_avg_corner_kicks, away_avg_fouls, away_avg_total_passes, away_avg_pass_accuracy,
                away_avg_duels_won, away_avg_tackles_won, away_avg_interceptions, away_avg_clearances,
                away_avg_goalkeeper_saves, away_avg_goals_prevented, away_matches_analyzed,
                home_ht_goals, away_ht_goals,
                home_h1_avg_goals_scored, home_h1_avg_goals_conceded, home_h1_avg_xg, home_h1_avg_possession, home_h1_avg_big_chances, home_h1_avg_total_shots, home_h1_avg_pass_accuracy, home_h1_avg_total_passes,
                home_h2_avg_goals_scored, home_h2_avg_goals_conceded, home_h2_avg_xg, home_h2_avg_possession, home_h2_avg_big_chances, home_h2_avg_total_shots, home_h2_avg_pass_accuracy, home_h2_avg_total_passes,
                away_h1_avg_goals_scored, away_h1_avg_goals_conceded, away_h1_avg_xg, away_h1_avg_possession, away_h1_avg_big_chances, away_h1_avg_total_shots, away_h1_avg_pass_accuracy, away_h1_avg_total_passes,
                away_h2_avg_goals_scored, away_h2_avg_goals_conceded, away_h2_avg_xg, away_h2_avg_possession, away_h2_avg_big_chances, away_h2_avg_total_shots, away_h2_avg_pass_accuracy, away_h2_avg_total_passes,
                processed_at,
                home_injured_players, away_injured_players,
                home_suspended_players, away_suspended_players,
                home_injury_impact, away_injury_impact,
                home_gsrm_ecri, away_gsrm_ecri,
                home_gsrm_eri,  away_gsrm_eri,
                home_gsrm_tgbi, away_gsrm_tgbi,
                home_gsrm_frqi, away_gsrm_frqi,
                home_ssbi_zzb, away_ssbi_zzb,
                home_ssbi_lbr, away_ssbi_lbr,
                home_ssbi_ddi, away_ssbi_ddi
              ) VALUES (
                ?,?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,
                ?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?
              )
            `).run(
              eventId, homeTeamId, homeTeamName, awayTeamId, awayTeamName,
              tournament, country, sport, matchDate, startTimestamp,
              hGoals, aGoals, result,
              hPhase?.defensiveStrength ?? null, hPhase?.attackStrength ?? null, hPhase?.midfieldStrength ?? null, hPhase?.keeperStrength ?? null, hPhase?.fullbackStrength ?? null,
              h?.formStrength ?? null, h?.scoringStrength ?? null, h?.defendingStrength ?? null,
              hForm?.formPoints ?? null, hForm?.goalsFor ?? null, hForm?.goalsAgainst ?? null, hForm?.cleanSheets ?? null,
              (hForm?.recentForm || []).join(" ") || null,
              hStats?.avgGoalsScored ?? null, hStats?.avgGoalsConceded ?? null, hStats?.avgXg ?? null, hStats?.avgPossession ?? null,
              hStats?.avgBigChances ?? null, hStats?.avgTotalShots ?? null, hStats?.avgShotsOnTarget ?? null, hStats?.avgShotsOffTarget ?? null,
              hStats?.avgBlockedShots ?? null, hStats?.avgShotsInsideBox ?? null, hStats?.avgBigChancesScored ?? null, hStats?.avgBigChancesMissed ?? null,
              hStats?.avgCornerKicks ?? null, hStats?.avgFouls ?? null, hStats?.avgTotalPasses ?? null, hStats?.avgPassAccuracy ?? null,
              hStats?.avgDuelsWon ?? null, hStats?.avgTacklesWon ?? null, hStats?.avgInterceptions ?? null, hStats?.avgClearances ?? null,
              hStats?.avgGoalkeeperSaves ?? null, hStats?.avgGoalsPrevented ?? null, h?.matchesAnalyzed ?? null,
              aPhase?.defensiveStrength ?? null, aPhase?.attackStrength ?? null, aPhase?.midfieldStrength ?? null, aPhase?.keeperStrength ?? null, aPhase?.fullbackStrength ?? null,
              a?.formStrength ?? null, a?.scoringStrength ?? null, a?.defendingStrength ?? null,
              aForm?.formPoints ?? null, aForm?.goalsFor ?? null, aForm?.goalsAgainst ?? null, aForm?.cleanSheets ?? null,
              (aForm?.recentForm || []).join(" ") || null,
              aStats?.avgGoalsScored ?? null, aStats?.avgGoalsConceded ?? null, aStats?.avgXg ?? null, aStats?.avgPossession ?? null,
              aStats?.avgBigChances ?? null, aStats?.avgTotalShots ?? null, aStats?.avgShotsOnTarget ?? null, aStats?.avgShotsOffTarget ?? null,
              aStats?.avgBlockedShots ?? null, aStats?.avgShotsInsideBox ?? null, aStats?.avgBigChancesScored ?? null, aStats?.avgBigChancesMissed ?? null,
              aStats?.avgCornerKicks ?? null, aStats?.avgFouls ?? null, aStats?.avgTotalPasses ?? null, aStats?.avgPassAccuracy ?? null,
              aStats?.avgDuelsWon ?? null, aStats?.avgTacklesWon ?? null, aStats?.avgInterceptions ?? null, aStats?.avgClearances ?? null,
              aStats?.avgGoalkeeperSaves ?? null, aStats?.avgGoalsPrevented ?? null, a?.matchesAnalyzed ?? null,
              hHtGoals, aHtGoals,
              hStats1h?.avgGoalsScored ?? null, hStats1h?.avgGoalsConceded ?? null, hStats1h?.avgXg ?? null, hStats1h?.avgPossession ?? null, hStats1h?.avgBigChances ?? null, hStats1h?.avgTotalShots ?? null, hStats1h?.avgPassAccuracy ?? null, hStats1h?.avgTotalPasses ?? null,
              hStats2h?.avgGoalsScored ?? null, hStats2h?.avgGoalsConceded ?? null, hStats2h?.avgXg ?? null, hStats2h?.avgPossession ?? null, hStats2h?.avgBigChances ?? null, hStats2h?.avgTotalShots ?? null, hStats2h?.avgPassAccuracy ?? null, hStats2h?.avgTotalPasses ?? null,
              aStats1h?.avgGoalsScored ?? null, aStats1h?.avgGoalsConceded ?? null, aStats1h?.avgXg ?? null, aStats1h?.avgPossession ?? null, aStats1h?.avgBigChances ?? null, aStats1h?.avgTotalShots ?? null, aStats1h?.avgPassAccuracy ?? null, aStats1h?.avgTotalPasses ?? null,
              aStats2h?.avgGoalsScored ?? null, aStats2h?.avgGoalsConceded ?? null, aStats2h?.avgXg ?? null, aStats2h?.avgPossession ?? null, aStats2h?.avgBigChances ?? null, aStats2h?.avgTotalShots ?? null, aStats2h?.avgPassAccuracy ?? null, aStats2h?.avgTotalPasses ?? null,
              new Date().toISOString(),
              hInjured, aInjured,
              hSuspended, aSuspended,
              hInjuryImpact, aInjuryImpact,
              hGsrmEcri, aGsrmEcri,
              hGsrmEri,  aGsrmEri,
              hGsrmTgbi, aGsrmTgbi,
              hGsrmFrqi, aGsrmFrqi,
              hSsbiZzb, aSsbiZzb,
              hSsbiLbr, aSsbiLbr,
              hSsbiDdi, aSsbiDdi,
            );

            job.stored++;
            const hKeyMissing = [...(h?.injuredPlayers ?? []), ...(h?.suspendedPlayers ?? [])].filter((p: any) => p.isKeyPlayer).length;
            const aKeyMissing = [...(a?.injuredPlayers ?? []), ...(a?.suspendedPlayers ?? [])].filter((p: any) => p.isKeyPlayer).length;
            const injuryNote = (hKeyMissing > 0 || aKeyMissing > 0)
              ? ` | 🚑 Key absences: H${hKeyMissing} A${aKeyMissing}`
              : "";
            job.log.push(`✅ Stored: ${homeTeamName} ${hGoals}-${aGoals} ${awayTeamName} (${tournament})${injuryNote}`);
          } catch (err: any) {
            job.failed++;
            job.log.push(`❌ Failed: ${homeTeamName} vs ${awayTeamName} — ${err.message}`);
          }

          job.processed++;
        }

        if (job.status !== "cancelled") job.status = "completed";
      })();

      res.json({ jobId, total: finishedEvents.length });
    } catch (error: any) {
      console.error("Process-date error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Processing: poll job status ──────────────────────────────────────────
  app.get("/api/database/job/:jobId", (req: Request, res: Response) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  });

  // ─── Processing: cancel job ───────────────────────────────────────────────
  app.post("/api/database/job/:jobId/cancel", (req: Request, res: Response) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    job.cancelRequested = true;
    res.json({ success: true });
  });

  const httpServer = createServer(app);
  return httpServer;
}
