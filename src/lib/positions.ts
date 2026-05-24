import type { FieldPosition, PositionGroup } from "@/types/player";
import { attackRoleScore, defenseRoleScore } from "@/lib/playerScores";

export const POSITIONS = ["CF", "LW", "RW", "MF", "LB", "RB", "CB"] as const;

export const POSITION_GROUP_MAP: Record<FieldPosition, PositionGroup> = {
  CF: "ATTACK",
  LW: "ATTACK",
  RW: "ATTACK",
  MF: "MID",
  LB: "DEFENSE",
  RB: "DEFENSE",
  CB: "DEFENSE",
};

export function isPosition(value: string): value is FieldPosition {
  return (POSITIONS as readonly string[]).includes(value.trim().toUpperCase());
}

export function toPosition(value: string): FieldPosition | null {
  const normalized = value.trim().toUpperCase();
  return isPosition(normalized) ? normalized : null;
}

export function getPositionGroup(position: FieldPosition): PositionGroup {
  return POSITION_GROUP_MAP[position];
}

export function parseSecondaryPositions(value: string): FieldPosition[] {
  const normalized = value.trim();
  if (!normalized || normalized === "-") return [];
  return normalized
    .split(",")
    .map((item) => toPosition(item))
    .filter((item): item is FieldPosition => item !== null);
}

export function hasGroup(positions: FieldPosition[], group: PositionGroup): boolean {
  return positions.some((position) => getPositionGroup(position) === group);
}

export function scoreForGroup(
  group: PositionGroup,
  scores: {
    attackScore: number;
    midScore: number;
    defenseScore: number;
    centerForwardScore?: number;
    wingScore?: number;
    centerBackScore?: number;
    wingBackScore?: number;
  },
): number {
  if (group === "ATTACK") return attackRoleScore(scores);
  if (group === "MID") return scores.midScore;
  return defenseRoleScore(scores);
}

export function groupLabel(group: PositionGroup): string {
  if (group === "ATTACK") return "공격";
  if (group === "MID") return "미드";
  return "수비";
}
