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
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";

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
    gsrm?: GSRM | null;
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
    gsrm?: GSRM | null;
  };
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

function TeamStatsCard({
  homeTeamName,
  awayTeamName,
  homeStats,
  awayStats,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeStats?: TeamMatchStats | null;
  awayStats?: TeamMatchStats | null;
}) {
  const [period, setPeriod] = React.useState<StatViewPeriod>("all");

  if (!homeStats && !awayStats) return null;
  const matchesAnalyzed = homeStats?.matchesAnalyzed || awayStats?.matchesAnalyzed || 0;
  if (matchesAnalyzed === 0) return null;

  const homeP = period === "all" ? homeStats?.all : period === "firstHalf" ? homeStats?.firstHalf : homeStats?.secondHalf;
  const awayP = period === "all" ? awayStats?.all : period === "firstHalf" ? awayStats?.firstHalf : awayStats?.secondHalf;

  const hasData = (homeP?.matchesWithStats || 0) > 0 || (awayP?.matchesWithStats || 0) > 0 ||
    (homeP?.avgGoalsScored != null) || (awayP?.avgGoalsScored != null);

  const rows = buildStatRows(homeP, awayP);
  const periodLabel = period === "all" ? "Full Match" : period === "firstHalf" ? "1st Half" : "2nd Half";
  const tabs: { key: StatViewPeriod; label: string }[] = [
    { key: "all", label: "Last 15" },
    { key: "firstHalf", label: "1st Half" },
    { key: "secondHalf", label: "2nd Half" },
  ];

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
      {!hasData ? (
        <Text style={styles.statsNoData}>No {periodLabel.toLowerCase()} statistics available for these matches.</Text>
      ) : (
        <>
          <View style={styles.statsHeaderRow}>
            <Text style={[styles.statsHeaderTeam, { color: Colors.dark.homeKit }]} numberOfLines={1}>{homeTeamName}</Text>
            <Text style={styles.statsHeaderLabel}>Avg {periodLabel}</Text>
            <Text style={[styles.statsHeaderTeam, { color: Colors.dark.awayKit }]} numberOfLines={1}>{awayTeamName}</Text>
          </View>
          {rows.map((row, index) => {
            const colors = statColor(row.homeVal, row.awayVal, row.higherIsBetter);
            if (row.homeVal == null && row.awayVal == null && !row.section) return null;
            return (
              <View key={`${row.label}-${index}`}>
                {row.section && (
                  <Text style={styles.statsSectionLabel}>{row.section}</Text>
                )}
                <View style={styles.statsRow}>
                  <Text style={[styles.statsValue, { color: colors.home }]}>{fmt(row.homeVal, row.unit)}</Text>
                  <Text style={styles.statsLabel}>{row.label}</Text>
                  <Text style={[styles.statsValue, { color: colors.away, textAlign: "right" }]}>{fmt(row.awayVal, row.unit)}</Text>
                </View>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
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

      <TeamStatsCard
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homeStats={simulationMetrics?.home?.teamMatchStats}
        awayStats={simulationMetrics?.away?.teamMatchStats}
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
});