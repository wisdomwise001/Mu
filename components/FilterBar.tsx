import React, { memo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Colors from "@/constants/colors";

export type FilterType = "all" | "live" | "finished" | "upcoming";

interface FilterBarProps {
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  liveCount?: number;
}

const filters: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "finished", label: "Finished" },
  { key: "upcoming", label: "Upcoming" },
];

function FilterBar({ activeFilter, onFilterChange, liveCount }: FilterBarProps) {
  return (
    <View style={styles.container}>
      {filters.map((filter) => {
        const isActive = activeFilter === filter.key;
        return (
          <Pressable
            key={filter.key}
            onPress={() => onFilterChange(filter.key)}
            style={[styles.filterButton, isActive && styles.filterButtonActive]}
          >
            <Text
              style={[styles.filterText, isActive && styles.filterTextActive]}
            >
              {filter.label}
            </Text>
            {filter.key === "live" && liveCount !== undefined && liveCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{liveCount}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export default memo(FilterBar);

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: Colors.dark.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.dark.surfaceSecondary,
    gap: 4,
  },
  filterButtonActive: {
    backgroundColor: Colors.dark.accent,
  },
  filterText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  filterTextActive: {
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  badge: {
    backgroundColor: Colors.dark.live,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: "center",
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
});
