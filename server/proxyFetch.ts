import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

// ── Config ────────────────────────────────────────────────────────────────────
const PROXIES_PATH = path.join(process.cwd(), "data", "proxies.json");
const REQUEST_TIMEOUT_MS = 8000;
const DEAD_RETRY_AFTER_MS = 10 * 60 * 1000; // recycle dead proxies after 10 min
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // background health-check every 5 min
const RACE_WIDTH = 15;  // proxies fired simultaneously per round
const MAX_ROUNDS  = 4;  // rounds = up to RACE_WIDTH * MAX_ROUNDS total attempts

// ── Scoring weights ───────────────────────────────────────────────────────────
const W_LATENCY = 0.40;
const W_SUCCESS_RATE = 0.40;
const W_STABILITY = 0.20;

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProxyFile {
  proxy: string;
  protocol: string;
  ip?: string;
  port?: number;
  measuredMs?: number;
  tier?: 1 | 2;
  upTime?: number;
  speed?: number;
}

interface ProxyState {
  url: string;
  protocol: string;
  agent: any;
  tier: 1 | 2;
  // Scoring counters
  requests: number;
  successes: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  successRate: number; // 0–1
  score: number;       // 0–100
  // Pool state
  consecutiveFails: number;
  deadSince: number | null;
  lastUsed: number;
}

export type SimpleResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  text: () => Promise<string>;
  json: () => Promise<any>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

// ── Module-level pool ─────────────────────────────────────────────────────────
let activePool: ProxyState[] = [];     // scored working proxies
let deadPool: ProxyState[] = [];       // failed proxies (retry after DEAD_RETRY_AFTER_MS)
let initialized = false;
let healthTimer: NodeJS.Timeout | null = null;

// ── Build agent ───────────────────────────────────────────────────────────────
function buildAgent(proxyUrl: string, protocol: string): any {
  try {
    if (protocol.startsWith("socks")) return new SocksProxyAgent(proxyUrl);
    if (protocol === "http" || protocol === "https") return new HttpsProxyAgent(proxyUrl);
  } catch { /* ignore */ }
  return null;
}

// ── Scoring ───────────────────────────────────────────────────────────────────
function computeScore(p: ProxyState): number {
  // Latency score: 100 at 0 ms, 0 at 6000 ms
  const latScore =
    p.avgLatencyMs > 0
      ? Math.max(0, 100 - (p.avgLatencyMs / 60))
      : p.tier === 1 ? 70 : 40; // tier-based default for untested

  // Success-rate score
  const srScore = p.requests > 0 ? (p.successes / p.requests) * 100 : 50;

  // Stability score: trust grows with more confirmed successes (caps at 10)
  const stabScore = Math.min(100, p.successes * 10);

  return latScore * W_LATENCY + srScore * W_SUCCESS_RATE + stabScore * W_STABILITY;
}

function refreshScore(p: ProxyState): void {
  p.avgLatencyMs =
    p.successes > 0 ? p.totalLatencyMs / p.successes : p.avgLatencyMs;
  p.successRate = p.requests > 0 ? p.successes / p.requests : 0;
  p.score = computeScore(p);
}

// ── Weighted random pick ───────────────────────────────────────────────────────
function weightedPick(pool: ProxyState[], exclude: Set<ProxyState>): ProxyState | null {
  const candidates = pool.filter((p) => !exclude.has(p));
  if (candidates.length === 0) return null;

  const totalWeight = candidates.reduce((s, p) => s + Math.max(1, p.score), 0);
  let rand = Math.random() * totalWeight;
  for (const p of candidates) {
    rand -= Math.max(1, p.score);
    if (rand <= 0) return p;
  }
  return candidates[candidates.length - 1];
}

