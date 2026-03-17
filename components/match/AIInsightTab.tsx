import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";

interface Prediction {
  market: string;
  pick: string;
  confidence: number;
  reasoning: string;
}

interface TeamAnalysis {
  form: string;
  strengths: string[];
  weaknesses: string[];
  keyTrend: string;
}

interface BestBet {
  market: string;
  pick: string;
  confidence: number;
  reasoning: string;
}

interface AIAnalysis {
  summary: string;
  homeTeamAnalysis: TeamAnalysis;
  awayTeamAnalysis: TeamAnalysis;
  predictions: Prediction[];
  bestBet: BestBet;
  riskFactors: string[];
  dataConfidence: string;
}

interface AIInsightTabProps {
  eventId: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  tournamentName: string;
}

function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 75
      ? "#22c55e"
      : value >= 60
      ? "#eab308"
      : "#f97316";
  return (
    <View style={styles.confBarBg}>
      <View style={[styles.confBarFill, { width: `${value}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function PredictionCard({ pred }: { pred: Prediction }) {
  const [expanded, setExpanded] = useState(false);
  const confColor =
    pred.confidence >= 75
      ? "#22c55e"
      : pred.confidence >= 60
      ? "#eab308"
      : "#f97316";
  return (
    <TouchableOpacity
      style={styles.predCard}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.8}
    >
      <View style={styles.predHeader}>
        <View style={styles.predLeft}>
          <Text style={styles.predMarket}>{pred.market}</Text>
          <Text style={styles.predPick}>{pred.pick}</Text>
        </View>
        <View style={styles.predRight}>
          <Text style={[styles.predConf, { color: confColor }]}>{pred.confidence}%</Text>
          <Text style={styles.expandHint}>{expanded ? "▲" : "▼"}</Text>
        </View>
      </View>
      <ConfidenceBar value={pred.confidence} />
      {expanded && (
        <Text style={styles.predReasoning}>{pred.reasoning}</Text>
      )}
    </TouchableOpacity>
  );
}

function TeamCard({ name, analysis }: { name: string; analysis: TeamAnalysis }) {
  return (
    <View style={styles.teamCard}>
      <Text style={styles.teamCardTitle}>{name}</Text>
      <Text style={styles.teamFormText}>{analysis.form}</Text>
      <View style={styles.teamCardRow}>
        <View style={[styles.teamCardHalf, { marginRight: 6 }]}>
          <Text style={[styles.teamSectionLabel, { color: "#22c55e" }]}>Strengths</Text>
          {(analysis.strengths || []).map((s, i) => (
            <Text key={i} style={styles.bulletItem}>• {s}</Text>
          ))}
        </View>
        <View style={styles.teamCardHalf}>
          <Text style={[styles.teamSectionLabel, { color: "#f87171" }]}>Weaknesses</Text>
          {(analysis.weaknesses || []).map((w, i) => (
            <Text key={i} style={styles.bulletItem}>• {w}</Text>
          ))}
        </View>
      </View>
      {analysis.keyTrend ? (
        <View style={styles.keyTrendBox}>
          <Text style={styles.keyTrendLabel}>Key Trend</Text>
          <Text style={styles.keyTrendText}>{analysis.keyTrend}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function AIInsightTab({
  eventId,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  tournamentName,
}: AIInsightTabProps) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataStats, setDataStats] = useState<any>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const base = getApiUrl();
      const params = new URLSearchParams({
        eventId,
        homeTeamId: homeTeamId.toString(),
        awayTeamId: awayTeamId.toString(),
        homeTeamName,
        awayTeamName,
        tournamentName,
      });
      const url = `${base}api/ai-insight?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      setAnalysis(data.analysis);
      setDataStats(data.dataStats);
    } catch (e: any) {
      setError(e.message || "Failed to generate analysis");
    } finally {
      setLoading(false);
    }
  }, [eventId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, tournamentName]);

  if (!analysis && !loading && !error) {
    return (
      <View style={styles.idleContainer}>
        <Text style={styles.idleIcon}>🤖</Text>
        <Text style={styles.idleTitle}>AI Match Insight</Text>
        <Text style={styles.idleSubtitle}>
          Deep reasoning analysis of the last 15 matches for both teams. The AI evaluates form, opponent quality, goals patterns, home/away splits, and odds to find profitable betting markets.
        </Text>
        <TouchableOpacity style={styles.generateBtn} onPress={generate} activeOpacity={0.8}>
          <Text style={styles.generateBtnText}>Generate AI Analysis</Text>
        </TouchableOpacity>
        <Text style={styles.idleDisclaimer}>
          Powered by o4-mini reasoning model · Takes 15–30 seconds
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
        <Text style={styles.loadingTitle}>Analysing {homeTeamName} vs {awayTeamName}</Text>
        <Text style={styles.loadingSubtitle}>
          Reviewing last 15 matches for both teams, computing stats, evaluating opponent quality and market value…
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.idleContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.generateBtn} onPress={generate} activeOpacity={0.8}>
          <Text style={styles.generateBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!analysis) return null;

  const bestBetColor =
    (analysis.bestBet?.confidence || 0) >= 75
      ? "#22c55e"
      : (analysis.bestBet?.confidence || 0) >= 60
      ? "#eab308"
      : "#f97316";

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {dataStats && (
        <View style={styles.dataBar}>
          <Text style={styles.dataBarText}>
            {homeTeamName}: {dataStats.homeMatchesAnalyzed} matches · {awayTeamName}: {dataStats.awayMatchesAnalyzed} matches
          </Text>
          <Text style={[styles.dataConfBadge, {
            color: analysis.dataConfidence === "High" ? "#22c55e" : analysis.dataConfidence === "Medium" ? "#eab308" : "#f87171"
          }]}>
            {analysis.dataConfidence} confidence
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Match Overview</Text>
        <Text style={styles.summaryText}>{analysis.summary}</Text>
      </View>

      {analysis.bestBet && (
        <View style={[styles.bestBetCard, { borderColor: bestBetColor }]}>
          <View style={styles.bestBetHeader}>
            <Text style={styles.bestBetLabel}>⭐ Best Bet</Text>
            <Text style={[styles.bestBetConf, { color: bestBetColor }]}>
              {analysis.bestBet.confidence}% confidence
            </Text>
          </View>
          <Text style={styles.bestBetMarket}>{analysis.bestBet.market}</Text>
          <Text style={[styles.bestBetPick, { color: bestBetColor }]}>{analysis.bestBet.pick}</Text>
          <ConfidenceBar value={analysis.bestBet.confidence} />
          <Text style={styles.bestBetReasoning}>{analysis.bestBet.reasoning}</Text>
        </View>
      )}

      <Text style={styles.sectionHeading}>Team Analysis</Text>
      {analysis.homeTeamAnalysis && (
        <TeamCard name={homeTeamName} analysis={analysis.homeTeamAnalysis} />
      )}
      {analysis.awayTeamAnalysis && (
        <TeamCard name={awayTeamName} analysis={analysis.awayTeamAnalysis} />
      )}

      <Text style={styles.sectionHeading}>Betting Markets</Text>
      <Text style={styles.tapHint}>Tap a market to see the full reasoning</Text>
      {(analysis.predictions || []).map((pred, i) => (
        <PredictionCard key={i} pred={pred} />
      ))}

      {(analysis.riskFactors || []).length > 0 && (
        <View style={styles.riskCard}>
          <Text style={styles.riskTitle}>⚠️ Risk Factors</Text>
          {(analysis.riskFactors || []).map((r, i) => (
            <Text key={i} style={styles.riskItem}>• {r}</Text>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.regenBtn} onPress={generate} activeOpacity={0.8}>
        <Text style={styles.regenBtnText}>Regenerate Analysis</Text>
      </TouchableOpacity>

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          For informational purposes only. Betting involves risk. Always gamble responsibly.
        </Text>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  idleContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  idleIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  idleTitle: {
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginBottom: 12,
    textAlign: "center",
  },
  idleSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 28,
  },
  generateBtn: {
    backgroundColor: Colors.dark.accent,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  generateBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#ffffff",
  },
  idleDisclaimer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    textAlign: "center",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  loadingTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginTop: 20,
    marginBottom: 10,
    textAlign: "center",
  },
  loadingSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  errorIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#f87171",
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 20,
  },
  dataBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.dark.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 8,
  },
  dataBarText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    flex: 1,
  },
  dataConfBadge: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 10,
    padding: 14,
  },
  cardLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  summaryText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.text,
    lineHeight: 22,
  },
  bestBetCard: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1.5,
  },
  bestBetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  bestBetLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  bestBetConf: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  bestBetMarket: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    marginBottom: 4,
  },
  bestBetPick: {
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 10,
  },
  bestBetReasoning: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 20,
    marginTop: 10,
  },
  sectionHeading: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginHorizontal: 14,
    marginTop: 18,
    marginBottom: 6,
  },
  tapHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    marginHorizontal: 14,
    marginBottom: 6,
  },
  predCard: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginBottom: 6,
    borderRadius: 10,
    padding: 12,
  },
  predHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  predLeft: {
    flex: 1,
    marginRight: 12,
  },
  predMarket: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    marginBottom: 2,
  },
  predPick: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
  },
  predRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  predConf: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  expandHint: {
    fontSize: 10,
    color: Colors.dark.textTertiary,
  },
  predReasoning: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 20,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.dark.border,
  },
  confBarBg: {
    height: 3,
    backgroundColor: Colors.dark.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  confBarFill: {
    height: 3,
    borderRadius: 2,
  },
  teamCard: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginBottom: 6,
    borderRadius: 10,
    padding: 14,
  },
  teamCardTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.text,
    marginBottom: 6,
  },
  teamFormText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 19,
    marginBottom: 10,
  },
  teamCardRow: {
    flexDirection: "row",
  },
  teamCardHalf: {
    flex: 1,
  },
  teamSectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  bulletItem: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  keyTrendBox: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 6,
    padding: 10,
    marginTop: 10,
  },
  keyTrendLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.accent,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  keyTrendText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.text,
    lineHeight: 18,
  },
  riskCard: {
    backgroundColor: Colors.dark.card,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: "#f87171",
  },
  riskTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#f87171",
    marginBottom: 8,
  },
  riskItem: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textSecondary,
    lineHeight: 20,
  },
  regenBtn: {
    marginHorizontal: 8,
    marginTop: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  regenBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dark.textSecondary,
  },
  disclaimer: {
    marginHorizontal: 14,
    marginTop: 14,
  },
  disclaimerText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.dark.textTertiary,
    textAlign: "center",
    lineHeight: 16,
  },
});
