import type { Player, PositionGroup } from "@/types/player";

export const MULTI_POSITION_SCORE_THRESHOLD = 7;

type PositionScores = Pick<Player, "attackScore" | "midScore" | "defenseScore">;

export function multiPositionGroups(player: PositionScores): PositionGroup[] {
  const groups: PositionGroup[] = [];
  if (player.attackScore >= MULTI_POSITION_SCORE_THRESHOLD) groups.push("ATTACK");
  if (player.midScore >= MULTI_POSITION_SCORE_THRESHOLD) groups.push("MID");
  if (player.defenseScore >= MULTI_POSITION_SCORE_THRESHOLD) groups.push("DEFENSE");
  return groups;
}

export function isMultiPositionPlayer(player: PositionScores): boolean {
  return multiPositionGroups(player).length >= 2;
}
