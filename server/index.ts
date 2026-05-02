import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { registerRoutes } from "./routes";
import { scrapeGeonodeProxies } from "./proxyScraper";
import { reloadProxies } from "./proxyFetch";
import * as fs from "fs";
import * as path from "path";

const EXPO_WEB_PORT = 8080;

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    const origin = req.header("origin");

    // Allow localhost origins for Expo web development (any port)
    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application, server: import("http").Server) {
  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    log(`[web-proxy] Development mode — proxying web UI to http://localhost:${EXPO_WEB_PORT}`);

    // Intercept iOS/Android manifest requests before the proxy
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return serveExpoManifest(platform, res);
      }
      next();
    });

    // Proxy everything else (web UI + Metro HMR) to the Expo dev server
    const expoProxy = createProxyMiddleware({
      target: `http://localhost:${EXPO_WEB_PORT}`,
      changeOrigin: true,
      ws: true,
      on: {
        error: (_err, _req, res) => {
          if (res && "writeHead" in res) {
            (res as import("http").ServerResponse).writeHead(502);
            (res as import("http").ServerResponse).end(
              "Expo web dev server not ready yet — please wait a moment and refresh.",
            );
          }
        },
      },
    });

    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      return (expoProxy as any)(req, res, next);
    });

    // Upgrade WebSocket connections (Metro HMR / fast-refresh)
    server.on("upgrade", expoProxy.upgrade as any);

    return;
  }

  // --- Production: serve pre-built static files ---
  log("Serving static Expo files with dynamic manifest routing");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next();
    if (req.path !== "/" && req.path !== "/manifest") return next();

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    if (req.path === "/") {
      const templatePath = path.resolve(
        process.cwd(),
        "server",
        "templates",
        "landing-page.html",
      );
      const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
      const appName = getAppName();
      return serveLandingPage({ req, res, landingPageTemplate, appName });
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

const PROXY_REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const PROXIES_PATH = path.join(process.cwd(), "data", "proxies.json");

function getProxyFileAgeMs(): number {
  try {
    const stat = fs.statSync(PROXIES_PATH);
    return Date.now() - stat.mtimeMs;
  } catch {
    return Infinity;
  }
}

async function runProxyRefresh() {
  log("[proxy-auto] Starting proxy refresh…");
  try {
    const result = await scrapeGeonodeProxies((msg) => {
      log(`[proxy-auto] ${msg}`);
    });
    reloadProxies();
    log(`[proxy-auto] Done — ${result.verified} verified proxies loaded.`);
  } catch (err: any) {
    log(`[proxy-auto] Refresh failed: ${err.message}`);
  }
}

function scheduleProxyRefresh() {
  setInterval(() => {
    runProxyRefresh();
  }, PROXY_REFRESH_INTERVAL_MS);
  log(`[proxy-auto] Auto-refresh scheduled every ${PROXY_REFRESH_INTERVAL_MS / 60000} minutes.`);
}

(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  const server = await registerRoutes(app);

  configureExpoAndLanding(app, server);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);

      // Refresh proxies on startup if stale (older than 15 minutes or missing)
      const ageMs = getProxyFileAgeMs();
      if (ageMs > PROXY_REFRESH_INTERVAL_MS) {
        log(`[proxy-auto] Proxy list is ${Math.round(ageMs / 60000)}m old — refreshing now…`);
        runProxyRefresh();
      } else {
        log(`[proxy-auto] Proxy list is fresh (${Math.round(ageMs / 60000)}m old) — skipping initial refresh.`);
      }

      // Schedule recurring refresh every 15 minutes
      scheduleProxyRefresh();
    },
  );
})();
