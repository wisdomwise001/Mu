import React, { useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import { format, addDays, subDays, isToday, isSameDay } from "date-fns";
import Colors from "@/constants/colors";
import * as Haptics from "expo-haptics";

interface DateSelectorProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

const ITEM_WIDTH = 58;
const TOTAL_DAYS = 61;
const CENTER_INDEX = 30;

export default function DateSelector({
  selectedDate,
  onSelectDate,
}: DateSelectorProps) {
  const flatListRef = useRef<FlatList>(null);

  const dates = useMemo(() => {
    const today = new Date();
    return Array.from({ length: TOTAL_DAYS }, (_, i) =>
      addDays(subDays(today, CENTER_INDEX), i),
    );
  }, []);

  const handleSelect = useCallback(
    (date: Date) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onSelectDate(date);
    },
    [onSelectDate],
  );

  const renderItem = useCallback(
    ({ item }: { item: Date }) => {
      const isSelected = isSameDay(item, selectedDate);
      const today = isToday(item);

      return (
        <Pressable
          onPress={() => handleSelect(item)}
          style={[styles.dateItem, isSelected && styles.dateItemActive]}
        >
          <Text
            style={[
              styles.dayName,
              isSelected && styles.dayNameActive,
              today && !isSelected && styles.dayNameToday,
            ]}
          >
            {today ? "Today" : format(item, "EEE")}
          </Text>
          <Text
            style={[
              styles.dayNumber,
              isSelected && styles.dayNumberActive,
              today && !isSelected && styles.dayNumberToday,
            ]}
          >
            {format(item, "d")}
          </Text>
          <Text
            style={[
              styles.monthName,
              isSelected && styles.monthNameActive,
              today && !isSelected && styles.monthNameToday,
            ]}
          >
            {format(item, "MMM")}
          </Text>
        </Pressable>
      );
    },
    [selectedDate, handleSelect],
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: ITEM_WIDTH,
      offset: ITEM_WIDTH * index,
      index,
    }),
    [],
  );

  const initialIndex = dates.findIndex((d) => isSameDay(d, selectedDate));

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={dates}
        renderItem={renderItem}
        keyExtractor={(item) => item.toISOString()}
        horizontal
        showsHorizontalScrollIndicator={false}
        getItemLayout={getItemLayout}
        initialScrollIndex={Math.max(0, initialIndex - 2)}
        contentContainerStyle={styles.listContent}
        scrollEnabled={!!dates.length}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.dark.surface,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  listContent: {
    paddingHorizontal: 8,
  },
  dateItem: {
    width: ITEM_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRadius: 10,
    gap: 1,
  },
  dateItemActive: {
    backgroundColor: Colors.dark.accent,
  },
  dayName: {
    fontSize: 11,
    color: Colors.dark.textTertiary,
    fontFamily: "Inter_400Regular",
  },
  dayNameActive: {
    color: "#FFFFFF",
    fontFamily: "Inter_600SemiBold",
  },
  dayNameToday: {
    color: Colors.dark.accent,
    fontFamily: "Inter_600SemiBold",
  },
  dayNumber: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
  dayNumberActive: {
    color: "#FFFFFF",
  },
  dayNumberToday: {
    color: Colors.dark.accent,
  },
  monthName: {
    fontSize: 10,
    color: Colors.dark.textTertiary,
    fontFamily: "Inter_400Regular",
  },
  monthNameActive: {
    color: "rgba(255,255,255,0.8)",
  },
  monthNameToday: {
    color: Colors.dark.accent,
  },
});
