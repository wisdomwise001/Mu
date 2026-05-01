import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

interface BucketPrediction {
  bucketId: string;
  label: string;
  scores: [number, number][];
  confidence: number;
  rawSum: number;
  rawDiff: number;
  roundedSum: number;
  roundedDiff: number;
  isExactHit: boolean;
  trainAccuracy: number;
  fpRate: number;
}

interface OutcomePredictResponse {
  eventId: number;
  homeTeamId: number;
  awayTeamId: number;
  source: "live_simulation" | "database_fallback";
  modelsUsed: number;
  top2: BucketPrediction[];
  all: BucketPrediction[];
  summary: {
    scoreline: string;
    confidence: string;
    rawGoalSum: number;
    rawGoalDiff: number;
    exactHit: boolean;
    modelAccuracy: string;
    modelFpRate: string;
  }[];
}

const RANK_COLORS = ["#3D7BF4", "#f59e0b"];
const RANK_LABELS = ["#1 Most Likely", "#2 Runner-Up"];

function AnimatedBar({ pct, color, delay }: { pct: number; color: string; delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: pct,
      duration: 700,
      delay,
      useNativeDriver: false,
    }).start();
  }, [pct, delay]);

  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] });
  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, { width, backgroundColor: color }]} />
    </View>
  );
}

function TopCard({
  prediction,
  rank,
  homeTeamName,
  awayTeamName,
}: {
  prediction: BucketPrediction;
  rank: number;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const color = RANK_COLORS[rank] ?? RANK_COLORS[1];
  const rankLabel = RANK_LABELS[rank] ?? `#${rank + 1}`;

  return (
    <View style={[styles.topCard, { borderColor: color }]}>
      <View style={styles.topCardHeader}>
        <View style={[styles.rankBadge, { backgroundColor: color }]}>
          <Text style={styles.rankBadgeText}>{rankLabel}</Text>
        </View>
        {prediction.isExactHit && (
          <View style={styles.exactHitBadge}>
            <Ionicons name="checkmark-circle" size={12} color="#4ade80" />
            <Text style={styles.exactHitText}>Exact</Text>
          </View>
        )}
      </View>

      <Text style={[styles.scoreline, { color }]}>{prediction.label}</Text>

      {prediction.scores.length > 0 && (
        <View style={styles.scorePills}>
          {prediction.scores.map(([h, a], i) => (
            <View key={i} style={styles.scorePill}>
              <Text style={styles.scorePillText}>
                {homeTeamName} {h} – {a} {awayTeamName}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.confidenceRow}>
        <Text style={[styles.confidenceValue, { color }]}>{prediction.confidence.toFixed(1)}%</Text>
        <Text style={styles.confidenceLabel}>confidence</Text>
      </View>

      <AnimatedBar pct={prediction.confidence} color={color} delay={rank * 150} />

      <View style={styles.modelMeta}>
        <Text style={styles.metaItem}>
          Model accuracy: {(prediction.trainAccuracy * 100).toFixed(1)}%
        </Text>
        <Text style={styles.metaItem}>
          FP rate: {(prediction.fpRate * 100).toFixed(1)}%
        </Text>
      </View>
    </View>
  );
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: 500, delay: 200, useNativeDriver: false }).start();
  }, [pct]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] });
  return (
    <View style={styles.miniTrack}>
      <Animated.View style={[styles.miniFill, { width, backgroundColor: color }]} />
    </View>
  );
}

