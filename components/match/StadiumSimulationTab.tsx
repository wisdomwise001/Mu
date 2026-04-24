import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
  TouchableOpacity,
} from "react-native";
import { TextInput } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";

interface PlayerData {
  player: { shortName?: string; id?: number; name?: string };
  position?: string;
  substitute?: boolean;
  jerseyNumber?: number;
  simulationMetrics?: PlayerMetrics | null;
  likelyLineupReason?: string;
}

interface LineupTeam {
  formation?: string;
  players?: PlayerData[];
}

interface LineupsResponse {
  home?: LineupTeam;
  away?: LineupTeam;
  confirmed?: boolean;
}

interface StadiumSimulationTabProps {
  eventId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamId: number;
  awayTeamId: number;
  venue?: string;
  city?: string;
}

interface FormationRow {
  key: string;
  players: PlayerData[];
}

interface PlayerMetrics {
  overall: number | null;
  experience: number | null;
  decision: number | null;
  intelligence: number | null;
  performance: number | null;
  defensiveStrength: number | null;
  attackStrength: number | null;
  midfieldStrength: number | null;
  keeperStrength: number | null;
  fullbackStrength: number | null;
  appearances: number;
  starts: number;
  averageRating: number | null;
  statSamples: number;
  dataConfidence: "High" | "Medium" | "Low" | "Unavailable";
}

interface PhaseStrengths {
  defensiveStrength: number | null;
  attackStrength: number | null;
  midfieldStrength: number | null;
  keeperStrength: number | null;
  fullbackStrength: number | null;
}

interface FormSummary {
  formStrength: number | null;
  scoringStrength: number | null;
  defendingStrength: number | null;
  formPoints: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  matches: number;
  recentForm: ("W" | "D" | "L")[];
}

interface GSRM {
  ecri: number | null;
  eri: number | null;
  tgbi: number | null;
  frqi: number | null;
  ecriMatches: number;
  eriMatches: number;
  tgbiMatches: number;
  frqiMatches: number;
}

interface SSBIBreaker {
  playerId: number;
  name: string;
  zzbGoals: number;
  ddiGoals: number;
  total: number;
  available: boolean | null;
}

interface SSBI {
  zzb: number | null;
  zzbMatches: number;
  lbr: number | null;
  lbrMatches: number;
  ddi: number | null;
  ddiMatches: number;
  keyBreakers: SSBIBreaker[];
}

interface ScoringBucket {
  label: string;
  scored: number;
  conceded: number;
  scoredPct: number;
  concededPct: number;
}

type MatchNarrative =
  | "unluckyLoss" | "wastedDominance" | "luckyWin" | "smashAndGrab"
  | "dominantWin" | "exploitedWeakDef" | "outclassed" | "comeback"
  | "blewLead" | "openTradeoff" | "lateShow" | "fastStart" | "deadlock";

interface MatchStory {
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
  narratives: MatchNarrative[];
  oneLine: string;
}

interface RecurringPattern {
  key: string;
  label: string;
  count: number;
  total: number;
  evidence: string;
}

interface ScoringPatterns {
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
}

type CausalCause =
  | "DefensiveStructure" | "TacticalDeadlock" | "AttackingDominance"
  | "ClinicalFinishing" | "FinishingInefficiency" | "OpponentWastefulness"
  | "DefensiveCollapse" | "LateDropOff" | "EarlyShock"
  | "GameStateControl" | "OpponentClass";

type Repeatability = "repeatable" | "variance" | "mixed";

interface CausalMatch {
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
}

interface CausalProfile {
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
}

interface PeriodStats {
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
}

interface TeamMatchStats {
  all: PeriodStats;
  firstHalf: PeriodStats;
  secondHalf: PeriodStats;
  matchesAnalyzed: number;
}

interface OpponentSelfProfile {
  xg: number | null;
  xga: number | null;
  possession: number | null;
  bigChances: number | null;
  shotsOnTarget: number | null;
}

interface ComparableOpponent {
  eventId: number;
  opponentId: number;
  opponentName: string;
  venue: "H" | "A";
  similarity: number;
  teamScore: number;
  oppScore: number;
  result: "W" | "D" | "L";
  oppXg: number | null;
  oppXga: number | null;
  oppPossession: number | null;
  whyComparable: string;
  startTimestamp: number;
}

interface AdjustedTeamMatchStats extends TeamMatchStats {
  effectiveSampleSize: number;
  currentOpponentProfile: OpponentSelfProfile;
  comparableOpponents: ComparableOpponent[];
}

interface SimulationMetricsResponse {
  home?: {
    formation?: string | null;
    lineup?: LineupTeam & {
      isLikely?: boolean;
      lineupSource?: string;
      unavailableCount?: number;
      activeLast5Count?: number;
    };
    players?: { playerId: number; metrics: PlayerMetrics }[];
    teamStrength?: number | null;
    formStrength?: number | null;
    scoringStrength?: number | null;
    defendingStrength?: number | null;
    formPoints?: number;
    formSummary?: FormSummary;
    phaseStrengths?: PhaseStrengths;
    isLikelyLineup?: boolean;
    lineupSource?: string;
    unavailableCount?: number;
    activeLast5Count?: number;
    matchesAnalyzed?: number;
    teamMatchStats?: TeamMatchStats;
    teamMatchStatsAdjusted?: AdjustedTeamMatchStats;
    gsrm?: GSRM | null;
    ssbi?: SSBI | null;
    scoringPatterns?: ScoringPatterns | null;
    causalAnalysis?: CausalProfile | null;
  };
  away?: {
    formation?: string | null;
    lineup?: LineupTeam & {
      isLikely?: boolean;
      lineupSource?: string;
      unavailableCount?: number;
      activeLast5Count?: number;
    };
    players?: { playerId: number; metrics: PlayerMetrics }[];
    teamStrength?: number | null;
    formStrength?: number | null;
    scoringStrength?: number | null;
    defendingStrength?: number | null;
    formPoints?: number;
    formSummary?: FormSummary;
    phaseStrengths?: PhaseStrengths;
    isLikelyLineup?: boolean;
    lineupSource?: string;
    unavailableCount?: number;
    activeLast5Count?: number;
    matchesAnalyzed?: number;
    teamMatchStats?: TeamMatchStats;
    teamMatchStatsAdjusted?: AdjustedTeamMatchStats;
    gsrm?: GSRM | null;
    ssbi?: SSBI | null;
    scoringPatterns?: ScoringPatterns | null;
    causalAnalysis?: CausalProfile | null;
  };
  simulationInsights?: SimulationInsights | null;
}

interface HiddenTruth {
  key: string;
  label: string;
  value: string;
  detail: string;
  signal: "positive" | "negative" | "neutral";
}

interface MatchupCrossRef {
  key: string;
  headline: string;
  detail: string;
  forSide: "home" | "away" | "both";
}

interface SimulationInsights {
  home: HiddenTruth[];
  away: HiddenTruth[];
  matchup: MatchupCrossRef[];
}

interface LiveEvent {
  minute: number;
  team: "home" | "away";
  text: string;
  type: "attack" | "goal" | "save" | "control";
}

interface ScorelineResult {
  score: string;
  homeScore: number;
  awayScore: number;
  count: number;
  percent: number;
}

interface SimulationState {
  running: boolean;
  minute: number;
  homeScore: number;
  awayScore: number;
  possession: number;
  ballY: number;
  events: LiveEvent[];
  bulkStatus: "idle" | "countdown" | "running" | "complete";
  topScorelines: ScorelineResult[];
}

function getPlayerName(player: PlayerData): string {
  return player.player?.shortName || player.player?.name || "Player";
}

function isGoalkeeper(player: PlayerData): boolean {
  const position = (player.position || "").toLowerCase();
  return position === "g" || position.includes("goal");
}