// ── Mark good / bad ───────────────────────────────────────────────────────────
function markGood(p: ProxyState, latencyMs: number): void {
  p.requests++;
  p.successes++;
  p.totalLatencyMs += latencyMs;
  p.consecutiveFails = 0;
  p.lastUsed = Date.now();
  p.deadSince = null;
  refreshScore(p);
  // Keep active pool sorted by score descending
  activePool.sort((a, b) => b.score - a.score);
}

function markBad(p: ProxyState): void {
  p.requests++;
  p.consecutiveFails++;
  refreshScore(p);

  // Move to dead pool after 2 consecutive failures
  if (p.consecutiveFails >= 2) {
    activePool = activePool.filter((x) => x !== p);
    if (!deadPool.includes(p)) {
      p.deadSince = Date.now();
      deadPool.push(p);
    }
  }
}

// ── Load proxies from disk ────────────────────────────────────────────────────
function loadProxies(): void {
  if (initialized) return;
  initialized = true;
  try {
    const raw = fs.readFileSync(PROXIES_PATH, "utf-8");
    const list: ProxyFile[] = JSON.parse(raw);
    const loaded: ProxyState[] = [];
    for (const p of list) {
      const agent = buildAgent(p.proxy, p.protocol);
      if (!agent) continue;
      const tier = p.tier ?? 2;
      const initLatency = p.measuredMs ?? (tier === 1 ? 800 : 2500);
      const state: ProxyState = {
        url: p.proxy,
        protocol: p.protocol,
        agent,
        tier,
        requests: 0,
        successes: 0,
        totalLatencyMs: 0,
        avgLatencyMs: initLatency,
        successRate: 0,
        score: 0,
        consecutiveFails: 0,
        deadSince: null,
        lastUsed: 0,
      };
      state.score = computeScore(state);
      loaded.push(state);
    }
    // Sort Tier-1 first, then by initial score
    loaded.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return b.score - a.score;
    });
    activePool = loaded;
    console.log(
      `[proxyPool] Loaded ${activePool.length} proxies ` +
      `(T1: ${activePool.filter(p => p.tier === 1).length}, T2: ${activePool.filter(p => p.tier === 2).length})`
    );
  } catch (e) {
    console.warn("[proxyPool] Could not load proxies:", (e as Error).message);
  }
}

/** Hot-reload pool after scraper writes a fresh proxies.json */
export function reloadProxies(): void {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  initialized = false;
  activePool = [];
  deadPool = [];
  loadProxies();
  startHealthCheck();
}

