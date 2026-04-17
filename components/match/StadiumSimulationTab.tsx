import React, { memo, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";

interface PlayerData {
  player: { shortName?: string; id?: number; name?: string };
  position?: string;
  substitute?: boolean;
  jerseyNumber?: number;
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
  venue?: string;
  city?: string;
}

interface FormationRow {
  key: string;
  players: PlayerData[];
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

const PlayerMarker = memo(({ player, side }: { player: PlayerData; side: "home" | "away" }) => {
  const kitColor = side === "home" ? Colors.dark.homeKit : Colors.dark.awayKit;
  const number = player.jerseyNumber ? String(player.jerseyNumber) : "";

  return (
    <View style={styles.playerMarker}>
      <View style={[styles.playerDot, { backgroundColor: kitColor }]}>
        <Text style={styles.playerNumber}>{number}</Text>
      </View>
      <Text style={styles.playerName} numberOfLines={2}>
        {getPlayerName(player)}
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

function StadiumSimulationTab({
  eventId,
  homeTeamName,
  awayTeamName,
  venue,
  city,
}: StadiumSimulationTabProps) {
  const { data, isLoading } = useQuery<LineupsResponse>({
    queryKey: ["/api/event", eventId, "lineups"],
  });

  const homeRows = useMemo(() => buildFormationRows(data?.home, true), [data?.home]);
  const awayRows = useMemo(() => buildFormationRows(data?.away, false), [data?.away]);
  const hasLineups = homeRows.length > 0 || awayRows.length > 0;
  const venueLabel = [venue, city].filter(Boolean).join(" · ");

  if (isLoading) {
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
    width: 64,
    alignItems: "center",
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
});