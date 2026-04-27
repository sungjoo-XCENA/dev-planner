import type { Position, PositionGroup } from "@/types/player";

export const POSITIONS = ["ST", "CF", "LW", "RW", "CAM", "CM", "CDM", "LB", "RB", "CB"] as const;

export const POSITION_GROUP_MAP: Record<Position, PositionGroup> = {
  ST: "ATTACK",
  CF: "ATTACK",
  LW: "ATTACK",
  RW: "ATTACK",
  CAM: "MID",
  CM: "MID",
  CDM: "MID",
  LB: "DEFENSE",
  RB: "DEFENSE",
  CB: "DEFENSE",
};

export function isPosition(value: string): value is Position {
  return (POSITIONS as readonly string[]).includes(value.trim().toUpperCase());
}

export function toPosition(value: string): Position | null {
  const normalized = value.trim().toUpperCase();
  return isPosition(normalized) ? normalized : null;
}

export function getPositionGroup(position: Position): PositionGroup {
  return POSITION_GROUP_MAP[position];
}

export function parseSecondaryPositions(value: string): Position[] {
  if (!value.trim()) return [];
  return value
    .split(",")
    .map((item) => toPosition(item))
    .filter((item): item is Position => item !== null);
}

export function hasGroup(positions: Position[], group: PositionGroup): boolean {
  return positions.some((position) => getPositionGroup(position) === group);
}

export function scoreForGroup(
  group: PositionGroup,
  scores: { attackScore: number; midScore: number; defenseScore: number },
): number {
  if (group === "ATTACK") return scores.attackScore;
  if (group === "MID") return scores.midScore;
  return scores.defenseScore;
}

export function groupLabel(group: PositionGroup): string {
  if (group === "ATTACK") return "공격";
  if (group === "MID") return "미드";
  return "수비";
}
