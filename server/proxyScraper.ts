import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

const PROXIES_PATH = path.join(process.cwd(), "data", "proxies.json");
const GEONODE_API = "https://proxylist.geonode.com/api/proxy-list";
const TEST_URL = "https://api.sofascore.com/api/v1/sport/football/events/live";
const TEST_TIMEOUT_MS = 7000;
const TEST_CONCURRENCY = 40;
const MIN_UPTIME = 50;

interface GeonodeProxy {
  ip: string;
  port: string;
  protocols: string[];
  anonymityLevel?: string;
  speed?: number;
  upTime?: number;
  latency?: number;
  country?: string;
}

interface GeonodeResponse {
  data: GeonodeProxy[];
  total: number;
  page: number;
  limit: number;
}

export interface ScrapedProxy {
  proxy: string;
  protocol: string;
  ip: string;
  port: number;
  anonymity: string;
  upTime: number;
  speed: number;
  latency: number;
  country: string;
  verified?: boolean;
}

const PROTOCOL_PRIORITY: Record<string, number> = { socks5: 3, socks4: 2, https: 1, http: 0 };

function pickProtocol(protocols: string[]): string {
  return protocols.slice().sort(
    (a, b) => (PROTOCOL_PRIORITY[b] ?? -1) - (PROTOCOL_PRIORITY[a] ?? -1)
  )[0] ?? "http";
}

function buildAgent(proxyUrl: string, protocol: string): any {
  try {
    if (protocol.startsWith("socks")) return new SocksProxyAgent(proxyUrl);
    if (protocol === "http" || protocol === "https") return new HttpsProxyAgent(proxyUrl);
  } catch { /* ignore */ }
  return null;
}

function testProxy(proxyUrl: string, protocol: string): Promise<boolean> {
  return new Promise((resolve) => {
    const agent = buildAgent(proxyUrl, protocol);
    if (!agent) return resolve(false);

    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    try {
      const url = new URL(TEST_URL);
      const req = https.request(
        {
          method: "GET",
          host: url.hostname,
          port: 443,
          path: url.pathname + url.search,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Referer": "https://www.sofascore.com/",
            "Origin": "https://www.sofascore.com",
            "Accept": "*/*",
          },
          agent,
        },
        (res) => {
          res.destroy();
          // 200 = works great, 403/429 = proxy reachable but blocked, still usable
          const ok = res.statusCode !== undefined && res.statusCode > 0;
          done(ok);
        }
      );
      req.setTimeout(TEST_TIMEOUT_MS, () => {
        req.destroy();
        done(false);
      });
      req.on("error", () => done(false));
      req.end();
    } catch {
      done(false);
    }
  });
}

async function testBatch(proxies: ScrapedProxy[]): Promise<ScrapedProxy[]> {
  const results = await Promise.all(
    proxies.map(async (p) => {
      const ok = await testProxy(p.proxy, p.protocol);
      return ok ? { ...p, verified: true } : null;
    })
  );
  return results.filter(Boolean) as ScrapedProxy[];
}

async function fetchPage(
  page: number,
  limit = 500,
  sortBy = "speed",
  sortType = "asc"
): Promise<GeonodeProxy[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    page: String(page),
    sort_by: sortBy,
    sort_type: sortType,
    filterUpTime: String(MIN_UPTIME),
  });
  const url = `${GEONODE_API}?${params}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; proxy-scraper/2.0)" },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Geonode returned HTTP ${res.status}`);
  const body: GeonodeResponse = await res.json();
  return body.data ?? [];
}

export async function scrapeGeonodeProxies(
  onProgress?: (msg: string) => void
): Promise<{ added: number; total: number; verified: number; path: string }> {
  onProgress?.(`Fetching fastest proxies from Geonode (uptime ≥ ${MIN_UPTIME}%, sorted by speed)…`);

  let page1: GeonodeProxy[] = [];
  let page2: GeonodeProxy[] = [];

  try {
    page1 = await fetchPage(1, 500, "speed", "asc");
    onProgress?.(`Got ${page1.length} proxies from page 1, fetching page 2…`);
  } catch (e: any) {
    throw new Error(`Failed to fetch Geonode page 1: ${e.message}`);
  }

  try {
    page2 = await fetchPage(2, 500, "speed", "asc");
    onProgress?.(`Got ${page2.length} proxies from page 2. Deduplicating…`);
  } catch {
    onProgress?.("Page 2 fetch failed — continuing with page 1 only");
  }

  const all = [...page1, ...page2];

  const seen = new Map<string, ScrapedProxy>();
  for (const p of all) {
    if (!p.ip || !p.port || !p.protocols?.length) continue;
    const port = Number(p.port);
    if (!port) continue;
    const protocol = pickProtocol(p.protocols);
    const proxyUrl = `${protocol}://${p.ip}:${port}`;
    const key = `${p.ip}:${port}`;
    const existing = seen.get(key);
    if (
      !existing ||
      (PROTOCOL_PRIORITY[protocol] ?? -1) > (PROTOCOL_PRIORITY[existing.protocol] ?? -1)
    ) {
      seen.set(key, {
        proxy: proxyUrl,
        protocol,
        ip: p.ip,
        port,
        anonymity: p.anonymityLevel ?? "unknown",
        upTime: p.upTime ?? 0,
        speed: p.speed ?? 99999,
        latency: p.latency ?? 99999,
        country: p.country ?? "",
      });
    }
  }

  const candidates = Array.from(seen.values());
  onProgress?.(
    `Deduped to ${candidates.length} proxies. Testing against SofaScore in batches of ${TEST_CONCURRENCY}…`
  );

  const verified: ScrapedProxy[] = [];
  for (let i = 0; i < candidates.length; i += TEST_CONCURRENCY) {
    const batch = candidates.slice(i, i + TEST_CONCURRENCY);
    const good = await testBatch(batch);
    verified.push(...good);
    onProgress?.(
      `Tested ${Math.min(i + TEST_CONCURRENCY, candidates.length)}/${candidates.length} — ${verified.length} verified so far…`
    );
    if (verified.length >= 100) {
      onProgress?.(`Reached 100 verified proxies — stopping early.`);
      break;
    }
  }

  // Sort: fastest (lowest speed) first
  verified.sort((a, b) => (a.speed ?? 99999) - (b.speed ?? 99999));

  onProgress?.(`Writing ${verified.length} verified proxies to disk…`);
  fs.mkdirSync(path.dirname(PROXIES_PATH), { recursive: true });
  fs.writeFileSync(PROXIES_PATH, JSON.stringify(verified, null, 2), "utf-8");

  onProgress?.(`Done. ${verified.length} verified proxies saved (from ${all.length} raw).`);
  return {
    added: verified.length,
    total: all.length,
    verified: verified.length,
    path: PROXIES_PATH,
  };
}
