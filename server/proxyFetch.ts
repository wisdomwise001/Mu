export type SimpleResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  text: () => Promise<string>;
  json: () => Promise<any>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export async function proxyFetch(
  url: string,
  init: RequestInit = {}
): Promise<SimpleResponse> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

export function reloadProxies(): void {
  // no-op
}

export function getProxyStats() {
  return {
    active: 0,
    dead: 0,
    tier1: 0,
    tier2: 0,
    topProxies: [],
  };
}
