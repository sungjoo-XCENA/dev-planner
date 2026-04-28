import type { DedicatedGoalkeeper, FieldPosition, Player, PositionGroup } from "@/types/player";
import { getPositionGroup, hasGroup, scoreForGroup } from "./positions";

export type MatchSelection = {
  player: Player;
  group: PositionGroup;
  score: number;
  reason: string;
};

export type MatchQuarterLineup = {
  quarter: 1 | 2 | 3 | 4;
  attack: string[];
  mid: string[];
  defense: string[];
  gk: string;
  bench: string[];
};

export type MatchPlanResult = {
  starters: {
    attack: MatchSelection[];
    mid: MatchSelection[];
    defense: MatchSelection[];
    gk: DedicatedGoalkeeper | null;
  };
  quarters: MatchQuarterLineup[];
  bench: MatchSelection[];
  warnings: string[];
};

export type MatchQuarterLimits = Record<string, number>;

const MIN_MATCH_FIELD_PLAYERS = 10;
const MAX_MATCH_FIELD_PLAYERS = 18;
const FIELD_STARTER_COUNT = 10;
const QUARTERS = [1, 2, 3, 4] as const;
const TARGETS: Record<PositionGroup, number> = {
  ATTACK: 3,
  MID: 3,
  DEFENSE: 4,
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

function pickGroup(
  players: Player[],
  group: PositionGroup,
  count: number,
  selectedIds: Set<string>,
): MatchSelection[] {
  const picked = players
    .filter((player) => !selectedIds.has(player.id))
    .map((player) => selectionFor(player, group))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
  picked.forEach((item) => selectedIds.add(item.player.id));
  return picked;
}

function selectionsByGroup(selections: MatchSelection[], group: PositionGroup): MatchSelection[] {
  return selections.filter((item) => item.group === group);
}

function buildQuarterLineups(
  selections: MatchSelection[],
  dedicatedGk: DedicatedGoalkeeper | null,
  limits: MatchQuarterLimits,
): MatchQuarterLineup[] {
  const playCounts = new Map<string, number>();
  const ordered = [...selections].sort((a, b) => b.score - a.score);
  const targetFor = (id: string) => Math.max(0, Math.min(4, Math.round(limits[id] ?? 4)));

  return QUARTERS.map((quarter) => {
    const selected = [...ordered]
      .sort((a, b) => {
        const needA = targetFor(a.player.id) - (playCounts.get(a.player.id) ?? 0);
        const needB = targetFor(b.player.id) - (playCounts.get(b.player.id) ?? 0);
        if (needB !== needA) return needB - needA;
        return b.score - a.score;
      })
      .filter((item) => (playCounts.get(item.player.id) ?? 0) < targetFor(item.player.id))
      .slice(0, FIELD_STARTER_COUNT);

    selected.forEach((item) => playCounts.set(item.player.id, (playCounts.get(item.player.id) ?? 0) + 1));
    const selectedIds = new Set(selected.map((item) => item.player.id));
    const bench = ordered.filter((item) => !selectedIds.has(item.player.id)).map((item) => item.player.name);

    return {
      quarter,
      attack: selectionsByGroup(selected, "ATTACK").map((item) => item.player.name),
      mid: selectionsByGroup(selected, "MID").map((item) => item.player.name),
      defense: selectionsByGroup(selected, "DEFENSE").map((item) => item.player.name),
      gk: dedicatedGk?.name ?? "없음",
      bench,
    };
  });
}

export function planMatchLineup(
  players: Player[],
  dedicatedGks: DedicatedGoalkeeper[],
  quarterLimits: MatchQuarterLimits = {},
): MatchPlanResult {
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

  starters.defense = pickGroup(fieldPlayers, "DEFENSE", TARGETS.DEFENSE, selectedIds);
  starters.mid = pickGroup(fieldPlayers, "MID", TARGETS.MID, selectedIds);
  starters.attack = pickGroup(fieldPlayers, "ATTACK", TARGETS.ATTACK, selectedIds);

  const starterSelections = [...starters.attack, ...starters.mid, ...starters.defense];
  if (starterSelections.length < FIELD_STARTER_COUNT) {
    const shortage = FIELD_STARTER_COUNT - starterSelections.length;
    const extra = fieldPlayers
      .filter((player) => !selectedIds.has(player.id))
      .map((player) => selectionFor(player, bestGroupFor(player)))
      .sort((a, b) => b.score - a.score)
      .slice(0, shortage);
    extra.forEach((item) => {
      selectedIds.add(item.player.id);
      starterSelections.push(item);
      if (item.group === "ATTACK") starters.attack.push(item);
      else if (item.group === "MID") starters.mid.push(item);
      else starters.defense.push(item);
    });
  }

  const bench = fieldPlayers
    .filter((player) => !selectedIds.has(player.id))
    .map((player) => selectionFor(player, bestGroupFor(player)))
    .sort((a, b) => b.score - a.score);
  const allSelections = [...starterSelections, ...bench].sort((a, b) => b.score - a.score);
  const quarters = buildQuarterLineups(allSelections, starters.gk, quarterLimits);

  const weakGroups = (["ATTACK", "MID", "DEFENSE"] as PositionGroup[]).filter((group) => {
    const items = group === "ATTACK" ? starters.attack : group === "MID" ? starters.mid : starters.defense;
    return items.some((item) => item.reason === "전력 우선 포지션 변경");
  });
  if (weakGroups.length > 0) warnings.push(`일부 포지션은 전력 우선으로 변경 배정되었습니다: ${weakGroups.join(", ")}`);

  return { starters, quarters, bench, warnings };
}
