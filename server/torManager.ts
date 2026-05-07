export type TorStatus = "idle" | "bootstrapping" | "ready" | "rotating" | "error";

export function getTorAgent(): null {
  return null;
}

export function getTorStatus() {
  return { status: "idle" as TorStatus, bootstrapPct: 0, exitIp: null, circuitNum: 0 };
}

export async function ensureTor(): Promise<void> {
  // no-op
}

export async function rotateTorCircuit(): Promise<void> {
  // no-op
}
