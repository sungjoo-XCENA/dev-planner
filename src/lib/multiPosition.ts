import type { Player, PositionGroup } from "@/types/player";
import { attackRoleScore, defenseRoleScore } from "@/lib/playerScores";

export const MULTI_POSITION_SCORE_THRESHOLD = 7;

type PositionScores = Pick<Player, "attackScore" | "midScore" | "defenseScore"> & {
  centerForwardScore?: number;
  wingScore?: number;
  centerBackScore?: number;
  wingBackScore?: number;
};

export function multiPositionGroups(player: PositionScores): PositionGroup[] {
  const groups: PositionGroup[] = [];
  if (attackRoleScore(player) >= MULTI_POSITION_SCORE_THRESHOLD) groups.push("ATTACK");
  if (player.midScore >= MULTI_POSITION_SCORE_THRESHOLD) groups.push("MID");
  if (defenseRoleScore(player) >= MULTI_POSITION_SCORE_THRESHOLD) groups.push("DEFENSE");
  return groups;
}

export function isMultiPositionPlayer(player: PositionScores): boolean {
  return multiPositionGroups(player).length >= 2;
}
