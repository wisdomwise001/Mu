export { getTorStatus, rotateTorCircuit } from "./torManager";

export type SimpleResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<any>;
};

export async function torFetch(
  url: string,
  init: { headers?: Record<string, string> } = {}
): Promise<SimpleResponse> {
  const res = await fetch(url, {
    headers: init.headers,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}
