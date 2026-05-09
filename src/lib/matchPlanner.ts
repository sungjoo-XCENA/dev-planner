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
  isCallup: boolean;
  isRequired: boolean;
};

export type MatchOperationSwap = {
  group: PositionGroup;
  outName: string;
  inName: string;
  reason: string;
};

export type MatchOperationPlan = {
  keepLineup: MatchQuarterLineup;
  rotateLineup: MatchQuarterLineup;
  rotateSwaps: MatchOperationSwap[];
  q4PriorityNames: string[];
  coveredByQ3Names: string[];
  callupUsedNames: string[];
  callupUnusedNames: string[];
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
  notes: string[];
  operation: MatchOperationPlan;
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
  optionalCount: number;
  attack: MatchSelection[];
  mid: MatchSelection[];
  defense: MatchSelection[];
};

type PickFormationOptions = {
  optionalIds?: Set<string>;
  maxOptional?: number;
};

function isFieldPosition(position: Player["primaryPosition"]): position is FieldPosition {
  return position !== "GK";
}

function uniqueFieldPlayers(players: Player[]): Player[] {
  const seen = new Set<string>();
  const unique: Player[] = [];
  for (const player of players) {
    if (player.primaryPosition === "GK" || seen.has(player.id)) continue;
    seen.add(player.id);
    unique.push(player);
  }
  return unique;
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
    ? "주 포지션 적합"
    : hasGroup(player.secondaryPositions, group)
      ? "부 포지션 적합"
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
  return `${plan.attack.length}|${plan.mid.length}|${plan.defense.length}|${plan.optionalCount}`;
}

function isCompletePlan(plan: FormationPlan): boolean {
  return plan.attack.length === TARGETS.ATTACK
    && plan.mid.length === TARGETS.MID
    && plan.defense.length === TARGETS.DEFENSE;
}

function groupItems(plan: FormationPlan, group: PositionGroup): MatchSelection[] {
  if (group === "ATTACK") return plan.attack;
  if (group === "MID") return plan.mid;
  return plan.defense;
}

function withSelection(plan: FormationPlan, selection: MatchSelection, options?: PickFormationOptions): FormationPlan | null {
  const optionalCount = plan.optionalCount + (options?.optionalIds?.has(selection.player.id) ? 1 : 0);
  if (options?.maxOptional !== undefined && optionalCount > options.maxOptional) return null;

  return {
    score: plan.score + selection.score,
    optionalCount,
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
    optionalCount: plan.optionalCount,
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
  options?: PickFormationOptions,
): FormationPlan {
  const empty: FormationPlan = { score: 0, optionalCount: 0, attack: [], mid: [], defense: [] };
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
        }, options);
        if (!candidate) continue;
        const key = stateKey(candidate);
        if (isBetterPlan(candidate, states.get(key))) states.set(key, candidate);
      }
    }
  }

  let best: FormationPlan | undefined;
  for (const plan of Array.from(states.values())) {
    if (isCompletePlan(plan) && isBetterPlan(plan, best)) best = plan;
  }
  if (!best) throw new Error("매치 라인업을 만들 수 없습니다. 포지션과 인원을 확인해주세요.");
  return normalizedPlan(best);
}

