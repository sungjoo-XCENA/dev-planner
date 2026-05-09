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
  unavailable: string[];
};

export type MatchPlayerSummary = {
  playerId: string;
  playerName: string;
  group: PositionGroup;
  targetQuarterCount: number;
  fieldCount: number;
  quarters: Array<1 | 2 | 3 | 4>;
  isStarter: boolean;
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
  playerSummaries: MatchPlayerSummary[];
  warnings: string[];
};

export type MatchQuarterLimits = Record<string, number>;

const MIN_MATCH_FIELD_PLAYERS = 10;
const MAX_MATCH_FIELD_PLAYERS = 18;
const DEFAULT_MATCH_QUARTERS = 3;
const QUARTERS = [1, 2, 3, 4] as const;
const POSITION_GROUPS: PositionGroup[] = ["ATTACK", "MID", "DEFENSE"];
const TARGETS: Record<PositionGroup, number> = {
  ATTACK: 3,
  MID: 3,
  DEFENSE: 4,
};
const MATCH_FIELD_SLOTS_PER_QUARTER = TARGETS.ATTACK + TARGETS.MID + TARGETS.DEFENSE;
const MATCH_FIELD_SLOTS_TOTAL = MATCH_FIELD_SLOTS_PER_QUARTER * QUARTERS.length;

type FormationPlan = {
  score: number;
  attack: MatchSelection[];
  mid: MatchSelection[];
  defense: MatchSelection[];
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
  return POSITION_GROUPS
    .map((group) => selectionFor(player, group))
    .sort(selectionSort)[0].group;
}

function targetFor(id: string, limits: MatchQuarterLimits): number {
  return Math.max(1, Math.min(4, Math.round(limits[id] ?? DEFAULT_MATCH_QUARTERS)));
}

function selectionsFor(plan: FormationPlan): MatchSelection[] {
  return [...plan.attack, ...plan.mid, ...plan.defense];
}

function stateKey(plan: FormationPlan): string {
  return `${plan.attack.length}|${plan.mid.length}|${plan.defense.length}`;
}

function groupItems(plan: FormationPlan, group: PositionGroup): MatchSelection[] {
  if (group === "ATTACK") return plan.attack;
  if (group === "MID") return plan.mid;
  return plan.defense;
}

function withSelection(plan: FormationPlan, selection: MatchSelection): FormationPlan {
  return {
    score: plan.score + selection.score,
    attack: selection.group === "ATTACK" ? [...plan.attack, selection] : plan.attack,
    mid: selection.group === "MID" ? [...plan.mid, selection] : plan.mid,
    defense: selection.group === "DEFENSE" ? [...plan.defense, selection] : plan.defense,
  };
}

function selectionSort(a: MatchSelection, b: MatchSelection): number {
  const scoreDiff = b.score - a.score;
  if (scoreDiff !== 0) return scoreDiff;
  return a.player.name.localeCompare(b.player.name, "ko");
}

function normalizedPlan(plan: FormationPlan): FormationPlan {
  return {
    score: plan.score,
    attack: [...plan.attack].sort(selectionSort),
    mid: [...plan.mid].sort(selectionSort),
    defense: [...plan.defense].sort(selectionSort),
  };
}

function playerComposite(player: Player): number {
  return player.attackScore + player.midScore + player.defenseScore + player.activityScore;
}

function formationComposite(plan: FormationPlan): number {
  return selectionsFor(plan).reduce((sum, item) => sum + playerComposite(item.player), 0);
}

function formationNameKey(plan: FormationPlan): string {
  return selectionsFor(normalizedPlan(plan)).map((item) => item.player.name).join("|");
}

function isBetterPlan(candidate: FormationPlan, current?: FormationPlan): boolean {
  if (!current) return true;
  const scoreDiff = candidate.score - current.score;
  if (Math.abs(scoreDiff) > 0.0001) return scoreDiff > 0;
  const compositeDiff = formationComposite(candidate) - formationComposite(current);
  if (compositeDiff !== 0) return compositeDiff > 0;
  return formationNameKey(candidate).localeCompare(formationNameKey(current), "ko") < 0;
}

function pickFormation(
  players: Player[],
  assignmentScore: (player: Player, group: PositionGroup) => number,
): FormationPlan {
  const empty: FormationPlan = { score: 0, attack: [], mid: [], defense: [] };
  const states = new Map<string, FormationPlan>([[stateKey(empty), empty]]);

  for (const player of players) {
    const beforePlayer = Array.from(states.values());
    for (const plan of beforePlayer) {
      for (const group of POSITION_GROUPS) {
        if (groupItems(plan, group).length >= TARGETS[group]) continue;
        const selection = selectionFor(player, group);
        const candidate = withSelection(plan, {
          ...selection,
          score: assignmentScore(player, group),
        });
        const key = stateKey(candidate);
        if (isBetterPlan(candidate, states.get(key))) states.set(key, candidate);
      }
    }
  }

  const best = states.get(`${TARGETS.ATTACK}|${TARGETS.MID}|${TARGETS.DEFENSE}`);
  if (!best) throw new Error("매치 라인업을 만들 수 없습니다. 포지션 인원을 확인해주세요.");
  return normalizedPlan(best);
}

