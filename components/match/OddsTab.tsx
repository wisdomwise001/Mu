import React, { memo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

interface OddsChoice {
  name: string;
  fractionalValue: string;
  change: number;
}

interface OddsMarket {
  marketName: string;
  marketId: number;
  choices: OddsChoice[];
}

interface OddsTabProps {
  eventId: string;
}

function fractionalToDecimal(fractional: string): string {
  if (!fractional || fractional === "-" || fractional === "N/A") return fractional;
  const f = fractional.trim().toLowerCase();
  if (f === "evs" || f === "ev") return "2.00";
  if (f.includes("/")) {
    const parts = f.split("/");
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      return (num / den + 1).toFixed(2);
    }
  }
  const num = parseFloat(f);
  if (!isNaN(num)) return (num + 1).toFixed(2);
  return fractional;
}

function OddsTab({ eventId }: OddsTabProps) {
  const { data, isLoading } = useQuery<{ markets: OddsMarket[] }>({
    queryKey: ["/api/event", eventId, "odds", "1", "all"],
  });

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
      </View>
    );
  }

  const markets = data?.markets || [];

  if (markets.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Odds not available</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.decimalNote}>
        <Ionicons name="information-circle-outline" size={13} color={Colors.dark.textSecondary} />
        <Text style={styles.decimalNoteText}>Decimal odds</Text>
      </View>
      {markets.map((market, index) => (
        <MarketCard key={`${market.marketId}-${index}`} market={market} />
      ))}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const MarketCard = memo(({ market }: { market: OddsMarket }) => {
  return (
    <View style={styles.marketCard}>
      <Text style={styles.marketName}>{market.marketName}</Text>
      <View style={styles.choicesRow}>
        {market.choices.map((choice, index) => (
          <View key={index} style={styles.choiceItem}>
            <Text style={styles.choiceName}>{choice.name}</Text>
            <View style={styles.choiceValueRow}>
              <Text style={styles.choiceValue}>{fractionalToDecimal(choice.fractionalValue)}</Text>
              {choice.change !== 0 && (
                <Ionicons
                  name={choice.change === 1 ? "caret-up" : "caret-down"}
                  size={10}
                  color={choice.change === 1 ? Colors.dark.win : Colors.dark.live}
                />
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
});

export default memo(OddsTab);

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
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  decimalNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  decimalNoteText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  marketCard: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 8,
    padding: 12,
  },
  marketName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginBottom: 10,
  },
  choicesRow: {
    flexDirection: "row",
    gap: 8,
  },
  choiceItem: {
    flex: 1,
    backgroundColor: Colors.dark.surfaceSecondary,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 4,
  },
  choiceName: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
  },
  choiceValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  choiceValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
});
