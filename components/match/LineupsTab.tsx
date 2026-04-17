import React, { memo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { getPlayerImageUrl } from "@/lib/api";

interface PlayerData {
  player: { shortName?: string; id?: number; name?: string };
  position: string;
  substitute: boolean;
  jerseyNumber: number;
  statistics: { rating?: number };
}

interface LineupTeam {
  formation?: string;
  players: PlayerData[];
  missingPlayers?: MissingPlayer[];
}

interface MissingPlayer {
  player: { shortName?: string; id?: number; name?: string; position?: string };
  type?: string;
  reason?: string | number;
  description?: string;
  expectedEndDate?: string;
}

interface LineupsResponse {
  home: LineupTeam;
  away: LineupTeam;
  confirmed: boolean;
}

interface LineupsTabProps {
  eventId: string;
  homeTeamName: string;
  awayTeamName: string;
}

function LineupsTab({ eventId, homeTeamName, awayTeamName }: LineupsTabProps) {
  const [activeTeam, setActiveTeam] = useState<"home" | "away">("home");

  const { data, isLoading } = useQuery<LineupsResponse>({
    queryKey: ["/api/event", eventId, "lineups"],
  });

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
      </View>
    );
  }

  if (!data?.home && !data?.away) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Lineups not available</Text>
      </View>
    );
  }

  const team = activeTeam === "home" ? data?.home : data?.away;
  const teamName = activeTeam === "home" ? homeTeamName : awayTeamName;
  const starters = team?.players?.filter((p) => !p.substitute) || [];
  const subs = team?.players?.filter((p) => p.substitute) || [];
  const missingPlayers = team?.missingPlayers || [];

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.teamToggle}>
        <TouchableOpacity
          style={[styles.toggleBtn, activeTeam === "home" && styles.toggleBtnActive]}
          onPress={() => setActiveTeam("home")}
        >
          <Text
            style={[styles.toggleText, activeTeam === "home" && styles.toggleTextActive]}
          >
            {homeTeamName}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, activeTeam === "away" && styles.toggleBtnActive]}
          onPress={() => setActiveTeam("away")}
        >
          <Text
            style={[styles.toggleText, activeTeam === "away" && styles.toggleTextActive]}
          >
            {awayTeamName}
          </Text>
        </TouchableOpacity>
      </View>

      {team?.formation && (
        <View style={styles.formationCard}>
          <Text style={styles.formationLabel}>Formation</Text>
          <Text style={styles.formationText}>{team.formation}</Text>
        </View>
      )}

      {data?.confirmed === false && (
        <View style={styles.unconfirmedBanner}>
          <Text style={styles.unconfirmedText}>Predicted lineups</Text>
        </View>
      )}

      <MissingPlayersReport teamName={teamName} players={missingPlayers} />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Starting XI</Text>
        {starters.map((p, i) => (
          <PlayerRow key={i} player={p} />
        ))}
      </View>

      {subs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Substitutes</Text>
          {subs.map((p, i) => (
            <PlayerRow key={i} player={p} />
          ))}
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const PlayerRow = memo(({ player }: { player: PlayerData }) => {
  const rating = player.statistics?.rating;
  const isHighRating = rating && rating >= 7.5;

  return (
    <View style={styles.playerRow}>
      <View style={styles.jerseyBadge}>
        <Text style={styles.jerseyNumber}>{player.jerseyNumber}</Text>
      </View>
      <Image
        source={{ uri: getPlayerImageUrl(player.player?.id || 0) }}
        style={styles.playerImage}
        contentFit="cover"
        cachePolicy="disk"
      />
      <Text style={styles.playerName} numberOfLines={1}>
        {player.player?.shortName || player.player?.name || ""}
      </Text>
      <Text style={styles.positionText}>{player.position}</Text>
      {rating ? (
        <View
          style={[styles.ratingBadge, isHighRating && styles.ratingBadgeHigh]}
        >
          <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
        </View>
      ) : null}
    </View>
  );
});

function getMissingPlayerStatus(player: MissingPlayer) {
  const text = `${player.description || ""} ${player.reason || ""} ${player.type || ""}`.toLowerCase();
  if (text.includes("suspension") || text.includes("suspend") || text.includes("red_card")) {
    return "Suspended";
  }
  if (text.includes("doubt")) {
    return "Doubtful";
  }
  if (text.includes("unavailable")) {
    return "Unavailable";
  }
  return "Injured";
}

function formatExpectedEndDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const MissingPlayersReport = memo(({ teamName, players }: { teamName: string; players: MissingPlayer[] }) => {
  return (
    <View style={styles.section}>
      <View style={styles.reportHeader}>
        <View>
          <Text style={styles.sectionTitle}>Injury & Suspension Report</Text>
          <Text style={styles.reportSubtitle}>{teamName}</Text>
        </View>
        <View style={styles.reportCountBadge}>
          <Text style={styles.reportCountText}>{players.length}</Text>
        </View>
      </View>

      {players.length === 0 ? (
        <Text style={styles.noReportText}>No reported injuries or suspensions.</Text>
      ) : (
        players.map((missingPlayer) => {
          const status = getMissingPlayerStatus(missingPlayer);
          const expectedEndDate = formatExpectedEndDate(missingPlayer.expectedEndDate);
          const isSuspended = status === "Suspended";
          const description = missingPlayer.description?.replace(/_/g, " ") || status;

          return (
            <View key={missingPlayer.player?.id || `${missingPlayer.player?.shortName}-${description}`} style={styles.missingPlayerRow}>
              <Image
                source={{ uri: getPlayerImageUrl(missingPlayer.player?.id || 0) }}
                style={styles.missingPlayerImage}
                contentFit="cover"
                cachePolicy="disk"
              />
              <View style={styles.missingPlayerInfo}>
                <Text style={styles.missingPlayerName} numberOfLines={1}>
                  {missingPlayer.player?.shortName || missingPlayer.player?.name || "Player"}
                </Text>
                <Text style={styles.missingPlayerReason} numberOfLines={2}>
                  {description}
                  {expectedEndDate ? ` · Expected back ${expectedEndDate}` : ""}
                </Text>
              </View>
              <View style={[styles.statusBadge, isSuspended && styles.suspensionBadge]}>
                <Text style={styles.statusBadgeText}>{status}</Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
});

export default memo(LineupsTab);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  teamToggle: {
    flexDirection: "row",
    marginHorizontal: 8,
    marginTop: 8,
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    overflow: "hidden",
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  toggleBtnActive: {
    backgroundColor: Colors.dark.accent,
  },
  toggleText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
  toggleTextActive: {
    color: Colors.dark.text,
  },
  formationCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 8,
    marginTop: 8,
    backgroundColor: Colors.dark.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  formationLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  formationText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  unconfirmedBanner: {
    marginHorizontal: 8,
    marginTop: 8,
    backgroundColor: "rgba(61, 123, 244, 0.15)",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  unconfirmedText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.accent,
  },
  section: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 8,
    overflow: "hidden",
    padding: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginBottom: 8,
  },
  reportHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  reportSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    marginTop: -4,
    marginBottom: 8,
  },
  reportCountBadge: {
    minWidth: 28,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.dark.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  reportCountText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
  },
  noReportText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  missingPlayerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.dark.border,
  },
  missingPlayerImage: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.dark.border,
  },
  missingPlayerInfo: {
    flex: 1,
    minWidth: 0,
  },
  missingPlayerName: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  missingPlayerReason: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    marginTop: 2,
    textTransform: "capitalize",
  },
  statusBadge: {
    borderRadius: 999,
    backgroundColor: "rgba(229, 56, 59, 0.14)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  suspensionBadge: {
    backgroundColor: "rgba(255, 166, 0, 0.16)",
  },
  statusBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  jerseyBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.dark.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  jerseyNumber: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  playerImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.dark.border,
  },
  playerName: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.text,
  },
  positionText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    width: 16,
    textAlign: "center",
  },
  ratingBadge: {
    backgroundColor: Colors.dark.surfaceSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    minWidth: 32,
    alignItems: "center",
  },
  ratingBadgeHigh: {
    backgroundColor: Colors.dark.accent,
  },
  ratingText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
});
