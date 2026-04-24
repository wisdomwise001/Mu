/**
 * Half-context engine.
 *
 * Computes context-aware signals that influence which half of a football match
 * is most likely to be the highest-scoring half. These signals supplement the
 * historical-pattern based prediction with situational reasoning:
 *
 *   1. Knockout aggregate context (2-leg ties)
 *   2. Standings pressure & motivation asymmetry
 *   3. Fixture congestion / fatigue
 *   4. Coach substitution patterns
 *   5. Style clash (lightning starter vs late finisher etc.)
 *   6. Underdog "park the bus" dynamic (odds gap)
 *   7. Per-team early-collapse vs late-strength tendency
 *   8. Tournament stage modifier (group vs knockout vs final)
 *
 * Returns a list of weighted signals each leaning "first" / "second" / "draw"
 * along with structured context the frontend can render.
 */

import { proxyFetch } from "./proxyFetch";

const SOFASCORE_API = "https://api.sofascore.com/api/v1";

const SOFASCORE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.sofascore.com/",
  Origin: "https://www.sofascore.com",
  "Cache-Control": "no-cache",
};

async function fetchSofa(endpoint: string): Promise<any> {
  const res = await proxyFetch(`${SOFASCORE_API}${endpoint}`, {
    headers: SOFASCORE_HEADERS,
  });
  if (!res.ok) throw new Error(`SofaScore ${res.status}`);
  return res.json();
}

export type HalfLean = "first" | "second" | "draw";

export type ContextSignal = {
  kind: string;
  label: string;
  leans: HalfLean;
  weight: number; // 0..1
  detail?: string;
};

export type HalfContext = {
  signals: ContextSignal[];
  context: {
    knockout: {
      isKnockout: boolean;
      stage: string | null;
      isSecondLeg: boolean;
      aggregateLead: { team: "home" | "away" | null; goals: number } | null;
      trailingNeedsGoals: boolean;
      legOneScore: { home: number; away: number } | null;
    };
    pressure: {
      home: TeamPressure | null;
      away: TeamPressure | null;
      asymmetry: number; // -1 (home much more pressure) .. 1 (away much more)
    };
    fatigue: {
      home: TeamFatigue | null;
      away: TeamFatigue | null;
      asymmetry: number;
    };
    subPatterns: {
      home: SubPattern | null;
      away: SubPattern | null;
    };
    styleClash: {
      description: string;
      lean: HalfLean;
    } | null;
    odds: {
      favorite: "home" | "away" | "even" | null;
      gap: number; // 0 = even, 1 = lopsided
    } | null;
    stage: {
      label: string;
      modifier: HalfLean | null;
    };
    derby: { is: boolean; reason: string | null };
  };
};

type TeamPressure = {
  position: number;
  totalTeams: number;
  pointsFromSafety: number | null;
  pointsFromTop: number | null;
  status:
    | "title-race"
    | "european-push"
    | "mid-table"
    | "relegation-battle"
    | "safe"
    | "champion-clinched"
    | "relegated"
    | "unknown";
  motivation: number; // 0..1
};

type TeamFatigue = {
  daysSinceLast: number | null;
  matchesIn14Days: number;
  matchesIn21Days: number;
  fatigueIndex: number; // 0..1 (higher = more tired)
};

