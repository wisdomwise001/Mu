import React, { useState, useRef, useEffect } from "react";
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

// ── Types ─────────────────────────────────────────────────────────────────────
interface CompletenessReport {
  score: number;
  tier: string;
  tierLabel: string;
  presentCount: number;
  totalCount: number;
  missingCritical: string[];
  message: string;
}

interface IdentityLayer {
  label: string;
  confidence: number;
  detail: string;
  signals: string[];
}

interface MatchIdentity {
  winner: IdentityLayer;
  goalRange: IdentityLayer;
  btts: IdentityLayer;
  tempo: IdentityLayer;
  risk: IdentityLayer;
  overallGoalExpectancy: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
}

interface BucketFamily {
  id: string;
  label: string;
  description: string;
  psychology: string;
}

interface ContradictionFlag {
  type: string;
  severity: string;
  description: string;
  affectedScores: string[];
  confidenceReduction: number;
}

interface FamilyClassification {
  primaryFamily: BucketFamily;
  primaryScore: number;
  secondaryFamily: BucketFamily | null;
  secondaryScore: number;
  contradictions: ContradictionFlag[];
  eligibleBuckets: string[];
}

interface OutlierAssessment {
  group: string;
  groupLabel: string;
  confidence: number;
  chaosIndex: number;
  dominanceGap: number;
  xgAccuracy: number;
  reasoning: string[];
}

interface PsychSignal {
  kind: string;
  label: string;
  effect: string;
  magnitude: number;
  detail: string;
}

interface PsychContext {
  signals: PsychSignal[];
  goalBoost: number;
  homeAdvantageBoost: number;
  suppressionFactor: number;
  psychLabel: string;
}

interface ScorelinePrediction {
  scoreline: string;
  homeGoals: number;
  awayGoals: number;
  outcome: "Home Win" | "Away Win" | "Draw";
  confidence: number;
  bucketConfidence: number;
  familySupport: number;
  contradictionPenalty: number;
  isTopPick: boolean;
  reasoning: string[];
}

interface MarketPredictions {
  homeWin: { probability: number; confidence: string };
  draw:    { probability: number; confidence: string };
  awayWin: { probability: number; confidence: string };
  btts:    { prediction: string; probability: number };
  over25:  { prediction: string; probability: number };
  over35:  { prediction: string; probability: number };
  correctScore: { score: string; confidence: number };
}

interface HierarchicalResult {
  eventId: number;
  computedAt: string;
  stage1_completeness: CompletenessReport;
  stage2_identity: MatchIdentity;
  stage3_family: FamilyClassification;
  stage4_outlier: OutlierAssessment;
  stage5_psych: PsychContext;
  primaryPrediction: ScorelinePrediction;
  secondaryPrediction: ScorelinePrediction | null;
  top5: ScorelinePrediction[];
  markets: MarketPredictions;
  modelsUsed: number;
  dataSource: string;
  overallConfidence: number;
  processingMs: number;
  // New intelligence layers
  behavioral?: BehavioralOutput | null;
  scoreValidations?: ScoreValidationItem[];
  butterflyEffect?: ButterflyEffectData | null;
  extendedMarkets?: ExtendedMarketsData | null;
}

// ── New types for intelligence layers ─────────────────────────────────────────
interface ScoreValidationItem {
  scoreline: string;
  homeGoals: number;
  awayGoals: number;
  homeExpected: number;
  awayExpected: number;
  homePoisson: number;
  awayPoisson: number;
  combinedPoisson: number;
  achievabilityScore: number;
  validated: boolean;
  flipPotential: number;
  flipSide: string;
  flipSignals: string[];
  riskFactors: string[];
  label: string;
}

interface ButterflyEffectData {
  upsetPotential: number;
  upsetLabel: string;
  upsetSignals: string[];
  goalInflationRisk: number;
  goalInflationLabel: string;
  goalInflationSignals: string[];
  bttsFlipRisk: number;
  bttsFlipLabel: string;
  bttsFlipSignals: string[];
  overallChaosIndex: number;
  chaosLabel: string;
  chaosColor: string;
}

interface ExtendedMarketsData {
  homeWin:    { probability: number; prediction: string; label: string };
  draw:       { probability: number; prediction: string; label: string };
  awayWin:    { probability: number; prediction: string; label: string };
  x1:         { probability: number; prediction: string; label: string };
  x2:         { probability: number; prediction: string; label: string };
  homeOrAway: { probability: number; prediction: string; label: string };
  over25:     { probability: number; prediction: string; label: string };
  over35:     { probability: number; prediction: string; label: string };
  btts:       { probability: number; prediction: string; label: string };
  firstToScore: { homeProbability: number; awayProbability: number; noGoalProbability: number; prediction: string };
  home2Plus:  { probability: number; prediction: string; label: string };
  away2Plus:  { probability: number; prediction: string; label: string };
  drawProbability: number;
  drawIntelligence: { isLikelyDraw: boolean; drawScore: number; signals: string[] };
}

interface BehavioralOutput {
  winner:   { label: string; probs: Record<string, number>; confidence: number };
  goalRange:{ label: string; probs: Record<string, number>; confidence: number };
  btts:     { label: string; probs: Record<string, number>; confidence: number };
  tempo:    { label: string; probs: Record<string, number>; confidence: number };
  drawClassifier: { drawProbability: number; nonDrawProbability: number; confidence: number; available: boolean };
  family:   { label: string; id: string; probs: Record<string, number>; confidence: number };
  exactScores: Array<{ scoreline: string; homeGoals: number; awayGoals: number; finalConfidence: number; outcome: string }>;
  contradictions: string[];
  calibratedConfidence: number;
  completenessScore: number;
}

// ── Tiny animated progress bar ────────────────────────────────────────────────
function AnimBar({ pct, color, delay = 0 }: { pct: number; color: string; delay?: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: 700, delay, useNativeDriver: false }).start();
  }, [pct]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] });
  return (
    <View style={s.barTrack}>
      <Animated.View style={[s.barFill, { width, backgroundColor: color }]} />
    </View>
  );
}

