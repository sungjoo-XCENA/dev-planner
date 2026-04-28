import type { DedicatedGoalkeeper, FieldPosition, Player, PositionGroup } from "@/types/player";
import { getPositionGroup, hasGroup, scoreForGroup } from "./positions";

export type MatchSelection = {
  player: Player;
  group: PositionGroup;
  score: number;
  reason: string;
};

export type MatchPlanResult = {
  starters: {
    attack: MatchSelection[];
    mid: MatchSelection[];
    defense: MatchSelection[];
    gk: DedicatedGoalkeeper | null;
  };
  bench: MatchSelection[];
  warnings: string[];
};

const MIN_MATCH_FIELD_PLAYERS = 11;
const MAX_MATCH_FIELD_PLAYERS = 18;
const TARGETS: Record<PositionGroup, number> = {
  ATTACK: 3,
  MID: 3,
  DEFENSE: 5,
};

function isFieldPosition(position: Player["primaryPosition"]): position is FieldPosition {
  return position !== "GK";
}

function roleScore(player: Player, group: PositionGroup): number {
  if (!isFieldPosition(player.primaryPosition)) return Number.NEGATIVE_INFINITY;

  const primaryGroup = getPositionGroup(player.primaryPosition);
  const base = scoreForGroup(group, player);
  const primaryBonus = primaryGroup === group ? 3 : 0;
  const secondaryBonus = hasGroup(player.secondaryPositions, group) ? 1.5 : 0;
  const activityBonus = player.activityScore * 0.35;
  const mismatchPenalty = primaryGroup !== group && secondaryBonus === 0 ? -2 : 0;
  return base * 2 + activityBonus + primaryBonus + secondaryBonus + mismatchPenalty;
}

function selectionFor(player: Player, group: PositionGroup): MatchSelection {
  const primaryGroup = isFieldPosition(player.primaryPosition) ? getPositionGroup(player.primaryPosition) : null;
  const reason = primaryGroup === group
    ? "주포지션 적합"
    : hasGroup(player.secondaryPositions, group)
      ? "부포지션 적합"
      : "전력 우선 포지션 변경";

  return {
    player,
    group,
    score: roleScore(player, group),
    reason,
  };
}

function bestGroupFor(player: Player): PositionGroup {
  return (["ATTACK", "MID", "DEFENSE"] as PositionGroup[])
    .map((group) => selectionFor(player, group))
    .sort((a, b) => b.score - a.score)[0].group;
}

export function planMatchLineup(players: Player[], dedicatedGks: DedicatedGoalkeeper[]): MatchPlanResult {
  const warnings: string[] = [];
  const fieldPlayers = players.filter((player) => player.primaryPosition !== "GK");

  if (fieldPlayers.length < MIN_MATCH_FIELD_PLAYERS || fieldPlayers.length > MAX_MATCH_FIELD_PLAYERS) {
    throw new Error(`매치 모드는 필드 참석자 ${MIN_MATCH_FIELD_PLAYERS}명~${MAX_MATCH_FIELD_PLAYERS}명일 때 생성할 수 있습니다. 현재 ${fieldPlayers.length}명입니다.`);
  }
  if (dedicatedGks.length === 0) {
    warnings.push("전담 GK가 없습니다. GK를 먼저 추가해주세요.");
  }
  if (dedicatedGks.length > 1) {
    warnings.push("전담 GK가 2명 이상입니다. 첫 번째 GK를 선발 GK로 사용하고 나머지는 대기로 봅니다.");
  }

  const selectedIds = new Set<string>();
  const starters: MatchPlanResult["starters"] = {
    attack: [],
    mid: [],
    defense: [],
    gk: dedicatedGks[0] ?? null,
  };

  const fillGroup = (group: PositionGroup, count: number): MatchSelection[] => {
    const candidates = fieldPlayers
      .filter((player) => !selectedIds.has(player.id))
      .map((player) => selectionFor(player, group))
      .sort((a, b) => b.score - a.score);
    const picked = candidates.slice(0, count);
    picked.forEach((item) => selectedIds.add(item.player.id));
    return picked;
  };

  starters.defense = fillGroup("DEFENSE", TARGETS.DEFENSE);
  starters.mid = fillGroup("MID", TARGETS.MID);
  starters.attack = fillGroup("ATTACK", TARGETS.ATTACK);

  const totalStarters = starters.attack.length + starters.mid.length + starters.defense.length;
  if (totalStarters < 11) {
    const shortage = 11 - totalStarters;
    const extra = fieldPlayers
      .filter((player) => !selectedIds.has(player.id))
      .map((player) => selectionFor(player, bestGroupFor(player)))
      .sort((a, b) => b.score - a.score)
      .slice(0, shortage);
    extra.forEach((item) => {
      selectedIds.add(item.player.id);
      if (item.group === "ATTACK") starters.attack.push(item);
      else if (item.group === "MID") starters.mid.push(item);
      else starters.defense.push(item);
    });
  }

  const bench = fieldPlayers
    .filter((player) => !selectedIds.has(player.id))
    .map((player) => selectionFor(player, bestGroupFor(player)))
    .sort((a, b) => b.score - a.score);

  const weakGroups = (["ATTACK", "MID", "DEFENSE"] as PositionGroup[]).filter((group) => {
    const items = group === "ATTACK" ? starters.attack : group === "MID" ? starters.mid : starters.defense;
    return items.some((item) => item.reason === "전력 우선 포지션 변경");
  });
  if (weakGroups.length > 0) warnings.push(`일부 포지션은 전력 우선으로 변경 배정되었습니다: ${weakGroups.join(", ")}`);

  return { starters, bench, warnings };
}
