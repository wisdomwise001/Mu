import fs from "node:fs";
import path from "node:path";

const PROXIES_PATH = path.join(process.cwd(), "data", "proxies.json");
const GEONODE_API = "https://proxylist.geonode.com/api/proxy-list";

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
  country: string;
}

// Preferred protocols in priority order (socks5 fastest for SofaScore)
const PROTOCOL_PRIORITY: Record<string, number> = { socks5: 3, socks4: 2, https: 1, http: 0 };

function pickProtocol(protocols: string[]): string {
  return protocols.slice().sort(
    (a, b) => (PROTOCOL_PRIORITY[b] ?? -1) - (PROTOCOL_PRIORITY[a] ?? -1)
  )[0] ?? "http";
}

async function fetchPage(page: number, limit = 500): Promise<GeonodeProxy[]> {
  const url = `${GEONODE_API}?limit=${limit}&page=${page}&sort_by=lastChecked&sort_type=desc&filterUpTime=20`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; proxy-scraper/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Geonode returned HTTP ${res.status}`);
  const body: GeonodeResponse = await res.json();
  return body.data ?? [];
}

export async function scrapeGeonodeProxies(
  onProgress?: (msg: string) => void
): Promise<{ added: number; total: number; path: string }> {
  onProgress?.("Fetching proxy list from Geonode (page 1)…");

  // Page 1 gives up to 500 proxies — enough for our pool
  const page1 = await fetchPage(1, 500);

  onProgress?.(`Got ${page1.length} proxies from page 1, fetching page 2…`);
  let page2: GeonodeProxy[] = [];
  try {
    page2 = await fetchPage(2, 500);
  } catch {
    onProgress?.("Page 2 fetch failed — continuing with page 1 only");
  }

  const all = [...page1, ...page2];
  onProgress?.(`Total raw proxies: ${all.length}. Deduplicating…`);

  // Deduplicate by ip:port, prefer better protocol
  const seen = new Map<string, ScrapedProxy>();
  for (const p of all) {
    if (!p.ip || !p.port || !p.protocols?.length) continue;
    const port = Number(p.port);
    if (!port) continue;
    const protocol = pickProtocol(p.protocols);
    const proxyUrl = `${protocol}://${p.ip}:${port}`;
    const key = `${p.ip}:${port}`;
    const existing = seen.get(key);
    if (!existing || (PROTOCOL_PRIORITY[protocol] ?? -1) > (PROTOCOL_PRIORITY[existing.protocol] ?? -1)) {
      seen.set(key, {
        proxy: proxyUrl,
        protocol,
        ip: p.ip,
        port,
        anonymity: p.anonymityLevel ?? "unknown",
        upTime: p.upTime ?? 0,
        country: p.country ?? "",
      });
    }
  }

  const proxies = Array.from(seen.values());
  // Sort: socks5 first, then by upTime desc
  proxies.sort((a, b) => {
    const pd = (PROTOCOL_PRIORITY[b.protocol] ?? 0) - (PROTOCOL_PRIORITY[a.protocol] ?? 0);
    if (pd !== 0) return pd;
    return (b.upTime ?? 0) - (a.upTime ?? 0);
  });

  onProgress?.(`Writing ${proxies.length} proxies to disk…`);
  fs.mkdirSync(path.dirname(PROXIES_PATH), { recursive: true });
  fs.writeFileSync(PROXIES_PATH, JSON.stringify(proxies, null, 2), "utf-8");

  onProgress?.(`Done. ${proxies.length} proxies saved.`);
  return { added: proxies.length, total: all.length, path: PROXIES_PATH };
}
