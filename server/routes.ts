import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import db from "./db";
import engine, { extractFeatures, FEATURE_NAMES } from "./xgEngine";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SOFASCORE_API = "https://api.sofascore.com/api/v1";

type ProcessingJob = {
  id: string;
  status: "running" | "completed" | "cancelled";
  total: number;
  processed: number;
  stored: number;
  skipped: number;
  failed: number;
  log: string[];
  cancelRequested: boolean;
};

const jobs = new Map<string, ProcessingJob>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SOFASCORE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.sofascore.com/",
  Origin: "https://www.sofascore.com",
  "Cache-Control": "no-cache",
};

async function fetchSofaScore(endpoint: string) {
  const url = `${SOFASCORE_API}${endpoint}`;
  const res = await fetch(url, { headers: SOFASCORE_HEADERS });
  if (!res.ok) {
    throw new Error(`SofaScore API error: ${res.status}`);
  }
  return res.json();
}

async function fetchTeamLastEvents(teamId: number): Promise<any[]> {
  const pages = [0, 1, 2];
  const results = await Promise.allSettled(
    pages.map((page) => fetchSofaScore(`/team/${teamId}/events/last/${page}`))
  );
  const seen = new Set<number>();
  const events: any[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const event of result.value?.events || []) {
        if (event?.id && !seen.has(event.id)) {
          seen.add(event.id);
          events.push(event);
        }
      }
    }
  }
  return events;
}

function readEventScore(score: any): number | null {
  const value = Number(score?.current ?? score?.display ?? score?.normaltime);
  return Number.isFinite(value) ? value : null;
}

function selectLastPlayedTeamMatches(events: any[], teamId: number, currentStartTimestamp?: number): any[] {
  return events
    .filter((event: any) => {
      const startTimestamp = Number(event.startTimestamp);
      const isTeamMatch = event.homeTeam?.id === teamId || event.awayTeam?.id === teamId;
      const isBeforeCurrent = currentStartTimestamp ? startTimestamp < currentStartTimestamp : true;
      const hasScore = readEventScore(event.homeScore) !== null && readEventScore(event.awayScore) !== null;
      const isFinished = event.status?.type === "finished" || hasScore;
      return isTeamMatch && isBeforeCurrent && isFinished;
    })
    .sort((a: any, b: any) => Number(b.startTimestamp || 0) - Number(a.startTimestamp || 0))
    .slice(0, 15);
}

