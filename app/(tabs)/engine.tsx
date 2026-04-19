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
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

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

function ModelBadge({ name, description, role, color, lib }: { name: string; description: string; role: string; color: string; lib?: string }) {
  return (
    <View style={[styles.modelBadge, { borderLeftColor: color }]}>
      <View style={styles.modelBadgeHeader}>
        <Text style={[styles.modelName, { color }]}>{name}</Text>
        <View style={[styles.roleTag, { backgroundColor: color + "22" }]}>
          <Text style={[styles.roleTagText, { color }]}>{role}</Text>
        </View>
      </View>
      {lib && (
        <View style={styles.libBadge}>
          <Text style={styles.libBadgeText}>{lib}</Text>
        </View>
      )}
      <Text style={styles.modelDescription}>{description}</Text>
    </View>
  );
}

const MODELS = [
  { name: "ANN", description: "@tensorflow/tfjs — Real TensorFlow neural network (D→64→32→6, ReLU activations). Trained with Adam optimizer (adaptive per-parameter learning rates, β₁=0.9 β₂=0.999) for 200 epochs with dropout regularisation. Produces baseline xG for all 6 outputs.", role: "Baseline xG", color: "#60a5fa", lib: "@tensorflow/tfjs" },
  { name: "HMM", description: "Custom Gaussian HMM with 5 latent match states (very_defensive → very_attacking). States are initialised via sorted goal-output clustering; emissions fit Gaussian distributions per cluster. Viterbi-style decoding outputs the most probable match state and a per-state scaling factor.", role: "Match State", color: "#a78bfa", lib: "Custom Gaussian HMM" },
  { name: "GP", description: "ml-matrix — Gaussian Process with Squared Exponential (RBF) kernel. Uses median heuristic for length-scale, 60 Nyström inducing points, and ml-matrix pseudo-inverse for the posterior variance: σ²(x*) = k**  − k_*ᵀ K⁻¹ k_*. Reports true epistemic uncertainty.", role: "Uncertainty", color: "#34d399", lib: "ml-matrix" },
  { name: "GARCH", description: "Custom GARCH(1,1) — σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}. Fits ω, α=0.15, β=0.75 to goal-scoring residuals from the training set. Converts conditional variance into a multiplicative volatility factor (Low / Medium / High).", role: "Volatility", color: "#fbbf24", lib: "Custom GARCH(1,1)" },
  { name: "SVM", description: "Custom linear SVM: hinge loss (max(0, 1 − y·wᵀx)) + L2 regularisation, trained with SGD over 80 epochs and a decaying learning rate. Classifies matches as high/low-scoring to compute a ±0.25 xG boundary correction signal.", role: "Correction", color: "#f87171", lib: "Custom SVM (hinge+SGD)" },
  { name: "RF", description: "ml-random-forest — RandomForestRegression with 80 CART trees, bootstrap sampling, 65% random feature subsets, max depth 7. Trains one model per xG output (6 models total), each using proper Gini/MSE variance reduction splits from ml-cart internally.", role: "Refinement", color: "#fb923c", lib: "ml-random-forest" },
  { name: "GBM", description: "ml-cart — Gradient Boosting with 50 iterations × 6 outputs = 300 DecisionTreeRegression trees (max depth 3). Each iteration fits a CART tree to the pseudo-residuals (negative MSE gradient). Learning rate decays as lr_t = 0.08 / (1 + 0.02t).", role: "Boosting", color: "#e879f9", lib: "ml-cart (CART trees)" },
  { name: "Causal", description: "ml-regression — MultivariateLinearRegression (OLS via normal equations, not gradient descent). Fits all 38 features → 6 outputs simultaneously. Computes causal Δ by perturbing each key feature from its mean and measuring the change in predicted xG.", role: "Causality", color: "#2dd4bf", lib: "ml-regression (OLS)" },
  { name: "Meta", description: "ml-regression — MultivariateLinearRegression (OLS) trained on stacked outputs [ANN(×6) · RF(×6) · GBM(×6)] → 18-feature → 6-target. Learns the optimal linear combination across all three base models to minimise residual error on training data.", role: "Combiner", color: "#94a3b8", lib: "ml-regression (OLS)" },
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
    if (progress !== undefined && progress.running === false && polling) {
      setPolling(false);
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/engine/status"] });
    }
  }, [progress, polling]);

  const trainMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/engine/train");
      return res.json();
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["/api/engine/training-progress"] });
      setPolling(true);
    },
    onError: (err: Error) => {
      Alert.alert("Training Error", err.message, [{ text: "OK" }]);
    },
  });

  const handleTrain = useCallback(() => {
    trainMutation.mutate();
  }, [trainMutation]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/engine/models");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/engine/status"] });
      refetchStatus();
      Alert.alert(
        "Models Cleared",
        "All saved engine models have been deleted. The engine is ready for fresh training.",
        [{ text: "OK", style: "default" }]
      );
    },
    onError: (err: Error) => {
      Alert.alert("Error", err.message, [{ text: "OK" }]);
    },
  });

  const handleDeleteModels = useCallback(() => {
    Alert.alert(
      "Delete All Saved Models",
      "This will permanently remove all trained model weights. The engine will need to be fully retrained before it can make predictions.\n\nAre you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All Models",
          style: "destructive",
          onPress: () => deleteMutation.mutate(),
        },
      ]
    );
  }, [deleteMutation]);

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
        Trains on all {status?.trainingSamples ?? "stored"} historical matches in your database. All 9 models are trained end-to-end using real ML libraries.
      </Text>

      {status?.trained && (
        <TouchableOpacity
          style={[styles.deleteButton, deleteMutation.isPending && styles.trainButtonDisabled]}
          onPress={handleDeleteModels}
          disabled={deleteMutation.isPending || isTraining}
        >
          {deleteMutation.isPending ? (
            <ActivityIndicator size="small" color="#f87171" />
          ) : (
            <Ionicons name="trash-outline" size={16} color="#f87171" />
          )}
          <Text style={styles.deleteButtonText}>
            {deleteMutation.isPending ? "Clearing..." : "Delete All Saved Models"}
          </Text>
        </TouchableOpacity>
      )}

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
  trainHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, textAlign: "center", marginBottom: 12 },
  deleteButton: {
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginBottom: 24, borderWidth: 1, borderColor: "#f8717144",
    backgroundColor: "#7f1d1d22",
  },
  deleteButtonText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#f87171" },
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
  libBadge: {
    alignSelf: "flex-start", backgroundColor: "#1e293b", borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2, marginBottom: 6,
    borderWidth: 1, borderColor: "#334155",
  },
  libBadgeText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "#94a3b8" },
  modelDescription: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, lineHeight: 18 },
  outputSection: { marginBottom: 24 },
  outputRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  outputDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.dark.accent, marginTop: 5 },
  outputLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.dark.text },
  outputDesc: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, lineHeight: 16 },
});
