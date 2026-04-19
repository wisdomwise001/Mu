import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";

function base() { return `${getApiUrl()}`; }

type M = Record<string, any>;

// ─── Tiny helpers ──────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, dec = 1): string {
  if (v == null) return "—";
  return Number.isFinite(v) ? v.toFixed(dec) : "—";
}
function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return Number.isFinite(v) ? `${v.toFixed(1)}%` : "—";
}

function ResultDot({ result }: { result: string | null }) {
  if (!result) return null;
  const color = result === "H" ? "#4ade80" : result === "D" ? "#facc15" : "#f87171";
  return (
    <View style={[styles.resultDot, { backgroundColor: color }]}>
      <Text style={styles.resultDotText}>{result}</Text>
    </View>
  );
}

function FormChar({ ch }: { ch: string }) {
  const color = ch === "W" ? "#4ade80" : ch === "D" ? "#facc15" : "#f87171";
  return <Text style={[styles.formChar, { color }]}>{ch}</Text>;
}

function FormString({ value }: { value: string | null | undefined }) {
  if (!value) return <Text style={styles.formDash}>—</Text>;
  const chars = value.split(" ").filter(Boolean);
  return (
    <View style={styles.formRow}>
      {chars.map((c, i) => <FormChar key={i} ch={c} />)}
    </View>
  );
}

// ─── Section Headers ────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{label}</Text>
    </View>
  );
}

// ─── Two-column comparison row (Home | Label | Away) ───────────────────────

function CmpRow({ label, home, away, note, highlight }: {
  label: string; home: string; away: string; note?: string; highlight?: boolean;
}) {
  return (
    <View style={[styles.cmpRow, highlight && styles.cmpRowHighlight]}>
      <Text style={[styles.cmpVal, styles.homeCol]} numberOfLines={1}>{home}</Text>
      <View style={styles.cmpLabelCol}>
        <Text style={styles.cmpLabel} numberOfLines={1}>{label}</Text>
        {note ? <Text style={styles.cmpNote} numberOfLines={1}>{note}</Text> : null}
      </View>
      <Text style={[styles.cmpVal, styles.awayCol]} numberOfLines={1}>{away}</Text>
    </View>
  );
}

// ─── Strength bar row (for role / form strengths) ──────────────────────────

function StrengthRow({ label, note, home, away }: {
  label: string; note: string; home: number | null; away: number | null;
}) {
  return (
    <View style={styles.strengthRow}>
      <View style={styles.strengthBarSide}>
        <View style={styles.strengthBarBg}>
          <View style={[styles.strengthBarFill, styles.strengthBarHome,
            { width: `${Math.round(((home ?? 0) / 10) * 100)}%` as any }]} />
        </View>
        <Text style={[styles.strengthNum, styles.homeNum]}>{fmt(home)}</Text>
      </View>
      <View style={styles.strengthLabelCol}>
        <Text style={styles.strengthLabel}>{label}</Text>
        <Text style={styles.strengthNote}>{note}</Text>
      </View>
      <View style={styles.strengthBarSide}>
        <Text style={[styles.strengthNum, styles.awayNum]}>{fmt(away)}</Text>
        <View style={styles.strengthBarBg}>
          <View style={[styles.strengthBarFill, styles.strengthBarAway,
            { width: `${Math.round(((away ?? 0) / 10) * 100)}%` as any }]} />
        </View>
      </View>
    </View>
  );
}

// ─── Form summary line ──────────────────────────────────────────────────────

function FormSummaryLine({ teamName, m }: { teamName: string; m: M }) {
  const pts = m.form_points;
  const gf = m.goals_for;
  const ga = m.goals_against;
  const cs = m.clean_sheets;
  const form = m.recent_form;
  const chars = (form || "").split(" ").filter(Boolean);
  return (
    <View style={styles.formSummaryLine}>
      <Text style={styles.formSummaryTeam} numberOfLines={1}>{teamName}</Text>
      <Text style={styles.formSummaryStats}>
        {pts != null ? `${pts} pts` : "—"}{" · "}
        {gf != null && ga != null ? `${gf}-${ga}` : "—"}{" · "}
        {cs != null ? `CS ${cs}` : "—"}
      </Text>
      <View style={styles.formInline}>
        {chars.map((c: string, i: number) => <FormChar key={i} ch={c} />)}
      </View>
    </View>
  );
}

