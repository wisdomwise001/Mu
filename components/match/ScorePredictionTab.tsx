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

interface ScoреlinePrediction {
  scoreline: string;
  homeGoals: number;
  awayGoals: number;
  outcome: "Home Win" | "Away Win" | "Draw";
  outcomeConfidence: number;
  bucketConfidence: number;
  bucketId: string;
  isExactHit: boolean;
  trainAccuracy: number;
  fpRate: number;
  rawSum: number;
  rawDiff: number;
}

interface OutcomePredictResponse {
  eventId: number;
  source: "live_simulation" | "database_fallback";
  modelsUsed: number;
  resultProbabilities: { homeWinProb: number; drawProb: number; awayWinProb: number };
  top2: BucketPrediction[];
  top2Scorelines: ScoреlinePrediction[];
  all: BucketPrediction[];
  allScorelinesRanked: ScoреlinePrediction[];
}

interface HSHPredictResponse {
  eventId: number;
  source: "database" | "live";
  prediction: "first" | "second" | "draw";
  confidence: number;
  probs: { first: number; second: number; draw: number };
  keyFactors: {
    feature: string;
    label: string;
    contribution: number;
    direction: "+" | "-";
    pushesTo: "first" | "second" | "draw";
  }[];
  modelAccuracy: number;
  sampleCount: number;
  trainedAt: string;
}

const OUTCOME_META: Record<
  "Home Win" | "Away Win" | "Draw",
  { icon: string; color: string }
> = {
  "Home Win": { icon: "trophy",           color: "#3D7BF4" },
  "Away Win": { icon: "trophy-outline",   color: "#f59e0b" },
  "Draw":     { icon: "remove-circle",    color: "#8C8D96" },
};

function AnimatedBar({ pct, color, delay }: { pct: number; color: string; delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: 700, delay, useNativeDriver: false }).start();
  }, [pct, delay]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] });
  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, { width, backgroundColor: color }]} />
    </View>
  );
}

