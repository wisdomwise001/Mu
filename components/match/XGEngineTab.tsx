import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";

interface XGPrediction {
  homeFullTimeXg: number;
  awayFullTimeXg: number;
  homeFirstHalfXg: number;
  awayFirstHalfXg: number;
  homeSecondHalfXg: number;
  awaySecondHalfXg: number;
  confidence: number[];
  volatility: string;
  volatilityFactor: number;
  matchState: string;
  stateProbabilities: number[];
  svmCorrection: number;
  causalDelta: number[];
  causalExplanation: Record<string, number>;
  metaWeights: number[][];
  componentPredictions: {
    ann: number[];
    rf: number[];
    gbm: number[];
    hmm: { state: string; factor: number };
    garch: { label: string; factor: number };
    svm: { correction: number; score: number };
    gp: { variance: number[] };
  };
  derived: {
    totalXg: number;
    bttsProbability: number;
    over25Probability: number;
    resultProbabilities: { home: number; draw: number; away: number };
  };
  featuresUsed: Record<string, number>;
}

interface PredictionResponse {
  prediction: XGPrediction;
  matchInfo: {
    homeTeam: string; awayTeam: string;
    homeGoals: number | null; awayGoals: number | null;
    result: string | null; matchDate: string; tournament: string;
  };
}

const STATE_NAMES: Record<string, string> = {
  very_defensive: "Very Defensive",
  defensive: "Defensive",
  balanced: "Balanced",
  attacking: "Attacking",
  very_attacking: "Very Attacking",
};

const STATE_COLORS: Record<string, string> = {
  very_defensive: "#60a5fa",
  defensive: "#93c5fd",
  balanced: "#fbbf24",
  attacking: "#f87171",
  very_attacking: "#ef4444",
};

const VOL_COLORS: Record<string, string> = {
  Low: "#4ade80",
  Medium: "#fbbf24",
  High: "#f87171",
};

function XGBar({ home, away, label }: { home: number; away: number; label: string }) {
  const total = home + away || 1;
  const homePct = (home / total) * 100;
  return (
    <View style={styles.xgBarContainer}>
      <View style={styles.xgBarRow}>
        <Text style={styles.xgBarHome}>{home.toFixed(2)}</Text>
        <Text style={styles.xgBarLabel}>{label}</Text>
        <Text style={styles.xgBarAway}>{away.toFixed(2)}</Text>
      </View>
      <View style={styles.xgBarTrack}>
        <View style={[styles.xgBarFillHome, { flex: homePct }]} />
        <View style={[styles.xgBarFillAway, { flex: 100 - homePct }]} />
      </View>
    </View>
  );
}

function ProbBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.probRow}>
      <Text style={styles.probLabel}>{label}</Text>
      <View style={styles.probTrack}>
        <View style={[styles.probFill, { width: `${value * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.probValue, { color }]}>{(value * 100).toFixed(0)}%</Text>
    </View>
  );
}

function ComponentRow({ name, values, color, note }: { name: string; values: number[]; color: string; note?: string }) {
  return (
    <View style={styles.compRow}>
      <View style={[styles.compDot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.compRowHeader}>
          <Text style={[styles.compName, { color }]}>{name}</Text>
          {note && <Text style={styles.compNote}>{note}</Text>}
        </View>
        <Text style={styles.compVals}>
          FT: {values[0]?.toFixed(2)} / {values[1]?.toFixed(2)}
          {"  "}H1: {values[2]?.toFixed(2)} / {values[3]?.toFixed(2)}
          {"  "}H2: {values[4]?.toFixed(2)} / {values[5]?.toFixed(2)}
        </Text>
      </View>
    </View>
  );
}

function FeatureSection({ features }: { features: Record<string, number> }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(features);
  const displayed = expanded ? entries : entries.slice(0, 10);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Features Used in Prediction</Text>
      <Text style={styles.sectionSub}>Same 38-feature format as training</Text>
      {displayed.map(([k, v]) => (
        <View key={k} style={styles.featureRow}>
          <Text style={styles.featureKey}>{k.replace(/_/g, " ")}</Text>
          <Text style={styles.featureVal}>{v.toFixed(3)}</Text>
        </View>
      ))}
      {entries.length > 10 && (
        <TouchableOpacity onPress={() => setExpanded(e => !e)} style={styles.expandBtn}>
          <Text style={styles.expandBtnText}>
            {expanded ? "Show less" : `Show all ${entries.length} features`}
          </Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={12} color={Colors.dark.accent} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function XGEngineTab({
  eventId,
  homeTeamName,
  awayTeamName,
}: {
  eventId: string;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const { data, isLoading, error, refetch } = useQuery<PredictionResponse>({
    queryKey: [`/api/engine/predict/${eventId}`],
    retry: false,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
        <Text style={styles.loadingText}>Running xG Engine...</Text>
      </View>
    );
  }

  if (error || !data) {
    const msg = (error as any)?.message || "Prediction unavailable";
    const notInDb = msg.includes("not found");
    const notTrained = msg.includes("not trained");
    return (
      <View style={styles.center}>
        <Ionicons name="analytics-outline" size={48} color={Colors.dark.textSecondary} />
        <Text style={styles.errorTitle}>
          {notTrained ? "Engine Not Trained" : notInDb ? "Match Not in Database" : "Prediction Error"}
        </Text>
        <Text style={styles.errorMsg}>
          {notTrained
            ? "Train the xG Engine from the Engine tab first. The engine needs historical match data to learn from."
            : notInDb
            ? "This match hasn't been processed into the database yet. Use the Processing tab to add it."
            : msg}
        </Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
          <Ionicons name="refresh" size={14} color={Colors.dark.accent} />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { prediction: p, matchInfo } = data;
  const stateColor = STATE_COLORS[p.matchState] ?? "#94a3b8";
  const volColor = VOL_COLORS[p.volatility] ?? "#fbbf24";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.engineHeader}>
        <Ionicons name="brain" size={16} color={Colors.dark.accent} />
        <Text style={styles.engineHeaderText}>xG Engine Prediction</Text>
        <View style={styles.engBadge}>
          <Text style={styles.engBadgeText}>7 Models</Text>
        </View>
      </View>

      {matchInfo.homeGoals != null && (
        <View style={styles.actualResult}>
          <Text style={styles.actualLabel}>Actual Result</Text>
          <Text style={styles.actualScore}>
            {matchInfo.homeGoals} – {matchInfo.awayGoals}
          </Text>
          <View style={[
            styles.resultTag,
            { backgroundColor: matchInfo.result === "H" ? "#16a34a33" : matchInfo.result === "D" ? "#a1660033" : "#7f1d1d33" }
          ]}>
            <Text style={[
              styles.resultTagText,
              { color: matchInfo.result === "H" ? "#4ade80" : matchInfo.result === "D" ? "#fbbf24" : "#f87171" }
            ]}>
              {matchInfo.result === "H" ? "Home Win" : matchInfo.result === "D" ? "Draw" : "Away Win"}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>xG Predictions</Text>
        <View style={styles.teamLabels}>
          <Text style={styles.teamLabelHome}>{homeTeamName}</Text>
          <Text style={styles.teamLabelAway}>{awayTeamName}</Text>
        </View>
        <XGBar home={p.homeFullTimeXg} away={p.awayFullTimeXg} label="Full Time" />
        <XGBar home={p.homeFirstHalfXg} away={p.awayFirstHalfXg} label="1st Half" />
        <XGBar home={p.homeSecondHalfXg} away={p.awaySecondHalfXg} label="2nd Half" />

        <View style={styles.totalXgRow}>
          <Text style={styles.totalXgLabel}>Total xG</Text>
          <Text style={styles.totalXgValue}>{p.derived.totalXg.toFixed(2)}</Text>
        </View>
      </View>

      <View style={styles.confidenceSection}>
        <View style={styles.confCard}>
          <Ionicons name="pulse-outline" size={14} color="#34d399" />
          <Text style={styles.confLabel}>GP Uncertainty (FT)</Text>
          <Text style={styles.confValue}>
            ±{p.confidence[0]?.toFixed(2)} / ±{p.confidence[1]?.toFixed(2)}
          </Text>
        </View>
        <View style={[styles.confCard, { borderColor: volColor + "44" }]}>
          <Ionicons name="stats-chart" size={14} color={volColor} />
          <Text style={styles.confLabel}>GARCH Volatility</Text>
          <Text style={[styles.confValue, { color: volColor }]}>
            {p.volatility} ({p.volatilityFactor.toFixed(2)}x)
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Match State (HMM)</Text>
        <View style={[styles.stateCard, { borderColor: stateColor + "55" }]}>
          <Text style={[styles.stateLabel, { color: stateColor }]}>
            {STATE_NAMES[p.matchState] ?? p.matchState}
          </Text>
          <Text style={styles.stateXgFactor}>xG Factor: ×{p.componentPredictions.hmm.factor.toFixed(2)}</Text>
        </View>
        <View style={styles.stateProbs}>
          {["very_defensive", "defensive", "balanced", "attacking", "very_attacking"].map((s, i) => (
            <View key={s} style={styles.stateProbItem}>
              <View style={styles.stateProbBarTrack}>
                <View style={[styles.stateProbBarFill, {
                  height: `${(p.stateProbabilities[i] ?? 0) * 100}%`,
                  backgroundColor: STATE_COLORS[s],
                }]} />
              </View>
              <Text style={styles.stateProbPct}>{((p.stateProbabilities[i] ?? 0) * 100).toFixed(0)}%</Text>
              <Text style={styles.stateProbLabel} numberOfLines={2}>{STATE_NAMES[s]}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Market Probabilities</Text>
        <ProbBar label="Home Win" value={p.derived.resultProbabilities.home} color="#60a5fa" />
        <ProbBar label="Draw" value={p.derived.resultProbabilities.draw} color="#fbbf24" />
        <ProbBar label="Away Win" value={p.derived.resultProbabilities.away} color="#f87171" />
        <ProbBar label="BTTS" value={p.derived.bttsProbability} color="#a78bfa" />
        <ProbBar label="Over 2.5 Goals" value={p.derived.over25Probability} color="#2dd4bf" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Component Predictions (Home / Away)</Text>
        <Text style={styles.sectionSub}>FT = Full Time · H1 = First Half · H2 = Second Half</Text>
        <ComponentRow name="ANN" values={p.componentPredictions.ann} color="#60a5fa" note="Neural Network" />
        <ComponentRow name="RF" values={p.componentPredictions.rf} color="#fb923c" note="Random Forest" />
        <ComponentRow name="GBM" values={p.componentPredictions.gbm} color="#e879f9" note="Gradient Boosting" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Meta-Learner Weights</Text>
        <Text style={styles.sectionSub}>Learned optimal combination per output</Text>
        {["FT Home", "FT Away", "H1 Home", "H1 Away", "H2 Home", "H2 Away"].map((label, t) => (
          <View key={label} style={styles.metaWeightRow}>
            <Text style={styles.metaWeightLabel}>{label}</Text>
            <View style={styles.metaWeightBars}>
              {["ANN", "RF", "GBM"].map((m, mi) => (
                <View key={m} style={styles.metaWeightItem}>
                  <Text style={styles.metaWeightModel}>{m}</Text>
                  <View style={styles.metaWeightTrack}>
                    <View style={[styles.metaWeightFill, {
                      width: `${(p.metaWeights[t]?.[mi] ?? 0) * 100}%`,
                      backgroundColor: ["#60a5fa", "#fb923c", "#e879f9"][mi],
                    }]} />
                  </View>
                  <Text style={styles.metaWeightPct}>
                    {((p.metaWeights[t]?.[mi] ?? 0) * 100).toFixed(0)}%
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>SVM Boundary Correction</Text>
        <View style={styles.svmRow}>
          <Text style={styles.svmLabel}>Decision Score</Text>
          <Text style={[styles.svmValue, { color: p.componentPredictions.svm.score > 0 ? "#4ade80" : "#f87171" }]}>
            {p.componentPredictions.svm.score.toFixed(3)}
          </Text>
        </View>
        <View style={styles.svmRow}>
          <Text style={styles.svmLabel}>xG Correction Applied</Text>
          <Text style={[styles.svmValue, { color: p.svmCorrection >= 0 ? "#4ade80" : "#f87171" }]}>
            {p.svmCorrection >= 0 ? "+" : ""}{p.svmCorrection.toFixed(3)}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Causal Analysis</Text>
        <Text style={styles.sectionSub}>Feature-level causal adjustments (Δ from baseline)</Text>
        {Object.entries(p.causalExplanation).map(([k, v]) => (
          <View key={k} style={styles.causalRow}>
            <Text style={styles.causalKey}>{k.replace(/_/g, " ")}</Text>
            <Text style={[styles.causalVal, { color: Number(v) >= 0 ? "#4ade80" : "#f87171" }]}>
              {Number(v) >= 0 ? "+" : ""}{Number(v).toFixed(3)}
            </Text>
          </View>
        ))}
        <View style={styles.causalDeltaSection}>
          <Text style={styles.causalDeltaTitle}>FT Delta: Home {p.causalDelta[0] >= 0 ? "+" : ""}{p.causalDelta[0]?.toFixed(3)} / Away {p.causalDelta[1] >= 0 ? "+" : ""}{p.causalDelta[1]?.toFixed(3)}</Text>
        </View>
      </View>

      <FeatureSection features={p.featuresUsed} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  content: { padding: 14, paddingBottom: 30 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 8 },
  errorTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.dark.text, textAlign: "center" },
  errorMsg: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, textAlign: "center", lineHeight: 18 },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, padding: 8 },
  retryText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.dark.accent },
  engineHeader: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14,
    backgroundColor: Colors.dark.accent + "11", borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: Colors.dark.accent + "33",
  },
  engineHeaderText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.dark.accent, flex: 1 },
  engBadge: { backgroundColor: Colors.dark.accent + "22", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  engBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.dark.accent },
  actualResult: {
    backgroundColor: Colors.dark.surface, borderRadius: 10, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.dark.border, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between",
  },
  actualLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  actualScore: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  resultTag: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  resultTagText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  section: {
    backgroundColor: Colors.dark.surface, borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.dark.text, marginBottom: 4 },
  sectionSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginBottom: 10 },
  teamLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  teamLabelHome: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#60a5fa" },
  teamLabelAway: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#f87171" },
  xgBarContainer: { marginBottom: 10 },
  xgBarRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  xgBarHome: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#60a5fa", width: 40 },
  xgBarLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  xgBarAway: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#f87171", width: 40, textAlign: "right" },
  xgBarTrack: { height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row" },
  xgBarFillHome: { backgroundColor: "#60a5fa", height: "100%" },
  xgBarFillAway: { backgroundColor: "#f87171", height: "100%" },
  totalXgRow: {
    flexDirection: "row", justifyContent: "space-between", marginTop: 8,
    paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.dark.border,
  },
  totalXgLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.dark.textSecondary },
  totalXgValue: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  confidenceSection: { flexDirection: "row", gap: 8, marginBottom: 10 },
  confCard: {
    flex: 1, backgroundColor: Colors.dark.surface, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.dark.border, alignItems: "center", gap: 4,
  },
  confLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, textAlign: "center" },
  confValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#34d399", textAlign: "center" },
  stateCard: {
    backgroundColor: Colors.dark.background, borderRadius: 8, padding: 12, marginBottom: 10,
    borderWidth: 1, alignItems: "center",
  },
  stateLabel: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 2 },
  stateXgFactor: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  stateProbs: { flexDirection: "row", justifyContent: "space-around", marginTop: 6 },
  stateProbItem: { alignItems: "center", width: 52 },
  stateProbBarTrack: { height: 50, width: 18, backgroundColor: Colors.dark.border, borderRadius: 4, overflow: "hidden", justifyContent: "flex-end" },
  stateProbBarFill: { width: "100%", borderRadius: 4 },
  stateProbPct: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.dark.text, marginTop: 4 },
  stateProbLabel: { fontSize: 8, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, textAlign: "center", lineHeight: 11, marginTop: 2 },
  probRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  probLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, width: 90 },
  probTrack: { flex: 1, height: 6, backgroundColor: Colors.dark.border, borderRadius: 3, overflow: "hidden" },
  probFill: { height: "100%", borderRadius: 3 },
  probValue: { fontSize: 12, fontFamily: "Inter_600SemiBold", width: 36, textAlign: "right" },
  compRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  compDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  compRowHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  compName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  compNote: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  compVals: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  metaWeightRow: { marginBottom: 10 },
  metaWeightLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.dark.text, marginBottom: 4 },
  metaWeightBars: { gap: 4 },
  metaWeightItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaWeightModel: { fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.dark.textSecondary, width: 28 },
  metaWeightTrack: { flex: 1, height: 5, backgroundColor: Colors.dark.border, borderRadius: 3, overflow: "hidden" },
  metaWeightFill: { height: "100%", borderRadius: 3 },
  metaWeightPct: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.dark.text, width: 30, textAlign: "right" },
  svmRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  svmLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  svmValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  causalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 5 },
  causalKey: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, flex: 1 },
  causalVal: { fontSize: 12, fontFamily: "Inter_700Bold" },
  causalDeltaSection: {
    marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.dark.border,
  },
  causalDeltaTitle: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.dark.textSecondary },
  featureRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  featureKey: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, flex: 1 },
  featureVal: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.dark.text, width: 60, textAlign: "right" },
  expandBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, padding: 4 },
  expandBtnText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.dark.accent },
});