// ── Confidence pill ───────────────────────────────────────────────────────────
function ConfPill({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const color = value >= 70 ? "#4ade80" : value >= 50 ? "#f59e0b" : "#f87171";
  return (
    <View style={[s.confPill, { backgroundColor: color + "22", borderColor: color + "44" }]}>
      <Text style={[s.confPillText, { color, fontSize: size === "sm" ? 10 : 12 }]}>
        {value}%
      </Text>
    </View>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function StageHeader({
  stage,
  title,
  badge,
  badgeColor,
}: {
  stage: string;
  title: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <View style={s.stageHeader}>
      <View style={s.stagePill}>
        <Text style={s.stagePillText}>{stage}</Text>
      </View>
      <Text style={s.stageTitle}>{title}</Text>
      {badge && (
        <View style={[s.stageBadge, { backgroundColor: (badgeColor ?? Colors.dark.accent) + "22" }]}>
          <Text style={[s.stageBadgeText, { color: badgeColor ?? Colors.dark.accent }]}>{badge}</Text>
        </View>
      )}
    </View>
  );
}

// ── Stage 1: Completeness Card ────────────────────────────────────────────────
function CompletenessCard({ data }: { data: CompletenessReport }) {
  const tierColors: Record<string, string> = {
    strong: "#4ade80",
    reliable: "#3D7BF4",
    moderate: "#f59e0b",
    unstable: "#f87171",
  };
  const color = tierColors[data.tier] ?? Colors.dark.accent;

  return (
    <View style={[s.card, { borderColor: color + "40" }]}>
      <StageHeader stage="Stage 1" title="Data Completeness" badge={data.tierLabel} badgeColor={color} />
      <View style={s.completenessRow}>
        <View style={s.completenessGauge}>
          <Text style={[s.completenessScore, { color }]}>{data.score}%</Text>
          <Text style={s.completenessLabel}>{data.presentCount}/{data.totalCount} features</Text>
        </View>
        <View style={{ flex: 1 }}>
          <AnimBar pct={data.score} color={color} />
          <Text style={s.smallText}>{data.message}</Text>
        </View>
      </View>
      {data.missingCritical.length > 0 && (
        <View style={s.missingRow}>
          <Ionicons name="warning-outline" size={12} color="#f87171" />
          <Text style={s.missingText} numberOfLines={2}>
            Missing: {data.missingCritical.slice(0, 3).join(", ")}
            {data.missingCritical.length > 3 ? ` +${data.missingCritical.length - 3} more` : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Identity Layer Row ────────────────────────────────────────────────────────
const WINNER_META: Record<string, { label: string; color: string; icon: string }> = {
  home_favored: { label: "Home Favored",  color: "#3D7BF4", icon: "home" },
  away_favored: { label: "Away Favored",  color: "#f59e0b", icon: "airplane" },
  even:         { label: "Evenly Matched",color: "#8C8D96", icon: "remove-circle" },
};
const GOAL_META: Record<string, { label: string; color: string }> = {
  very_low: { label: "Very Low (0-1 goals)", color: "#8C8D96" },
  low:      { label: "Low (1-2 goals)",      color: "#71717a" },
  medium:   { label: "Medium (2-3 goals)",   color: "#3D7BF4" },
  high:     { label: "High (3-4 goals)",     color: "#f59e0b" },
  very_high:{ label: "Very High (4+ goals)", color: "#f87171" },
};
const BTTS_META: Record<string, { label: string; color: string }> = {
  yes:         { label: "BTTS: Yes",     color: "#4ade80" },
  no:          { label: "BTTS: No",      color: "#f87171" },
  fifty_fifty: { label: "BTTS: 50/50",   color: "#f59e0b" },
};
const TEMPO_META: Record<string, { label: string; color: string }> = {
  open:        { label: "Open Game",     color: "#f59e0b" },
  controlled:  { label: "Controlled",    color: "#3D7BF4" },
  defensive:   { label: "Defensive",     color: "#8C8D96" },
};
const RISK_META: Record<string, { label: string; color: string }> = {
  aggressive:  { label: "Aggressive",    color: "#f87171" },
  balanced:    { label: "Balanced",      color: "#3D7BF4" },
  conservative:{ label: "Conservative",  color: "#4ade80" },
};

function IdentityRow({
  layerName,
  layer,
  meta,
}: {
  layerName: string;
  layer: IdentityLayer;
  meta: { label: string; color: string };
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TouchableOpacity style={s.identityRow} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
      <View style={s.identityLeft}>
        <Text style={s.identityLayerName}>{layerName}</Text>
        <Text style={[s.identityLabel, { color: meta.color }]}>{meta.label}</Text>
      </View>
      <View style={s.identityRight}>
        <ConfPill value={layer.confidence} size="sm" />
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={12} color={Colors.dark.textTertiary} />
      </View>
      {expanded && (
        <View style={s.identityExpanded}>
          <Text style={s.identityDetail}>{layer.detail}</Text>
          {layer.signals.map((sig, i) => (
            <View key={i} style={s.identitySignal}>
              <View style={[s.signalDot, { backgroundColor: meta.color }]} />
              <Text style={s.identitySignalText}>{sig}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

function IdentityCard({ identity, homeTeamName, awayTeamName }: {
  identity: MatchIdentity;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const winMeta = WINNER_META[identity.winner.label] ?? { label: identity.winner.label, color: Colors.dark.accent, icon: "help" };
  const goalMeta = GOAL_META[identity.goalRange.label] ?? { label: identity.goalRange.label, color: Colors.dark.accent };
  const bttsMeta = BTTS_META[identity.btts.label] ?? { label: identity.btts.label, color: Colors.dark.accent };
  const tempoMeta = TEMPO_META[identity.tempo.label] ?? { label: identity.tempo.label, color: Colors.dark.accent };
  const riskMeta = RISK_META[identity.risk.label] ?? { label: identity.risk.label, color: Colors.dark.accent };

  return (
    <View style={s.card}>
      <StageHeader stage="Stage 2" title="Pre-Match Identity" />
      {/* Expected goals summary */}
      <View style={s.xgRow}>
        <View style={s.xgBlock}>
          <Text style={[s.xgValue, { color: "#3D7BF4" }]}>{identity.expectedHomeGoals.toFixed(2)}</Text>
          <Text style={s.xgLabel} numberOfLines={1}>{homeTeamName}</Text>
        </View>
        <View style={s.xgCenter}>
          <Text style={s.xgTotal}>{identity.overallGoalExpectancy.toFixed(2)}</Text>
          <Text style={s.xgTotalLabel}>exp goals</Text>
        </View>
        <View style={s.xgBlock}>
          <Text style={[s.xgValue, { color: "#f59e0b" }]}>{identity.expectedAwayGoals.toFixed(2)}</Text>
          <Text style={s.xgLabel} numberOfLines={1}>{awayTeamName}</Text>
        </View>
      </View>

      <IdentityRow layerName="Winner" layer={identity.winner} meta={winMeta} />
      <IdentityRow layerName="Goal Range" layer={identity.goalRange} meta={goalMeta} />
      <IdentityRow layerName="BTTS" layer={identity.btts} meta={bttsMeta} />
      <IdentityRow layerName="Tempo" layer={identity.tempo} meta={tempoMeta} />
      <IdentityRow layerName="Risk Profile" layer={identity.risk} meta={riskMeta} />
    </View>
  );
}

// ── Stage 3: Bucket Family Card ───────────────────────────────────────────────
const FAMILY_COLORS: Record<string, string> = {
  low_defensive: "#8C8D96",
  balanced_btts: "#3D7BF4",
  open_high:     "#f59e0b",
  dominant_home: "#4ade80",
  dominant_away: "#f87171",
  chaotic:       "#a78bfa",
};

function FamilyCard({ family }: { family: FamilyClassification }) {
  const [showContradictions, setShowContradictions] = useState(false);
  const primaryColor = FAMILY_COLORS[family.primaryFamily.id] ?? Colors.dark.accent;
  const secondaryColor = family.secondaryFamily ? (FAMILY_COLORS[family.secondaryFamily.id] ?? Colors.dark.textSecondary) : Colors.dark.textSecondary;

  return (
    <View style={[s.card, { borderColor: primaryColor + "40" }]}>
      <StageHeader stage="Stage 3" title="Bucket Family" />
      <View style={s.familyPrimary}>
        <View style={[s.familyIcon, { backgroundColor: primaryColor + "22" }]}>
          <View style={[s.familyDot, { backgroundColor: primaryColor }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.familyLabel, { color: primaryColor }]}>{family.primaryFamily.label}</Text>
          <Text style={s.familyDesc}>{family.primaryFamily.description}</Text>
        </View>
        <ConfPill value={Math.round(family.primaryScore * 100)} />
      </View>
      <Text style={s.familyPsych}>{family.primaryFamily.psychology}</Text>

      {family.secondaryFamily && (
        <View style={s.familySecondary}>
          <View style={[s.familyDot, { backgroundColor: secondaryColor, marginRight: 8 }]} />
          <Text style={[s.familySecondaryLabel, { color: secondaryColor }]}>
            Secondary: {family.secondaryFamily.label}
          </Text>
          <Text style={s.familySecondaryConf}> ({Math.round(family.secondaryScore * 100)}%)</Text>
        </View>
      )}

      {/* Eligible bucket chips */}
      <View style={s.chipsRow}>
        {family.eligibleBuckets.map((b) => (
          <View key={b} style={[s.chip, { borderColor: primaryColor + "50" }]}>
            <Text style={[s.chipText, { color: primaryColor }]}>{b}</Text>
          </View>
        ))}
      </View>

      {/* Contradictions */}
      {family.contradictions.length > 0 && (
        <TouchableOpacity style={s.contradictionToggle} onPress={() => setShowContradictions(!showContradictions)}>
          <Ionicons name="warning" size={12} color="#f59e0b" />
          <Text style={s.contradictionToggleText}>
            {family.contradictions.length} contradiction{family.contradictions.length > 1 ? "s" : ""} detected
          </Text>
          <Ionicons name={showContradictions ? "chevron-up" : "chevron-down"} size={12} color="#f59e0b" />
        </TouchableOpacity>
      )}
      {showContradictions && family.contradictions.map((c, i) => (
        <View key={i} style={[s.contradictionRow, { borderLeftColor: c.severity === "high" ? "#f87171" : "#f59e0b" }]}>
          <Text style={[s.contradictionSeverity, { color: c.severity === "high" ? "#f87171" : "#f59e0b" }]}>
            {c.severity.toUpperCase()}
          </Text>
          <Text style={s.contradictionDesc}>{c.description}</Text>
          <Text style={s.contradictionReduction}>Confidence reduction: -{c.confidenceReduction}%</Text>
        </View>
      ))}
    </View>
  );
}

// ── Stage 4: Outlier Card ─────────────────────────────────────────────────────
function OutlierCard({ outlier }: { outlier: OutlierAssessment }) {
  const isTrue = outlier.group === "true_match";
  const color = isTrue ? "#4ade80" : "#f59e0b";
  return (
    <View style={[s.card, { borderColor: color + "33" }]}>
      <StageHeader stage="Stage 4" title="Outlier Detection" />
      <View style={s.outlierRow}>
        <Ionicons name={isTrue ? "checkmark-circle" : "help-circle"} size={28} color={color} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[s.outlierLabel, { color }]}>{outlier.groupLabel}</Text>
          <Text style={s.smallText}>{isTrue ? "Stats support this type of outcome consistently." : "Outcome may be driven by chance rather than stats."}</Text>
        </View>
        <ConfPill value={outlier.confidence} />
      </View>
      <View style={s.outlierMetrics}>
        <View style={s.outlierMetric}>
          <Text style={s.outlierMetricVal}>{outlier.chaosIndex.toFixed(1)}</Text>
          <Text style={s.outlierMetricLbl}>Chaos Index</Text>
        </View>
        <View style={s.outlierMetric}>
          <Text style={s.outlierMetricVal}>{(outlier.dominanceGap * 100).toFixed(0)}%</Text>
          <Text style={s.outlierMetricLbl}>Dominance Gap</Text>
        </View>
        <View style={s.outlierMetric}>
          <Text style={s.outlierMetricVal}>{(outlier.xgAccuracy * 100).toFixed(0)}%</Text>
          <Text style={s.outlierMetricLbl}>xG Accuracy</Text>
        </View>
      </View>
      {outlier.reasoning.map((r, i) => (
        <View key={i} style={s.identitySignal}>
          <View style={[s.signalDot, { backgroundColor: color }]} />
          <Text style={s.identitySignalText}>{r}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Stage 5: Psych Card ───────────────────────────────────────────────────────
const EFFECT_COLORS: Record<string, string> = {
  boosts_goals:    "#4ade80",
  suppresses_goals:"#f87171",
  shifts_home:     "#3D7BF4",
  shifts_away:     "#f59e0b",
  neutral:         "#8C8D96",
};
const EFFECT_LABELS: Record<string, string> = {
  boosts_goals:    "↑ Goals",
  suppresses_goals:"↓ Goals",
  shifts_home:     "→ Home",
  shifts_away:     "→ Away",
  neutral:         "Neutral",
};

function PsychCard({ psych }: { psych: PsychContext }) {
  const netGoal = psych.goalBoost;
  const netColor = netGoal > 0.1 ? "#4ade80" : netGoal < -0.1 ? "#f87171" : "#8C8D96";
  return (
    <View style={s.card}>
      <StageHeader stage="Stage 5" title="Psychological Context" badge={psych.psychLabel} badgeColor={Colors.dark.accent} />
      <View style={s.psychMetrics}>
        <View style={s.psychMetric}>
          <Text style={[s.psychMetricVal, { color: netColor }]}>{netGoal >= 0 ? "+" : ""}{netGoal.toFixed(2)}</Text>
          <Text style={s.psychMetricLbl}>Net Goal Boost</Text>
        </View>
        <View style={s.psychMetric}>
          <Text style={[s.psychMetricVal, { color: psych.homeAdvantageBoost >= 0 ? "#3D7BF4" : "#f59e0b" }]}>
            {psych.homeAdvantageBoost >= 0 ? "Home +" : "Away +"}{Math.abs(psych.homeAdvantageBoost).toFixed(2)}
          </Text>
          <Text style={s.psychMetricLbl}>Advantage</Text>
        </View>
        <View style={s.psychMetric}>
          <Text style={[s.psychMetricVal, { color: psych.suppressionFactor > 0.5 ? "#f87171" : "#8C8D96" }]}>
            {(psych.suppressionFactor * 100).toFixed(0)}%
          </Text>
          <Text style={s.psychMetricLbl}>Suppression</Text>
        </View>
      </View>
      {psych.signals.map((sig, i) => {
        const c = EFFECT_COLORS[sig.effect] ?? "#8C8D96";
        const lbl = EFFECT_LABELS[sig.effect] ?? sig.effect;
        return (
          <View key={i} style={s.psychSignalRow}>
            <View style={[s.psychEffectBadge, { backgroundColor: c + "22", borderColor: c + "44" }]}>
              <Text style={[s.psychEffectText, { color: c }]}>{lbl}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.psychSignalLabel}>{sig.label}</Text>
              <Text style={s.psychSignalDetail}>{sig.detail}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── Top Scoreline Card ────────────────────────────────────────────────────────
function ScoreCard({
  pred,
  rank,
  homeTeamName,
  awayTeamName,
}: {
  pred: ScorelinePrediction;
  rank: number;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const outcomeColor =
    pred.outcome === "Home Win" ? "#3D7BF4" :
    pred.outcome === "Away Win" ? "#f59e0b" : "#8C8D96";
  const rankColors = ["#3D7BF4", "#f59e0b", "#8C8D96", "#71717a", "#52525b"];
  const color = rankColors[rank] ?? "#52525b";
  const familySupportPct = Math.round(pred.familySupport * 100);

  return (
    <TouchableOpacity
      style={[s.scoreCard, rank === 0 && { borderColor: color + "70" }]}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.75}
    >
      <View style={s.scoreCardHeader}>
        <View style={[s.rankBadge, { backgroundColor: color }]}>
          <Text style={s.rankBadgeText}>#{rank + 1}</Text>
        </View>
        <View style={[s.outcomeBadge, { backgroundColor: outcomeColor + "22" }]}>
          <Text style={[s.outcomeText, { color: outcomeColor }]}>{pred.outcome}</Text>
        </View>
        {pred.isTopPick && (
          <View style={s.topPickBadge}>
            <Ionicons name="star" size={10} color="#f59e0b" />
            <Text style={s.topPickText}>Top Pick</Text>
          </View>
        )}
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={13} color={Colors.dark.textTertiary} style={{ marginLeft: "auto" }} />
      </View>

      <View style={s.scoreRow}>
        <View style={s.scoreTeam}>
          <Text style={[s.teamName, pred.outcome === "Home Win" && { color: "#fff" }]} numberOfLines={1}>{homeTeamName}</Text>
          <Text style={[s.scoreDigit, { color }]}>{pred.homeGoals}</Text>
        </View>
        <Text style={s.scoreSep}>–</Text>
        <View style={[s.scoreTeam, { alignItems: "flex-end" }]}>
          <Text style={[s.scoreDigit, { color }]}>{pred.awayGoals}</Text>
          <Text style={[s.teamName, pred.outcome === "Away Win" && { color: "#fff" }]} numberOfLines={1}>{awayTeamName}</Text>
        </View>
      </View>

      <View style={s.scoreConf}>
        <Text style={[s.scoreConfValue, { color }]}>{pred.confidence.toFixed(1)}%</Text>
        <Text style={s.scoreConfLabel}>composite confidence</Text>
        {pred.contradictionPenalty > 0 && (
          <Text style={s.contradictionBadge}>-{pred.contradictionPenalty}% contradiction</Text>
        )}
      </View>
      <AnimBar pct={Math.min(100, pred.confidence * 1.5)} color={color} delay={rank * 80} />

      {expanded && (
        <View style={s.scoreExpanded}>
          <View style={s.scoreMeta}>
            <View style={s.scoreMetaItem}>
              <Text style={s.scoreMetaVal}>{pred.bucketConfidence.toFixed(1)}%</Text>
              <Text style={s.scoreMetaLbl}>Bucket conf</Text>
            </View>
            <View style={s.scoreMetaItem}>
              <Text style={s.scoreMetaVal}>{familySupportPct}%</Text>
              <Text style={s.scoreMetaLbl}>Family support</Text>
            </View>
          </View>
          {pred.reasoning.map((r, i) => (
            <View key={i} style={s.identitySignal}>
              <View style={[s.signalDot, { backgroundColor: color }]} />
              <Text style={s.identitySignalText}>{r}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Markets Card ──────────────────────────────────────────────────────────────
function MarketsCard({ markets, homeTeamName, awayTeamName }: {
  markets: MarketPredictions;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const confColor = (c: string) =>
    c === "high" ? "#4ade80" : c === "medium" ? "#f59e0b" : "#8C8D96";
  const predColor = (p: string) =>
    p === "Yes" ? "#4ade80" : p === "No" ? "#f87171" : "#f59e0b";

  return (
    <View style={s.card}>
      <Text style={s.sectionTitle}>Market Predictions</Text>
      {/* 1X2 */}
      <View style={s.winProbTrack}>
        <View style={[s.winProbFill, { flex: markets.homeWin.probability, backgroundColor: "#3D7BF4" }]} />
        <View style={[s.winProbFill, { flex: markets.draw.probability, backgroundColor: "#5C5D66" }]} />
        <View style={[s.winProbFill, { flex: markets.awayWin.probability, backgroundColor: "#f59e0b" }]} />
      </View>
      <View style={s.winProbLabels}>
        <View style={s.winProbLabel}>
          <View style={[s.winDot, { backgroundColor: "#3D7BF4" }]} />
          <Text style={s.winProbTeam} numberOfLines={1}>{homeTeamName}</Text>
          <Text style={[s.winProbPct, { color: confColor(markets.homeWin.confidence) }]}>{markets.homeWin.probability}%</Text>
        </View>
        <View style={s.winProbLabel}>
          <View style={[s.winDot, { backgroundColor: "#5C5D66" }]} />
          <Text style={s.winProbTeam}>Draw</Text>
          <Text style={[s.winProbPct, { color: "#8C8D96" }]}>{markets.draw.probability}%</Text>
        </View>
        <View style={s.winProbLabel}>
          <View style={[s.winDot, { backgroundColor: "#f59e0b" }]} />
          <Text style={s.winProbTeam} numberOfLines={1}>{awayTeamName}</Text>
          <Text style={[s.winProbPct, { color: confColor(markets.awayWin.confidence) }]}>{markets.awayWin.probability}%</Text>
        </View>
      </View>

      {/* Market tiles */}
      <View style={s.marketGrid}>
        {[
          { label: "BTTS", pred: markets.btts.prediction, prob: markets.btts.probability },
          { label: "Over 2.5", pred: markets.over25.prediction, prob: markets.over25.probability },
          { label: "Over 3.5", pred: markets.over35.prediction, prob: markets.over35.probability },
        ].map((m) => (
          <View key={m.label} style={s.marketTile}>
            <Text style={s.marketLabel}>{m.label}</Text>
            <Text style={[s.marketPred, { color: predColor(m.pred) }]}>{m.pred}</Text>
            <Text style={s.marketProb}>{m.prob}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Bet List Card (Full Extended Markets) ────────────────────────────────────
function BetListCard({ em, homeTeamName, awayTeamName }: {
  em: ExtendedMarketsData;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const predColor = (p: string) =>
    p === "Yes" || p === "Home" || p === "Away" ? "#4ade80" : p === "No" ? "#f87171" : "#f59e0b";
  const pctColor  = (p: number) => p >= 60 ? "#4ade80" : p >= 40 ? "#f59e0b" : "#f87171";

  return (
    <View style={s.card}>
      <StageHeader stage="Bet List" title="Full Prediction Markets" badge="Validated" badgeColor="#4ade80" />

      {/* ── 1X2 bar ── */}
      <Text style={s.betGroupLabel}>1X2</Text>
      <View style={s.winProbTrack}>
        <View style={[s.winProbFill, { flex: em.homeWin.probability, backgroundColor: "#3D7BF4" }]} />
        <View style={[s.winProbFill, { flex: em.draw.probability,    backgroundColor: "#5C5D66" }]} />
        <View style={[s.winProbFill, { flex: em.awayWin.probability, backgroundColor: "#f59e0b" }]} />
      </View>
      <View style={s.betRow3}>
        {[
          { label: "1 — " + homeTeamName, pred: em.homeWin.prediction, prob: em.homeWin.probability, color: "#3D7BF4" },
          { label: "X — Draw",            pred: em.draw.prediction,    prob: em.draw.probability,    color: "#8C8D96" },
          { label: "2 — " + awayTeamName, pred: em.awayWin.prediction, prob: em.awayWin.probability, color: "#f59e0b" },
        ].map((m) => (
          <View key={m.label} style={s.betCell3}>
            <Text style={[s.betCellLabel, { color: m.color }]} numberOfLines={1}>{m.label}</Text>
            <Text style={[s.betCellPred, { color: predColor(m.pred) }]}>{m.pred}</Text>
            <Text style={[s.betCellProb, { color: pctColor(m.prob) }]}>{m.prob}%</Text>
          </View>
        ))}
      </View>

      {/* ── Double Chance ── */}
      <Text style={s.betGroupLabel}>Double Chance</Text>
      <View style={s.betRow3}>
        {[
          { label: "X1 — Home/Draw", pred: em.x1.prediction,        prob: em.x1.probability },
          { label: "X2 — Away/Draw", pred: em.x2.prediction,        prob: em.x2.probability },
          { label: "12 — No Draw",   pred: em.homeOrAway.prediction, prob: em.homeOrAway.probability },
        ].map((m) => (
          <View key={m.label} style={s.betCell3}>
            <Text style={s.betCellLabel} numberOfLines={1}>{m.label}</Text>
            <Text style={[s.betCellPred, { color: predColor(m.pred) }]}>{m.pred}</Text>
            <Text style={[s.betCellProb, { color: pctColor(m.prob) }]}>{m.prob}%</Text>
          </View>
        ))}
      </View>

      {/* ── Goals + BTTS ── */}
      <Text style={s.betGroupLabel}>Goals Markets</Text>
      <View style={s.betRow3}>
        {[
          { label: "BTTS",     pred: em.btts.prediction,   prob: em.btts.probability },
          { label: "Over 2.5", pred: em.over25.prediction, prob: em.over25.probability },
          { label: "Over 3.5", pred: em.over35.prediction, prob: em.over35.probability },
        ].map((m) => (
          <View key={m.label} style={s.betCell3}>
            <Text style={s.betCellLabel}>{m.label}</Text>
            <Text style={[s.betCellPred, { color: predColor(m.pred) }]}>{m.pred}</Text>
            <Text style={[s.betCellProb, { color: pctColor(m.prob) }]}>{m.prob}%</Text>
          </View>
        ))}
      </View>

      {/* ── First to Score ── */}
      <Text style={s.betGroupLabel}>First Team to Score</Text>
      <View style={s.firstScoreRow}>
        <View style={s.firstScoreItem}>
          <Text style={s.firstScoreTeam} numberOfLines={1}>{homeTeamName}</Text>
          <Text style={[s.firstScoreProb, { color: pctColor(em.firstToScore.homeProbability) }]}>
            {em.firstToScore.homeProbability}%
          </Text>
          {em.firstToScore.prediction === "Home" && (
            <View style={s.firstScorePredBadge}><Text style={s.firstScorePredText}>Pick</Text></View>
          )}
        </View>
        <View style={s.firstScoreDivider} />
        <View style={s.firstScoreItem}>
          <Text style={s.firstScoreTeam}>No Goal</Text>
          <Text style={[s.firstScoreProb, { color: "#8C8D96" }]}>{em.firstToScore.noGoalProbability}%</Text>
        </View>
        <View style={s.firstScoreDivider} />
        <View style={s.firstScoreItem}>
          <Text style={s.firstScoreTeam} numberOfLines={1}>{awayTeamName}</Text>
          <Text style={[s.firstScoreProb, { color: pctColor(em.firstToScore.awayProbability) }]}>
            {em.firstToScore.awayProbability}%
          </Text>
          {em.firstToScore.prediction === "Away" && (
            <View style={s.firstScorePredBadge}><Text style={s.firstScorePredText}>Pick</Text></View>
          )}
        </View>
      </View>

      {/* ── Each team to score 2+ ── */}
      <Text style={s.betGroupLabel}>Each Team to Score 2+</Text>
      <View style={s.betRow2}>
        {[
          { label: homeTeamName + " 2+", pred: em.home2Plus.prediction, prob: em.home2Plus.probability },
          { label: awayTeamName + " 2+", pred: em.away2Plus.prediction, prob: em.away2Plus.probability },
        ].map((m) => (
          <View key={m.label} style={s.betCell2}>
            <Text style={s.betCellLabel} numberOfLines={1}>{m.label}</Text>
            <Text style={[s.betCellPred, { color: predColor(m.pred) }]}>{m.pred}</Text>
            <Text style={[s.betCellProb, { color: pctColor(m.prob) }]}>{m.prob}%</Text>
          </View>
        ))}
      </View>

      {/* ── Draw Intelligence ── */}
      {em.drawIntelligence && (
        <View style={[s.drawIntelBox, { borderColor: em.drawIntelligence.isLikelyDraw ? "#8C8D96" : "#4ade8033" }]}>
          <View style={s.drawIntelHeader}>
            <Ionicons name="remove-circle-outline" size={14} color="#8C8D96" />
            <Text style={s.drawIntelTitle}>Draw Intelligence</Text>
            <View style={[s.drawIntelBadge, { backgroundColor: em.drawIntelligence.isLikelyDraw ? "#8C8D9622" : "#4ade8022" }]}>
              <Text style={[s.drawIntelBadgeText, { color: em.drawIntelligence.isLikelyDraw ? "#8C8D96" : "#4ade80" }]}>
                {em.drawIntelligence.isLikelyDraw ? "Draw Likely" : "Result Expected"}
              </Text>
            </View>
          </View>
          <View style={s.drawIntelMetrics}>
            <View style={s.drawIntelMetric}>
              <Text style={[s.drawIntelMetricVal, { color: "#8C8D96" }]}>{em.drawProbability}%</Text>
              <Text style={s.drawIntelMetricLbl}>Draw prob</Text>
            </View>
            <View style={s.drawIntelMetric}>
              <Text style={[s.drawIntelMetricVal, { color: "#f59e0b" }]}>{(em.drawIntelligence.drawScore * 100).toFixed(0)}%</Text>
              <Text style={s.drawIntelMetricLbl}>Draw score</Text>
            </View>
          </View>
          {em.drawIntelligence.signals.slice(0, 2).map((sig, i) => (
            <View key={i} style={s.identitySignal}>
              <View style={[s.signalDot, { backgroundColor: "#8C8D96" }]} />
              <Text style={s.identitySignalText}>{sig}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Behavioral Panel Card ────────────────────────────────────────────────────
function BehavioralPanel({ beh, homeTeamName, awayTeamName }: {
  beh: BehavioralOutput;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const WINNER_COLOR: Record<string, string> = { H: "#3D7BF4", D: "#8C8D96", A: "#f59e0b" };
  const BTTS_COLOR:   Record<string, string> = { yes: "#4ade80", no: "#f87171", fifty_fifty: "#f59e0b" };
  const TEMPO_COLOR:  Record<string, string> = { open: "#f59e0b", controlled: "#3D7BF4", defensive: "#8C8D96" };
  const FAMILY_COLOR: Record<string, string> = {
    low_defensive: "#8C8D96", balanced_btts: "#3D7BF4", open_high: "#f59e0b",
    dominant_home: "#4ade80", dominant_away: "#f87171", chaotic: "#a78bfa",
  };

  const winLabel = beh.winner.label === "H" ? homeTeamName
    : beh.winner.label === "A" ? awayTeamName : "Draw";
  const winColor = WINNER_COLOR[beh.winner.label] ?? Colors.dark.accent;
  const bttsColor = BTTS_COLOR[beh.btts.label] ?? Colors.dark.accent;

  return (
    <View style={[s.card, { borderColor: "#a78bfa33" }]}>
      <StageHeader stage="Behavioral" title="Behavioral Model Analysis" badge={`${beh.calibratedConfidence}% conf`} badgeColor="#a78bfa" />
      <Text style={s.behavioralSubtitle}>
        Learned from match history — behavioral patterns, team psychology & identity
      </Text>

      {/* Quick summary row */}
      <View style={s.behavioralSummaryRow}>
        <View style={[s.behavioralSummaryItem, { borderColor: winColor + "44" }]}>
          <Text style={[s.behavioralSummaryVal, { color: winColor }]}>{winLabel}</Text>
          <Text style={s.behavioralSummaryLbl}>Winner</Text>
          <Text style={[s.behavioralSummaryConf, { color: winColor }]}>{beh.winner.confidence}%</Text>
        </View>
        <View style={[s.behavioralSummaryItem, { borderColor: bttsColor + "44" }]}>
          <Text style={[s.behavioralSummaryVal, { color: bttsColor }]}>BTTS {beh.btts.label.toUpperCase()}</Text>
          <Text style={s.behavioralSummaryLbl}>Both Score</Text>
          <Text style={[s.behavioralSummaryConf, { color: bttsColor }]}>{beh.btts.confidence}%</Text>
        </View>
        <View style={[s.behavioralSummaryItem, { borderColor: "#a78bfa44" }]}>
          <Text style={[s.behavioralSummaryVal, { color: "#a78bfa" }]}>{beh.goalRange.label.replace("_", " ")}</Text>
          <Text style={s.behavioralSummaryLbl}>Goals</Text>
          <Text style={[s.behavioralSummaryConf, { color: "#a78bfa" }]}>{beh.goalRange.confidence}%</Text>
        </View>
      </View>

      {/* Draw Classifier */}
      {beh.drawClassifier?.available && (
        <View style={s.drawClassifierRow}>
          <Ionicons name="remove-circle-outline" size={13} color="#8C8D96" />
          <Text style={s.drawClassifierLabel}>Draw Detector:</Text>
          <Text style={[s.drawClassifierVal, {
            color: beh.drawClassifier.drawProbability >= 55 ? "#f59e0b" : "#4ade80",
          }]}>
            {beh.drawClassifier.drawProbability.toFixed(0)}% draw / {beh.drawClassifier.nonDrawProbability.toFixed(0)}% result
          </Text>
          <View style={[s.drawClassifierBadge, {
            backgroundColor: beh.drawClassifier.drawProbability >= 55 ? "#f59e0b22" : "#4ade8022",
          }]}>
            <Text style={[s.drawClassifierBadgeText, {
              color: beh.drawClassifier.drawProbability >= 55 ? "#f59e0b" : "#4ade80",
            }]}>
              {beh.drawClassifier.drawProbability >= 55 ? "Draw Alert" : "Result Likely"}
            </Text>
          </View>
        </View>
      )}

      {/* Tempo */}
      <View style={s.behavioralTempoRow}>
        <Text style={s.behavioralTempoLabel}>Tempo:</Text>
        <Text style={[s.behavioralTempoVal, { color: TEMPO_COLOR[beh.tempo.label] ?? "#8C8D96" }]}>
          {beh.tempo.label} ({beh.tempo.confidence}%)
        </Text>
      </View>

      {/* Family */}
      <View style={s.behavioralFamilyRow}>
        <View style={[s.behavioralFamilyDot, { backgroundColor: FAMILY_COLOR[beh.family.id] ?? Colors.dark.accent }]} />
        <Text style={[s.behavioralFamilyLabel, { color: FAMILY_COLOR[beh.family.id] ?? Colors.dark.accent }]}>
          {beh.family.label.replace("_", " ")}
        </Text>
        <Text style={s.behavioralFamilyConf}>{beh.family.confidence}% family match</Text>
      </View>

      {/* Expand: exact scores from behavioral model */}
      {beh.exactScores.length > 0 && (
        <TouchableOpacity style={s.behavioralExpandBtn} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
          <Text style={s.behavioralExpandText}>
            {expanded ? "Hide" : "Show"} behavioral exact score predictions
          </Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={13} color="#a78bfa" />
        </TouchableOpacity>
      )}
      {expanded && (
        <View style={s.behavioralExactList}>
          {beh.exactScores.slice(0, 5).map((sc, i) => (
            <View key={sc.scoreline + i} style={s.behavioralExactRow}>
              <Text style={s.behavioralExactRank}>#{i + 1}</Text>
              <Text style={s.behavioralExactScore}>{sc.scoreline}</Text>
              <Text style={[s.behavioralExactOutcome, {
                color: sc.outcome === "Home Win" ? "#3D7BF4" : sc.outcome === "Away Win" ? "#f59e0b" : "#8C8D96",
              }]}>{sc.outcome}</Text>
              <Text style={[s.behavioralExactConf, {
                color: sc.finalConfidence >= 20 ? "#4ade80" : sc.finalConfidence >= 10 ? "#f59e0b" : "#f87171",
              }]}>{sc.finalConfidence.toFixed(1)}%</Text>
            </View>
          ))}
          {beh.contradictions.length > 0 && (
            <View style={s.behavioralContraRow}>
              <Ionicons name="warning-outline" size={12} color="#f59e0b" />
              <Text style={s.behavioralContraText}>{beh.contradictions[0]}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── Score Validation Card ────────────────────────────────────────────────────
function ScoreValidationCard({ validations }: { validations: ScoreValidationItem[] }) {
  const labelColor = (l: string) =>
    l === "Realistic" ? "#4ade80" : l === "Stretched" ? "#f59e0b" : "#f87171";
  const riskColor = (v: number) => v >= 0.55 ? "#f87171" : v >= 0.32 ? "#f59e0b" : "#4ade80";

  return (
    <View style={s.card}>
      <StageHeader stage="Validator" title="Score Validation" badge="Realism Check" badgeColor="#4ade80" />
      <Text style={s.validatorSubtitle}>
        Each predicted score checked against Poisson performance models — confirms the team can realistically produce these numbers.
      </Text>

      {validations.map((v, i) => (
        <View key={v.scoreline + i} style={[s.validationItem, {
          borderColor: labelColor(v.label) + "33",
          borderLeftColor: labelColor(v.label),
          borderLeftWidth: 3,
        }]}>
          <View style={s.validationHeader}>
            <Text style={s.validationScore}>{v.scoreline}</Text>
            <View style={[s.validationLabelBadge, { backgroundColor: labelColor(v.label) + "22" }]}>
              <Text style={[s.validationLabelText, { color: labelColor(v.label) }]}>{v.label}</Text>
            </View>
            <Text style={[s.validationAch, { color: labelColor(v.label) }]}>
              {(v.achievabilityScore * 100).toFixed(0)}% achievable
            </Text>
          </View>

          {/* Expected vs predicted */}
          <View style={s.validationExpRow}>
            <View style={s.validationExpItem}>
              <Text style={s.validationExpLbl}>Expected</Text>
              <Text style={s.validationExpVal}>{v.homeExpected} – {v.awayExpected}</Text>
            </View>
            <View style={s.validationExpItem}>
              <Text style={s.validationExpLbl}>P(scoreline)</Text>
              <Text style={s.validationExpVal}>{v.combinedPoisson.toFixed(2)}%</Text>
            </View>
            {v.flipSide !== "none" && (
              <View style={s.validationExpItem}>
                <Text style={s.validationExpLbl}>Flip risk</Text>
                <Text style={[s.validationExpVal, { color: riskColor(v.flipPotential) }]}>
                  {(v.flipPotential * 100).toFixed(0)}%
                </Text>
              </View>
            )}
          </View>

          {/* Risk factors */}
          {v.riskFactors.length > 0 && (
            <View style={s.validationRisks}>
              {v.riskFactors.slice(0, 2).map((r, j) => (
                <View key={j} style={s.identitySignal}>
                  <View style={[s.signalDot, { backgroundColor: "#f59e0b" }]} />
                  <Text style={s.identitySignalText}>{r}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Flip signals */}
          {v.flipSignals.length > 0 && v.flipSide !== "none" && (
            <View style={s.validationFlipBox}>
              <Text style={s.validationFlipTitle}>
                {v.flipSide === "home" ? "Home" : "Away"} can flip script:
              </Text>
              {v.flipSignals.slice(0, 2).map((sig, j) => (
                <View key={j} style={s.identitySignal}>
                  <View style={[s.signalDot, { backgroundColor: "#f87171" }]} />
                  <Text style={s.identitySignalText}>{sig}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

// ── Butterfly Effect Card ────────────────────────────────────────────────────
function ButterflyCard({ bf }: { bf: ButterflyEffectData }) {
  const [expandedSec, setExpandedSec] = useState<string | null>(null);

  const riskColor = (l: string) =>
    l === "High" ? "#f87171" : l === "Medium" ? "#f59e0b" : "#4ade80";

  const sections = [
    {
      id: "upset",
      title: "Upset Potential",
      subtitle: "Can underdog win or steal draw?",
      value: bf.upsetPotential,
      label: bf.upsetLabel,
      signals: bf.upsetSignals,
      icon: "flash-outline" as const,
    },
    {
      id: "inflation",
      title: "Goal Inflation Risk",
      subtitle: "Low-scoring match goes high?",
      value: bf.goalInflationRisk,
      label: bf.goalInflationLabel,
      signals: bf.goalInflationSignals,
      icon: "trending-up-outline" as const,
    },
    {
      id: "btts",
      title: "BTTS Flip Risk",
      subtitle: "Non-BTTS match becomes BTTS?",
      value: bf.bttsFlipRisk,
      label: bf.bttsFlipLabel,
      signals: bf.bttsFlipSignals,
      icon: "swap-horizontal-outline" as const,
    },
  ];

  return (
    <View style={[s.card, { borderColor: bf.chaosColor + "33" }]}>
      <StageHeader stage="Butterfly" title="Butterfly Effect" badge={bf.chaosLabel} badgeColor={bf.chaosColor} />
      <Text style={s.validatorSubtitle}>
        Detects non-statistical chaos — when football's low-scoring nature makes any single moment decisive.
      </Text>

      {/* Chaos index */}
      <View style={[s.chaosIndexRow, { backgroundColor: bf.chaosColor + "15", borderColor: bf.chaosColor + "30" }]}>
        <Text style={[s.chaosIndexVal, { color: bf.chaosColor }]}>
          {(bf.overallChaosIndex * 100).toFixed(0)}%
        </Text>
        <View style={{ flex: 1 }}>
          <AnimBar pct={bf.overallChaosIndex * 100} color={bf.chaosColor} />
          <Text style={[s.chaosIndexLabel, { color: bf.chaosColor }]}>Overall Chaos Index — {bf.chaosLabel}</Text>
        </View>
      </View>

      {/* Three risk sections */}
      {sections.map((sec) => {
        const color = riskColor(sec.label);
        const isOpen = expandedSec === sec.id;
        return (
          <TouchableOpacity
            key={sec.id}
            style={s.butterflySec}
            onPress={() => setExpandedSec(isOpen ? null : sec.id)}
            activeOpacity={0.7}
          >
            <View style={s.butterflySecHeader}>
              <Ionicons name={sec.icon} size={14} color={color} />
              <View style={{ flex: 1 }}>
                <Text style={s.butterflySecTitle}>{sec.title}</Text>
                <Text style={s.butterflySecSub}>{sec.subtitle}</Text>
              </View>
              <View style={[s.butterflyBadge, { backgroundColor: color + "22" }]}>
                <Text style={[s.butterflyBadgeText, { color }]}>{sec.label}</Text>
              </View>
              <Text style={[s.butterflyStat, { color }]}>{(sec.value * 100).toFixed(0)}%</Text>
              <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={12} color={Colors.dark.textTertiary} />
            </View>
            <AnimBar pct={sec.value * 100} color={color} />
            {isOpen && sec.signals.length > 0 && (
              <View style={s.butterflySignals}>
                {sec.signals.map((sig, i) => (
                  <View key={i} style={s.identitySignal}>
                    <View style={[s.signalDot, { backgroundColor: color }]} />
                    <Text style={s.identitySignalText}>{sig}</Text>
                  </View>
                ))}
              </View>
            )}
            {isOpen && sec.signals.length === 0 && (
              <Text style={[s.identitySignalText, { marginTop: 6, paddingLeft: 10 }]}>No significant signals detected.</Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface Props {
  eventId: string;
  homeTeamId?: number;
  awayTeamId?: number;
  homeTeamName: string;
  awayTeamName: string;
}

export default function HierarchicalPredictionTab({
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
  const url = `/api/event/${eventId}/hierarchical-prediction${queryParts.length ? `?${queryParts.join("&")}` : ""}`;

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<HierarchicalResult>({
      queryKey: [url],
      enabled: canFetch,
      staleTime: 5 * 60 * 1000,
      retry: false,
    });

  if (!canFetch) {
    return (
      <View style={s.center}>
        <Ionicons name="alert-circle-outline" size={40} color={Colors.dark.textTertiary} />
        <Text style={s.emptyText}>Team IDs unavailable for this match.</Text>
      </View>
    );
  }

  if (isLoading || isFetching) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
        <Text style={s.loadingText}>Running 6-stage hierarchical analysis…</Text>
        <Text style={s.loadingSubText}>Fetching live data via proxy — may take up to 90 s</Text>
      </View>
    );
  }

  if (isError || !data) {
    const msg = (error as Error)?.message || "Prediction failed";
    const noModels = msg.toLowerCase().includes("no bucket models") || msg.toLowerCase().includes("no trained");
    return (
      <View style={s.center}>
        <Ionicons name={noModels ? "school-outline" : "warning-outline"} size={40} color={noModels ? Colors.dark.accent : "#f87171"} />
        <Text style={[s.emptyText, !noModels && { color: "#f87171" }]}>{msg}</Text>
        {noModels && (
          <Text style={s.loadingSubText}>
            Train bucket models from the xG Engine tab → Score Outcome section first.
          </Text>
        )}
        <TouchableOpacity style={s.retryBtn} onPress={() => refetch()}>
          <Ionicons name="refresh" size={14} color={Colors.dark.accent} />
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const overallColor =
    data.overallConfidence >= 70 ? "#4ade80" :
    data.overallConfidence >= 50 ? "#f59e0b" : "#f87171";

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Smart Prediction</Text>
          <Text style={s.headerSub}>
            6-stage hierarchical engine · {data.modelsUsed} bucket model{data.modelsUsed !== 1 ? "s" : ""}
          </Text>
        </View>
        <TouchableOpacity style={s.refreshBtn} onPress={() => refetch()} disabled={isFetching}>
          <Ionicons name="refresh" size={16} color={Colors.dark.accent} />
        </TouchableOpacity>
      </View>

      {/* Overall confidence banner */}
      <View style={[s.overallBanner, { backgroundColor: overallColor + "15", borderColor: overallColor + "40" }]}>
        <View style={s.overallLeft}>
          <Text style={[s.overallScore, { color: overallColor }]}>{data.overallConfidence}%</Text>
          <Text style={s.overallLabel}>Overall Confidence</Text>
        </View>
        <View style={s.overallRight}>
          <View style={[s.sourceBadge, { backgroundColor: data.dataSource === "live" ? "#4ade8022" : Colors.dark.surface }]}>
            <Ionicons name={data.dataSource === "live" ? "flash" : "archive"} size={11} color={data.dataSource === "live" ? "#4ade80" : Colors.dark.textSecondary} />
            <Text style={[s.sourceText, { color: data.dataSource === "live" ? "#4ade80" : Colors.dark.textSecondary }]}>
              {data.dataSource === "live" ? "Live data" : "Cached"}
            </Text>
          </View>
          <Text style={s.procTime}>{data.processingMs}ms</Text>
        </View>
      </View>

      {/* Top pick hero */}
      {data.primaryPrediction && (
        <View style={[s.heroPrediction, { borderColor: overallColor + "50" }]}>
          <View style={s.heroHeader}>
            <Ionicons name="star" size={14} color="#f59e0b" />
            <Text style={s.heroHeaderText}>Primary Prediction</Text>
          </View>
          <Text style={s.heroScore}>{data.primaryPrediction.scoreline}</Text>
          <Text style={[s.heroOutcome, {
            color: data.primaryPrediction.outcome === "Home Win" ? "#3D7BF4" :
                   data.primaryPrediction.outcome === "Away Win" ? "#f59e0b" : "#8C8D96",
          }]}>{data.primaryPrediction.outcome}</Text>
          <Text style={s.heroConf}>{data.primaryPrediction.confidence.toFixed(1)}% confidence</Text>
          <AnimBar pct={Math.min(100, data.primaryPrediction.confidence * 1.5)} color={overallColor} />
        </View>
      )}

      {/* Extended Bet List (primary smart markets) */}
      {data.extendedMarkets ? (
        <BetListCard
          em={data.extendedMarkets}
          homeTeamName={homeTeamName}
          awayTeamName={awayTeamName}
        />
      ) : (
        <MarketsCard
          markets={data.markets}
          homeTeamName={homeTeamName}
          awayTeamName={awayTeamName}
        />
      )}

      {/* Butterfly Effect */}
      {data.butterflyEffect && (
        <ButterflyCard bf={data.butterflyEffect} />
      )}

      {/* Stage 1 */}
      <CompletenessCard data={data.stage1_completeness} />

      {/* Stage 2 */}
      <IdentityCard
        identity={data.stage2_identity}
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
      />

      {/* Stage 3 */}
      <FamilyCard family={data.stage3_family} />

      {/* Stage 4 */}
      <OutlierCard outlier={data.stage4_outlier} />

      {/* Stage 5 */}
      {data.stage5_psych.signals.length > 0 && (
        <PsychCard psych={data.stage5_psych} />
      )}

      {/* Top 5 scorelines */}
      <View style={s.card}>
        <Text style={s.sectionTitle}>Top 5 Scorelines</Text>
        {data.top5.map((pred, i) => (
          <ScoreCard
            key={pred.scoreline + i}
            pred={pred}
            rank={i}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
          />
        ))}
      </View>

      {/* Score Validation */}
      {data.scoreValidations && data.scoreValidations.length > 0 && (
        <ScoreValidationCard validations={data.scoreValidations} />
      )}

      {/* Behavioral Panel */}
      {data.behavioral && (
        <BehavioralPanel
          beh={data.behavioral}
          homeTeamName={homeTeamName}
          awayTeamName={awayTeamName}
        />
      )}

      {/* Footer */}
      <View style={s.footer}>
        <Ionicons name="information-circle-outline" size={13} color={Colors.dark.textTertiary} />
        <Text style={s.footerText}>
          Engine: Completeness → Identity → Bucket Family → Outlier → Psychology → Score Rank → Behavioral Intelligence → Score Validator → Butterfly Effect.
          Every prediction verified for achievability before delivery.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.dark.background },
  scrollContent: { padding: 16, gap: 10, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  emptyText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.dark.text, textAlign: "center" },
  loadingText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.dark.text, textAlign: "center" },
  loadingSubText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, textAlign: "center", lineHeight: 18 },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: Colors.dark.surface, borderRadius: 20 },
  retryText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.dark.accent },

  // Header
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2 },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.dark.surface, alignItems: "center", justifyContent: "center" },

  // Overall banner
  overallBanner: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", borderWidth: 1, marginBottom: 4 },
  overallLeft: { flex: 1 },
  overallScore: { fontSize: 32, fontFamily: "Inter_700Bold" },
  overallLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  overallRight: { alignItems: "flex-end", gap: 4 },
  sourceBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  sourceText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  procTime: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textTertiary },

  // Hero prediction
  heroPrediction: { backgroundColor: Colors.dark.surface, borderRadius: 16, padding: 20, alignItems: "center", borderWidth: 1, marginBottom: 4 },
  heroHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  heroHeaderText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#f59e0b" },
  heroScore: { fontSize: 40, fontFamily: "Inter_700Bold", color: Colors.dark.text, letterSpacing: 2 },
  heroOutcome: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  heroConf: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 4, marginBottom: 12 },

  // Card
  card: { backgroundColor: Colors.dark.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.dark.border },

  // Stage header
  stageHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  stagePill: { backgroundColor: Colors.dark.accent + "22", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  stagePillText: { fontSize: 10, fontFamily: "Inter_700Bold", color: Colors.dark.accent },
  stageTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  stageBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  stageBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },

  // Completeness
  completenessRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  completenessGauge: { alignItems: "center", width: 56 },
  completenessScore: { fontSize: 22, fontFamily: "Inter_700Bold" },
  completenessLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  missingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, backgroundColor: "#f8717110", borderRadius: 8, padding: 8 },
  missingText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#f87171", flex: 1 },

  // Bars
  barTrack: { height: 4, borderRadius: 2, backgroundColor: Colors.dark.border, overflow: "hidden", flex: 1 },
  barFill: { height: "100%", borderRadius: 2 },

  // Conf pill
  confPill: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  confPillText: { fontFamily: "Inter_700Bold" },

  // Identity
  xgRow: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 },
  xgBlock: { flex: 1, alignItems: "center" },
  xgValue: { fontSize: 24, fontFamily: "Inter_700Bold" },
  xgLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  xgCenter: { alignItems: "center" },
  xgTotal: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  xgTotalLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },

  identityRow: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.dark.border, flexWrap: "wrap" },
  identityLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  identityRight: { flexDirection: "row", alignItems: "center", gap: 8, position: "absolute", right: 0, top: 10 },
  identityLayerName: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, width: 70 },
  identityLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  identityExpanded: { width: "100%", marginTop: 8, gap: 4 },
  identityDetail: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginBottom: 4 },
  identitySignal: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingLeft: 4 },
  signalDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5 },
  identitySignalText: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, flex: 1, lineHeight: 16 },

  // Family
  familyPrimary: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  familyIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  familyDot: { width: 12, height: 12, borderRadius: 6 },
  familyLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  familyDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2 },
  familyPsych: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, fontStyle: "italic", marginBottom: 12, lineHeight: 18 },
  familySecondary: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  familySecondaryLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  familySecondaryConf: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  chip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  chipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  contradictionToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.dark.border },
  contradictionToggleText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#f59e0b", flex: 1 },
  contradictionRow: { marginTop: 8, borderLeftWidth: 3, paddingLeft: 10, gap: 2 },
  contradictionSeverity: { fontSize: 10, fontFamily: "Inter_700Bold" },
  contradictionDesc: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, lineHeight: 16 },
  contradictionReduction: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textTertiary },
  contradictionBadge: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#f87171", marginLeft: "auto" },

  // Outlier
  outlierRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  outlierLabel: { fontSize: 14, fontFamily: "Inter_700Bold" },
  outlierMetrics: { flexDirection: "row", gap: 12, marginBottom: 10 },
  outlierMetric: { flex: 1, alignItems: "center", backgroundColor: Colors.dark.background, borderRadius: 8, padding: 10 },
  outlierMetricVal: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  outlierMetricLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2 },

  // Psych
  psychMetrics: { flexDirection: "row", gap: 8, marginBottom: 14 },
  psychMetric: { flex: 1, alignItems: "center", backgroundColor: Colors.dark.background, borderRadius: 8, padding: 10 },
  psychMetricVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  psychMetricLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2, textAlign: "center" },
  psychSignalRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 8 },
  psychEffectBadge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, minWidth: 68, alignItems: "center" },
  psychEffectText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  psychSignalLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.dark.text },
  psychSignalDetail: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, lineHeight: 16 },

  // Score card
  scoreCard: { backgroundColor: Colors.dark.background, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: Colors.dark.border },
  scoreCardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  rankBadge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  rankBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  outcomeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  outcomeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  topPickBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f59e0b22", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  topPickText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#f59e0b" },
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 10 },
  scoreTeam: { flex: 1, alignItems: "flex-start", gap: 2 },
  teamName: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  scoreDigit: { fontSize: 32, fontFamily: "Inter_700Bold" },
  scoreSep: { fontSize: 24, fontFamily: "Inter_400Regular", color: Colors.dark.textTertiary },
  scoreConf: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  scoreConfValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  scoreConfLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  scoreExpanded: { marginTop: 12, gap: 4 },
  scoreMeta: { flexDirection: "row", gap: 12, marginBottom: 8 },
  scoreMetaItem: { alignItems: "center", flex: 1, backgroundColor: Colors.dark.surface, borderRadius: 8, padding: 8 },
  scoreMetaVal: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  scoreMetaLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },

  // Markets
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.dark.text, marginBottom: 12 },
  winProbTrack: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 10 },
  winProbFill: { height: "100%" },
  winProbLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  winProbLabel: { flexDirection: "row", alignItems: "center", gap: 4 },
  winDot: { width: 8, height: 8, borderRadius: 4 },
  winProbTeam: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, maxWidth: 80 },
  winProbPct: { fontSize: 13, fontFamily: "Inter_700Bold" },
  marketGrid: { flexDirection: "row", gap: 8 },
  marketTile: { flex: 1, backgroundColor: Colors.dark.background, borderRadius: 10, padding: 12, alignItems: "center" },
  marketLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginBottom: 4 },
  marketPred: { fontSize: 16, fontFamily: "Inter_700Bold" },
  marketProb: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2 },

  smallText: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, lineHeight: 16, marginTop: 4 },

  // Footer
  footer: { flexDirection: "row", gap: 6, alignItems: "flex-start", paddingTop: 4 },
  footerText: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textTertiary, flex: 1, lineHeight: 16 },

  // ── Bet List Card ───────────────────────────────────────────────────────────
  betGroupLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.dark.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 12, marginBottom: 6 },
  betRow3: { flexDirection: "row", gap: 6, marginBottom: 2 },
  betRow2: { flexDirection: "row", gap: 8, marginBottom: 2 },
  betCell3: { flex: 1, backgroundColor: Colors.dark.background, borderRadius: 10, padding: 10, alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.dark.border },
  betCell2: { flex: 1, backgroundColor: Colors.dark.background, borderRadius: 10, padding: 12, alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.dark.border },
  betCellLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginBottom: 3, textAlign: "center" },
  betCellPred: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 2 },
  betCellProb: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  firstScoreRow: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.dark.background, borderRadius: 12, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.dark.border },
  firstScoreItem: { flex: 1, alignItems: "center", paddingVertical: 14, gap: 3 },
  firstScoreDivider: { width: StyleSheet.hairlineWidth, height: "70%", backgroundColor: Colors.dark.border },
  firstScoreTeam: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, textAlign: "center" },
  firstScoreProb: { fontSize: 20, fontFamily: "Inter_700Bold" },
  firstScorePredBadge: { backgroundColor: "#4ade8022", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  firstScorePredText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#4ade80" },

  drawIntelBox: { marginTop: 12, borderRadius: 10, borderWidth: 1, padding: 12 },
  drawIntelHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  drawIntelTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.dark.text, flex: 1 },
  drawIntelBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  drawIntelBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  drawIntelMetrics: { flexDirection: "row", gap: 10, marginBottom: 8 },
  drawIntelMetric: { alignItems: "center", backgroundColor: Colors.dark.background, borderRadius: 8, padding: 8, flex: 1 },
  drawIntelMetricVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  drawIntelMetricLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2 },

  // ── Behavioral Panel ────────────────────────────────────────────────────────
  behavioralSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, lineHeight: 16, marginBottom: 14 },
  behavioralSummaryRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  behavioralSummaryItem: { flex: 1, alignItems: "center", backgroundColor: Colors.dark.background, borderRadius: 10, padding: 10, borderWidth: 1 },
  behavioralSummaryVal: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center" },
  behavioralSummaryLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginTop: 2 },
  behavioralSummaryConf: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  drawClassifierRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.dark.background, borderRadius: 8, padding: 10, marginBottom: 10, flexWrap: "wrap" },
  drawClassifierLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.dark.textSecondary },
  drawClassifierVal: { fontSize: 12, fontFamily: "Inter_700Bold", flex: 1 },
  drawClassifierBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  drawClassifierBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  behavioralTempoRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  behavioralTempoLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  behavioralTempoVal: { fontSize: 12, fontFamily: "Inter_700Bold" },
  behavioralFamilyRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  behavioralFamilyDot: { width: 10, height: 10, borderRadius: 5 },
  behavioralFamilyLabel: { fontSize: 13, fontFamily: "Inter_700Bold" },
  behavioralFamilyConf: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  behavioralExpandBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.dark.border },
  behavioralExpandText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#a78bfa" },
  behavioralExactList: { marginTop: 10, gap: 4 },
  behavioralExactRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.dark.background, borderRadius: 8, padding: 8 },
  behavioralExactRank: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textTertiary, width: 22 },
  behavioralExactScore: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.dark.text, width: 42 },
  behavioralExactOutcome: { fontSize: 11, fontFamily: "Inter_600SemiBold", flex: 1 },
  behavioralExactConf: { fontSize: 13, fontFamily: "Inter_700Bold" },
  behavioralContraRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8, backgroundColor: "#f59e0b11", borderRadius: 8, padding: 8 },
  behavioralContraText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#f59e0b", flex: 1, lineHeight: 16 },

  // ── Score Validation Card ───────────────────────────────────────────────────
  validatorSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, lineHeight: 16, marginBottom: 12 },
  validationItem: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 10, borderColor: Colors.dark.border },
  validationHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  validationScore: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.dark.text, width: 44 },
  validationLabelBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  validationLabelText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  validationAch: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginLeft: "auto" },
  validationExpRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  validationExpItem: { flex: 1, alignItems: "center", backgroundColor: Colors.dark.background, borderRadius: 8, padding: 8 },
  validationExpLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary, marginBottom: 2 },
  validationExpVal: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  validationRisks: { gap: 3, marginBottom: 6 },
  validationFlipBox: { backgroundColor: "#f8717111", borderRadius: 8, padding: 8, marginTop: 4, gap: 3 },
  validationFlipTitle: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#f87171", marginBottom: 4 },

  // ── Butterfly Effect Card ───────────────────────────────────────────────────
  chaosIndexRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 14 },
  chaosIndexVal: { fontSize: 28, fontFamily: "Inter_700Bold" },
  chaosIndexLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  butterflySec: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.dark.border, gap: 6 },
  butterflySecHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  butterflySecTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.dark.text },
  butterflySecSub: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.dark.textSecondary },
  butterflyBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  butterflyBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  butterflyStat: { fontSize: 15, fontFamily: "Inter_700Bold", minWidth: 38, textAlign: "right" },
  butterflySignals: { gap: 3, paddingTop: 4 },
});
