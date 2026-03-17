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

      // Fetch all data in parallel
      const [homeEventsData, awayEventsData, eventOddsData, eventData] = await Promise.allSettled([
        fetchSofaScore(`/team/${homeTeamId}/events/last/0`),
        fetchSofaScore(`/team/${awayTeamId}/events/last/0`),
        eventId ? fetchSofaScore(`/event/${eventId}/odds/1/all`) : Promise.resolve(null),
        eventId ? fetchSofaScore(`/event/${eventId}`) : Promise.resolve(null),
      ]);

      const homeEvents = homeEventsData.status === "fulfilled" ? (homeEventsData.value as any)?.events || [] : [];
      const awayEvents = awayEventsData.status === "fulfilled" ? (awayEventsData.value as any)?.events || [] : [];
      const oddsData = eventOddsData.status === "fulfilled" ? eventOddsData.value : null;
      const currentEvent = eventData.status === "fulfilled" ? (eventData.value as any)?.event : null;

      const last15Home = homeEvents.slice(0, 15);
      const last15Away = awayEvents.slice(0, 15);

      function summarizeMatch(match: any, teamId: number) {
        const isHome = match.homeTeam?.id === Number(teamId);
        const teamScore = isHome ? match.homeScore?.display ?? match.homeScore?.current ?? 0 : match.awayScore?.display ?? match.awayScore?.current ?? 0;
        const oppScore = isHome ? match.awayScore?.display ?? match.awayScore?.current ?? 0 : match.homeScore?.display ?? match.homeScore?.current ?? 0;
        const opponent = isHome ? match.awayTeam?.name || match.awayTeam?.shortName : match.homeTeam?.name || match.homeTeam?.shortName;
        let result = "D";
        if (match.winnerCode === 1) result = isHome ? "W" : "L";
        else if (match.winnerCode === 2) result = isHome ? "L" : "W";
        const date = new Date(match.startTimestamp * 1000).toISOString().split("T")[0];
        const competition = match.tournament?.uniqueTournament?.name || match.tournament?.name || "Unknown";
        const totalGoals = teamScore + oppScore;
        const cleanSheet = oppScore === 0;
        const scored = teamScore > 0;
        return {
          date,
          result,
          score: `${teamScore}-${oppScore}`,
          side: isHome ? "Home" : "Away",
          opponent,
          competition,
          totalGoals,
          cleanSheet,
          scored,
          goalsScored: teamScore,
          goalsConceded: oppScore,
        };
      }

      const homeSummaries = last15Home.map((m: any) => summarizeMatch(m, Number(homeTeamId)));
      const awaySummaries = last15Away.map((m: any) => summarizeMatch(m, Number(awayTeamId)));

      // Extract key stats
      function computeStats(summaries: ReturnType<typeof summarizeMatch>[]) {
        const played = summaries.length;
        if (played === 0) return null;
        const wins = summaries.filter(s => s.result === "W").length;
        const draws = summaries.filter(s => s.result === "D").length;
        const losses = summaries.filter(s => s.result === "L").length;
        const goalsScored = summaries.reduce((a, s) => a + s.goalsScored, 0);
        const goalsConceded = summaries.reduce((a, s) => a + s.goalsConceded, 0);
        const cleanSheets = summaries.filter(s => s.cleanSheet).length;
        const failedToScore = summaries.filter(s => !s.scored).length;
        const btts = summaries.filter(s => s.scored && !s.cleanSheet).length;
        const over25 = summaries.filter(s => s.totalGoals > 2).length;
        const over15 = summaries.filter(s => s.totalGoals > 1).length;
        const homeMatches = summaries.filter(s => s.side === "Home");
        const awayMatches = summaries.filter(s => s.side === "Away");
        const homeWins = homeMatches.filter(s => s.result === "W").length;
        const awayWins = awayMatches.filter(s => s.result === "W").length;
        const last5 = summaries.slice(0, 5);
        const last5Form = last5.map(s => s.result).join("");
        const avgGoalsScored = goalsScored / played;
        const avgGoalsConceded = goalsConceded / played;
        return {
          played, wins, draws, losses, goalsScored, goalsConceded,
          cleanSheets, failedToScore, btts, over25, over15,
          homeRecord: `${homeWins}W/${homeMatches.length - homeWins - homeMatches.filter(s => s.result === "D").length}L/${homeMatches.filter(s => s.result === "D").length}D`,
          awayRecord: `${awayWins}W/${awayMatches.length - awayWins - awayMatches.filter(s => s.result === "D").length}L/${awayMatches.filter(s => s.result === "D").length}D`,
          last5Form,
          avgGoalsScored: Math.round(avgGoalsScored * 100) / 100,
          avgGoalsConceded: Math.round(avgGoalsConceded * 100) / 100,
        };
      }

      const homeStats = computeStats(homeSummaries);
      const awayStats = computeStats(awaySummaries);

      // Extract relevant odds from the current match
      const relevantOdds: Record<string, any> = {};
      if (oddsData && (oddsData as any)?.markets) {
        const markets = (oddsData as any).markets;
        for (const market of markets.slice(0, 8)) {
          relevantOdds[market.marketName || market.id] = (market.choices || []).map((c: any) => ({
            name: c.name,
            fractionalValue: c.fractionalValue,
            initialFractionalValue: c.initialFractionalValue,
          }));
        }
      }

      const prompt = `You are an expert football betting analyst with deep knowledge of football statistics, team dynamics, player psychology, and betting markets. Your task is to perform a rigorous, multi-layered analysis of an upcoming match to identify profitable betting markets.

MATCH: ${homeTeamName} vs ${awayTeamName}
COMPETITION: ${tournamentName || "Unknown"}
${currentEvent ? `DATE: ${new Date(currentEvent.startTimestamp * 1000).toISOString().split("T")[0]}` : ""}

=== ${homeTeamName?.toUpperCase()} - LAST ${homeSummaries.length} MATCHES ===
Overall Stats: ${homeStats ? `${homeStats.wins}W ${homeStats.draws}D ${homeStats.losses}L | GF:${homeStats.goalsScored} GA:${homeStats.goalsConceded} | Avg GF:${homeStats.avgGoalsScored} Avg GA:${homeStats.avgGoalsConceded}` : "N/A"}
${homeStats ? `Clean Sheets: ${homeStats.cleanSheets}/${homeStats.played} | Failed to Score: ${homeStats.failedToScore}/${homeStats.played} | BTTS: ${homeStats.btts}/${homeStats.played} | Over 2.5: ${homeStats.over25}/${homeStats.played}` : ""}
${homeStats ? `Last 5 Form: ${homeStats.last5Form} | Home Record: ${homeStats.homeRecord} | Away Record: ${homeStats.awayRecord}` : ""}

Match-by-match (most recent first):
${homeSummaries.map((m, i) => `${i + 1}. [${m.date}] ${m.side} vs ${m.opponent} (${m.competition}): ${m.result} ${m.score}`).join("\n")}

=== ${awayTeamName?.toUpperCase()} - LAST ${awaySummaries.length} MATCHES ===
Overall Stats: ${awayStats ? `${awayStats.wins}W ${awayStats.draws}D ${awayStats.losses}L | GF:${awayStats.goalsScored} GA:${awayStats.goalsConceded} | Avg GF:${awayStats.avgGoalsScored} Avg GA:${awayStats.avgGoalsConceded}` : "N/A"}
${awayStats ? `Clean Sheets: ${awayStats.cleanSheets}/${awayStats.played} | Failed to Score: ${awayStats.failedToScore}/${awayStats.played} | BTTS: ${awayStats.btts}/${awayStats.played} | Over 2.5: ${awayStats.over25}/${awayStats.played}` : ""}
${awayStats ? `Last 5 Form: ${awayStats.last5Form} | Home Record: ${awayStats.homeRecord} | Away Record: ${awayStats.awayRecord}` : ""}

Match-by-match (most recent first):
${awaySummaries.map((m, i) => `${i + 1}. [${m.date}] ${m.side} vs ${m.opponent} (${m.competition}): ${m.result} ${m.score}`).join("\n")}

${Object.keys(relevantOdds).length > 0 ? `=== CURRENT MATCH ODDS ===\n${JSON.stringify(relevantOdds, null, 2)}` : ""}

=== YOUR ANALYSIS TASK ===
Perform a deep, reasoning-heavy analysis. Think step by step through the following:

1. MOMENTUM & FORM: Is each team on an upward or downward trajectory? Are wins/losses consistent or sporadic?
2. OPPONENT QUALITY: What level of opponents have they been beating or losing to? Wins against weak teams mean less.
3. HOME/AWAY PATTERNS: How do each team perform at home vs away? Is there a significant difference?
4. GOALS PATTERNS: Analyze scoring and conceding trends. Are they defensively solid recently or leaking goals? Do they tend to keep clean sheets or concede?
5. CONTEXT FACTORS: Competition importance (league vs cup), scheduling fatigue, momentum shifts.
6. HEAD-TO-HEAD CONSIDERATIONS: Based on the statistical profiles, predict how these two specific teams match up stylistically.
7. ODDS ANALYSIS: If odds are provided, identify any value discrepancies vs your statistical assessment.

Then output ONLY a valid JSON object (no markdown, no code blocks) with this exact structure:
{
  "summary": "2-3 sentence sharp overview of the matchup",
  "homeTeamAnalysis": {
    "form": "description of recent form trend",
    "strengths": ["strength 1", "strength 2"],
    "weaknesses": ["weakness 1", "weakness 2"],
    "keyTrend": "the single most important statistical trend"
  },
  "awayTeamAnalysis": {
    "form": "description of recent form trend",
    "strengths": ["strength 1", "strength 2"],
    "weaknesses": ["weakness 1", "weakness 2"],
    "keyTrend": "the single most important statistical trend"
  },
  "predictions": [
    {
      "market": "Match Result (1X2)",
      "pick": "Home Win / Draw / Away Win",
      "confidence": 75,
      "reasoning": "detailed reasoning why this is the right pick and what could invalidate it"
    },
    {
      "market": "Goals Over/Under 2.5",
      "pick": "Over 2.5 / Under 2.5",
      "confidence": 70,
      "reasoning": "detailed reasoning"
    },
    {
      "market": "Both Teams to Score",
      "pick": "Yes / No",
      "confidence": 65,
      "reasoning": "detailed reasoning"
    },
    {
      "market": "Double Chance",
      "pick": "Home/Draw or Away/Draw or Home/Away",
      "confidence": 80,
      "reasoning": "detailed reasoning"
    }
  ],
  "bestBet": {
    "market": "the single highest confidence bet market name",
    "pick": "the pick for best bet",
    "confidence": 82,
    "reasoning": "why this is the safest most profitable bet"
  },
  "riskFactors": ["factor 1 that could invalidate predictions", "factor 2"],
  "dataConfidence": "High / Medium / Low - based on how much data was available"
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
