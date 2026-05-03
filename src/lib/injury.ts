import type { InjuryLevel } from "@/types/player";

export const INJURY_ACTIVITY_RATE: Record<InjuryLevel, number> = {
  0: 1,
  1: 0.85,
  2: 0.7,
  3: 0.5,
};

type ActivityInput = {
  activityScore: number;
  injuryLevel?: InjuryLevel;
};

export function injuryLevelFor(player: ActivityInput): InjuryLevel {
  return player.injuryLevel ?? 0;
}

export function effectiveActivityScore(player: ActivityInput): number {
  return player.activityScore * INJURY_ACTIVITY_RATE[injuryLevelFor(player)];
}

export function hasInjury(player: ActivityInput): boolean {
  return injuryLevelFor(player) > 0;
}

export function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