function lineupFromFormation(
  quarter: 1 | 2 | 3 | 4,
  formation: FormationPlan,
  allSelections: MatchSelection[],
  dedicatedGk: DedicatedGoalkeeper | null,
  playCounts: Map<string, number>,
  limits: MatchQuarterLimits,
  countPlays = true,
): MatchQuarterLineup {
  const selected = selectionsFor(formation);
  const selectedIds = new Set(selected.map((item) => item.player.id));
  const benchItems = allSelections.filter((item) => !selectedIds.has(item.player.id));

  if (countPlays) {
    selected.forEach((item) => {
      playCounts.set(item.player.id, (playCounts.get(item.player.id) ?? 0) + 1);
    });
  }

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

function selectionsForGroup(plan: FormationPlan, group: PositionGroup): MatchSelection[] {
  if (group === "ATTACK") return plan.attack;
  if (group === "MID") return plan.mid;
  return plan.defense;
}

function buildSwapSuggestions(
  keepPlan: FormationPlan,
  rotatePlan: FormationPlan,
  playCountsBeforeFourth: Map<string, number>,
): MatchOperationSwap[] {
  const swaps: MatchOperationSwap[] = [];
  for (const group of POSITION_GROUPS) {
    const keepItems = selectionsForGroup(keepPlan, group);
    const rotateItems = selectionsForGroup(rotatePlan, group);
    const rotateIds = new Set(rotateItems.map((item) => item.player.id));
    const keepIds = new Set(keepItems.map((item) => item.player.id));
    const outItems = keepItems.filter((item) => !rotateIds.has(item.player.id));
    const inItems = rotateItems.filter((item) => !keepIds.has(item.player.id));

    inItems.forEach((inItem, index) => {
      const outItem = outItems[index];
      if (!outItem) return;
      const played = playCountsBeforeFourth.get(inItem.player.id) ?? 0;
      swaps.push({
        group,
        outName: outItem.player.name,
        inName: inItem.player.name,
        reason: `${inItem.player.name} ${played}Q 출전`,
      });
    });
  }
  return swaps;
}

function buildPlayerSummaries(
  allSelections: MatchSelection[],
  starterIds: Set<string>,
  callupIds: Set<string>,
  requiredIds: Set<string>,
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
      isCallup: callupIds.has(item.player.id),
      isRequired: requiredIds.has(item.player.id),
    };
  });
}