function parseFormation(formation?: string): number[] {
  if (!formation) return [];
  return formation
    .split("-")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function chunkPlayers(players: PlayerData[], counts: number[]): PlayerData[][] {
  const rows: PlayerData[][] = [];
  let index = 0;
  counts.forEach((count) => {
    rows.push(players.slice(index, index + count));
    index += count;
  });
  if (index < players.length) {
    const remainder = players.slice(index);
    if (rows.length > 0) rows[rows.length - 1] = [...rows[rows.length - 1], ...remainder];
    else rows.push(remainder);
  }
  return rows.filter((row) => row.length > 0);
}

function fallbackRows(starters: PlayerData[]): PlayerData[][] {
  const defenders = starters.filter((player) => (player.position || "").toLowerCase().startsWith("d"));
  const midfielders = starters.filter((player) => (player.position || "").toLowerCase().startsWith("m"));
  const forwards = starters.filter((player) => {
    const position = (player.position || "").toLowerCase();
    return position.startsWith("f") || position.startsWith("a");
  });
  const used = new Set([...defenders, ...midfielders, ...forwards]);
  const others = starters.filter((player) => !used.has(player));
  return [defenders, midfielders, forwards, others].filter((row) => row.length > 0);
}

function buildFormationRows(team?: LineupTeam, isHome?: boolean): FormationRow[] {
  const starters = (team?.players || []).filter((player) => !player.substitute).slice(0, 11);
  if (starters.length === 0) return [];

  const goalkeeperIndex = starters.findIndex(isGoalkeeper);
  const goalkeeper = goalkeeperIndex >= 0 ? starters[goalkeeperIndex] : starters[0];
  const outfield = starters.filter((_, index) => index !== (goalkeeperIndex >= 0 ? goalkeeperIndex : 0));
  const formationCounts = parseFormation(team?.formation);
  const outfieldRows =
    formationCounts.length > 0 && formationCounts.reduce((sum, count) => sum + count, 0) <= outfield.length + 2
      ? chunkPlayers(outfield, formationCounts)
      : fallbackRows(outfield);

  const rows = [[goalkeeper], ...outfieldRows].filter((row) => row.length > 0);
  const displayRows = isHome ? rows.reverse() : rows;
  return displayRows.map((players, index) => ({
    key: `${isHome ? "home" : "away"}-${index}`,
    players,
  }));
}

function metricLabel(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(1) : "—";
}

function getPlayerScore(player?: PlayerData): number {
  return player?.simulationMetrics?.overall || player?.simulationMetrics?.averageRating || 6;
}

function getPlayerRole(player?: PlayerData): "GK" | "DEF" | "MID" | "ATT" {
  const position = (player?.position || "").toLowerCase();
  if (position === "g" || position.includes("goal")) return "GK";
  if (position.startsWith("d")) return "DEF";
  if (position.startsWith("m")) return "MID";
  return "ATT";
}

function getRoleStrength(player?: PlayerData): number {
  const metrics = player?.simulationMetrics;
  const role = getPlayerRole(player);
  if (role === "GK") return metrics?.keeperStrength || metrics?.defensiveStrength || getPlayerScore(player);
  if (role === "DEF") return metrics?.defensiveStrength || metrics?.fullbackStrength || getPlayerScore(player);
  if (role === "MID") return metrics?.midfieldStrength || getPlayerScore(player);
  return metrics?.attackStrength || getPlayerScore(player);
}

function metricColor(value: number | null | undefined): string {
  if (typeof value !== "number") return Colors.dark.textTertiary;
  if (value >= 7.4) return "#22c55e";
  if (value >= 6.4) return "#eab308";
  return "#f97316";
}

function mergeMetrics(team?: LineupTeam, metrics?: SimulationMetricsResponse["home"]): LineupTeam | undefined {
  const baseTeam = team?.players?.length ? team : metrics?.lineup;
  if (!baseTeam) return baseTeam;
  const metricMap = new Map((metrics?.players || []).map((entry) => [entry.playerId, entry.metrics]));
  return {
    ...baseTeam,
    players: (baseTeam.players || []).map((player) => ({
      ...player,
      simulationMetrics: metricMap.get(Number(player.player?.id)) || null,
    })),
  };
}

const PlayerMarker = memo(({ player, side }: { player: PlayerData; side: "home" | "away" }) => {
  const kitColor = side === "home" ? Colors.dark.homeKit : Colors.dark.awayKit;
  const number = player.jerseyNumber ? String(player.jerseyNumber) : "";
  const metrics = player.simulationMetrics;

  return (
    <View style={styles.playerMarker}>
      <View style={styles.ratingBadge}>
        <Text style={styles.ratingBadgeText}>{metricLabel(metrics?.overall)}</Text>
      </View>
      <View style={[styles.playerDot, { backgroundColor: kitColor }]}>
        <Text style={styles.playerNumber}>{number}</Text>
      </View>
      <Text style={styles.playerName} numberOfLines={2}>
        {getPlayerName(player)}
      </Text>
      <Text style={styles.playerMeta} numberOfLines={1}>
        E{metricLabel(metrics?.experience)} D{metricLabel(metrics?.decision)}
      </Text>
      <Text style={styles.playerMeta} numberOfLines={1}>
        I{metricLabel(metrics?.intelligence)} P{metricLabel(metrics?.performance)}
      </Text>
      <Text style={[styles.roleMeta, { color: metricColor(getRoleStrength(player)) }]} numberOfLines={1}>
        {getPlayerRole(player)} {metricLabel(getRoleStrength(player))}
      </Text>
    </View>
  );
});

PlayerMarker.displayName = "PlayerMarker";

function FormationRows({ rows, side }: { rows: FormationRow[]; side: "home" | "away" }) {
  return (
    <View style={styles.teamHalf}>
      {rows.map((row) => (
        <View key={row.key} style={styles.formationRow}>
          {row.players.map((player, index) => (
            <PlayerMarker
              key={`${player.player?.id || player.player?.shortName || index}-${index}`}
              player={player}
              side={side}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function EmptyLineupMessage() {
  return (
    <View style={styles.emptyOverlay}>
      <Text style={styles.emptyTitle}>Simulation unavailable</Text>
      <Text style={styles.emptyText}>
        Predicted lineups are not available for this match yet.
      </Text>
    </View>
  );
}

function createLiveEvent(
  minute: number,
  team: "home" | "away",
  type: LiveEvent["type"],
  playerName: string,
  opponentName: string,
): LiveEvent {
  const textByType = {
    goal: `${playerName} breaks through and scores against ${opponentName}`,
    save: `${playerName} creates a chance, but ${opponentName} survives`,
    attack: `${playerName} drives the attack into the final third`,
    control: `${playerName} controls the tempo and keeps possession moving`,
  };
  return { minute, team, type, text: textByType[type] };
}

function teamStatsAttackFactor(ps?: PeriodStats | null): number | null {
  if (!ps) return null;
  const xgF = ps.avgXg != null ? clampForSimulation(4 + (ps.avgXg / 2.0) * 4, 3, 9.5) : null;
  const sotF = ps.avgShotsOnTarget != null ? clampForSimulation(4 + (ps.avgShotsOnTarget / 5.5) * 3.5, 3, 9.5) : null;
  const bcF = ps.avgBigChances != null ? clampForSimulation(4 + (ps.avgBigChances / 4.5) * 3, 3, 9) : null;
  const sibF = ps.avgShotsInsideBox != null ? clampForSimulation(4 + (ps.avgShotsInsideBox / 8) * 3, 3, 9) : null;
  const vals = [xgF, sotF, bcF, sibF].filter((v): v is number => v !== null);
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

function teamStatsDefenseFactor(ps?: PeriodStats | null): number | null {
  if (!ps) return null;
  const gpF = ps.avgGoalsPrevented != null ? clampForSimulation(6 + ps.avgGoalsPrevented * 2.2, 3, 9.5) : null;
  const clrF = ps.avgClearances != null ? clampForSimulation(4 + (ps.avgClearances / 17) * 3.5, 3, 9) : null;
  const intF = ps.avgInterceptions != null ? clampForSimulation(4 + (ps.avgInterceptions / 10) * 3.5, 3, 9) : null;
  const twF = ps.avgTacklesWon != null ? clampForSimulation(4 + (ps.avgTacklesWon / 60) * 4, 3, 9) : null;
  const vals = [gpF, clrF, intF, twF].filter((v): v is number => v !== null);
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

function buildSimulationContext({
  homePlayers,
  awayPlayers,
  homeStrength,
  awayStrength,
  homePhases,
  awayPhases,
  homeForm,
  awayForm,
  homeTeamStats,
  awayTeamStats,
}: {
  homePlayers: PlayerData[];
  awayPlayers: PlayerData[];
  homeStrength?: number | null;
  awayStrength?: number | null;
  homePhases?: PhaseStrengths;
  awayPhases?: PhaseStrengths;
  homeForm?: FormSummary;
  awayForm?: FormSummary;
  homeTeamStats?: TeamMatchStats | null;
  awayTeamStats?: TeamMatchStats | null;
}) {
  const homeScoring = homeForm?.scoringStrength || homePhases?.attackStrength || homeStrength || 6.4;
  const awayScoring = awayForm?.scoringStrength || awayPhases?.attackStrength || awayStrength || 6.4;
  const homeDefending = homeForm?.defendingStrength || homePhases?.defensiveStrength || homeStrength || 6.4;
  const awayDefending = awayForm?.defendingStrength || awayPhases?.defensiveStrength || awayStrength || 6.4;
  const homeFormBoost = homeForm?.formStrength || homeStrength || 6.4;
  const awayFormBoost = awayForm?.formStrength || awayStrength || 6.4;

  const homeStatsAttack = teamStatsAttackFactor(homeTeamStats?.all);
  const awayStatsAttack = teamStatsAttackFactor(awayTeamStats?.all);
  const homeStatsDefense = teamStatsDefenseFactor(homeTeamStats?.all);
  const awayStatsDefense = teamStatsDefenseFactor(awayTeamStats?.all);

  const blendedHomeScoring = homeStatsAttack != null ? homeScoring * 0.62 + homeStatsAttack * 0.38 : homeScoring;
  const blendedAwayScoring = awayStatsAttack != null ? awayScoring * 0.62 + awayStatsAttack * 0.38 : awayScoring;

  const homePower = (blendedHomeScoring * 0.48) + ((homePhases?.midfieldStrength || homeStrength || 6.4) * 0.2) + ((homePhases?.fullbackStrength || homeStrength || 6.4) * 0.12) + (homeFormBoost * 0.2);
  const awayPower = (blendedAwayScoring * 0.48) + ((awayPhases?.midfieldStrength || awayStrength || 6.4) * 0.2) + ((awayPhases?.fullbackStrength || awayStrength || 6.4) * 0.12) + (awayFormBoost * 0.2);
  const totalPower = Math.max(homePower + awayPower, 1);
  const homeChance = homePower / totalPower;

  const rawPossession = homeTeamStats?.all?.avgPossession ?? null;
  const possessionTarget = rawPossession != null
    ? Math.round(rawPossession * 0.6 + homeChance * 100 * 0.4)
    : Math.round(homeChance * 100);

  const homeAttackScores = homePlayers.map((player) => Math.max(getPlayerScore(player), getRoleStrength(player)));
  const homeDefenseScores = homePlayers.map((player) => Math.max(getPlayerScore(player), getRoleStrength(player)));
  const awayAttackScores = awayPlayers.map((player) => Math.max(getPlayerScore(player), getRoleStrength(player)));
  const awayDefenseScores = awayPlayers.map((player) => Math.max(getPlayerScore(player), getRoleStrength(player)));

  const rawHomeDefBase = (homeDefending * 0.48) + ((homePhases?.keeperStrength || homeStrength || 6.4) * 0.28) + ((homePhases?.midfieldStrength || homeStrength || 6.4) * 0.16) + (homeFormBoost * 0.08);
  const rawAwayDefBase = (awayDefending * 0.48) + ((awayPhases?.keeperStrength || awayStrength || 6.4) * 0.28) + ((awayPhases?.midfieldStrength || awayStrength || 6.4) * 0.16) + (awayFormBoost * 0.08);

  return {
    homeChance,
    possessionTarget,
    homeAttackScores: homeAttackScores.length ? homeAttackScores : [6],
    homeDefenseScores: homeDefenseScores.length ? homeDefenseScores : [6],
    awayAttackScores: awayAttackScores.length ? awayAttackScores : [6],
    awayDefenseScores: awayDefenseScores.length ? awayDefenseScores : [6],
    homeScoringBase: blendedHomeScoring,
    awayScoringBase: blendedAwayScoring,
    homeDefensiveBase: homeStatsDefense != null ? rawHomeDefBase * 0.62 + homeStatsDefense * 0.38 : rawHomeDefBase,
    awayDefensiveBase: awayStatsDefense != null ? rawAwayDefBase * 0.62 + awayStatsDefense * 0.38 : rawAwayDefBase,
  };
}

function simulateMatchScoreline(context: ReturnType<typeof buildSimulationContext>) {
  let homeScore = 0;
  let awayScore = 0;

  for (let minute = 3; minute <= 90; minute += 3) {
    const attackingTeam: "home" | "away" = Math.random() <= context.homeChance ? "home" : "away";
    const attackScores = attackingTeam === "home" ? context.homeAttackScores : context.awayAttackScores;
    const defenseScores = attackingTeam === "home" ? context.awayDefenseScores : context.homeDefenseScores;
    const attackerScore = attackScores[Math.floor(Math.random() * attackScores.length)] || 6;
    const defenderScore = defenseScores[Math.floor(Math.random() * defenseScores.length)] || 6;
    const defensiveWall = attackingTeam === "home"
      ? context.awayDefensiveBase || defenderScore
      : context.homeDefensiveBase || defenderScore;
    const scoringBase = attackingTeam === "home" ? context.homeScoringBase : context.awayScoringBase;
    const goalChance = clampForSimulation(0.045 + (attackerScore * 0.65 + scoringBase * 0.35 - defensiveWall) * 0.026 + (attackingTeam === "home" ? 0.01 : 0), 0.022, 0.18);

    if (Math.random() < goalChance) {
      if (attackingTeam === "home") homeScore += 1;
      else awayScore += 1;
    }
  }

  return { homeScore, awayScore };
}

function runBulkScorelineSimulation(context: ReturnType<typeof buildSimulationContext>, totalRuns: number): ScorelineResult[] {
  const counts = new Map<string, { homeScore: number; awayScore: number; count: number }>();

  for (let index = 0; index < totalRuns; index += 1) {
    const { homeScore, awayScore } = simulateMatchScoreline(context);
    const key = `${homeScore}-${awayScore}`;
    const current = counts.get(key) || { homeScore, awayScore, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }

  return Array.from(counts.entries())
    .map(([score, entry]) => ({
      score,
      homeScore: entry.homeScore,
      awayScore: entry.awayScore,
      count: entry.count,
      percent: (entry.count / totalRuns) * 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

function SimulationPanel({
  homeTeamName,
  awayTeamName,
  homePlayers,
  awayPlayers,
  homeStrength,
  awayStrength,
  homePhases,
  awayPhases,
  homeForm,
  awayForm,
  homeTeamStats,
  awayTeamStats,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homePlayers: PlayerData[];
  awayPlayers: PlayerData[];
  homeStrength?: number | null;
  awayStrength?: number | null;
  homePhases?: PhaseStrengths;
  awayPhases?: PhaseStrengths;
  homeForm?: FormSummary;
  awayForm?: FormSummary;
  homeTeamStats?: TeamMatchStats | null;
  awayTeamStats?: TeamMatchStats | null;
}) {
  const [state, setState] = useState<SimulationState>({
    running: false,
    minute: 0,
    homeScore: 0,
    awayScore: 0,
    possession: 50,
    ballY: 50,
    events: [],
    bulkStatus: "idle",
    topScorelines: [],
  });

  const simulationContext = useMemo(
    () =>
      buildSimulationContext({
        homePlayers,
        awayPlayers,
        homeStrength,
        awayStrength,
        homePhases,
        awayPhases,
        homeForm,
        awayForm,
        homeTeamStats,
        awayTeamStats,
      }),
    [awayForm, awayPhases, awayPlayers, awayStrength, awayTeamStats, homeForm, homePhases, homePlayers, homeStrength, homeTeamStats],
  );

  const resetSimulation = useCallback(() => {
    setState({
      running: false,
      minute: 0,
      homeScore: 0,
      awayScore: 0,
      possession: 50,
      ballY: 50,
      events: [],
      bulkStatus: "idle",
      topScorelines: [],
    });
  }, []);

  const startSimulation = useCallback(() => {
    setState((current) => ({
      ...current,
      running: true,
      bulkStatus: "countdown",
      topScorelines: [],
      minute: current.minute >= 90 ? 0 : current.minute,
      homeScore: current.minute >= 90 ? 0 : current.homeScore,
      awayScore: current.minute >= 90 ? 0 : current.awayScore,
      events: current.minute >= 90 ? [] : current.events,
    }));
  }, []);

  useEffect(() => {
    if (!state.running) return undefined;
    const timer = setInterval(() => {
      setState((current) => {
        if (!current.running || current.minute >= 90) {
          return { ...current, running: false, minute: 90 };
        }

        const nextMinute = Math.min(90, current.minute + 3);
        const attackingTeam: "home" | "away" = Math.random() <= simulationContext.homeChance ? "home" : "away";
        const attackers = attackingTeam === "home" ? homePlayers : awayPlayers;
        const defenders = attackingTeam === "home" ? awayPlayers : homePlayers;
        const attacker =
          attackers[Math.floor(Math.random() * Math.max(attackers.length, 1))] || attackers[0];
        const defender =
          defenders[Math.floor(Math.random() * Math.max(defenders.length, 1))] || defenders[0];
        const attackerScore = Math.max(getPlayerScore(attacker), getRoleStrength(attacker));
        const defenderScore = Math.max(getPlayerScore(defender), getRoleStrength(defender));
        const defensiveWall = attackingTeam === "home" ? simulationContext.awayDefensiveBase : simulationContext.homeDefensiveBase;
        const scoringBase = attackingTeam === "home" ? simulationContext.homeScoringBase : simulationContext.awayScoringBase;
        const goalChance = clampForSimulation(0.045 + (attackerScore * 0.65 + scoringBase * 0.35 - defensiveWall) * 0.026 + (attackingTeam === "home" ? 0.01 : 0), 0.022, 0.18);
        const roll = Math.random();
        const type: LiveEvent["type"] =
          roll < goalChance ? "goal" : roll < goalChance + 0.22 ? "save" : roll < 0.68 ? "attack" : "control";
        const event = createLiveEvent(
          nextMinute,
          attackingTeam,
          type,
          getPlayerName(attacker),
          getPlayerName(defender),
        );
        const possession = Math.round(current.possession * 0.7 + simulationContext.possessionTarget * 0.3 + (Math.random() * 8 - 4));

        return {
          ...current,
          running: nextMinute < 90,
          minute: nextMinute,
          homeScore: current.homeScore + (type === "goal" && attackingTeam === "home" ? 1 : 0),
          awayScore: current.awayScore + (type === "goal" && attackingTeam === "away" ? 1 : 0),
          possession: clampForSimulation(possession, 35, 65),
          ballY: attackingTeam === "home" ? clampForSimulation(82 - attackerScore * 4, 42, 84) : clampForSimulation(18 + attackerScore * 4, 16, 58),
          events: [event, ...current.events].slice(0, 8),
        };
      });
    }, 900);

    return () => clearInterval(timer);
  }, [awayPlayers, homePlayers, simulationContext, state.running]);

  useEffect(() => {
    if (state.bulkStatus !== "countdown" || state.running || state.minute < 90) return undefined;
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, bulkStatus: "running" }));
      setTimeout(() => {
        const topScorelines = runBulkScorelineSimulation(simulationContext, 1_000_000);
        setState((current) => ({ ...current, bulkStatus: "complete", topScorelines }));
      }, 30);
    }, 250);

    return () => clearTimeout(timer);
  }, [simulationContext, state.bulkStatus, state.minute, state.running]);

  const canSimulate = homePlayers.length > 0 && awayPlayers.length > 0;

  return (
    <View style={styles.liveCard}>
      <View style={styles.liveHeader}>
        <View>
          <Text style={styles.cardLabel}>Live clash simulator</Text>
          <Text style={styles.liveScore}>
            {homeTeamName} {state.homeScore} - {state.awayScore} {awayTeamName}
          </Text>
        </View>
        <View style={styles.minutePill}>
          <Text style={styles.minuteText}>{state.minute || 0}'</Text>
        </View>
      </View>
      <View style={styles.miniPitch}>
        <View style={[styles.simBall, { top: `${state.ballY}%` as any }]} />
      </View>
      <View style={styles.possessionRow}>
        <Text style={styles.possessionText}>{homeTeamName} {state.possession}%</Text>
        <Text style={styles.possessionText}>{100 - state.possession}% {awayTeamName}</Text>
      </View>
      <View style={styles.possessionBar}>
        <View style={[styles.possessionFill, { width: `${state.possession}%` as any }]} />
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.simulateButton, (!canSimulate || state.running || state.bulkStatus === "running") && styles.buttonDisabled]}
          onPress={startSimulation}
          disabled={!canSimulate || state.running || state.bulkStatus === "running"}
          activeOpacity={0.85}
        >
          <Text style={styles.simulateButtonText}>
            {state.running ? "Counting down..." : state.bulkStatus === "running" ? "Running 1,000,000..." : state.minute >= 90 ? "Simulate again" : "Simulate"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetButton} onPress={resetSimulation} activeOpacity={0.85}>
          <Text style={styles.resetButtonText}>Reset</Text>
        </TouchableOpacity>
      </View>
      {state.events.length > 0 && (
        <View style={styles.eventFeed}>
          {state.events.map((event, index) => (
            <Text
              key={`${event.minute}-${index}-${event.text}`}
              style={[styles.eventText, event.type === "goal" && styles.goalEventText]}
            >
              {event.minute}' {event.team === "home" ? homeTeamName : awayTeamName}: {event.text}
            </Text>
          ))}
        </View>
      )}
      {state.bulkStatus === "running" && (
        <View style={styles.scorelineCard}>
          <ActivityIndicator size="small" color={Colors.dark.accent} />
          <Text style={styles.scorelineLoadingText}>Running 1,000,000 full match simulations...</Text>
        </View>
      )}
      {state.topScorelines.length > 0 && (
        <View style={styles.scorelineCard}>
          <Text style={styles.scorelineTitle}>Top 20 score results from 1,000,000 simulations</Text>
          {state.topScorelines.map((result, index) => (
            <View key={result.score} style={styles.scorelineRow}>
              <Text style={styles.scorelineRank}>{index + 1}</Text>
              <Text style={styles.scorelineScore}>
                {homeTeamName} {result.homeScore} - {result.awayScore} {awayTeamName}
              </Text>
              <View style={styles.scorelineMeta}>
                <Text style={styles.scorelinePercent}>{result.percent.toFixed(2)}%</Text>
                <Text style={styles.scorelineCount}>{result.count.toLocaleString()}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function PhaseStrengthCard({
  homeTeamName,
  awayTeamName,
  homePhases,
  awayPhases,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homePhases?: PhaseStrengths;
  awayPhases?: PhaseStrengths;
}) {
  const rows: { label: string; key: keyof PhaseStrengths; note: string }[] = [
    { label: "Defensive", key: "defensiveStrength", note: "duels, recoveries, clearances, errors" },
    { label: "Attack", key: "attackStrength", note: "xG, shots, big chances, xA, dribbles" },
    { label: "Midfield", key: "midfieldStrength", note: "progression, recoveries, passing, creativity" },
    { label: "Keeper", key: "keeperStrength", note: "saves, goals prevented, high claims, sweeper actions" },
    { label: "Full-back", key: "fullbackStrength", note: "crosses, carries, tackles, flank progression" },
  ];

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Last 15 role strengths</Text>
      {rows.map((row) => {
        const homeValue = homePhases?.[row.key] ?? null;
        const awayValue = awayPhases?.[row.key] ?? null;
        return (
          <View key={row.key} style={styles.phaseRow}>
            <View style={styles.phaseHeader}>
              <Text style={styles.phaseLabel}>{row.label}</Text>
              <Text style={styles.phaseNote} numberOfLines={1}>{row.note}</Text>
            </View>
            <View style={styles.phaseScores}>
              <Text style={[styles.phaseScore, { color: metricColor(homeValue) }]}>
                {homeTeamName}: {metricLabel(homeValue)}
              </Text>
              <Text style={[styles.phaseScore, { color: metricColor(awayValue) }]}>
                {awayTeamName}: {metricLabel(awayValue)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function fmt(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined) return "—";
  const str = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit ? `${str}${unit}` : str;
}

function statColor(homeVal: number | null | undefined, awayVal: number | null | undefined, higherIsBetter: boolean): { home: string; away: string } {
  if (homeVal == null || awayVal == null) return { home: Colors.dark.textSecondary, away: Colors.dark.textSecondary };
  const homeWins = higherIsBetter ? homeVal > awayVal : homeVal < awayVal;
  const awayWins = higherIsBetter ? awayVal > homeVal : awayVal < homeVal;
  return {
    home: homeWins ? "#22c55e" : awayWins ? Colors.dark.textSecondary : Colors.dark.textSecondary,
    away: awayWins ? "#22c55e" : homeWins ? Colors.dark.textSecondary : Colors.dark.textSecondary,
  };
}

type StatViewPeriod = "all" | "firstHalf" | "secondHalf";

function buildStatRows(home?: PeriodStats | null, away?: PeriodStats | null) {
  type StatRow = { label: string; homeVal: number | null | undefined; awayVal: number | null | undefined; unit?: string; higherIsBetter: boolean; section?: string };
  const rows: StatRow[] = [
    { section: "Goals", label: "Goals Scored", homeVal: home?.avgGoalsScored, awayVal: away?.avgGoalsScored, higherIsBetter: true },
    { label: "Goals Conceded", homeVal: home?.avgGoalsConceded, awayVal: away?.avgGoalsConceded, higherIsBetter: false },
    { section: "Match Overview", label: "Possession", homeVal: home?.avgPossession, awayVal: away?.avgPossession, unit: "%", higherIsBetter: true },
    { label: "Expected Goals (xG)", homeVal: home?.avgXg, awayVal: away?.avgXg, higherIsBetter: true },
    { label: "xG Got Per Match", homeVal: home?.avgXgGotPerMatch, awayVal: away?.avgXgGotPerMatch, higherIsBetter: true },
    { label: "Big Chances", homeVal: home?.avgBigChances, awayVal: away?.avgBigChances, higherIsBetter: true },
    { label: "Total Shots", homeVal: home?.avgTotalShots, awayVal: away?.avgTotalShots, higherIsBetter: true },
    { label: "Corner Kicks", homeVal: home?.avgCornerKicks, awayVal: away?.avgCornerKicks, higherIsBetter: true },
    { label: "Fouls", homeVal: home?.avgFouls, awayVal: away?.avgFouls, higherIsBetter: false },
    { section: "Shooting", label: "Shots on Target", homeVal: home?.avgShotsOnTarget, awayVal: away?.avgShotsOnTarget, higherIsBetter: true },
    { label: "Shots off Target", homeVal: home?.avgShotsOffTarget, awayVal: away?.avgShotsOffTarget, higherIsBetter: false },
    { label: "Blocked Shots", homeVal: home?.avgBlockedShots, awayVal: away?.avgBlockedShots, higherIsBetter: false },
    { label: "Shots Inside Box", homeVal: home?.avgShotsInsideBox, awayVal: away?.avgShotsInsideBox, higherIsBetter: true },
    { label: "Big Chances Scored", homeVal: home?.avgBigChancesScored, awayVal: away?.avgBigChancesScored, higherIsBetter: true },
    { label: "Big Chances Missed", homeVal: home?.avgBigChancesMissed, awayVal: away?.avgBigChancesMissed, higherIsBetter: false },
    { label: "Opp. Box Touches", homeVal: home?.avgTouchesInOppositionBox, awayVal: away?.avgTouchesInOppositionBox, higherIsBetter: true },
    { section: "Passing", label: "Pass Accuracy", homeVal: home?.avgPassAccuracy, awayVal: away?.avgPassAccuracy, unit: "%", higherIsBetter: true },
    { label: "Total Passes", homeVal: home?.avgTotalPasses, awayVal: away?.avgTotalPasses, higherIsBetter: true },
    { section: "Defending", label: "Duels Won", homeVal: home?.avgDuelsWon, awayVal: away?.avgDuelsWon, unit: "%", higherIsBetter: true },
    { label: "Tackles Won", homeVal: home?.avgTacklesWon, awayVal: away?.avgTacklesWon, unit: "%", higherIsBetter: true },
    { label: "Interceptions", homeVal: home?.avgInterceptions, awayVal: away?.avgInterceptions, higherIsBetter: true },
    { label: "Clearances", homeVal: home?.avgClearances, awayVal: away?.avgClearances, higherIsBetter: true },
    { section: "Goalkeeping", label: "GK Saves", homeVal: home?.avgGoalkeeperSaves, awayVal: away?.avgGoalkeeperSaves, higherIsBetter: true },
    { label: "Goals Prevented", homeVal: home?.avgGoalsPrevented, awayVal: away?.avgGoalsPrevented, higherIsBetter: true },
  ];
  return rows;
}

function gsrmColor(val: number | null | undefined): string {
  if (val == null) return Colors.dark.textSecondary;
  if (val >= 7) return "#22c55e";
  if (val >= 4) return "#eab308";
  return "#ef4444";
}

function gsrmLabel(val: number | null | undefined): string {
  if (val == null) return "—";
  if (val >= 8.5) return "Elite";
  if (val >= 7) return "Strong";
  if (val >= 5) return "Average";
  if (val >= 3) return "Weak";
  return "Poor";
}

function GameIntelligenceCard({
  homeTeamName,
  awayTeamName,
  homeGsrm,
  awayGsrm,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeGsrm?: GSRM | null;
  awayGsrm?: GSRM | null;
}) {
  if (!homeGsrm && !awayGsrm) return null;

  const indices: {
    key: keyof GSRM;
    label: string;
    desc: string;
    matchesKey: keyof GSRM;
    homeVal: number | null;
    awayVal: number | null;
    homeMatches: number;
    awayMatches: number;
  }[] = [
    {
      key: "ecri", label: "Early Concession Response", desc: "Aggression within 20–40 min of conceding first (before 30′)",
      matchesKey: "ecriMatches",
      homeVal: homeGsrm?.ecri ?? null, awayVal: awayGsrm?.ecri ?? null,
      homeMatches: homeGsrm?.ecriMatches ?? 0, awayMatches: awayGsrm?.ecriMatches ?? 0,
    },
    {
      key: "eri", label: "Equalizer Reaction", desc: "Push for winner vs settle after lead is cancelled",
      matchesKey: "eriMatches",
      homeVal: homeGsrm?.eri ?? null, awayVal: awayGsrm?.eri ?? null,
      homeMatches: homeGsrm?.eriMatches ?? 0, awayMatches: awayGsrm?.eriMatches ?? 0,
    },
    {
      key: "tgbi", label: "2-Goal Lead Behavior", desc: "Attack or protect when ahead by 2+ goals",
      matchesKey: "tgbiMatches",
      homeVal: homeGsrm?.tgbi ?? null, awayVal: awayGsrm?.tgbi ?? null,
      homeMatches: homeGsrm?.tgbiMatches ?? 0, awayMatches: awayGsrm?.tgbiMatches ?? 0,
    },
    {
      key: "frqi", label: "Pressure Finishing", desc: "Clinicality when trailing — scoring, equalizing, overturning",
      matchesKey: "frqiMatches",
      homeVal: homeGsrm?.frqi ?? null, awayVal: awayGsrm?.frqi ?? null,
      homeMatches: homeGsrm?.frqiMatches ?? 0, awayMatches: awayGsrm?.frqiMatches ?? 0,
    },
  ];

  const hasAnyData = indices.some(i => i.homeVal != null || i.awayVal != null);
  if (!hasAnyData) return null;

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Game Intelligence · Behavioral Patterns</Text>
      <View style={[styles.statsHeaderRow, { marginBottom: 4 }]}>
        <Text style={[styles.statsHeaderTeam, { color: Colors.dark.homeKit }]} numberOfLines={1}>{homeTeamName}</Text>
        <Text style={styles.statsHeaderLabel}>Index /10</Text>
        <Text style={[styles.statsHeaderTeam, { color: Colors.dark.awayKit }]} numberOfLines={1}>{awayTeamName}</Text>
      </View>
      {indices.map((idx) => {
        if (idx.homeVal == null && idx.awayVal == null) return null;
        const hColor = gsrmColor(idx.homeVal);
        const aColor = gsrmColor(idx.awayVal);
        const hPct = idx.homeVal != null ? (idx.homeVal / 10) * 100 : 0;
        const aPct = idx.awayVal != null ? (idx.awayVal / 10) * 100 : 0;
        return (
          <View key={idx.key} style={styles.gsrmRow}>
            <View style={styles.gsrmSide}>
              <Text style={[styles.gsrmScore, { color: hColor }]}>
                {idx.homeVal != null ? idx.homeVal.toFixed(1) : "—"}
              </Text>
              <Text style={[styles.gsrmTag, { color: hColor }]}>
                {gsrmLabel(idx.homeVal)}
              </Text>
            </View>
            <View style={styles.gsrmCenter}>
              <Text style={styles.gsrmLabel}>{idx.label}</Text>
              <Text style={styles.gsrmDesc}>{idx.desc}</Text>
              <View style={styles.gsrmBarRow}>
                <View style={styles.gsrmBarTrack}>
                  <View style={[styles.gsrmBarFillHome, { width: `${Math.max(hPct, 4)}%`, backgroundColor: hColor }]} />
                </View>
                <View style={styles.gsrmBarTrack}>
                  <View style={[styles.gsrmBarFillAway, { width: `${Math.max(aPct, 4)}%`, backgroundColor: aColor }]} />
                </View>
              </View>
              <Text style={styles.gsrmMatchCount}>
                {idx.homeMatches > 0 ? `${idx.homeMatches} matches` : "no triggers"} · {idx.awayMatches > 0 ? `${idx.awayMatches} matches` : "no triggers"}
              </Text>
            </View>
            <View style={styles.gsrmSideRight}>
              <Text style={[styles.gsrmScore, { color: aColor, textAlign: "right" }]}>
                {idx.awayVal != null ? idx.awayVal.toFixed(1) : "—"}
              </Text>
              <Text style={[styles.gsrmTag, { color: aColor, textAlign: "right" }]}>
                {gsrmLabel(idx.awayVal)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ssbiColor(val: number | null | undefined): string {
  if (val == null) return Colors.dark.textSecondary;
  if (val >= 7.5) return "#22c55e";
  if (val >= 5) return "#eab308";
  return "#ef4444";
}

function ssbiLabel(val: number | null | undefined): string {
  if (val == null) return "—";
  if (val >= 8.5) return "Destroyer";
  if (val >= 7) return "Breaker";
  if (val >= 5) return "Neutral";
  if (val >= 3) return "Passive";
  return "Stagnant";
}

function ScoreStateBreakCard({
  homeTeamName,
  awayTeamName,
  homeSsbi,
  awaySsbi,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeSsbi?: SSBI | null;
  awaySsbi?: SSBI | null;
}) {
  if (!homeSsbi && !awaySsbi) return null;

  const indices: {
    key: string;
    label: string;
    desc: string;
    homeVal: number | null;
    awayVal: number | null;
    homeMatches: number;
    awayMatches: number;
  }[] = [
    {
      key: "zzb",
      label: "0–0 Break Index",
      desc: "How quickly a team breaks the deadlock — first goal timing & frequency",
      homeVal: homeSsbi?.zzb ?? null,
      awayVal: awaySsbi?.zzb ?? null,
      homeMatches: homeSsbi?.zzbMatches ?? 0,
      awayMatches: awaySsbi?.zzbMatches ?? 0,
    },
    {
      key: "lbr",
      label: "1–0 Lead Behavior",
      desc: "After going 1–0 up: do they push again or sit back and protect?",
      homeVal: homeSsbi?.lbr ?? null,
      awayVal: awaySsbi?.lbr ?? null,
      homeMatches: homeSsbi?.lbrMatches ?? 0,
      awayMatches: awaySsbi?.lbrMatches ?? 0,
    },
    {
      key: "ddi",
      label: "1–1 Disruption Index",
      desc: "When the match is level at 1–1, how often does a team push for the winner?",
      homeVal: homeSsbi?.ddi ?? null,
      awayVal: awaySsbi?.ddi ?? null,
      homeMatches: homeSsbi?.ddiMatches ?? 0,
      awayMatches: awaySsbi?.ddiMatches ?? 0,
    },
  ];

  const hasAnyData = indices.some((i) => i.homeVal != null || i.awayVal != null);
  if (!hasAnyData) return null;

  const allBreakers: Array<{ name: string; team: "home" | "away"; data: SSBIBreaker }> = [
    ...(homeSsbi?.keyBreakers || []).map((b) => ({ name: homeTeamName, team: "home" as const, data: b })),
    ...(awaySsbi?.keyBreakers || []).map((b) => ({ name: awayTeamName, team: "away" as const, data: b })),
  ];

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Score State Breakability · SSBI</Text>
      <View style={[styles.statsHeaderRow, { marginBottom: 4 }]}>
        <Text style={[styles.statsHeaderTeam, { color: Colors.dark.homeKit }]} numberOfLines={1}>{homeTeamName}</Text>
        <Text style={styles.statsHeaderLabel}>Index /10</Text>
        <Text style={[styles.statsHeaderTeam, { color: Colors.dark.awayKit }]} numberOfLines={1}>{awayTeamName}</Text>
      </View>

      {indices.map((idx) => {
        if (idx.homeVal == null && idx.awayVal == null) return null;
        const hColor = ssbiColor(idx.homeVal);
        const aColor = ssbiColor(idx.awayVal);
        const hPct = idx.homeVal != null ? (idx.homeVal / 10) * 100 : 0;
        const aPct = idx.awayVal != null ? (idx.awayVal / 10) * 100 : 0;
        return (
          <View key={idx.key} style={styles.gsrmRow}>
            <View style={styles.gsrmSide}>
              <Text style={[styles.gsrmScore, { color: hColor }]}>
                {idx.homeVal != null ? idx.homeVal.toFixed(1) : "—"}
              </Text>
              <Text style={[styles.gsrmTag, { color: hColor }]}>
                {ssbiLabel(idx.homeVal)}
              </Text>
            </View>
            <View style={styles.gsrmCenter}>
              <Text style={styles.gsrmLabel}>{idx.label}</Text>
              <Text style={styles.gsrmDesc}>{idx.desc}</Text>
              <View style={styles.gsrmBarRow}>
                <View style={styles.gsrmBarTrack}>
                  <View style={[styles.gsrmBarFillHome, { width: `${Math.max(hPct, 4)}%`, backgroundColor: hColor }]} />
                </View>
                <View style={styles.gsrmBarTrack}>
                  <View style={[styles.gsrmBarFillAway, { width: `${Math.max(aPct, 4)}%`, backgroundColor: aColor }]} />
                </View>
              </View>
              <Text style={styles.gsrmMatchCount}>
                {idx.homeMatches > 0 ? `${idx.homeMatches} matches` : "no data"} · {idx.awayMatches > 0 ? `${idx.awayMatches} matches` : "no data"}
              </Text>
            </View>
            <View style={styles.gsrmSideRight}>
              <Text style={[styles.gsrmScore, { color: aColor, textAlign: "right" }]}>
                {idx.awayVal != null ? idx.awayVal.toFixed(1) : "—"}
              </Text>
              <Text style={[styles.gsrmTag, { color: aColor, textAlign: "right" }]}>
                {ssbiLabel(idx.awayVal)}
              </Text>
            </View>
          </View>
        );
      })}

      {allBreakers.length > 0 && (
        <View style={styles.ssbiBreakersSection}>
          <Text style={styles.ssbiBreakerTitle}>Key State Breakers</Text>
          <Text style={styles.ssbiBreakerSub}>Players who score in 0–0 / 1–1 situations · last 15 matches</Text>
          {allBreakers.map((item) => {
            const teamColor = item.team === "home" ? Colors.dark.homeKit : Colors.dark.awayKit;
            const avail = item.data.available;
            return (
              <View key={`${item.team}-${item.data.playerId}`} style={styles.ssbiBreakerRow}>
                <View style={[styles.ssbiBreakerDot, { backgroundColor: teamColor }]} />
                <View style={{ flex: 1 }}>
                  <View style={styles.ssbiBreakerHeader}>
                    <Text style={[styles.ssbiBreakerName, { color: teamColor }]} numberOfLines={1}>
                      {item.data.name}
                    </Text>
                    {avail !== null && (
                      <View style={[styles.ssbiAvailBadge, { backgroundColor: avail ? "#16a34a33" : "#7f1d1d33" }]}>
                        <Text style={[styles.ssbiAvailText, { color: avail ? "#4ade80" : "#f87171" }]}>
                          {avail ? "Available" : "Doubtful"}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.ssbiBreakerStats}>
                    {item.data.zzbGoals > 0 ? `${item.data.zzbGoals}× deadlock` : ""}
                    {item.data.zzbGoals > 0 && item.data.ddiGoals > 0 ? "  ·  " : ""}
                    {item.data.ddiGoals > 0 ? `${item.data.ddiGoals}× 1–1 break` : ""}
                    {"  "}
                    <Text style={styles.ssbiBreakerTotal}>({item.data.total} state-breaking goals)</Text>
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function finishingTagColor(tag: ScoringPatterns["finishingTag"]): string {
  switch (tag) {
    case "Deadly":   return "#22c55e";
    case "Clinical": return "#4ade80";
    case "Reliable": return "#eab308";
    case "Wasteful": return "#f97316";
    case "Flop":     return "#ef4444";
    default:         return Colors.dark.textSecondary;
  }
}

function defensiveTagColor(tag: ScoringPatterns["defensiveTag"]): string {
  switch (tag) {
    case "Resolute": return "#22c55e";
    case "Solid":    return "#4ade80";
    case "Average":  return "#eab308";
    case "Leaky":    return "#f97316";
    case "Sieve":    return "#ef4444";
    default:         return Colors.dark.textSecondary;
  }
}

function PatternHeatRow({
  bucket,
  side,
  maxScored,
  maxConceded,
}: {
  bucket: ScoringBucket;
  side: "home" | "away";
  maxScored: number;
  maxConceded: number;
}) {
  const sPct = maxScored   > 0 ? Math.max(4, (bucket.scored   / maxScored)   * 100) : 4;
  const cPct = maxConceded > 0 ? Math.max(4, (bucket.conceded / maxConceded) * 100) : 4;
  const sideColor = side === "home" ? Colors.dark.homeKit : Colors.dark.awayKit;
  return (
    <View style={styles.patternRow}>
      <Text style={styles.patternBucketLabel}>{bucket.label}</Text>
      <View style={styles.patternBars}>
        <View style={styles.patternBarBlock}>
          <View style={styles.patternBarTrack}>
            <View style={[styles.patternBarFill, { width: `${sPct}%`, backgroundColor: "#22c55e" }]} />
          </View>
          <Text style={styles.patternBarText}>
            {bucket.scored} <Text style={styles.patternBarPct}>({bucket.scoredPct.toFixed(0)}%)</Text>
          </Text>
        </View>
        <View style={styles.patternBarBlock}>
          <View style={styles.patternBarTrack}>
            <View style={[styles.patternBarFill, { width: `${cPct}%`, backgroundColor: "#ef4444" }]} />
          </View>
          <Text style={styles.patternBarText}>
            {bucket.conceded} <Text style={styles.patternBarPct}>({bucket.concededPct.toFixed(0)}%)</Text>
          </Text>
        </View>
      </View>
      <View style={[styles.patternSideDot, { backgroundColor: sideColor }]} />
    </View>
  );
}

function PatternSideBlock({
  teamName,
  side,
  patterns,
}: {
  teamName: string;
  side: "home" | "away";
  patterns?: ScoringPatterns | null;
}) {
  if (!patterns) return null;
  if (patterns.matchesWithIncidents === 0 && patterns.matchesAnalyzed === 0) return null;

  const sideColor = side === "home" ? Colors.dark.homeKit : Colors.dark.awayKit;
  const maxScored   = patterns.buckets.reduce((m, b) => Math.max(m, b.scored),   0);
  const maxConceded = patterns.buckets.reduce((m, b) => Math.max(m, b.conceded), 0);
  const tagColor = finishingTagColor(patterns.finishingTag);

  return (
    <View style={styles.patternBlock}>
      <View style={styles.patternHeader}>
        <View style={[styles.patternSideDot, { backgroundColor: sideColor }]} />
        <Text style={[styles.patternTeam, { color: sideColor }]} numberOfLines={1}>{teamName}</Text>
        {patterns.finishingTag && (
          <View style={[styles.patternTagBadge, { borderColor: tagColor }]}>
            <Text style={[styles.patternTagText, { color: tagColor }]}>{patterns.finishingTag}</Text>
          </View>
        )}
        {patterns.defensiveTag && (
          <View style={[styles.patternTagBadge, { borderColor: defensiveTagColor(patterns.defensiveTag) }]}>
            <Text style={[styles.patternTagText, { color: defensiveTagColor(patterns.defensiveTag) }]}>{patterns.defensiveTag} D</Text>
          </View>
        )}
      </View>

      <View style={styles.patternMetricsRow}>
        <View style={styles.patternMetricCell}>
          <Text style={styles.patternMetricVal}>{patterns.avgScored != null ? patterns.avgScored.toFixed(2) : "—"}</Text>
          <Text style={styles.patternMetricLabel}>Goals/match</Text>
        </View>
        <View style={styles.patternMetricCell}>
          <Text style={styles.patternMetricVal}>{patterns.avgConceded != null ? patterns.avgConceded.toFixed(2) : "—"}</Text>
          <Text style={styles.patternMetricLabel}>Conceded/match</Text>
        </View>
        <View style={styles.patternMetricCell}>
          <Text style={styles.patternMetricVal}>{patterns.xgPerMatch != null ? patterns.xgPerMatch.toFixed(2) : "—"}</Text>
          <Text style={styles.patternMetricLabel}>xG/match</Text>
        </View>
        <View style={styles.patternMetricCell}>
          <Text style={[styles.patternMetricVal, { color: tagColor }]}>
            {patterns.xgDelta != null ? `${patterns.xgDelta > 0 ? "+" : ""}${patterns.xgDelta.toFixed(2)}` : "—"}
          </Text>
          <Text style={styles.patternMetricLabel}>vs xG</Text>
        </View>
        <View style={styles.patternMetricCell}>
          <Text style={styles.patternMetricVal}>{patterns.xgAgainstPerMatch != null ? patterns.xgAgainstPerMatch.toFixed(2) : "—"}</Text>
          <Text style={styles.patternMetricLabel}>xGA/match</Text>
        </View>
        <View style={styles.patternMetricCell}>
          <Text style={styles.patternMetricVal}>{patterns.bigChancesPerMatch != null ? patterns.bigChancesPerMatch.toFixed(1) : "—"}</Text>
          <Text style={styles.patternMetricLabel}>Big chances</Text>
        </View>
        <View style={styles.patternMetricCell}>
          <Text style={[styles.patternMetricVal, { color: (patterns.bigChancesMissedPerMatch ?? 0) >= 1.5 ? "#f97316" : Colors.dark.text }]}>
            {patterns.bigChancesMissedPerMatch != null ? patterns.bigChancesMissedPerMatch.toFixed(1) : "—"}
          </Text>
          <Text style={styles.patternMetricLabel}>BC missed</Text>
        </View>
      </View>

      <View style={styles.patternLegendRow}>
        <View style={styles.patternLegendItem}>
          <View style={[styles.patternLegendDot, { backgroundColor: "#22c55e" }]} />
          <Text style={styles.patternLegendText}>Scored</Text>
        </View>
        <View style={styles.patternLegendItem}>
          <View style={[styles.patternLegendDot, { backgroundColor: "#ef4444" }]} />
          <Text style={styles.patternLegendText}>Conceded</Text>
        </View>
        <Text style={styles.patternLegendMeta}>
          {patterns.totalScored} scored · {patterns.totalConceded} conceded · {patterns.matchesWithIncidents}/{patterns.matchesAnalyzed} matches
        </Text>
      </View>

      {patterns.buckets.map((b) => (
        <PatternHeatRow
          key={b.label}
          bucket={b}
          side={side}
          maxScored={maxScored}
          maxConceded={maxConceded}
        />
      ))}

      <View style={styles.patternFactsRow}>
        {patterns.peakScoringWindow && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>Peak window</Text>
            <Text style={[styles.patternFactValue, { color: "#22c55e" }]}>
              {patterns.peakScoringWindow}
              {patterns.peakScoringPct != null ? ` · ${patterns.peakScoringPct.toFixed(0)}%` : ""}
            </Text>
          </View>
        )}
        {patterns.vulnerabilityWindow && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>Vulnerability</Text>
            <Text style={[styles.patternFactValue, { color: "#ef4444" }]}>
              {patterns.vulnerabilityWindow}
              {patterns.vulnerabilityPct != null ? ` · ${patterns.vulnerabilityPct.toFixed(0)}%` : ""}
            </Text>
          </View>
        )}
        {patterns.avgFirstGoalMin != null && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>Avg 1st goal</Text>
            <Text style={styles.patternFactValue}>{patterns.avgFirstGoalMin.toFixed(0)}′</Text>
          </View>
        )}
        {patterns.avgFirstConcededMin != null && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>Avg 1st conceded</Text>
            <Text style={styles.patternFactValue}>{patterns.avgFirstConcededMin.toFixed(0)}′</Text>
          </View>
        )}
        {patterns.scoredFirstRate != null && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>Score first</Text>
            <Text style={styles.patternFactValue}>
              {patterns.scoredFirstRate.toFixed(0)}%
              {patterns.winWhenScoredFirst != null ? ` · ${patterns.winWhenScoredFirst.toFixed(0)}% wins` : ""}
            </Text>
          </View>
        )}
        {patterns.concededFirstRate != null && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>Concede first</Text>
            <Text style={styles.patternFactValue}>
              {patterns.concededFirstRate.toFixed(0)}%
              {patterns.comebackRate != null ? ` · ${patterns.comebackRate.toFixed(0)}% rescue` : ""}
            </Text>
          </View>
        )}
        {patterns.cleanSheetRate != null && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>Clean sheets</Text>
            <Text style={styles.patternFactValue}>{patterns.cleanSheetRate.toFixed(0)}%</Text>
          </View>
        )}
        {patterns.failedToScoreRate != null && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>Failed to score</Text>
            <Text style={styles.patternFactValue}>{patterns.failedToScoreRate.toFixed(0)}%</Text>
          </View>
        )}
        {patterns.bttsRate != null && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>BTTS</Text>
            <Text style={styles.patternFactValue}>{patterns.bttsRate.toFixed(0)}%</Text>
          </View>
        )}
        {patterns.over25Rate != null && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>Over 2.5</Text>
            <Text style={styles.patternFactValue}>{patterns.over25Rate.toFixed(0)}%</Text>
          </View>
        )}
        {patterns.blownLeadRate != null && patterns.blownLeadRate > 0 && (
          <View style={styles.patternFact}>
            <Text style={styles.patternFactLabel}>Blown leads</Text>
            <Text style={[styles.patternFactValue, { color: "#f97316" }]}>{patterns.blownLeadRate.toFixed(0)}%</Text>
          </View>
        )}
      </View>

      {patterns.styleTags.length > 0 && (
        <View style={styles.patternTagsWrap}>
          {patterns.styleTags.map((tag, i) => (
            <View key={`${tag}-${i}`} style={styles.patternStyleTag}>
              <Text style={styles.patternStyleTagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {patterns.recurringPatterns && patterns.recurringPatterns.length > 0 && (
        <View style={styles.recurringWrap}>
          <Text style={styles.recurringHeading}>Recurring patterns</Text>
          {patterns.recurringPatterns.slice(0, 6).map((rp) => (
            <View key={rp.key} style={styles.recurringRow}>
              <View style={styles.recurringHeader}>
                <Text style={styles.recurringLabel}>{rp.label}</Text>
                <Text style={styles.recurringCount}>{rp.count}/{rp.total}</Text>
              </View>
              {rp.evidence ? <Text style={styles.recurringEvidence}>{rp.evidence}</Text> : null}
            </View>
          ))}
        </View>
      )}

      {patterns.matchStories && patterns.matchStories.length > 0 && (
        <View style={styles.storiesWrap}>
          <Text style={styles.recurringHeading}>Match-by-match (last {patterns.matchStories.length})</Text>
          {patterns.matchStories.slice(0, 8).map((s) => {
            const resColor = s.result === "W" ? "#22c55e" : s.result === "L" ? "#ef4444" : "#94a3b8";
            const xgTxt = s.xgFor != null && s.xgAgainst != null
              ? `xG ${s.xgFor.toFixed(1)}-${s.xgAgainst.toFixed(1)}`
              : null;
            return (
              <View key={s.eventId} style={styles.storyRow}>
                <View style={styles.storyTopLine}>
                  <Text style={[styles.storyResult, { color: resColor }]}>{s.result}</Text>
                  <Text style={styles.storyVenue}>{s.venue}</Text>
                  <Text style={styles.storyOpp} numberOfLines={1}>{s.opponent}</Text>
                  <Text style={styles.storyScore}>{s.goalsFor}-{s.goalsAgainst}</Text>
                  {xgTxt && <Text style={styles.storyXg}>{xgTxt}</Text>}
                </View>
                {s.narratives.length > 0 && (
                  <View style={styles.storyNarrativeWrap}>
                    {s.narratives.slice(0, 3).map((n) => (
                      <View key={n} style={styles.storyNarrativeChip}>
                        <Text style={styles.storyNarrativeText}>{narrativeChipLabel(n)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function narrativeChipLabel(n: MatchNarrative): string {
  switch (n) {
    case "unluckyLoss":     return "unlucky loss";
    case "wastedDominance": return "wasted dominance";
    case "luckyWin":        return "lucky win";
    case "smashAndGrab":    return "smash & grab";
    case "dominantWin":     return "dominant";
    case "exploitedWeakDef":return "exploited weak D";
    case "outclassed":      return "outclassed";
    case "comeback":        return "comeback";
    case "blewLead":        return "blew lead";
    case "openTradeoff":    return "open trade-off";
    case "lateShow":        return "late show";
    case "fastStart":       return "fast start";
    case "deadlock":        return "deadlock";
  }
}

function ScoringPatternsCard({
  homeTeamName,
  awayTeamName,
  homePatterns,
  awayPatterns,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homePatterns?: ScoringPatterns | null;
  awayPatterns?: ScoringPatterns | null;
}) {
  if (!homePatterns && !awayPatterns) return null;
  const hasAny =
    (homePatterns?.matchesWithIncidents || 0) > 0 ||
    (awayPatterns?.matchesWithIncidents || 0) > 0;
  if (!hasAny) return null;

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Scoring & Conceding Patterns · Last 15</Text>
      <Text style={styles.patternIntro}>
        Goal-timing fingerprint per team — when they strike, when they leak, and what makes them deadly or flop versus their xG.
      </Text>
      <PatternSideBlock teamName={homeTeamName} side="home" patterns={homePatterns} />
      <View style={{ height: 12 }} />
      <PatternSideBlock teamName={awayTeamName} side="away" patterns={awayPatterns} />
    </View>
  );
}

function repeatColor(r: Repeatability): string {
  return r === "repeatable" ? "#22c55e" : r === "variance" ? "#ef4444" : "#eab308";
}
function repeatLabel(r: Repeatability): string {
  return r === "repeatable" ? "REPEATABLE" : r === "variance" ? "VARIANCE" : "MIXED";
}
function leanColor(lean: string): string {
  if (lean === "Yes" || lean === "Over") return "#22c55e";
  if (lean === "No" || lean === "Under") return "#ef4444";
  if (lean.startsWith("Lean")) return "#f59e0b";
  return "#94a3b8";
}
function resultColor(r: "W" | "D" | "L"): string {
  return r === "W" ? "#22c55e" : r === "L" ? "#ef4444" : "#eab308";
}

function CausalSideBlock({ teamName, side, profile }: { teamName: string; side: "home" | "away"; profile?: CausalProfile | null }) {
  const sideColor = side === "home" ? "#3b82f6" : "#a855f7";
  if (!profile || profile.matchesAnalyzed === 0) {
    return (
      <View style={styles.hiddenBlock}>
        <View style={styles.patternHeader}>
          <View style={[styles.patternSideDot, { backgroundColor: sideColor }]} />
          <Text style={[styles.patternTeam, { color: sideColor }]} numberOfLines={1}>{teamName}</Text>
        </View>
        <Text style={styles.hiddenEmpty}>Not enough data to build a causal profile.</Text>
      </View>
    );
  }

  return (
    <View style={styles.hiddenBlock}>
      <View style={styles.patternHeader}>
        <View style={[styles.patternSideDot, { backgroundColor: sideColor }]} />
        <Text style={[styles.patternTeam, { color: sideColor }]} numberOfLines={1}>{teamName}</Text>
        <Text style={styles.hiddenCount}>{profile.matchesAnalyzed} matches</Text>
      </View>

      {/* Repeatable vs Variance bar */}
      <View style={styles.causalRepeatRow}>
        <View style={styles.causalRepeatBar}>
          <View style={[styles.causalRepeatSegment, { flex: profile.repeatableShare, backgroundColor: "#22c55e" }]} />
          <View style={[styles.causalRepeatSegment, { flex: profile.mixedShare,      backgroundColor: "#eab308" }]} />
          <View style={[styles.causalRepeatSegment, { flex: profile.varianceShare,   backgroundColor: "#ef4444" }]} />
        </View>
        <View style={styles.causalRepeatLegend}>
          <Text style={[styles.causalRepeatChip, { color: "#22c55e" }]}>Repeatable {profile.repeatableShare}%</Text>
          <Text style={[styles.causalRepeatChip, { color: "#eab308" }]}>Mixed {profile.mixedShare}%</Text>
          <Text style={[styles.causalRepeatChip, { color: "#ef4444" }]}>Variance {profile.varianceShare}%</Text>
        </View>
      </View>

      {/* Causes breakdown */}
      <Text style={styles.causalSection}>Why results happened</Text>
      {profile.causes.map((c) => {
        const col = repeatColor(c.repeatability);
        return (
          <View key={c.cause} style={[styles.causalCauseRow, { borderLeftColor: col }]}>
            <View style={styles.causalCauseTop}>
              <Text style={styles.causalCauseLabel}>{c.label}</Text>
              <View style={styles.causalCauseRight}>
                <Text style={[styles.causalCauseTag, { color: col, borderColor: col }]}>{repeatLabel(c.repeatability)}</Text>
                <Text style={styles.causalCauseValue}>{c.count} ({c.pct}%)</Text>
              </View>
            </View>
            <View style={styles.causalCauseBarTrack}>
              <View style={[styles.causalCauseBarFill, { width: `${Math.min(100, c.pct)}%`, backgroundColor: col }]} />
            </View>
          </View>
        );
      })}

      {/* Forward-looking leans */}
      <Text style={styles.causalSection}>Forward leans for this fixture</Text>
      {(["btts", "ou25"] as const).map((k) => {
        const lean = k === "btts" ? profile.predictionLeans.btts : profile.predictionLeans.ou25;
        const title = k === "btts" ? "BTTS" : "Over/Under 2.5";
        const col = leanColor(lean.lean);
        return (
          <View key={k} style={[styles.causalLeanRow, { borderLeftColor: col }]}>
            <View style={styles.causalLeanTop}>
              <Text style={styles.causalLeanTitle}>{title}</Text>
              <Text style={[styles.causalLeanValue, { color: col }]}>{lean.lean}{lean.confidence > 0 ? `  ·  ${lean.confidence}%` : ""}</Text>
            </View>
            <Text style={styles.causalLeanReason}>{lean.reason}</Text>
          </View>
        );
      })}
      <View style={styles.causalShape}>
        <Text style={styles.causalShapeLabel}>Likely scoreline shape</Text>
        <Text style={styles.causalShapeValue}>{profile.predictionLeans.scorelineShape}</Text>
      </View>

      {/* Per-match causal log */}
      <Text style={styles.causalSection}>Last {profile.matchesAnalyzed} matches — cause for each result</Text>
      {profile.matches.map((m) => {
        const col = repeatColor(m.repeatability);
        const rc = resultColor(m.result);
        return (
          <View key={m.eventId} style={[styles.causalMatchRow, { borderLeftColor: col }]}>
            <View style={styles.causalMatchTop}>
              <Text style={[styles.causalMatchResult, { color: rc }]}>{m.result}</Text>
              <Text style={styles.causalMatchScore}>{m.scoreline}</Text>
              <Text style={styles.causalMatchOpp} numberOfLines={1}>{m.venue} vs {m.opponent}</Text>
              <Text style={[styles.causalMatchTag, { color: col, borderColor: col }]}>{repeatLabel(m.repeatability)}</Text>
            </View>
            <Text style={styles.causalMatchPrimary}>{m.primaryLabel}</Text>
            <Text style={styles.causalMatchReason}>{m.reason}</Text>
            <View style={styles.causalSubRow}>
              <Text style={[styles.causalSubChip, { color: m.bttsHit ? "#22c55e" : "#ef4444" }]}>BTTS {m.bttsHit ? "Yes" : "No"}</Text>
              <Text style={styles.causalSubReason} numberOfLines={2}>{m.bttsReason}</Text>
            </View>
            <View style={styles.causalSubRow}>
              <Text style={[styles.causalSubChip, { color: m.over25Hit ? "#22c55e" : "#ef4444" }]}>{m.over25Hit ? "Over 2.5" : "Under 2.5"}</Text>
              <Text style={styles.causalSubReason} numberOfLines={2}>{m.ouReason}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function CausalAnalysisCard({
  homeTeamName,
  awayTeamName,
  homeProfile,
  awayProfile,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeProfile?: CausalProfile | null;
  awayProfile?: CausalProfile | null;
}) {
  if (!homeProfile && !awayProfile) return null;
  const hasAny = (homeProfile?.matchesAnalyzed || 0) > 0 || (awayProfile?.matchesAnalyzed || 0) > 0;
  if (!hasAny) return null;

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Causal Analysis · Why Results Happened</Text>
      <Text style={styles.patternIntro}>
        Each of the last 15 results decoded into its underlying cause — defensive structure, tactical deadlock,
        finishing inefficiency, opponent wastefulness, late drop-off, variance, etc. Causes are tagged
        <Text style={{ color: "#22c55e" }}> repeatable</Text>,
        <Text style={{ color: "#eab308" }}> mixed</Text>, or
        <Text style={{ color: "#ef4444" }}> variance</Text>, and the BTTS / Over-Under leans below weight only the repeatable evidence.
      </Text>
      <CausalSideBlock teamName={homeTeamName} side="home" profile={homeProfile} />
      <View style={{ height: 12 }} />
      <CausalSideBlock teamName={awayTeamName} side="away" profile={awayProfile} />
    </View>
  );
}

function signalColor(s: HiddenTruth["signal"]): string {
  switch (s) {
    case "positive": return "#22c55e";
    case "negative": return "#ef4444";
    default: return "#eab308";
  }
}

function HiddenSideBlock({ teamName, side, truths }: { teamName: string; side: "home" | "away"; truths: HiddenTruth[] }) {
  const sideColor = side === "home" ? "#3b82f6" : "#a855f7";
  if (!truths || truths.length === 0) {
    return (
      <View style={styles.hiddenBlock}>
        <View style={styles.patternHeader}>
          <View style={[styles.patternSideDot, { backgroundColor: sideColor }]} />
          <Text style={[styles.patternTeam, { color: sideColor }]} numberOfLines={1}>{teamName}</Text>
        </View>
        <Text style={styles.hiddenEmpty}>No hidden traits surfaced from the last 15 matches.</Text>
      </View>
    );
  }
  return (
    <View style={styles.hiddenBlock}>
      <View style={styles.patternHeader}>
        <View style={[styles.patternSideDot, { backgroundColor: sideColor }]} />
        <Text style={[styles.patternTeam, { color: sideColor }]} numberOfLines={1}>{teamName}</Text>
        <Text style={styles.hiddenCount}>{truths.length} traits</Text>
      </View>
      {truths.map((t) => {
        const c = signalColor(t.signal);
        return (
          <View key={t.key} style={[styles.hiddenRow, { borderLeftColor: c }]}>
            <View style={styles.hiddenRowTop}>
              <Text style={styles.hiddenLabel}>{t.label}</Text>
              <Text style={[styles.hiddenValue, { color: c }]}>{t.value}</Text>
            </View>
            <Text style={styles.hiddenDetail}>{t.detail}</Text>
          </View>
        );
      })}
    </View>
  );
}

function HiddenTruthsCard({
  homeTeamName,
  awayTeamName,
  insights,
}: {
  homeTeamName: string;
  awayTeamName: string;
  insights?: SimulationInsights | null;
}) {
  if (!insights) return null;
  const home = insights.home || [];
  const away = insights.away || [];
  if (home.length === 0 && away.length === 0) return null;

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Hidden Truths · What the Stats Don't Show</Text>
      <Text style={styles.patternIntro}>
        Behavioural and psychological signatures hidden inside the last 15 matches — luck, mindset, reactions to results, give-up strength, style timing.
      </Text>
      <HiddenSideBlock teamName={homeTeamName} side="home" truths={home} />
      <View style={{ height: 12 }} />
      <HiddenSideBlock teamName={awayTeamName} side="away" truths={away} />
    </View>
  );
}

function MatchupCrossRefCard({
  homeTeamName,
  awayTeamName,
  insights,
}: {
  homeTeamName: string;
  awayTeamName: string;
  insights?: SimulationInsights | null;
}) {
  if (!insights || !insights.matchup || insights.matchup.length === 0) return null;
  const refs = insights.matchup;

  const sideColorOf = (k: MatchupCrossRef["forSide"]) =>
    k === "home" ? "#3b82f6" : k === "away" ? "#a855f7" : "#f59e0b";
  const sideTagOf = (k: MatchupCrossRef["forSide"]) =>
    k === "home" ? homeTeamName : k === "away" ? awayTeamName : "Matchup";

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Matchup Cross-Reference · {homeTeamName} vs {awayTeamName}</Text>
      <Text style={styles.patternIntro}>
        Each team's recurring patterns and hidden traits placed side-by-side against the opponent's profile. No score predictions — just where their fingerprints meet.
      </Text>
      {refs.map((r) => {
        const c = sideColorOf(r.forSide);
        return (
          <View key={r.key} style={[styles.crossRefRow, { borderLeftColor: c }]}>
            <View style={styles.crossRefTop}>
              <View style={[styles.crossRefBadge, { borderColor: c }]}>
                <Text style={[styles.crossRefBadgeText, { color: c }]}>{sideTagOf(r.forSide)}</Text>
              </View>
              <Text style={styles.crossRefHeadline}>{r.headline}</Text>
            </View>
            <Text style={styles.crossRefDetail}>{r.detail}</Text>
          </View>
        );
      })}
    </View>
  );
}

interface HalfPatternMatch {
  eventId: number;
  startTimestamp: number;
  opponent: string;
  venue: "H" | "A";
  ftScore: { team: number; opp: number };
  htScore: { team: number; opp: number };
  secondHalfScore: { team: number; opp: number };
  htResult: "W" | "D" | "L";
  ftResult: "W" | "D" | "L";
  goals1H: number;
  goals2H: number;
  highestScoringHalf: "first" | "second" | "equal";
  comebackWin: boolean;
  lostLead: boolean;
  heldLead: boolean;
}

type HalfLean = "first" | "second" | "draw";

interface ContextSignal {
  kind: string;
  label: string;
  leans: HalfLean;
  weight: number;
  detail?: string;
}

interface HalfContextResponse {
  signals: ContextSignal[];
  context: {
    knockout: {
      isKnockout: boolean;
      stage: string | null;
      isSecondLeg: boolean;
      aggregateLead: { team: "home" | "away" | null; goals: number } | null;
      trailingNeedsGoals: boolean;
      legOneScore: { home: number; away: number } | null;
    };
    pressure: {
      home: { status: string; motivation: number; position: number; totalTeams: number; pointsFromSafety: number | null; pointsFromTop: number | null } | null;
      away: { status: string; motivation: number; position: number; totalTeams: number; pointsFromSafety: number | null; pointsFromTop: number | null } | null;
      asymmetry: number;
    };
    fatigue: {
      home: { daysSinceLast: number | null; matchesIn14Days: number; matchesIn21Days: number; fatigueIndex: number };
      away: { daysSinceLast: number | null; matchesIn14Days: number; matchesIn21Days: number; fatigueIndex: number };
      asymmetry: number;
    };
    subPatterns: {
      home: { avgFirstSubMinute: number | null; avgAllSubMinute: number | null; earlySubsRate: number; lateSubsRate: number; conservative: boolean } | null;
      away: { avgFirstSubMinute: number | null; avgAllSubMinute: number | null; earlySubsRate: number; lateSubsRate: number; conservative: boolean } | null;
    };
    styleClash: { description: string; lean: HalfLean } | null;
    odds: { favorite: "home" | "away" | "even" | null; gap: number } | null;
    stage: { label: string; modifier: HalfLean | null };
  };
}

interface HalfPatternResponse {
  summary: {
    matchesAnalyzed: number;
    firstHalfHigherScoring: number;
    secondHalfHigherScoring: number;
    equalScoringHalves: number;
    goalless1HCount: number;
    goalless2HCount: number;
    btts1HCount: number;
    btts2HCount: number;
    bttsFtCount: number;
    scored1HCount: number;
    scored2HCount: number;
    conceded1HCount: number;
    conceded2HCount: number;
    cleanSheet1HCount: number;
    cleanSheet2HCount: number;
    cleanSheetFtCount: number;
    totals: {
      scored1H: number; scored2H: number;
      conceded1H: number; conceded2H: number;
      scoredTotal: number; concededTotal: number;
    };
    averages: null | {
      scored1H: number; scored2H: number;
      conceded1H: number; conceded2H: number;
      goalsPerMatch1H: number; goalsPerMatch2H: number;
    };
    htResults: { W: number; D: number; L: number };
    ftResults: { W: number; D: number; L: number };
    comebackWins: number;
    lostLeads: number;
    heldLeads: number;
    rescuedDraws: number;
    blewDraws: number;
  };
  lean: {
    scoringLean: "Strong starter" | "Strong finisher" | "Balanced";
    defensiveLean: "Slow starter (leaks early)" | "Late wobbler (leaks late)" | "Balanced defence";
    teamGoalShare1H: number;
    teamGoalShare2H: number;
    concededShare1H: number;
    concededShare2H: number;
  };
  matches: HalfPatternMatch[];
}

function HighestScoringHalfCard({
  eventId,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  simulationMetrics,
}: {
  eventId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  simulationMetrics?: SimulationMetricsResponse | null;
}) {
  const exclude = eventId ? `&excludeEventId=${eventId}` : "";
  const homeHP = useQuery<HalfPatternResponse>({
    queryKey: ["/api/team", homeTeamId, `half-patterns?n=7${exclude}`],
    enabled: !!homeTeamId,
  });
  const awayHP = useQuery<HalfPatternResponse>({
    queryKey: ["/api/team", awayTeamId, `half-patterns?n=7${exclude}`],
    enabled: !!awayTeamId,
  });
  const halfCtx = useQuery<HalfContextResponse>({
    queryKey: ["/api/event", eventId, "half-context"],
    enabled: !!eventId,
    staleTime: 5 * 60 * 1000,
  });

  if (homeHP.isLoading || awayHP.isLoading) {
    return (
      <View style={styles.phaseCard}>
        <Text style={styles.cardLabel}>Highest scoring half · prediction</Text>
        <ActivityIndicator size="small" color={Colors.dark.accent} />
      </View>
    );
  }

  const homeRaw = simulationMetrics?.home?.teamMatchStats;
  const homeAdj = simulationMetrics?.home?.teamMatchStatsAdjusted;
  const awayRaw = simulationMetrics?.away?.teamMatchStats;
  const awayAdj = simulationMetrics?.away?.teamMatchStatsAdjusted;
  const homeHpD = homeHP.data;
  const awayHpD = awayHP.data;

  if (!homeRaw && !awayRaw && !homeHpD && !awayHpD) return null;

  const avgN = (...vals: (number | null | undefined)[]): number => {
    const nums = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return nums.length > 0 ? nums.reduce((s, v) => s + v, 0) / nums.length : 0;
  };

  // Build per-team half "expected contribution" combining attacking output and opponent's defensive vulnerability
  const buildContrib = (
    teamRaw?: TeamMatchStats | null,
    teamAdj?: AdjustedTeamMatchStats | null,
    oppRaw?: TeamMatchStats | null,
    oppAdj?: AdjustedTeamMatchStats | null,
    teamHp?: HalfPatternResponse,
    oppHp?: HalfPatternResponse,
  ) => {
    // Attack scores per half (goals + 0.5 * xG signal)
    const teamXg1H = teamAdj?.firstHalf?.avgXg ?? teamRaw?.firstHalf?.avgXg ?? null;
    const teamXg2H = teamAdj?.secondHalf?.avgXg ?? teamRaw?.secondHalf?.avgXg ?? null;
    const attack1H = avgN(
      teamAdj?.firstHalf?.avgGoalsScored,
      teamRaw?.firstHalf?.avgGoalsScored,
      teamHp?.summary?.averages?.scored1H ?? null,
      teamXg1H !== null ? teamXg1H * 0.5 : null,
    );
    const attack2H = avgN(
      teamAdj?.secondHalf?.avgGoalsScored,
      teamRaw?.secondHalf?.avgGoalsScored,
      teamHp?.summary?.averages?.scored2H ?? null,
      teamXg2H !== null ? teamXg2H * 0.5 : null,
    );

    // Opponent defensive vulnerability per half
    const oppXga1H = oppAdj?.firstHalf?.avgGoalsConceded ?? oppRaw?.firstHalf?.avgGoalsConceded ?? null;
    const oppXga2H = oppAdj?.secondHalf?.avgGoalsConceded ?? oppRaw?.secondHalf?.avgGoalsConceded ?? null;
    const concede1H = avgN(
      oppAdj?.firstHalf?.avgGoalsConceded,
      oppRaw?.firstHalf?.avgGoalsConceded,
      oppHp?.summary?.averages?.conceded1H ?? null,
      oppXga1H,
    );
    const concede2H = avgN(
      oppAdj?.secondHalf?.avgGoalsConceded,
      oppRaw?.secondHalf?.avgGoalsConceded,
      oppHp?.summary?.averages?.conceded2H ?? null,
      oppXga2H,
    );

    return {
      h1: (attack1H + concede1H) / 2,
      h2: (attack2H + concede2H) / 2,
      attack1H, attack2H, concede1H, concede2H,
    };
  };

  const homeC = buildContrib(homeRaw, homeAdj, awayRaw, awayAdj, homeHpD, awayHpD);
  const awayC = buildContrib(awayRaw, awayAdj, homeRaw, homeAdj, awayHpD, homeHpD);

  const total1H = homeC.h1 + awayC.h1;
  const total2H = homeC.h2 + awayC.h2;
  const totalExpected = total1H + total2H;
  const diff = total2H - total1H;
  const maxT = Math.max(total1H, total2H);
  const marginPct = maxT > 0 ? Math.abs(diff) / maxT : 0;

  type Verdict = "first" | "second" | "draw";

  // Build reasoning signals (each says which side it leans + magnitude)
  type Signal = { text: string; leans: Verdict; weight: number };
  const signals: Signal[] = [];
  // signalDelta now scales weight by absolute magnitude. When both sides are
  // tiny (e.g. 0.05 vs 0.10), the relative ratio is 50% but the absolute
  // signal is noise; we cap such weights so they cannot dominate the tally.
  const signalDelta = (
    a: number | null | undefined,
    b: number | null | undefined,
    noiseFloor = 0.4,
  ): { leans: Verdict; weight: number } => {
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return { leans: "draw", weight: 0 };
    const d = b - a;
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m === 0) return { leans: "draw", weight: 0 };
    const ratio = Math.abs(d) / m;
    const magnitudeScale = Math.min(1, m / noiseFloor); // 0..1
    const weight = ratio * magnitudeScale;
    return { leans: ratio < 0.10 ? "draw" : d > 0 ? "second" : "first", weight };
  };

  const push = (text: string, a: number | null | undefined, b: number | null | undefined, noiseFloor = 0.4) => {
    const { leans, weight } = signalDelta(a, b, noiseFloor);
    if (weight > 0) signals.push({ text, leans, weight });
  };

  // Goals per half (raw 15)
  push(
    `${homeTeamName} Last-15 goals 1H vs 2H: ${fmtNum(homeRaw?.firstHalf?.avgGoalsScored)} → ${fmtNum(homeRaw?.secondHalf?.avgGoalsScored)}`,
    homeRaw?.firstHalf?.avgGoalsScored, homeRaw?.secondHalf?.avgGoalsScored,
  );
  push(
    `${awayTeamName} Last-15 goals 1H vs 2H: ${fmtNum(awayRaw?.firstHalf?.avgGoalsScored)} → ${fmtNum(awayRaw?.secondHalf?.avgGoalsScored)}`,
    awayRaw?.firstHalf?.avgGoalsScored, awayRaw?.secondHalf?.avgGoalsScored,
  );

  // Goals per half adjusted to comparable opponents
  push(
    `${homeTeamName} vs comparable opp goals 1H vs 2H: ${fmtNum(homeAdj?.firstHalf?.avgGoalsScored)} → ${fmtNum(homeAdj?.secondHalf?.avgGoalsScored)}`,
    homeAdj?.firstHalf?.avgGoalsScored, homeAdj?.secondHalf?.avgGoalsScored,
  );
  push(
    `${awayTeamName} vs comparable opp goals 1H vs 2H: ${fmtNum(awayAdj?.firstHalf?.avgGoalsScored)} → ${fmtNum(awayAdj?.secondHalf?.avgGoalsScored)}`,
    awayAdj?.firstHalf?.avgGoalsScored, awayAdj?.secondHalf?.avgGoalsScored,
  );

  // xG per half
  push(
    `${homeTeamName} xG 1H vs 2H: ${fmtNum(homeRaw?.firstHalf?.avgXg)} → ${fmtNum(homeRaw?.secondHalf?.avgXg)}`,
    homeRaw?.firstHalf?.avgXg, homeRaw?.secondHalf?.avgXg,
  );
  push(
    `${awayTeamName} xG 1H vs 2H: ${fmtNum(awayRaw?.firstHalf?.avgXg)} → ${fmtNum(awayRaw?.secondHalf?.avgXg)}`,
    awayRaw?.firstHalf?.avgXg, awayRaw?.secondHalf?.avgXg,
  );

  // Big chances per half
  push(
    `${homeTeamName} big chances 1H vs 2H: ${fmtNum(homeRaw?.firstHalf?.avgBigChances)} → ${fmtNum(homeRaw?.secondHalf?.avgBigChances)}`,
    homeRaw?.firstHalf?.avgBigChances, homeRaw?.secondHalf?.avgBigChances,
  );
  push(
    `${awayTeamName} big chances 1H vs 2H: ${fmtNum(awayRaw?.firstHalf?.avgBigChances)} → ${fmtNum(awayRaw?.secondHalf?.avgBigChances)}`,
    awayRaw?.firstHalf?.avgBigChances, awayRaw?.secondHalf?.avgBigChances,
  );

  // Opp defensive vulnerability — concedes more in which half
  push(
    `${awayTeamName} concedes per half: ${fmtNum(awayRaw?.firstHalf?.avgGoalsConceded)} → ${fmtNum(awayRaw?.secondHalf?.avgGoalsConceded)} (defensive lean)`,
    awayRaw?.firstHalf?.avgGoalsConceded, awayRaw?.secondHalf?.avgGoalsConceded,
  );
  push(
    `${homeTeamName} concedes per half: ${fmtNum(homeRaw?.firstHalf?.avgGoalsConceded)} → ${fmtNum(homeRaw?.secondHalf?.avgGoalsConceded)} (defensive lean)`,
    homeRaw?.firstHalf?.avgGoalsConceded, homeRaw?.secondHalf?.avgGoalsConceded,
  );

  // Last 7 half patterns: scored/conceded counts
  if (homeHpD?.summary) {
    push(
      `${homeTeamName} Last 7 — scored 1H ${homeHpD.summary.scored1HCount}/${homeHpD.summary.matchesAnalyzed}, scored 2H ${homeHpD.summary.scored2HCount}/${homeHpD.summary.matchesAnalyzed}`,
      homeHpD.summary.scored1HCount, homeHpD.summary.scored2HCount,
    );
    push(
      `${homeTeamName} Last 7 — conceded 1H ${homeHpD.summary.conceded1HCount}/${homeHpD.summary.matchesAnalyzed}, conceded 2H ${homeHpD.summary.conceded2HCount}/${homeHpD.summary.matchesAnalyzed}`,
      homeHpD.summary.conceded1HCount, homeHpD.summary.conceded2HCount,
    );
    push(
      `Last 7 — BTTS 1H ${homeHpD.summary.btts1HCount}, BTTS 2H ${homeHpD.summary.btts2HCount} (${homeTeamName})`,
      homeHpD.summary.btts1HCount, homeHpD.summary.btts2HCount,
    );
  }
  if (awayHpD?.summary) {
    push(
      `${awayTeamName} Last 7 — scored 1H ${awayHpD.summary.scored1HCount}/${awayHpD.summary.matchesAnalyzed}, scored 2H ${awayHpD.summary.scored2HCount}/${awayHpD.summary.matchesAnalyzed}`,
      awayHpD.summary.scored1HCount, awayHpD.summary.scored2HCount,
    );
    push(
      `${awayTeamName} Last 7 — conceded 1H ${awayHpD.summary.conceded1HCount}/${awayHpD.summary.matchesAnalyzed}, conceded 2H ${awayHpD.summary.conceded2HCount}/${awayHpD.summary.matchesAnalyzed}`,
      awayHpD.summary.conceded1HCount, awayHpD.summary.conceded2HCount,
    );
  }

  // Lean tags from half patterns
  const leanText = (lean?: HalfPatternResponse["lean"]): { who: Verdict; t: string } | null => {
    if (!lean) return null;
    if (lean.scoringLean === "Strong starter") return { who: "first", t: `lean: Strong starter (${Math.round(lean.teamGoalShare1H * 100)}% goals 1H)` };
    if (lean.scoringLean === "Strong finisher") return { who: "second", t: `lean: Strong finisher (${Math.round(lean.teamGoalShare2H * 100)}% goals 2H)` };
    return { who: "draw", t: `lean: Balanced scorer` };
  };
  const homeLean = leanText(homeHpD?.lean);
  const awayLean = leanText(awayHpD?.lean);
  if (homeLean && homeLean.who !== "draw") signals.push({ text: `${homeTeamName} ${homeLean.t}`, leans: homeLean.who, weight: 0.5 });
  if (awayLean && awayLean.who !== "draw") signals.push({ text: `${awayTeamName} ${awayLean.t}`, leans: awayLean.who, weight: 0.5 });

  // ─── Goalless-fixture awareness ──────────────────────────────────────────
  // If both teams frequently produce goalless halves (Last 7) or the absolute
  // expected goals are low, push a draw-leaning signal so the verdict can land
  // on "Draw / Even" instead of forcing one half to win on noise.
  const matchesH = homeHpD?.summary?.matchesAnalyzed || 0;
  const matchesA = awayHpD?.summary?.matchesAnalyzed || 0;
  const goallessHomeAny =
    matchesH > 0
      ? ((homeHpD?.summary?.goalless1HCount || 0) + (homeHpD?.summary?.goalless2HCount || 0)) /
        (2 * matchesH)
      : null;
  const goallessAwayAny =
    matchesA > 0
      ? ((awayHpD?.summary?.goalless1HCount || 0) + (awayHpD?.summary?.goalless2HCount || 0)) /
        (2 * matchesA)
      : null;
  const goallessAvg =
    goallessHomeAny != null && goallessAwayAny != null
      ? (goallessHomeAny + goallessAwayAny) / 2
      : (goallessHomeAny ?? goallessAwayAny ?? 0);

  if (goallessAvg >= 0.4 && matchesH > 0 && matchesA > 0) {
    signals.push({
      text: `Goalless-half rate: ${homeTeamName} ${Math.round((goallessHomeAny || 0) * 100)}% · ${awayTeamName} ${Math.round((goallessAwayAny || 0) * 100)}% — high chance both halves stay quiet`,
      leans: "draw",
      weight: Math.min(1.5, goallessAvg * 1.6),
    });
  }
  if (totalExpected > 0 && totalExpected < 2.0) {
    signals.push({
      text: `Total expected goals only ${totalExpected.toFixed(2)} — low-scoring fixture, halves likely close`,
      leans: "draw",
      weight: Math.min(1.2, (2.0 - totalExpected) * 0.9),
    });
  }

  // Merge in context-aware signals from /api/event/:id/half-context
  const ctxData = halfCtx.data;
  const contextSignals: Signal[] = (ctxData?.signals || []).map((s) => ({
    text: s.label,
    leans: s.leans,
    weight: s.weight,
  }));
  signals.push(...contextSignals);

  signals.sort((a, b) => b.weight - a.weight);
  const topSignals = signals.slice(0, 10);

  // Tally signal alignment
  const tally = signals.reduce(
    (acc, s) => {
      if (s.leans === "first") acc.first += s.weight;
      else if (s.leans === "second") acc.second += s.weight;
      else acc.draw += s.weight;
      return acc;
    },
    { first: 0, second: 0, draw: 0 },
  );

  // ─── Verdict & confidence from BOTH expected goals and signal tally ──────
  // Re-derive verdict so that:
  //   1. A strong "draw" tally (e.g. goalless-fixture risk) can win
  //   2. Confidence is capped when total expected goals are modest
  const tallyTotal = tally.first + tally.second + tally.draw;
  const tallyMaxKey: Verdict =
    tally.first >= tally.second && tally.first >= tally.draw
      ? "first"
      : tally.second >= tally.draw
        ? "second"
        : "draw";
  const tallyMax = Math.max(tally.first, tally.second, tally.draw);
  const tallyShare = tallyTotal > 0 ? tallyMax / tallyTotal : 0;

  // Goal-margin based verdict (the legacy behaviour)
  const goalVerdict: Verdict = marginPct < 0.10 ? "draw" : diff > 0 ? "second" : "first";

  // Final verdict: prefer the tally winner unless it's only marginally ahead
  // of the goal-based verdict.
  let verdict: Verdict;
  if (tallyShare >= 0.45 && tallyMaxKey !== goalVerdict && tally.draw === tallyMax) {
    verdict = "draw"; // strong draw signal overrides
  } else if (tallyShare >= 0.55) {
    verdict = tallyMaxKey;
  } else {
    verdict = goalVerdict;
  }

  // Confidence: based on (margin between top tally and runner-up) AND total
  // expected goals magnitude. Modest totals → cap at Medium. Tiny totals → Low.
  const sortedTally = [tally.first, tally.second, tally.draw].sort((a, b) => b - a);
  const tallyMargin = tallyTotal > 0 ? (sortedTally[0] - sortedTally[1]) / tallyTotal : 0;
  let confidence: "Low" | "Medium" | "High" =
    tallyMargin >= 0.35 ? "High" : tallyMargin >= 0.15 ? "Medium" : "Low";
  if (totalExpected < 1.5) confidence = "Low";
  else if (totalExpected < 2.3 && confidence === "High") confidence = "Medium";

  const verdictLabel = verdict === "first" ? "First Half" : verdict === "second" ? "Second Half" : "Draw / Even";
  const verdictColor = verdict === "draw" ? "#eab308" : verdict === "second" ? "#3b82f6" : "#f97316";

  const fmt2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
  const verdictBadgeColor = (v: Verdict) =>
    v === "first" ? "#f97316" : v === "second" ? "#3b82f6" : "#eab308";

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Highest scoring half · prediction</Text>

      <View style={[styles.verdictBox, { borderColor: verdictColor + "55", backgroundColor: verdictColor + "18" }]}>
        <View style={styles.verdictHead}>
          <Text style={styles.verdictKicker}>Predicted highest-scoring half</Text>
          <Text style={[styles.verdictTag, { color: verdictColor }]}>{confidence} conf.</Text>
        </View>
        <Text style={[styles.verdictTitle, { color: verdictColor }]}>{verdictLabel}</Text>
        <Text style={styles.verdictSub}>
          Expected goals — 1H {fmt2(total1H)} · 2H {fmt2(total2H)} · margin {(marginPct * 100).toFixed(0)}%
        </Text>
        <Text style={styles.verdictSub}>
          Signal tally — 1H {fmt2(tally.first)} · 2H {fmt2(tally.second)} · even {fmt2(tally.draw)}
        </Text>
      </View>

      <View style={styles.statsHeaderRow}>
        <Text style={[styles.statsHeaderTeam, { color: Colors.dark.homeKit }]} numberOfLines={1}>{homeTeamName}</Text>
        <Text style={styles.statsHeaderLabel}>Per-team expected</Text>
        <Text style={[styles.statsHeaderTeam, { color: Colors.dark.awayKit }]} numberOfLines={1}>{awayTeamName}</Text>
      </View>
      <View style={styles.statsRow}>
        <Text style={[styles.statsValue, { color: Colors.dark.text }]}>{fmt2(homeC.h1)}</Text>
        <Text style={styles.statsLabel}>1H xGoals (attack ⊕ opp leak)</Text>
        <Text style={[styles.statsValue, { color: Colors.dark.text, textAlign: "right" }]}>{fmt2(awayC.h1)}</Text>
      </View>
      <View style={styles.statsRow}>
        <Text style={[styles.statsValue, { color: Colors.dark.text }]}>{fmt2(homeC.h2)}</Text>
        <Text style={styles.statsLabel}>2H xGoals (attack ⊕ opp leak)</Text>
        <Text style={[styles.statsValue, { color: Colors.dark.text, textAlign: "right" }]}>{fmt2(awayC.h2)}</Text>
      </View>

      {ctxData ? (
        <View style={{ marginTop: 10, padding: 8, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.04)" }}>
          <Text style={[styles.statsSectionLabel, { marginBottom: 4 }]}>Match-day context</Text>
          {ctxData.context.knockout.isKnockout && (
            <Text style={styles.signalText}>
              Stage: {ctxData.context.knockout.stage}
              {ctxData.context.knockout.isSecondLeg && ctxData.context.knockout.legOneScore
                ? ` · 2nd leg (leg 1: ${ctxData.context.knockout.legOneScore.home}-${ctxData.context.knockout.legOneScore.away})`
                : ""}
            </Text>
          )}
          {(ctxData.context.pressure.home || ctxData.context.pressure.away) && (
            <Text style={styles.signalText}>
              Standings —{" "}
              {ctxData.context.pressure.home
                ? `${homeTeamName}: #${ctxData.context.pressure.home.position}/${ctxData.context.pressure.home.totalTeams} (${ctxData.context.pressure.home.status})`
                : ""}
              {ctxData.context.pressure.home && ctxData.context.pressure.away ? " · " : ""}
              {ctxData.context.pressure.away
                ? `${awayTeamName}: #${ctxData.context.pressure.away.position}/${ctxData.context.pressure.away.totalTeams} (${ctxData.context.pressure.away.status})`
                : ""}
            </Text>
          )}
          {(ctxData.context.fatigue.home.daysSinceLast != null || ctxData.context.fatigue.away.daysSinceLast != null) && (
            <Text style={styles.signalText}>
              Rest — {homeTeamName}: {ctxData.context.fatigue.home.daysSinceLast ?? "?"}d
              ({ctxData.context.fatigue.home.matchesIn21Days} in 21d) · {awayTeamName}:{" "}
              {ctxData.context.fatigue.away.daysSinceLast ?? "?"}d ({ctxData.context.fatigue.away.matchesIn21Days} in 21d)
            </Text>
          )}
          {(ctxData.context.subPatterns.home?.avgFirstSubMinute || ctxData.context.subPatterns.away?.avgFirstSubMinute) && (
            <Text style={styles.signalText}>
              First sub avg — {homeTeamName}: {ctxData.context.subPatterns.home?.avgFirstSubMinute ?? "?"}'
              {ctxData.context.subPatterns.home?.conservative ? " (conservative)" : ""} ·{" "}
              {awayTeamName}: {ctxData.context.subPatterns.away?.avgFirstSubMinute ?? "?"}'
              {ctxData.context.subPatterns.away?.conservative ? " (conservative)" : ""}
            </Text>
          )}
        </View>
      ) : halfCtx.isLoading ? (
        <Text style={[styles.signalText, { marginTop: 8, opacity: 0.6 }]}>Loading match-day context…</Text>
      ) : null}

      <Text style={[styles.statsSectionLabel, { marginTop: 10 }]}>Top reasoning signals</Text>
      {topSignals.length === 0 ? (
        <Text style={styles.statsNoData}>Not enough data to derive signals.</Text>
      ) : topSignals.map((s, i) => (
        <View key={i} style={styles.signalRow}>
          <View style={[styles.signalDot, { backgroundColor: verdictBadgeColor(s.leans) }]} />
          <Text style={styles.signalText}>{s.text}</Text>
          <Text style={[styles.signalLeans, { color: verdictBadgeColor(s.leans) }]}>
            {s.leans === "first" ? "1H" : s.leans === "second" ? "2H" : "≈"}
          </Text>
        </View>
      ))}

      <Text style={styles.modeCaption}>
        Method: blends Last 15 raw averages, opponent-quality-weighted Last 15, Last 7 half patterns and xG/big-chance half splits. Layered with match-day context: knockout stage, standings pressure & motivation asymmetry, fixture congestion / fatigue, coach sub patterns, style clash. Margin under 10% returns Draw.
      </Text>
    </View>
  );
}

function HalfPatternsCard({
  eventId,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
}: {
  eventId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const exclude = eventId ? `&excludeEventId=${eventId}` : "";
  const homeQuery = useQuery<HalfPatternResponse>({
    queryKey: ["/api/team", homeTeamId, `half-patterns?n=7${exclude}`],
    enabled: !!homeTeamId,
  });
  const awayQuery = useQuery<HalfPatternResponse>({
    queryKey: ["/api/team", awayTeamId, `half-patterns?n=7${exclude}`],
    enabled: !!awayTeamId,
  });

  const isLoading = homeQuery.isLoading || awayQuery.isLoading;
  const home = homeQuery.data;
  const away = awayQuery.data;

  if (isLoading) {
    return (
      <View style={styles.phaseCard}>
        <Text style={styles.cardLabel}>Half-by-half scoring patterns · Last 7</Text>
        <ActivityIndicator size="small" color={Colors.dark.accent} />
      </View>
    );
  }

  if (!home && !away) return null;
  if ((home?.summary.matchesAnalyzed || 0) === 0 && (away?.summary.matchesAnalyzed || 0) === 0) {
    return (
      <View style={styles.phaseCard}>
        <Text style={styles.cardLabel}>Half-by-half scoring patterns · Last 7</Text>
        <Text style={styles.statsNoData}>No completed matches with half-time data available.</Text>
      </View>
    );
  }

  const matchesLabel = `${home?.summary.matchesAnalyzed ?? 0}/${away?.summary.matchesAnalyzed ?? 0} matches`;

  const cmpRows: { label: string; note?: string; pick: (d?: HalfPatternResponse) => string; higherIsBetter?: "home" | "away" | null; sortVal?: (d?: HalfPatternResponse) => number | null }[] = [
    {
      label: "Highest scoring half",
      note: "1H more / 2H more / equal goals",
      pick: (d) => d ? `${d.summary.firstHalfHigherScoring} · ${d.summary.secondHalfHigherScoring} · ${d.summary.equalScoringHalves}` : "—",
    },
    {
      label: "0-0 first half",
      note: "matches with no 1H goals (either side)",
      pick: (d) => d ? `${d.summary.goalless1HCount}/${d.summary.matchesAnalyzed}` : "—",
      sortVal: (d) => d ? d.summary.goalless1HCount : null,
    },
    {
      label: "0-0 second half",
      note: "matches with no 2H goals",
      pick: (d) => d ? `${d.summary.goalless2HCount}/${d.summary.matchesAnalyzed}` : "—",
      sortVal: (d) => d ? d.summary.goalless2HCount : null,
    },
    {
      label: "Scored in 1H",
      pick: (d) => d ? `${d.summary.scored1HCount}/${d.summary.matchesAnalyzed}` : "—",
      sortVal: (d) => d ? d.summary.scored1HCount : null,
    },
    {
      label: "Scored in 2H",
      pick: (d) => d ? `${d.summary.scored2HCount}/${d.summary.matchesAnalyzed}` : "—",
      sortVal: (d) => d ? d.summary.scored2HCount : null,
    },
    {
      label: "Conceded in 1H",
      pick: (d) => d ? `${d.summary.conceded1HCount}/${d.summary.matchesAnalyzed}` : "—",
      sortVal: (d) => d ? -d.summary.conceded1HCount : null,
    },
    {
      label: "Conceded in 2H",
      pick: (d) => d ? `${d.summary.conceded2HCount}/${d.summary.matchesAnalyzed}` : "—",
      sortVal: (d) => d ? -d.summary.conceded2HCount : null,
    },
    {
      label: "Clean sheet 1H / 2H / FT",
      pick: (d) => d ? `${d.summary.cleanSheet1HCount} · ${d.summary.cleanSheet2HCount} · ${d.summary.cleanSheetFtCount}` : "—",
    },
    {
      label: "BTTS 1H / 2H / FT",
      pick: (d) => d ? `${d.summary.btts1HCount} · ${d.summary.btts2HCount} · ${d.summary.bttsFtCount}` : "—",
    },
    {
      label: "Avg goals scored 1H · 2H",
      pick: (d) => d?.summary.averages ? `${d.summary.averages.scored1H} · ${d.summary.averages.scored2H}` : "—",
    },
    {
      label: "Avg goals conceded 1H · 2H",
      pick: (d) => d?.summary.averages ? `${d.summary.averages.conceded1H} · ${d.summary.averages.conceded2H}` : "—",
    },
    {
      label: "Avg total goals 1H · 2H",
      pick: (d) => d?.summary.averages ? `${d.summary.averages.goalsPerMatch1H} · ${d.summary.averages.goalsPerMatch2H}` : "—",
    },
    {
      label: "HT result W-D-L",
      pick: (d) => d ? `${d.summary.htResults.W}-${d.summary.htResults.D}-${d.summary.htResults.L}` : "—",
      sortVal: (d) => d ? d.summary.htResults.W : null,
    },
    {
      label: "FT result W-D-L",
      pick: (d) => d ? `${d.summary.ftResults.W}-${d.summary.ftResults.D}-${d.summary.ftResults.L}` : "—",
      sortVal: (d) => d ? d.summary.ftResults.W : null,
    },
    {
      label: "Held HT lead → win",
      pick: (d) => d ? `${d.summary.heldLeads}` : "—",
      sortVal: (d) => d ? d.summary.heldLeads : null,
    },
    {
      label: "Lost HT lead",
      note: "won at HT, didn't win FT",
      pick: (d) => d ? `${d.summary.lostLeads}` : "—",
      sortVal: (d) => d ? -d.summary.lostLeads : null,
    },
    {
      label: "Comeback wins",
      note: "trailing at HT, won FT",
      pick: (d) => d ? `${d.summary.comebackWins}` : "—",
      sortVal: (d) => d ? d.summary.comebackWins : null,
    },
  ];

  function sideColor(home?: number | null, away?: number | null) {
    if (home == null || away == null) return { home: Colors.dark.text, away: Colors.dark.text };
    if (home > away) return { home: "#4ADE80", away: Colors.dark.textTertiary };
    if (away > home) return { home: Colors.dark.textTertiary, away: "#4ADE80" };
    return { home: Colors.dark.text, away: Colors.dark.text };
  }

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Half-by-half scoring patterns · {matchesLabel}</Text>

      <View style={styles.statsHeaderRow}>
        <Text style={[styles.statsHeaderTeam, { color: Colors.dark.homeKit }]} numberOfLines={1}>{homeTeamName}</Text>
        <Text style={styles.statsHeaderLabel}>Last 7</Text>
        <Text style={[styles.statsHeaderTeam, { color: Colors.dark.awayKit }]} numberOfLines={1}>{awayTeamName}</Text>
      </View>

      {cmpRows.map((row) => {
        const colors = sideColor(
          row.sortVal ? row.sortVal(home) : null,
          row.sortVal ? row.sortVal(away) : null,
        );
        return (
          <View key={row.label}>
            <View style={styles.statsRow}>
              <Text style={[styles.statsValue, { color: colors.home }]}>{row.pick(home)}</Text>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={styles.statsLabel}>{row.label}</Text>
                {row.note && <Text style={styles.phaseNote} numberOfLines={1}>{row.note}</Text>}
              </View>
              <Text style={[styles.statsValue, { color: colors.away, textAlign: "right" }]}>{row.pick(away)}</Text>
            </View>
          </View>
        );
      })}

      <View style={styles.phaseRow}>
        <View style={styles.phaseHeader}>
          <Text style={styles.phaseLabel}>Behavioural lean</Text>
          <Text style={styles.phaseNote}>Where each team's goals & concessions cluster</Text>
        </View>
        <View style={styles.phaseScores}>
          <Text style={[styles.phaseScore, { color: Colors.dark.homeKit }]}>
            {homeTeamName}: {home?.lean.scoringLean ?? "—"} · {home?.lean.defensiveLean ?? "—"}
            {home?.lean ? ` (1H ${home.lean.teamGoalShare1H}% / 2H ${home.lean.teamGoalShare2H}% scored)` : ""}
          </Text>
          <Text style={[styles.phaseScore, { color: Colors.dark.awayKit }]}>
            {awayTeamName}: {away?.lean.scoringLean ?? "—"} · {away?.lean.defensiveLean ?? "—"}
            {away?.lean ? ` (1H ${away.lean.teamGoalShare1H}% / 2H ${away.lean.teamGoalShare2H}% scored)` : ""}
          </Text>
        </View>
      </View>

      <HalfPatternMatchList teamName={homeTeamName} color={Colors.dark.homeKit} matches={home?.matches} />
      <HalfPatternMatchList teamName={awayTeamName} color={Colors.dark.awayKit} matches={away?.matches} />
    </View>
  );
}

function HalfPatternMatchList({
  teamName,
  color,
  matches,
}: {
  teamName: string;
  color: string;
  matches?: HalfPatternMatch[];
}) {
  if (!matches || matches.length === 0) return null;
  return (
    <View style={styles.phaseRow}>
      <Text style={[styles.phaseLabel, { color }]} numberOfLines={1}>{teamName} · last {matches.length}</Text>
      {matches.map((m) => {
        const tag =
          m.comebackWin ? "Comeback W" :
          m.lostLead ? "Lost HT lead" :
          m.heldLead ? "Held HT lead" :
          m.htResult === m.ftResult ? `${m.htResult} HT → ${m.ftResult} FT` :
          `${m.htResult} HT → ${m.ftResult} FT`;
        const tagColor =
          m.comebackWin ? "#4ADE80" :
          m.lostLead ? "#F87171" :
          m.heldLead ? "#60A5FA" :
          Colors.dark.textTertiary;
        return (
          <View key={m.eventId} style={styles.halfMatchRow}>
            <Text style={styles.halfMatchVenue}>{m.venue}</Text>
            <Text style={styles.halfMatchOpp} numberOfLines={1}>{m.opponent}</Text>
            <Text style={styles.halfMatchScore}>
              HT {m.htScore.team}-{m.htScore.opp} · 2H {m.secondHalfScore.team}-{m.secondHalfScore.opp} · FT {m.ftScore.team}-{m.ftScore.opp}
            </Text>
            <Text style={[styles.halfMatchTag, { color: tagColor }]} numberOfLines={1}>{tag}</Text>
          </View>
        );
      })}
    </View>
  );
}

type StatMode = "raw" | "adjusted";

function TeamStatsCard({
  homeTeamName,
  awayTeamName,
  homeStats,
  awayStats,
  homeStatsAdjusted,
  awayStatsAdjusted,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeStats?: TeamMatchStats | null;
  awayStats?: TeamMatchStats | null;
  homeStatsAdjusted?: AdjustedTeamMatchStats | null;
  awayStatsAdjusted?: AdjustedTeamMatchStats | null;
}) {
  const [period, setPeriod] = React.useState<StatViewPeriod>("all");
  const [mode, setMode] = React.useState<StatMode>("raw");

  if (!homeStats && !awayStats) return null;
  const matchesAnalyzed = homeStats?.matchesAnalyzed || awayStats?.matchesAnalyzed || 0;
  if (matchesAnalyzed === 0) return null;

  const useAdjusted = mode === "adjusted" && (!!homeStatsAdjusted || !!awayStatsAdjusted);
  const homeSrc = useAdjusted ? homeStatsAdjusted : homeStats;
  const awaySrc = useAdjusted ? awayStatsAdjusted : awayStats;

  const homeP = period === "all" ? homeSrc?.all : period === "firstHalf" ? homeSrc?.firstHalf : homeSrc?.secondHalf;
  const awayP = period === "all" ? awaySrc?.all : period === "firstHalf" ? awaySrc?.firstHalf : awaySrc?.secondHalf;

  // Always grab the raw value as the comparison baseline when in adjusted mode
  const homeRawP = period === "all" ? homeStats?.all : period === "firstHalf" ? homeStats?.firstHalf : homeStats?.secondHalf;
  const awayRawP = period === "all" ? awayStats?.all : period === "firstHalf" ? awayStats?.firstHalf : awayStats?.secondHalf;

  const hasData = (homeP?.matchesWithStats || 0) > 0 || (awayP?.matchesWithStats || 0) > 0 ||
    (homeP?.avgGoalsScored != null) || (awayP?.avgGoalsScored != null);

  const rows = buildStatRows(homeP, awayP);
  const rawRows = buildStatRows(homeRawP, awayRawP);
  const periodLabel = period === "all" ? "Full Match" : period === "firstHalf" ? "1st Half" : "2nd Half";
  const tabs: { key: StatViewPeriod; label: string }[] = [
    { key: "all", label: "Last 15" },
    { key: "firstHalf", label: "1st Half" },
    { key: "secondHalf", label: "2nd Half" },
  ];

  const homeEss = homeStatsAdjusted?.effectiveSampleSize;
  const awayEss = awayStatsAdjusted?.effectiveSampleSize;
  const adjustedAvailable = !!homeStatsAdjusted || !!awayStatsAdjusted;

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>
        Team match stats · {matchesAnalyzed} matches · {homeP?.matchesWithStats || 0}/{awayP?.matchesWithStats || 0} with full data
      </Text>
      <View style={styles.periodToggle}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.periodTab, period === tab.key && styles.periodTabActive]}
            onPress={() => setPeriod(tab.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.periodTabText, period === tab.key && styles.periodTabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {adjustedAvailable && (
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeTab, mode === "raw" && styles.modeTabActive]}
            onPress={() => setMode("raw")}
            activeOpacity={0.75}
          >
            <Text style={[styles.modeTabText, mode === "raw" && styles.modeTabTextActive]}>Raw avg</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeTab, mode === "adjusted" && styles.modeTabActive]}
            onPress={() => setMode("adjusted")}
            activeOpacity={0.75}
          >
            <Text style={[styles.modeTabText, mode === "adjusted" && styles.modeTabTextActive]}>vs Comparable</Text>
          </TouchableOpacity>
        </View>
      )}
      {mode === "adjusted" && (
        <Text style={styles.modeCaption}>
          Each past match weighted by how closely that opponent's performance matched {awayTeamName}/{homeTeamName}'s typical profile.
          {typeof homeEss === "number" && typeof awayEss === "number"
            ? `  Effective sample: ${homeEss.toFixed(1)} / ${awayEss.toFixed(1)} of ${matchesAnalyzed}.`
            : ""}
        </Text>
      )}
      {!hasData ? (
        <Text style={styles.statsNoData}>No {periodLabel.toLowerCase()} statistics available for these matches.</Text>
      ) : (
        <>
          <View style={styles.statsHeaderRow}>
            <Text style={[styles.statsHeaderTeam, { color: Colors.dark.homeKit }]} numberOfLines={1}>{homeTeamName}</Text>
            <Text style={styles.statsHeaderLabel}>{mode === "adjusted" ? `vs Comparable` : `Avg ${periodLabel}`}</Text>
            <Text style={[styles.statsHeaderTeam, { color: Colors.dark.awayKit }]} numberOfLines={1}>{awayTeamName}</Text>
          </View>
          {rows.map((row, index) => {
            const colors = statColor(row.homeVal, row.awayVal, row.higherIsBetter);
            if (row.homeVal == null && row.awayVal == null && !row.section) return null;
            const rawRow = rawRows[index];
            const showDelta = mode === "adjusted" && rawRow;
            const homeDelta = showDelta && rawRow.homeVal != null && row.homeVal != null
              ? Math.round((row.homeVal - rawRow.homeVal) * 10) / 10
              : null;
            const awayDelta = showDelta && rawRow.awayVal != null && row.awayVal != null
              ? Math.round((row.awayVal - rawRow.awayVal) * 10) / 10
              : null;
            return (
              <View key={`${row.label}-${index}`}>
                {row.section && (
                  <Text style={styles.statsSectionLabel}>{row.section}</Text>
                )}
                <View style={styles.statsRow}>
                  <View style={styles.statsCellLeft}>
                    <Text style={[styles.statsValue, { color: colors.home }]}>{fmt(row.homeVal, row.unit)}</Text>
                    {homeDelta !== null && homeDelta !== 0 && (
                      <Text style={[styles.statsDelta, { color: deltaColor(homeDelta, row.higherIsBetter) }]}>
                        {homeDelta > 0 ? "+" : ""}{homeDelta}{row.unit || ""}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.statsLabel}>{row.label}</Text>
                  <View style={styles.statsCellRight}>
                    {awayDelta !== null && awayDelta !== 0 && (
                      <Text style={[styles.statsDelta, { color: deltaColor(awayDelta, row.higherIsBetter) }]}>
                        {awayDelta > 0 ? "+" : ""}{awayDelta}{row.unit || ""}
                      </Text>
                    )}
                    <Text style={[styles.statsValue, { color: colors.away, textAlign: "right" }]}>{fmt(row.awayVal, row.unit)}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

function deltaColor(delta: number, higherIsBetter: boolean): string {
  if (delta === 0) return Colors.dark.textSecondary;
  const better = higherIsBetter ? delta > 0 : delta < 0;
  return better ? "#22c55e" : "#ef4444";
}

function ComparableOpponentsCard({
  homeTeamName,
  awayTeamName,
  homeAdjusted,
  awayAdjusted,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeAdjusted?: AdjustedTeamMatchStats | null;
  awayAdjusted?: AdjustedTeamMatchStats | null;
}) {
  if (!homeAdjusted && !awayAdjusted) return null;
  const homeList = (homeAdjusted?.comparableOpponents || []).slice(0, 3);
  const awayList = (awayAdjusted?.comparableOpponents || []).slice(0, 3);
  if (homeList.length === 0 && awayList.length === 0) return null;

  const renderTeamBlock = (
    sideName: string,
    oppName: string,
    color: string,
    list: ComparableOpponent[],
    profile?: OpponentSelfProfile,
  ) => (
    <View style={styles.comparableTeamBlock}>
      <Text style={[styles.comparableTeamHeader, { color }]} numberOfLines={1}>
        {sideName}'s 3 most {oppName}-like past opponents
      </Text>
      {profile && (
        <Text style={styles.comparableProfileLine}>
          {oppName} avg profile: xG {fmtNum(profile.xg)} · xGA {fmtNum(profile.xga)} · poss {fmtNum(profile.possession)}% · BC {fmtNum(profile.bigChances)}
        </Text>
      )}
      {list.length === 0 ? (
        <Text style={styles.statsNoData}>No comparable opponents found.</Text>
      ) : list.map((c) => {
        const resultColor = c.result === "W" ? "#22c55e" : c.result === "L" ? "#ef4444" : Colors.dark.textSecondary;
        return (
          <View key={c.eventId} style={styles.comparableRow}>
            <View style={styles.comparableHeadRow}>
              <Text style={styles.comparableVenue}>{c.venue}</Text>
              <Text style={styles.comparableOpp} numberOfLines={1}>{c.opponentName}</Text>
              <Text style={[styles.comparableResult, { color: resultColor }]}>
                {c.result} {c.teamScore}-{c.oppScore}
              </Text>
              <Text style={styles.comparableSim}>{Math.round(c.similarity * 100)}%</Text>
            </View>
            <Text style={styles.comparableMeta}>
              opp xG {fmtNum(c.oppXg)} · opp xGA {fmtNum(c.oppXga)} · opp poss {fmtNum(c.oppPossession)}%
            </Text>
            <Text style={styles.comparableWhy}>{c.whyComparable}</Text>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Closest past matchups · opponent quality match</Text>
      <Text style={styles.modeCaption}>
        Past opponents whose performance most resembled the current opponent's typical profile, with the actual scoreline that resulted.
      </Text>
      {renderTeamBlock(homeTeamName, awayTeamName, Colors.dark.homeKit, homeList, homeAdjusted?.currentOpponentProfile)}
      <View style={styles.comparableDivider} />
      {renderTeamBlock(awayTeamName, homeTeamName, Colors.dark.awayKit, awayList, awayAdjusted?.currentOpponentProfile)}
    </View>
  );
}

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return (Math.round(v * 10) / 10).toString();
}

function FormStrengthCard({
  homeTeamName,
  awayTeamName,
  homeForm,
  awayForm,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeForm?: FormSummary;
  awayForm?: FormSummary;
}) {
  const rows: { label: string; getValue: (form?: FormSummary) => number | null | undefined; note: string }[] = [
    { label: "Form", getValue: (form) => form?.formStrength, note: "3 win, 1 draw, 0 loss, +2 big win, +1 clean sheet, -1 draw/0-0" },
    { label: "Scoring", getValue: (form) => form?.scoringStrength, note: "goals per match, scoring rate, and two-goal-margin wins" },
    { label: "Defending", getValue: (form) => form?.defendingStrength, note: "goals conceded per match and clean-sheet rate" },
  ];

  return (
    <View style={styles.phaseCard}>
      <Text style={styles.cardLabel}>Recent form strengths</Text>
      {rows.map((row) => {
        const homeValue = row.getValue(homeForm) ?? null;
        const awayValue = row.getValue(awayForm) ?? null;
        return (
          <View key={row.label} style={styles.phaseRow}>
            <View style={styles.phaseHeader}>
              <Text style={styles.phaseLabel}>{row.label}</Text>
              <Text style={styles.phaseNote} numberOfLines={1}>{row.note}</Text>
            </View>
            <View style={styles.phaseScores}>
              <Text style={[styles.phaseScore, { color: metricColor(homeValue) }]}>
                {homeTeamName}: {metricLabel(homeValue)}
              </Text>
              <Text style={[styles.phaseScore, { color: metricColor(awayValue) }]}>
                {awayTeamName}: {metricLabel(awayValue)}
              </Text>
            </View>
          </View>
        );
      })}
      <Text style={styles.formDetailText}>
        {homeTeamName}: {homeForm?.formPoints ?? 0} pts · {homeForm?.goalsFor ?? 0}-{homeForm?.goalsAgainst ?? 0} · CS {homeForm?.cleanSheets ?? 0} · {(homeForm?.recentForm || []).join(" ") || "—"}
      </Text>
      <Text style={styles.formDetailText}>
        {awayTeamName}: {awayForm?.formPoints ?? 0} pts · {awayForm?.goalsFor ?? 0}-{awayForm?.goalsAgainst ?? 0} · CS {awayForm?.cleanSheets ?? 0} · {(awayForm?.recentForm || []).join(" ") || "—"}
      </Text>
    </View>
  );
}

function clampForSimulation(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function StadiumSimulationTab({
  eventId,
  homeTeamName,
  awayTeamName,
  homeTeamId,
  awayTeamId,
  venue,
  city,
}: StadiumSimulationTabProps) {
  const { data, isLoading } = useQuery<LineupsResponse>({
    queryKey: ["/api/event", eventId, "lineups"],
  });
  const { data: simulationMetrics, isLoading: metricsLoading } = useQuery<SimulationMetricsResponse>({
    queryKey: ["/api/event", eventId, `player-simulation?homeTeamId=${homeTeamId}&awayTeamId=${awayTeamId}`],
    enabled: !!eventId && !!homeTeamId && !!awayTeamId,
  });

  const enrichedHome = useMemo(() => mergeMetrics(data?.home, simulationMetrics?.home), [data?.home, simulationMetrics?.home]);
  const enrichedAway = useMemo(() => mergeMetrics(data?.away, simulationMetrics?.away), [data?.away, simulationMetrics?.away]);
  const homeRows = useMemo(() => buildFormationRows(enrichedHome, true), [enrichedHome]);
  const awayRows = useMemo(() => buildFormationRows(enrichedAway, false), [enrichedAway]);
  const homeStarters = useMemo(() => (enrichedHome?.players || []).filter((player) => !player.substitute).slice(0, 11), [enrichedHome]);
  const awayStarters = useMemo(() => (enrichedAway?.players || []).filter((player) => !player.substitute).slice(0, 11), [enrichedAway]);
  const hasLineups = homeRows.length > 0 || awayRows.length > 0;
  const hasLikelyLineup = !!simulationMetrics?.home?.isLikelyLineup || !!simulationMetrics?.away?.isLikelyLineup;
  const venueLabel = [venue, city].filter(Boolean).join(" · ");

  if (isLoading || metricsLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.summaryCard}>
        <Text style={styles.cardLabel}>Stadium simulation</Text>
        <Text style={styles.matchTitle} numberOfLines={2}>
          {homeTeamName} vs {awayTeamName}
        </Text>
        <Text style={styles.venueText} numberOfLines={1}>
          {venueLabel || "Match venue"}
        </Text>
        <View style={styles.metaRow}>
          <View style={styles.metaPill}>
            <Text style={styles.metaText}>{data?.home?.formation || "Home XI"}</Text>
          </View>
          <View style={styles.metaPill}>
            <Text style={styles.metaText}>{data?.away?.formation || "Away XI"}</Text>
          </View>
          {data?.confirmed === false && (
            <View style={[styles.metaPill, styles.predictedPill]}>
              <Text style={[styles.metaText, styles.predictedText]}>Predicted</Text>
            </View>
          )}
          {hasLikelyLineup && (
            <View style={[styles.metaPill, styles.predictedPill]}>
              <Text style={[styles.metaText, styles.predictedText]}>Likely lineup</Text>
            </View>
          )}
          <View style={styles.metaPill}>
            <Text style={styles.metaText}>
              Last 15: {simulationMetrics?.home?.matchesAnalyzed || 0}/{simulationMetrics?.away?.matchesAnalyzed || 0}
            </Text>
          </View>
          {hasLikelyLineup && (
            <View style={styles.metaPill}>
              <Text style={styles.metaText}>
                Active last 5: {simulationMetrics?.home?.activeLast5Count || 0}/{simulationMetrics?.away?.activeLast5Count || 0}
              </Text>
            </View>
          )}
        </View>
        {hasLikelyLineup && (
          <Text style={styles.likelyLineupText}>
            No provider predicted XI found, so this likely lineup is inferred from the preferred formation in the last 15 matches, players active in the last 5, and available injury/suspension data.
          </Text>
        )}
      </View>

      <View style={styles.stadium}>
        <View style={styles.standTop} />
        <View style={styles.pitch}>
          <View style={styles.boxTop} />
          <View style={styles.centerLine} />
          <View style={styles.centerCircle} />
          <View style={styles.boxBottom} />
          {hasLineups ? (
            <View style={styles.pitchContent}>
              <View style={styles.teamHeader}>
                <Text style={styles.awayLabel} numberOfLines={1}>{awayTeamName}</Text>
                <Text style={styles.teamFormation}>{enrichedAway?.formation || ""}</Text>
              </View>
              <FormationRows rows={awayRows} side="away" />
              <View style={styles.centerSpacer} />
              <FormationRows rows={homeRows} side="home" />
              <View style={styles.teamHeader}>
                <Text style={styles.homeLabel} numberOfLines={1}>{homeTeamName}</Text>
                <Text style={styles.teamFormation}>{enrichedHome?.formation || ""}</Text>
              </View>
            </View>
          ) : (
            <EmptyLineupMessage />
          )}
        </View>
        <View style={styles.standBottom} />
      </View>

      <View style={styles.legendCard}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.dark.homeKit }]} />
          <Text style={styles.legendText}>{homeTeamName}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.dark.awayKit }]} />
          <Text style={styles.legendText}>{awayTeamName}</Text>
        </View>
      </View>

      <PhaseStrengthCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homePhases={simulationMetrics?.home?.phaseStrengths}
        awayPhases={simulationMetrics?.away?.phaseStrengths}
      />

      <FormStrengthCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homeForm={simulationMetrics?.home?.formSummary}
        awayForm={simulationMetrics?.away?.formSummary}
      />

      <GameIntelligenceCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homeGsrm={simulationMetrics?.home?.gsrm}
        awayGsrm={simulationMetrics?.away?.gsrm}
      />

      <ScoreStateBreakCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homeSsbi={simulationMetrics?.home?.ssbi}
        awaySsbi={simulationMetrics?.away?.ssbi}
      />

      <ScoringPatternsCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homePatterns={simulationMetrics?.home?.scoringPatterns}
        awayPatterns={simulationMetrics?.away?.scoringPatterns}
      />

      <HalfPatternsCard
        eventId={eventId}
        homeTeamId={homeTeamId}
        awayTeamId={awayTeamId}
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
      />

      <HighestScoringHalfCard
        eventId={eventId}
        homeTeamId={homeTeamId}
        awayTeamId={awayTeamId}
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        simulationMetrics={simulationMetrics}
      />

      <CausalAnalysisCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homeProfile={simulationMetrics?.home?.causalAnalysis}
        awayProfile={simulationMetrics?.away?.causalAnalysis}
      />

      <HiddenTruthsCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        insights={simulationMetrics?.simulationInsights}
      />

      <MatchupCrossRefCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        insights={simulationMetrics?.simulationInsights}
      />

      <TeamStatsCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homeStats={simulationMetrics?.home?.teamMatchStats}
        awayStats={simulationMetrics?.away?.teamMatchStats}
        homeStatsAdjusted={simulationMetrics?.home?.teamMatchStatsAdjusted}
        awayStatsAdjusted={simulationMetrics?.away?.teamMatchStatsAdjusted}
      />

      <ComparableOpponentsCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homeAdjusted={simulationMetrics?.home?.teamMatchStatsAdjusted}
        awayAdjusted={simulationMetrics?.away?.teamMatchStatsAdjusted}
      />

      <SimChatCard
        eventId={eventId}
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        simulationMetrics={simulationMetrics}
      />

      <SimulationPanel
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homePlayers={homeStarters}
        awayPlayers={awayStarters}
        homeStrength={simulationMetrics?.home?.teamStrength}
        awayStrength={simulationMetrics?.away?.teamStrength}
        homePhases={simulationMetrics?.home?.phaseStrengths}
        awayPhases={simulationMetrics?.away?.phaseStrengths}
        homeForm={simulationMetrics?.home?.formSummary}
        awayForm={simulationMetrics?.away?.formSummary}
        homeTeamStats={simulationMetrics?.home?.teamMatchStats}
        awayTeamStats={simulationMetrics?.away?.teamMatchStats}
      />

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─── SimChatCard — AI chat grounded in the per-fixture simulation context ───

type ChatMessage = { role: "user" | "assistant"; content: string };

function buildSimChatContext(metrics: SimulationMetricsResponse | undefined) {
  if (!metrics) return null;
  const slim = (team: any) => team && {
    matchesAnalyzed: team.matchesAnalyzed,
    teamStrength: team.teamStrength,
    phaseStrengths: team.phaseStrengths,
    formSummary: team.formSummary,
    gsrm: team.gsrm,
    ssbi: team.ssbi,
    scoringPatterns: team.scoringPatterns,
    causalAnalysis: team.causalAnalysis,
    teamMatchStats: team.teamMatchStats,
  };
  return {
    home: slim(metrics.home),
    away: slim(metrics.away),
    simulationInsights: metrics.simulationInsights,
  };
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <View style={[styles.chatBubble, isUser ? styles.chatBubbleUser : styles.chatBubbleAi]}>
      {!isUser && <Text style={styles.chatRoleLabel}>AI Analyst</Text>}
      <Text style={[styles.chatBubbleText, isUser && styles.chatBubbleTextUser]}>{msg.content}</Text>
    </View>
  );
}

function SimChatCard({
  eventId,
  homeTeamName,
  awayTeamName,
  simulationMetrics,
}: {
  eventId: string;
  homeTeamName: string;
  awayTeamName: string;
  simulationMetrics: SimulationMetricsResponse | undefined;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasContext = !!simulationMetrics?.home && !!simulationMetrics?.away;

  const sendMessage = useCallback(async (userText: string) => {
    if (!hasContext || loading) return;
    const trimmed = userText.trim();
    if (!trimmed) return;

    const newMsgs: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(newMsgs);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const simContext = buildSimChatContext(simulationMetrics);
      const baseUrl = getApiUrl();
      const url = new URL(`/api/event/${eventId}/sim-chat`, baseUrl);
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMsgs,
          simContext,
          homeTeamName,
          awayTeamName,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      const assistantMsg = data?.message as ChatMessage | undefined;
      if (assistantMsg?.content) {
        setMessages([...newMsgs, assistantMsg]);
      } else {
        throw new Error("Empty AI response");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to get AI response");
    } finally {
      setLoading(false);
    }
  }, [messages, simulationMetrics, hasContext, loading, eventId, homeTeamName, awayTeamName]);

  const generateInsight = useCallback(() => {
    sendMessage(
      `Give me your full match insight for ${homeTeamName} vs ${awayTeamName}. ` +
      `Reason step by step through each team's causal analysis (repeatable vs variance), ` +
      `their scoring/conceding patterns, behavioural traits and how those collide. ` +
      `Then give me likely full-time scoreline, match result lean, first-half scoreline, ` +
      `second-half scoreline, BTTS lean, and total goals (Over/Under 2.5). Be specific and grounded in the data.`
    );
  }, [sendMessage, homeTeamName, awayTeamName]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return (
    <View style={styles.chatCard}>
      <View style={styles.chatHeader}>
        <Text style={styles.chatTitle}>AI Match Insight Chat</Text>
        <Text style={styles.chatSubtitle}>
          Reasons step by step through both teams' causal analysis, patterns, hidden truths & game intelligence to project this fixture.
        </Text>
      </View>

      {messages.length === 0 ? (
        <View style={styles.chatEmptyState}>
          <Text style={styles.chatEmptyText}>
            Tap below to generate a full step-by-step insight, or ask any question about this fixture.
          </Text>
        </View>
      ) : (
        <View style={styles.chatMessages}>
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
          {loading && (
            <View style={[styles.chatBubble, styles.chatBubbleAi]}>
              <Text style={styles.chatRoleLabel}>AI Analyst</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator size="small" color={Colors.dark.accent} />
                <Text style={styles.chatBubbleText}>Reasoning through the data…</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {error && <Text style={styles.chatError}>{error}</Text>}

      <View style={styles.chatActionsRow}>
        <TouchableOpacity
          style={[styles.chatPrimaryBtn, (!hasContext || loading) && styles.chatBtnDisabled]}
          onPress={generateInsight}
          disabled={!hasContext || loading}
          activeOpacity={0.85}
        >
          <Text style={styles.chatPrimaryBtnText}>
            {messages.length === 0 ? "Generate full match insight" : "Re-generate full insight"}
          </Text>
        </TouchableOpacity>
        {messages.length > 0 && (
          <TouchableOpacity style={styles.chatClearBtn} onPress={clearChat} disabled={loading}>
            <Text style={styles.chatClearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.chatInputRow}>
        <TextInput
          style={styles.chatInput}
          placeholder="Ask a follow-up question…"
          placeholderTextColor="#6b7280"
          value={input}
          onChangeText={setInput}
          editable={!loading && hasContext}
          multiline
          onSubmitEditing={() => sendMessage(input)}
          returnKeyType="send"
          blurOnSubmit
        />
        <TouchableOpacity
          style={[styles.chatSendBtn, (!hasContext || loading || !input.trim()) && styles.chatBtnDisabled]}
          onPress={() => sendMessage(input)}
          disabled={!hasContext || loading || !input.trim()}
          activeOpacity={0.85}
        >
          <Text style={styles.chatSendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>

      {!hasContext && (
        <Text style={styles.chatHint}>Loading simulation context…</Text>
      )}
    </View>
  );
}

export default memo(StadiumSimulationTab);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  summaryCard: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 12,
    padding: 14,
  },
  cardLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  matchTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginBottom: 4,
  },
  venueText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaPill: {
    backgroundColor: Colors.dark.surfaceSecondary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  predictedPill: {
    backgroundColor: "rgba(61, 123, 244, 0.15)",
  },
  metaText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
  predictedText: {
    color: Colors.dark.accent,
  },
  likelyLineupText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 16,
    marginTop: 10,
  },
  stadium: {
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    padding: 10,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
  },
  standTop: {
    height: 18,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: Colors.dark.surfaceSecondary,
    marginBottom: 6,
  },
  standBottom: {
    height: 18,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: Colors.dark.surfaceSecondary,
    marginTop: 6,
  },
  pitch: {
    minHeight: Platform.OS === "web" ? 680 : 640,
    backgroundColor: Colors.dark.pitch,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: Colors.dark.pitchLine,
    position: "relative",
  },
  pitchContent: {
    flex: 1,
    paddingVertical: 12,
  },
  teamHeader: {
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  awayLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  homeLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  teamFormation: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "rgba(255, 255, 255, 0.72)",
    marginTop: 2,
  },
  teamHalf: {
    flex: 1,
    justifyContent: "space-around",
    zIndex: 2,
  },
  formationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-around",
    paddingHorizontal: 6,
    minHeight: 58,
  },
  playerMarker: {
    width: 70,
    alignItems: "center",
  },
  ratingBadge: {
    backgroundColor: "rgba(0, 0, 0, 0.62)",
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginBottom: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.35)",
  },
  ratingBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
  },
  playerDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.82)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  playerNumber: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
  },
  playerName: {
    marginTop: 4,
    fontSize: 9,
    lineHeight: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  playerMeta: {
    marginTop: 2,
    fontSize: 7,
    fontFamily: "Inter_600SemiBold",
    color: "rgba(255, 255, 255, 0.72)",
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  roleMeta: {
    marginTop: 1,
    fontSize: 7,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  formDetailText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
    marginTop: 6,
  },
  centerSpacer: {
    height: 16,
  },
  centerLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    height: 2,
    backgroundColor: Colors.dark.pitchLine,
  },
  centerCircle: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 96,
    height: 96,
    marginLeft: -48,
    marginTop: -48,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: Colors.dark.pitchLine,
  },
  boxTop: {
    position: "absolute",
    top: 0,
    alignSelf: "center",
    width: "52%",
    height: 78,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: Colors.dark.pitchLine,
  },
  boxBottom: {
    position: "absolute",
    bottom: 0,
    alignSelf: "center",
    width: "52%",
    height: 78,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderTopWidth: 2,
    borderColor: Colors.dark.pitchLine,
  },
  emptyOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    zIndex: 2,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 19,
  },
  legendCard: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  phaseCard: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  phaseRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.dark.border,
    paddingTop: 10,
    gap: 6,
  },
  phaseHeader: {
    gap: 2,
  },
  phaseLabel: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
  },
  phaseNote: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
  },
  phaseScores: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  phaseScore: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  halfMatchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  halfMatchVenue: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.textTertiary,
    width: 14,
  },
  halfMatchOpp: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    width: 90,
  },
  halfMatchScore: {
    flex: 1,
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textSecondary,
  },
  halfMatchTag: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    width: 96,
    textAlign: "right",
  },
  liveCard: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 12,
    padding: 14,
  },
  liveHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  liveScore: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
    marginTop: 2,
  },
  minutePill: {
    backgroundColor: Colors.dark.liveBackground,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  minuteText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.live,
  },
  miniPitch: {
    height: 72,
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: Colors.dark.pitchDark,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.pitchLine,
    position: "relative",
    overflow: "hidden",
  },
  simBall: {
    position: "absolute",
    left: "50%",
    width: 14,
    height: 14,
    marginLeft: -7,
    marginTop: -7,
    borderRadius: 7,
    backgroundColor: Colors.dark.text,
    borderWidth: 2,
    borderColor: Colors.dark.border,
  },
  possessionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    gap: 8,
  },
  possessionText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
  possessionBar: {
    height: 5,
    borderRadius: 999,
    backgroundColor: Colors.dark.surfaceSecondary,
    marginTop: 6,
    overflow: "hidden",
  },
  possessionFill: {
    height: 5,
    borderRadius: 999,
    backgroundColor: Colors.dark.homeKit,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  simulateButton: {
    flex: 1,
    backgroundColor: Colors.dark.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  simulateButtonText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
  },
  resetButton: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  resetButtonText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
  eventFeed: {
    marginTop: 12,
    gap: 7,
  },
  eventText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  goalEventText: {
    color: Colors.dark.text,
    fontFamily: "Inter_700Bold",
  },
  scorelineCard: {
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: Colors.dark.surfaceSecondary,
    padding: 12,
    gap: 10,
  },
  scorelineLoadingText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
  scorelineTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
  },
  scorelineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.dark.border,
  },
  scorelineRank: {
    width: 22,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.textTertiary,
  },
  scorelineScore: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  scorelineMeta: {
    alignItems: "flex-end",
  },
  scorelinePercent: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.accent,
  },
  scorelineCount: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
  },
  statsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
    marginBottom: 4,
  },
  statsHeaderTeam: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  statsHeaderLabel: {
    flex: 2,
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textTertiary,
    textAlign: "center",
  },
  statsSectionLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 2,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  statsLabel: {
    flex: 2,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
  statsValue: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  periodToggle: {
    flexDirection: "row",
    backgroundColor: Colors.dark.surfaceSecondary,
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
    marginTop: 4,
  },
  periodTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    borderRadius: 8,
  },
  periodTabActive: {
    backgroundColor: Colors.dark.accent,
  },
  periodTabText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
  periodTabTextActive: {
    color: Colors.dark.text,
  },
  modeToggle: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
  },
  modeTabActive: {
    backgroundColor: "rgba(96,165,250,0.18)",
    borderColor: "rgba(96,165,250,0.45)",
  },
  modeTabText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
  modeTabTextActive: {
    color: Colors.dark.text,
  },
  modeCaption: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    lineHeight: 15,
    marginTop: 8,
    marginBottom: 4,
  },
  statsCellLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  statsCellRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "flex-end",
    gap: 6,
  },
  statsDelta: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  comparableTeamBlock: {
    marginTop: 10,
  },
  comparableTeamHeader: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  comparableProfileLine: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    marginBottom: 8,
  },
  comparableRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  comparableHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  comparableVenue: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.textSecondary,
    width: 14,
  },
  comparableOpp: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  comparableResult: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  comparableSim: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
    minWidth: 36,
    textAlign: "right",
  },
  comparableMeta: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    marginTop: 2,
  },
  comparableWhy: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textSecondary,
    marginTop: 2,
    fontStyle: "italic",
  },
  comparableDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginVertical: 12,
  },
  verdictBox: {
    marginTop: 8,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  verdictHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  verdictKicker: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  verdictTag: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  verdictTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
    marginBottom: 4,
  },
  verdictSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  signalRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 6,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  signalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  signalText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.text,
    lineHeight: 17,
  },
  signalLeans: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    minWidth: 28,
    textAlign: "right",
  },
  statsNoData: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    textAlign: "center",
    paddingVertical: 16,
  },
  gsrmRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
    gap: 8,
  },
  gsrmSide: {
    width: 48,
    alignItems: "center",
    gap: 2,
  },
  gsrmSideRight: {
    width: 48,
    alignItems: "center",
    gap: 2,
  },
  gsrmScore: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  gsrmTag: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  gsrmCenter: {
    flex: 1,
    gap: 3,
  },
  gsrmLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    textAlign: "center",
  },
  gsrmDesc: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    textAlign: "center",
    lineHeight: 13,
  },
  gsrmBarRow: {
    flexDirection: "row",
    gap: 2,
    height: 4,
    marginTop: 4,
  },
  gsrmBarTrack: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.dark.surfaceSecondary,
    borderRadius: 2,
    overflow: "hidden",
  },
  gsrmBarFillHome: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
  },
  gsrmBarFillAway: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
  },
  gsrmMatchCount: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    textAlign: "center",
    marginTop: 2,
  },
  ssbiBreakersSection: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.dark.border,
  },
  ssbiBreakerTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginBottom: 2,
  },
  ssbiBreakerSub: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    marginBottom: 8,
  },
  ssbiBreakerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 8,
  },
  ssbiBreakerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 5,
  },
  ssbiBreakerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  ssbiBreakerName: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  ssbiAvailBadge: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ssbiAvailText: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
  },
  ssbiBreakerStats: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  ssbiBreakerTotal: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
  },
  patternIntro: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 15,
  },
  patternBlock: {
    paddingTop: 4,
  },
  patternHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  patternSideDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  patternTeam: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginLeft: 8,
  },
  patternTagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  patternTagText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  patternMetricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 8,
    marginBottom: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  patternMetricCell: {
    width: "25%",
    alignItems: "center",
    paddingVertical: 2,
  },
  patternMetricVal: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
  },
  patternMetricLabel: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  patternLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    flexWrap: "wrap",
  },
  patternLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 10,
  },
  patternLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    marginRight: 4,
  },
  patternLegendText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textSecondary,
  },
  patternLegendMeta: {
    flex: 1,
    textAlign: "right",
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
  },
  patternRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  patternBucketLabel: {
    width: 54,
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textSecondary,
  },
  patternBars: {
    flex: 1,
    flexDirection: "row",
  },
  patternBarBlock: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 3,
  },
  patternBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 4,
    overflow: "hidden",
  },
  patternBarFill: {
    height: "100%",
    borderRadius: 4,
  },
  patternBarText: {
    width: 56,
    textAlign: "right",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginLeft: 4,
  },
  patternBarPct: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
  },
  patternFactsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
    marginHorizontal: -3,
  },
  patternFact: {
    width: "33.333%",
    paddingHorizontal: 3,
    paddingVertical: 4,
  },
  patternFactLabel: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  patternFactValue: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginTop: 1,
  },
  patternTagsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },
  patternStyleTag: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 4,
    marginBottom: 4,
  },
  patternStyleTagText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.text,
  },
  recurringWrap: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  recurringHeading: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  recurringRow: {
    backgroundColor: "rgba(168,85,247,0.07)",
    borderLeftWidth: 2,
    borderLeftColor: "#a855f7",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 4,
  },
  recurringHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  recurringLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  recurringCount: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#a855f7",
    marginLeft: 6,
  },
  recurringEvidence: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    marginTop: 2,
  },
  storiesWrap: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  storyRow: {
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.03)",
  },
  storyTopLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  storyResult: {
    width: 18,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  storyVenue: {
    width: 18,
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textTertiary,
  },
  storyOpp: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.text,
  },
  storyScore: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
    marginLeft: 6,
  },
  storyXg: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    marginLeft: 8,
  },
  storyNarrativeWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 3,
    marginLeft: 36,
  },
  storyNarrativeChip: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginRight: 4,
    marginBottom: 2,
  },
  storyNarrativeText: {
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textSecondary,
  },
  hiddenBlock: {
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 10,
    padding: 10,
  },
  hiddenEmpty: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    marginTop: 4,
  },
  hiddenCount: {
    marginLeft: "auto",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  hiddenRow: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 6,
  },
  hiddenRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  hiddenLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  hiddenValue: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    marginLeft: 6,
  },
  hiddenDetail: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 15,
  },
  crossRefRow: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  crossRefTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  crossRefBadge: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginRight: 8,
  },
  crossRefBadgeText: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  crossRefHeadline: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  crossRefDetail: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 15,
  },

  // ── Causal Analysis card ──────────────────────────────────────────
  causalRepeatRow: { marginTop: 8, marginBottom: 4 },
  causalRepeatBar: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  causalRepeatSegment: { height: "100%" },
  causalRepeatLegend: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
  },
  causalRepeatChip: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  causalSection: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  causalCauseRow: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 6,
  },
  causalCauseTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5,
  },
  causalCauseLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  causalCauseRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  causalCauseTag: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginRight: 6,
  },
  causalCauseValue: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
  causalCauseBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.05)",
    overflow: "hidden",
  },
  causalCauseBarFill: { height: "100%", borderRadius: 2 },
  causalLeanRow: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 6,
  },
  causalLeanTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 3,
  },
  causalLeanTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  causalLeanValue: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  causalLeanReason: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 15,
  },
  causalShape: {
    marginTop: 8,
    backgroundColor: "rgba(168,85,247,0.08)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  causalShapeLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#c4b5fd",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  causalShapeValue: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  causalMatchRow: {
    backgroundColor: "rgba(255,255,255,0.025)",
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 6,
  },
  causalMatchTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  causalMatchResult: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    width: 14,
  },
  causalMatchScore: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginLeft: 6,
  },
  causalMatchOpp: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    marginLeft: 8,
  },
  causalMatchTag: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  causalMatchPrimary: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginTop: 2,
  },
  causalMatchReason: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 15,
    marginTop: 1,
  },
  causalSubRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 4,
  },
  causalSubChip: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
    width: 70,
  },
  causalSubReason: {
    flex: 1,
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    lineHeight: 14,
  },

  // ─── SimChatCard ─────────────────────────────────────────────────
  chatCard: {
    backgroundColor: Colors.dark.cardBackground,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  chatHeader: {
    marginBottom: 10,
  },
  chatTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
    marginBottom: 4,
  },
  chatSubtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    lineHeight: 15,
  },
  chatEmptyState: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 8,
    marginBottom: 10,
  },
  chatEmptyText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
    textAlign: "center",
  },
  chatMessages: {
    marginBottom: 10,
    gap: 8,
  },
  chatBubble: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    maxWidth: "100%",
  },
  chatBubbleAi: {
    backgroundColor: "rgba(99,102,241,0.10)",
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.25)",
    alignSelf: "flex-start",
  },
  chatBubbleUser: {
    backgroundColor: Colors.dark.accent,
    alignSelf: "flex-end",
  },
  chatRoleLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#a5b4fc",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chatBubbleText: {
    fontSize: 12.5,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.text,
    lineHeight: 18,
  },
  chatBubbleTextUser: {
    color: "#0b0f1a",
    fontFamily: "Inter_500Medium",
  },
  chatError: {
    fontSize: 11,
    color: "#ef4444",
    fontFamily: "Inter_500Medium",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  chatActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  chatPrimaryBtn: {
    flex: 1,
    backgroundColor: Colors.dark.accent,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: "center",
  },
  chatPrimaryBtnText: {
    fontSize: 12.5,
    fontFamily: "Inter_600SemiBold",
    color: "#0b0f1a",
  },
  chatClearBtn: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chatClearBtnText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.dark.textSecondary,
  },
  chatInputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  chatInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "ios" ? 10 : 8,
    paddingBottom: Platform.OS === "ios" ? 10 : 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    color: Colors.dark.text,
    fontSize: 12.5,
    fontFamily: "Inter_400Regular",
  },
  chatSendBtn: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: Colors.dark.accent,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  chatSendBtnText: {
    fontSize: 12.5,
    fontFamily: "Inter_600SemiBold",
    color: "#0b0f1a",
  },
  chatBtnDisabled: {
    opacity: 0.4,
  },
  chatHint: {
    fontSize: 10.5,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    marginTop: 8,
    textAlign: "center",
  },
});