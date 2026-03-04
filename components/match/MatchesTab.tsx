import React, { memo, useCallback } from "react";
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
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import { getTeamImageUrl } from "@/lib/api";

interface MatchEvent {
  id: number;
  tournament?: { name?: string; uniqueTournament?: { name?: string } };
  homeTeam: { id: number; shortName: string; name?: string };
  awayTeam: { id: number; shortName: string; name?: string };
  homeScore: { display?: number; current?: number };
  awayScore: { display?: number; current?: number };
  status: { type: string };
  startTimestamp: number;
  winnerCode?: number;
}

interface MatchesTabProps {
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
}

function MatchesTab({ homeTeamId, awayTeamId, homeTeamName, awayTeamName }: MatchesTabProps) {
  const router = useRouter();
  const { data: homeData, isLoading: homeLoading } = useQuery<{ events: MatchEvent[] }>({
    queryKey: ["/api/team", homeTeamId.toString(), "events", "last", "0"],
  });

  const { data: awayData, isLoading: awayLoading } = useQuery<{ events: MatchEvent[] }>({
    queryKey: ["/api/team", awayTeamId.toString(), "events", "last", "0"],
  });

  const handleMatchPress = useCallback((match: MatchEvent) => {
    router.push({
      pathname: `/match/${match.id}`,
      params: {
        homeTeamName: match.homeTeam.shortName || match.homeTeam.name,
        awayTeamName: match.awayTeam.shortName || match.awayTeam.name,
        homeTeamId: match.homeTeam.id.toString(),
        awayTeamId: match.awayTeam.id.toString(),
        homeScore: (match.homeScore?.display ?? match.homeScore?.current ?? 0).toString(),
        awayScore: (match.awayScore?.display ?? match.awayScore?.current ?? 0).toString(),
        statusType: match.status.type,
        startTimestamp: match.startTimestamp.toString(),
        tournamentName: match.tournament?.uniqueTournament?.name || match.tournament?.name || "",
      },
    });
  }, [router]);

  if (homeLoading || awayLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
      </View>
    );
  }

  const homeMatches = (homeData?.events || []).slice(0, 15);
  const awayMatches = (awayData?.events || []).slice(0, 15);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Image
            source={{ uri: getTeamImageUrl(homeTeamId) }}
            style={styles.sectionLogo}
            contentFit="contain"
            cachePolicy="disk"
          />
          <Text style={styles.sectionTitle}>{homeTeamName}</Text>
        </View>
        {homeMatches.map((match) => (
          <PastMatchRow 
            key={match.id} 
            match={match} 
            teamId={homeTeamId} 
            onPress={() => handleMatchPress(match)}
          />
        ))}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Image
            source={{ uri: getTeamImageUrl(awayTeamId) }}
            style={styles.sectionLogo}
            contentFit="contain"
            cachePolicy="disk"
          />
          <Text style={styles.sectionTitle}>{awayTeamName}</Text>
        </View>
        {awayMatches.map((match) => (
          <PastMatchRow 
            key={match.id} 
            match={match} 
            teamId={awayTeamId} 
            onPress={() => handleMatchPress(match)}
          />
        ))}
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const PastMatchRow = memo(({ 
  match, 
  teamId, 
  onPress 
}: { 
  match: MatchEvent; 
  teamId: number;
  onPress: () => void;
}) => {
  const isHome = match.homeTeam.id === teamId;
  const homeScore = match.homeScore?.display ?? match.homeScore?.current ?? 0;
  const awayScore = match.awayScore?.display ?? match.awayScore?.current ?? 0;
  const opponent = isHome ? match.awayTeam : match.homeTeam;
  const opponentId = opponent.id;

  let result: "W" | "D" | "L" = "D";
  if (match.winnerCode === 1) result = isHome ? "W" : "L";
  else if (match.winnerCode === 2) result = isHome ? "L" : "W";
  else if (match.winnerCode === 3) result = "D";

  const date = new Date(match.startTimestamp * 1000);
  const dateStr = `${date.getDate().toString().padStart(2, "0")}.${(date.getMonth() + 1).toString().padStart(2, "0")}`;

  const compName = match.tournament?.uniqueTournament?.name || match.tournament?.name || "";

  const resultColor =
    result === "W" ? Colors.dark.win : result === "L" ? Colors.dark.live : Colors.dark.textSecondary;

  return (
    <TouchableOpacity style={styles.matchRow} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.resultBadge, { backgroundColor: resultColor }]}>
        <Text style={styles.resultText}>{result}</Text>
      </View>
      <View style={styles.matchInfo}>
        <View style={styles.matchTopRow}>
          <Image
            source={{ uri: getTeamImageUrl(opponentId) }}
            style={styles.opponentLogo}
            contentFit="contain"
            cachePolicy="disk"
          />
          <Text style={styles.opponentName} numberOfLines={1}>
            {isHome ? "vs" : "@"} {opponent.shortName || opponent.name}
          </Text>
        </View>
        <Text style={styles.compText} numberOfLines={1}>
          {compName}
        </Text>
      </View>
      <View style={styles.matchScore}>
        <Text style={styles.scoreText}>
          {homeScore} - {awayScore}
        </Text>
        <Text style={styles.dateText}>{dateStr}</Text>
      </View>
    </TouchableOpacity>
  );
});

export default memo(MatchesTab);

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
  section: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 8,
    overflow: "hidden",
    padding: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  sectionLogo: {
    width: 20,
    height: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  resultBadge: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  resultText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  matchInfo: {
    flex: 1,
    gap: 2,
  },
  matchTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  opponentLogo: {
    width: 16,
    height: 16,
  },
  opponentName: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.text,
    flex: 1,
  },
  compText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    marginLeft: 22,
  },
  matchScore: {
    alignItems: "flex-end",
    gap: 2,
  },
  scoreText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  dateText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
  },
});
