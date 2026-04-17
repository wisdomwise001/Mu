import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Platform,
  TouchableOpacity,
  useWindowDimensions,
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
  const [searchQuery, setSearchQuery] = useState("");
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

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

  const dateEvents = useMemo(
    () =>
      (events || []).filter((event) => {
        const eventDate = format(new Date(event.startTimestamp * 1000), "yyyy-MM-dd");
        return eventDate === dateStr;
      }),
    [events, dateStr],
  );

  const liveCount = useMemo(
    () => dateEvents.filter(isLive).length,
    [dateEvents],
  );

  const filteredGroups = useMemo(() => {
    if (!events) return [];

    const query = searchQuery.trim().toLowerCase();
    let filtered = dateEvents;

    if (activeFilter === "live") filtered = filtered.filter(isLive);
    else if (activeFilter === "finished") filtered = filtered.filter(isFinished);
    else if (activeFilter === "upcoming") filtered = filtered.filter(isUpcoming);

    if (query) {
      filtered = filtered.filter((event) => {
        const tournamentName = event.tournament?.uniqueTournament?.name || event.tournament?.name || "";
        const categoryName = event.tournament?.uniqueTournament?.category?.name || event.tournament?.category?.name || "";
        return [
          event.homeTeam?.name,
          event.homeTeam?.shortName,
          event.awayTeam?.name,
          event.awayTeam?.shortName,
          tournamentName,
          categoryName,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));
      });
    }

    return groupEventsByTournament(filtered);
  }, [events, activeFilter, searchQuery, dateEvents]);

  const handleDateSelect = useCallback((date: Date) => {
    setSelectedDate(date);
    setActiveFilter("all");
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: TournamentGroup }) => <LeagueSection group={item} />,
    [],
  );

  const webTopPadding = Platform.OS === "web" ? (width < 600 ? 10 : 67) : 0;

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

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={16} color={Colors.dark.textTertiary} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search teams, leagues, countries"
          placeholderTextColor={Colors.dark.textTertiary}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && Platform.OS !== "ios" ? (
          <TouchableOpacity onPress={clearSearch} style={styles.clearSearchButton}>
            <Ionicons name="close-circle" size={16} color={Colors.dark.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </View>

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
            {searchQuery.trim()
              ? "Try a different team or league name"
              : activeFilter !== "all"
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
    paddingBottom: 10,
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
    fontSize: 21,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  headerDate: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 10,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.dark.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingVertical: 0,
    outlineStyle: "none",
  },
  clearSearchButton: {
    padding: 2,
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