async function proxyImage(imageUrl: string, res: Response) {
  try {
    const response = await fetch(imageUrl, { headers: SOFASCORE_HEADERS });
    if (!response.ok) {
      return res.status(response.status).send("Image not found");
    }
    const contentType = response.headers.get("content-type") || "image/png";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(500).send("Error fetching image");
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.get(
    "/api/sport/:sport/scheduled-events/:date",
    async (req: Request, res: Response) => {
      try {
        const { sport, date } = req.params;
        const data = await fetchSofaScore(
          `/sport/${sport}/scheduled-events/${date}`,
        );
        res.json(data);
      } catch (error: any) {
        console.error("Error fetching scheduled events:", error.message);
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get("/api/event/:eventId", async (req: Request, res: Response) => {
    try {
      const data = await fetchSofaScore(`/event/${req.params.eventId}`);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get(
    "/api/event/:eventId/incidents",
    async (req: Request, res: Response) => {
      try {
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/incidents`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/lineups",
    async (req: Request, res: Response) => {
      try {
        const { eventId } = req.params;
        const [eventResult, currentLineupsResult] = await Promise.allSettled([
          fetchSofaScore(`/event/${eventId}`),
          fetchSofaScore(`/event/${eventId}/lineups`),
        ]);

        const eventData: any = eventResult.status === "fulfilled" ? eventResult.value : null;
        const currentLineups: any = currentLineupsResult.status === "fulfilled" ? currentLineupsResult.value : null;
        const event = eventData?.event;
        const homeTeamId = Number(event?.homeTeam?.id);
        const awayTeamId = Number(event?.awayTeam?.id);

        const hasProviderLineup = (side: "home" | "away") =>
          (currentLineups?.[side]?.players || []).some((entry: any) => !entry.substitute);

        if (!event || !homeTeamId || !awayTeamId || (hasProviderLineup("home") && hasProviderLineup("away"))) {
          return res.json(currentLineups || { confirmed: false, home: { players: [] }, away: { players: [] } });
        }

        const [homeEventsAll, awayEventsAll] = await Promise.all([
          fetchTeamLastEvents(homeTeamId),
          fetchTeamLastEvents(awayTeamId),
        ]);

        const currentStartTimestamp = Number(event?.startTimestamp) || undefined;
        const homeLast15: any[] = selectLastPlayedTeamMatches(
          homeEventsAll,
          homeTeamId,
          currentStartTimestamp,
        );
        const awayLast15: any[] = selectLastPlayedTeamMatches(
          awayEventsAll,
          awayTeamId,
          currentStartTimestamp,
        );
        const historicalEventIds = Array.from(
          new Set([...homeLast15, ...awayLast15].map((pastEvent: any) => pastEvent.id).filter(Boolean)),
        );
        const historicalLineupResults = await Promise.allSettled(
          historicalEventIds.map((id) => fetchSofaScore(`/event/${id}/lineups`)),
        );
        const lineupsByEventId = new Map<number, any>();
        historicalEventIds.forEach((id, index) => {
          const result = historicalLineupResults[index];
          if (result.status === "fulfilled") lineupsByEventId.set(id, result.value);
        });

        type PlayerHistory = {
          playerId: number;
          name: string;
          position: string;
          appearances: number;
          starts: number;
          last5Appearances: number;
          last5Starts: number;
          weightedAppearances: number;
          weightedStarts: number;
          sameVenueStarts: number;
          ratings: number[];
          recentRatings: number[];
          latestPlayer: any;
          jerseyNumber?: number;
        };

        function getTeamSide(pastEvent: any, teamId: number): "home" | "away" | null {
          if (pastEvent.homeTeam?.id === teamId) return "home";
          if (pastEvent.awayTeam?.id === teamId) return "away";
          return null;
        }

        function recencyWeight(index: number): number {
          if (index < 5) return 3;
          if (index < 10) return 2;
          return 1;
        }

        function playerRole(position?: string): "keeper" | "defender" | "midfielder" | "attacker" {
          const value = (position || "").toLowerCase();
          if (value === "g" || value.includes("goal")) return "keeper";
          if (value.startsWith("d")) return "defender";
          if (value.startsWith("m")) return "midfielder";
          return "attacker";
        }

        function round1(value: number): number {
          return Math.round(value * 10) / 10;
        }

        function average(values: number[]): number | null {
          return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        }

        function readScore(score: any): number | null {
          const value = Number(score?.current ?? score?.display ?? score?.normaltime);
          return Number.isFinite(value) ? value : null;
        }

        function calculateTeamForm(events: any[], teamId: number) {
          const results = events
            .map((event: any) => {
              const side = getTeamSide(event, teamId);
              if (!side) return null;
              const homeScore = readScore(event.homeScore);
              const awayScore = readScore(event.awayScore);
              if (homeScore === null || awayScore === null) return null;
              const goalsFor = side === "home" ? homeScore : awayScore;
              const goalsAgainst = side === "home" ? awayScore : homeScore;
              const margin = goalsFor - goalsAgainst;
              const isWin = margin > 0;
              const isDraw = margin === 0;
              const isCleanSheet = goalsAgainst === 0;
              const isNilNil = goalsFor === 0 && goalsAgainst === 0;
              let points = isWin ? 3 : isDraw ? 1 : 0;
              if (isWin && margin >= 2) points += 2;
              if (isCleanSheet) points += 1;
              if (isDraw) points -= 1;
              if (isNilNil) points -= 1;
              return {
                points,
                goalsFor,
                goalsAgainst,
                result: isWin ? "W" : isDraw ? "D" : "L",
                cleanSheet: isCleanSheet,
                margin,
              };
            })
            .filter(Boolean) as {
              points: number;
              goalsFor: number;
              goalsAgainst: number;
              result: "W" | "D" | "L";
              cleanSheet: boolean;
              margin: number;
            }[];

          const matches = results.length;
          const totalPoints = results.reduce((sum, result) => sum + result.points, 0);
          const goalsFor = results.reduce((sum, result) => sum + result.goalsFor, 0);
          const goalsAgainst = results.reduce((sum, result) => sum + result.goalsAgainst, 0);
          const cleanSheets = results.filter((result) => result.cleanSheet).length;
          const bigWins = results.filter((result) => result.margin >= 2).length;
          const goalsForPerMatch = matches > 0 ? goalsFor / matches : 0;
          const goalsAgainstPerMatch = matches > 0 ? goalsAgainst / matches : 0;
          const cleanSheetRate = matches > 0 ? cleanSheets / matches : 0;
          const scoringRate = matches > 0 ? results.filter((result) => result.goalsFor > 0).length / matches : 0;

          return {
            formPoints: totalPoints,
            formStrength: matches > 0 ? round1(clamp(4 + (totalPoints / (matches * 6)) * 6, 3, 10)) : null,
            scoringStrength: matches > 0 ? round1(clamp(4 + (goalsForPerMatch / 2.5) * 4 + scoringRate * 1.2 + (bigWins / matches) * 0.8, 3, 10)) : null,
            defendingStrength: matches > 0 ? round1(clamp(4 + cleanSheetRate * 3.4 + Math.max(0, 2 - goalsAgainstPerMatch) * 1.3, 3, 10)) : null,
            goalsFor,
            goalsAgainst,
            cleanSheets,
            matches,
            recentForm: results.slice(0, 7).map((result) => result.result),
          };
        }

        function readRating(entry: any): number | null {
          const value = Number(entry.statistics?.rating ?? entry.avgRating);
          return Number.isFinite(value) && value > 0 ? value : null;
        }

        function parseFormationParts(formation?: string): number[] {
          return (formation || "")
            .split("-")
            .map((part) => Number(part.trim()))
            .filter((value) => Number.isFinite(value) && value > 0);
        }

        function deriveFormationFromPlayers(players: any[]): string {
          const defenders = players.filter((entry) => playerRole(entry.position) === "defender").length;
          const midfielders = players.filter((entry) => playerRole(entry.position) === "midfielder").length;
          const attackers = players.filter((entry) => playerRole(entry.position) === "attacker").length;
          if (defenders && midfielders && attackers) return `${defenders}-${midfielders}-${attackers}`;
          return "4-3-3";
        }

        function getUnavailableIds(side: "home" | "away"): Set<number> {
          return new Set(
            (currentLineups?.[side]?.missingPlayers || [])
              .map((entry: any) => Number(entry.player?.id))
              .filter(Boolean),
          );
        }

        function collectTeamHistory(
          events: any[],
          teamId: number,
          targetVenueSide: "home" | "away",
        ): { history: Map<number, PlayerHistory>; formation: string; formationMatches: number } {
          const history = new Map<number, PlayerHistory>();
          const formationScores = new Map<string, { score: number; matches: number }>();

          events.forEach((pastEvent, index) => {
            const side = getTeamSide(pastEvent, teamId);
            if (!side) return;
            const lineup = lineupsByEventId.get(pastEvent.id)?.[side];
            const players = lineup?.players || [];
            const starters = players.filter((entry: any) => !entry.substitute);
            const weight = recencyWeight(index);
            const venueMultiplier = side === targetVenueSide ? 1.25 : 1;
            const formation = lineup?.formation || deriveFormationFromPlayers(starters);

            if (formation && starters.length >= 9) {
              const current = formationScores.get(formation) || { score: 0, matches: 0 };
              current.score += weight * venueMultiplier;
              current.matches += 1;
              formationScores.set(formation, current);
            }

            players.forEach((entry: any) => {
              const playerId = Number(entry.player?.id);
              if (!playerId) return;
              const substitute = !!entry.substitute;
              const current = history.get(playerId) || {
                playerId,
                name: entry.player?.shortName || entry.player?.name || "Player",
                position: entry.position || entry.player?.position || "",
                appearances: 0,
                starts: 0,
                last5Appearances: 0,
                last5Starts: 0,
                weightedAppearances: 0,
                weightedStarts: 0,
                sameVenueStarts: 0,
                ratings: [],
                recentRatings: [],
                latestPlayer: entry.player,
                jerseyNumber: entry.jerseyNumber || entry.player?.jerseyNumber,
              };

              current.appearances += 1;
              current.weightedAppearances += weight;
              if (!substitute) {
                current.starts += 1;
                current.weightedStarts += weight * venueMultiplier;
                if (side === targetVenueSide) current.sameVenueStarts += 1;
              }
              if (index < 5) {
                current.last5Appearances += 1;
                if (!substitute) current.last5Starts += 1;
              }
              const rating = readRating(entry);
              if (rating) {
                current.ratings.push(rating);
                if (index < 5) current.recentRatings.push(rating);
              }
              current.position = current.position || entry.position || entry.player?.position || "";
              current.latestPlayer = entry.player || current.latestPlayer;
              current.jerseyNumber = current.jerseyNumber || entry.jerseyNumber || entry.player?.jerseyNumber;
              history.set(playerId, current);
            });
          });

          const preferredFormation = Array.from(formationScores.entries()).sort((a, b) => b[1].score - a[1].score)[0];
          return {
            history,
            formation: preferredFormation?.[0] || "4-3-3",
            formationMatches: preferredFormation?.[1].matches || 0,
          };
        }

        function buildLikelyLineup(side: "home" | "away", events: any[], teamId: number) {
          const unavailableIds = getUnavailableIds(side);
          const { history, formation, formationMatches } = collectTeamHistory(events, teamId, side);
          const formationParts = parseFormationParts(formation);
          const defenderCount = formationParts[0] || 4;
          const attackerCount = formationParts.length > 1 ? formationParts[formationParts.length - 1] : 3;
          const midfielderCount = Math.max(10 - defenderCount - attackerCount, 0);
          const availablePlayers = Array.from(history.values()).filter((player) => !unavailableIds.has(player.playerId));
          const matchesAnalyzed = events.length || 1;
          const recentMatchCount = Math.min(5, matchesAnalyzed);

          const predictedRating = (player: PlayerHistory) => {
            const recentAverage = average(player.recentRatings);
            const fullAverage = average(player.ratings);
            if (recentAverage && fullAverage) return round1(recentAverage * 0.6 + fullAverage * 0.4);
            if (recentAverage || fullAverage) return round1(recentAverage || fullAverage || 6);
            const startRate = player.starts / matchesAnalyzed;
            const recentStartRate = recentMatchCount > 0 ? player.last5Starts / recentMatchCount : 0;
            return round1(Math.max(5.8, Math.min(7.4, 5.8 + startRate * 0.8 + recentStartRate * 0.8)));
          };

          const lineupScore = (player: PlayerHistory) => {
            const rating = predictedRating(player);
            const coreBonus = player.starts >= 12 ? 14 : player.starts >= 10 ? 8 : 0;
            return (
              player.weightedStarts * 4.5 +
              player.last5Starts * 7 +
              player.sameVenueStarts * 1.6 +
              player.weightedAppearances * 0.8 +
              rating * 2 +
              coreBonus
            );
          };

          const confidence = (player: PlayerHistory) => {
            const startRate = player.starts / matchesAnalyzed;
            const recentStartRate = recentMatchCount > 0 ? player.last5Starts / recentMatchCount : 0;
            const score = startRate * 0.45 + recentStartRate * 0.4 + Math.min(1, player.sameVenueStarts / 5) * 0.15;
            if (score >= 0.72 || player.starts >= 12) return "High";
            if (score >= 0.42 || player.last5Starts >= 2) return "Medium";
            return "Low";
          };

          const usedIds = new Set<number>();
          const takeRole = (role: "keeper" | "defender" | "midfielder" | "attacker", count: number) => {
            const selected = availablePlayers
              .filter((player) => !usedIds.has(player.playerId) && playerRole(player.position) === role)
              .sort((a, b) => lineupScore(b) - lineupScore(a))
              .slice(0, count);
            selected.forEach((player) => usedIds.add(player.playerId));
            return selected;
          };

          const starters = [
            ...takeRole("keeper", 1),
            ...takeRole("defender", defenderCount),
            ...takeRole("midfielder", midfielderCount),
            ...takeRole("attacker", attackerCount),
          ];

          if (starters.length < 11) {
            const fallbackPlayers = availablePlayers
              .filter((player) => !usedIds.has(player.playerId))
              .sort((a, b) => lineupScore(b) - lineupScore(a))
              .slice(0, 11 - starters.length);
            fallbackPlayers.forEach((player) => usedIds.add(player.playerId));
            starters.push(...fallbackPlayers);
          }

          const substitutes = availablePlayers
            .filter((player) => !usedIds.has(player.playerId))
            .sort((a, b) => lineupScore(b) - lineupScore(a))
            .slice(0, 12);

          const toEntry = (player: PlayerHistory, substitute: boolean) => {
            const rating = predictedRating(player);
            return {
              player: player.latestPlayer || { id: player.playerId, shortName: player.name, name: player.name },
              position: player.position || "M",
              substitute,
              jerseyNumber: Number(player.jerseyNumber) || 0,
              statistics: { rating },
              avgRating: rating,
              predictionConfidence: confidence(player),
              likelyLineupReason: substitute
                ? `Bench candidate: ${player.appearances}/15 appearances, ${player.last5Appearances}/5 recent appearances`
                : player.starts >= 12
                ? `Core starter: ${player.starts}/15 starts and available`
                : player.last5Starts >= 3
                ? `Recent starter: ${player.last5Starts}/5 starts and fits ${formation}`
                : `Best available ${playerRole(player.position)} for ${formation}`,
              lineupScore: round1(lineupScore(player)),
            };
          };

          return {
            formation,
            players: [...starters.map((player) => toEntry(player, false)), ...substitutes.map((player) => toEntry(player, true))],
            missingPlayers: currentLineups?.[side]?.missingPlayers || [],
            isLikely: true,
            lineupSource: "weighted_last_15_recent_5_availability_model",
            predictionSummary: {
              matchesAnalyzed: events.length,
              formationMatches,
              unavailableCount: unavailableIds.size,
              method: "Last 15 weighted 3x/2x/1x, current venue formation preference, last 5 activity, injury/suspension removal, role-by-role selection",
            },
          };
        }

        const home = hasProviderLineup("home") ? currentLineups.home : buildLikelyLineup("home", homeLast15, homeTeamId);
        const away = hasProviderLineup("away") ? currentLineups.away : buildLikelyLineup("away", awayLast15, awayTeamId);

        res.json({
          confirmed: hasProviderLineup("home") && hasProviderLineup("away") ? currentLineups?.confirmed ?? false : false,
          home,
          away,
          source: "provider_lineups_with_weighted_likely_lineup_fallback",
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/player-simulation",
    async (req: Request, res: Response) => {
      try {
        const { eventId } = req.params;
        const homeTeamId = Number(req.query.homeTeamId);
        const awayTeamId = Number(req.query.awayTeamId);

        if (!homeTeamId || !awayTeamId) {
          return res.status(400).json({ error: "homeTeamId and awayTeamId are required" });
        }

        const [[currentEventResult, currentLineupsResult], homeEvents, awayEvents] = await Promise.all([
          Promise.allSettled([
            fetchSofaScore(`/event/${eventId}`),
            fetchSofaScore(`/event/${eventId}/lineups`),
          ]),
          fetchTeamLastEvents(homeTeamId),
          fetchTeamLastEvents(awayTeamId),
        ]);

        const currentEvent: any = currentEventResult.status === "fulfilled" ? currentEventResult.value?.event : null;
        const currentLineups: any = currentLineupsResult.status === "fulfilled" ? currentLineupsResult.value : null;
        const currentStartTimestamp = Number(currentEvent?.startTimestamp) || undefined;
        const homeLast15 = selectLastPlayedTeamMatches(homeEvents, homeTeamId, currentStartTimestamp);
        const awayLast15 = selectLastPlayedTeamMatches(awayEvents, awayTeamId, currentStartTimestamp);

        const historicalEventIds = Array.from(
          new Set([...homeLast15, ...awayLast15].map((event: any) => event.id).filter(Boolean)),
        );

        const historicalLineupResults = await Promise.allSettled(
          historicalEventIds.map((id) => fetchSofaScore(`/event/${id}/lineups`)),
        );

        const lineupsByEventId = new Map<number, any>();
        historicalEventIds.forEach((id, index) => {
          const result = historicalLineupResults[index];
          if (result.status === "fulfilled") lineupsByEventId.set(id, result.value);
        });

        const last15EventIds = Array.from(new Set([...homeLast15, ...awayLast15].map((e: any) => e.id).filter(Boolean)));

        const statsResults = await Promise.allSettled(
          last15EventIds.map((id) => fetchSofaScore(`/event/${id}/statistics`)),
        );
        const statsByEventId = new Map<number, any>();
        last15EventIds.forEach((id, index) => {
          const result = statsResults[index];
          if (result.status === "fulfilled") statsByEventId.set(id, result.value);
        });

        function parseStatNum(value: any): number | null {
          if (value === null || value === undefined || value === "") return null;
          const str = String(value).trim();
          // Handle "X/Y" fraction format — return the numerator (e.g. "518/639" → 518)
          const slashIdx = str.indexOf("/");
          if (slashIdx > 0) {
            const numerator = parseFloat(str.slice(0, slashIdx).replace(/[^0-9.]/g, ""));
            return Number.isFinite(numerator) ? numerator : null;
          }
          const clean = str.replace(/[^0-9.\-]/g, "");
          const num = parseFloat(clean);
          return Number.isFinite(num) ? num : null;
        }

        function extractPeriodStats(statisticsData: any, side: "home" | "away", period: "ALL" | "1ST" | "2ND"): Record<string, number> {
          const statMap: Record<string, number> = {};
          const periodData = (statisticsData?.statistics || []).find((p: any) => p.period === period);
          if (!periodData) return statMap;
          for (const group of (periodData.groups || [])) {
            for (const item of (group.statisticsItems || [])) {
              const rawName = (item.name || "").toLowerCase().trim();
              if (!rawName) continue;
              const val = parseStatNum(item[side]);
              if (val !== null) statMap[rawName] = val;
              // Also derive a percentage variant from API-provided percentage or value/total
              const sidePct = side === "home" ? item.homePercentage : item.awayPercentage;
              const sideVal = side === "home" ? item.homeValue : item.awayValue;
              const sideTotal = side === "home" ? item.homeTotal : item.awayTotal;
              if (sidePct !== null && sidePct !== undefined && Number.isFinite(Number(sidePct))) {
                statMap[rawName + " %"] = Number(sidePct);
              } else if (sideVal != null && sideTotal != null && Number(sideTotal) > 0) {
                const pct = Math.round((Number(sideVal) / Number(sideTotal)) * 1000) / 10;
                statMap[rawName + " %"] = pct;
              }
            }
          }
          return statMap;
        }

        type PeriodStats = {
          avgGoalsScored: number | null;
          avgGoalsConceded: number | null;
          avgPossession: number | null;
          avgXg: number | null;
          avgBigChances: number | null;
          avgTotalShots: number | null;
          avgShotsOnTarget: number | null;
          avgShotsOffTarget: number | null;
          avgBlockedShots: number | null;
          avgShotsInsideBox: number | null;
          avgBigChancesScored: number | null;
          avgBigChancesMissed: number | null;
          avgCornerKicks: number | null;
          avgGoalkeeperSaves: number | null;
          avgGoalsPrevented: number | null;
          avgPassAccuracy: number | null;
          avgTacklesWon: number | null;
          avgInterceptions: number | null;
          avgClearances: number | null;
          avgFouls: number | null;
          avgTotalPasses: number | null;
          avgTouchesInOppositionBox: number | null;
          avgDuelsWon: number | null;
          matchesWithStats: number;
        };

        type TeamMatchStats = {
          all: PeriodStats;
          firstHalf: PeriodStats;
          secondHalf: PeriodStats;
          matchesAnalyzed: number;
        };

        function buildPeriodSamples(
          events: any[],
          teamId: number,
          period: "ALL" | "1ST" | "2ND",
          goalScoreKey: "full" | "period1" | "period2",
        ): { samples: Record<string, number[]>; matchesWithStats: number; goalScored: number[]; goalConceded: number[] } {
          const samples: Record<string, number[]> = {};
          const goalScored: number[] = [];
          const goalConceded: number[] = [];
          let matchesWithStats = 0;

          const addS = (key: string, val: number | null) => {
            if (val !== null) { if (!samples[key]) samples[key] = []; samples[key].push(val); }
          };

          const readGoalScore = (score: any): number | null => {
            if (goalScoreKey === "full") {
              const v = Number(score?.current ?? score?.display ?? score?.normaltime);
              return Number.isFinite(v) ? v : null;
            }
            const v = Number(score?.[goalScoreKey]);
            return Number.isFinite(v) ? v : null;
          };

          events.forEach((event: any) => {
            const isHome = event.homeTeam?.id === teamId;
            const isAway = event.awayTeam?.id === teamId;
            if (!isHome && !isAway) return;
            const side: "home" | "away" = isHome ? "home" : "away";
            const oppSide: "home" | "away" = isHome ? "away" : "home";

            const teamGoals = readGoalScore(isHome ? event.homeScore : event.awayScore);
            const oppGoals = readGoalScore(isHome ? event.awayScore : event.homeScore);
            if (teamGoals !== null) goalScored.push(teamGoals);
            if (oppGoals !== null) goalConceded.push(oppGoals);

            const statsData = statsByEventId.get(event.id);
            if (!statsData) return;
            const s = extractPeriodStats(statsData, side, period);
            if (Object.keys(s).length === 0) return;
            matchesWithStats += 1;
            const get = (keys: string[]): number | null => {
              for (const k of keys) {
                const found = Object.keys(s).find((name) => name === k || name.includes(k));
                if (found !== undefined) return s[found];
              }
              return null;
            };
            addS("possession", get(["ball possession"]));
            addS("xg", get(["expected goals (xg)", "expected goals"]));
            addS("bigChances", get(["big chances"]));
            addS("totalShots", get(["total shots", "shots total"]));
            addS("shotsOnTarget", get(["shots on target"]));
            addS("shotsOffTarget", get(["shots off target"]));
            addS("blockedShots", get(["blocked shots"]));
            addS("shotsInsideBox", get(["shots inside box"]));
            addS("bigChancesScored", get(["big chances scored"]));
            addS("bigChancesMissed", get(["big chances missed"]));
            addS("cornerKicks", get(["corner kicks"]));
            addS("goalkeeperSaves", get(["goalkeeper saves"]));
            addS("goalsPrevented", get(["goals prevented"]));
            // Pass accuracy: try direct stat first, then compute from accurate/total ratio
            const directPassAcc = get(["pass accuracy", "passes %", "accurate passes %"]);
            const accuratePassesCount = get(["accurate passes"]);
            const totalPassesCount = get(["total passes", "passes"]);
            if (directPassAcc !== null) {
              addS("passAccuracy", directPassAcc);
            } else if (accuratePassesCount !== null && totalPassesCount !== null && totalPassesCount > 0) {
              addS("passAccuracy", Math.round((accuratePassesCount / totalPassesCount) * 1000) / 10);
            }
            addS("totalPasses", totalPassesCount);
            addS("tacklesWon", get(["tackles won", "tackles %", "tackles won %"]));
            addS("interceptions", get(["interceptions"]));
            addS("clearances", get(["clearances"]));
            addS("fouls", get(["fouls"]));
            addS("touchesOpBox", get(["touches in opposition box", "touches in opp. box"]));
            addS("duelsWon", get(["total duels won", "duels won", "duels %", "duels"]));
          });

          return { samples, matchesWithStats, goalScored, goalConceded };
        }

        function avgArr(vals: number[]): number | null {
          return vals.length > 0 ? round1(vals.reduce((s2, v) => s2 + v, 0) / vals.length) : null;
        }

        function periodStatsToPeriodStats(
          events: any[],
          teamId: number,
          period: "ALL" | "1ST" | "2ND",
          goalScoreKey: "full" | "period1" | "period2",
        ): PeriodStats {
          const { samples, matchesWithStats, goalScored, goalConceded } = buildPeriodSamples(events, teamId, period, goalScoreKey);
          const avg = (key: string): number | null => {
            const vals = samples[key];
            return vals && vals.length > 0 ? round1(vals.reduce((s2, v) => s2 + v, 0) / vals.length) : null;
          };
          return {
            avgGoalsScored: avgArr(goalScored),
            avgGoalsConceded: avgArr(goalConceded),
            avgPossession: avg("possession"),
            avgXg: avg("xg"),
            avgBigChances: avg("bigChances"),
            avgTotalShots: avg("totalShots"),
            avgShotsOnTarget: avg("shotsOnTarget"),
            avgShotsOffTarget: avg("shotsOffTarget"),
            avgBlockedShots: avg("blockedShots"),
            avgShotsInsideBox: avg("shotsInsideBox"),
            avgBigChancesScored: avg("bigChancesScored"),
            avgBigChancesMissed: avg("bigChancesMissed"),
            avgCornerKicks: avg("cornerKicks"),
            avgGoalkeeperSaves: avg("goalkeeperSaves"),
            avgGoalsPrevented: avg("goalsPrevented"),
            avgPassAccuracy: avg("passAccuracy"),
            avgTacklesWon: avg("tacklesWon"),
            avgInterceptions: avg("interceptions"),
            avgClearances: avg("clearances"),
            avgFouls: avg("fouls"),
            avgTotalPasses: avg("totalPasses"),
            avgTouchesInOppositionBox: avg("touchesOpBox"),
            avgDuelsWon: avg("duelsWon"),
            matchesWithStats,
          };
        }

        function computeTeamMatchStats(events: any[], teamId: number): TeamMatchStats {
          return {
            all: periodStatsToPeriodStats(events, teamId, "ALL", "full"),
            firstHalf: periodStatsToPeriodStats(events, teamId, "1ST", "period1"),
            secondHalf: periodStatsToPeriodStats(events, teamId, "2ND", "period2"),
            matchesAnalyzed: events.length,
          };
        }

        type PlayerHistory = {
          playerId: number;
          name: string;
          position: string;
          appearances: number;
          starts: number;
          ratings: number[];
          recentRatings: number[];
          statTotals: Record<string, number>;
          statSamples: number;
          last5Appearances: number;
          last5Starts: number;
          lastPlayedTimestamp: number;
          latestPlayer: any;
          jerseyNumber?: number;
        };

        function getTeamSide(event: any, teamId: number): "home" | "away" | null {
          if (event.homeTeam?.id === teamId) return "home";
          if (event.awayTeam?.id === teamId) return "away";
          return null;
        }

        function clamp(value: number, min: number, max: number): number {
          return Math.max(min, Math.min(max, value));
        }

        function round1(value: number): number {
          return Math.round(value * 10) / 10;
        }

        function readStat(stats: any, key: string): number {
          const value = Number(stats?.[key]);
          return Number.isFinite(value) ? value : 0;
        }

        function safeRatio(numerator: number, denominator: number): number | null {
          return denominator > 0 ? numerator / denominator : null;
        }

        function scaleVolume(value: number, goodValue: number): number {
          return clamp(4 + (value / goodValue) * 4, 4, 10);
        }

        function average(values: number[]): number | null {
          return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        }

        function readScore(score: any): number | null {
          const value = Number(score?.current ?? score?.display ?? score?.normaltime);
          return Number.isFinite(value) ? value : null;
        }

        function calculateTeamForm(events: any[], teamId: number) {
          const results = events
            .map((event: any) => {
              const side = getTeamSide(event, teamId);
              if (!side) return null;
              const homeScore = readScore(event.homeScore);
              const awayScore = readScore(event.awayScore);
              if (homeScore === null || awayScore === null) return null;
              const goalsFor = side === "home" ? homeScore : awayScore;
              const goalsAgainst = side === "home" ? awayScore : homeScore;
              const margin = goalsFor - goalsAgainst;
              const isWin = margin > 0;
              const isDraw = margin === 0;
              const isCleanSheet = goalsAgainst === 0;
              const isNilNil = goalsFor === 0 && goalsAgainst === 0;
              let points = isWin ? 3 : isDraw ? 1 : 0;
              if (isWin && margin >= 2) points += 2;
              if (isCleanSheet) points += 1;
              if (isDraw) points -= 1;
              if (isNilNil) points -= 1;
              return {
                points,
                goalsFor,
                goalsAgainst,
                result: isWin ? "W" : isDraw ? "D" : "L",
                cleanSheet: isCleanSheet,
                margin,
              };
            })
            .filter(Boolean) as {
              points: number;
              goalsFor: number;
              goalsAgainst: number;
              result: "W" | "D" | "L";
              cleanSheet: boolean;
              margin: number;
            }[];

          const matches = results.length;
          const totalPoints = results.reduce((sum, result) => sum + result.points, 0);
          const goalsFor = results.reduce((sum, result) => sum + result.goalsFor, 0);
          const goalsAgainst = results.reduce((sum, result) => sum + result.goalsAgainst, 0);
          const cleanSheets = results.filter((result) => result.cleanSheet).length;
          const bigWins = results.filter((result) => result.margin >= 2).length;
          const goalsForPerMatch = matches > 0 ? goalsFor / matches : 0;
          const goalsAgainstPerMatch = matches > 0 ? goalsAgainst / matches : 0;
          const cleanSheetRate = matches > 0 ? cleanSheets / matches : 0;
          const scoringRate = matches > 0 ? results.filter((result) => result.goalsFor > 0).length / matches : 0;

          return {
            formPoints: totalPoints,
            formStrength: matches > 0 ? round1(clamp(4 + (totalPoints / (matches * 6)) * 6, 3, 10)) : null,
            scoringStrength: matches > 0 ? round1(clamp(4 + (goalsForPerMatch / 2.5) * 4 + scoringRate * 1.2 + (bigWins / matches) * 0.8, 3, 10)) : null,
            defendingStrength: matches > 0 ? round1(clamp(4 + cleanSheetRate * 3.4 + Math.max(0, 2 - goalsAgainstPerMatch) * 1.3, 3, 10)) : null,
            goalsFor,
            goalsAgainst,
            cleanSheets,
            matches,
            recentForm: results.slice(0, 7).map((result) => result.result),
          };
        }

        function parseFormationParts(formation?: string): number[] {
          if (!formation) return [];
          return formation
            .split("-")
            .map((part) => Number(part.trim()))
            .filter((value) => Number.isFinite(value) && value > 0);
        }

        function deriveFormationFromPlayers(players: any[]): string {
          const defenders = players.filter((entry) => playerRole(entry.position) === "defender").length;
          const midfielders = players.filter((entry) => playerRole(entry.position) === "midfielder").length;
          const attackers = players.filter((entry) => playerRole(entry.position) === "attacker").length;
          if (defenders && midfielders && attackers) return `${defenders}-${midfielders}-${attackers}`;
          return "4-3-3";
        }

        function getMissingPlayerIds(side: "home" | "away"): Set<number> {
          const missingPlayers = currentLineups?.[side]?.missingPlayers || [];
          return new Set(
            missingPlayers
              .filter((entry: any) => {
                const text = `${entry.type || ""} ${entry.reason || ""}`.toLowerCase();
                return text.includes("injur") || text.includes("suspend") || text.includes("doubt") || text.includes("unavailable");
              })
              .map((entry: any) => Number(entry.player?.id))
              .filter(Boolean),
          );
        }

        function collectTeamHistory(events: any[], teamId: number): Map<number, PlayerHistory> {
          const history = new Map<number, PlayerHistory>();

          events.forEach((event: any, eventIndex: number) => {
            const side = getTeamSide(event, teamId);
            if (!side) return;

            const lineup = lineupsByEventId.get(event.id);
            const players = lineup?.[side]?.players || [];

            players.forEach((entry: any) => {
              const playerId = Number(entry.player?.id);
              if (!playerId) return;

              const current = history.get(playerId) || {
                playerId,
                name: entry.player?.shortName || entry.player?.name || "Player",
                position: entry.position || "",
                appearances: 0,
                starts: 0,
                ratings: [],
                recentRatings: [],
                statTotals: {},
                statSamples: 0,
                last5Appearances: 0,
                last5Starts: 0,
                lastPlayedTimestamp: 0,
                latestPlayer: entry.player,
                jerseyNumber: entry.jerseyNumber,
              };

              current.appearances += 1;
              if (!entry.substitute) current.starts += 1;
              if (eventIndex < 5) {
                current.last5Appearances += 1;
                if (!entry.substitute) current.last5Starts += 1;
              }
              if (entry.statistics) {
                current.statSamples += 1;
                Object.entries(entry.statistics).forEach(([key, rawValue]) => {
                  if (key === "ratingVersions" || key === "statisticsType") return;
                  const value = Number(rawValue);
                  if (Number.isFinite(value)) {
                    current.statTotals[key] = (current.statTotals[key] || 0) + value;
                  }
                });
              }
              const rating = Number(entry.statistics?.rating);
              if (Number.isFinite(rating) && rating > 0) {
                current.ratings.push(rating);
                if (eventIndex < 5) current.recentRatings.push(rating);
              }
              current.position = current.position || entry.position || "";
              current.latestPlayer = current.latestPlayer || entry.player;
              current.jerseyNumber = current.jerseyNumber || entry.jerseyNumber;
              current.lastPlayedTimestamp = Math.max(current.lastPlayedTimestamp, Number(event.startTimestamp) || 0);
              history.set(playerId, current);
            });
          });

          return history;
        }

        function calculateMetrics(player: any, history?: PlayerHistory) {
          const currentRating = Number(player.statistics?.rating);
          const ratings = history?.ratings || [];
          const recentRatings = history?.recentRatings || [];
          const avgRating =
            ratings.length > 0
              ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
              : Number.isFinite(currentRating) && currentRating > 0
              ? currentRating
              : null;
          const recentAvg =
            recentRatings.length > 0
              ? recentRatings.reduce((sum, rating) => sum + rating, 0) / recentRatings.length
              : avgRating;
          const appearances = history?.appearances || 0;
          const starts = history?.starts || 0;
          const statSamples = history?.statSamples || 0;
          const stat = (key: string) => (statSamples > 0 ? (history?.statTotals[key] || 0) / statSamples : readStat(player.statistics, key));
          const totalDuelWon = stat("duelWon") + stat("aerialWon");
          const totalDuelLost = stat("duelLost") + stat("aerialLost") + stat("challengeLost");
          const duelRate = safeRatio(totalDuelWon, totalDuelWon + totalDuelLost);
          const passAccuracy = safeRatio(stat("accuratePass"), stat("totalPass"));
          const longBallAccuracy = safeRatio(stat("accurateLongBalls"), stat("totalLongBalls"));
          const crossAccuracy = safeRatio(stat("accurateCross"), stat("totalCross"));
          const tackleRate = safeRatio(stat("wonTackle"), stat("totalTackle"));
          const defensiveActions =
            stat("interceptionWon") +
            stat("ballRecovery") +
            stat("totalClearance") * 0.55 +
            stat("wonTackle") * 0.9 +
            stat("outfielderBlock") * 0.8;
          const reliability = clamp(
            (passAccuracy !== null ? passAccuracy * 10 : avgRating || 6) -
              stat("errorLeadToAShot") * 2.2 -
              stat("possessionLostCtrl") * 0.08 -
              stat("dispossessed") * 0.22,
            3,
            10,
          );
          const defensiveStrength = average([
            duelRate !== null ? duelRate * 10 : NaN,
            scaleVolume(defensiveActions, 8),
            reliability,
            clamp(6 + stat("defensiveValueNormalized") * 6, 3, 10),
          ].filter(Number.isFinite));
          const attackActions =
            stat("goals") * 2.4 +
            stat("expectedGoals") * 2 +
            stat("onTargetScoringAttempt") * 0.75 +
            stat("totalShots") * 0.25 +
            stat("bigChanceCreated") * 1.4 +
            stat("keyPass") * 0.75 +
            stat("expectedAssists") * 2.4 +
            stat("wonContest") * 0.35 -
            stat("bigChanceMissed") * 0.55;
          const attackStrength = average([
            scaleVolume(attackActions, 5.2),
            clamp(6 + stat("shotValueNormalized") * 5, 3, 10),
            clamp(6 + stat("dribbleValueNormalized") * 5, 3, 10),
            avgRating || NaN,
          ].filter(Number.isFinite));
          const midfieldActions =
            stat("totalProgression") * 0.08 +
            stat("passValueNormalized") * 4 +
            stat("keyPass") * 0.7 +
            stat("expectedAssists") * 2 +
            stat("ballRecovery") * 0.45 +
            stat("interceptionWon") * 0.7 +
            stat("totalBallCarriesDistance") * 0.018 +
            stat("progressiveBallCarriesCount") * 0.7;
          const midfieldStrength = average([
            scaleVolume(midfieldActions, 6),
            reliability,
            passAccuracy !== null ? passAccuracy * 10 : NaN,
            avgRating || NaN,
          ].filter(Number.isFinite));
          const keeperActions =
            stat("saves") * 1.1 +
            stat("savedShotsFromInsideTheBox") * 1.2 +
            stat("goalsPrevented") * 2.2 +
            stat("keeperSaveValue") * 4 +
            stat("goodHighClaim") * 0.8 +
            stat("accurateKeeperSweeper") * 0.8;
          const keeperStrength = average([
            scaleVolume(keeperActions, 4),
            longBallAccuracy !== null ? longBallAccuracy * 10 : NaN,
            clamp(6 + stat("goalkeeperValueNormalized") * 6, 3, 10),
            avgRating || NaN,
          ].filter(Number.isFinite));
          const fullbackActions =
            stat("totalCross") * 0.35 +
            stat("accurateCross") * 1.1 +
            stat("totalBallCarriesDistance") * 0.02 +
            stat("progressiveBallCarriesCount") * 0.75 +
            stat("totalProgression") * 0.07 +
            stat("wonTackle") * 0.7 +
            stat("ballRecovery") * 0.35;
          const fullbackStrength = average([
            scaleVolume(fullbackActions, 5.5),
            crossAccuracy !== null ? crossAccuracy * 10 : NaN,
            tackleRate !== null ? tackleRate * 10 : NaN,
            reliability,
          ].filter(Number.isFinite));
          const consistency =
            ratings.length > 1
              ? 10 - clamp(
                  Math.sqrt(
                    ratings.reduce((sum, rating) => sum + Math.pow(rating - (avgRating || rating), 2), 0) /
                      ratings.length,
                  ) * 2,
                  0,
                  3,
                )
              : ratings.length === 1
              ? 7
              : 5;
          const performance = avgRating ? clamp(avgRating, 4, 10) : 0;
          const experience = clamp(4 + (appearances / 15) * 4 + (starts / 15) * 2, appearances > 0 ? 4 : 0, 10);
          const intelligence = avgRating
            ? clamp(avgRating * 0.62 + consistency * 0.22 + (recentAvg || avgRating) * 0.16, 4, 10)
            : 0;
          const decision = avgRating
            ? clamp((recentAvg || avgRating) * 0.42 + consistency * 0.32 + experience * 0.26, 4, 10)
            : 0;
          const overall = avgRating
            ? clamp(performance * 0.42 + intelligence * 0.22 + decision * 0.2 + experience * 0.16, 4, 10)
            : 0;

          return {
            overall: overall ? round1(overall) : null,
            experience: experience ? round1(experience) : null,
            decision: decision ? round1(decision) : null,
            intelligence: intelligence ? round1(intelligence) : null,
            performance: performance ? round1(performance) : null,
            defensiveStrength: defensiveStrength ? round1(defensiveStrength) : null,
            attackStrength: attackStrength ? round1(attackStrength) : null,
            midfieldStrength: midfieldStrength ? round1(midfieldStrength) : null,
            keeperStrength: keeperStrength ? round1(keeperStrength) : null,
            fullbackStrength: fullbackStrength ? round1(fullbackStrength) : null,
            appearances,
            starts,
            averageRating: avgRating ? round1(avgRating) : null,
            statSamples,
            dataConfidence: ratings.length >= 8 ? "High" : ratings.length >= 3 ? "Medium" : ratings.length > 0 || statSamples > 0 ? "Low" : "Unavailable",
          };
        }

        function playerRole(position?: string): "keeper" | "defender" | "midfielder" | "attacker" {
          const value = (position || "").toLowerCase();
          if (value === "g" || value.includes("goal")) return "keeper";
          if (value.startsWith("d")) return "defender";
          if (value.startsWith("m")) return "midfielder";
          return "attacker";
        }

        function roleAwareScore(entry: any): number | null {
          const role = playerRole(entry.original?.position);
          const metrics = entry.metrics;
          if (role === "keeper") return metrics.keeperStrength || metrics.defensiveStrength || metrics.overall;
          if (role === "defender") return metrics.defensiveStrength || metrics.fullbackStrength || metrics.overall;
          if (role === "midfielder") return metrics.midfieldStrength || metrics.overall;
          return metrics.attackStrength || metrics.overall;
        }

        function preferredFormation(events: any[], teamId: number): string {
          const formationScores = new Map<string, number>();
          events.forEach((event: any, index: number) => {
            const side = getTeamSide(event, teamId);
            if (!side) return;
            const lineup = lineupsByEventId.get(event.id)?.[side];
            const starters = (lineup?.players || []).filter((entry: any) => !entry.substitute);
            const formation = lineup?.formation || deriveFormationFromPlayers(starters);
            if (!formation || starters.length < 9) return;
            const recencyWeight = Math.max(1, 15 - index);
            formationScores.set(formation, (formationScores.get(formation) || 0) + recencyWeight);
          });

          return Array.from(formationScores.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "4-3-3";
        }

        function buildLikelyLineup(
          side: "home" | "away",
          events: any[],
          teamId: number,
          history: Map<number, PlayerHistory>,
        ) {
          const formation = preferredFormation(events, teamId);
          const formationParts = parseFormationParts(formation);
          const defenderCount = formationParts[0] || 4;
          const attackerCount = formationParts.length > 1 ? formationParts[formationParts.length - 1] : 3;
          const midfielderCount = Math.max(10 - defenderCount - attackerCount, 0);
          const missingIds = getMissingPlayerIds(side);
          const activeLast5Ids = new Set(
            Array.from(history.values())
              .filter((player) => player.last5Appearances > 0)
              .map((player) => player.playerId),
          );
          const candidates = Array.from(history.values()).filter((player) => !missingIds.has(player.playerId));
          const ratingAvg = (player: PlayerHistory) =>
            player.ratings.length > 0 ? player.ratings.reduce((sum, rating) => sum + rating, 0) / player.ratings.length : 6;
          const candidateScore = (player: PlayerHistory) =>
            player.starts * 2.2 +
            player.appearances * 0.8 +
            player.last5Starts * 4 +
            player.last5Appearances * 2.2 +
            ratingAvg(player) * 2 +
            (activeLast5Ids.has(player.playerId) ? 5 : 0);
          const usedIds = new Set<number>();
          const takeRole = (role: "keeper" | "defender" | "midfielder" | "attacker", count: number) => {
            const selected = candidates
              .filter((player) => !usedIds.has(player.playerId) && playerRole(player.position) === role)
              .sort((a, b) => candidateScore(b) - candidateScore(a))
              .slice(0, count);
            selected.forEach((player) => usedIds.add(player.playerId));
            return selected;
          };

          const picked = [
            ...takeRole("keeper", 1),
            ...takeRole("defender", defenderCount),
            ...takeRole("midfielder", midfielderCount),
            ...takeRole("attacker", attackerCount),
          ];
          const fallbackNeeded = Math.max(0, 11 - picked.length);
          if (fallbackNeeded > 0) {
            const extra = candidates
              .filter((player) => !usedIds.has(player.playerId))
              .sort((a, b) => candidateScore(b) - candidateScore(a))
              .slice(0, fallbackNeeded);
            extra.forEach((player) => usedIds.add(player.playerId));
            picked.push(...extra);
          }

          const substitutes = candidates
            .filter((player) => !usedIds.has(player.playerId))
            .sort((a, b) => candidateScore(b) - candidateScore(a))
            .slice(0, 12);

          const toEntry = (player: PlayerHistory, substitute: boolean) => ({
            player: player.latestPlayer || { id: player.playerId, shortName: player.name, name: player.name },
            position: player.position || "M",
            substitute,
            jerseyNumber: player.jerseyNumber || 0,
            statistics: {
              rating: ratingAvg(player),
            },
            likelyLineupReason: substitute
              ? "Bench option from last 15 match involvement"
              : player.last5Appearances > 0
              ? "Active in last 5 and fits preferred formation"
              : "Best available historical fit for preferred formation",
          });

          return {
            formation,
            players: [...picked.map((player) => toEntry(player, false)), ...substitutes.map((player) => toEntry(player, true))],
            missingPlayers: currentLineups?.[side]?.missingPlayers || [],
            isLikely: true,
            lineupSource: "preferred_formation_last_15_active_last_5",
            unavailableCount: missingIds.size,
            activeLast5Count: activeLast5Ids.size,
          };
        }

        function enrichSide(side: "home" | "away", history: Map<number, PlayerHistory>, events: any[], teamId: number) {
          const existingTeam = currentLineups?.[side];
          const hasProviderLineup = (existingTeam?.players || []).some((entry: any) => !entry.substitute);
          const team = hasProviderLineup ? existingTeam : buildLikelyLineup(side, events, teamId, history);
          const teamForm = calculateTeamForm(events, teamId);
          const players = (team?.players || []).map((entry: any) => {
            const playerId = Number(entry.player?.id);
            return {
              playerId,
              position: entry.position || null,
              metrics: calculateMetrics(entry, history.get(playerId)),
            };
          });

          const starters = players.filter((entry: any) => {
            const original = (team?.players || []).find((player: any) => Number(player.player?.id) === entry.playerId);
            return original && !original.substitute;
          }).map((entry: any) => ({
            ...entry,
            original: (team?.players || []).find((player: any) => Number(player.player?.id) === entry.playerId),
          }));
          const availableRatings = starters
            .map(roleAwareScore)
            .filter((rating: number | null) => typeof rating === "number") as number[];
          const teamStrength =
            availableRatings.length > 0
              ? round1(availableRatings.reduce((sum, rating) => sum + rating, 0) / availableRatings.length)
              : null;
          const roleScores = {
            defensiveStrength: starters
              .filter((entry: any) => ["keeper", "defender"].includes(playerRole(entry.original?.position)))
              .map((entry: any) => entry.metrics.defensiveStrength || entry.metrics.keeperStrength)
              .filter((rating: number | null) => typeof rating === "number") as number[],
            attackStrength: starters
              .filter((entry: any) => playerRole(entry.original?.position) === "attacker")
              .map((entry: any) => entry.metrics.attackStrength)
              .filter((rating: number | null) => typeof rating === "number") as number[],
            midfieldStrength: starters
              .filter((entry: any) => playerRole(entry.original?.position) === "midfielder")
              .map((entry: any) => entry.metrics.midfieldStrength)
              .filter((rating: number | null) => typeof rating === "number") as number[],
            keeperStrength: starters
              .filter((entry: any) => playerRole(entry.original?.position) === "keeper")
              .map((entry: any) => entry.metrics.keeperStrength)
              .filter((rating: number | null) => typeof rating === "number") as number[],
            fullbackStrength: starters
              .filter((entry: any) => playerRole(entry.original?.position) === "defender")
              .map((entry: any) => entry.metrics.fullbackStrength)
              .filter((rating: number | null) => typeof rating === "number") as number[],
          };
          const averageRole = (values: number[]) => (values.length > 0 ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null);

          // ── Injury / suspension report ──────────────────────────────────
          const rawMissing: any[] = currentLineups?.[side]?.missingPlayers || [];
          const injuryReport = rawMissing.map((entry: any) => {
            const pid = Number(entry.player?.id);
            const ph = history.get(pid);
            const avgRating =
              ph && ph.ratings.length > 0
                ? round1(ph.ratings.reduce((s: number, r: number) => s + r, 0) / ph.ratings.length)
                : null;
            const last5Rating =
              ph && ph.recentRatings.length > 0
                ? round1(ph.recentRatings.reduce((s: number, r: number) => s + r, 0) / ph.recentRatings.length)
                : null;
            const effectiveRating = last5Rating ?? avgRating ?? 0;
            const isKeyPlayer = effectiveRating >= 7.0 && (ph?.last5Appearances ?? 0) >= 1;
            const typeStr = `${entry.type || ""} ${entry.reason || ""}`.toLowerCase();
            const isSuspended =
              typeStr.includes("suspend") || typeStr.includes("card") || typeStr.includes("ban");
            return {
              name: entry.player?.shortName || entry.player?.name || "Unknown",
              type: isSuspended ? "suspension" : "injury",
              reason: entry.reason || entry.type || "Unavailable",
              avgRating,
              last5Rating,
              isKeyPlayer,
              position: ph?.position || "",
              last5Appearances: ph?.last5Appearances ?? 0,
              last5Starts: ph?.last5Starts ?? 0,
            };
          });
          const keyMissing = injuryReport.filter((p: any) => p.isKeyPlayer);
          const injuryImpact =
            keyMissing.length > 0
              ? round1(
                  Math.min(
                    keyMissing.reduce(
                      (sum: number, p: any) => sum + (p.last5Rating ?? p.avgRating ?? 7),
                      0,
                    ) /
                      keyMissing.length *
                      0.7 +
                      keyMissing.length * 0.5,
                    10,
                  ),
                )
              : 0;
          const injuredList = injuryReport.filter((p: any) => p.type === "injury");
          const suspendedList = injuryReport.filter((p: any) => p.type === "suspension");

          return {
            formation: team?.formation || null,
            lineup: team,
            lineupSource: hasProviderLineup ? "provider_predicted_or_confirmed" : team?.lineupSource,
            isLikelyLineup: !hasProviderLineup,
            unavailableCount: team?.unavailableCount || 0,
            activeLast5Count: team?.activeLast5Count || 0,
            players,
            teamStrength,
            formStrength: teamForm.formStrength,
            scoringStrength: teamForm.scoringStrength,
            defendingStrength: teamForm.defendingStrength,
            formPoints: teamForm.formPoints,
            formSummary: teamForm,
            phaseStrengths: {
              defensiveStrength: averageRole(roleScores.defensiveStrength),
              attackStrength: averageRole(roleScores.attackStrength),
              midfieldStrength: averageRole(roleScores.midfieldStrength),
              keeperStrength: averageRole(roleScores.keeperStrength),
              fullbackStrength: averageRole(roleScores.fullbackStrength),
            },
            matchesAnalyzed: side === "home" ? homeLast15.length : awayLast15.length,
            injuredPlayers: injuredList,
            suspendedPlayers: suspendedList,
            injuryImpact,
          };
        }

        const homeHistory = collectTeamHistory(homeLast15, homeTeamId);
        const awayHistory = collectTeamHistory(awayLast15, awayTeamId);
        const homeTeamMatchStats = computeTeamMatchStats(homeLast15, homeTeamId);
        const awayTeamMatchStats = computeTeamMatchStats(awayLast15, awayTeamId);

        const homeSide = enrichSide("home", homeHistory, homeLast15, homeTeamId);
        const awaySide = enrichSide("away", awayHistory, awayLast15, awayTeamId);

        res.json({
          home: { ...homeSide, teamMatchStats: homeTeamMatchStats },
          away: { ...awaySide, teamMatchStats: awayTeamMatchStats },
          confirmed: currentLineups?.confirmed ?? null,
          source: "last_15_role_based_lineup_statistics_with_likely_lineup_fallback",
        });
      } catch (error: any) {
        console.error("Error building player simulation:", error.message);
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/statistics",
    async (req: Request, res: Response) => {
      try {
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/statistics`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/best-players",
    async (req: Request, res: Response) => {
      try {
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/best-players`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/h2h/events",
    async (req: Request, res: Response) => {
      try {
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/h2h/events`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/event/:eventId/odds/1/all",
    async (req: Request, res: Response) => {
      try {
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/odds/1/all`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/unique-tournament/:tournamentId/season/:seasonId/standings/total",
    async (req: Request, res: Response) => {
      try {
        const { tournamentId, seasonId } = req.params;
        const data = await fetchSofaScore(
          `/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/team/:teamId/events/last/:page",
    async (req: Request, res: Response) => {
      try {
        const { teamId, page } = req.params;
        const data = await fetchSofaScore(
          `/team/${teamId}/events/last/${page}`,
        );
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/team/:teamId/image",
    async (req: Request, res: Response) => {
      await proxyImage(
        `https://api.sofascore.app/api/v1/team/${req.params.teamId}/image`,
        res,
      );
    },
  );

  app.get(
    "/api/unique-tournament/:tournamentId/image",
    async (req: Request, res: Response) => {
      await proxyImage(
        `https://api.sofascore.app/api/v1/unique-tournament/${req.params.tournamentId}/image`,
        res,
      );
    },
  );

  app.get(
    "/api/player/:playerId/image",
    async (req: Request, res: Response) => {
      await proxyImage(
        `https://api.sofascore.app/api/v1/player/${req.params.playerId}/image`,
        res,
      );
    },
  );

  app.get("/api/ai-insight", async (req: Request, res: Response) => {
    try {
      const { eventId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, tournamentName } = req.query as Record<string, string>;

      if (!homeTeamId || !awayTeamId) {
        return res.status(400).json({ error: "homeTeamId and awayTeamId are required" });
      }

      // ── Helpers ─────────────────────────────────────────────────────────────

      function parseFractionalOdds(value?: string): number | null {
        if (!value) return null;
        const parts = value.split("/");
        if (parts.length === 2) {
          const n = parseFloat(parts[0]), d = parseFloat(parts[1]);
          if (!isNaN(n) && !isNaN(d) && d !== 0) return Math.round((n / d + 1) * 100) / 100;
        }
        const dec = parseFloat(value);
        return isNaN(dec) ? null : dec;
      }

      function extractFTOdds(oddsData: any): { home: number | null; draw: number | null; away: number | null } {
        const empty = { home: null, draw: null, away: null };
        if (!oddsData?.markets) return empty;
        const ftMarket =
          oddsData.markets.find((m: any) =>
            (m.marketName || "").toLowerCase().includes("full time")
          ) || oddsData.markets[0];
        if (!ftMarket?.choices) return empty;
        const choices = ftMarket.choices as any[];
        const find = (names: string[]) =>
          choices.find((c) => names.includes((c.name || "").toLowerCase()));
        return {
          home: parseFractionalOdds(find(["1", "home"])?.fractionalValue),
          draw: parseFractionalOdds(find(["x", "draw"])?.fractionalValue),
          away: parseFractionalOdds(find(["2", "away"])?.fractionalValue),
        };
      }

      // ── Fetch base data ──────────────────────────────────────────────────────

      const [homeEvents, awayEvents, [eventOddsResult, eventDataResult]] = await Promise.all([
        fetchTeamLastEvents(homeTeamId),
        fetchTeamLastEvents(awayTeamId),
        Promise.allSettled([
          eventId ? fetchSofaScore(`/event/${eventId}/odds/1/all`) : Promise.resolve(null),
          eventId ? fetchSofaScore(`/event/${eventId}`) : Promise.resolve(null),
        ]),
      ]);

      const currentMatchOddsRaw = eventOddsResult.status === "fulfilled" ? eventOddsResult.value : null;
      const currentEvent = eventDataResult.status === "fulfilled" ? (eventDataResult.value as any)?.event : null;

      const currentStartTimestamp = Number(currentEvent?.startTimestamp) || undefined;
      const last15Home = selectLastPlayedTeamMatches(homeEvents, homeTeamId, currentStartTimestamp);
      const last15Away = selectLastPlayedTeamMatches(awayEvents, awayTeamId, currentStartTimestamp);

      // ── Fetch odds for every historical match (for TMP B & D pillars) ────────

      const allPastEventIds = Array.from(
        new Set([...last15Home, ...last15Away].map((m: any) => m.id as number))
      );

      const pastOddsResults = await Promise.allSettled(
        allPastEventIds.map((id) => fetchSofaScore(`/event/${id}/odds/1/all`))
      );

      const pastOddsMap = new Map<number, { home: number | null; draw: number | null; away: number | null }>();
      allPastEventIds.forEach((id, idx) => {
        const result = pastOddsResults[idx];
        pastOddsMap.set(id, result.status === "fulfilled" ? extractFTOdds(result.value) : { home: null, draw: null, away: null });
      });

      // ── Summarise each match ─────────────────────────────────────────────────

      function summarizeMatch(match: any, teamId: number) {
        const isHome = match.homeTeam?.id === Number(teamId);
        const teamScore = isHome
          ? match.homeScore?.display ?? match.homeScore?.current ?? 0
          : match.awayScore?.display ?? match.awayScore?.current ?? 0;
        const oppScore = isHome
          ? match.awayScore?.display ?? match.awayScore?.current ?? 0
          : match.homeScore?.display ?? match.homeScore?.current ?? 0;
        const teamHtGoals = isHome
          ? match.homeScore?.period1 ?? null
          : match.awayScore?.period1 ?? null;
        const oppHtGoals = isHome
          ? match.awayScore?.period1 ?? null
          : match.homeScore?.period1 ?? null;
        const htResult: "winning" | "losing" | "level" =
          teamHtGoals === null || oppHtGoals === null
            ? "level"
            : teamHtGoals > oppHtGoals
            ? "winning"
            : teamHtGoals < oppHtGoals
            ? "losing"
            : "level";

        const opponent = isHome
          ? match.awayTeam?.name || match.awayTeam?.shortName
          : match.homeTeam?.name || match.homeTeam?.shortName;
        let result: "W" | "D" | "L" = "D";
        if (match.winnerCode === 1) result = isHome ? "W" : "L";
        else if (match.winnerCode === 2) result = isHome ? "L" : "W";

        const date = new Date(match.startTimestamp * 1000).toISOString().split("T")[0];
        const competition = match.tournament?.uniqueTournament?.name || match.tournament?.name || "Unknown";
        const totalGoals = teamScore + oppScore;

        return {
          eventId: match.id as number,
          date,
          result,
          score: `${teamScore}-${oppScore}`,
          htResult,
          side: isHome ? "Home" : "Away",
          isHome,
          opponent,
          competition,
          totalGoals,
          cleanSheet: oppScore === 0,
          scored: teamScore > 0,
          goalsScored: teamScore,
          goalsConceded: oppScore,
        };
      }

      const homeSummaries = last15Home.map((m: any) => summarizeMatch(m, Number(homeTeamId)));
      const awaySummaries = last15Away.map((m: any) => summarizeMatch(m, Number(awayTeamId)));

      // ── TMP Calculation ──────────────────────────────────────────────────────
      // TMP = Box A (result) + Box B (odds performance) + Box C (match control) + Box D (opponent strength)

      function calculateTMP(summaries: ReturnType<typeof summarizeMatch>[]) {
        let boxA = 0, boxB = 0, boxC = 0, boxD = 0;
        const breakdown: string[] = [];

        for (const s of summaries) {
          // Box A — Result Efficiency
          const aPoints = s.result === "W" ? 14 : s.result === "D" ? 6 : -12;
          boxA += aPoints;

          // Box B — Odds Performance (team's own odds for this match)
          const matchOdds = pastOddsMap.get(s.eventId);
          const teamOdds = matchOdds ? (s.isHome ? matchOdds.home : matchOdds.away) : null;
          const oppOdds  = matchOdds ? (s.isHome ? matchOdds.away : matchOdds.home) : null;

          if (teamOdds !== null) {
            const role = teamOdds >= 2.81 ? "underdog" : teamOdds >= 2.01 ? "balanced" : "favourite";
            let bPoints = 0;
            if (s.result === "W")      bPoints = role === "underdog" ? 15 : role === "balanced" ? 10 : 5;
            else if (s.result === "D") bPoints = role === "underdog" ? 10 : role === "balanced" ? 6 : -4;
            else                       bPoints = role === "underdog" ? -5 : role === "balanced" ? -2 : -10;
            boxB += bPoints;
          }

          // Box C — Match Control (HT → FT)
          const ht = s.htResult, ft = s.result;
          if      (ht === "losing"  && ft === "W") boxC += 10; // comeback
          else if (ht === "winning" && ft === "W") boxC += 8;  // held on
          else if (ht === "level"   && ft === "W") boxC += 6;  // second-half winner
          else if (ht === "losing"  && ft === "D") boxC += 5;  // salvaged draw
          else if (ht === "level"   && ft === "D") boxC += 3;
          else if (ht === "winning" && ft === "D") boxC -= 4;  // dropped points
          else if (ht === "level"   && ft === "L") boxC -= 6;
          else if (ht === "winning" && ft === "L") boxC -= 8;  // total collapse

          // Box D — Opponent Strength (opponent's odds as proxy for quality)
          if (oppOdds !== null) {
            const tier = oppOdds < 1.6 ? "top" : oppOdds <= 2.5 ? "mid" : "bottom";
            let dPoints = 0;
            if      (s.result === "W") dPoints = tier === "top" ? 12 : tier === "mid" ? 8 : 4;
            else if (s.result === "D") dPoints = tier === "top" ? 8  : tier === "mid" ? 5 : 2;
            else                       dPoints = tier === "top" ? -6 : tier === "mid" ? -4 : -2;
            boxD += dPoints;
          }

          breakdown.push(`[${s.date}] ${s.result} vs ${s.opponent} (${s.side}) A:${aPoints}`);
        }

        const total = boxA + boxB + boxC + boxD;
        const momentum = total >= 300 ? "High" : total >= 150 ? "Medium" : "Low";
        return { total, boxA, boxB, boxC, boxD, momentum, oddsAvailable: pastOddsMap.size > 0 };
      }

      const homeTMP = calculateTMP(homeSummaries);
      const awayTMP  = calculateTMP(awaySummaries);

      // ── Aggregate stats ──────────────────────────────────────────────────────

      function computeStats(summaries: ReturnType<typeof summarizeMatch>[]) {
        const played = summaries.length;
        if (played === 0) return null;
        const wins   = summaries.filter(s => s.result === "W").length;
        const draws  = summaries.filter(s => s.result === "D").length;
        const losses = summaries.filter(s => s.result === "L").length;
        const gf     = summaries.reduce((a, s) => a + s.goalsScored,   0);
        const ga     = summaries.reduce((a, s) => a + s.goalsConceded, 0);
        const cs     = summaries.filter(s => s.cleanSheet).length;
        const fts    = summaries.filter(s => !s.scored).length;
        const btts   = summaries.filter(s => s.scored && !s.cleanSheet).length;
        const over25 = summaries.filter(s => s.totalGoals > 2).length;
        const hm = summaries.filter(s => s.side === "Home");
        const am = summaries.filter(s => s.side === "Away");
        const hw = hm.filter(s => s.result === "W").length;
        const aw = am.filter(s => s.result === "W").length;
        const hd = hm.filter(s => s.result === "D").length;
        const ad = am.filter(s => s.result === "D").length;
        const comebacks  = summaries.filter(s => s.htResult === "losing"  && s.result === "W").length;
        const collapses  = summaries.filter(s => s.htResult === "winning" && s.result === "L").length;
        const droppedPts = summaries.filter(s => s.htResult === "winning" && s.result === "D").length;
        return {
          played, wins, draws, losses, gf, ga,
          avgGF: Math.round(gf / played * 100) / 100,
          avgGA: Math.round(ga / played * 100) / 100,
          cs, fts, btts, over25,
          homeRecord: `${hw}W-${hm.length - hw - hd}L-${hd}D`,
          awayRecord: `${aw}W-${am.length - aw - ad}L-${ad}D`,
          last5Form: summaries.slice(0, 5).map(s => s.result).join(""),
          comebacks, collapses, droppedPts,
        };
      }

      const homeStats = computeStats(homeSummaries);
      const awayStats  = computeStats(awaySummaries);

      // ── Current match odds (for value assessment) ────────────────────────────

      const currentMatchOdds = extractFTOdds(currentMatchOddsRaw);

      // ── Build prompt ─────────────────────────────────────────────────────────

      const tmpOddsNote = homeTMP.oddsAvailable
        ? "TMP Boxes B & D are computed from actual historical odds for each match."
        : "TMP Boxes B & D could not be computed (historical odds unavailable); only Boxes A & C are scored.";

      const prompt = `You are an elite football betting analyst combining deep statistical reasoning with market intelligence. Your job is to find profitable betting markets for the following match — not just based on surface form, but by integrating momentum quality, opponent weighting, resilience, and value against the current odds.

═══════════════════════════════════════════
MATCH: ${homeTeamName} vs ${awayTeamName}
COMPETITION: ${tournamentName || "Unknown"}
${currentEvent ? `DATE: ${new Date(currentEvent.startTimestamp * 1000).toISOString().split("T")[0]}` : ""}
${currentMatchOdds.home ? `CURRENT ODDS: Home ${currentMatchOdds.home} | Draw ${currentMatchOdds.draw} | Away ${currentMatchOdds.away}` : ""}
═══════════════════════════════════════════

━━━ TEAM MOMENTUM PERFORMANCE (TMP) ━━━
TMP is a 0–400 composite score: quality and character of results, not just wins/losses.
Pillar A = Result Efficiency | B = Odds Performance | C = Match Control (HT→FT) | D = Opponent Strength
${tmpOddsNote}

${homeTeamName} TMP: ${homeTMP.total} (${homeTMP.momentum} momentum)
  └ A:${homeTMP.boxA} B:${homeTMP.boxB} C:${homeTMP.boxC} D:${homeTMP.boxD}
  └ Ratings: 300+=High · 150-299=Medium · <150=Low

${awayTeamName} TMP: ${awayTMP.total} (${awayTMP.momentum} momentum)
  └ A:${awayTMP.boxA} B:${awayTMP.boxB} C:${awayTMP.boxC} D:${awayTMP.boxD}

TMP Gap: ${Math.abs(homeTMP.total - awayTMP.total)} points in favour of ${homeTMP.total >= awayTMP.total ? homeTeamName : awayTeamName}

━━━ ${homeTeamName?.toUpperCase()} — LAST ${homeSummaries.length} MATCHES ━━━
Record: ${homeStats?.wins}W ${homeStats?.draws}D ${homeStats?.losses}L | GF:${homeStats?.gf} GA:${homeStats?.ga} | Avg GF:${homeStats?.avgGF} GA:${homeStats?.avgGA}
Home: ${homeStats?.homeRecord} | Away: ${homeStats?.awayRecord} | Last 5: ${homeStats?.last5Form}
Clean Sheets: ${homeStats?.cs}/${homeStats?.played} | Failed to Score: ${homeStats?.fts}/${homeStats?.played}
BTTS: ${homeStats?.btts}/${homeStats?.played} | Over 2.5: ${homeStats?.over25}/${homeStats?.played}
Resilience: ${homeStats?.comebacks} comebacks | Collapses: ${homeStats?.collapses} | Dropped leads: ${homeStats?.droppedPts}

Match log (newest first):
${homeSummaries.map((m, i) => {
  const odds = pastOddsMap.get(m.eventId);
  const teamOdds = odds ? (m.isHome ? odds.home : odds.away) : null;
  const oppOdds  = odds ? (m.isHome ? odds.away : odds.home) : null;
  return `${i + 1}. [${m.date}] ${m.side} vs ${m.opponent} (${m.competition}): ${m.result} ${m.score} | HT:${m.htResult}${teamOdds ? ` | OwnOdds:${teamOdds}` : ""}${oppOdds ? ` OppOdds:${oppOdds}` : ""}`;
}).join("\n")}

━━━ ${awayTeamName?.toUpperCase()} — LAST ${awaySummaries.length} MATCHES ━━━
Record: ${awayStats?.wins}W ${awayStats?.draws}D ${awayStats?.losses}L | GF:${awayStats?.gf} GA:${awayStats?.ga} | Avg GF:${awayStats?.avgGF} GA:${awayStats?.avgGA}
Home: ${awayStats?.homeRecord} | Away: ${awayStats?.awayRecord} | Last 5: ${awayStats?.last5Form}
Clean Sheets: ${awayStats?.cs}/${awayStats?.played} | Failed to Score: ${awayStats?.fts}/${awayStats?.played}
BTTS: ${awayStats?.btts}/${awayStats?.played} | Over 2.5: ${awayStats?.over25}/${awayStats?.played}
Resilience: ${awayStats?.comebacks} comebacks | Collapses: ${awayStats?.collapses} | Dropped leads: ${awayStats?.droppedPts}

Match log (newest first):
${awaySummaries.map((m, i) => {
  const odds = pastOddsMap.get(m.eventId);
  const teamOdds = odds ? (m.isHome ? odds.home : odds.away) : null;
  const oppOdds  = odds ? (m.isHome ? odds.away : odds.home) : null;
  return `${i + 1}. [${m.date}] ${m.side} vs ${m.opponent} (${m.competition}): ${m.result} ${m.score} | HT:${m.htResult}${teamOdds ? ` | OwnOdds:${teamOdds}` : ""}${oppOdds ? ` OppOdds:${oppOdds}` : ""}`;
}).join("\n")}

━━━ ANALYSIS FRAMEWORK ━━━
Reason carefully through each of these before forming predictions:

1. TMP MOMENTUM GAP: What does the TMP gap signal? A large gap (>80 pts) is significant. Interpret the pillar breakdown — is one team winning against weak opponents (high A, low D) or consistently beating expectations (high B)?

2. MATCH CONTROL PATTERN (Box C): Teams with high C scores are resilient fighters. Teams with negative C scores collapse under pressure. How will this dynamic play out?

3. OPPONENT QUALITY FILTER (Box D): Strip away wins vs weak opponents. What does each team's record look like against mid-to-top opponents only?

4. HOME/AWAY CONTEXT: This team plays at home — do home/away splits match or contradict the overall form story?

5. GOALS ENVIRONMENT: Combine both teams' avg GF and GA, BTTS rate, Over 2.5 rate. What total goals environment does this matchup create?

6. VALUE VS CURRENT ODDS: If current odds are provided, does the statistical picture suggest the market has over or under-priced either side? A statistically stronger team priced shorter than their TMP warrants is bad value; one priced longer is good value.

7. RED FLAGS: Identify any data points that should prevent you from betting a market confidently (e.g. high variance, near-zero BTTS, wildly different competition levels in recent matches).

Output ONLY a valid JSON object. No markdown, no code blocks, no explanation outside the JSON:
{
  "summary": "3-sentence sharp overview integrating TMP scores and the most decisive statistical contrast",
  "tmpInterpretation": "1-2 sentences explaining what the TMP gap and pillar breakdown tells you about momentum quality",
  "homeTeamAnalysis": {
    "form": "trend description integrating TMP pillar insights",
    "strengths": ["specific stat-backed strength 1", "specific stat-backed strength 2"],
    "weaknesses": ["specific stat-backed weakness 1", "specific stat-backed weakness 2"],
    "keyTrend": "the single most predictively powerful trend for this match"
  },
  "awayTeamAnalysis": {
    "form": "trend description integrating TMP pillar insights",
    "strengths": ["specific stat-backed strength 1", "specific stat-backed strength 2"],
    "weaknesses": ["specific stat-backed weakness 1", "specific stat-backed weakness 2"],
    "keyTrend": "the single most predictively powerful trend for this match"
  },
  "predictions": [
    {
      "market": "Match Result (1X2)",
      "pick": "Home Win / Draw / Away Win",
      "confidence": 75,
      "reasoning": "detailed reasoning referencing TMP, form, opponent quality, and what could invalidate it"
    },
    {
      "market": "Goals Over/Under 2.5",
      "pick": "Over 2.5 / Under 2.5",
      "confidence": 70,
      "reasoning": "detailed reasoning referencing both teams' scoring/conceding and BTTS rates"
    },
    {
      "market": "Both Teams to Score",
      "pick": "Yes / No",
      "confidence": 65,
      "reasoning": "detailed reasoning"
    },
    {
      "market": "Double Chance",
      "pick": "1X / X2 / 12",
      "confidence": 80,
      "reasoning": "detailed reasoning"
    }
  ],
  "bestBet": {
    "market": "market name",
    "pick": "pick",
    "confidence": 82,
    "reasoning": "why this is the most statistically robust bet and what would invalidate it"
  },
  "riskFactors": ["specific risk 1 with data reasoning", "specific risk 2"],
  "dataConfidence": "High / Medium / Low"
}`;

      const response = await openai.chat.completions.create({
        model: "o4-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 4000,
      });

      const rawContent = response.choices[0]?.message?.content || "{}";

      let parsed: any;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("AI did not return valid JSON");
        }
      }

      res.json({
        analysis: parsed,
        dataStats: {
          homeMatchesAnalyzed: homeSummaries.length,
          awayMatchesAnalyzed: awaySummaries.length,
          homeStats,
          awayStats,
          homeTMP,
          awayTMP,
        },
      });
    } catch (error: any) {
      console.error("Error generating AI insight:", error.message);
      const message = String(error?.message || "");
      const isAuthError =
        error?.status === 401 ||
        message.toLowerCase().includes("api key") ||
        message.toLowerCase().includes("authorization");
      res.status(isAuthError ? 503 : 500).json({
        error: isAuthError
          ? "AI insight is not available right now. Please check the AI key and URL, then try again."
          : "AI insight could not be generated right now. Please try again.",
      });
    }
  });

  // ─── xG Engine: status ────────────────────────────────────────────────────
  app.get("/api/engine/status", (_req: Request, res: Response) => {
    try {
      res.json(engine.getStatus());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── xG Engine: train ─────────────────────────────────────────────────────
  let engineTrainingJob: { running: boolean; progress: number; message: string; error: string | null } = {
    running: false, progress: 0, message: "Idle", error: null
  };

  app.post("/api/engine/train", async (_req: Request, res: Response) => {
    if (engineTrainingJob.running) {
      return res.status(409).json({ error: "Training already in progress" });
    }
    engineTrainingJob = { running: true, progress: 0, message: "Starting...", error: null };
    res.json({ started: true });

    (async () => {
      try {
        await engine.train((pct, msg) => {
          engineTrainingJob.progress = pct;
          engineTrainingJob.message = msg;
        });
        engineTrainingJob.running = false;
        engineTrainingJob.progress = 100;
        engineTrainingJob.message = "Training complete!";
      } catch (err: any) {
        engineTrainingJob.running = false;
        engineTrainingJob.error = err.message;
        engineTrainingJob.message = "Training failed";
      }
    })();
  });

  app.get("/api/engine/training-progress", (_req: Request, res: Response) => {
    res.json(engineTrainingJob);
  });

  // ─── xG Engine: delete all saved models (fresh start) ────────────────────
  app.delete("/api/engine/models", (_req: Request, res: Response) => {
    try {
      db.prepare("DELETE FROM engine_models").run();
      engine.reset();
      res.json({ success: true, message: "All saved engine models cleared. Ready to retrain." });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── xG Engine: predict for stored match ──────────────────────────────────
  app.get("/api/engine/predict/:eventId", async (req: Request, res: Response) => {
    try {
      const eventId = Number(req.params.eventId);

      // 1. Check DB for match metadata (scores, teams)
      const dbRow: any = db.prepare("SELECT * FROM match_simulations WHERE event_id = ?").get(eventId);

      // Resolve team IDs from query params or DB row
      const homeTeamId = Number(req.query.homeTeamId) || dbRow?.home_team_id;
      const awayTeamId = Number(req.query.awayTeamId) || dbRow?.away_team_id;
      const homeTeamName = String(req.query.homeTeamName || dbRow?.home_team_name || "Home");
      const awayTeamName = String(req.query.awayTeamName || dbRow?.away_team_name || "Away");

      let row: any = null;

      // 2. Always build feature row from fresh simulation data when team IDs are available
      if (homeTeamId && awayTeamId) {
        // Fetch team stats via the player-simulation endpoint
        const serverPort = process.env.PORT || 5000;
        const baseUrl = `http://localhost:${serverPort}`;
        const simRes = await fetch(
          `${baseUrl}/api/event/${eventId}/player-simulation?homeTeamId=${homeTeamId}&awayTeamId=${awayTeamId}`,
          { signal: AbortSignal.timeout(30000) }
        );

        if (!simRes.ok) {
          // Sim data unavailable — will fall back to DB row below
          console.warn(`[engine/predict] sim fetch failed (${simRes.status}) — falling back to DB row`);
        } else {

        const sim: any = await simRes.json();
        const h = sim.home;
        const a = sim.away;
        const hStats    = h?.teamMatchStats?.all;
        const hStats1h  = h?.teamMatchStats?.firstHalf;
        const hStats2h  = h?.teamMatchStats?.secondHalf;
        const aStats    = a?.teamMatchStats?.all;
        const aStats1h  = a?.teamMatchStats?.firstHalf;
        const aStats2h  = a?.teamMatchStats?.secondHalf;
        const hPhase    = h?.phaseStrengths;
        const aPhase    = a?.phaseStrengths;
        const hForm     = h?.formSummary;
        const aForm     = a?.formSummary;

        // Build a synthetic feature row matching ALL 92 engine features
        row = {
          event_id: eventId,
          home_team_id: homeTeamId,
          home_team_name: homeTeamName,
          away_team_id: awayTeamId,
          away_team_name: awayTeamName,
          home_goals: null,
          away_goals: null,
          result: null,
          match_date: new Date().toISOString().slice(0, 10),
          tournament: String(req.query.tournamentName || ""),

          // ── Home full-match averages ──────────────────────────────────────
          home_avg_xg:                  hStats?.avgXg                  ?? null,
          home_avg_goals_scored:        hStats?.avgGoalsScored          ?? null,
          home_avg_goals_conceded:      hStats?.avgGoalsConceded        ?? null,
          home_avg_big_chances:         hStats?.avgBigChances           ?? null,
          home_avg_big_chances_scored:  hStats?.avgBigChancesScored     ?? null,
          home_avg_big_chances_missed:  hStats?.avgBigChancesMissed     ?? null,
          home_avg_total_shots:         hStats?.avgTotalShots           ?? null,
          home_avg_shots_on_target:     hStats?.avgShotsOnTarget        ?? null,
          home_avg_shots_off_target:    hStats?.avgShotsOffTarget       ?? null,
          home_avg_blocked_shots:       hStats?.avgBlockedShots         ?? null,
          home_avg_shots_inside_box:    hStats?.avgShotsInsideBox       ?? null,
          home_avg_possession:          hStats?.avgPossession           ?? null,
          home_avg_pass_accuracy:       hStats?.avgPassAccuracy         ?? null,
          home_avg_total_passes:        hStats?.avgTotalPasses          ?? null,
          home_avg_corner_kicks:        hStats?.avgCornerKicks          ?? null,
          home_avg_fouls:               hStats?.avgFouls                ?? null,
          home_avg_duels_won:           hStats?.avgDuelsWon             ?? null,
          home_avg_tackles_won:         hStats?.avgTacklesWon           ?? null,
          home_avg_interceptions:       hStats?.avgInterceptions        ?? null,
          home_avg_clearances:          hStats?.avgClearances           ?? null,
          home_avg_goalkeeper_saves:    hStats?.avgGoalkeeperSaves      ?? null,
          home_avg_goals_prevented:     hStats?.avgGoalsPrevented       ?? null,

          // ── Home role strengths ───────────────────────────────────────────
          home_phase_attack:            hPhase?.attackStrength          ?? null,
          home_phase_defensive:         hPhase?.defensiveStrength       ?? null,
          home_phase_midfield:          hPhase?.midfieldStrength        ?? null,
          home_phase_keeper:            hPhase?.keeperStrength          ?? null,
          home_phase_fullback:          hPhase?.fullbackStrength        ?? null,

          // ── Home form (last 7) ────────────────────────────────────────────
          home_form_strength:           h?.formStrength                 ?? null,
          home_scoring_strength:        h?.scoringStrength              ?? null,
          home_defending_strength:      h?.defendingStrength            ?? null,
          home_form_points:             hForm?.formPoints               ?? h?.formPoints ?? null,
          home_clean_sheets:            hForm?.cleanSheets              ?? null,

          // ── Home 1st-half averages ────────────────────────────────────────
          home_h1_avg_xg:               hStats1h?.avgXg                 ?? null,
          home_h1_avg_goals_scored:     hStats1h?.avgGoalsScored        ?? null,
          home_h1_avg_goals_conceded:   hStats1h?.avgGoalsConceded      ?? null,
          home_h1_avg_big_chances:      hStats1h?.avgBigChances         ?? null,
          home_h1_avg_total_shots:      hStats1h?.avgTotalShots         ?? null,
          home_h1_avg_possession:       hStats1h?.avgPossession         ?? null,
          home_h1_avg_pass_accuracy:    hStats1h?.avgPassAccuracy       ?? null,

          // ── Home 2nd-half averages ────────────────────────────────────────
          home_h2_avg_xg:               hStats2h?.avgXg                 ?? null,
          home_h2_avg_goals_scored:     hStats2h?.avgGoalsScored        ?? null,
          home_h2_avg_goals_conceded:   hStats2h?.avgGoalsConceded      ?? null,
          home_h2_avg_big_chances:      hStats2h?.avgBigChances         ?? null,
          home_h2_avg_total_shots:      hStats2h?.avgTotalShots         ?? null,
          home_h2_avg_possession:       hStats2h?.avgPossession         ?? null,
          home_h2_avg_pass_accuracy:    hStats2h?.avgPassAccuracy       ?? null,

          // ── Away full-match averages ──────────────────────────────────────
          away_avg_xg:                  aStats?.avgXg                   ?? null,
          away_avg_goals_scored:        aStats?.avgGoalsScored          ?? null,
          away_avg_goals_conceded:      aStats?.avgGoalsConceded        ?? null,
          away_avg_big_chances:         aStats?.avgBigChances           ?? null,
          away_avg_big_chances_scored:  aStats?.avgBigChancesScored     ?? null,
          away_avg_big_chances_missed:  aStats?.avgBigChancesMissed     ?? null,
          away_avg_total_shots:         aStats?.avgTotalShots           ?? null,
          away_avg_shots_on_target:     aStats?.avgShotsOnTarget        ?? null,
          away_avg_shots_off_target:    aStats?.avgShotsOffTarget       ?? null,
          away_avg_blocked_shots:       aStats?.avgBlockedShots         ?? null,
          away_avg_shots_inside_box:    aStats?.avgShotsInsideBox       ?? null,
          away_avg_possession:          aStats?.avgPossession           ?? null,
          away_avg_pass_accuracy:       aStats?.avgPassAccuracy         ?? null,
          away_avg_total_passes:        aStats?.avgTotalPasses          ?? null,
          away_avg_corner_kicks:        aStats?.avgCornerKicks          ?? null,
          away_avg_fouls:               aStats?.avgFouls                ?? null,
          away_avg_duels_won:           aStats?.avgDuelsWon             ?? null,
          away_avg_tackles_won:         aStats?.avgTacklesWon           ?? null,
          away_avg_interceptions:       aStats?.avgInterceptions        ?? null,
          away_avg_clearances:          aStats?.avgClearances           ?? null,
          away_avg_goalkeeper_saves:    aStats?.avgGoalkeeperSaves      ?? null,
          away_avg_goals_prevented:     aStats?.avgGoalsPrevented       ?? null,

          // ── Away role strengths ───────────────────────────────────────────
          away_phase_attack:            aPhase?.attackStrength          ?? null,
          away_phase_defensive:         aPhase?.defensiveStrength       ?? null,
          away_phase_midfield:          aPhase?.midfieldStrength        ?? null,
          away_phase_keeper:            aPhase?.keeperStrength          ?? null,
          away_phase_fullback:          aPhase?.fullbackStrength        ?? null,

          // ── Away form (last 7) ────────────────────────────────────────────
          away_form_strength:           a?.formStrength                 ?? null,
          away_scoring_strength:        a?.scoringStrength              ?? null,
          away_defending_strength:      a?.defendingStrength            ?? null,
          away_form_points:             aForm?.formPoints               ?? a?.formPoints ?? null,
          away_clean_sheets:            aForm?.cleanSheets              ?? null,

          // ── Away 1st-half averages ────────────────────────────────────────
          away_h1_avg_xg:               aStats1h?.avgXg                 ?? null,
          away_h1_avg_goals_scored:     aStats1h?.avgGoalsScored        ?? null,
          away_h1_avg_goals_conceded:   aStats1h?.avgGoalsConceded      ?? null,
          away_h1_avg_big_chances:      aStats1h?.avgBigChances         ?? null,
          away_h1_avg_total_shots:      aStats1h?.avgTotalShots         ?? null,
          away_h1_avg_possession:       aStats1h?.avgPossession         ?? null,
          away_h1_avg_pass_accuracy:    aStats1h?.avgPassAccuracy       ?? null,

          // ── Away 2nd-half averages ────────────────────────────────────────
          away_h2_avg_xg:               aStats2h?.avgXg                 ?? null,
          away_h2_avg_goals_scored:     aStats2h?.avgGoalsScored        ?? null,
          away_h2_avg_goals_conceded:   aStats2h?.avgGoalsConceded      ?? null,
          away_h2_avg_big_chances:      aStats2h?.avgBigChances         ?? null,
          away_h2_avg_total_shots:      aStats2h?.avgTotalShots         ?? null,
          away_h2_avg_possession:       aStats2h?.avgPossession         ?? null,
          away_h2_avg_pass_accuracy:    aStats2h?.avgPassAccuracy       ?? null,
        };

        // Merge real scores / result from DB row if this match has been played
        if (dbRow) {
          row.home_goals    = dbRow.home_goals    ?? null;
          row.away_goals    = dbRow.away_goals    ?? null;
          row.home_ht_goals = dbRow.home_ht_goals ?? null;
          row.away_ht_goals = dbRow.away_ht_goals ?? null;
          row.result        = dbRow.result        ?? null;
          row.tournament    = dbRow.tournament    || row.tournament;
          row.match_date    = dbRow.match_date    || row.match_date;
        }
        } // close else (sim ok)
      } // close if (homeTeamId && awayTeamId)

      // 3. Fall back to DB row if fresh sim was unavailable
      if (!row && dbRow) row = dbRow;

      if (!row) {
        return res.status(404).json({
          error: "Match not found. Provide homeTeamId and awayTeamId to predict for upcoming matches.",
        });
      }

      const prediction = await engine.predictFromRow(row);
      res.json({
        prediction,
        matchInfo: {
          homeTeam: row.home_team_name,
          awayTeam: row.away_team_name,
          homeGoals: row.home_goals ?? null,
          awayGoals: row.away_goals ?? null,
          result: row.result ?? null,
          matchDate: row.match_date,
          tournament: row.tournament,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── xG Engine: predict from raw simulation features ──────────────────────
  app.post("/api/engine/predict-features", async (req: Request, res: Response) => {
    try {
      const features = req.body as Record<string, any>;
      const prediction = await engine.predictFromRow(features);
      res.json({ prediction });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Database: list stored matches ────────────────────────────────────────
  app.get("/api/database/matches", (req: Request, res: Response) => {
    try {
      const { search, date, sport, limit = "100", offset = "0" } = req.query as Record<string, string>;
      let query = "SELECT * FROM match_simulations WHERE 1=1";
      const params: any[] = [];
      if (search) {
        query += " AND (home_team_name LIKE ? OR away_team_name LIKE ? OR tournament LIKE ?)";
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (date) {
        query += " AND match_date = ?";
        params.push(date);
      }
      if (sport) {
        query += " AND sport = ?";
        params.push(sport);
      }
      query += " ORDER BY processed_at DESC LIMIT ? OFFSET ?";
      params.push(Number(limit), Number(offset));
      const rows = db.prepare(query).all(...params);
      const countQuery = query.replace(/SELECT \*/, "SELECT COUNT(*) as total").replace(/ORDER BY.*/, "");
      const total = (db.prepare(countQuery).get(...params.slice(0, -2)) as any)?.total ?? 0;
      res.json({ matches: rows, total });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Database: delete a match ─────────────────────────────────────────────
  app.delete("/api/database/match/:eventId", (req: Request, res: Response) => {
    try {
      const info = db.prepare("DELETE FROM match_simulations WHERE event_id = ?").run(Number(req.params.eventId));
      if (info.changes === 0) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Database: clear all records ──────────────────────────────────────────
  app.delete("/api/database/clear-all", (_req: Request, res: Response) => {
    try {
      const info = db.prepare("DELETE FROM match_simulations").run();
      res.json({ success: true, deleted: info.changes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Database: stats summary ─────────────────────────────────────────────
  app.get("/api/database/stats", (_req: Request, res: Response) => {
    try {
      const total = (db.prepare("SELECT COUNT(*) as c FROM match_simulations").get() as any)?.c ?? 0;
      const byResult = db.prepare("SELECT result, COUNT(*) as c FROM match_simulations GROUP BY result").all();
      res.json({ total, byResult });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Processing: start job ────────────────────────────────────────────────
  app.post("/api/database/process-date", async (req: Request, res: Response) => {
    try {
      const { date, sport = "football" } = req.body as { date: string; sport?: string };
      if (!date) return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });

      const sofaDate = date;
      const eventsData = await fetchSofaScore(`/sport/${sport}/scheduled-events/${sofaDate}`);
      const allEvents: any[] = eventsData?.events || [];

      // SofaScore returns events across multiple dates (adjacent days due to timezones).
      // Only process events that actually fall on the selected date based on their startTimestamp.
      const finishedEvents = allEvents.filter((e: any) => {
        const type = e.status?.type;
        if (type !== "finished") return false;
        // Verify the event's actual date matches the selected date
        if (e.startTimestamp) {
          const eventDate = new Date(e.startTimestamp * 1000).toISOString().slice(0, 10);
          if (eventDate !== date) return false;
        }
        return true;
      });

      if (finishedEvents.length === 0) {
        return res.json({ jobId: null, message: "No finished matches found for this date", total: 0 });
      }

      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const job: ProcessingJob = {
        id: jobId,
        status: "running",
        total: finishedEvents.length,
        processed: 0,
        stored: 0,
        skipped: 0,
        failed: 0,
        log: [],
        cancelRequested: false,
      };
      jobs.set(jobId, job);

      const serverPort = process.env.PORT || 5000;
      const baseUrl = `http://localhost:${serverPort}`;

      (async () => {
        for (const event of finishedEvents) {
          if (job.cancelRequested) {
            job.status = "cancelled";
            break;
          }

          const eventId = event.id;
          const homeTeamId = event.homeTeam?.id;
          const awayTeamId = event.awayTeam?.id;
          const homeTeamName = event.homeTeam?.name || event.homeTeam?.shortName || "Unknown";
          const awayTeamName = event.awayTeam?.name || event.awayTeam?.shortName || "Unknown";
          const tournament = event.tournament?.name || event.tournament?.uniqueTournament?.name || "";
          const startTimestamp = event.startTimestamp;
          const matchDate = date;

          // Skip if already stored
          const existing = db.prepare("SELECT id FROM match_simulations WHERE event_id = ?").get(eventId);
          if (existing) {
            job.skipped++;
            job.processed++;
            job.log.push(`⏭ Skipped (already stored): ${homeTeamName} vs ${awayTeamName}`);
            continue;
          }

          const homeScore = event.homeScore?.current ?? event.homeScore?.display ?? null;
          const awayScore = event.awayScore?.current ?? event.awayScore?.display ?? null;
          if (homeScore === null || awayScore === null) {
            job.skipped++;
            job.processed++;
            job.log.push(`⏭ Skipped (no score): ${homeTeamName} vs ${awayTeamName}`);
            continue;
          }

          const hGoals = Number(homeScore);
          const aGoals = Number(awayScore);
          const result = hGoals > aGoals ? "H" : hGoals === aGoals ? "D" : "A";

          // Halftime scores
          const hHtGoals = event.homeScore?.period1 != null ? Number(event.homeScore.period1) : null;
          const aHtGoals = event.awayScore?.period1 != null ? Number(event.awayScore.period1) : null;

          try {
            // Anti-blocking: 2.5s delay between each match
            await sleep(2500);

            const simRes = await fetch(
              `${baseUrl}/api/event/${eventId}/player-simulation?homeTeamId=${homeTeamId}&awayTeamId=${awayTeamId}`,
              { signal: AbortSignal.timeout(60000) }
            );

            if (!simRes.ok) {
              throw new Error(`Simulation HTTP ${simRes.status}`);
            }

            const sim: any = await simRes.json();
            const h = sim.home;
            const a = sim.away;
            const hStats = h?.teamMatchStats?.all;
            const hStats1h = h?.teamMatchStats?.firstHalf;
            const hStats2h = h?.teamMatchStats?.secondHalf;
            const aStats = a?.teamMatchStats?.all;
            const aStats1h = a?.teamMatchStats?.firstHalf;
            const aStats2h = a?.teamMatchStats?.secondHalf;
            const hPhase = h?.phaseStrengths;
            const aPhase = a?.phaseStrengths;
            const hForm = h?.formSummary;
            const aForm = a?.formSummary;

            // ── Incomplete data check ────────────────────────────────────────
            // Require the full-match AND per-half key stats to be present for
            // both teams. We test actual averages that will be stored — if any
            // critical field is null the row is display-useless (shows "—").
            // Full-match: xG + possession + total shots (all required)
            // Per-half:   possession + total shots (xG is absent for many leagues;
            //             pass accuracy can be absent too — only poss+shots checked)
            const missingStats: string[] = [];
            if (hStats?.avgXg == null)            missingStats.push(`${homeTeamName} full-match xG`);
            if (hStats?.avgPossession == null)     missingStats.push(`${homeTeamName} full-match possession`);
            if (hStats?.avgTotalShots == null)     missingStats.push(`${homeTeamName} full-match shots`);
            if (aStats?.avgXg == null)            missingStats.push(`${awayTeamName} full-match xG`);
            if (aStats?.avgPossession == null)     missingStats.push(`${awayTeamName} full-match possession`);
            if (aStats?.avgTotalShots == null)     missingStats.push(`${awayTeamName} full-match shots`);
            if (hStats1h?.avgPossession == null)   missingStats.push(`${homeTeamName} 1H possession`);
            if (hStats1h?.avgTotalShots == null)   missingStats.push(`${homeTeamName} 1H shots`);
            if (hStats2h?.avgPossession == null)   missingStats.push(`${homeTeamName} 2H possession`);
            if (hStats2h?.avgTotalShots == null)   missingStats.push(`${homeTeamName} 2H shots`);
            if (aStats1h?.avgPossession == null)   missingStats.push(`${awayTeamName} 1H possession`);
            if (aStats1h?.avgTotalShots == null)   missingStats.push(`${awayTeamName} 1H shots`);
            if (aStats2h?.avgPossession == null)   missingStats.push(`${awayTeamName} 2H possession`);
            if (aStats2h?.avgTotalShots == null)   missingStats.push(`${awayTeamName} 2H shots`);
            if (missingStats.length > 0) {
              job.skipped++;
              job.processed++;
              job.log.push(`⏭ Skipped (incomplete stats — missing: ${missingStats.slice(0, 3).join(", ")}${missingStats.length > 3 ? ` +${missingStats.length - 3} more` : ""}): ${homeTeamName} vs ${awayTeamName}`);
              continue;
            }

            // ── Injury / suspension data ─────────────────────────────────────
            const hInjured = JSON.stringify(h?.injuredPlayers ?? []);
            const aSuspended = JSON.stringify(a?.suspendedPlayers ?? []);
            const hSuspended = JSON.stringify(h?.suspendedPlayers ?? []);
            const aInjured = JSON.stringify(a?.injuredPlayers ?? []);
            const hInjuryImpact = h?.injuryImpact ?? 0;
            const aInjuryImpact = a?.injuryImpact ?? 0;

            db.prepare(`
              INSERT OR REPLACE INTO match_simulations (
                event_id, home_team_id, home_team_name, away_team_id, away_team_name,
                tournament, sport, match_date, start_timestamp,
                home_goals, away_goals, result,
                home_phase_defensive, home_phase_attack, home_phase_midfield, home_phase_keeper, home_phase_fullback,
                home_form_strength, home_scoring_strength, home_defending_strength,
                home_form_points, home_goals_for, home_goals_against, home_clean_sheets, home_recent_form,
                home_avg_goals_scored, home_avg_goals_conceded, home_avg_xg, home_avg_possession,
                home_avg_big_chances, home_avg_total_shots, home_avg_shots_on_target, home_avg_shots_off_target,
                home_avg_blocked_shots, home_avg_shots_inside_box, home_avg_big_chances_scored, home_avg_big_chances_missed,
                home_avg_corner_kicks, home_avg_fouls, home_avg_total_passes, home_avg_pass_accuracy,
                home_avg_duels_won, home_avg_tackles_won, home_avg_interceptions, home_avg_clearances,
                home_avg_goalkeeper_saves, home_avg_goals_prevented, home_matches_analyzed,
                away_phase_defensive, away_phase_attack, away_phase_midfield, away_phase_keeper, away_phase_fullback,
                away_form_strength, away_scoring_strength, away_defending_strength,
                away_form_points, away_goals_for, away_goals_against, away_clean_sheets, away_recent_form,
                away_avg_goals_scored, away_avg_goals_conceded, away_avg_xg, away_avg_possession,
                away_avg_big_chances, away_avg_total_shots, away_avg_shots_on_target, away_avg_shots_off_target,
                away_avg_blocked_shots, away_avg_shots_inside_box, away_avg_big_chances_scored, away_avg_big_chances_missed,
                away_avg_corner_kicks, away_avg_fouls, away_avg_total_passes, away_avg_pass_accuracy,
                away_avg_duels_won, away_avg_tackles_won, away_avg_interceptions, away_avg_clearances,
                away_avg_goalkeeper_saves, away_avg_goals_prevented, away_matches_analyzed,
                home_ht_goals, away_ht_goals,
                home_h1_avg_goals_scored, home_h1_avg_goals_conceded, home_h1_avg_xg, home_h1_avg_possession, home_h1_avg_big_chances, home_h1_avg_total_shots, home_h1_avg_pass_accuracy, home_h1_avg_total_passes,
                home_h2_avg_goals_scored, home_h2_avg_goals_conceded, home_h2_avg_xg, home_h2_avg_possession, home_h2_avg_big_chances, home_h2_avg_total_shots, home_h2_avg_pass_accuracy, home_h2_avg_total_passes,
                away_h1_avg_goals_scored, away_h1_avg_goals_conceded, away_h1_avg_xg, away_h1_avg_possession, away_h1_avg_big_chances, away_h1_avg_total_shots, away_h1_avg_pass_accuracy, away_h1_avg_total_passes,
                away_h2_avg_goals_scored, away_h2_avg_goals_conceded, away_h2_avg_xg, away_h2_avg_possession, away_h2_avg_big_chances, away_h2_avg_total_shots, away_h2_avg_pass_accuracy, away_h2_avg_total_passes,
                processed_at,
                home_injured_players, away_injured_players,
                home_suspended_players, away_suspended_players,
                home_injury_impact, away_injury_impact
              ) VALUES (
                ?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,
                ?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?
              )
            `).run(
              eventId, homeTeamId, homeTeamName, awayTeamId, awayTeamName,
              tournament, sport, matchDate, startTimestamp,
              hGoals, aGoals, result,
              hPhase?.defensiveStrength ?? null, hPhase?.attackStrength ?? null, hPhase?.midfieldStrength ?? null, hPhase?.keeperStrength ?? null, hPhase?.fullbackStrength ?? null,
              h?.formStrength ?? null, h?.scoringStrength ?? null, h?.defendingStrength ?? null,
              hForm?.formPoints ?? null, hForm?.goalsFor ?? null, hForm?.goalsAgainst ?? null, hForm?.cleanSheets ?? null,
              (hForm?.recentForm || []).join(" ") || null,
              hStats?.avgGoalsScored ?? null, hStats?.avgGoalsConceded ?? null, hStats?.avgXg ?? null, hStats?.avgPossession ?? null,
              hStats?.avgBigChances ?? null, hStats?.avgTotalShots ?? null, hStats?.avgShotsOnTarget ?? null, hStats?.avgShotsOffTarget ?? null,
              hStats?.avgBlockedShots ?? null, hStats?.avgShotsInsideBox ?? null, hStats?.avgBigChancesScored ?? null, hStats?.avgBigChancesMissed ?? null,
              hStats?.avgCornerKicks ?? null, hStats?.avgFouls ?? null, hStats?.avgTotalPasses ?? null, hStats?.avgPassAccuracy ?? null,
              hStats?.avgDuelsWon ?? null, hStats?.avgTacklesWon ?? null, hStats?.avgInterceptions ?? null, hStats?.avgClearances ?? null,
              hStats?.avgGoalkeeperSaves ?? null, hStats?.avgGoalsPrevented ?? null, h?.matchesAnalyzed ?? null,
              aPhase?.defensiveStrength ?? null, aPhase?.attackStrength ?? null, aPhase?.midfieldStrength ?? null, aPhase?.keeperStrength ?? null, aPhase?.fullbackStrength ?? null,
              a?.formStrength ?? null, a?.scoringStrength ?? null, a?.defendingStrength ?? null,
              aForm?.formPoints ?? null, aForm?.goalsFor ?? null, aForm?.goalsAgainst ?? null, aForm?.cleanSheets ?? null,
              (aForm?.recentForm || []).join(" ") || null,
              aStats?.avgGoalsScored ?? null, aStats?.avgGoalsConceded ?? null, aStats?.avgXg ?? null, aStats?.avgPossession ?? null,
              aStats?.avgBigChances ?? null, aStats?.avgTotalShots ?? null, aStats?.avgShotsOnTarget ?? null, aStats?.avgShotsOffTarget ?? null,
              aStats?.avgBlockedShots ?? null, aStats?.avgShotsInsideBox ?? null, aStats?.avgBigChancesScored ?? null, aStats?.avgBigChancesMissed ?? null,
              aStats?.avgCornerKicks ?? null, aStats?.avgFouls ?? null, aStats?.avgTotalPasses ?? null, aStats?.avgPassAccuracy ?? null,
              aStats?.avgDuelsWon ?? null, aStats?.avgTacklesWon ?? null, aStats?.avgInterceptions ?? null, aStats?.avgClearances ?? null,
              aStats?.avgGoalkeeperSaves ?? null, aStats?.avgGoalsPrevented ?? null, a?.matchesAnalyzed ?? null,
              hHtGoals, aHtGoals,
              hStats1h?.avgGoalsScored ?? null, hStats1h?.avgGoalsConceded ?? null, hStats1h?.avgXg ?? null, hStats1h?.avgPossession ?? null, hStats1h?.avgBigChances ?? null, hStats1h?.avgTotalShots ?? null, hStats1h?.avgPassAccuracy ?? null, hStats1h?.avgTotalPasses ?? null,
              hStats2h?.avgGoalsScored ?? null, hStats2h?.avgGoalsConceded ?? null, hStats2h?.avgXg ?? null, hStats2h?.avgPossession ?? null, hStats2h?.avgBigChances ?? null, hStats2h?.avgTotalShots ?? null, hStats2h?.avgPassAccuracy ?? null, hStats2h?.avgTotalPasses ?? null,
              aStats1h?.avgGoalsScored ?? null, aStats1h?.avgGoalsConceded ?? null, aStats1h?.avgXg ?? null, aStats1h?.avgPossession ?? null, aStats1h?.avgBigChances ?? null, aStats1h?.avgTotalShots ?? null, aStats1h?.avgPassAccuracy ?? null, aStats1h?.avgTotalPasses ?? null,
              aStats2h?.avgGoalsScored ?? null, aStats2h?.avgGoalsConceded ?? null, aStats2h?.avgXg ?? null, aStats2h?.avgPossession ?? null, aStats2h?.avgBigChances ?? null, aStats2h?.avgTotalShots ?? null, aStats2h?.avgPassAccuracy ?? null, aStats2h?.avgTotalPasses ?? null,
              new Date().toISOString(),
              hInjured, aInjured,
              hSuspended, aSuspended,
              hInjuryImpact, aInjuryImpact,
            );

            job.stored++;
            const hKeyMissing = [...(h?.injuredPlayers ?? []), ...(h?.suspendedPlayers ?? [])].filter((p: any) => p.isKeyPlayer).length;
            const aKeyMissing = [...(a?.injuredPlayers ?? []), ...(a?.suspendedPlayers ?? [])].filter((p: any) => p.isKeyPlayer).length;
            const injuryNote = (hKeyMissing > 0 || aKeyMissing > 0)
              ? ` | 🚑 Key absences: H${hKeyMissing} A${aKeyMissing}`
              : "";
            job.log.push(`✅ Stored: ${homeTeamName} ${hGoals}-${aGoals} ${awayTeamName} (${tournament})${injuryNote}`);
          } catch (err: any) {
            job.failed++;
            job.log.push(`❌ Failed: ${homeTeamName} vs ${awayTeamName} — ${err.message}`);
          }

          job.processed++;
        }

        if (job.status !== "cancelled") job.status = "completed";
      })();

      res.json({ jobId, total: finishedEvents.length });
    } catch (error: any) {
      console.error("Process-date error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Processing: poll job status ──────────────────────────────────────────
  app.get("/api/database/job/:jobId", (req: Request, res: Response) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  });

  // ─── Processing: cancel job ───────────────────────────────────────────────
  app.post("/api/database/job/:jobId/cancel", (req: Request, res: Response) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    job.cancelRequested = true;
    res.json({ success: true });
  });

  const httpServer = createServer(app);
  return httpServer;
}
