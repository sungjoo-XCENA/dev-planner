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

function targetFor(id: string, limits: MatchQuarterLimits): number {
  return Math.max(1, Math.min(4, Math.round(limits[id] ?? 4)));
}

function pickQuarterGroup(
  pool: MatchSelection[],
  group: PositionGroup,
  count: number,
  selectedIds: Set<string>,
  playCounts: Map<string, number>,
  limits: MatchQuarterLimits,
): MatchSelection[] {
  const groupPool = pool.filter((item) => item.group === group && !selectedIds.has(item.player.id));
  const candidates = groupPool.length >= count
    ? groupPool
    : pool.filter((item) => !selectedIds.has(item.player.id));

  const picked = [...candidates]
    .sort((a, b) => {
      const remainingA = targetFor(a.player.id, limits) - (playCounts.get(a.player.id) ?? 0);
      const remainingB = targetFor(b.player.id, limits) - (playCounts.get(b.player.id) ?? 0);
      const playedEnoughA = remainingA <= 0 ? 1 : 0;
      const playedEnoughB = remainingB <= 0 ? 1 : 0;
      if (playedEnoughA !== playedEnoughB) return playedEnoughA - playedEnoughB;
      if (remainingB !== remainingA) return remainingB - remainingA;
      const groupFitA = a.group === group ? 1 : 0;
      const groupFitB = b.group === group ? 1 : 0;
      if (groupFitB !== groupFitA) return groupFitB - groupFitA;
      return b.score - a.score;
    })
    .slice(0, count);

  picked.forEach((item) => selectedIds.add(item.player.id));
  return picked;
}

function buildQuarterLineups(
  selections: MatchSelection[],
  dedicatedGk: DedicatedGoalkeeper | null,
  limits: MatchQuarterLimits,
): MatchQuarterLineup[] {
  const playCounts = new Map<string, number>();
  const ordered = [...selections].sort((a, b) => b.score - a.score);

  return QUARTERS.map((quarter) => {
    const selectedIds = new Set<string>();
    const attack = pickQuarterGroup(ordered, "ATTACK", TARGETS.ATTACK, selectedIds, playCounts, limits);
    const mid = pickQuarterGroup(ordered, "MID", TARGETS.MID, selectedIds, playCounts, limits);
    const defense = pickQuarterGroup(ordered, "DEFENSE", TARGETS.DEFENSE, selectedIds, playCounts, limits);
    const selected = [...attack, ...mid, ...defense];

    selected.forEach((item) => playCounts.set(item.player.id, (playCounts.get(item.player.id) ?? 0) + 1));
    const bench = ordered.filter((item) => !selectedIds.has(item.player.id)).map((item) => item.player.name);

    return {
      quarter,
      attack: attack.map((item) => item.player.name),
      mid: mid.map((item) => item.player.name),
      defense: defense.map((item) => item.player.name),
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
