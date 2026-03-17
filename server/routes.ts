import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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

async function fetchSofaScore(endpoint: string) {
  const url = `${SOFASCORE_API}${endpoint}`;
  const res = await fetch(url, { headers: SOFASCORE_HEADERS });
  if (!res.ok) {
    throw new Error(`SofaScore API error: ${res.status}`);
  }
  return res.json();
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
        const data = await fetchSofaScore(
          `/event/${req.params.eventId}/lineups`,
        );
        res.json(data);
      } catch (error: any) {
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

      const [homeEventsData, awayEventsData, eventOddsData, eventData] = await Promise.allSettled([
        fetchSofaScore(`/team/${homeTeamId}/events/last/0`),
        fetchSofaScore(`/team/${awayTeamId}/events/last/0`),
        eventId ? fetchSofaScore(`/event/${eventId}/odds/1/all`) : Promise.resolve(null),
        eventId ? fetchSofaScore(`/event/${eventId}`) : Promise.resolve(null),
      ]);

      const homeEvents: any[] = homeEventsData.status === "fulfilled" ? (homeEventsData.value as any)?.events || [] : [];
      const awayEvents: any[] = awayEventsData.status === "fulfilled" ? (awayEventsData.value as any)?.events || [] : [];
      const currentMatchOddsRaw = eventOddsData.status === "fulfilled" ? eventOddsData.value : null;
      const currentEvent = eventData.status === "fulfilled" ? (eventData.value as any)?.event : null;

      const last15Home = homeEvents.slice(0, 15);
      const last15Away = awayEvents.slice(0, 15);

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
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
