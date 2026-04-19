import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";

function apiUrl(path: string) { return `${getApiUrl()}${path}`; }

interface EngineStatus {
  trained: boolean;
  trainingSamples: number;
  trainedAt: string | null;
  metrics: Record<string, number>;
}

interface TrainingProgress {
  running: boolean;
  progress: number;
  message: string;
  error: string | null;
}

function MetricCard({ label, value, unit = "" }: { label: string; value: string | number; unit?: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}{unit && <Text style={styles.metricUnit}> {unit}</Text>}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ModelBadge({ name, description, role, color }: { name: string; description: string; role: string; color: string }) {
  return (
    <View style={[styles.modelBadge, { borderLeftColor: color }]}>
      <View style={styles.modelBadgeHeader}>
        <Text style={[styles.modelName, { color }]}>{name}</Text>
        <View style={[styles.roleTag, { backgroundColor: color + "22" }]}>
          <Text style={[styles.roleTagText, { color }]}>{role}</Text>
        </View>
      </View>
      <Text style={styles.modelDescription}>{description}</Text>
    </View>
  );
}

const MODELS = [
  { name: "ANN", description: "Artificial Neural Network (2-layer MLP) learns baseline xG from shot quality, possession and team strength patterns.", role: "Baseline xG", color: "#60a5fa" },
  { name: "HMM", description: "Hidden Markov Model detects latent match states (very_defensive → very_attacking) and adjusts the xG flow accordingly.", role: "Match State", color: "#a78bfa" },
  { name: "GP", description: "Gaussian Process with RBF kernel quantifies prediction uncertainty via posterior variance — your confidence intervals.", role: "Uncertainty", color: "#34d399" },
  { name: "GARCH", description: "GARCH(1,1) models time-series goal variance. Detects high-volatility derbies and chaotic matches, scaling risk accordingly.", role: "Volatility", color: "#fbbf24" },
  { name: "SVM", description: "Support Vector Machine trained with hinge loss provides a boundary correction signal for high/low-scoring game classification.", role: "Correction", color: "#f87171" },
  { name: "RF", description: "Random Forest of 30 bootstrapped trees with random feature subsets integrates all team stats into a refined xG estimate.", role: "Refinement", color: "#fb923c" },
  { name: "GBM", description: "Gradient Boosting Machine fits 40 iterations of shallow trees on residuals, progressively reducing prediction error.", role: "Boosting", color: "#e879f9" },
  { name: "Causal", description: "Regression-based causal model answers 'what changes xG?' by computing delta adjustments from key offensive/defensive factors.", role: "Causality", color: "#2dd4bf" },
  { name: "Meta", description: "Meta-Learner learns optimal non-negative weights to combine ANN, RF and GBM outputs via gradient descent on held-out data.", role: "Combiner", color: "#94a3b8" },
];

export default function EngineScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [polling, setPolling] = useState(false);
  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 84 : 0;

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<EngineStatus>({
    queryKey: ["/api/engine/status"],
    refetchInterval: polling ? 3000 : false,
  });

  const { data: progress, refetch: refetchProgress } = useQuery<TrainingProgress>({
    queryKey: ["/api/engine/training-progress"],
    refetchInterval: polling ? 1500 : false,
    enabled: polling,
  });

  useEffect(() => {
    if (progress?.running === false && polling) {
      setPolling(false);
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/engine/status"] });
    }
  }, [progress?.running, polling]);

  const trainMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/engine/train"), { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Training failed to start");
      }
      return res.json();
    },
    onSuccess: () => {
      setPolling(true);
    },
  });

  const handleTrain = useCallback(() => {
    trainMutation.mutate();
  }, [trainMutation]);

  const isTraining = polling && progress?.running;
  const trainingProgress = progress?.progress ?? 0;
  const trainingMessage = progress?.message ?? "";

  const formatDate = (iso: string | null) => {
    if (!iso) return "Never";
    try {
      return new Date(iso).toLocaleString();
    } catch { return iso; }
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + webTop }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + webBottom + 20 }]}
      refreshControl={
        <RefreshControl
          refreshing={statusLoading}
          onRefresh={refetchStatus}
          tintColor={Colors.dark.accent}
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="brain" size={28} color={Colors.dark.accent} />
          <View style={styles.headerTextGroup}>
            <Text style={styles.headerTitle}>xG Engine</Text>
            <Text style={styles.headerSubtitle}>Multi-Paradigm Probabilistic Forecasting</Text>
          </View>
        </View>
        <View style={[
          styles.statusBadge,
          { backgroundColor: status?.trained ? "#16a34a22" : "#71717a22" }
        ]}>
          <View style={[styles.statusDot, { backgroundColor: status?.trained ? "#4ade80" : "#71717a" }]} />
          <Text style={[styles.statusText, { color: status?.trained ? "#4ade80" : "#9ca3af" }]}>
            {statusLoading ? "..." : status?.trained ? "Trained" : "Untrained"}
          </Text>
        </View>
      </View>

      {status?.trained && (
        <View style={styles.metricsRow}>
          <MetricCard label="Training Samples" value={status.trainingSamples} />
          <MetricCard label="FT RMSE" value={(status.metrics?.rmse_ft ?? 0).toFixed(3)} unit="goals" />
          <MetricCard label="FT MAE" value={(status.metrics?.mae_ft ?? 0).toFixed(3)} unit="goals" />
        </View>
      )}

      {status?.trained && (
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Last Trained</Text>
          <Text style={styles.infoValue}>{formatDate(status.trainedAt)}</Text>
        </View>
      )}

      {isTraining && (
        <View style={styles.trainingCard}>
          <View style={styles.trainingHeader}>
            <ActivityIndicator size="small" color={Colors.dark.accent} />
            <Text style={styles.trainingTitle}>Training in progress...</Text>
          </View>
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${trainingProgress}%` }]} />
          </View>
          <Text style={styles.trainingMessage}>{trainingMessage}</Text>
          <Text style={styles.trainingPct}>{Math.round(trainingProgress)}%</Text>
        </View>
      )}

      {progress?.error && !isTraining && (
        <View style={styles.errorCard}>
          <Ionicons name="warning-outline" size={16} color="#f87171" />
          <Text style={styles.errorText}>{progress.error}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.trainButton, (isTraining || trainMutation.isPending) && styles.trainButtonDisabled]}
        onPress={handleTrain}
        disabled={isTraining || trainMutation.isPending}
      >
        {isTraining || trainMutation.isPending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="play-circle" size={20} color="#fff" />
        )}
        <Text style={styles.trainButtonText}>
          {isTraining ? "Training..." : status?.trained ? "Retrain Engine" : "Train Engine"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.trainHint}>
        Trains on all {status?.trainingSamples ?? "stored"} historical matches in your database. All 7 models + meta-learner are trained end-to-end.
      </Text>

      <View style={styles.architectureSection}>
        <Text style={styles.sectionTitle}>Engine Architecture</Text>
        <Text style={styles.sectionSubtitle}>
          Each model plays a distinct mathematical role in the prediction pipeline
        </Text>
        <View style={styles.pipelineDiagram}>
          <Text style={styles.pipelineText}>Raw Features → ANN + HMM + SVM → RF / GBM → GP Uncertainty → GARCH Volatility → Causal Δ → Meta → xG</Text>
        </View>
        {MODELS.map(m => (
          <ModelBadge key={m.name} {...m} />
        ))}
      </View>

      <View style={styles.outputSection}>
        <Text style={styles.sectionTitle}>Output Format</Text>
        {[
          { label: "Full-Time xG", desc: "Home & Away expected goals for 90 minutes" },
          { label: "First-Half xG", desc: "Expected goals in the first 45 minutes" },
          { label: "Second-Half xG", desc: "Expected goals in the second 45 minutes" },
          { label: "Confidence ±", desc: "GP posterior variance as ± uncertainty range" },
          { label: "Volatility", desc: "GARCH(1,1) match volatility: Low / Medium / High" },
          { label: "Match State", desc: "HMM latent state (defensive → attacking)" },
          { label: "BTTS Prob", desc: "Both Teams to Score probability" },
          { label: "Over 2.5 Prob", desc: "Probability of over 2.5 total goals" },
          { label: "Result Probs", desc: "Home Win / Draw / Away Win probabilities" },
          { label: "Causal Δ", desc: "Feature-level causal adjustments to xG" },
        ].map(item => (
          <View key={item.label} style={styles.outputRow}>
            <View style={styles.outputDot} />
            <View>
              <Text style={styles.outputLabel}>{item.label}</Text>
              <Text style={styles.outputDesc}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  content: { padding: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  headerTextGroup: { flex: 1 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  headerSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  metricsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  metricCard: {
    flex: 1, backgroundColor: Colors.dark.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.dark.border, alignItems: "center",
  },
  metricValue: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.dark.accent },
  metricUnit: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  metricLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 4, textAlign: "center" },
  infoCard: {
    backgroundColor: Colors.dark.surface, borderRadius: 10, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.dark.border, flexDirection: "row", justifyContent: "space-between",
  },
  infoLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  infoValue: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.dark.text },
  trainingCard: {
    backgroundColor: Colors.dark.surface, borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.dark.accent + "44",
  },
  trainingHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  trainingTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.dark.text },
  progressBarTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.dark.border, overflow: "hidden", marginBottom: 8 },
  progressBarFill: { height: "100%", borderRadius: 3, backgroundColor: Colors.dark.accent },
  trainingMessage: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  trainingPct: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.dark.accent, marginTop: 4, textAlign: "right" },
  errorCard: {
    backgroundColor: "#7f1d1d22", borderRadius: 10, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: "#f8717133", flexDirection: "row", alignItems: "center", gap: 8,
  },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#f87171", flex: 1 },
  trainButton: {
    backgroundColor: Colors.dark.accent, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8,
  },
  trainButtonDisabled: { opacity: 0.6 },
  trainButtonText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  trainHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, textAlign: "center", marginBottom: 24 },
  architectureSection: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.dark.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginBottom: 12 },
  pipelineDiagram: {
    backgroundColor: "#1e293b", borderRadius: 8, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  pipelineText: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.accent, lineHeight: 16 },
  modelBadge: {
    backgroundColor: Colors.dark.surface, borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.dark.border, borderLeftWidth: 3,
  },
  modelBadgeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  modelName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  roleTag: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  roleTagText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  modelDescription: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, lineHeight: 18 },
  outputSection: { marginBottom: 24 },
  outputRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  outputDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.dark.accent, marginTop: 5 },
  outputLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.dark.text },
  outputDesc: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, lineHeight: 16 },
});
