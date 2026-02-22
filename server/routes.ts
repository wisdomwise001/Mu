import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";

const SOFASCORE_API = "https://api.sofascore.com/api/v1";

const SOFASCORE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en",
  Referer: "https://www.sofascore.com/",
  Origin: "https://www.sofascore.com",
};

async function fetchSofaScore(endpoint: string) {
  const url = `${SOFASCORE_API}${endpoint}`;
  const res = await fetch(url, { headers: SOFASCORE_HEADERS });
  if (!res.ok) {
    throw new Error(`SofaScore API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
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

  app.get(
    "/api/team/:teamId/image",
    async (req: Request, res: Response) => {
      try {
        const { teamId } = req.params;
        const url = `https://api.sofascore.app/api/v1/team/${teamId}/image`;
        const response = await fetch(url, { headers: SOFASCORE_HEADERS });
        if (!response.ok) {
          return res.status(response.status).send("Image not found");
        }
        const contentType = response.headers.get("content-type") || "image/png";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
      } catch (error: any) {
        res.status(500).send("Error fetching image");
      }
    },
  );

  app.get(
    "/api/unique-tournament/:tournamentId/image",
    async (req: Request, res: Response) => {
      try {
        const { tournamentId } = req.params;
        const url = `https://api.sofascore.app/api/v1/unique-tournament/${tournamentId}/image`;
        const response = await fetch(url, { headers: SOFASCORE_HEADERS });
        if (!response.ok) {
          return res.status(response.status).send("Image not found");
        }
        const contentType = response.headers.get("content-type") || "image/png";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
      } catch (error: any) {
        res.status(500).send("Error fetching image");
      }
    },
  );

  const httpServer = createServer(app);
  return httpServer;
}