function lineupFromFormation(
  quarter: 1 | 2 | 3 | 4,
  formation: FormationPlan,
  allSelections: MatchSelection[],
  dedicatedGk: DedicatedGoalkeeper | null,
  playCounts: Map<string, number>,
  limits: MatchQuarterLimits,
): MatchQuarterLineup {
  const selected = selectionsFor(formation);
  const selectedIds = new Set(selected.map((item) => item.player.id));
  const benchItems = allSelections.filter((item) => !selectedIds.has(item.player.id));

  selected.forEach((item) => {
    playCounts.set(item.player.id, (playCounts.get(item.player.id) ?? 0) + 1);
  });

  return {
    quarter,
    attack: formation.attack.map((item) => item.player.name),
    mid: formation.mid.map((item) => item.player.name),
    defense: formation.defense.map((item) => item.player.name),
    gk: dedicatedGk?.name ?? "없음",
    bench: benchItems.map((item) => item.player.name),
    unavailable: benchItems
      .filter((item) => (playCounts.get(item.player.id) ?? 0) >= targetFor(item.player.id, limits))
      .map((item) => item.player.name),
  };
}

function formatQuotaItems(items: { name: string; actual: number; target: number }[]): string {
  const shown = items.slice(0, 6).map((item) => `${item.name}(${item.actual}/${item.target}Q)`);
  return `${shown.join(", ")}${items.length > shown.length ? ` 외 ${items.length - shown.length}명` : ""}`;
}

function buildPlayerSummaries(
  allSelections: MatchSelection[],
  starterIds: Set<string>,
  quarters: MatchQuarterLineup[],
  limits: MatchQuarterLimits,
): MatchPlayerSummary[] {
  return allSelections.map((item) => {
    const playedQuarters = quarters
      .filter((quarter) => [...quarter.attack, ...quarter.mid, ...quarter.defense].includes(item.player.name))
      .map((quarter) => quarter.quarter);

    return {
      playerId: item.player.id,
      playerName: item.player.name,
      group: item.group,
      targetQuarterCount: targetFor(item.player.id, limits),
      fieldCount: playedQuarters.length,
      quarters: playedQuarters,
      isStarter: starterIds.has(item.player.id),
    };
  });
}

