import React, { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import Colors from "@/constants/colors";
import { TournamentGroup, getTournamentImageUrl } from "@/lib/api";
import MatchRow from "./MatchRow";

interface LeagueSectionProps {
  group: TournamentGroup;
}

function LeagueSection({ group }: LeagueSectionProps) {
  const { tournament, events } = group;
  const uniqueTournament = tournament?.uniqueTournament;
  const category = uniqueTournament?.category;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {uniqueTournament?.id && (
          <Image
            source={{ uri: getTournamentImageUrl(uniqueTournament.id) }}
            style={styles.tournamentLogo}
            contentFit="contain"
            cachePolicy="disk"
          />
        )}
        <View style={styles.headerText}>
          {category?.name && (
            <Text style={styles.countryName} numberOfLines={1}>
              {category.name}
            </Text>
          )}
          <Text style={styles.tournamentName} numberOfLines={1}>
            {uniqueTournament?.name || tournament?.name || "Unknown"}
          </Text>
        </View>
      </View>

      {events.map((event, index) => (
        <MatchRow
          key={event.id}
          event={event}
          isLast={index === events.length - 1}
        />
      ))}
    </View>
  );
}

export default memo(LeagueSection);

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.dark.card,
    marginBottom: 6,
    borderRadius: 8,
    overflow: "hidden",
    marginHorizontal: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
    gap: 8,
  },
  tournamentLogo: {
    width: 20,
    height: 20,
  },
  headerText: {
    flex: 1,
    gap: 1,
  },
  countryName: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tournamentName: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
});
