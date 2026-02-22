import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";

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

  const httpServer = createServer(app);
  return httpServer;
}
