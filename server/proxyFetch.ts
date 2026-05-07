import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import zlib from "node:zlib";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

const PROXIES_PATH = path.join(process.cwd(), "data", "proxies.json");
const REQUEST_TIMEOUT_MS = 15000;
const DEAD_RETRY_AFTER_MS = 10 * 60 * 1000;
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const RACE_WIDTH = 20;
const MAX_ROUNDS  = 5;

const W_LATENCY = 0.40;
const W_SUCCESS_RATE = 0.40;
const W_STABILITY = 0.20;

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
  requests: number;
  successes: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  successRate: number;
  score: number;
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

let activePool: ProxyState[] = [];
let deadPool: ProxyState[] = [];
let initialized = false;
let healthTimer: NodeJS.Timeout | null = null;

function buildAgent(proxyUrl: string, protocol: string): any {
  try {
    if (protocol.startsWith("socks")) return new SocksProxyAgent(proxyUrl);
    if (protocol === "http" || protocol === "https") return new HttpsProxyAgent(proxyUrl);
  } catch { /* ignore */ }
  return null;
}

function computeScore(p: ProxyState): number {
  const latScore =
    p.avgLatencyMs > 0
      ? Math.max(0, 100 - (p.avgLatencyMs / 60))
      : p.tier === 1 ? 70 : 40;
  const srScore = p.requests > 0 ? (p.successes / p.requests) * 100 : 50;
  const stabScore = Math.min(100, p.successes * 10);
  return latScore * W_LATENCY + srScore * W_SUCCESS_RATE + stabScore * W_STABILITY;
}

function refreshScore(p: ProxyState): void {
  p.avgLatencyMs =
    p.successes > 0 ? p.totalLatencyMs / p.successes : p.avgLatencyMs;
  p.successRate = p.requests > 0 ? p.successes / p.requests : 0;
  p.score = computeScore(p);
}

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

function markGood(p: ProxyState, latencyMs: number): void {
  p.requests++;
  p.successes++;
  p.totalLatencyMs += latencyMs;
  p.consecutiveFails = 0;
  p.lastUsed = Date.now();
  p.deadSince = null;
  refreshScore(p);
  activePool.sort((a, b) => b.score - a.score);
}

function markBad(p: ProxyState): void {
  p.requests++;
  p.consecutiveFails++;
  refreshScore(p);
  if (p.consecutiveFails >= 2) {
    activePool = activePool.filter((x) => x !== p);
    if (!deadPool.includes(p)) {
      p.deadSince = Date.now();
      deadPool.push(p);
    }
  }
}

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

export function reloadProxies(): void {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  initialized = false;
  const oldActive = activePool;
  const oldDead = deadPool;
  activePool = [];
  deadPool = [];
  loadProxies();
  if (activePool.length === 0 && deadPool.length === 0) {
    activePool = oldActive;
    deadPool = oldDead;
    console.warn("[proxyPool] Reload produced no proxies — keeping existing pool.");
  }
  startHealthCheck();
}

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
          const rawBuf = Buffer.concat(chunks);
          const status = res.statusCode || 0;
          const respHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) respHeaders.set(k, v.join(", "));
            else if (v != null) respHeaders.set(k, String(v));
          }

          let buf = rawBuf;
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          try {
            if (enc.includes("br")) buf = zlib.brotliDecompressSync(rawBuf);
            else if (enc.includes("gzip")) buf = zlib.gunzipSync(rawBuf);
            else if (enc.includes("deflate")) buf = zlib.inflateSync(rawBuf);
          } catch { buf = rawBuf; }

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

function reviveExpiredProxies(): void {
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
  }
}

function forceReviveAllDead(): void {
  if (deadPool.length === 0) return;
  for (const p of deadPool) {
    p.consecutiveFails = 0;
    p.deadSince = null;
    p.score = computeScore(p);
    activePool.push(p);
  }
  deadPool = [];
  activePool.sort((a, b) => b.score - a.score);
  console.warn(`[proxyPool] Force-revived ${activePool.length} dead proxies — active pool was exhausted.`);
}

export async function proxyFetch(
  url: string,
  init: RequestInit = {}
): Promise<SimpleResponse> {
  loadProxies();

  if (activePool.length === 0 && deadPool.length === 0) {
    // No proxies loaded — fall back to direct fetch
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      text: async () => body,
      json: async () => JSON.parse(body),
      arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
    };
  }

  const tried = new Set<ProxyState>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    reviveExpiredProxies();

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

    if (batch.length === 0) {
      forceReviveAllDead();
      const emergencyBatch: ProxyState[] = [];
      for (let i = 0; i < RACE_WIDTH; i++) {
        const proxy = weightedPick(activePool, tried);
        if (!proxy) break;
        emergencyBatch.push(proxy);
        tried.add(proxy);
      }
      if (emergencyBatch.length === 0) break;
      batch.push(...emergencyBatch);
    }

    type Winner = { res: SimpleResponse; latencyMs: number; proxy: ProxyState };
    const winner = await new Promise<Winner | null>((resolve) => {
      let pending = batch.length;
      let done = false;
      let fallback: Winner | null = null;

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
              if (res.ok) {
                markGood(proxy, latencyMs);
                finish({ res, latencyMs, proxy });
              } else if (res.status === 404 || res.status === 403 || res.status === 429) {
                markGood(proxy, latencyMs);
                if (!fallback) fallback = { res, latencyMs, proxy };
                if (pending === 0) finish(fallback);
              } else {
                markBad(proxy);
                if (pending === 0) finish(fallback);
              }
            } else {
              markBad(proxy);
              if (pending === 0) finish(fallback);
            }
          })
          .catch(() => {
            markBad(proxy);
            pending--;
            if (pending === 0) finish(fallback);
          });
      }
    });

    if (winner) return winner.res;
  }

  throw new Error(`proxyFetch: all ${tried.size} proxy attempts failed for ${url}`);
}

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
