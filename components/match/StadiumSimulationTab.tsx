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
  appearances: number;
  starts: number;
  averageRating: number | null;
  dataConfidence: "High" | "Medium" | "Low" | "Unavailable";
}

interface SimulationMetricsResponse {
  home?: {
    formation?: string | null;
    players?: { playerId: number; metrics: PlayerMetrics }[];
    teamStrength?: number | null;
    matchesAnalyzed?: number;
  };
  away?: {
    formation?: string | null;
    players?: { playerId: number; metrics: PlayerMetrics }[];
    teamStrength?: number | null;
    matchesAnalyzed?: number;
  };
}

interface LiveEvent {
  minute: number;
  team: "home" | "away";
  text: string;
  type: "attack" | "goal" | "save" | "control";
}

interface SimulationState {
  running: boolean;
  minute: number;
  homeScore: number;
  awayScore: number;
  possession: number;
  ballY: number;
  events: LiveEvent[];
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

function mergeMetrics(team?: LineupTeam, metrics?: SimulationMetricsResponse["home"]): LineupTeam | undefined {
  if (!team) return team;
  const metricMap = new Map((metrics?.players || []).map((entry) => [entry.playerId, entry.metrics]));
  return {
    ...team,
    players: (team.players || []).map((player) => ({
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

function SimulationPanel({
  homeTeamName,
  awayTeamName,
  homePlayers,
  awayPlayers,
  homeStrength,
  awayStrength,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homePlayers: PlayerData[];
  awayPlayers: PlayerData[];
  homeStrength?: number | null;
  awayStrength?: number | null;
}) {
  const [state, setState] = useState<SimulationState>({
    running: false,
    minute: 0,
    homeScore: 0,
    awayScore: 0,
    possession: 50,
    ballY: 50,
    events: [],
  });

  const resetSimulation = useCallback(() => {
    setState({
      running: false,
      minute: 0,
      homeScore: 0,
      awayScore: 0,
      possession: 50,
      ballY: 50,
      events: [],
    });
  }, []);

  const startSimulation = useCallback(() => {
    setState((current) => ({
      ...current,
      running: true,
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
        const homePower = homeStrength || 6.4;
        const awayPower = awayStrength || 6.4;
        const totalPower = Math.max(homePower + awayPower, 1);
        const homeChance = homePower / totalPower;
        const attackingTeam: "home" | "away" = Math.random() <= homeChance ? "home" : "away";
        const attackers = attackingTeam === "home" ? homePlayers : awayPlayers;
        const defenders = attackingTeam === "home" ? awayPlayers : homePlayers;
        const attacker =
          attackers[Math.floor(Math.random() * Math.max(attackers.length, 1))] || attackers[0];
        const defender =
          defenders[Math.floor(Math.random() * Math.max(defenders.length, 1))] || defenders[0];
        const attackerScore = getPlayerScore(attacker);
        const defenderScore = getPlayerScore(defender);
        const goalChance = clampForSimulation(0.05 + (attackerScore - defenderScore) * 0.025 + (attackingTeam === "home" ? 0.01 : 0), 0.03, 0.18);
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
        const possessionTarget = Math.round(homeChance * 100);
        const possession = Math.round(current.possession * 0.7 + possessionTarget * 0.3 + (Math.random() * 8 - 4));

        return {
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
  }, [awayPlayers, awayStrength, homePlayers, homeStrength, state.running]);

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
          style={[styles.simulateButton, (!canSimulate || state.running) && styles.buttonDisabled]}
          onPress={startSimulation}
          disabled={!canSimulate || state.running}
          activeOpacity={0.85}
        >
          <Text style={styles.simulateButtonText}>
            {state.running ? "Simulating..." : state.minute >= 90 ? "Simulate again" : "Simulate"}
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
          <View style={styles.metaPill}>
            <Text style={styles.metaText}>
              Last 15: {simulationMetrics?.home?.matchesAnalyzed || 0}/{simulationMetrics?.away?.matchesAnalyzed || 0}
            </Text>
          </View>
        </View>
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
                <Text style={styles.teamFormation}>{data?.away?.formation || ""}</Text>
              </View>
              <FormationRows rows={awayRows} side="away" />
              <View style={styles.centerSpacer} />
              <FormationRows rows={homeRows} side="home" />
              <View style={styles.teamHeader}>
                <Text style={styles.homeLabel} numberOfLines={1}>{homeTeamName}</Text>
                <Text style={styles.teamFormation}>{data?.home?.formation || ""}</Text>
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

      <SimulationPanel
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homePlayers={homeStarters}
        awayPlayers={awayStarters}
        homeStrength={simulationMetrics?.home?.teamStrength}
        awayStrength={simulationMetrics?.away?.teamStrength}
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
});