export function planMatchLineup(
  players: Player[],
  dedicatedGks: DedicatedGoalkeeper[],
  quarterLimits: MatchQuarterLimits = {},
  callupPlayers: Player[] = [],
): MatchPlanResult {
  const warnings: string[] = [];
  const notes: string[] = [
    "1Q는 베스트 11에 들지 않은 정규 참석자를 먼저 배정하고, 2Q와 4Q는 베스트 라인업으로 잡습니다.",
    "3Q는 3Q까지 정규 참석자가 최소 1Q, 가능하면 2Q를 채우도록 배정합니다. 지고 있으면 4Q 베스트를 유지하고, 여유가 있으면 2Q 미만 선수와 교체하세요.",
  ];
  const requiredPlayers = uniqueFieldPlayers(players);
  const requiredIds = new Set(requiredPlayers.map((player) => player.id));
  const optionalPlayers = uniqueFieldPlayers(callupPlayers).filter((player) => !requiredIds.has(player.id));
  const callupCandidateIds = new Set(optionalPlayers.map((player) => player.id));
  const maxCallups = Math.max(0, MAX_MATCH_FIELD_PLAYERS - requiredPlayers.length);
  const candidatePlayers = [...requiredPlayers, ...optionalPlayers];

  if (requiredPlayers.length < MIN_MATCH_FIELD_PLAYERS || requiredPlayers.length > MAX_MATCH_FIELD_PLAYERS) {
    throw new Error(`매치 모드는 정규 필드 참석자가 ${MIN_MATCH_FIELD_PLAYERS}명~${MAX_MATCH_FIELD_PLAYERS}명일 때 생성할 수 있습니다. 현재 ${requiredPlayers.length}명입니다.`);
  }
  if (candidatePlayers.length < MATCH_FIELD_SLOTS_PER_QUARTER) {
    throw new Error(`매치 후보가 부족합니다. 필드 10명을 만들려면 후보가 ${MATCH_FIELD_SLOTS_PER_QUARTER}명 이상 필요합니다.`);
  }
  if (dedicatedGks.length === 0) {
    warnings.push("전담 GK가 없습니다. GK를 먼저 추가해주세요.");
  }
  if (dedicatedGks.length > 1) {
    warnings.push("전담 GK가 2명 이상입니다. 첫 번째 GK를 선발 GK로 사용하고 나머지는 대기로 봅니다.");
  }
  if (optionalPlayers.length > 0 && maxCallups === 0) {
    notes.push("정규 참석자가 이미 18명이라 콜업 후보는 베스트 라인업 계산에서 제외됩니다.");
  }

  const bestFormation = pickFormation(candidatePlayers, (player, group) => roleScore(player, group), {
    optionalIds: callupCandidateIds,
    maxOptional: maxCallups,
  });
  const starterSelections = selectionsFor(bestFormation).sort(selectionSort);
  const starterIds = new Set(starterSelections.map((item) => item.player.id));
  const usedCallupSelections = starterSelections.filter((item) => callupCandidateIds.has(item.player.id));
  const usedCallupIds = new Set(usedCallupSelections.map((item) => item.player.id));
  const starters: MatchPlanResult["starters"] = {
    attack: bestFormation.attack,
    mid: bestFormation.mid,
    defense: bestFormation.defense,
    gk: dedicatedGks[0] ?? null,
  };

  const selectionById = new Map<string, MatchSelection>();
  for (const player of requiredPlayers) {
    selectionById.set(player.id, selectionFor(player, bestGroupFor(player)));
  }
  for (const item of starterSelections) {
    selectionById.set(item.player.id, item);
  }

  const allSelections = Array.from(selectionById.values()).sort(selectionSort);
  const bench = allSelections.filter((item) => !starterIds.has(item.player.id)).sort(selectionSort);
  const unusedCallups = optionalPlayers
    .filter((player) => !usedCallupIds.has(player.id))
    .sort((a, b) => playerComposite(b) - playerComposite(a) || a.name.localeCompare(b.name, "ko"));
  if (usedCallupSelections.length > 0) {
    notes.push(`베스트 라인업에 콜업 후보 ${usedCallupSelections.length}명을 반영했습니다: ${usedCallupSelections.map((item) => item.player.name).join(", ")}`);
  }
  if (unusedCallups.length > 0) {
    notes.push(`콜업 후보 ${unusedCallups.length}명은 정규 참석자 출전 보장을 위해 자동 배정하지 않았습니다: ${unusedCallups.map((player) => player.name).join(", ")}`);
  }

  const rosterPlayers = allSelections.map((item) => item.player);
  const playCounts = new Map<string, number>();
  const quarters: MatchQuarterLineup[] = [];

  const q1Formation = pickFormation(rosterPlayers, (player, group) => {
    const isRequired = requiredIds.has(player.id);
    const isStarter = starterIds.has(player.id);
    const isCallup = usedCallupIds.has(player.id);
    return (
      (isRequired && !isStarter ? 1_000_000 : 0) +
      (isRequired ? 250_000 : 0) +
      (!isStarter ? 100_000 : 0) -
      (isCallup ? 200_000 : 0) +
      roleScore(player, group)
    );
  });
  quarters.push(lineupFromFormation(1, q1Formation, allSelections, starters.gk, playCounts, quarterLimits));

  quarters.push(lineupFromFormation(2, bestFormation, allSelections, starters.gk, playCounts, quarterLimits));

  const q3Formation = pickFormation(rosterPlayers, (player, group) => {
    const current = playCounts.get(player.id) ?? 0;
    const isRequired = requiredIds.has(player.id);
    const isStarter = starterIds.has(player.id);
    const isCallup = usedCallupIds.has(player.id);
    const target = targetFor(player.id, quarterLimits);
    const finalWithoutQ3 = current + (isStarter ? 1 : 0);
    const targetShortfall = Math.max(0, target - finalWithoutQ3);
    const targetOverflow = Math.max(0, current - target);

    return (
      (isRequired && current === 0 ? 2_000_000 : 0) +
      (isRequired && current < 2 ? 1_000_000 : 0) +
      (isRequired && !isStarter && current < 2 ? 500_000 : 0) +
      (isRequired ? 250_000 : 0) -
      (isCallup && finalWithoutQ3 >= 2 ? 250_000 : 0) +
      targetShortfall * 50_000 -
      targetOverflow * 50_000 +
      roleScore(player, group)
    );
  });
  quarters.push(lineupFromFormation(3, q3Formation, allSelections, starters.gk, playCounts, quarterLimits));

  const playCountsBeforeFourth = new Map(playCounts);
  const q4RotateFormation = pickFormation(rosterPlayers, (player, group) => {
    const current = playCountsBeforeFourth.get(player.id) ?? 0;
    const isRequired = requiredIds.has(player.id);
    const isStarter = starterIds.has(player.id);
    const isCallup = usedCallupIds.has(player.id);
    const target = targetFor(player.id, quarterLimits);
    const needsSecond = isRequired && current < 2;
    const needsTarget = isRequired && current < target;
    const alreadyEnough = current >= target;

    return (
      (needsSecond ? 2_000_000 : 0) +
      (needsTarget ? 700_000 : 0) +
      (isRequired ? 250_000 : 0) +
      (isStarter ? 120_000 : 0) -
      (isCallup && current >= 2 ? 250_000 : 0) -
      (alreadyEnough ? 60_000 : 0) +
      roleScore(player, group)
    );
  });
  const keepLineup = lineupFromFormation(4, bestFormation, allSelections, starters.gk, playCountsBeforeFourth, quarterLimits, false);
  const rotateLineup = lineupFromFormation(4, q4RotateFormation, allSelections, starters.gk, playCountsBeforeFourth, quarterLimits, false);
  const rotateSwaps = buildSwapSuggestions(bestFormation, q4RotateFormation, playCountsBeforeFourth);

  quarters.push(lineupFromFormation(4, bestFormation, allSelections, starters.gk, playCounts, quarterLimits));

  const requestedSlots = allSelections.reduce((total, item) => total + targetFor(item.player.id, quarterLimits), 0);
  if (requestedSlots > MATCH_FIELD_SLOTS_TOTAL) {
    warnings.push(`출전 쿼터 목표가 총 ${requestedSlots}칸이라 실제 배정 가능한 ${MATCH_FIELD_SLOTS_TOTAL}칸보다 많습니다. 일부 선수는 목표보다 적게 배정됩니다.`);
  } else if (requestedSlots < MATCH_FIELD_SLOTS_TOTAL) {
    warnings.push(`출전 쿼터 목표가 총 ${requestedSlots}칸이라 실제 필요한 ${MATCH_FIELD_SLOTS_TOTAL}칸보다 적습니다. 일부 선수는 목표보다 더 뛰게 됩니다.`);
  }

  const playerSummaries = buildPlayerSummaries(allSelections, starterIds, usedCallupIds, requiredIds, quarters, quarterLimits);
  const requiredSummaries = playerSummaries.filter((summary) => summary.isRequired);
  const requiredWithoutFirstByQ3 = requiredSummaries.filter((summary) => !summary.quarters.some((quarter) => quarter <= 3));
  const requiredUnderTwoByQ3 = requiredSummaries.filter((summary) => summary.quarters.filter((quarter) => quarter <= 3).length < 2);
  const coveredByQ3Names = requiredSummaries
    .filter((summary) => summary.quarters.filter((quarter) => quarter <= 3).length >= 2)
    .map((summary) => summary.playerName);
  if (requiredWithoutFirstByQ3.length > 0) {
    warnings.push(`3Q까지 첫 출전을 못 채운 정규 참석자: ${requiredWithoutFirstByQ3.map((summary) => summary.playerName).join(", ")}`);
  } else if (requiredUnderTwoByQ3.length > 0) {
    notes.push(`3Q까지 1Q만 뛴 정규 참석자: ${requiredUnderTwoByQ3.map((summary) => summary.playerName).join(", ")}. 지고 있지 않다면 4Q에 이 선수들을 먼저 보강하세요.`);
  }

  const operation: MatchOperationPlan = {
    keepLineup,
    rotateLineup,
    rotateSwaps,
    q4PriorityNames: requiredUnderTwoByQ3.map((summary) => summary.playerName),
    coveredByQ3Names,
    callupUsedNames: usedCallupSelections.map((item) => item.player.name),
    callupUnusedNames: unusedCallups.map((player) => player.name),
  };

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
  if (weakGroups.length > 0) warnings.push(`일부 포지션은 전력 우선으로 변경 배정했습니다: ${weakGroups.join(", ")}`);

  return { starters, quarters, bench, playerSummaries, warnings, notes, operation };
}
