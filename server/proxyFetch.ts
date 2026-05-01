import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

type ProxyEntry = {
  proxy: string;
  protocol: string;
  ip: string;
  port: number;
};

type ProxyState = {
  url: string;
  agent: any;
  failures: number;
  lastUsed: number;
  goodHits: number;
};

const PROXIES_PATH = path.join(process.cwd(), "data", "proxies.json");
const REQUEST_TIMEOUT_MS = 12000;
const MAX_PROXY_ATTEMPTS = 8;
const FAILURE_BLACKLIST_THRESHOLD = 3;

let allProxies: ProxyState[] = [];
let workingProxies: ProxyState[] = [];
let stickyProxy: ProxyState | null = null;
let initialized = false;

function buildAgent(p: ProxyEntry): any | null {
  try {
    if (p.protocol.startsWith("socks")) {
      return new SocksProxyAgent(p.proxy);
    }
    if (p.protocol === "http" || p.protocol === "https") {
      return new HttpsProxyAgent(p.proxy);
    }
  } catch {
    return null;
  }
  return null;
}

function loadProxies(): void {
  if (initialized) return;
  initialized = true;
  try {
    const raw = fs.readFileSync(PROXIES_PATH, "utf-8");
    const list: ProxyEntry[] = JSON.parse(raw);
    for (const p of list) {
      const agent = buildAgent(p);
      if (!agent) continue;
      allProxies.push({
        url: p.proxy,
        agent,
        failures: 0,
        lastUsed: 0,
        goodHits: 0,
      });
    }
    for (let i = allProxies.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allProxies[i], allProxies[j]] = [allProxies[j], allProxies[i]];
    }
    console.log(`[proxyFetch] Loaded ${allProxies.length} proxies`);
  } catch (e) {
    console.warn("[proxyFetch] Could not load proxies:", (e as Error).message);
  }
}

/** Call after writing a fresh proxies.json to hot-reload the pool without restarting. */
export function reloadProxies(): void {
  initialized = false;
  allProxies = [];
  workingProxies = [];
  stickyProxy = null;
  loadProxies();
}

function pickProxy(exclude: Set<ProxyState>): ProxyState | null {
  const candidates = allProxies.filter(
    (p) => !exclude.has(p) && p.failures < FAILURE_BLACKLIST_THRESHOLD
  );
  if (candidates.length === 0) {
    for (const p of allProxies) p.failures = 0;
    const fresh = allProxies.filter((p) => !exclude.has(p));
    return fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function markGood(p: ProxyState): void {
  p.failures = 0;
  p.goodHits++;
  p.lastUsed = Date.now();
  if (!workingProxies.includes(p)) {
    workingProxies.unshift(p);
    if (workingProxies.length > 10) workingProxies.pop();
  }
  stickyProxy = p;
}

function markBad(p: ProxyState): void {
  p.failures++;
  if (p.failures >= FAILURE_BLACKLIST_THRESHOLD) {
    workingProxies = workingProxies.filter((x) => x !== p);
    if (stickyProxy === p) stickyProxy = null;
  }
}

type SimpleResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  text: () => Promise<string>;
  json: () => Promise<any>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function requestThroughAgent(
  urlStr: string,
  init: RequestInit,
  agent: any
): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
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
          const buf = Buffer.concat(chunks);
          const status = res.statusCode || 0;
          const respHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) respHeaders.set(k, v.join(", "));
            else if (v != null) respHeaders.set(k, String(v));
          }
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage || "",
            headers: respHeaders,
            text: async () => buf.toString("utf-8"),
            json: async () => JSON.parse(buf.toString("utf-8")),
            arrayBuffer: async () =>
              buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
          });
        });
        res.on("error", (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      if (settled) return;
      settled = true;
      req.destroy(new Error("proxy request timeout"));
      reject(new Error("proxy request timeout"));
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    if (init.body) {
      req.write(init.body as any);
    }
    req.end();
  });
}

/**
 * Fetch a URL through a rotating SOCKS5/HTTP proxy pool.
 * Returns a fetch-compatible response (ok/status/json/text/arrayBuffer/headers).
 * Tries sticky/working proxies first; rotates on failures.
 */
export async function proxyFetch(
  url: string,
  init: RequestInit = {}
): Promise<SimpleResponse> {
  loadProxies();
  if (allProxies.length === 0) {
    const r = await fetch(url, init);
    const buf = Buffer.from(await r.arrayBuffer());
    return {
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      headers: r.headers,
      text: async () => buf.toString("utf-8"),
      json: async () => JSON.parse(buf.toString("utf-8")),
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    };
  }

  const tried = new Set<ProxyState>();

  const order: ProxyState[] = [];
  if (stickyProxy) order.push(stickyProxy);
  for (const p of workingProxies) if (!order.includes(p)) order.push(p);

  for (const p of order) {
    if (tried.has(p)) continue;
    tried.add(p);
    try {
      const res = await requestThroughAgent(url, init, p.agent);
      if (res.status > 0 && res.status !== 403 && res.status !== 429 && res.status < 500) {
        if (res.ok) markGood(p);
        return res;
      }
      markBad(p);
    } catch {
      markBad(p);
    }
    if (tried.size >= MAX_PROXY_ATTEMPTS) break;
  }

  while (tried.size < MAX_PROXY_ATTEMPTS) {
    const p = pickProxy(tried);
    if (!p) break;
    tried.add(p);
    try {
      const res = await requestThroughAgent(url, init, p.agent);
      if (res.status > 0 && res.status !== 403 && res.status !== 429 && res.status < 500) {
        if (res.ok) markGood(p);
        return res;
      }
      markBad(p);
    } catch {
      markBad(p);
    }
  }

  throw new Error(
    `proxyFetch: all ${tried.size} proxy attempts failed for ${url}`
  );
}

export function getProxyStats() {
  return {
    total: allProxies.length,
    working: workingProxies.length,
    sticky: stickyProxy?.url ?? null,
  };
}