type SubPattern = {
  avgFirstSubMinute: number | null;
  avgAllSubMinute: number | null;
  earlySubsRate: number; // share of subs before 60'
  lateSubsRate: number; // share of subs after 75'
  conservative: boolean;
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function classifyKnockoutStage(roundInfo: any, tournamentName?: string): {
  isKnockout: boolean;
  isSecondLeg: boolean;
  stage: string | null;
} {
  const name: string = (roundInfo?.name || "").toString();
  const slug: string = (roundInfo?.slug || "").toString();
  const cupRoundType: number | undefined = roundInfo?.cupRoundType;
  const text = (name + " " + slug + " " + (tournamentName || "")).toLowerCase();

  const isFinal = /final\b/.test(text) && !/semi|quarter/.test(text);
  const isSemi = /semi/.test(text);
  const isQuarter = /quarter/.test(text);
  const isLast16 = /round of 16|last 16|1\/8/.test(text);
  const isPlayoff = /playoff|play-off|relegation play/.test(text);
  const isKnockoutWord = /knockout|elimination/.test(text);

  const isKnockout =
    isFinal || isSemi || isQuarter || isLast16 || isPlayoff || isKnockoutWord ||
    (cupRoundType != null && cupRoundType !== 0);

  const isSecondLeg = /\b(2nd|second) leg\b|leg 2|leg ii/i.test(name + " " + slug);

  let stage: string | null = null;
  if (isFinal) stage = "Final";
  else if (isSemi) stage = "Semi-final";
  else if (isQuarter) stage = "Quarter-final";
  else if (isLast16) stage = "Round of 16";
  else if (isPlayoff) stage = "Play-off";
  else if (isKnockout) stage = name || "Knockout";

  return { isKnockout, isSecondLeg, stage };
}

async function tryFindFirstLeg(
  eventId: number,
  homeId: number,
  awayId: number,
): Promise<{ home: number; away: number; eventId: number } | null> {
  // SofaScore exposes head-to-head events at /event/:id/h2h/events
  try {
    const data = await fetchSofa(`/event/${eventId}/h2h/events`);
    const events: any[] = data?.events || [];
    const candidates = events
      .filter((e) => {
        const ids = [e?.homeTeam?.id, e?.awayTeam?.id];
        return ids.includes(homeId) && ids.includes(awayId) && e?.id !== eventId;
      })
      .sort(
        (a, b) => (b?.startTimestamp || 0) - (a?.startTimestamp || 0),
      );
    // Treat the most recent meeting in the previous ~45 days as leg 1
    const now = Math.floor(Date.now() / 1000);
    const fortyFiveDays = 45 * 24 * 3600;
    const recent = candidates.find(
      (c) =>
        c?.startTimestamp &&
        now - Number(c.startTimestamp) <= fortyFiveDays &&
        (c?.status?.type === "finished" || c?.status?.code === 100),
    );
    if (!recent) return null;
    const homeWasHome = recent?.homeTeam?.id === homeId;
    const home = homeWasHome
      ? Number(recent?.homeScore?.current ?? recent?.homeScore?.display)
      : Number(recent?.awayScore?.current ?? recent?.awayScore?.display);
    const away = homeWasHome
      ? Number(recent?.awayScore?.current ?? recent?.awayScore?.display)
      : Number(recent?.homeScore?.current ?? recent?.homeScore?.display);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
    return { home, away, eventId: Number(recent.id) };
  } catch {
    return null;
  }
}

async function fetchStandings(
  uniqueTournamentId: number,
  seasonId: number,
): Promise<any[]> {
  try {
    const data = await fetchSofa(
      `/unique-tournament/${uniqueTournamentId}/season/${seasonId}/standings/total`,
    );
    const groups: any[] = data?.standings || [];
    const rows: any[] = [];
    for (const g of groups) {
      for (const r of g?.rows || []) rows.push(r);
    }
    return rows;
  } catch {
    return [];
  }
}

function classifyPressure(rows: any[], teamId: number): TeamPressure | null {
  if (!rows || rows.length === 0) return null;
  const idx = rows.findIndex((r) => Number(r?.team?.id) === Number(teamId));
  if (idx < 0) return null;
  const row = rows[idx];
  const totalTeams = rows.length;
  const position = Number(row?.position) || idx + 1;
  const points = Number(row?.points) || 0;
  const matches = Number(row?.matches) || 0;
  // Estimate matches remaining from the league: max(matches across rows) doesn't
  // give us "remaining"; assume a typical season has 2*(totalTeams-1) matches.
  const seasonMatches = Math.max(2 * (totalTeams - 1), matches);
  const matchesLeft = Math.max(0, seasonMatches - matches);

  // Find points-from boundaries
  const sortedByPos = [...rows].sort(
    (a, b) => (Number(a?.position) || 0) - (Number(b?.position) || 0),
  );
  const topRow = sortedByPos[0];
  const relStart = Math.max(0, totalTeams - 3); // assume bottom 3 relegated
  const relRow = sortedByPos[relStart] || sortedByPos[sortedByPos.length - 1];
  const safetyRow = sortedByPos[Math.max(0, relStart - 1)] || topRow;

  const pointsFromTop = topRow ? (Number(topRow.points) || 0) - points : null;
  const pointsFromSafety = safetyRow ? points - (Number(safetyRow.points) || 0) : null;

  let status: TeamPressure["status"] = "mid-table";
  let motivation = 0.4;
  const fractionDone = matches > 0 ? matches / seasonMatches : 0;

  if (position === 1 && pointsFromTop != null && pointsFromTop <= 0) {
    if (matchesLeft <= 3 && pointsFromSafety != null && pointsFromSafety > matchesLeft * 3) {
      status = "champion-clinched";
      motivation = 0.2;
    } else {
      status = "title-race";
      motivation = 0.85;
    }
  } else if (position <= 4 && pointsFromTop != null && pointsFromTop <= 6) {
    status = "title-race";
    motivation = 0.9;
  } else if (position <= Math.min(7, Math.floor(totalTeams / 2))) {
    status = "european-push";
    motivation = 0.75;
  } else if (position > totalTeams - 4) {
    if (
      pointsFromSafety != null &&
      pointsFromSafety < -matchesLeft * 3 &&
      matchesLeft <= 4
    ) {
      status = "relegated";
      motivation = 0.15;
    } else {
      status = "relegation-battle";
      motivation = 0.95;
    }
  } else if (
    pointsFromSafety != null &&
    pointsFromSafety > matchesLeft * 3 &&
    pointsFromTop != null &&
    pointsFromTop > matchesLeft * 3
  ) {
    status = "safe";
    motivation = 0.3;
  }

  // End-of-season inflates motivation for live-stakes teams,
  // suppresses it for dead-rubber sides
  if (fractionDone > 0.85) {
    if (status === "title-race" || status === "relegation-battle" || status === "european-push") {
      motivation = clamp(motivation + 0.1, 0, 1);
    } else if (status === "safe" || status === "champion-clinched" || status === "relegated") {
      motivation = clamp(motivation - 0.15, 0, 1);
    }
  }

  return {
    position,
    totalTeams,
    pointsFromSafety,
    pointsFromTop,
    status,
    motivation,
  };
}

function teamFatigue(events: any[], currentStartTimestamp: number): TeamFatigue {
  if (!events || events.length === 0) {
    return {
      daysSinceLast: null,
      matchesIn14Days: 0,
      matchesIn21Days: 0,
      fatigueIndex: 0,
    };
  }
  const past = events
    .filter(
      (e) =>
        e?.startTimestamp &&
        Number(e.startTimestamp) < currentStartTimestamp &&
        (e?.status?.type === "finished" || e?.status?.code === 100),
    )
    .sort((a, b) => Number(b.startTimestamp) - Number(a.startTimestamp));
  if (past.length === 0) {
    return {
      daysSinceLast: null,
      matchesIn14Days: 0,
      matchesIn21Days: 0,
      fatigueIndex: 0,
    };
  }
  const lastTs = Number(past[0].startTimestamp);
  const daysSinceLast = (currentStartTimestamp - lastTs) / 86400;
  const cutoff14 = currentStartTimestamp - 14 * 86400;
  const cutoff21 = currentStartTimestamp - 21 * 86400;
  const matchesIn14Days = past.filter((e) => Number(e.startTimestamp) >= cutoff14).length;
  const matchesIn21Days = past.filter((e) => Number(e.startTimestamp) >= cutoff21).length;

  // Fatigue index combines short rest + congestion
  const restPenalty = daysSinceLast < 3 ? 1 : daysSinceLast < 5 ? 0.6 : daysSinceLast < 7 ? 0.3 : 0;
  const congestion = clamp((matchesIn21Days - 4) / 4, 0, 1); // 4 in 21d is normal, 8 is brutal
  const fatigueIndex = clamp(0.55 * restPenalty + 0.45 * congestion, 0, 1);

  return { daysSinceLast: +daysSinceLast.toFixed(1), matchesIn14Days, matchesIn21Days, fatigueIndex };
}

async function fetchSubPatternForTeam(
  events: any[],
  teamId: number,
  currentStartTimestamp: number,
): Promise<SubPattern | null> {
  const past = events
    .filter(
      (e) =>
        e?.startTimestamp &&
        Number(e.startTimestamp) < currentStartTimestamp &&
        (e?.status?.type === "finished" || e?.status?.code === 100),
    )
    .sort((a, b) => Number(b.startTimestamp) - Number(a.startTimestamp))
    .slice(0, 4);
  if (past.length === 0) return null;

  const incidentResults = await Promise.allSettled(
    past.map((ev) => fetchSofa(`/event/${ev.id}/incidents`)),
  );

  const subMinutes: number[] = [];
  const firstSubMinutes: number[] = [];
  for (let i = 0; i < incidentResults.length; i++) {
    const r = incidentResults[i];
    if (r.status !== "fulfilled") continue;
    const incidents: any[] = r.value?.incidents || [];
    const ev = past[i];
    const isHome = ev?.homeTeam?.id === teamId;
    const wantSide = isHome ? true : false;
    const subs = incidents
      .filter((inc) => inc?.incidentType === "substitution" && inc?.isHome === wantSide)
      .map((inc) => Number(inc?.time))
      .filter((t) => Number.isFinite(t) && t > 0 && t <= 95)
      .sort((a, b) => a - b);
    if (subs.length === 0) continue;
    firstSubMinutes.push(subs[0]);
    for (const m of subs) subMinutes.push(m);
  }

  if (subMinutes.length === 0) return null;
  const avg = subMinutes.reduce((s, v) => s + v, 0) / subMinutes.length;
  const avgFirst = firstSubMinutes.length
    ? firstSubMinutes.reduce((s, v) => s + v, 0) / firstSubMinutes.length
    : null;
  const earlySubsRate = subMinutes.filter((m) => m <= 60).length / subMinutes.length;
  const lateSubsRate = subMinutes.filter((m) => m >= 75).length / subMinutes.length;
  // Conservative coaches make most subs after 70' and rarely before 55'
  const conservative = avgFirst != null && avgFirst >= 65 && earlySubsRate <= 0.15;

  return {
    avgFirstSubMinute: avgFirst != null ? +avgFirst.toFixed(1) : null,
    avgAllSubMinute: +avg.toFixed(1),
    earlySubsRate: +earlySubsRate.toFixed(2),
    lateSubsRate: +lateSubsRate.toFixed(2),
    conservative,
  };
}

function detectStyleClash(
  homeStyleTags: string[],
  awayStyleTags: string[],
): { description: string; lean: HalfLean } | null {
  const tags = [...homeStyleTags, ...awayStyleTags].join(" | ").toLowerCase();
  const homeLightning = /lightning starters/i.test(homeStyleTags.join(" "));
  const awayLightning = /lightning starters/i.test(awayStyleTags.join(" "));
  const homeLate = /late finishers/i.test(homeStyleTags.join(" "));
  const awayLate = /late finishers/i.test(awayStyleTags.join(" "));
  const homeFade = /fade late/i.test(homeStyleTags.join(" "));
  const awayFade = /fade late/i.test(awayStyleTags.join(" "));
  const homeSlowWake = /slow to wake/i.test(homeStyleTags.join(" "));
  const awaySlowWake = /slow to wake/i.test(awayStyleTags.join(" "));

  if (homeLate && awayLate) {
    return { description: "Both teams strongest late — 2nd half loaded", lean: "second" };
  }
  if (homeLightning && awayLightning) {
    return { description: "Both lightning starters — 1st half explosion likely", lean: "first" };
  }
  if (homeLightning && awaySlowWake) {
    return { description: `Lightning home start vs slow-to-wake away — 1st half tilt`, lean: "first" };
  }
  if (awayLightning && homeSlowWake) {
    return { description: `Lightning away start vs slow-to-wake home — 1st half tilt`, lean: "first" };
  }
  if (homeLate && awayFade) {
    return { description: "Home come alive late, away fades — 2nd half tilt", lean: "second" };
  }
  if (awayLate && homeFade) {
    return { description: "Away come alive late, home fades — 2nd half tilt", lean: "second" };
  }
  if (homeFade || awayFade) {
    return { description: "At least one team fades late — 2nd half opportunities", lean: "second" };
  }
  if (homeSlowWake || awaySlowWake) {
    return { description: "Slow-to-wake defence — 2nd half goals risk", lean: "second" };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────

export async function computeHalfContext(
  eventId: number,
  options?: {
    homeEvents?: any[];
    awayEvents?: any[];
    homeStyleTags?: string[];
    awayStyleTags?: string[];
    odds?: { homeWin?: number; draw?: number; awayWin?: number } | null;
  },
): Promise<HalfContext> {
  const eventResp = await fetchSofa(`/event/${eventId}`);
  const event = eventResp?.event;
  if (!event) throw new Error("event not found");

  const homeTeamId = Number(event?.homeTeam?.id);
  const awayTeamId = Number(event?.awayTeam?.id);
  const startTimestamp = Number(event?.startTimestamp) || Math.floor(Date.now() / 1000);
  const tournamentName = event?.tournament?.name || event?.tournament?.uniqueTournament?.name;
  const uniqueTournamentId = Number(event?.tournament?.uniqueTournament?.id) || null;
  const seasonId = Number(event?.season?.id) || null;
  const roundInfo = event?.roundInfo;

  // Knockout stage
  const ko = classifyKnockoutStage(roundInfo, tournamentName);

  // Parallel fetches
  const [homeEventsP, awayEventsP, standingsRowsP, firstLegP] = await Promise.allSettled([
    options?.homeEvents
      ? Promise.resolve(options.homeEvents)
      : fetchSofa(`/team/${homeTeamId}/events/last/0`).then((d) => d?.events || []),
    options?.awayEvents
      ? Promise.resolve(options.awayEvents)
      : fetchSofa(`/team/${awayTeamId}/events/last/0`).then((d) => d?.events || []),
    uniqueTournamentId && seasonId
      ? fetchStandings(uniqueTournamentId, seasonId)
      : Promise.resolve([] as any[]),
    ko.isSecondLeg ? tryFindFirstLeg(eventId, homeTeamId, awayTeamId) : Promise.resolve(null),
  ]);

  const homeEvents = homeEventsP.status === "fulfilled" ? homeEventsP.value : [];
  const awayEvents = awayEventsP.status === "fulfilled" ? awayEventsP.value : [];
  const standingsRows = standingsRowsP.status === "fulfilled" ? standingsRowsP.value : [];
  const firstLeg = firstLegP.status === "fulfilled" ? firstLegP.value : null;

  // Sub-patterns: only fetch if we have events (these are extra incident calls)
  const [homeSubP, awaySubP] = await Promise.allSettled([
    fetchSubPatternForTeam(homeEvents, homeTeamId, startTimestamp),
    fetchSubPatternForTeam(awayEvents, awayTeamId, startTimestamp),
  ]);
  const homeSub = homeSubP.status === "fulfilled" ? homeSubP.value : null;
  const awaySub = awaySubP.status === "fulfilled" ? awaySubP.value : null;

  // Pressure
  const homePressure = classifyPressure(standingsRows, homeTeamId);
  const awayPressure = classifyPressure(standingsRows, awayTeamId);
  const motivationDiff =
    homePressure && awayPressure ? awayPressure.motivation - homePressure.motivation : 0;

  // Fatigue
  const homeFatigue = teamFatigue(homeEvents, startTimestamp);
  const awayFatigue = teamFatigue(awayEvents, startTimestamp);
  const fatigueDiff = awayFatigue.fatigueIndex - homeFatigue.fatigueIndex;

  // Style clash
  const styleClash = detectStyleClash(
    options?.homeStyleTags || [],
    options?.awayStyleTags || [],
  );

  // Odds gap (for underdog "park the bus" effect)
  let oddsCtx: HalfContext["context"]["odds"] = null;
  if (options?.odds) {
    const { homeWin, awayWin } = options.odds;
    if (homeWin && awayWin) {
      const gap = Math.abs(Math.log(homeWin / awayWin));
      const favorite =
        homeWin < awayWin * 0.7 ? "home" : awayWin < homeWin * 0.7 ? "away" : "even";
      oddsCtx = { favorite, gap: clamp(gap / 2.0, 0, 1) };
    }
  }

  // Stage modifier — finals & second legs trend toward cagey 1H, decisive 2H
  const stageLabel = ko.stage || (ko.isKnockout ? "Knockout" : "League");
  let stageModifier: HalfLean | null = null;
  if (ko.isKnockout) stageModifier = "second"; // knockout → cagey 1H, opens 2H
  if (ko.stage === "Final" || ko.stage === "Semi-final") stageModifier = "second";

  // Aggregate context (derived for second legs)
  let aggLead: { team: "home" | "away" | null; goals: number } | null = null;
  let trailingNeedsGoals = false;
  if (ko.isSecondLeg && firstLeg) {
    // In second leg, the team that played AT HOME in leg 1 (= the away team here)
    // carried the leg 1 score from their venue. Aggregate is straightforward sum.
    // We approximate: leg1 score reported as "home (this match's home in leg1)
    // vs away (this match's away in leg1)" — best we can do without knowing venue swap.
    // In most 2-leg formats the venues swap, so first leg's home was leg2's away.
    // Treat firstLeg.home as "away team's home leg score" and firstLeg.away as "home team's away leg score":
    const homeLegScore = firstLeg.away; // this match's home team played away in leg 1
    const awayLegScore = firstLeg.home; // this match's away team played at home in leg 1
    if (homeLegScore > awayLegScore) {
      aggLead = { team: "home", goals: homeLegScore - awayLegScore };
    } else if (awayLegScore > homeLegScore) {
      aggLead = { team: "away", goals: awayLegScore - homeLegScore };
    } else {
      aggLead = { team: null, goals: 0 };
    }
    trailingNeedsGoals = aggLead.goals >= 1;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Build signals
  // ─────────────────────────────────────────────────────────────────────
  const signals: ContextSignal[] = [];

  // 1) Knockout / aggregate
  if (ko.isKnockout) {
    if (ko.stage === "Final") {
      signals.push({
        kind: "stage",
        label: "Final — typically cagey 1st half, decisive 2nd half",
        leans: "second",
        weight: 0.6,
      });
    } else if (ko.stage === "Semi-final") {
      signals.push({
        kind: "stage",
        label: "Semi-final — high stakes, tight 1st half",
        leans: "second",
        weight: 0.5,
      });
    } else {
      signals.push({
        kind: "stage",
        label: `${ko.stage || "Knockout"} — knockouts skew goals to 2nd half`,
        leans: "second",
        weight: 0.35,
      });
    }
  }

  if (ko.isSecondLeg && firstLeg && aggLead) {
    if (aggLead.goals === 0) {
      signals.push({
        kind: "aggregate",
        label: `Aggregate level after leg 1 (${firstLeg.home}-${firstLeg.away}) — extra time risk → 2nd half explodes`,
        leans: "second",
        weight: 0.7,
      });
    } else {
      const trailingName = aggLead.team === "home" ? "Away team" : "Home team";
      const w = clamp(0.4 + aggLead.goals * 0.15, 0.4, 0.85);
      signals.push({
        kind: "aggregate",
        label: `${trailingName} trails ${aggLead.goals} on aggregate after leg 1 (${firstLeg.home}-${firstLeg.away}) — must chase, 2nd half opens up`,
        leans: "second",
        weight: w,
      });
    }
  }

  // 2) Standings / motivation asymmetry
  if (homePressure) {
    if (homePressure.status === "champion-clinched" || homePressure.status === "relegated" || homePressure.status === "safe") {
      signals.push({
        kind: "pressure",
        label: `Home team in "${homePressure.status}" mode — likely lower 2nd-half intensity`,
        leans: "first",
        weight: 0.3,
      });
    } else if (homePressure.status === "title-race" || homePressure.status === "relegation-battle") {
      signals.push({
        kind: "pressure",
        label: `Home in ${homePressure.status} — desperate 2nd-half push`,
        leans: "second",
        weight: 0.4,
      });
    }
  }
  if (awayPressure) {
    if (awayPressure.status === "champion-clinched" || awayPressure.status === "relegated" || awayPressure.status === "safe") {
      signals.push({
        kind: "pressure",
        label: `Away team in "${awayPressure.status}" mode — likely lower 2nd-half intensity`,
        leans: "first",
        weight: 0.3,
      });
    } else if (awayPressure.status === "title-race" || awayPressure.status === "relegation-battle") {
      signals.push({
        kind: "pressure",
        label: `Away in ${awayPressure.status} — desperate 2nd-half push`,
        leans: "second",
        weight: 0.4,
      });
    }
  }

  if (Math.abs(motivationDiff) >= 0.4) {
    const desperateName = motivationDiff > 0 ? "Away team" : "Home team";
    signals.push({
      kind: "motivation-asymmetry",
      label: `Motivation asymmetry — ${desperateName} needs the result much more, will over-extend in 2nd half`,
      leans: "second",
      weight: clamp(Math.abs(motivationDiff), 0.3, 0.8),
    });
  } else if (
    homePressure?.status === "safe" &&
    awayPressure?.status === "safe" &&
    standingsRows.length > 0
  ) {
    signals.push({
      kind: "dead-rubber",
      label: "Both teams have nothing to play for — quiet match expected, slight 1st-half tilt",
      leans: "first",
      weight: 0.35,
    });
  }

  // 3) Fatigue / congestion
  if (homeFatigue.fatigueIndex >= 0.5) {
    signals.push({
      kind: "fatigue",
      label: `Home team fatigued (${homeFatigue.matchesIn21Days} matches in 21 days, ${homeFatigue.daysSinceLast}d rest) — late defensive collapse risk`,
      leans: "second",
      weight: clamp(homeFatigue.fatigueIndex * 0.7, 0.3, 0.7),
    });
  }
  if (awayFatigue.fatigueIndex >= 0.5) {
    signals.push({
      kind: "fatigue",
      label: `Away team fatigued (${awayFatigue.matchesIn21Days} matches in 21 days, ${awayFatigue.daysSinceLast}d rest) — late defensive collapse risk`,
      leans: "second",
      weight: clamp(awayFatigue.fatigueIndex * 0.7, 0.3, 0.7),
    });
  }
  if (Math.abs(fatigueDiff) >= 0.35) {
    const tiredSide = fatigueDiff > 0 ? "Away team" : "Home team";
    signals.push({
      kind: "fatigue-asymmetry",
      label: `${tiredSide} much more fatigued — 2nd half exploitation likely`,
      leans: "second",
      weight: clamp(Math.abs(fatigueDiff) * 0.8, 0.3, 0.65),
    });
  }

  // 4) Sub patterns
  if (homeSub && homeSub.conservative) {
    signals.push({
      kind: "sub-pattern",
      label: `Home coach is conservative (avg first sub ${homeSub.avgFirstSubMinute}') — protects leads, dampens 2nd half scoring`,
      leans: "first",
      weight: 0.35,
    });
  }
  if (awaySub && awaySub.conservative) {
    signals.push({
      kind: "sub-pattern",
      label: `Away coach is conservative (avg first sub ${awaySub.avgFirstSubMinute}') — protects leads, dampens 2nd half scoring`,
      leans: "first",
      weight: 0.35,
    });
  }
  if (homeSub && homeSub.lateSubsRate >= 0.55) {
    signals.push({
      kind: "sub-pattern",
      label: `Home brings on impact subs late (${Math.round(homeSub.lateSubsRate * 100)}% of subs after 75')`,
      leans: "second",
      weight: 0.3,
    });
  }
  if (awaySub && awaySub.lateSubsRate >= 0.55) {
    signals.push({
      kind: "sub-pattern",
      label: `Away brings on impact subs late (${Math.round(awaySub.lateSubsRate * 100)}% of subs after 75')`,
      leans: "second",
      weight: 0.3,
    });
  }

  // 5) Style clash
  if (styleClash) {
    signals.push({
      kind: "style-clash",
      label: styleClash.description,
      leans: styleClash.lean,
      weight: 0.5,
    });
  }

  // 6) Underdog "park the bus" — heavy favorite forced to chase often → 2H
  if (oddsCtx && oddsCtx.gap >= 0.5 && oddsCtx.favorite !== "even") {
    signals.push({
      kind: "underdog",
      label: `Heavy favorite (${oddsCtx.favorite === "home" ? "home" : "away"}) — underdog likely parks the bus, favourite throws bodies forward in 2nd half`,
      leans: "second",
      weight: clamp(oddsCtx.gap * 0.6, 0.3, 0.6),
    });
  }

  return {
    signals,
    context: {
      knockout: {
        isKnockout: ko.isKnockout,
        stage: ko.stage,
        isSecondLeg: ko.isSecondLeg,
        aggregateLead: aggLead,
        trailingNeedsGoals,
        legOneScore: firstLeg ? { home: firstLeg.home, away: firstLeg.away } : null,
      },
      pressure: {
        home: homePressure,
        away: awayPressure,
        asymmetry: +motivationDiff.toFixed(2),
      },
      fatigue: {
        home: homeFatigue,
        away: awayFatigue,
        asymmetry: +fatigueDiff.toFixed(2),
      },
      subPatterns: {
        home: homeSub,
        away: awaySub,
      },
      styleClash,
      odds: oddsCtx,
      stage: { label: stageLabel, modifier: stageModifier },
      derby: { is: false, reason: null },
    },
  };
}
