import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";

function getApiBase() {
  return `${getApiUrl()}`;
}

type MatchRecord = {
  id: number;
  event_id: number;
  home_team_name: string;
  away_team_name: string;
  home_goals: number | null;
  away_goals: number | null;
  result: string | null;
  tournament: string | null;
  match_date: string | null;
  sport: string;
  home_form_strength: number | null;
  away_form_strength: number | null;
  home_scoring_strength: number | null;
  away_scoring_strength: number | null;
  home_defending_strength: number | null;
  away_defending_strength: number | null;
  home_avg_goals_scored: number | null;
  away_avg_goals_scored: number | null;
  home_avg_xg: number | null;
  away_avg_xg: number | null;
  home_avg_possession: number | null;
  away_avg_possession: number | null;
  home_avg_shots_on_target: number | null;
  away_avg_shots_on_target: number | null;
  home_matches_analyzed: number | null;
  away_matches_analyzed: number | null;
  processed_at: string;
};

function StatBadge({ label, home, away }: { label: string; home: number | null; away: number | null }) {
  if (home == null && away == null) return null;
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>
        <Text style={styles.homeVal}>{home != null ? home.toFixed(1) : "—"}</Text>
        <Text style={styles.statSep}> · </Text>
        <Text style={styles.awayVal}>{away != null ? away.toFixed(1) : "—"}</Text>
      </Text>
    </View>
  );
}

function ResultDot({ result }: { result: string | null }) {
  if (!result) return null;
  const color = result === "H" ? "#4ade80" : result === "D" ? "#facc15" : "#f87171";
  const label = result === "H" ? "H" : result === "D" ? "D" : "A";
  return (
    <View style={[styles.resultDot, { backgroundColor: color }]}>
      <Text style={styles.resultDotText}>{label}</Text>
    </View>
  );
}

