import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import net from "node:net";
import { SocksProxyAgent } from "socks-proxy-agent";

const TOR_BIN   = path.join(process.cwd(), "bin", "tor", "tor");
const TOR_LIBS  = path.join(process.cwd(), "bin", "tor");
const GEOIP     = path.join(process.cwd(), "bin", "data", "geoip");
const GEOIP6    = path.join(process.cwd(), "bin", "data", "geoip6");
const DATA_DIR  = path.join(process.cwd(), "data", "tor-data");

const SOCKS_PORT   = 9050;
const CONTROL_PORT = 9051;
const BOOTSTRAP_TIMEOUT_MS  = 120_000;
const AUTO_ROTATE_INTERVAL_MS = 10 * 60 * 1000; // rotate exit IP every 10 minutes

export type TorStatus = "idle" | "bootstrapping" | "ready" | "rotating" | "error";

let torProcess: ChildProcess | null = null;
let torStatus: TorStatus = "idle";
let bootstrapPct  = 0;
let torExitIp: string | null = null;
let circuitNum    = 0;
let startPromise: Promise<void> | null = null;
let rotateTimer: ReturnType<typeof setInterval> | null = null;

// ── Tor SOCKS5 agent (port 9050) ──────────────────────────────────────────────
export function getTorAgent(): SocksProxyAgent {
  return new SocksProxyAgent(`socks5h://127.0.0.1:${SOCKS_PORT}`);
}

// ── Status snapshot ───────────────────────────────────────────────────────────
export function getTorStatus() {
  return { status: torStatus, bootstrapPct, exitIp: torExitIp, circuitNum };
}

// ── Ensure Tor is running — idempotent ────────────────────────────────────────
export async function ensureTor(): Promise<void> {
  if (torStatus === "ready" || torStatus === "rotating") return;
  if (startPromise) return startPromise;
  // Allow retry after error
  if (torStatus === "error") { startPromise = null; }
  startPromise = _startTor();
  return startPromise;
}

// ── Rotate circuit (NEWNYM via control port) ──────────────────────────────────
export async function rotateTorCircuit(): Promise<void> {
  if (torStatus !== "ready" && torStatus !== "rotating") return;
  const prev = torStatus;
  torStatus = "rotating";
  try {
    await _sendControlCommand("SIGNAL NEWNYM\r\n");
    circuitNum++;
    torStatus = "ready";
    _fetchExitIp().catch(() => {});
  } catch (e) {
    torStatus = prev;
    throw e;
  }
}

// ── Internal: start Tor ───────────────────────────────────────────────────────
async function _startTor(): Promise<void> {
  if (torStatus === "ready") return;
  torStatus = "bootstrapping";
  bootstrapPct = 0;
  console.log("[tor] Starting Tor daemon…");

  // Kill any lingering Tor process on our ports
  try { await _sendControlCommand("SIGNAL SHUTDOWN\r\n"); } catch {}
  await new Promise(r => setTimeout(r, 500));

  torProcess = spawn(TOR_BIN, [
    "--SocksPort",            String(SOCKS_PORT),
    "--ControlPort",          String(CONTROL_PORT),
    "--CookieAuthentication", "0",
    "--DataDirectory",        DATA_DIR,
    "--GeoIPFile",            GEOIP,
    "--GeoIPv6File",          GEOIP6,
    // No --Quiet: we need bootstrap notices on stdout
  ], {
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `${TOR_LIBS}:${process.env.LD_LIBRARY_PATH ?? ""}`,
    },
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      torStatus = "error";
      startPromise = null;
      reject(new Error("[tor] Bootstrap timed out after 120s"));
    }, BOOTSTRAP_TIMEOUT_MS);

    const handleLine = (line: string) => {
      const m = line.match(/Bootstrapped (\d+)%/);
      if (m) {
        bootstrapPct = Number(m[1]);
        if (bootstrapPct % 10 === 0)
          console.log(`[tor] Bootstrap ${bootstrapPct}%`);
        if (bootstrapPct >= 100 && torStatus !== "ready") {
          clearTimeout(timer);
          torStatus = "ready";
          circuitNum = 1;
          console.log("[tor] ✅ Tor ready — SOCKS5 on port", SOCKS_PORT);
          _fetchExitIp().catch(() => {});
          _startAutoRotate();
          resolve();
        }
      }
    };

    // Tor writes logs to BOTH stdout and stderr depending on config
    let stdoutBuf = "";
    torProcess!.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      lines.forEach(handleLine);
    });

    let stderrBuf = "";
    torProcess!.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      lines.forEach(handleLine);
    });

    torProcess!.on("error", (err) => {
      clearTimeout(timer);
      torStatus = "error";
      startPromise = null;
      console.error("[tor] Process error:", err.message);
      reject(err);
    });

    torProcess!.on("exit", (code, signal) => {
      _stopAutoRotate();
      if (torStatus !== "ready") {
        clearTimeout(timer);
        torStatus = "error";
        startPromise = null;
        const msg = `Tor exited with code=${code} signal=${signal}`;
        console.error("[tor]", msg);
        reject(new Error(msg));
      } else {
        torStatus = "idle";
        startPromise = null;
        console.warn("[tor] Tor process exited unexpectedly after ready state");
      }
    });
  });
}

// ── Auto-rotate timer ─────────────────────────────────────────────────────────
function _startAutoRotate(): void {
  _stopAutoRotate();
  rotateTimer = setInterval(async () => {
    if (torStatus !== "ready") return;
    console.log(`[tor] Auto-rotating circuit (every ${AUTO_ROTATE_INTERVAL_MS / 60000} min)…`);
    try {
      await rotateTorCircuit();
      console.log(`[tor] Auto-rotated → circuit #${circuitNum}, exit IP: ${torExitIp ?? "unknown"}`);
    } catch (err: any) {
      console.warn("[tor] Auto-rotate failed:", err.message);
    }
  }, AUTO_ROTATE_INTERVAL_MS);
}

function _stopAutoRotate(): void {
  if (rotateTimer) {
    clearInterval(rotateTimer);
    rotateTimer = null;
  }
}

// ── Control port ──────────────────────────────────────────────────────────────
function _sendControlCommand(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(CONTROL_PORT, "127.0.0.1", () => {
      socket.write(cmd);
      socket.end();
      resolve();
    });
    socket.on("error", reject);
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error("Tor control port timeout"));
    });
  });
}

// ── Discover current exit IP ──────────────────────────────────────────────────
async function _fetchExitIp(): Promise<void> {
  try {
    const agent = getTorAgent();
    const { SocksProxyAgent: _Unused, ..._ } = { SocksProxyAgent, _: 1 };
    // Use node's https directly so we can pass the agent
    const https = await import("node:https");
    await new Promise<void>((resolve) => {
      const req = https.default.get(
        "https://api.ipify.org?format=json",
        { agent, timeout: 10_000 } as any,
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              torExitIp = data.ip ?? null;
              console.log(`[tor] Exit IP: ${torExitIp} (circuit #${circuitNum})`);
            } catch {}
            resolve();
          });
        }
      );
      req.on("error", () => resolve());
      req.on("timeout", () => { req.destroy(); resolve(); });
    });
  } catch {
    torExitIp = null;
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
process.on("exit",   () => { try { torProcess?.kill(); } catch {} });
process.on("SIGTERM",() => { try { torProcess?.kill(); } catch {} });
