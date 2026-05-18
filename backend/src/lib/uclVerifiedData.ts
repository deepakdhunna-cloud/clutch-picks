import { env } from "../env";
import coefficientRaw from "./data/uclPedigree.json" assert { type: "json" };
import locationRaw from "./data/uclCityCoords.json" assert { type: "json" };

interface UclCoefficientFile {
  _meta?: unknown;
  pedigree: Record<string, number>;
}

interface UclLocationFile {
  _meta?: unknown;
  cities: Record<string, [number, number]>;
  teamCity: Record<string, string>;
}

export interface UclPedigreePair {
  home: number;
  away: number;
}

export interface UclTravelInfo {
  distanceKm: number;
  homeCity: string;
  awayCity: string;
}

const VERIFIED_FEED_TTL_MS = 6 * 60 * 60 * 1000;

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function normalizeCoefficientFile(file: Partial<UclCoefficientFile>): UclCoefficientFile {
  const pedigree = file.pedigree && typeof file.pedigree === "object"
    ? Object.fromEntries(
        Object.entries(file.pedigree).filter((entry): entry is [string, number] =>
          typeof entry[1] === "number",
        ),
      )
    : {};
  return { pedigree };
}

function normalizeLocationFile(file: Partial<UclLocationFile>): UclLocationFile {
  const cities = file.cities && typeof file.cities === "object"
    ? Object.fromEntries(
        Object.entries(file.cities).filter((entry): entry is [string, [number, number]] =>
          isCoordinate(entry[1]),
        ),
      )
    : {};
  const teamCity = file.teamCity && typeof file.teamCity === "object"
    ? Object.fromEntries(
        Object.entries(file.teamCity).filter((entry): entry is [string, string] =>
          typeof entry[1] === "string",
        ),
      )
    : {};
  return { cities, teamCity };
}

const LOCAL_COEFFICIENTS = normalizeCoefficientFile(
  coefficientRaw as unknown as Partial<UclCoefficientFile>,
);
const LOCAL_LOCATIONS = normalizeLocationFile(
  locationRaw as unknown as Partial<UclLocationFile>,
);

let coefficientCache: { data: UclCoefficientFile; expiresAt: number } | null = null;
let locationCache: { data: UclLocationFile; expiresAt: number } | null = null;

async function loadJsonFeed<T>(
  url: string | undefined,
  local: T,
  normalize: (value: Partial<T>) => T,
  label: string,
): Promise<T> {
  if (!url) return local;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return normalize((await response.json()) as Partial<T>);
  } catch (error) {
    console.warn(`[verified-data] ${label} feed unavailable:`, error);
    return local;
  }
}

async function loadCoefficients(): Promise<UclCoefficientFile> {
  if (coefficientCache && coefficientCache.expiresAt > Date.now()) {
    return coefficientCache.data;
  }
  const data = await loadJsonFeed(
    env.UCL_COEFFICIENTS_SOURCE_URL,
    LOCAL_COEFFICIENTS,
    normalizeCoefficientFile,
    "UCL coefficients",
  );
  coefficientCache = { data, expiresAt: Date.now() + VERIFIED_FEED_TTL_MS };
  return data;
}

async function loadLocations(): Promise<UclLocationFile> {
  if (locationCache && locationCache.expiresAt > Date.now()) {
    return locationCache.data;
  }
  const data = await loadJsonFeed(
    env.UCL_TEAM_LOCATION_SOURCE_URL,
    LOCAL_LOCATIONS,
    normalizeLocationFile,
    "UCL team locations",
  );
  locationCache = { data, expiresAt: Date.now() + VERIFIED_FEED_TTL_MS };
  return data;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function lookupUclPedigreePair(
  homeTeamName: string,
  awayTeamName: string,
): Promise<UclPedigreePair | null> {
  const data = await loadCoefficients();
  const home = data.pedigree[homeTeamName];
  const away = data.pedigree[awayTeamName];
  if (typeof home !== "number" || typeof away !== "number") return null;
  return { home, away };
}

export async function lookupUclTravelInfo(
  homeTeamName: string,
  awayTeamName: string,
): Promise<UclTravelInfo | null> {
  const data = await loadLocations();
  const homeCity = data.teamCity[homeTeamName];
  const awayCity = data.teamCity[awayTeamName];
  if (!homeCity || !awayCity) return null;

  const homeCoord = data.cities[homeCity];
  const awayCoord = data.cities[awayCity];
  if (!homeCoord || !awayCoord) return null;

  return {
    distanceKm: haversineKm(homeCoord, awayCoord),
    homeCity,
    awayCity,
  };
}