// ── Background health-check: recycle dead proxies ─────────────────────────────
function startHealthCheck(): void {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    const now = Date.now();
    const toRevive = deadPool.filter(
      (p) => p.deadSince !== null && now - p.deadSince >= DEAD_RETRY_AFTER_MS
    );
    if (toRevive.length > 0) {
      deadPool = deadPool.filter((p) => !toRevive.includes(p));
      for (const p of toRevive) {
        p.consecutiveFails = 0;
        p.deadSince = null;
        p.score = computeScore(p);
        activePool.push(p);
      }
      activePool.sort((a, b) => b.score - a.score);
      console.log(`[proxyPool] Recycled ${toRevive.length} dead proxies back to active.`);
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

// ── Low-level request through proxy agent ────────────────────────────────────
function requestThroughAgent(
  urlStr: string,
  init: RequestInit,
  agent: any,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<{ res: SimpleResponse; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const start = Date.now();
    const url = new URL(urlStr);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const headers: Record<string, string> = {};
    const initHeaders = (init.headers || {}) as Record<string, string>;
    for (const [k, v] of Object.entries(initHeaders)) {
      headers[k] = String(v);
    }

    const req = lib.request(
      {
        method: init.method || "GET",
        host: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers,
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (settled) return;
          settled = true;
          const latencyMs = Date.now() - start;
          const buf = Buffer.concat(chunks);
          const status = res.statusCode || 0;
          const respHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) respHeaders.set(k, v.join(", "));
            else if (v != null) respHeaders.set(k, String(v));
          }
          resolve({
            latencyMs,
            res: {
              ok: status >= 200 && status < 300,
              status,
              statusText: res.statusMessage || "",
              headers: respHeaders,
              text: async () => buf.toString("utf-8"),
              json: async () => JSON.parse(buf.toString("utf-8")),
              arrayBuffer: async () =>
                buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
            },
          });
        });
        res.on("error", (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      if (settled) return;
      settled = true;
      req.destroy(new Error("proxy timeout"));
      reject(new Error("proxy timeout"));
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    if (init.body) req.write(init.body as any);
    req.end();
  });
}

// ── Main export: parallel-racing proxy fetch ──────────────────────────────────
// Each round fires RACE_WIDTH proxies simultaneously and resolves as soon as
// the first one returns a usable response, so latency = fastest proxy in the
// batch rather than the sum of sequential failures.
export async function proxyFetch(
  url: string,
  init: RequestInit = {}
): Promise<SimpleResponse> {
  loadProxies();

  // No proxies at all → direct fetch fallback
  if (activePool.length === 0 && deadPool.length === 0) {
    const r = await fetch(url, init);
    const buf = Buffer.from(await r.arrayBuffer());
    return {
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      headers: r.headers,
      text:        async () => buf.toString("utf-8"),
      json:        async () => JSON.parse(buf.toString("utf-8")),
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    };
  }

  const tried = new Set<ProxyState>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Pick up to RACE_WIDTH fresh proxies for this round (Tier-1 preferred)
    const batch: ProxyState[] = [];
    for (let i = 0; i < RACE_WIDTH; i++) {
      const tier1 = activePool.filter((p) => p.tier === 1 && !tried.has(p));
      const proxy = tier1.length > 0
        ? weightedPick(tier1, tried)
        : weightedPick(activePool, tried);
      if (!proxy) break;
      batch.push(proxy);
      tried.add(proxy);
    }
    if (batch.length === 0) break;

    // Fire all batch requests concurrently; resolve on first usable response
    type Winner = { res: SimpleResponse; latencyMs: number; proxy: ProxyState };
    const winner = await new Promise<Winner | null>((resolve) => {
      let pending = batch.length;
      let done = false;

      const finish = (w: Winner | null) => {
        if (done) return;
        done = true;
        resolve(w);
      };

      for (const proxy of batch) {
        const timeout = proxy.tier === 1 ? 3000 : 6000;
        requestThroughAgent(url, init, proxy.agent, timeout)
          .then(({ res, latencyMs }) => {
            pending--;
            if (res.status > 0) {
              const usable = res.ok || res.status === 404 || res.status === 403 || res.status === 429;
              if (usable && !done) {
                finish({ res, latencyMs, proxy });
              } else {
                markBad(proxy);
              }
            } else {
              markBad(proxy);
            }
            if (pending === 0) finish(null);
          })
          .catch(() => {
            markBad(proxy);
            pending--;
            if (pending === 0) finish(null);
          });
      }
    });

    if (winner) {
      markGood(winner.proxy, winner.latencyMs);
      return winner.res;
    }
    // All proxies in this batch failed — try next round
  }

  throw new Error(`proxyFetch: all ${tried.size} proxy attempts failed for ${url}`);
}

// ── Stats export ──────────────────────────────────────────────────────────────
export function getProxyStats() {
  loadProxies();
  const tier1 = activePool.filter((p) => p.tier === 1);
  const tier2 = activePool.filter((p) => p.tier === 2);
  const top = activePool
    .slice(0, 5)
    .map((p) => ({
      url: p.url,
      score: Math.round(p.score),
      tier: p.tier,
      successRate: Math.round(p.successRate * 100),
      avgMs: Math.round(p.avgLatencyMs),
    }));
  return {
    active: activePool.length,
    dead: deadPool.length,
    tier1: tier1.length,
    tier2: tier2.length,
    topProxies: top,
  };
}
