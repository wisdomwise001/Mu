import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

const PROXIES_PATH = path.join(process.cwd(), "data", "proxies.json");

// ── Sources ───────────────────────────────────────────────────────────────────
const GEONODE_API = "https://proxylist.geonode.com/api/proxy-list";
const PROXYSCRAPE_HTTP =
  "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all";
const PROXYSCRAPE_SOCKS5 =
  "https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks5&timeout=5000&country=all";
const PROXYSCRAPE_SOCKS4 =
  "https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks4&timeout=5000&country=all";

// ── Validation config ─────────────────────────────────────────────────────────
// Test directly against SofaScore so we only keep proxies that can reach it
const TEST_HOST = "api.sofascore.com";
const TEST_PATH = "/api/v1/sport/football/events/live";
const TIER1_TIMEOUT_MS = 2000;  // Elite: < 2 s round-trip
const TIER2_TIMEOUT_MS = 6000;  // Backup: 2–6 s round-trip
const TEST_CONCURRENCY = 100;   // Parallel validation slots
const MIN_UPTIME = 30;          // Geonode uptime filter (%)

export interface ScrapedProxy {
  proxy: string;
  protocol: string;
  ip: string;
  port: number;
  anonymity: string;
  upTime: number;
  speed: number;
  latency: number;       // Geonode-reported latency
  measuredMs: number;    // Actual measured round-trip against SofaScore
  tier: 1 | 2;
  country: string;
  source: string;
  verified: true;
}

// ── Protocol priority ─────────────────────────────────────────────────────────
const PROTOCOL_PRIORITY: Record<string, number> = {
  socks5: 3,
  socks4: 2,
  https: 1,
  http: 0,
};

function pickProtocol(protocols: string[]): string {
  return (
    protocols
      .slice()
      .sort((a, b) => (PROTOCOL_PRIORITY[b] ?? -1) - (PROTOCOL_PRIORITY[a] ?? -1))[0] ?? "http"
  );
}

function buildAgent(proxyUrl: string, protocol: string): any {
  try {
    if (protocol.startsWith("socks")) return new SocksProxyAgent(proxyUrl);
    if (protocol === "http" || protocol === "https") return new HttpsProxyAgent(proxyUrl);
  } catch {
    /* ignore */
  }
  return null;
}

// ── Per-proxy latency test against SofaScore ──────────────────────────────────
// Wraps the raw probe in Promise.race with a hard deadline so hanging sockets
// (especially SOCKS5) can never block the validation loop indefinitely.
function probeProxy(
  proxyUrl: string,
  protocol: string,
  timeoutMs: number
): Promise<{ ok: boolean; measuredMs: number }> {
  const hard = new Promise<{ ok: boolean; measuredMs: number }>((resolve) =>
    setTimeout(() => resolve({ ok: false, measuredMs: 0 }), timeoutMs + 1500)
  );

  const attempt = new Promise<{ ok: boolean; measuredMs: number }>((resolve) => {
    const agent = buildAgent(proxyUrl, protocol);
    if (!agent) return resolve({ ok: false, measuredMs: 0 });

    let settled = false;
    const done = (ok: boolean, ms: number) => {
      if (settled) return;
      settled = true;
      resolve({ ok, measuredMs: ms });
    };

    const start = Date.now();
    try {
      const req = https.request(
        {
          method: "GET",
          host: TEST_HOST,
          port: 443,
          path: TEST_PATH,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Referer: "https://www.sofascore.com/",
            Origin: "https://www.sofascore.com",
            Accept: "*/*",
            Connection: "close",
          },
          agent,
        },
        (res) => {
          const ms = Date.now() - start;
          res.destroy();
          done(!!res.statusCode && res.statusCode > 0, ms);
        }
      );
      req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch { /* ignore */ } done(false, 0); });
      req.on("error", () => done(false, 0));
      req.end();
    } catch {
      done(false, 0);
    }
  });

  return Promise.race([attempt, hard]);
}

// ── Semaphore-limited concurrent validation ───────────────────────────────────
async function validateAll(
  candidates: Array<{ proxy: string; protocol: string; [k: string]: any }>,
  onProgress?: (msg: string) => void
): Promise<ScrapedProxy[]> {
  const results: ScrapedProxy[] = [];
  let tested = 0;
  const total = candidates.length;
  let idx = 0;
  const MAX_RESULTS = 150;

  const runSlot = async () => {
    while (true) {
      // Check early-exit BEFORE picking the next item
      if (results.length >= MAX_RESULTS) return;

      const item = candidates[idx++];
      if (!item) return;

      // Tier-1 probe first (fast), fall back to Tier-2 (slower)
      let result = await probeProxy(item.proxy, item.protocol, TIER1_TIMEOUT_MS);
      let tier: 1 | 2 = 1;
      if (!result.ok) {
        if (results.length >= MAX_RESULTS) return;
        result = await probeProxy(item.proxy, item.protocol, TIER2_TIMEOUT_MS);
        tier = 2;
      }

      tested++;
      if (tested % TEST_CONCURRENCY === 0 || tested === total) {
        onProgress?.(
          `Validated ${tested}/${total} — ${results.length} working ` +
          `(T1: ${results.filter(r => r.tier === 1).length}, T2: ${results.filter(r => r.tier === 2).length})…`
        );
      }

      if (result.ok && results.length < MAX_RESULTS) {
        results.push({ ...item, measuredMs: result.measuredMs, tier, verified: true } as ScrapedProxy);
      }
    }
  };

  await Promise.all(Array.from({ length: TEST_CONCURRENCY }, () => runSlot()));
  return results;
}