function WinProbBar({
  homeWinProb,
  drawProb,
  awayWinProb,
  homeTeamName,
  awayTeamName,
}: {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const homePct = Math.round(homeWinProb * 100);
  const drawPct = Math.round(drawProb * 100);
  const awayPct = Math.round(awayWinProb * 100);
  return (
    <View style={styles.winProbCard}>
      <Text style={styles.winProbTitle}>Match Outcome Probability</Text>
      <View style={styles.winProbTrack}>
        <View style={[styles.winProbFill, { flex: homePct, backgroundColor: "#3D7BF4" }]} />
        <View style={[styles.winProbFill, { flex: drawPct, backgroundColor: "#5C5D66" }]} />
        <View style={[styles.winProbFill, { flex: awayPct, backgroundColor: "#f59e0b" }]} />
      </View>
      <View style={styles.winProbLabels}>
        <View style={styles.winProbLabel}>
          <View style={[styles.winProbDot, { backgroundColor: "#3D7BF4" }]} />
          <Text style={styles.winProbTeam} numberOfLines={1}>{homeTeamName}</Text>
          <Text style={[styles.winProbPct, { color: "#3D7BF4" }]}>{homePct}%</Text>
        </View>
        <View style={styles.winProbLabel}>
          <View style={[styles.winProbDot, { backgroundColor: "#5C5D66" }]} />
          <Text style={styles.winProbTeam}>Draw</Text>
          <Text style={[styles.winProbPct, { color: "#8C8D96" }]}>{drawPct}%</Text>
        </View>
        <View style={styles.winProbLabel}>
          <View style={[styles.winProbDot, { backgroundColor: "#f59e0b" }]} />
          <Text style={styles.winProbTeam} numberOfLines={1}>{awayTeamName}</Text>
          <Text style={[styles.winProbPct, { color: "#f59e0b" }]}>{awayPct}%</Text>
        </View>
      </View>
    </View>
  );
}

function TopScorelineCard({
  prediction,
  rank,
  homeTeamName,
  awayTeamName,
}: {
  prediction: ScoреlinePrediction;
  rank: number;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const meta = OUTCOME_META[prediction.outcome];
  const rankColors = ["#3D7BF4", "#f59e0b"];
  const color = rankColors[rank] ?? rankColors[1];

  // Determine winner name for the outcome label
  let winnerLabel = prediction.outcome;
  if (prediction.outcome === "Home Win") winnerLabel = `${homeTeamName} Win`;
  else if (prediction.outcome === "Away Win") winnerLabel = `${awayTeamName} Win`;

  return (
    <View style={[styles.topCard, { borderColor: color }]}>
      {/* Rank + outcome badge row */}
      <View style={styles.topCardHeader}>
        <View style={[styles.rankBadge, { backgroundColor: color }]}>
          <Text style={styles.rankBadgeText}>#{rank + 1} Most Likely</Text>
        </View>
        <View style={styles.outcomeBadge}>
          <Ionicons name={meta.icon as any} size={13} color={meta.color} />
          <Text style={[styles.outcomeText, { color: meta.color }]}>{winnerLabel}</Text>
        </View>
        {prediction.isExactHit && (
          <View style={styles.exactBadge}>
            <Ionicons name="checkmark-circle" size={12} color="#4ade80" />
            <Text style={styles.exactText}>Exact</Text>
          </View>
        )}
      </View>

      {/* Scoreline */}
      <View style={styles.scoreRow}>
        <View style={styles.scoreTeamBlock}>
          <Text style={[styles.teamName, prediction.outcome === "Home Win" && styles.teamNameWinner]}
            numberOfLines={1}>{homeTeamName}</Text>
          <Text style={[styles.scoreDigit, { color }]}>{prediction.homeGoals}</Text>
        </View>
        <Text style={styles.scoreSep}>–</Text>
        <View style={styles.scoreTeamBlock}>
          <Text style={[styles.scoreDigit, { color }]}>{prediction.awayGoals}</Text>
          <Text style={[styles.teamName, styles.teamNameRight, prediction.outcome === "Away Win" && styles.teamNameWinner]}
            numberOfLines={1}>{awayTeamName}</Text>
        </View>
      </View>

      {/* Confidence bar */}
      <View style={styles.confidenceRow}>
        <Text style={[styles.confidenceValue, { color }]}>{prediction.outcomeConfidence.toFixed(1)}%</Text>
        <Text style={styles.confidenceLabel}>scoreline confidence</Text>
      </View>
      <AnimatedBar pct={Math.min(100, prediction.outcomeConfidence * 3)} color={color} delay={rank * 150} />

      <View style={styles.metaRow}>
        <Text style={styles.metaItem}>Bucket: {prediction.bucketId}</Text>
        <Text style={styles.metaItem}>Model acc: {(prediction.trainAccuracy * 100).toFixed(1)}%</Text>
        <Text style={styles.metaItem}>FP: {(prediction.fpRate * 100).toFixed(1)}%</Text>
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

function AllScorelinesSection({
  predictions,
  homeTeamName,
  awayTeamName,
}: {
  predictions: ScoреlinePrediction[];
  homeTeamName: string;
  awayTeamName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const rest = predictions.slice(2);
  const shown = expanded ? rest : rest.slice(0, 6);
  const maxConf = predictions[0]?.outcomeConfidence || 1;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>All Scorelines Ranked</Text>
      {shown.map((p, i) => {
        const meta = OUTCOME_META[p.outcome];
        const relPct = Math.min(100, (p.outcomeConfidence / maxConf) * 100);
        let winnerName = p.outcome === "Home Win" ? homeTeamName
          : p.outcome === "Away Win" ? awayTeamName : "Draw";
        return (
          <View key={`${p.bucketId}-${p.outcome}`} style={styles.miniRow}>
            <Text style={styles.miniRank}>{i + 3}</Text>
            <Ionicons name={meta.icon as any} size={13} color={meta.color} style={{ width: 18 }} />
            <Text style={styles.miniScore}>{p.scoreline}</Text>
            <Text style={[styles.miniWinner, { color: meta.color }]} numberOfLines={1}>{winnerName}</Text>
            <MiniBar pct={relPct} color={meta.color} />
            <Text style={styles.miniConf}>{p.outcomeConfidence.toFixed(1)}%</Text>
          </View>
        );
      })}
      {rest.length > 6 && (
        <TouchableOpacity style={styles.expandBtn} onPress={() => setExpanded(!expanded)}>
          <Text style={styles.expandText}>{expanded ? "Show less" : `Show ${rest.length - 6} more`}</Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={Colors.dark.accent} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── HSH Section ───────────────────────────────────────────────────────────────
const HSH_COLORS: Record<string, string> = {
  first:  "#3D7BF4",
  second: "#f59e0b",
  draw:   "#71717a",
};
const HSH_LABELS_MAP: Record<string, string> = {
  first:  "1st Half",
  second: "2nd Half",
  draw:   "Equal",
};

function HSHBar({
  label, pct, color, isWinner, delay,
}: { label: string; pct: number; color: string; isWinner: boolean; delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: 800, delay, useNativeDriver: false }).start();
  }, [pct, delay]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] });
  return (
    <View style={[hshStyles.hshRow, isWinner && { backgroundColor: color + "11" }]}>
      <Text style={[hshStyles.hshLabel, isWinner && { color, fontFamily: "Inter_700Bold" }]}>{label}</Text>
      <View style={hshStyles.hshTrack}>
        <Animated.View style={[hshStyles.hshFill, { width, backgroundColor: color }]} />
      </View>
      <Text style={[hshStyles.hshPct, { color: isWinner ? color : Colors.dark.textSecondary }]}>
        {pct.toFixed(1)}%
      </Text>
      {isWinner && <Ionicons name="trophy" size={12} color={color} />}
    </View>
  );
}

function HSHSection({
  eventId,
  homeTeamId,
  awayTeamId,
  canFetch,
}: {
  eventId: string;
  homeTeamId?: number;
  awayTeamId?: number;
  canFetch: boolean;
}) {
  const [showFactors, setShowFactors] = useState(false);

  const queryParts: string[] = [];
  if (homeTeamId) queryParts.push(`homeTeamId=${homeTeamId}`);
  if (awayTeamId) queryParts.push(`awayTeamId=${awayTeamId}`);
  const url = `/api/engine/hsh-predict/${eventId}${queryParts.length ? `?${queryParts.join("&")}` : ""}`;

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<HSHPredictResponse>({
      queryKey: [url],
      enabled: canFetch,
      staleTime: 5 * 60 * 1000,
      retry: false,
    });

  const winColor = data ? HSH_COLORS[data.prediction] : Colors.dark.accent;

  return (
    <View style={[hshStyles.card, data && { borderColor: winColor + "44" }]}>
      {/* Header */}
      <View style={hshStyles.header}>
        <View style={{ flex: 1 }}>
          <Text style={hshStyles.title}>Highest Scoring Half</Text>
          {data && (
            <Text style={hshStyles.subtitle}>
              {data.sampleCount} training samples · model accuracy {(data.modelAccuracy * 100).toFixed(1)}%
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={hshStyles.refreshBtn}
          onPress={() => refetch()}
          disabled={isFetching}
        >
          {isFetching
            ? <ActivityIndicator size="small" color={Colors.dark.accent} />
            : <Ionicons name="refresh" size={15} color={Colors.dark.accent} />
          }
        </TouchableOpacity>
      </View>

      {/* States */}
      {(isLoading && !data) ? (
        <View style={hshStyles.center}>
          <ActivityIndicator size="small" color={Colors.dark.accent} />
          <Text style={hshStyles.stateText}>Running HSH model…</Text>
        </View>
      ) : (isError || !data) ? (
        <View style={hshStyles.center}>
          <Ionicons name="school-outline" size={28} color={Colors.dark.textTertiary} />
          <Text style={hshStyles.stateText}>
            {(error as Error)?.message ?? "Train the HSH model from the Engine tab first."}
          </Text>
        </View>
      ) : (
        <>
          {/* Predicted class badge */}
          <View style={[hshStyles.predBadge, {
            backgroundColor: winColor + "18",
            borderColor: winColor + "55",
          }]}>
            <Ionicons name="analytics" size={13} color={winColor} />
            <Text style={[hshStyles.predText, { color: winColor }]}>
              {HSH_LABELS_MAP[data.prediction]}  ·  {data.confidence.toFixed(1)}% confidence
            </Text>
          </View>

          {/* Three probability bars */}
          <HSHBar label="1st Half" pct={data.probs.first}  color={HSH_COLORS.first}  isWinner={data.prediction === "first"}  delay={0}   />
          <HSHBar label="2nd Half" pct={data.probs.second} color={HSH_COLORS.second} isWinner={data.prediction === "second"} delay={80}  />
          <HSHBar label="Equal"    pct={data.probs.draw}   color={HSH_COLORS.draw}   isWinner={data.prediction === "draw"}   delay={160} />

          {/* Key factors (collapsible) */}
          {data.keyFactors.length > 0 && (
            <TouchableOpacity
              style={hshStyles.factorToggle}
              onPress={() => setShowFactors(!showFactors)}
            >
              <Text style={hshStyles.factorToggleText}>
                {showFactors ? "Hide" : "Show"} key factors
              </Text>
              <Ionicons
                name={showFactors ? "chevron-up" : "chevron-down"}
                size={13}
                color={Colors.dark.accent}
              />
            </TouchableOpacity>
          )}

          {showFactors && (
            <View style={hshStyles.factorList}>
              {data.keyFactors.map((f, i) => (
                <View key={i} style={hshStyles.factorRow}>
                  <Text style={[
                    hshStyles.factorDir,
                    { color: f.direction === "+" ? "#4ade80" : "#f87171" },
                  ]}>
                    {f.direction}
                  </Text>
                  <Text style={hshStyles.factorLabel} numberOfLines={1}>{f.label}</Text>
                  <View style={[
                    hshStyles.factorBadge,
                    { backgroundColor: HSH_COLORS[f.pushesTo] + "20" },
                  ]}>
                    <Text style={[hshStyles.factorBadgeText, { color: HSH_COLORS[f.pushesTo] }]}>
                      {HSH_LABELS_MAP[f.pushesTo]}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Source */}
          <View style={hshStyles.sourceRow}>
            <Ionicons
              name={data.source === "database" ? "archive" : "flash"}
              size={11}
              color={data.source === "live" ? "#4ade80" : Colors.dark.textTertiary}
            />
            <Text style={hshStyles.sourceText}>
              {data.source === "database" ? "Cached match data" : "Live simulation data"}
            </Text>
          </View>
        </>
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

  const top2 = data.top2Scorelines ?? [];
  const allRanked = data.allScorelinesRanked ?? [];
  const rp = data.resultProbabilities;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Score Prediction</Text>
          <Text style={styles.headerSub}>
            {data.modelsUsed} bucket model{data.modelsUsed !== 1 ? "s" : ""} · xG-weighted winner split
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={() => refetch()} disabled={isFetching}>
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

      {/* Win probability bar */}
      {rp && (
        <WinProbBar
          homeWinProb={rp.homeWinProb}
          drawProb={rp.drawProb}
          awayWinProb={rp.awayWinProb}
          homeTeamName={homeTeamName}
          awayTeamName={awayTeamName}
        />
      )}

      {/* Top 2 winner-labelled scoreline cards */}
      {top2.length === 0 ? (
        <View style={[styles.center, { marginVertical: 24 }]}>
          <Text style={styles.emptyText}>No predictions returned.</Text>
        </View>
      ) : (
        top2.map((p, i) => (
          <TopScorelineCard
            key={`${p.bucketId}-${p.outcome}`}
            prediction={p}
            rank={i}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
          />
        ))
      )}

      {/* All scorelines ranked list */}
      {allRanked.length > 2 && (
        <AllScorelinesSection
          predictions={allRanked}
          homeTeamName={homeTeamName}
          awayTeamName={awayTeamName}
        />
      )}

      {/* HSH prediction section */}
      <HSHSection
        eventId={eventId}
        homeTeamId={homeTeamId}
        awayTeamId={awayTeamId}
        canFetch={canFetch}
      />

      {/* Footer */}
      <View style={styles.footer}>
        <Ionicons name="information-circle-outline" size={14} color={Colors.dark.textTertiary} />
        <Text style={styles.footerText}>
          Bucket models predict goal sum &amp; diff. Winner direction is split using the xG engine's
          result probabilities. Confidence = bucket confidence × direction share.
        </Text>
      </View>
    </ScrollView>
  );
}

const hshStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  subtitle: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2 },
  refreshBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.dark.background,
    alignItems: "center", justifyContent: "center",
  },
  center: { alignItems: "center", gap: 8, paddingVertical: 18 },
  stateText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, textAlign: "center", lineHeight: 18 },
  predBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    marginBottom: 14, alignSelf: "flex-start",
  },
  predText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  hshRow: {
    flexDirection: "row", alignItems: "center",
    gap: 10, marginBottom: 7,
    paddingHorizontal: 6, paddingVertical: 5,
    borderRadius: 8,
  },
  hshLabel: {
    width: 62, fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
  hshTrack: {
    flex: 1, height: 6,
    backgroundColor: Colors.dark.surfaceSecondary ?? Colors.dark.background,
    borderRadius: 3, overflow: "hidden",
  },
  hshFill: { height: "100%", borderRadius: 3 },
  hshPct: { width: 46, fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "right" },
  factorToggle: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.dark.border,
  },
  factorToggleText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.dark.accent },
  factorList: { marginTop: 8, gap: 7 },
  factorRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  factorDir: { width: 12, fontSize: 14, fontFamily: "Inter_700Bold" },
  factorLabel: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.text },
  factorBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  factorBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12 },
  sourceText: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textTertiary },
});

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.dark.background },
  scrollContent: { padding: 16, paddingBottom: 40 },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 12,
    backgroundColor: Colors.dark.background,
  },
  emptyText: { fontSize: 15, color: Colors.dark.text, textAlign: "center", fontFamily: "Inter_600SemiBold" },
  emptySubText: { fontSize: 13, color: Colors.dark.textSecondary, textAlign: "center", lineHeight: 20 },
  loadingText: { fontSize: 15, color: Colors.dark.text, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  loadingSubText: { fontSize: 12, color: Colors.dark.textSecondary, textAlign: "center", lineHeight: 18 },

  headerRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  headerTitle: { fontSize: 20, color: Colors.dark.text, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 2 },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.dark.surface, alignItems: "center", justifyContent: "center" },

  sourceBadge: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 14 },
  sourceText: { fontSize: 12, color: Colors.dark.textSecondary },

  // Win probability bar
  winProbCard: { backgroundColor: Colors.dark.surface, borderRadius: 12, padding: 14, marginBottom: 14 },
  winProbTitle: { fontSize: 12, color: Colors.dark.textSecondary, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 },
  winProbTrack: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 10 },
  winProbFill: { height: "100%" },
  winProbLabels: { flexDirection: "row", justifyContent: "space-between" },
  winProbLabel: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
  winProbDot: { width: 8, height: 8, borderRadius: 4 },
  winProbTeam: { fontSize: 11, color: Colors.dark.textSecondary, flex: 1 },
  winProbPct: { fontSize: 13, fontFamily: "Inter_700Bold" },

  // Top scoreline card
  topCard: { backgroundColor: Colors.dark.card, borderRadius: 14, borderWidth: 1.5, padding: 18, marginBottom: 12 },
  topCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  rankBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  rankBadgeText: { fontSize: 11, color: "#fff", fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  outcomeBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.dark.surfaceSecondary, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  outcomeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  exactBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  exactText: { fontSize: 11, color: "#4ade80", fontFamily: "Inter_600SemiBold" },

  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 },
  scoreTeamBlock: { flex: 1, alignItems: "center", gap: 6 },
  teamName: { fontSize: 13, color: Colors.dark.textSecondary, textAlign: "center" },
  teamNameRight: { textAlign: "center" },
  teamNameWinner: { color: Colors.dark.text, fontFamily: "Inter_700Bold" },
  scoreDigit: { fontSize: 48, fontFamily: "Inter_700Bold", lineHeight: 52 },
  scoreSep: { fontSize: 32, color: Colors.dark.textTertiary, fontFamily: "Inter_400Regular" },

  confidenceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 8 },
  confidenceValue: { fontSize: 28, fontFamily: "Inter_700Bold", lineHeight: 32 },
  confidenceLabel: { fontSize: 13, color: Colors.dark.textSecondary },

  barTrack: { height: 6, backgroundColor: Colors.dark.surfaceSecondary, borderRadius: 3, overflow: "hidden", marginBottom: 12 },
  barFill: { height: "100%", borderRadius: 3 },

  metaRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  metaItem: { fontSize: 11, color: Colors.dark.textTertiary },

  section: { backgroundColor: Colors.dark.surface, borderRadius: 12, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 13, color: Colors.dark.textSecondary, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },

  miniRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 9 },
  miniRank: { width: 18, fontSize: 11, color: Colors.dark.textTertiary, textAlign: "right" },
  miniScore: { width: 36, fontSize: 13, color: Colors.dark.text, fontFamily: "Inter_700Bold" },
  miniWinner: { width: 72, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  miniTrack: { flex: 1, height: 4, backgroundColor: Colors.dark.surfaceSecondary, borderRadius: 2, overflow: "hidden" },
  miniFill: { height: "100%", borderRadius: 2 },
  miniConf: { width: 40, fontSize: 11, color: Colors.dark.textSecondary, textAlign: "right" },

  expandBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 8 },
  expandText: { fontSize: 13, color: Colors.dark.accent, fontFamily: "Inter_600SemiBold" },

  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.dark.surface, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  retryText: { fontSize: 14, color: Colors.dark.accent, fontFamily: "Inter_600SemiBold" },

  footer: { flexDirection: "row", gap: 8, padding: 12, backgroundColor: Colors.dark.surface, borderRadius: 10, marginTop: 4 },
  footerText: { flex: 1, fontSize: 11, color: Colors.dark.textTertiary, lineHeight: 17 },
});
