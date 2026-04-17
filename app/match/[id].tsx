import React, { useState, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import MatchHeader from "@/components/match/MatchHeader";
import DetailsTab from "@/components/match/DetailsTab";
import LineupsTab from "@/components/match/LineupsTab";
import StatisticsTab from "@/components/match/StatisticsTab";
import StandingsTab from "@/components/match/StandingsTab";
import MatchesTab from "@/components/match/MatchesTab";
import OddsTab from "@/components/match/OddsTab";
import StadiumSimulationTab from "@/components/match/StadiumSimulationTab";
import AIInsightTab from "@/components/match/AIInsightTab";

const TABS = ["Details", "Lineups", "Simulation", "Statistics", "Standings", "Matches", "Odds", "AI Insight"] as const;
type TabName = (typeof TABS)[number];

interface EventResponse {
  event: {
    tournament?: {
      name?: string;
      uniqueTournament?: {
        id?: number;
        name?: string;
        category?: { name?: string };
      };
    };
    season?: { id?: number };
    homeTeam: { id: number; shortName: string; name?: string };
    awayTeam: { id: number; shortName: string; name?: string };
    homeScore: { current?: number; display?: number; period1?: number; period2?: number };
    awayScore: { current?: number; display?: number; period1?: number; period2?: number };
    status: { type: string; description: string };
    venue?: { stadium?: string; city?: { name?: string }; country?: { name?: string } };
    referee?: { name?: string };
    startTimestamp: number;
    roundInfo?: { round?: number };
    winnerCode?: number;
  };
}

interface Incident {
  incidentType: string;
  text?: string;
  time?: number;
  addedTime?: number;
  player?: { shortName?: string };
  playerName?: string;
  isHome?: boolean;
  description?: string;
}

export default function MatchDetailScreen() {
  const params = useLocalSearchParams<{
    id: string;
    homeTeamName?: string;
    awayTeamName?: string;
    homeTeamId?: string;
    awayTeamId?: string;
    homeScore?: string;
    awayScore?: string;
    statusType?: string;
    statusDescription?: string;
    startTimestamp?: string;
    tournamentName?: string;
    seasonId?: string;
    uniqueTournamentId?: string;
  }>();

  const [activeTab, setActiveTab] = useState<TabName>("Details");
  const tabScrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  const eventId = params.id;

  const { data: eventData, isLoading: eventLoading } = useQuery<EventResponse>({
    queryKey: ["/api/event", eventId],
  });

  const { data: incidentsData } = useQuery<{ incidents: Incident[] }>({
    queryKey: ["/api/event", eventId, "incidents"],
  });

  const event = eventData?.event;

  const homeTeamName = event?.homeTeam?.shortName || event?.homeTeam?.name || params.homeTeamName || "";
  const awayTeamName = event?.awayTeam?.shortName || event?.awayTeam?.name || params.awayTeamName || "";
  const homeTeamId = event?.homeTeam?.id || Number(params.homeTeamId) || 0;
  const awayTeamId = event?.awayTeam?.id || Number(params.awayTeamId) || 0;
  const homeScore = event?.homeScore?.display ?? event?.homeScore?.current ?? (params.homeScore ? Number(params.homeScore) : null);
  const awayScore = event?.awayScore?.display ?? event?.awayScore?.current ?? (params.awayScore ? Number(params.awayScore) : null);
  const statusType = event?.status?.type || params.statusType || "";
  const statusDescription = event?.status?.description || params.statusDescription || "";
  const startTimestamp = event?.startTimestamp || Number(params.startTimestamp) || 0;
  const tournamentName = event?.tournament?.uniqueTournament?.name || event?.tournament?.name || params.tournamentName || "";
  const seasonId = event?.season?.id?.toString() || params.seasonId || "";
  const uniqueTournamentId = event?.tournament?.uniqueTournament?.id?.toString() || params.uniqueTournamentId || "";

  const venue = typeof event?.venue?.stadium === "string" ? event.venue.stadium : "";
  const city = typeof event?.venue?.city?.name === "string" ? event.venue.city.name : "";
  const refereeStr = typeof event?.referee?.name === "string" ? event.referee.name : "";
  const roundInfo = event?.roundInfo?.round ? `Round ${event.roundInfo.round}` : "";

  const goalScorers = useMemo(() => {
    const incidents = incidentsData?.incidents || [];
    const homeGoals: string[] = [];
    const awayGoals: string[] = [];
    incidents.forEach((inc) => {
      if (inc.incidentType === "goal") {
        const name = inc.player?.shortName || inc.playerName || "";
        const timeStr = inc.addedTime ? `${inc.time}+${inc.addedTime}'` : `${inc.time}'`;
        const desc = inc.description ? ` (${inc.description})` : "";
        const text = `${name} ${timeStr}${desc}`;
        if (inc.isHome) homeGoals.push(text);
        else awayGoals.push(text);
      }
    });
    return { homeGoals, awayGoals };
  }, [incidentsData]);

  const handleTabPress = useCallback((tab: TabName, index: number) => {
    setActiveTab(tab);
    tabScrollRef.current?.scrollTo({ x: Math.max(0, index * 90 - 60), animated: true });
  }, []);

  const webBottomPadding = Platform.OS === "web" ? 34 : 0;

  if (eventLoading && !params.homeTeamName) {
    return (
      <View style={[styles.container, { paddingBottom: webBottomPadding + insets.bottom }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: webBottomPadding + insets.bottom }]}>
      <MatchHeader
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        homeTeamId={homeTeamId}
        awayTeamId={awayTeamId}
        homeScore={homeScore}
        awayScore={awayScore}
        statusType={statusType}
        statusDescription={statusDescription}
        startTimestamp={startTimestamp}
        tournamentName={tournamentName}
        homeGoalScorers={goalScorers.homeGoals}
        awayGoalScorers={goalScorers.awayGoals}
      />

      <View style={styles.tabBarContainer}>
        <ScrollView
          ref={tabScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBarContent}
        >
          {TABS.map((tab, index) => (
            <TouchableOpacity
              key={tab}
              style={styles.tabItem}
              onPress={() => handleTabPress(tab, index)}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab && styles.tabTextActive,
                ]}
              >
                {tab}
              </Text>
              {activeTab === tab && <View style={styles.tabIndicator} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.tabContent}>
        {activeTab === "Details" && (
          <DetailsTab
            eventId={eventId}
            venue={venue}
            city={city}
            referee={refereeStr}
            roundInfo={roundInfo}
            tournamentName={tournamentName}
          />
        )}
        {activeTab === "Lineups" && (
          <LineupsTab
            eventId={eventId}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
          />
        )}
        {activeTab === "Statistics" && (
          <StatisticsTab eventId={eventId} />
        )}
        {activeTab === "Simulation" && (
          <StadiumSimulationTab
            eventId={eventId}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
            homeTeamId={homeTeamId}
            awayTeamId={awayTeamId}
            venue={venue}
            city={city}
          />
        )}
        {activeTab === "Standings" && (
          <StandingsTab
            uniqueTournamentId={uniqueTournamentId}
            seasonId={seasonId}
            homeTeamId={homeTeamId}
            awayTeamId={awayTeamId}
          />
        )}
        {activeTab === "Matches" && (
          <MatchesTab
            homeTeamId={homeTeamId}
            awayTeamId={awayTeamId}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
          />
        )}
        {activeTab === "Odds" && (
          <OddsTab eventId={eventId} />
        )}
        {activeTab === "AI Insight" && (
          <AIInsightTab
            eventId={eventId}
            homeTeamId={homeTeamId}
            awayTeamId={awayTeamId}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
            tournamentName={tournamentName}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  tabBarContainer: {
    backgroundColor: Colors.dark.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  tabBarContent: {
    paddingHorizontal: 12,
  },
  tabItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    position: "relative",
  },
  tabText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  tabTextActive: {
    color: Colors.dark.accent,
    fontFamily: "Inter_600SemiBold",
  },
  tabIndicator: {
    position: "absolute",
    bottom: 0,
    left: 14,
    right: 14,
    height: 2,
    backgroundColor: Colors.dark.accent,
    borderRadius: 1,
  },
  tabContent: {
    flex: 1,
  },
});