function AllBucketsSection({ predictions }: { predictions: BucketPrediction[] }) {
  const [expanded, setExpanded] = useState(false);
  const rest = predictions.slice(2);
  const shown = expanded ? rest : rest.slice(0, 5);
  const maxConf = predictions[0]?.confidence || 1;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>All Buckets</Text>
      {shown.map((p, i) => {
        const relPct = Math.min(100, (p.confidence / maxConf) * 100);
        const alpha = Math.max(0.3, p.confidence / maxConf);
        const col = `rgba(140, 141, 150, ${alpha})`;
        return (
          <View key={p.bucketId} style={styles.miniRow}>
            <Text style={styles.miniRank}>{i + 3}</Text>
            <Text style={styles.miniLabel}>{p.label}</Text>
            <MiniBar pct={relPct} color={col} />
            <Text style={styles.miniConf}>{p.confidence.toFixed(1)}%</Text>
          </View>
        );
      })}
      {rest.length > 5 && (
        <TouchableOpacity style={styles.expandBtn} onPress={() => setExpanded(!expanded)}>
          <Text style={styles.expandText}>{expanded ? "Show less" : `Show ${rest.length - 5} more`}</Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color={Colors.dark.accent}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

interface Props {
  eventId: string;
  homeTeamId?: number;
  awayTeamId?: number;
  homeTeamName: string;
  awayTeamName: string;
}

export default function ScorePredictionTab({
  eventId,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
}: Props) {
  const canFetch = !!homeTeamId && !!awayTeamId;

  const queryParts: string[] = [];
  if (homeTeamId) queryParts.push(`homeTeamId=${homeTeamId}`);
  if (awayTeamId) queryParts.push(`awayTeamId=${awayTeamId}`);
  const queryUrl = `/api/engine/outcome-predict/${eventId}${queryParts.length ? `?${queryParts.join("&")}` : ""}`;

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<OutcomePredictResponse>({
      queryKey: [queryUrl],
      enabled: canFetch,
      staleTime: 5 * 60 * 1000,
      retry: false,
    });

  if (!canFetch) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={40} color={Colors.dark.textTertiary} />
        <Text style={styles.emptyText}>Team IDs unavailable for this match.</Text>
        <Text style={styles.emptySubText}>Open the match from the schedule to load team data.</Text>
      </View>
    );
  }

  if (isLoading || isFetching) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
        <Text style={styles.loadingText}>Running bucket models…</Text>
        <Text style={styles.loadingSubText}>
          Fetching live simulation data via proxy — this may take up to 90 s
        </Text>
      </View>
    );
  }

  if (isError || !data) {
    const msg = (error as Error)?.message || "Prediction failed";
    const noModels = msg.toLowerCase().includes("no bucket models");
    return (
      <View style={styles.center}>
        <Ionicons
          name={noModels ? "school-outline" : "warning-outline"}
          size={40}
          color={noModels ? Colors.dark.accent : "#f87171"}
        />
        <Text style={[styles.emptyText, !noModels && { color: "#f87171" }]}>{msg}</Text>
        {noModels && (
          <Text style={styles.emptySubText}>
            Go to the xG Engine tab → Score Outcome section and train at least one bucket model first.
          </Text>
        )}
        <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
          <Ionicons name="refresh" size={14} color={Colors.dark.accent} />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const top2 = data.top2 ?? [];
  const all = data.all ?? [];

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Score Prediction</Text>
          <Text style={styles.headerSub}>
            {data.modelsUsed} bucket model{data.modelsUsed !== 1 ? "s" : ""} · softmax confidence
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => refetch()}
          disabled={isFetching}
        >
          <Ionicons name="refresh" size={16} color={Colors.dark.accent} />
        </TouchableOpacity>
      </View>

      {/* Source badge */}
      <View style={styles.sourceBadge}>
        <Ionicons
          name={data.source === "live_simulation" ? "flash" : "archive"}
          size={12}
          color={data.source === "live_simulation" ? "#4ade80" : Colors.dark.textSecondary}
        />
        <Text style={styles.sourceText}>
          {data.source === "live_simulation" ? "Live simulation data" : "Cached match data"}
        </Text>
      </View>

      {/* Top 2 cards */}
      {top2.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No predictions returned.</Text>
        </View>
      ) : (
        top2.map((p, i) => (
          <TopCard
            key={p.bucketId}
            prediction={p}
            rank={i}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
          />
        ))
      )}

      {/* All buckets list */}
      {all.length > 2 && <AllBucketsSection predictions={all} />}

      {/* Footer note */}
      <View style={styles.footer}>
        <Ionicons name="information-circle-outline" size={14} color={Colors.dark.textTertiary} />
        <Text style={styles.footerText}>
          Confidence is softmax-normalised across all trained bucket models. Each model predicts
          (goal_sum, goal_diff) — the closer its output to the bucket's target, the higher
          its score.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.dark.background },
  scrollContent: { padding: 16, paddingBottom: 32 },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 12,
    backgroundColor: Colors.dark.background,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.dark.text,
    textAlign: "center",
    fontFamily: "Inter_600SemiBold",
  },
  emptySubText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  loadingText: {
    fontSize: 15,
    color: Colors.dark.text,
    fontFamily: "Inter_600SemiBold",
    marginTop: 8,
  },
  loadingSubText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 20,
    color: Colors.dark.text,
    fontFamily: "Inter_700Bold",
  },
  headerSub: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dark.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  sourceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 16,
  },
  sourceText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },

  topCard: {
    backgroundColor: Colors.dark.card,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 18,
    marginBottom: 12,
  },
  topCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  rankBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  rankBadgeText: {
    fontSize: 11,
    color: "#fff",
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  exactHitBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  exactHitText: {
    fontSize: 11,
    color: "#4ade80",
    fontFamily: "Inter_600SemiBold",
  },

  scoreline: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginBottom: 10,
    letterSpacing: -0.5,
  },

  scorePills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 14,
  },
  scorePill: {
    backgroundColor: Colors.dark.surfaceSecondary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  scorePillText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontFamily: "Inter_400Regular",
  },

  confidenceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 8,
  },
  confidenceValue: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    lineHeight: 36,
  },
  confidenceLabel: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    fontFamily: "Inter_400Regular",
  },

  barTrack: {
    height: 8,
    backgroundColor: Colors.dark.surfaceSecondary,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 12,
  },
  barFill: {
    height: "100%",
    borderRadius: 4,
  },

  modelMeta: {
    flexDirection: "row",
    gap: 16,
  },
  metaItem: {
    fontSize: 11,
    color: Colors.dark.textTertiary,
  },

  section: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 12,
  },

  miniRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  miniRank: {
    width: 18,
    fontSize: 11,
    color: Colors.dark.textTertiary,
    textAlign: "right",
  },
  miniLabel: {
    width: 90,
    fontSize: 12,
    color: Colors.dark.text,
    fontFamily: "Inter_600SemiBold",
  },
  miniTrack: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.dark.surfaceSecondary,
    borderRadius: 2,
    overflow: "hidden",
  },
  miniFill: {
    height: "100%",
    borderRadius: 2,
  },
  miniConf: {
    width: 40,
    fontSize: 11,
    color: Colors.dark.textSecondary,
    textAlign: "right",
  },

  expandBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingTop: 8,
  },
  expandText: {
    fontSize: 13,
    color: Colors.dark.accent,
    fontFamily: "Inter_600SemiBold",
  },

  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.dark.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  retryText: {
    fontSize: 14,
    color: Colors.dark.accent,
    fontFamily: "Inter_600SemiBold",
  },

  footer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    backgroundColor: Colors.dark.surface,
    borderRadius: 10,
    marginTop: 4,
  },
  footerText: {
    flex: 1,
    fontSize: 11,
    color: Colors.dark.textTertiary,
    lineHeight: 17,
  },
});