export function planMatchLineup(
  players: Player[],
  dedicatedGks: DedicatedGoalkeeper[],
  quarterLimits: MatchQuarterLimits = {},
  rosterSize = players.filter((player) => player.primaryPosition !== "GK").length,
): MatchPlanResult {
  const warnings: string[] = [];
  const fieldPlayers = players.filter((player) => player.primaryPosition !== "GK");

  if (rosterSize < MIN_MATCH_FIELD_PLAYERS || rosterSize > MAX_MATCH_FIELD_PLAYERS) {
    throw new Error(`매치 모드는 필드 참석자 ${MIN_MATCH_FIELD_PLAYERS}명~${MAX_MATCH_FIELD_PLAYERS}명일 때 생성할 수 있습니다. 현재 ${rosterSize}명입니다.`);
  }
  if (fieldPlayers.length < rosterSize) {
    throw new Error(`매치 후보가 부족합니다. 참석 ${rosterSize}명에 후보 ${fieldPlayers.length}명입니다.`);
  }
  if (dedicatedGks.length === 0) {
    warnings.push("전담 GK가 없습니다. GK를 먼저 추가해주세요.");
  }
  if (dedicatedGks.length > 1) {
    warnings.push("전담 GK가 2명 이상입니다. 첫 번째 GK를 선발 GK로 사용하고 나머지는 대기로 봅니다.");
  }

  const bestFormation = pickFormation(fieldPlayers, (player, group) => roleScore(player, group));
  const starterSelections = selectionsFor(bestFormation).sort(selectionSort);
  const starterIds = new Set(starterSelections.map((item) => item.player.id));
  const starters: MatchPlanResult["starters"] = {
    attack: bestFormation.attack,
    mid: bestFormation.mid,
    defense: bestFormation.defense,
    gk: dedicatedGks[0] ?? null,
  };

  const bench = fieldPlayers
    .filter((player) => !starterIds.has(player.id))
    .map((player) => selectionFor(player, bestGroupFor(player)))
    .sort(selectionSort)
    .slice(0, Math.max(0, rosterSize - MATCH_FIELD_SLOTS_PER_QUARTER));
  const allSelections = [...starterSelections, ...bench].sort(selectionSort);
  const rosterIds = new Set(allSelections.map((item) => item.player.id));
  const excludedPlayers = fieldPlayers
    .filter((player) => !rosterIds.has(player.id))
    .sort((a, b) => playerComposite(b) - playerComposite(a) || a.name.localeCompare(b.name, "ko"));
  if (excludedPlayers.length > 0) {
    warnings.push(`매치 후보 ${fieldPlayers.length}명 중 ${rosterSize}명을 사용합니다. 제외: ${excludedPlayers.map((player) => player.name).join(", ")}`);
  }
  const rosterPlayers = allSelections.map((item) => item.player);
  const playCounts = new Map<string, number>();
  const quarters: MatchQuarterLineup[] = [];

  const q1Formation = pickFormation(rosterPlayers, (player, group) => {
    const isBenchPriority = !starterIds.has(player.id);
    return (isBenchPriority ? 1_000_000 : 0) + roleScore(player, group);
  });
  quarters.push(lineupFromFormation(1, q1Formation, allSelections, starters.gk, playCounts, quarterLimits));

  quarters.push(lineupFromFormation(2, bestFormation, allSelections, starters.gk, playCounts, quarterLimits));

  const q3Formation = pickFormation(rosterPlayers, (player, group) => {
    const current = playCounts.get(player.id) ?? 0;
    const isStarter = starterIds.has(player.id);
    const target = targetFor(player.id, quarterLimits);
    const finalWithoutQ3 = current + (isStarter ? 1 : 0);
    const needsSecondQuarter = current < 2;
    const cannotReachSecondWithoutQ3 = finalWithoutQ3 < 2;
    const targetShortfall = Math.max(0, target - finalWithoutQ3);
    const targetOverflow = Math.max(0, current - target);

    return (
      (needsSecondQuarter ? 500_000 : 0) +
      (!isStarter && needsSecondQuarter ? 250_000 : 0) +
      (cannotReachSecondWithoutQ3 ? 200_000 : 0) +
      targetShortfall * 50_000 -
      targetOverflow * 50_000 +
      roleScore(player, group)
    );
  });
  quarters.push(lineupFromFormation(3, q3Formation, allSelections, starters.gk, playCounts, quarterLimits));

  quarters.push(lineupFromFormation(4, bestFormation, allSelections, starters.gk, playCounts, quarterLimits));

  const requestedSlots = allSelections.reduce((total, item) => total + targetFor(item.player.id, quarterLimits), 0);
  if (requestedSlots > MATCH_FIELD_SLOTS_TOTAL) {
    warnings.push(`출전 쿼터 목표가 총 ${requestedSlots}칸이라 실제 배정 가능한 ${MATCH_FIELD_SLOTS_TOTAL}칸보다 많습니다. 일부 선수는 목표보다 적게 배정됩니다.`);
  } else if (requestedSlots < MATCH_FIELD_SLOTS_TOTAL) {
    warnings.push(`출전 쿼터 목표가 총 ${requestedSlots}칸이라 실제 필요한 ${MATCH_FIELD_SLOTS_TOTAL}칸보다 적습니다. 일부 선수는 목표보다 더 뛰게 됩니다.`);
  }

  const playerSummaries = buildPlayerSummaries(allSelections, starterIds, quarters, quarterLimits);
  const quotaDiffs = playerSummaries
    .map((item) => ({
      name: item.playerName,
      actual: item.fieldCount,
      target: item.targetQuarterCount,
    }))
    .sort((a, b) => {
      const diffA = Math.abs(a.target - a.actual);
      const diffB = Math.abs(b.target - b.actual);
      if (diffB !== diffA) return diffB - diffA;
      return a.name.localeCompare(b.name, "ko");
    });
  const underTarget = quotaDiffs.filter((item) => item.actual < item.target);
  const overTarget = quotaDiffs.filter((item) => item.actual > item.target);
  if (underTarget.length > 0) warnings.push(`목표보다 적게 배정된 선수: ${formatQuotaItems(underTarget)}`);
  if (overTarget.length > 0) warnings.push(`목표보다 많이 배정된 선수: ${formatQuotaItems(overTarget)}`);

  const weakGroups = POSITION_GROUPS.filter((group) => {
    const items = group === "ATTACK" ? starters.attack : group === "MID" ? starters.mid : starters.defense;
    return items.some((item) => item.reason === "전력 우선 포지션 변경");
  });
  if (weakGroups.length > 0) warnings.push(`일부 포지션은 전력 우선으로 변경 배정되었습니다: ${weakGroups.join(", ")}`);

  return { starters, quarters, bench, playerSummaries, warnings };
}
