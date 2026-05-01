import { getApiUrl } from "./query-client";

export interface SofaTeam {
  id: number;
  name: string;
  shortName: string;
  nameCode?: string;
}

export interface SofaTournament {
  name: string;
  slug: string;
  uniqueTournament?: {
    id: number;
    name: string;
    slug: string;
    category?: {
      id: number;
      name: string;
      slug: string;
      alpha2?: string;
      flag?: string;
    };
  };
}

export interface SofaScore {
  current?: number;
  display?: number;
  period1?: number;
  period2?: number;
  normaltime?: number;
  overtime?: number;
  penalties?: number;
}

export interface SofaStatus {
  code: number;
  description: string;
  type: string;
}

export interface SofaEvent {
  id: number;
  tournament: SofaTournament;
  homeTeam: SofaTeam;
  awayTeam: SofaTeam;
  homeScore: SofaScore;
  awayScore: SofaScore;
  status: SofaStatus;
  startTimestamp: number;
  time?: {
    currentPeriodStartTimestamp?: number;
    played?: number;
    periodLength?: number;
    overtimeLength?: number;
    totalPeriodCount?: number;
    injuryTime1?: number;
    injuryTime2?: number;
  };
  roundInfo?: {
    round?: number;
  };
  winnerCode?: number;
}

export interface TournamentGroup {
  tournament: SofaTournament;
  events: SofaEvent[];
}

export function getTeamImageUrl(teamId: number): string {
  const baseUrl = getApiUrl();
  return `${baseUrl}api/team/${teamId}/image`;
}

export function getTournamentImageUrl(tournamentId: number): string {
  const baseUrl = getApiUrl();
  return `${baseUrl}api/unique-tournament/${tournamentId}/image`;
}

export function getPlayerImageUrl(playerId: number): string {
  const baseUrl = getApiUrl();
  return `${baseUrl}api/player/${playerId}/image`;
}

export function groupEventsByTournament(events: SofaEvent[]): TournamentGroup[] {
  const grouped = new Map<string, TournamentGroup>();

  for (const event of events) {
    const key = event.tournament?.uniqueTournament?.id?.toString() || event.tournament?.name || "unknown";
    if (!grouped.has(key)) {
      grouped.set(key, {
        tournament: event.tournament,
        events: [],
      });
    }
    grouped.get(key)!.events.push(event);
  }

  return Array.from(grouped.values());
}

export function getMatchStatusText(event: SofaEvent): string {
  const { status } = event;
  if (!status) return "";

  if (status.type === "finished") return "FT";
  if (status.type === "inprogress") {
    if (status.description === "Halftime") return "HT";
    if (event.time?.played) return `${event.time.played}'`;
    return status.description || "Live";
  }
  if (status.type === "notstarted") {
    const date = new Date(event.startTimestamp * 1000);
    const hours = date.getHours().toString().padStart(2, "0");
    const mins = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${mins}`;
  }
  if (status.type === "canceled") return "Canc.";
  if (status.type === "postponed") return "Post.";

  return status.description || "";
}

export function isLive(event: SofaEvent): boolean {
  return event.status?.type === "inprogress";
}

export function isFinished(event: SofaEvent): boolean {
  return event.status?.type === "finished";
}

export function isUpcoming(event: SofaEvent): boolean {
  return event.status?.type === "notstarted";
}

export async function fetchScheduledEvents(
  sport: string,
  date: string,
): Promise<SofaEvent[]> {
  const baseUrl = getApiUrl();
  const url = `${baseUrl}api/sport/${sport}/scheduled-events/${date}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`Failed to fetch events: ${res.status}`);
    }
    const data = await res.json();
    return data.events || [];
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      throw new Error("Request timed out. Check your proxy settings.");
    }
    throw err;
  }
}
