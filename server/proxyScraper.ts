export interface ScrapedProxy {
  proxy: string;
  protocol: string;
  ip: string;
  port: number;
  measuredMs: number;
  tier: 1 | 2;
  upTime: number;
  speed: number;
}

export interface ScrapeResult {
  fetched: number;
  verified: number;
  written: number;
}

export async function scrapeGeonodeProxies(
  log: (msg: string) => void = () => {}
): Promise<ScrapeResult> {
  log("Proxy scraping is disabled.");
  return { fetched: 0, verified: 0, written: 0 };
}
