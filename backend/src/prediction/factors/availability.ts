import type { GameContext } from "../types";

type InjurySourceAware = GameContext["homeInjuries"] & {
  source?: string;
};

export function injuryReportsAreVerified(
  ...reports: Array<GameContext["homeInjuries"]>
): boolean {
  const sources = reports.map((report) => (report as InjurySourceAware).source);
  if (sources.every((source) => source === undefined)) return true;
  return sources.every((source) => source !== "unavailable");
}

export function injuryUnavailableEvidence(): string {
  return "Player availability source unavailable — factor inactive";
}
