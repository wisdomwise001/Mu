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

interface OutcomeBucket {
  id: string;
  label: string;
  scores: [number, number][];
  sum: number;
  absDiff: number;
  sampleCount: number;
  trained: boolean;
  trainAccuracy: number | null;
  fpRate: number | null;
  trainedAt: string | null;
}

interface OutcomeTrainProgress {
  running: boolean;
  bucket: string | null;
  progress: number;
  message: string;
  error: string | null;
}

interface OutcomeModel {
  bucket: string;
  sampleCount: number;
  trainHits: number;
  falsePositives: number;
  trainAccuracy: number;
  fpRate: number;
  formula: string;
  trainedAt: string;
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
  { name: "ANN", description: "@tensorflow/tfjs — Real TensorFlow neural network (92→128→64→32→6, ReLU activations). Trained with Adam optimizer (adaptive per-parameter learning rates, β₁=0.9 β₂=0.999) for 200 epochs with dropout regularisation. Produces baseline xG for all 6 outputs.", role: "Baseline xG", color: "#60a5fa", lib: "@tensorflow/tfjs" },
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [outcomePolling, setOutcomePolling] = useState(false);
  const [allOutcomesPolling, setAllOutcomesPolling] = useState(false);
  const [hshPolling, setHshPolling] = useState(false);
  const [behavioralPolling, setBehavioralPolling] = useState(false);
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
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ["/api/engine/status"] });
      refetchStatus();
    },
    onError: (err: Error) => {
      setConfirmDelete(false);
      Alert.alert("Error", err.message, [{ text: "OK" }]);
    },
  });

  const handleDeleteModels = useCallback(() => {
    setConfirmDelete(true);
  }, []);

  // ── Per-score-outcome models ──────────────────────────────────────────
  const { data: outcomeBuckets, refetch: refetchBuckets } = useQuery<{ buckets: OutcomeBucket[] }>({
    queryKey: ["/api/engine/outcome-buckets"],
  });

  const { data: outcomeProgress } = useQuery<OutcomeTrainProgress>({
    queryKey: ["/api/engine/outcome-train-progress"],
    refetchInterval: outcomePolling ? 1500 : false,
    enabled: outcomePolling,
  });

  const { data: selectedModel, refetch: refetchSelectedModel } = useQuery<OutcomeModel>({
    queryKey: ["/api/engine/outcome-model", selectedBucket],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/engine/outcome-model/${encodeURIComponent(selectedBucket!)}`);
      return res.json();
    },
    enabled: !!selectedBucket,
    retry: false,
  });

  useEffect(() => {
    if (outcomeProgress !== undefined && outcomeProgress.running === false && outcomePolling) {
      setOutcomePolling(false);
      refetchBuckets();
      refetchSelectedModel();
      queryClient.invalidateQueries({ queryKey: ["/api/engine/outcome-buckets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/engine/outcome-model", selectedBucket] });
    }
  }, [outcomeProgress, outcomePolling]);

  const trainOutcomeMutation = useMutation({
    mutationFn: async (bucket: string) => {
      const res = await apiRequest("POST", "/api/engine/train-outcome", { bucket });
      return res.json();
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["/api/engine/outcome-train-progress"] });
      setOutcomePolling(true);
    },
    onError: (err: Error) => Alert.alert("Training Error", err.message, [{ text: "OK" }]),
  });

  const deleteOutcomeMutation = useMutation({
    mutationFn: async (bucket: string) => {
      const res = await apiRequest("DELETE", `/api/engine/outcome-model/${encodeURIComponent(bucket)}`);
      return res.json();
    },
    onSuccess: () => {
      refetchBuckets();
      queryClient.removeQueries({ queryKey: ["/api/engine/outcome-model", selectedBucket] });
    },
    onError: (err: Error) => Alert.alert("Error", err.message, [{ text: "OK" }]),
  });

  const handleTrainOutcome = useCallback(() => {
    if (!selectedBucket) {
      Alert.alert("Select a bucket", "Pick a score outcome first.", [{ text: "OK" }]);
      return;
    }
    trainOutcomeMutation.mutate(selectedBucket);
  }, [selectedBucket, trainOutcomeMutation]);

  const isOutcomeTraining = outcomePolling && outcomeProgress?.running;

  // ── Train All Outcomes ─────────────────────────────────────────────────────
  const { data: allOutcomesProgress } = useQuery<{
    running: boolean;
    totalBuckets: number;
    completedBuckets: number;
    currentBucket: string | null;
    progress: number;
    message: string;
    error: string | null;
    results: string[];
  }>({
    queryKey: ["/api/engine/all-outcomes-progress"],
    refetchInterval: allOutcomesPolling ? 1500 : false,
    enabled: allOutcomesPolling,
  });

  useEffect(() => {
    if (allOutcomesProgress !== undefined && allOutcomesProgress.running === false && allOutcomesPolling) {
      setAllOutcomesPolling(false);
      refetchBuckets();
      queryClient.invalidateQueries({ queryKey: ["/api/engine/outcome-buckets"] });
    }
  }, [allOutcomesProgress, allOutcomesPolling]);

  const trainAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/engine/train-all-outcomes");
      return res.json();
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["/api/engine/all-outcomes-progress"] });
      setAllOutcomesPolling(true);
    },
    onError: (err: Error) => Alert.alert("Training Error", err.message, [{ text: "OK" }]),
  });

  const isAllOutcomesTraining = allOutcomesPolling && allOutcomesProgress?.running;

  // ── HSH model ─────────────────────────────────────────────────────────────
  const { data: hshStatus, refetch: refetchHshStatus } = useQuery<any>({
    queryKey: ["/api/engine/hsh-status"],
  });

  const { data: hshProgress } = useQuery<any>({
    queryKey: ["/api/engine/hsh-train-progress"],
    refetchInterval: hshPolling ? 1500 : false,
    enabled: hshPolling,
  });

  useEffect(() => {
    if (hshProgress !== undefined && hshProgress.running === false && hshPolling) {
      setHshPolling(false);
      refetchHshStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/engine/hsh-status"] });
    }
  }, [hshProgress, hshPolling]);

  const trainHSHMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/engine/train-hsh");
      return res.json();
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["/api/engine/hsh-train-progress"] });
      setHshPolling(true);
    },
    onError: (err: Error) => Alert.alert("HSH Training Error", err.message, [{ text: "OK" }]),
  });

  const isHSHTraining = hshPolling && hshProgress?.running;

  // ── Behavioral Training ────────────────────────────────────────────────────
  const { data: behavioralStatus, refetch: refetchBehavioralStatus } = useQuery<any>({
    queryKey: ["/api/engine/behavioral-status"],
  });

  const { data: behavioralProgress } = useQuery<any>({
    queryKey: ["/api/engine/behavioral-progress"],
    refetchInterval: behavioralPolling ? 1500 : false,
    enabled: behavioralPolling,
  });

  useEffect(() => {
    if (behavioralProgress !== undefined && behavioralProgress.running === false && behavioralPolling) {
      setBehavioralPolling(false);
      refetchBehavioralStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/engine/behavioral-status"] });
    }
  }, [behavioralProgress, behavioralPolling]);

  const trainBehavioralMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/engine/train-behavioral");
      return res.json();
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["/api/engine/behavioral-progress"] });
      setBehavioralPolling(true);
    },
    onError: (err: Error) => Alert.alert("Behavioral Training Error", err.message, [{ text: "OK" }]),
  });

  const isBehavioralTraining = behavioralPolling && behavioralProgress?.running;

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
        Trains on all {status?.trainingSamples ?? "stored"} historical matches using 92 features — full match, first-half, second-half stats, role strengths and form. All 9 models trained end-to-end.
      </Text>

      {status?.trained && !confirmDelete && (
        <TouchableOpacity
          style={[styles.deleteButton, (deleteMutation.isPending || !!isTraining) && styles.trainButtonDisabled]}
          onPress={handleDeleteModels}
          disabled={deleteMutation.isPending || !!isTraining}
        >
          <Ionicons name="trash-outline" size={16} color="#f87171" />
          <Text style={styles.deleteButtonText}>Delete All Saved Models</Text>
        </TouchableOpacity>
      )}

      {status?.trained && confirmDelete && (
        <View style={styles.confirmDeleteRow}>
          <Text style={styles.confirmDeleteText}>Remove all saved model weights?</Text>
          <View style={styles.confirmDeleteButtons}>
            <TouchableOpacity
              style={styles.confirmCancelBtn}
              onPress={() => setConfirmDelete(false)}
              disabled={deleteMutation.isPending}
            >
              <Text style={styles.confirmCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmDeleteBtn, deleteMutation.isPending && styles.trainButtonDisabled]}
              onPress={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.confirmDeleteBtnText}>Yes, Delete</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Per-Score-Outcome Models ────────────────────────────────── */}
      <View style={styles.outcomeSection}>
        <Text style={styles.sectionTitle}>Per-Score-Outcome Models</Text>
        <Text style={styles.sectionSubtitle}>
          Pick a final-score bucket and train a unified linear formula that lands every match in that bucket on the target score, while keeping matches from other buckets away from it.
        </Text>

        <View style={styles.bucketGrid}>
          {(outcomeBuckets?.buckets ?? []).map((b) => {
            const active = selectedBucket === b.id;
            return (
              <TouchableOpacity
                key={b.id}
                onPress={() => setSelectedBucket(b.id)}
                style={[styles.bucketChip, active && styles.bucketChipActive]}
                testID={`bucket-${b.id}`}
              >
                <Text style={[styles.bucketChipLabel, active && styles.bucketChipLabelActive]}>{b.label}</Text>
                <Text style={[styles.bucketChipCount, active && styles.bucketChipCountActive]}>
                  n={b.sampleCount}
                </Text>
                {b.trained && (
                  <View style={styles.bucketChipDot}>
                    <Ionicons name="checkmark-circle" size={12} color={active ? "#fff" : Colors.dark.accent} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
          {!outcomeBuckets && (
            <Text style={styles.emptyHint}>Loading buckets…</Text>
          )}
        </View>

        <View style={styles.outcomeActions}>
          <TouchableOpacity
            style={[
              styles.trainOutcomeBtn,
              (!selectedBucket || isOutcomeTraining || isAllOutcomesTraining) && styles.trainOutcomeBtnDisabled,
            ]}
            onPress={handleTrainOutcome}
            disabled={!selectedBucket || !!isOutcomeTraining || !!isAllOutcomesTraining}
            testID="train-outcome-btn"
          >
            {isOutcomeTraining ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="flash" size={16} color="#fff" />
                <Text style={styles.trainOutcomeBtnText}>
                  {selectedBucket ? `Train "${selectedBucket}"` : "Select a bucket"}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {selectedBucket && selectedModel && !isOutcomeTraining && !isAllOutcomesTraining && (
            <TouchableOpacity
              style={styles.deleteOutcomeBtn}
              onPress={() => deleteOutcomeMutation.mutate(selectedBucket)}
              testID="delete-outcome-btn"
            >
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
            </TouchableOpacity>
          )}
        </View>

        {/* Train All Buckets button */}
        <TouchableOpacity
          style={[
            styles.trainAllBtn,
            (isAllOutcomesTraining || isOutcomeTraining || trainAllMutation.isPending) && styles.trainOutcomeBtnDisabled,
          ]}
          onPress={() => trainAllMutation.mutate()}
          disabled={isAllOutcomesTraining || !!isOutcomeTraining || trainAllMutation.isPending}
          testID="train-all-outcomes-btn"
        >
          {isAllOutcomesTraining || trainAllMutation.isPending ? (
            <ActivityIndicator size="small" color={Colors.dark.accent} />
          ) : (
            <Ionicons name="layers" size={16} color={Colors.dark.accent} />
          )}
          <Text style={styles.trainAllBtnText}>
            {isAllOutcomesTraining
              ? `Training all… ${allOutcomesProgress?.completedBuckets ?? 0}/${allOutcomesProgress?.totalBuckets ?? 0}`
              : "Train All Buckets"}
          </Text>
        </TouchableOpacity>

        {isAllOutcomesTraining && (
          <View style={styles.outcomeProgress}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${allOutcomesProgress?.progress ?? 0}%`, backgroundColor: Colors.dark.accent }]} />
            </View>
            <Text style={styles.outcomeProgressMsg}>{allOutcomesProgress?.message ?? "Working…"}</Text>
          </View>
        )}

        {allOutcomesProgress?.results && allOutcomesProgress.results.length > 0 && !isAllOutcomesTraining && (
          <View style={styles.allResultsBox}>
            {allOutcomesProgress.results.map((r, i) => (
              <Text key={i} style={[styles.allResultLine, r.startsWith("✓") ? { color: "#22c55e" } : { color: "#ef4444" }]}>
                {r}
              </Text>
            ))}
          </View>
        )}

        {isOutcomeTraining && (
          <View style={styles.outcomeProgress}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${outcomeProgress?.progress ?? 0}%` }]} />
            </View>
            <Text style={styles.outcomeProgressMsg}>{outcomeProgress?.message ?? "Working…"}</Text>
          </View>
        )}

        {outcomeProgress?.error && !isOutcomeTraining && (
          <Text style={styles.outcomeError}>Error: {outcomeProgress.error}</Text>
        )}

        {selectedModel && !isOutcomeTraining && (
          <View style={styles.outcomeResultCard}>
            <View style={styles.outcomeResultHeader}>
              <Text style={styles.outcomeResultTitle}>Bucket "{selectedModel.bucket}"</Text>
              <Text style={styles.outcomeResultDate}>{formatDate(selectedModel.trainedAt)}</Text>
            </View>
            <View style={styles.outcomeMetricsRow}>
              <View style={styles.outcomeMetric}>
                <Text style={styles.outcomeMetricValue}>{selectedModel.sampleCount}</Text>
                <Text style={styles.outcomeMetricLabel}>positives</Text>
              </View>
              <View style={styles.outcomeMetric}>
                <Text style={[styles.outcomeMetricValue, { color: "#22c55e" }]}>
                  {(selectedModel.trainAccuracy * 100).toFixed(1)}%
                </Text>
                <Text style={styles.outcomeMetricLabel}>train hit-rate</Text>
              </View>
              <View style={styles.outcomeMetric}>
                <Text style={[styles.outcomeMetricValue, { color: "#f59e0b" }]}>
                  {(selectedModel.fpRate * 100).toFixed(1)}%
                </Text>
                <Text style={styles.outcomeMetricLabel}>false-positive</Text>
              </View>
            </View>
            <View style={styles.formulaBox}>
              <Text style={styles.formulaText} selectable>
                {selectedModel.formula}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* ── Highest-Scoring-Half (HSH) Model ─────────────────────────────── */}
      <View style={styles.hshSection}>
        <Text style={styles.sectionTitle}>Highest-Scoring Half (HSH)</Text>
        <Text style={styles.sectionSubtitle}>
          Predicts whether the 1st half, 2nd half, or neither scores more goals.
          Uses per-half stats (goals, xG, shots, big chances) plus 8 situational context signals:
          motivation, fatigue, coach style, odds gap, knockout stage and more.
        </Text>

        {/* Status + class distribution */}
        <View style={styles.hshStatusRow}>
          <View style={[styles.statusBadge, { backgroundColor: hshStatus?.trained ? "#16a34a22" : "#71717a22" }]}>
            <View style={[styles.statusDot, { backgroundColor: hshStatus?.trained ? "#4ade80" : "#71717a" }]} />
            <Text style={[styles.statusText, { color: hshStatus?.trained ? "#4ade80" : "#9ca3af" }]}>
              {hshStatus?.trained ? "Trained" : "Untrained"}
            </Text>
          </View>
          {hshStatus?.trained && (
            <Text style={styles.hshAccText}>
              Acc {(hshStatus.trainAccuracy * 100).toFixed(1)}%  ·  n={hshStatus.sampleCount}
            </Text>
          )}
        </View>

        {hshStatus?.trained && (
          <View style={styles.hshClassRow}>
            {[
              { label: "1st Half",  count: hshStatus.classCounts?.first  ?? 0, color: "#3D7BF4" },
              { label: "2nd Half",  count: hshStatus.classCounts?.second ?? 0, color: "#f59e0b" },
              { label: "Equal",     count: hshStatus.classCounts?.draw   ?? 0, color: "#71717a" },
            ].map((c) => (
              <View key={c.label} style={styles.hshClassItem}>
                <Text style={[styles.hshClassValue, { color: c.color }]}>{c.count}</Text>
                <Text style={styles.hshClassLabel}>{c.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Training progress */}
        {isHSHTraining && (
          <View style={styles.outcomeProgress}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${hshProgress?.progress ?? 0}%` }]} />
            </View>
            <Text style={styles.outcomeProgressMsg}>{hshProgress?.message ?? "Training…"}</Text>
          </View>
        )}

        {hshProgress?.error && !isHSHTraining && (
          <Text style={styles.outcomeError}>Error: {hshProgress.error}</Text>
        )}

        <TouchableOpacity
          style={[styles.trainOutcomeBtn, (isHSHTraining || trainHSHMutation.isPending) && styles.trainOutcomeBtnDisabled]}
          onPress={() => trainHSHMutation.mutate()}
          disabled={isHSHTraining || trainHSHMutation.isPending}
        >
          {isHSHTraining || trainHSHMutation.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="analytics" size={16} color="#fff" />
              <Text style={styles.trainOutcomeBtnText}>
                {hshStatus?.trained ? "Retrain HSH Model" : "Train HSH Model"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {hshStatus?.trained && !isHSHTraining && (
          <Text style={styles.hshTrainedAt}>Last trained: {formatDate(hshStatus.trainedAt)}</Text>
        )}
      </View>

      {/* ── Behavioral Training System ─────────────────────────────────── */}
      <View style={styles.behavioralSection}>
        <View style={styles.behavioralHeader}>
          <View style={styles.behavioralHeaderLeft}>
            <Ionicons name="git-network" size={20} color="#a78bfa" />
            <Text style={styles.behavioralTitle}>Behavioral Training System</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: behavioralStatus?.anyTrained ? "#581c8722" : "#71717a22" }]}>
            <View style={[styles.statusDot, { backgroundColor: behavioralStatus?.anyTrained ? "#a78bfa" : "#71717a" }]} />
            <Text style={[styles.statusText, { color: behavioralStatus?.anyTrained ? "#a78bfa" : "#9ca3af" }]}>
              {behavioralStatus?.anyTrained ? "Trained" : "Untrained"}
            </Text>
          </View>
        </View>

        <Text style={styles.behavioralSubtitle}>
          Teaches models WHY a score happens — not just WHAT score happens. Uses behavioral, contextual, and
          statistical identity to distinguish natural matches from random chaos.
        </Text>

        {/* 8-Stage Pipeline */}
        <View style={styles.pipelineBox}>
          <Text style={styles.pipelineBoxTitle}>8-Stage Training Pipeline</Text>
          {[
            { n: "1", label: "Data Completeness Scoring", desc: "90%+=full weight · 75-89%=medium · 50-74%=low · <50%=excluded" },
            { n: "2", label: "Feature Engineering", desc: "Fair odds · Expected goals · BTTS expectation · Tempo · Behavioral indices" },
            { n: "3", label: "Bucket Family Training", desc: "6 families: Low Defensive · Balanced BTTS · Open High · Dominant · Chaotic" },
            { n: "4", label: "True vs False Bucket Separation", desc: "Aligned pre-match data=1.0× · Adjacent family=0.45× · Chaos/random=0.2×" },
            { n: "5", label: "Contextual Bucket Training", desc: "Each bucket learns its own behavioral identity — protect-lead, collapse risk, aggression" },
            { n: "6", label: "Hierarchical Models (7 layers)", desc: "Winner → Goal Range → BTTS → Tempo → Family → Exact Score → Contradiction" },
            { n: "7", label: "Contradiction Detection", desc: "Penalises impossible combos: 0-0 when BTTS=75%, low-goal when high expected" },
            { n: "8", label: "Confidence Calibration", desc: "completeness × family alignment × winner confidence × odds agreement" },
          ].map((stage) => (
            <View key={stage.n} style={styles.stageRow}>
              <View style={styles.stageBadge}>
                <Text style={styles.stageBadgeNum}>{stage.n}</Text>
              </View>
              <View style={styles.stageContent}>
                <Text style={styles.stageLabel}>{stage.label}</Text>
                <Text style={styles.stageDesc}>{stage.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Model statuses */}
        {behavioralStatus?.models && behavioralStatus.models.length > 0 && (
          <View style={styles.behavioralModels}>
            <Text style={styles.behavioralModelsTitle}>Model Status</Text>
            {(behavioralStatus.models as any[]).map((m: any) => (
              <View key={m.type} style={styles.bModelRow}>
                <View style={styles.bModelLeft}>
                  <Ionicons
                    name={m.trained ? "checkmark-circle" : "ellipse-outline"}
                    size={14}
                    color={m.trained ? "#a78bfa" : "#71717a"}
                  />
                  <Text style={[styles.bModelLabel, !m.trained && { color: "#71717a" }]}>{m.label}</Text>
                </View>
                {m.trained && (
                  <View style={styles.bModelRight}>
                    <Text style={styles.bModelAcc}>{m.trainAccuracy}%</Text>
                    <Text style={styles.bModelSamples}>n={m.sampleCount} ({m.trueMatchCount} true)</Text>
                  </View>
                )}
              </View>
            ))}
            {behavioralStatus.trainedAt && (
              <Text style={styles.behavioralTrainedAt}>
                Last trained: {formatDate(behavioralStatus.trainedAt)} · {behavioralStatus.featureCount ?? 52} features
              </Text>
            )}
          </View>
        )}

        {/* Training progress */}
        {isBehavioralTraining && (
          <View style={styles.trainingCard}>
            <View style={styles.trainingHeader}>
              <ActivityIndicator size="small" color="#a78bfa" />
              <Text style={styles.trainingTitle}>
                {behavioralProgress?.stage ?? "Training"} in progress…
              </Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${behavioralProgress?.progress ?? 0}%`, backgroundColor: "#a78bfa" }]} />
            </View>
            <Text style={styles.trainingMessage}>{behavioralProgress?.message ?? ""}</Text>
            <Text style={[styles.trainingPct, { color: "#a78bfa" }]}>{Math.round(behavioralProgress?.progress ?? 0)}%</Text>
          </View>
        )}

        {behavioralProgress?.stageResults && behavioralProgress.stageResults.length > 0 && !isBehavioralTraining && (
          <View style={styles.allResultsBox}>
            {(behavioralProgress.stageResults as string[]).map((r, i) => (
              <Text key={i} style={[styles.allResultLine, { color: "#c4b5fd" }]}>{r}</Text>
            ))}
          </View>
        )}

        {behavioralProgress?.error && !isBehavioralTraining && (
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={16} color="#f87171" />
            <Text style={styles.errorText}>{behavioralProgress.error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.behavioralTrainBtn, (isBehavioralTraining || trainBehavioralMutation.isPending) && styles.trainButtonDisabled]}
          onPress={() => trainBehavioralMutation.mutate()}
          disabled={isBehavioralTraining || trainBehavioralMutation.isPending}
        >
          {isBehavioralTraining || trainBehavioralMutation.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="git-network" size={18} color="#fff" />
          )}
          <Text style={styles.behavioralTrainBtnText}>
            {isBehavioralTraining
              ? "Training behavioral models…"
              : behavioralStatus?.anyTrained
                ? "Retrain Behavioral Models"
                : "Train Behavioral Models"}
          </Text>
        </TouchableOpacity>
        <Text style={styles.behavioralHint}>
          Requires ≥20 stored matches (bulk-upload from Processing tab). Trains all 7 hierarchical
          models using {behavioralStatus?.featureCount ?? 52} behavioral + contextual + statistical features.
        </Text>
      </View>

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
  confirmDeleteRow: {
    borderRadius: 12, padding: 14, marginBottom: 8,
    backgroundColor: "#7f1d1d22", borderWidth: 1, borderColor: "#f8717133",
  },
  confirmDeleteText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#f87171", marginBottom: 10, textAlign: "center" },
  confirmDeleteButtons: { flexDirection: "row", gap: 8 },
  confirmCancelBtn: {
    flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center",
    backgroundColor: Colors.dark.card, borderWidth: 1, borderColor: Colors.dark.border,
  },
  confirmCancelText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.dark.textSecondary },
  confirmDeleteBtn: {
    flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center",
    backgroundColor: "#dc2626",
  },
  confirmDeleteBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
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

  trainAllBtn: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.accent + "66",
    backgroundColor: Colors.dark.accent + "11",
  },
  trainAllBtnText: { color: Colors.dark.accent, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  allResultsBox: {
    backgroundColor: "#0f172a", borderRadius: 8, padding: 10,
    marginBottom: 12, borderWidth: 1, borderColor: "#1e293b",
  },
  allResultLine: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 18 },

  // Per-score-outcome models
  outcomeSection: { marginBottom: 24 },
  bucketGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  bucketChip: {
    backgroundColor: Colors.dark.surface, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: Colors.dark.border, alignItems: "center", minWidth: 80, position: "relative",
  },
  bucketChipActive: { backgroundColor: Colors.dark.accent, borderColor: Colors.dark.accent },
  bucketChipLabel: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  bucketChipLabelActive: { color: "#fff" },
  bucketChipCount: { fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.dark.textSecondary, marginTop: 2 },
  bucketChipCountActive: { color: "rgba(255,255,255,0.85)" },
  bucketChipDot: { position: "absolute", top: 4, right: 4 },
  emptyHint: { fontSize: 12, color: Colors.dark.textSecondary, fontFamily: "Inter_400Regular" },
  outcomeActions: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  trainOutcomeBtn: {
    flex: 1, backgroundColor: Colors.dark.accent, borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  trainOutcomeBtnDisabled: { opacity: 0.5 },
  trainOutcomeBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  deleteOutcomeBtn: {
    backgroundColor: Colors.dark.surface, borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  outcomeProgress: { marginBottom: 12 },
  progressBarBg: {
    height: 6, borderRadius: 3, backgroundColor: Colors.dark.border, overflow: "hidden", marginBottom: 6,
  },
  outcomeProgressMsg: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  outcomeError: {
    fontSize: 12, fontFamily: "Inter_500Medium", color: "#ef4444",
    backgroundColor: "rgba(239,68,68,0.1)", borderRadius: 8, padding: 10, marginBottom: 12,
  },
  outcomeResultCard: {
    backgroundColor: Colors.dark.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  outcomeResultHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  outcomeResultTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  outcomeResultDate: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  outcomeMetricsRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  outcomeMetric: { flex: 1, backgroundColor: "#1e293b", borderRadius: 8, padding: 10, alignItems: "center" },
  outcomeMetricValue: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  outcomeMetricLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2 },
  formulaBox: {
    backgroundColor: "#0f172a", borderRadius: 8, padding: 12,
    borderWidth: 1, borderColor: "#1e293b",
  },
  formulaText: {
    fontSize: 11, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    color: "#cbd5e1", lineHeight: 18,
  },

  // Behavioral Training section
  behavioralSection: {
    marginBottom: 24, borderRadius: 14, padding: 16,
    backgroundColor: "#1a1033", borderWidth: 1, borderColor: "#4c1d9544",
  },
  behavioralHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  behavioralHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  behavioralTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#c4b5fd" },
  behavioralSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#94a3b8", marginBottom: 14, lineHeight: 18 },
  pipelineBox: {
    backgroundColor: "#120b26", borderRadius: 10, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: "#4c1d9533",
  },
  pipelineBoxTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#a78bfa", marginBottom: 10 },
  stageRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  stageBadge: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: "#4c1d95",
    alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
  },
  stageBadgeNum: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#c4b5fd" },
  stageContent: { flex: 1 },
  stageLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#ddd6fe", marginBottom: 1 },
  stageDesc: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6b7280", lineHeight: 15 },
  behavioralModels: {
    backgroundColor: "#120b26", borderRadius: 10, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: "#4c1d9533",
  },
  behavioralModelsTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#a78bfa", marginBottom: 10 },
  bModelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#1e1040" },
  bModelLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  bModelLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#ddd6fe" },
  bModelRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  bModelAcc: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#a78bfa" },
  bModelSamples: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6b7280" },
  behavioralTrainedAt: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6b7280", marginTop: 8, textAlign: "center" },
  behavioralTrainBtn: {
    backgroundColor: "#7c3aed", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8,
  },
  behavioralTrainBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  behavioralHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6b7280", textAlign: "center" },

  // HSH section
  hshSection: { marginBottom: 24 },
  hshStatusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  hshAccText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.dark.textSecondary },
  hshClassRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  hshClassItem: {
    flex: 1, backgroundColor: Colors.dark.surface, borderRadius: 10, padding: 10,
    alignItems: "center", borderWidth: 1, borderColor: Colors.dark.border,
  },
  hshClassValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  hshClassLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2 },
  hshTrainedAt: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textTertiary, textAlign: "center", marginTop: 8 },
});
