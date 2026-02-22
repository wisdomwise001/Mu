import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Platform,
  TouchableOpacity,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import DateSelector from "./DateSelector";
import FilterBar, { FilterType } from "./FilterBar";
import LeagueSection from "./LeagueSection";
import {
  fetchScheduledEvents,
  groupEventsByTournament,
  isLive,
  isFinished,
  isUpcoming,
  TournamentGroup,
} from "@/lib/api";

interface SportScreenProps {
  sport: string;
  title: string;
}

export default function SportScreen({ sport, title }: SportScreenProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const insets = useSafeAreaInsets();

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const {
    data: events,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["events", sport, dateStr],
    queryFn: () => fetchScheduledEvents(sport, dateStr),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 2,
  });

  const liveCount = useMemo(
    () => events?.filter(isLive).length || 0,
    [events],
  );

  const filteredGroups = useMemo(() => {
    if (!events) return [];

    let filtered = events;
    if (activeFilter === "live") filtered = events.filter(isLive);
    else if (activeFilter === "finished") filtered = events.filter(isFinished);
    else if (activeFilter === "upcoming") filtered = events.filter(isUpcoming);

    return groupEventsByTournament(filtered);
  }, [events, activeFilter]);

  const handleDateSelect = useCallback((date: Date) => {
    setSelectedDate(date);
    setActiveFilter("all");
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: TournamentGroup }) => <LeagueSection group={item} />,
    [],
  );

  const webTopPadding = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.container, { paddingTop: webTopPadding }]}>
      <View style={[styles.headerBar, Platform.OS !== "web" && { paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>{title}</Text>
          {Platform.OS === "web" && (
            <TouchableOpacity
              onPress={() => window.location.reload()}
              style={styles.refreshButton}
            >
              <Ionicons name="refresh" size={20} color={Colors.dark.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.headerDate}>{format(selectedDate, "EEEE, MMMM d")}</Text>
      </View>

      <DateSelector
        selectedDate={selectedDate}
        onSelectDate={handleDateSelect}
      />

      <FilterBar
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        liveCount={liveCount}
      />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
          <Text style={styles.loadingText}>Loading fixtures...</Text>
        </View>
      ) : filteredGroups.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="football-outline"
            size={48}
            color={Colors.dark.textTertiary}
          />
          <Text style={styles.emptyText}>No matches found</Text>
          <Text style={styles.emptySubtext}>
            {activeFilter !== "all"
              ? "Try changing the filter"
              : "No fixtures scheduled for this date"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredGroups}
          renderItem={renderItem}
          keyExtractor={(item) =>
            item.tournament?.uniqueTournament?.id?.toString() ||
            item.tournament?.name ||
            Math.random().toString()
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Platform.OS === "web" ? 34 + 84 : 100 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={!!isRefetching}
              onRefresh={refetch}
              tintColor={Colors.dark.accent}
              colors={[Colors.dark.accent]}
            />
          }
          scrollEnabled={!!filteredGroups.length}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  headerBar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.dark.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  refreshButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  headerDate: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
    marginTop: 8,
  },
  emptySubtext: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    textAlign: "center",
  },
  listContent: {
    paddingTop: 8,
  },
});