function MatchCard({ item, onDelete }: { item: MatchRecord; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);

  function confirmDelete() {
    if (Platform.OS === "web") {
      if (window.confirm(`Delete ${item.home_team_name} vs ${item.away_team_name}?`)) {
        onDelete(item.event_id);
      }
    } else {
      Alert.alert("Delete Record", `Remove ${item.home_team_name} vs ${item.away_team_name}?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => onDelete(item.event_id) },
      ]);
    }
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.8} style={styles.cardHeader}>
        <View style={styles.cardMain}>
          <ResultDot result={item.result} />
          <View style={styles.teamsRow}>
            <Text style={styles.teamName} numberOfLines={1}>{item.home_team_name}</Text>
            <Text style={styles.score}>
              {item.home_goals ?? "?"} – {item.away_goals ?? "?"}
            </Text>
            <Text style={styles.teamName} numberOfLines={1}>{item.away_team_name}</Text>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color="#6b7280" />
        </View>
        <View style={styles.cardMeta}>
          <Text style={styles.metaText}>{item.tournament || "—"}</Text>
          <Text style={styles.metaText}>{item.match_date || "—"}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedSection}>
          <View style={styles.statsHeader}>
            <Text style={styles.statsHeaderText}>Stat</Text>
            <Text style={styles.statsHeaderText}>Home · Away</Text>
          </View>
          <StatBadge label="Form Str." home={item.home_form_strength} away={item.away_form_strength} />
          <StatBadge label="Scoring" home={item.home_scoring_strength} away={item.away_scoring_strength} />
          <StatBadge label="Defending" home={item.home_defending_strength} away={item.away_defending_strength} />
          <StatBadge label="Avg Goals" home={item.home_avg_goals_scored} away={item.away_avg_goals_scored} />
          <StatBadge label="Avg xG" home={item.home_avg_xg} away={item.away_avg_xg} />
          <StatBadge label="Possession %" home={item.home_avg_possession} away={item.away_avg_possession} />
          <StatBadge label="Shots on Tgt" home={item.home_avg_shots_on_target} away={item.away_avg_shots_on_target} />
          <View style={styles.analyzedRow}>
            <Text style={styles.analyzedText}>
              Analyzed: {item.home_matches_analyzed ?? "—"} vs {item.away_matches_analyzed ?? "—"} matches
            </Text>
          </View>
          <TouchableOpacity onPress={confirmDelete} style={styles.deleteBtn} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={14} color="#f87171" />
            <Text style={styles.deleteBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function DatabaseScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = useCallback((text: string) => {
    setSearch(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(text), 400);
  }, []);

  const { data, isLoading, refetch, isRefetching } = useQuery<{ matches: MatchRecord[]; total: number }>({
    queryKey: ["/api/database/matches", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(new URL(`/api/database/matches?${params}`, getApiBase()).href);
      return res.json();
    },
  });

  const { data: stats } = useQuery<{ total: number; byResult: { result: string; c: number }[] }>({
    queryKey: ["/api/database/stats"],
    queryFn: async () => {
      const res = await fetch(new URL("/api/database/stats", getApiBase()).href);
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const res = await fetch(new URL(`/api/database/match/${eventId}`, getApiBase()).href, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/database/matches"] });
      qc.invalidateQueries({ queryKey: ["/api/database/stats"] });
    },
  });

  const matches = data?.matches || [];
  const total = data?.total ?? 0;

  const homeWins = stats?.byResult.find((r) => r.result === "H")?.c ?? 0;
  const draws = stats?.byResult.find((r) => r.result === "D")?.c ?? 0;
  const awayWins = stats?.byResult.find((r) => r.result === "A")?.c ?? 0;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Database</Text>
        <Text style={styles.subtitle}>{stats?.total ?? 0} matches stored</Text>
      </View>

      {(stats?.total ?? 0) > 0 && (
        <View style={styles.summaryRow}>
          <View style={[styles.summaryBadge, { backgroundColor: "#16a34a22" }]}>
            <Text style={[styles.summaryNum, { color: "#4ade80" }]}>{homeWins}</Text>
            <Text style={styles.summaryLbl}>Home Wins</Text>
          </View>
          <View style={[styles.summaryBadge, { backgroundColor: "#ca8a0422" }]}>
            <Text style={[styles.summaryNum, { color: "#facc15" }]}>{draws}</Text>
            <Text style={styles.summaryLbl}>Draws</Text>
          </View>
          <View style={[styles.summaryBadge, { backgroundColor: "#dc262622" }]}>
            <Text style={[styles.summaryNum, { color: "#f87171" }]}>{awayWins}</Text>
            <Text style={styles.summaryLbl}>Away Wins</Text>
          </View>
        </View>
      )}

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color="#6b7280" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={onSearch}
          placeholder="Search teams, tournament..."
          placeholderTextColor="#6b7280"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => { setSearch(""); setDebouncedSearch(""); }}>
            <Ionicons name="close-circle" size={18} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : matches.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="server-outline" size={48} color="#374151" />
          <Text style={styles.emptyText}>No matches stored yet</Text>
          <Text style={styles.emptySubtext}>Use the Processing tab to bulk upload match data</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => String(item.event_id)}
          renderItem={({ item }) => (
            <MatchCard item={item} onDelete={(id) => deleteMutation.mutate(id)} />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: botPad + 100, paddingTop: 8 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#3b82f6" />}
          ListHeaderComponent={
            <Text style={styles.countText}>
              Showing {matches.length}{total > matches.length ? ` of ${total}` : ""} records
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f0f" },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#f9fafb" },
  subtitle: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  summaryRow: { flexDirection: "row", paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  summaryBadge: { flex: 1, borderRadius: 10, padding: 10, alignItems: "center" },
  summaryNum: { fontSize: 22, fontWeight: "700" },
  summaryLbl: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "#1f2937",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: "#f9fafb", fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { color: "#9ca3af", fontSize: 16, fontWeight: "600" },
  emptySubtext: { color: "#6b7280", fontSize: 13, textAlign: "center", paddingHorizontal: 32 },
  countText: { fontSize: 12, color: "#6b7280", marginBottom: 8 },
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
    overflow: "hidden",
  },
  cardHeader: { padding: 14 },
  cardMain: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  resultDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  resultDotText: { fontSize: 11, fontWeight: "700", color: "#000" },
  teamsRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  teamName: { fontSize: 13, fontWeight: "600", color: "#e5e7eb", flex: 1 },
  score: { fontSize: 15, fontWeight: "700", color: "#f9fafb", paddingHorizontal: 10 },
  cardMeta: { flexDirection: "row", justifyContent: "space-between" },
  metaText: { fontSize: 11, color: "#6b7280" },
  expandedSection: {
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#111827",
  },
  statsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  statsHeaderText: { fontSize: 11, fontWeight: "600", color: "#6b7280" },
  statRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  statLabel: { fontSize: 12, color: "#9ca3af" },
  statValue: { fontSize: 12 },
  homeVal: { color: "#60a5fa" },
  awayVal: { color: "#f87171" },
  statSep: { color: "#6b7280" },
  analyzedRow: { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#1f2937" },
  analyzedText: { fontSize: 11, color: "#6b7280" },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    alignSelf: "flex-end",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: "#1f1414",
    borderWidth: 1,
    borderColor: "#7f1d1d",
  },
  deleteBtnText: { fontSize: 12, color: "#f87171", fontWeight: "600" },
});
