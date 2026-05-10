import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

interface H2HTabProps {
  eventId: string;
  homeTeamId: string | number;
  awayTeamId: string | number;
  homeTeamName: string;
  awayTeamName: string;
}

interface H2HEvent {
  id: number;
  homeTeam: { id: number; shortName: string; name: string };
  awayTeam: { id: number; shortName: string; name: string };
  homeScore: { current?: number; display?: number };
  awayScore: { current?: number; display?: number };
  startTimestamp: number;
  tournament?: { name?: string };
  status?: { type?: string };
  winnerCode?: number;
}

interface H2HResponse {
  events?: H2HEvent[];
  homeTeamEvents?: H2HEvent[];
  awayTeamEvents?: H2HEvent[];
}

function formatDate(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function outcomeColor(winnerCode: number | undefined, isHome: boolean): string {
  if (winnerCode === undefined) return Colors.dark.textSecondary;
  if (winnerCode === 0) return "#71717a"; // draw
  if ((winnerCode === 1 && isHome) || (winnerCode === 2 && !isHome)) return Colors.dark.win ?? "#22c55e";
  return Colors.dark.live ?? "#ef4444";
}

function ResultBadge({ winnerCode }: { winnerCode?: number }) {
  if (winnerCode === undefined) return null;
  const label = winnerCode === 0 ? "D" : winnerCode === 1 ? "HW" : "AW";
  const bg = winnerCode === 0 ? "#71717a33" : winnerCode === 1 ? "#22c55e22" : "#ef444422";
  const color = winnerCode === 0 ? "#71717a" : winnerCode === 1 ? "#22c55e" : "#ef4444";
  return (
    <View style={[styles.resultBadge, { backgroundColor: bg }]}>
      <Text style={[styles.resultBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

function H2HMatchRow({ match, homeTeamId, awayTeamId }: {
  match: H2HEvent;
  homeTeamId: number;
  awayTeamId: number;
}) {
  const hScore = match.homeScore?.current ?? match.homeScore?.display ?? "-";
  const aScore = match.awayScore?.current ?? match.awayScore?.display ?? "-";
  const isHome = match.homeTeam.id === homeTeamId;
  const date   = formatDate(match.startTimestamp);

  return (
    <View style={styles.matchRow}>
      <View style={styles.matchMeta}>
        <Text style={styles.matchDate}>{date}</Text>
        {match.tournament?.name ? (
          <Text style={styles.matchTournament} numberOfLines={1}>{match.tournament.name}</Text>
        ) : null}
      </View>
      <View style={styles.matchScoreRow}>
        <Text style={[styles.teamName, { textAlign: "right" }]} numberOfLines={1}>
          {match.homeTeam.shortName || match.homeTeam.name}
        </Text>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreText}>{hScore} – {aScore}</Text>
        </View>
        <Text style={[styles.teamName, { textAlign: "left" }]} numberOfLines={1}>
          {match.awayTeam.shortName || match.awayTeam.name}
        </Text>
      </View>
      <ResultBadge winnerCode={match.winnerCode} />
    </View>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={[styles.summaryValue, color ? { color } : {}]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

export default function H2HTab({ eventId, homeTeamId, awayTeamId, homeTeamName, awayTeamName }: H2HTabProps) {
  const { data, isLoading, isError } = useQuery<H2HResponse>({
    queryKey: ["/api/event", eventId, `h2h/events?homeTeamId=${homeTeamId}&awayTeamId=${awayTeamId}`],
    retry: 1,
  });

  const homeId = Number(homeTeamId);
  const awayId = Number(awayTeamId);

  const h2hStats = useMemo(() => {
    const events = data?.events ?? [];
    if (events.length === 0) return null;

    let homeWins = 0, awayWins = 0, draws = 0;
    let homeGoalsFor = 0, homeGoalsAgainst = 0;
    let awayGoalsFor = 0, awayGoalsAgainst = 0;

    for (const e of events) {
      const hg = e.homeScore?.current ?? 0;
      const ag = e.awayScore?.current ?? 0;
      const wc = e.winnerCode;

      const isHomeTeamHome = e.homeTeam.id === homeId;
      if (isHomeTeamHome) {
        homeGoalsFor     += hg;
        homeGoalsAgainst += ag;
        awayGoalsFor     += ag;
        awayGoalsAgainst += hg;
        if (wc === 1) homeWins++;
        else if (wc === 2) awayWins++;
        else if (wc === 0) draws++;
      } else {
        homeGoalsFor     += ag;
        homeGoalsAgainst += hg;
        awayGoalsFor     += hg;
        awayGoalsAgainst += ag;
        if (wc === 2) homeWins++;
        else if (wc === 1) awayWins++;
        else if (wc === 0) draws++;
      }
    }

    const total = events.length;
    const avgGoals = total > 0 ? ((homeGoalsFor + awayGoalsFor) / total).toFixed(1) : "0.0";
    return { homeWins, awayWins, draws, total, homeGoalsFor, awayGoalsFor, avgGoals };
  }, [data, homeId, awayId]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={40} color={Colors.dark.textSecondary} />
        <Text style={styles.errorText}>H2H data unavailable</Text>
      </View>
    );
  }

  const events = data.events ?? [];
  const homeEvents = data.homeTeamEvents ?? [];
  const awayEvents = data.awayTeamEvents ?? [];

  if (events.length === 0 && homeEvents.length === 0 && awayEvents.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No head-to-head records found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

      {/* Summary row */}
      {h2hStats && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>All-Time H2H ({h2hStats.total} matches)</Text>
          <View style={styles.summaryRow}>
            <SummaryCard label={homeTeamName} value={h2hStats.homeWins} color="#3D7BF4" />
            <SummaryCard label="Draws" value={h2hStats.draws} color="#71717a" />
            <SummaryCard label={awayTeamName} value={h2hStats.awayWins} color="#f59e0b" />
          </View>

          {/* Win bar */}
          {h2hStats.total > 0 && (
            <View style={styles.winBarRow}>
              <Text style={[styles.winBarPct, { color: "#3D7BF4" }]}>
                {Math.round((h2hStats.homeWins / h2hStats.total) * 100)}%
              </Text>
              <View style={styles.winBar}>
                <View style={[styles.winBarHome, { flex: h2hStats.homeWins || 0.01 }]} />
                <View style={[styles.winBarDraw, { flex: h2hStats.draws   || 0.01 }]} />
                <View style={[styles.winBarAway, { flex: h2hStats.awayWins || 0.01 }]} />
              </View>
              <Text style={[styles.winBarPct, { color: "#f59e0b" }]}>
                {Math.round((h2hStats.awayWins / h2hStats.total) * 100)}%
              </Text>
            </View>
          )}

          <View style={styles.goalsRow}>
            <View style={styles.goalStat}>
              <Text style={styles.goalStatValue}>{h2hStats.homeGoalsFor}</Text>
              <Text style={styles.goalStatLabel}>{homeTeamName} goals</Text>
            </View>
            <View style={styles.goalStat}>
              <Text style={styles.goalStatValue}>{h2hStats.avgGoals}</Text>
              <Text style={styles.goalStatLabel}>Avg goals/match</Text>
            </View>
            <View style={styles.goalStat}>
              <Text style={styles.goalStatValue}>{h2hStats.awayGoalsFor}</Text>
              <Text style={styles.goalStatLabel}>{awayTeamName} goals</Text>
            </View>
          </View>
        </View>
      )}

      {/* H2H matches */}
      {events.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Head-to-Head</Text>
          {events.map((e) => (
            <H2HMatchRow key={e.id} match={e} homeTeamId={homeId} awayTeamId={awayId} />
          ))}
        </View>
      )}

      {/* Home team recent */}
      {homeEvents.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{homeTeamName} — Recent Matches</Text>
          {homeEvents.slice(0, 5).map((e) => (
            <H2HMatchRow key={e.id} match={e} homeTeamId={homeId} awayTeamId={awayId} />
          ))}
        </View>
      )}

      {/* Away team recent */}
      {awayEvents.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{awayTeamName} — Recent Matches</Text>
          {awayEvents.slice(0, 5).map((e) => (
            <H2HMatchRow key={e.id} match={e} homeTeamId={homeId} awayTeamId={awayId} />
          ))}
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", paddingTop: 80, gap: 12 },
  errorText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },

  section: {
    marginHorizontal: 12,
    marginTop: 16,
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: Colors.dark.text,
    marginBottom: 12,
  },

  // Summary
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  summaryCard: {
    flex: 1, backgroundColor: Colors.dark.surface, borderRadius: 8, padding: 10, alignItems: "center",
  },
  summaryValue: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2, textAlign: "center" },

  winBarRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  winBar: { flex: 1, flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden" },
  winBarHome: { backgroundColor: "#3D7BF4" },
  winBarDraw: { backgroundColor: "#71717a" },
  winBarAway: { backgroundColor: "#f59e0b" },
  winBarPct: { fontSize: 11, fontFamily: "Inter_600SemiBold", minWidth: 32, textAlign: "center" },

  goalsRow: { flexDirection: "row", gap: 8 },
  goalStat: { flex: 1, alignItems: "center" },
  goalStatValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  goalStatLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, textAlign: "center", marginTop: 2 },

  // Match row
  matchRow: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    paddingVertical: 10,
    gap: 4,
  },
  matchMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  matchDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  matchTournament: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textTertiary ?? Colors.dark.textSecondary, maxWidth: "60%" },
  matchScoreRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  teamName: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.dark.text },
  scoreBox: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 60,
    alignItems: "center",
  },
  scoreText: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  resultBadge: {
    alignSelf: "flex-end",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  resultBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold" },
});
