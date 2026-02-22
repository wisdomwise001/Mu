import React, { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import Colors from "@/constants/colors";
import {
  SofaEvent,
  getTeamImageUrl,
  getMatchStatusText,
  isLive,
  isFinished,
} from "@/lib/api";

interface MatchRowProps {
  event: SofaEvent;
  isLast: boolean;
}

function MatchRow({ event, isLast }: MatchRowProps) {
  const live = isLive(event);
  const finished = isFinished(event);
  const statusText = getMatchStatusText(event);

  const homeScore = event.homeScore?.display ?? event.homeScore?.current;
  const awayScore = event.awayScore?.display ?? event.awayScore?.current;
  const hasScore = homeScore !== undefined && homeScore !== null;

  const homeWin = finished && event.winnerCode === 1;
  const awayWin = finished && event.winnerCode === 2;

  return (
    <View
      style={[
        styles.container,
        !isLast && styles.borderBottom,
        live && styles.liveContainer,
      ]}
    >
      <View style={styles.statusColumn}>
        <Text
          style={[
            styles.statusText,
            live && styles.statusLive,
            finished && styles.statusFinished,
          ]}
        >
          {statusText}
        </Text>
      </View>

      <View style={styles.teamsColumn}>
        <View style={styles.teamRow}>
          <Image
            source={{ uri: getTeamImageUrl(event.homeTeam.id) }}
            style={styles.teamLogo}
            contentFit="contain"
            cachePolicy="disk"
          />
          <Text
            style={[
              styles.teamName,
              finished && !homeWin && styles.teamNameLost,
            ]}
            numberOfLines={1}
          >
            {event.homeTeam.shortName || event.homeTeam.name}
          </Text>
        </View>
        <View style={styles.teamRow}>
          <Image
            source={{ uri: getTeamImageUrl(event.awayTeam.id) }}
            style={styles.teamLogo}
            contentFit="contain"
            cachePolicy="disk"
          />
          <Text
            style={[
              styles.teamName,
              finished && !awayWin && styles.teamNameLost,
            ]}
            numberOfLines={1}
          >
            {event.awayTeam.shortName || event.awayTeam.name}
          </Text>
        </View>
      </View>

      {hasScore && (
        <View style={styles.scoreColumn}>
          <Text
            style={[
              styles.score,
              live && styles.scoreLive,
              finished && !homeWin && styles.scoreLost,
            ]}
          >
            {homeScore}
          </Text>
          <Text
            style={[
              styles.score,
              live && styles.scoreLive,
              finished && !awayWin && styles.scoreLost,
            ]}
          >
            {awayScore}
          </Text>
        </View>
      )}
    </View>
  );
}

export default memo(MatchRow);

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 60,
  },
  liveContainer: {
    backgroundColor: Colors.dark.liveBackground,
  },
  borderBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  statusColumn: {
    width: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
  statusLive: {
    color: Colors.dark.live,
    fontFamily: "Inter_600SemiBold",
  },
  statusFinished: {
    color: Colors.dark.finished,
  },
  teamsColumn: {
    flex: 1,
    gap: 6,
    paddingHorizontal: 8,
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  teamLogo: {
    width: 20,
    height: 20,
  },
  teamName: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.text,
    flex: 1,
  },
  teamNameLost: {
    color: Colors.dark.textSecondary,
  },
  scoreColumn: {
    width: 28,
    alignItems: "center",
    gap: 6,
  },
  score: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  scoreLive: {
    color: Colors.dark.live,
  },
  scoreLost: {
    color: Colors.dark.textSecondary,
  },
});