// ─── Main match card ────────────────────────────────────────────────────────

function MatchCard({ item, onDelete }: { item: M; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);

  function confirmDelete() {
    if (Platform.OS === "web") {
      if (window.confirm(`Delete ${item.home_team_name} vs ${item.away_team_name}?`)) onDelete(item.event_id);
    } else {
      Alert.alert("Delete", `Remove ${item.home_team_name} vs ${item.away_team_name}?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => onDelete(item.event_id) },
      ]);
    }
  }

  const h = (col: string) => item[`home_${col}`];
  const a = (col: string) => item[`away_${col}`];

  const analyzed = item.home_matches_analyzed ?? item.away_matches_analyzed ?? 0;
  const statsCount = item.home_avg_goals_scored != null ? analyzed : 0;

  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.8} style={styles.cardHeader}>
        <View style={styles.cardMain}>
          <ResultDot result={item.result} />
          <View style={styles.teamsRow}>
            <Text style={styles.teamName} numberOfLines={1}>{item.home_team_name}</Text>
            <Text style={styles.score}>{item.home_goals ?? "?"} – {item.away_goals ?? "?"}</Text>
            <Text style={[styles.teamName, { textAlign: "right" }]} numberOfLines={1}>{item.away_team_name}</Text>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color="#6b7280" />
        </View>
        <View style={styles.cardMeta}>
          <Text style={styles.metaText} numberOfLines={1}>{item.tournament || "—"}</Text>
          <Text style={styles.metaText}>{item.match_date || "—"}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <ScrollView style={styles.expandedScroll} nestedScrollEnabled>

          {/* ── Match Summary ── */}
          {(() => {
            const hg = item.home_goals ?? null;
            const ag = item.away_goals ?? null;
            const hht = item.home_ht_goals ?? null;
            const aht = item.away_ht_goals ?? null;
            const result = item.result;
            const resultLabel = result === "H" ? "1 (Home Win)" : result === "D" ? "X (Draw)" : result === "A" ? "2 (Away Win)" : "—";
            const resultColor = result === "H" ? "#4ade80" : result === "D" ? "#facc15" : "#f87171";
            const combined = hg != null && ag != null ? hg + ag : null;
            const btts = hg != null && ag != null ? (hg > 0 && ag > 0 ? "Yes" : "No") : null;
            const bttsColor = btts === "Yes" ? "#4ade80" : "#f87171";
            let highestHalf = "—";
            if (hht != null && aht != null && hg != null && ag != null) {
              const h1goals = hht + aht;
              const h2goals = (hg - hht) + (ag - aht);
              highestHalf = h1goals > h2goals ? "1st Half" : h1goals < h2goals ? "2nd Half" : "Equal";
            }
            return (
              <View style={styles.matchSummaryBox}>
                <SectionHeader label="Match Summary" />
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryCell}>
                    <Text style={styles.summaryCellLabel}>Result</Text>
                    <Text style={[styles.summaryCellValue, { color: resultColor }]}>{resultLabel}</Text>
                  </View>
                  <View style={styles.summaryCell}>
                    <Text style={styles.summaryCellLabel}>Combined Goals</Text>
                    <Text style={styles.summaryCellValue}>{combined != null ? String(combined) : "—"}</Text>
                  </View>
                  <View style={styles.summaryCell}>
                    <Text style={styles.summaryCellLabel}>Home Goals</Text>
                    <Text style={[styles.summaryCellValue, { color: "#60a5fa" }]}>{hg != null ? String(hg) : "—"}</Text>
                  </View>
                  <View style={styles.summaryCell}>
                    <Text style={styles.summaryCellLabel}>Away Goals</Text>
                    <Text style={[styles.summaryCellValue, { color: "#f87171" }]}>{ag != null ? String(ag) : "—"}</Text>
                  </View>
                  <View style={styles.summaryCell}>
                    <Text style={styles.summaryCellLabel}>BTTS</Text>
                    <Text style={[styles.summaryCellValue, { color: bttsColor }]}>{btts ?? "—"}</Text>
                  </View>
                  <View style={styles.summaryCell}>
                    <Text style={styles.summaryCellLabel}>Highest Scoring Half</Text>
                    <Text style={styles.summaryCellValue}>{highestHalf}</Text>
                  </View>
                  {hht != null && aht != null && (
                    <View style={styles.summaryCell}>
                      <Text style={styles.summaryCellLabel}>Half-Time Score</Text>
                      <Text style={styles.summaryCellValue}>{hht} – {aht}</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })()}

          {/* Column headers */}
          <View style={styles.teamHeaderRow}>
            <Text style={[styles.teamHeaderName, styles.homeCol]} numberOfLines={1}>{item.home_team_name}</Text>
            <View style={styles.cmpLabelCol} />
            <Text style={[styles.teamHeaderName, styles.awayCol]} numberOfLines={1}>{item.away_team_name}</Text>
          </View>

          {/* ── Role strengths ── */}
          <SectionHeader label={`Last ${analyzed} Role Strengths`} />
          <StrengthRow label="Defensive" note="duels, recoveries, clearances, errors"
            home={h("phase_defensive")} away={a("phase_defensive")} />
          <StrengthRow label="Attack" note="xG, shots, big chances, xA, dribbles"
            home={h("phase_attack")} away={a("phase_attack")} />
          <StrengthRow label="Midfield" note="progression, recoveries, passing, creativity"
            home={h("phase_midfield")} away={a("phase_midfield")} />
          <StrengthRow label="Keeper" note="saves, goals prevented, high claims, sweeper"
            home={h("phase_keeper")} away={a("phase_keeper")} />
          <StrengthRow label="Full-back" note="crosses, carries, tackles, flank progression"
            home={h("phase_fullback")} away={a("phase_fullback")} />

          {/* ── Form strengths ── */}
          <SectionHeader label="Last 7 Matches Form Strengths" />
          <StrengthRow label="Form" note="3 win · 1 draw · 0 loss · +2 big win · +1 CS · -1 draw/0-0"
            home={h("form_strength")} away={a("form_strength")} />
          <StrengthRow label="Scoring" note="goals per match, scoring rate, big-win margin"
            home={h("scoring_strength")} away={a("scoring_strength")} />
          <StrengthRow label="Defending" note="goals conceded per match & clean-sheet rate"
            home={h("defending_strength")} away={a("defending_strength")} />

          {/* Form summaries */}
          <View style={styles.formSummaryBox}>
            <FormSummaryLine teamName={item.home_team_name} m={{
              form_points: h("form_points"), goals_for: h("goals_for"),
              goals_against: h("goals_against"), clean_sheets: h("clean_sheets"),
              recent_form: h("recent_form"),
            }} />
            <FormSummaryLine teamName={item.away_team_name} m={{
              form_points: a("form_points"), goals_for: a("goals_for"),
              goals_against: a("goals_against"), clean_sheets: a("clean_sheets"),
              recent_form: a("recent_form"),
            }} />
          </View>

          {/* ── Full Match Stats ── */}
          <SectionHeader label={`Avg Full Match Stats · Last ${analyzed} matches`} />
          <View style={styles.statsLabelRow}>
            <Text style={[styles.statsLabelText, styles.homeCol]}>Home</Text>
            <Text style={styles.cmpLabel}>Stat</Text>
            <Text style={[styles.statsLabelText, styles.awayCol]}>Away</Text>
          </View>
          <CmpRow label="Goals Scored" home={fmt(h("avg_goals_scored"))} away={fmt(a("avg_goals_scored"))} highlight />
          <CmpRow label="Goals Conceded" home={fmt(h("avg_goals_conceded"))} away={fmt(a("avg_goals_conceded"))} />
          <View style={styles.groupLabel}><Text style={styles.groupLabelText}>Attack</Text></View>
          <CmpRow label="xG" home={fmt(h("avg_xg"))} away={fmt(a("avg_xg"))} />
          <CmpRow label="Big Chances" home={fmt(h("avg_big_chances"))} away={fmt(a("avg_big_chances"))} />
          <CmpRow label="Total Shots" home={fmt(h("avg_total_shots"))} away={fmt(a("avg_total_shots"))} />
          <CmpRow label="Shots on Target" home={fmt(h("avg_shots_on_target"))} away={fmt(a("avg_shots_on_target"))} />
          <CmpRow label="Shots off Target" home={fmt(h("avg_shots_off_target"))} away={fmt(a("avg_shots_off_target"))} />
          <CmpRow label="Blocked Shots" home={fmt(h("avg_blocked_shots"))} away={fmt(a("avg_blocked_shots"))} />
          <CmpRow label="Shots Inside Box" home={fmt(h("avg_shots_inside_box"))} away={fmt(a("avg_shots_inside_box"))} />
          <CmpRow label="Big Chances Scored" home={fmt(h("avg_big_chances_scored"))} away={fmt(a("avg_big_chances_scored"))} />
          <CmpRow label="Big Chances Missed" home={fmt(h("avg_big_chances_missed"))} away={fmt(a("avg_big_chances_missed"))} />
          <CmpRow label="Corner Kicks" home={fmt(h("avg_corner_kicks"))} away={fmt(a("avg_corner_kicks"))} />
          <View style={styles.groupLabel}><Text style={styles.groupLabelText}>Passing</Text></View>
          <CmpRow label="Pass Accuracy" home={h("avg_pass_accuracy") != null ? fmtPct(h("avg_pass_accuracy")) : "—"} away={a("avg_pass_accuracy") != null ? fmtPct(a("avg_pass_accuracy")) : "—"} />
          <CmpRow label="Total Passes" home={fmt(h("avg_total_passes"), 0)} away={fmt(a("avg_total_passes"), 0)} />
          <CmpRow label="Possession" home={fmtPct(h("avg_possession"))} away={fmtPct(a("avg_possession"))} />
          <View style={styles.groupLabel}><Text style={styles.groupLabelText}>Defending</Text></View>
          <CmpRow label="Duels Won" home={fmt(h("avg_duels_won"))} away={fmt(a("avg_duels_won"))} />
          <CmpRow label="Tackles Won %" home={h("avg_tackles_won") != null ? fmtPct(h("avg_tackles_won")) : "—"} away={a("avg_tackles_won") != null ? fmtPct(a("avg_tackles_won")) : "—"} />
          <CmpRow label="Interceptions" home={fmt(h("avg_interceptions"))} away={fmt(a("avg_interceptions"))} />
          <CmpRow label="Clearances" home={fmt(h("avg_clearances"))} away={fmt(a("avg_clearances"))} />
          <CmpRow label="Fouls" home={fmt(h("avg_fouls"))} away={fmt(a("avg_fouls"))} />
          <View style={styles.groupLabel}><Text style={styles.groupLabelText}>Goalkeeping</Text></View>
          <CmpRow label="GK Saves" home={fmt(h("avg_goalkeeper_saves"))} away={fmt(a("avg_goalkeeper_saves"))} />
          <CmpRow label="Goals Prevented" home={fmt(h("avg_goals_prevented"))} away={fmt(a("avg_goals_prevented"))} />
          <View style={styles.groupLabel}><Text style={styles.groupLabelText}>Last 15 Totals</Text></View>
          <CmpRow label="Total Goals Scored" home={h("goals_for") != null ? String(h("goals_for")) : "—"} away={a("goals_for") != null ? String(a("goals_for")) : "—"} highlight />
          <CmpRow label="Total Goals Conceded" home={h("goals_against") != null ? String(h("goals_against")) : "—"} away={a("goals_against") != null ? String(a("goals_against")) : "—"} />
          <CmpRow label="Total Clean Sheets" home={h("clean_sheets") != null ? String(h("clean_sheets")) : "—"} away={a("clean_sheets") != null ? String(a("clean_sheets")) : "—"} />

          {/* ── 1st Half Stats ── */}
          <SectionHeader label="Avg 1st Half Stats" />
          <View style={styles.statsLabelRow}>
            <Text style={[styles.statsLabelText, styles.homeCol]}>Home</Text>
            <Text style={styles.cmpLabel}>Stat</Text>
            <Text style={[styles.statsLabelText, styles.awayCol]}>Away</Text>
          </View>
          <CmpRow label="Goals Scored" home={fmt(item.home_h1_avg_goals_scored)} away={fmt(item.away_h1_avg_goals_scored)} highlight />
          <CmpRow label="Goals Conceded" home={fmt(item.home_h1_avg_goals_conceded)} away={fmt(item.away_h1_avg_goals_conceded)} />
          <CmpRow label="xG" home={fmt(item.home_h1_avg_xg)} away={fmt(item.away_h1_avg_xg)} />
          <CmpRow label="Possession" home={fmtPct(item.home_h1_avg_possession)} away={fmtPct(item.away_h1_avg_possession)} />
          <CmpRow label="Big Chances" home={fmt(item.home_h1_avg_big_chances)} away={fmt(item.away_h1_avg_big_chances)} />
          <CmpRow label="Total Shots" home={fmt(item.home_h1_avg_total_shots)} away={fmt(item.away_h1_avg_total_shots)} />
          <CmpRow label="Pass Accuracy" home={item.home_h1_avg_pass_accuracy != null ? fmtPct(item.home_h1_avg_pass_accuracy) : "—"} away={item.away_h1_avg_pass_accuracy != null ? fmtPct(item.away_h1_avg_pass_accuracy) : "—"} />
          <CmpRow label="Total Passes" home={fmt(item.home_h1_avg_total_passes, 0)} away={fmt(item.away_h1_avg_total_passes, 0)} />

          {/* ── 2nd Half Stats ── */}
          <SectionHeader label="Avg 2nd Half Stats" />
          <View style={styles.statsLabelRow}>
            <Text style={[styles.statsLabelText, styles.homeCol]}>Home</Text>
            <Text style={styles.cmpLabel}>Stat</Text>
            <Text style={[styles.statsLabelText, styles.awayCol]}>Away</Text>
          </View>
          <CmpRow label="Goals Scored" home={fmt(item.home_h2_avg_goals_scored)} away={fmt(item.away_h2_avg_goals_scored)} highlight />
          <CmpRow label="Goals Conceded" home={fmt(item.home_h2_avg_goals_conceded)} away={fmt(item.away_h2_avg_goals_conceded)} />
          <CmpRow label="xG" home={fmt(item.home_h2_avg_xg)} away={fmt(item.away_h2_avg_xg)} />
          <CmpRow label="Possession" home={fmtPct(item.home_h2_avg_possession)} away={fmtPct(item.away_h2_avg_possession)} />
          <CmpRow label="Big Chances" home={fmt(item.home_h2_avg_big_chances)} away={fmt(item.away_h2_avg_big_chances)} />
          <CmpRow label="Total Shots" home={fmt(item.home_h2_avg_total_shots)} away={fmt(item.away_h2_avg_total_shots)} />
          <CmpRow label="Pass Accuracy" home={item.home_h2_avg_pass_accuracy != null ? fmtPct(item.home_h2_avg_pass_accuracy) : "—"} away={item.away_h2_avg_pass_accuracy != null ? fmtPct(item.away_h2_avg_pass_accuracy) : "—"} />
          <CmpRow label="Total Passes" home={fmt(item.home_h2_avg_total_passes, 0)} away={fmt(item.away_h2_avg_total_passes, 0)} />

          {/* Delete */}
          <TouchableOpacity onPress={confirmDelete} style={styles.deleteBtn} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={14} color="#f87171" />
            <Text style={styles.deleteBtnText}>Delete record</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function DatabaseScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearch = useCallback((text: string) => {
    setSearch(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(text), 400);
  }, []);

  const { data, isLoading, refetch, isRefetching } = useQuery<{ matches: M[]; total: number }>({
    queryKey: ["/api/database/matches", debounced],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: "200" });
      if (debounced) p.set("search", debounced);
      const res = await fetch(new URL(`/api/database/matches?${p}`, base()).href);
      return res.json();
    },
  });

  const { data: stats } = useQuery<{ total: number; byResult: { result: string; c: number }[] }>({
    queryKey: ["/api/database/stats"],
    queryFn: async () => {
      const res = await fetch(new URL("/api/database/stats", base()).href);
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const res = await fetch(new URL(`/api/database/match/${eventId}`, base()).href, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/database/matches"] });
      qc.invalidateQueries({ queryKey: ["/api/database/stats"] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(new URL("/api/database/clear-all", base()).href, { method: "DELETE" });
      if (!res.ok) throw new Error("Clear failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/database/matches"] });
      qc.invalidateQueries({ queryKey: ["/api/database/stats"] });
    },
  });

  function confirmClearAll() {
    if (Platform.OS === "web") {
      if (window.confirm("Are you sure you want to delete ALL records from the database? This action cannot be undone.")) {
        clearAllMutation.mutate();
      }
    } else {
      Alert.alert(
        "Clear Entire Database",
        "This will permanently delete ALL stored match records. This action cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete All", style: "destructive", onPress: () => clearAllMutation.mutate() },
        ]
      );
    }
  }

  const matches = data?.matches || [];
  const total = stats?.total ?? 0;
  const homeWins = stats?.byResult.find((r) => r.result === "H")?.c ?? 0;
  const draws = stats?.byResult.find((r) => r.result === "D")?.c ?? 0;
  const awayWins = stats?.byResult.find((r) => r.result === "A")?.c ?? 0;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Database</Text>
            <Text style={styles.subtitle}>{total} matches stored</Text>
          </View>
          {total > 0 && (
            <TouchableOpacity onPress={confirmClearAll} style={styles.clearAllBtn} activeOpacity={0.7} disabled={clearAllMutation.isPending}>
              {clearAllMutation.isPending ? (
                <ActivityIndicator size="small" color="#f87171" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={14} color="#f87171" />
                  <Text style={styles.clearAllBtnText}>Clear All</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {total > 0 && (
        <View style={styles.summaryRow}>
          {[
            { label: "Home Wins", count: homeWins, color: "#4ade80", bg: "#16a34a22" },
            { label: "Draws", count: draws, color: "#facc15", bg: "#ca8a0422" },
            { label: "Away Wins", count: awayWins, color: "#f87171", bg: "#dc262622" },
          ].map(({ label, count, color, bg }) => (
            <View key={label} style={[styles.summaryBadge, { backgroundColor: bg }]}>
              <Text style={[styles.summaryNum, { color }]}>{count}</Text>
              <Text style={styles.summaryLbl}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color="#6b7280" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={onSearch}
          placeholder="Search teams or tournament..."
          placeholderTextColor="#6b7280"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => { setSearch(""); setDebounced(""); }}>
            <Ionicons name="close-circle" size={18} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color="#3b82f6" /></View>
      ) : matches.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="server-outline" size={48} color="#374151" />
          <Text style={styles.emptyText}>No matches stored yet</Text>
          <Text style={styles.emptySubtext}>Use the Processing tab to bulk upload match data</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => String(item.event_id)}
          renderItem={({ item }) => (
            <MatchCard item={item} onDelete={(id) => deleteMutation.mutate(id)} />
          )}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: botPad + 100, paddingTop: 8 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#3b82f6" />}
          ListHeaderComponent={
            <Text style={styles.countText}>
              Showing {matches.length}{data?.total && data.total > matches.length ? ` of ${data.total}` : ""} records
            </Text>
          }
        />
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f0f" },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 24, fontWeight: "700", color: "#f9fafb" },
  subtitle: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  clearAllBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#2d1212", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: "#7f1d1d",
  },
  clearAllBtnText: { fontSize: 13, fontWeight: "600", color: "#f87171" },

  summaryRow: { flexDirection: "row", paddingHorizontal: 14, gap: 8, marginBottom: 8 },
  summaryBadge: { flex: 1, borderRadius: 10, padding: 10, alignItems: "center" },
  summaryNum: { fontSize: 20, fontWeight: "700" },
  summaryLbl: { fontSize: 11, color: "#9ca3af", marginTop: 2 },

  searchRow: {
    flexDirection: "row", alignItems: "center", marginHorizontal: 14, marginBottom: 8,
    backgroundColor: "#1f2937", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchInput: { flex: 1, color: "#f9fafb", fontSize: 14 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { color: "#9ca3af", fontSize: 16, fontWeight: "600" },
  emptySubtext: { color: "#6b7280", fontSize: 13, textAlign: "center", paddingHorizontal: 32 },
  countText: { fontSize: 12, color: "#6b7280", marginBottom: 8 },

  // Card
  card: {
    backgroundColor: "#111827", borderRadius: 12, marginBottom: 10,
    borderWidth: 1, borderColor: "#1f2937", overflow: "hidden",
  },
  cardHeader: { padding: 13 },
  cardMain: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 5 },
  resultDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  resultDotText: { fontSize: 10, fontWeight: "700", color: "#000" },
  teamsRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  teamName: { fontSize: 12, fontWeight: "600", color: "#e5e7eb", flex: 1 },
  score: { fontSize: 15, fontWeight: "700", color: "#f9fafb", paddingHorizontal: 8 },
  cardMeta: { flexDirection: "row", justifyContent: "space-between" },
  metaText: { fontSize: 11, color: "#6b7280" },

  // Expanded
  expandedScroll: { maxHeight: 600, borderTopWidth: 1, borderTopColor: "#1f2937" },

  teamHeaderRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: "#0f172a",
  },
  teamHeaderName: { fontSize: 12, fontWeight: "700", color: "#93c5fd" },

  sectionHeader: {
    backgroundColor: "#0f172a", paddingHorizontal: 12, paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: "#1e3a5f33",
  },
  sectionHeaderText: { fontSize: 11, fontWeight: "700", color: "#60a5fa", textTransform: "uppercase", letterSpacing: 0.5 },

  // Strength rows
  strengthRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1f2937",
  },
  strengthBarSide: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  strengthBarBg: { flex: 1, height: 4, backgroundColor: "#1f2937", borderRadius: 2, overflow: "hidden" },
  strengthBarFill: { height: "100%", borderRadius: 2 },
  strengthBarHome: { backgroundColor: "#3b82f6", alignSelf: "flex-start" },
  strengthBarAway: { backgroundColor: "#ef4444", alignSelf: "flex-end" },
  strengthNum: { fontSize: 13, fontWeight: "700", minWidth: 28 },
  homeNum: { color: "#60a5fa", textAlign: "right" },
  awayNum: { color: "#f87171", textAlign: "left" },
  strengthLabelCol: { width: 120, alignItems: "center", paddingHorizontal: 4 },
  strengthLabel: { fontSize: 12, fontWeight: "600", color: "#d1d5db", textAlign: "center" },
  strengthNote: { fontSize: 9, color: "#6b7280", textAlign: "center", marginTop: 1 },

  // Form summary
  formSummaryBox: { backgroundColor: "#0a0f1a", paddingHorizontal: 12, paddingVertical: 10 },
  formSummaryLine: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 5 },
  formSummaryTeam: { fontSize: 12, fontWeight: "700", color: "#9ca3af", width: 70 },
  formSummaryStats: { fontSize: 11, color: "#6b7280", flex: 1 },
  formInline: { flexDirection: "row", gap: 2 },
  formRow: { flexDirection: "row", gap: 2 },
  formChar: { fontSize: 11, fontWeight: "700" },
  formDash: { fontSize: 11, color: "#6b7280" },

  // Stats table
  statsLabelRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: "#0f172a",
  },
  statsLabelText: { fontSize: 11, fontWeight: "600", color: "#6b7280" },
  groupLabel: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 3 },
  groupLabelText: { fontSize: 10, fontWeight: "700", color: "#4b5563", textTransform: "uppercase", letterSpacing: 0.5 },

  cmpRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1f2937",
  },
  cmpRowHighlight: { backgroundColor: "#0f1f0f" },
  cmpVal: { fontSize: 13, fontWeight: "600", color: "#f9fafb", minWidth: 44 },
  cmpLabel: { fontSize: 12, color: "#9ca3af", textAlign: "center" },
  cmpNote: { fontSize: 10, color: "#6b7280", textAlign: "center" },
  cmpLabelCol: { flex: 1, alignItems: "center" },
  homeCol: { textAlign: "left", color: "#60a5fa" },
  awayCol: { textAlign: "right", color: "#f87171" },

  deleteBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    margin: 12, alignSelf: "flex-end",
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 6, backgroundColor: "#1f1414",
    borderWidth: 1, borderColor: "#7f1d1d",
  },
  deleteBtnText: { fontSize: 12, color: "#f87171", fontWeight: "600" },

  // Match summary
  matchSummaryBox: { backgroundColor: "#080d18" },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 10, paddingBottom: 10 },
  summaryCell: {
    width: "50%", paddingHorizontal: 4, paddingVertical: 6,
  },
  summaryCellLabel: { fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
  summaryCellValue: { fontSize: 15, fontWeight: "700", color: "#f9fafb" },
});