// ── Source: Geonode API ───────────────────────────────────────────────────────
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
}

async function fetchGeonode(page: number): Promise<any[]> {
  const params = new URLSearchParams({
    limit: "500",
    page: String(page),
    sort_by: "speed",
    sort_type: "asc",
    filterUpTime: String(MIN_UPTIME),
  });
  const res = await fetch(`${GEONODE_API}?${params}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; proxy-scraper/3.0)" },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Geonode HTTP ${res.status}`);
  const body: GeonodeResponse = await res.json();
  return (body.data ?? []).map((p) => {
    const protocol = pickProtocol(p.protocols ?? ["http"]);
    const port = Number(p.port);
    return {
      proxy: `${protocol}://${p.ip}:${port}`,
      protocol,
      ip: p.ip,
      port,
      anonymity: p.anonymityLevel ?? "unknown",
      upTime: p.upTime ?? 0,
      speed: p.speed ?? 99999,
      latency: p.latency ?? 99999,
      measuredMs: 0,
      tier: 2 as const,
      country: p.country ?? "",
      source: "geonode",
      verified: true as const,
    };
  });
}

// ── Source: ProxyScrape plain-text lists ─────────────────────────────────────
async function fetchProxyScrape(url: string, protocol: string): Promise<any[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; proxy-scraper/3.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return [];
  const text = await res.text();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(line))
    .map((line) => {
      const [ip, portStr] = line.split(":");
      const port = Number(portStr);
      return {
        proxy: `${protocol}://${ip}:${port}`,
        protocol,
        ip,
        port,
        anonymity: "unknown",
        upTime: 0,
        speed: 99999,
        latency: 99999,
        measuredMs: 0,
        tier: 2 as const,
        country: "",
        source: `proxyscrape-${protocol}`,
        verified: true as const,
      };
    });
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function scrapeGeonodeProxies(
  onProgress?: (msg: string) => void
): Promise<{ added: number; total: number; verified: number; path: string }> {
  onProgress?.("Scraping proxies from multiple sources…");

  // Fetch from all sources in parallel
  const [geoP1, geoP2, psHttp, psSocks5, psSocks4] = await Promise.allSettled([
    fetchGeonode(1),
    fetchGeonode(2),
    fetchProxyScrape(PROXYSCRAPE_HTTP, "http"),
    fetchProxyScrape(PROXYSCRAPE_SOCKS5, "socks5"),
    fetchProxyScrape(PROXYSCRAPE_SOCKS4, "socks4"),
  ]);

  const raw = [
    ...(geoP1.status === "fulfilled" ? geoP1.value : []),
    ...(geoP2.status === "fulfilled" ? geoP2.value : []),
    ...(psHttp.status === "fulfilled" ? psHttp.value : []),
    ...(psSocks5.status === "fulfilled" ? psSocks5.value : []),
    ...(psSocks4.status === "fulfilled" ? psSocks4.value : []),
  ];

  onProgress?.(
    `Sources: Geonode p1=${geoP1.status === "fulfilled" ? geoP1.value.length : 0}, ` +
    `p2=${geoP2.status === "fulfilled" ? geoP2.value.length : 0}, ` +
    `ProxyScrape HTTP=${psHttp.status === "fulfilled" ? psHttp.value.length : 0}, ` +
    `SOCKS5=${psSocks5.status === "fulfilled" ? psSocks5.value.length : 0}, ` +
    `SOCKS4=${psSocks4.status === "fulfilled" ? psSocks4.value.length : 0}`
  );

  // Deduplicate by ip:port, prefer highest protocol priority
  const seen = new Map<string, any>();
  for (const p of raw) {
    const key = `${p.ip}:${p.port}`;
    const existing = seen.get(key);
    if (!existing || (PROTOCOL_PRIORITY[p.protocol] ?? -1) > (PROTOCOL_PRIORITY[existing.protocol] ?? -1)) {
      seen.set(key, p);
    }
  }

  const candidates = Array.from(seen.values());
  onProgress?.(
    `${raw.length} raw → ${candidates.length} unique. Validating against SofaScore (${TEST_CONCURRENCY} concurrent)…`
  );

  const verified = await validateAll(candidates, onProgress);

  // Sort: Tier 1 first, then by measuredMs ascending
  verified.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.measuredMs - b.measuredMs;
  });

  onProgress?.(`Writing ${verified.length} verified proxies (T1: ${verified.filter(v => v.tier === 1).length}, T2: ${verified.filter(v => v.tier === 2).length})…`);
  fs.mkdirSync(path.dirname(PROXIES_PATH), { recursive: true });
  fs.writeFileSync(PROXIES_PATH, JSON.stringify(verified, null, 2), "utf-8");

  onProgress?.(
    `Done. ${verified.length} verified proxies from ${raw.length} raw candidates.`
  );

  return {
    added: verified.length,
    total: raw.length,
    verified: verified.length,
    path: PROXIES_PATH,
  };
}
