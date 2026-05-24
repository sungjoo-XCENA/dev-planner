import type { FieldPosition, Player } from "@/types/player";

type ScoreLike = Pick<Player, "attackScore" | "midScore" | "defenseScore"> & {
  centerForwardScore?: number;
  wingScore?: number;
  centerBackScore?: number;
  wingBackScore?: number;
};

function validScore(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined ? value : fallback;
}

export function centerForwardScore(player: ScoreLike): number {
  return validScore(player.centerForwardScore, player.attackScore);
}

export function wingScore(player: ScoreLike): number {
  return validScore(player.wingScore, player.attackScore);
}

export function centerBackScore(player: ScoreLike): number {
  return validScore(player.centerBackScore, player.defenseScore);
}

export function wingBackScore(player: ScoreLike): number {
  return validScore(player.wingBackScore, player.defenseScore);
}

export function attackRoleScore(player: ScoreLike): number {
  return Math.max(centerForwardScore(player), wingScore(player));
}

export function defenseRoleScore(player: ScoreLike): number {
  return Math.max(centerBackScore(player), wingBackScore(player));
}

export function scoreForFieldPosition(player: ScoreLike, position: FieldPosition): number {
  if (position === "CF") return centerForwardScore(player);
  if (position === "LW" || position === "RW") return wingScore(player);
  if (position === "MF") return player.midScore;
  if (position === "CB") return centerBackScore(player);
  return wingBackScore(player);
}

export function detailedTechnicalTotal(player: ScoreLike): number {
  return centerForwardScore(player)
    + wingScore(player)
    + player.midScore
    + centerBackScore(player)
    + wingBackScore(player);
}
