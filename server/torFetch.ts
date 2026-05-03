import https from "node:https";
import http from "node:http";
import zlib from "node:zlib";
import { ensureTor, getTorAgent, rotateTorCircuit, getTorStatus } from "./torManager";

export { getTorStatus, rotateTorCircuit };

const REQUEST_TIMEOUT_MS = 15_000;

export type SimpleResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<any>;
};

// ── Core fetch through Tor SOCKS5 proxy ──────────────────────────────────────
export async function torFetch(
  url: string,
  init: { headers?: Record<string, string> } = {}
): Promise<SimpleResponse> {
  await ensureTor();

  const agent = getTorAgent();
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === "https:";

  return new Promise<SimpleResponse>((resolve, reject) => {
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port || (isHttps ? 443 : 80),
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   "GET",
      headers:  {
        "Accept-Encoding": "gzip, deflate",
        ...(init.headers || {}),
      },
      agent,
      timeout: REQUEST_TIMEOUT_MS,
    };

    const req = (isHttps ? https : http).request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      let stream: NodeJS.ReadableStream = res;

      const enc = (res.headers["content-encoding"] || "").toLowerCase();
      if (enc === "gzip")    stream = res.pipe(zlib.createGunzip());
      else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
      else if (enc === "deflate") stream = res.pipe(zlib.createInflate());

      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        const status = res.statusCode ?? 0;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") headers[k] = v;
          else if (Array.isArray(v)) headers[k] = v[0];
        }
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage || "",
          headers,
          text: async () => body,
          json: async () => JSON.parse(body),
        });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Tor request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}
