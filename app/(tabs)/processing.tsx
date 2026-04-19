import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";

function getApiBase() {
  return `${getApiUrl()}`;
}

type JobState = {
  id: string;
  status: "running" | "completed" | "cancelled";
  total: number;
  processed: number;
  stored: number;
  skipped: number;
  failed: number;
  log: string[];
};

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <View style={styles.progressBg}>
      <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` as any }]} />
    </View>
  );
}

export default function ProcessingScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [date, setDate] = useState(todayString());
  const [sport, setSport] = useState<"football" | "basketball">("football");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<ScrollView>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (job?.log?.length) {
      setTimeout(() => logRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [job?.log?.length]);

  async function startJob() {
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      setError("Enter a valid date in YYYY-MM-DD format");
      return;
    }
    setError(null);
    setLoading(true);
    setJob(null);
    setJobId(null);

    try {
      const res = await fetch(new URL("/api/database/process-date", getApiBase()).href, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, sport }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to start job");
      if (!body.jobId) {
        setError(body.message || "No finished matches found for this date.");
        setLoading(false);
        return;
      }

      setJobId(body.jobId);
      setJob({
        id: body.jobId,
        status: "running",
        total: body.total,
        processed: 0,
        stored: 0,
        skipped: 0,
        failed: 0,
        log: [],
      });
      setLoading(false);

      pollRef.current = setInterval(async () => {
        try {
          const pr = await fetch(new URL(`/api/database/job/${body.jobId}`, getApiBase()).href);
          const pj: JobState = await pr.json();
          setJob(pj);
          if (pj.status !== "running") {
            if (pollRef.current) clearInterval(pollRef.current);
            qc.invalidateQueries({ queryKey: ["/api/database/matches"] });
            qc.invalidateQueries({ queryKey: ["/api/database/stats"] });
          }
        } catch {}
      }, 3000);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }

  async function cancelJob() {
    if (!jobId) return;
    try {
      await fetch(new URL(`/api/database/job/${jobId}/cancel`, getApiBase()).href, { method: "POST" });
    } catch {}
  }

  const isRunning = job?.status === "running";
  const isDone = job?.status === "completed" || job?.status === "cancelled";

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Processing</Text>
        <Text style={styles.subtitle}>Bulk upload match simulation stats</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: botPad + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Date input */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Date</Text>
          <View style={styles.inputRow}>
            <Ionicons name="calendar-outline" size={18} color="#6b7280" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.dateInput}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#6b7280"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
          </View>
          <Text style={styles.hint}>Enter any past date with finished matches</Text>
        </View>

        {/* Sport selector */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Sport</Text>
          <View style={styles.sportRow}>
            {(["football", "basketball"] as const).map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.sportBtn, sport === s && styles.sportBtnActive]}
                onPress={() => setSport(s)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={s === "football" ? "football-outline" : "basketball-outline"}
                  size={16}
                  color={sport === s ? "#fff" : "#6b7280"}
                />
                <Text style={[styles.sportBtnText, sport === s && styles.sportBtnTextActive]}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Rate limiting notice */}
        <View style={styles.noticeBox}>
          <Ionicons name="shield-checkmark-outline" size={16} color="#60a5fa" />
          <Text style={styles.noticeText}>
            Matches are processed one at a time with a 2.5s delay between each to prevent rate limiting. Large dates may take several minutes.
          </Text>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#f87171" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Start / Cancel button */}
        {!isRunning ? (
          <TouchableOpacity
            style={[styles.startBtn, (loading) && styles.startBtnDisabled]}
            onPress={startJob}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                <Text style={styles.startBtnText}>Bulk Upload</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelJob} activeOpacity={0.8}>
            <Ionicons name="stop-circle-outline" size={18} color="#f87171" />
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}

        {/* Progress section */}
        {job && (
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>
                {isRunning ? "Processing..." : job.status === "completed" ? "Completed" : "Cancelled"}
              </Text>
              <Text style={styles.progressCount}>
                {job.processed} / {job.total}
              </Text>
            </View>

            <ProgressBar value={job.processed} total={job.total} />

            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={[styles.statNum, { color: "#4ade80" }]}>{job.stored}</Text>
                <Text style={styles.statLbl}>Stored</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statNum, { color: "#facc15" }]}>{job.skipped}</Text>
                <Text style={styles.statLbl}>Skipped</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statNum, { color: "#f87171" }]}>{job.failed}</Text>
                <Text style={styles.statLbl}>Failed</Text>
              </View>
            </View>

            {isDone && (
              <View style={styles.doneBox}>
                <Ionicons
                  name={job.status === "completed" ? "checkmark-circle" : "stop-circle"}
                  size={18}
                  color={job.status === "completed" ? "#4ade80" : "#f87171"}
                />
                <Text style={[styles.doneText, { color: job.status === "completed" ? "#4ade80" : "#f87171" }]}>
                  {job.status === "completed"
                    ? `Done — ${job.stored} new matches saved to database`
                    : "Processing cancelled"}
                </Text>
              </View>
            )}

            {/* Log */}
            {job.log.length > 0 && (
              <View style={styles.logBox}>
                <Text style={styles.logTitle}>Log</Text>
                <ScrollView
                  ref={logRef}
                  style={styles.logScroll}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                >
                  {job.log.map((line, i) => (
                    <Text key={i} style={styles.logLine}>{line}</Text>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f0f" },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#f9fafb" },
  subtitle: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  section: { marginBottom: 20 },
  sectionLabel: { fontSize: 12, fontWeight: "600", color: "#9ca3af", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#374151",
  },
  dateInput: { flex: 1, color: "#f9fafb", fontSize: 16, fontWeight: "500" },
  hint: { fontSize: 12, color: "#4b5563", marginTop: 6 },
  sportRow: { flexDirection: "row", gap: 10 },
  sportBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "#374151",
  },
  sportBtnActive: { backgroundColor: "#1d4ed8", borderColor: "#3b82f6" },
  sportBtnText: { fontSize: 14, color: "#6b7280", fontWeight: "600" },
  sportBtnTextActive: { color: "#fff" },
  noticeBox: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#1e3a5f22",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1d4ed833",
    marginBottom: 20,
  },
  noticeText: { flex: 1, fontSize: 12, color: "#93c5fd", lineHeight: 18 },
  errorBox: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#1f091222",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    marginBottom: 16,
  },
  errorText: { flex: 1, fontSize: 13, color: "#f87171", lineHeight: 18 },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#1d4ed8",
    borderRadius: 12,
    paddingVertical: 15,
    marginBottom: 24,
  },
  startBtnDisabled: { opacity: 0.6 },
  startBtnText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#1f1414",
    borderRadius: 12,
    paddingVertical: 15,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#7f1d1d",
  },
  cancelBtnText: { fontSize: 16, fontWeight: "700", color: "#f87171" },
  progressSection: {
    backgroundColor: "#111827",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  progressTitle: { fontSize: 15, fontWeight: "700", color: "#f9fafb" },
  progressCount: { fontSize: 13, color: "#9ca3af" },
  progressBg: { height: 8, backgroundColor: "#1f2937", borderRadius: 4, marginBottom: 16, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#3b82f6", borderRadius: 4 },
  statsGrid: { flexDirection: "row", gap: 10, marginBottom: 14 },
  statBox: { flex: 1, backgroundColor: "#1a1a2e", borderRadius: 10, padding: 12, alignItems: "center" },
  statNum: { fontSize: 22, fontWeight: "700" },
  statLbl: { fontSize: 11, color: "#6b7280", marginTop: 2 },
  doneBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#0f1f0f",
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#14532d33",
  },
  doneText: { fontSize: 13, fontWeight: "600" },
  logBox: { backgroundColor: "#0a0a0a", borderRadius: 10, padding: 12 },
  logTitle: { fontSize: 11, fontWeight: "600", color: "#6b7280", marginBottom: 8, textTransform: "uppercase" },
  logScroll: { maxHeight: 280 },
  logLine: { fontSize: 12, color: "#9ca3af", lineHeight: 20, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
});
