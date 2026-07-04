import type { AssignedPlayer, FieldPosition, Player, PositionGroup } from "@/types/player";
import type { PlayerRelation, TeamRelationViolation } from "@/types/relation";
import type { Team, TeamBalanceResult, TeamBalanceSummary } from "@/types/team";
import { formatTeamName } from "@/lib/teamLabels";
import { effectiveActivityScore } from "@/lib/injury";
import { isMultiPositionPlayer } from "@/lib/multiPosition";
import { getPositionGroup, hasGroup, scoreForGroup } from "./positions";

const POSITION_GROUPS: PositionGroup[] = ["ATTACK", "MID", "DEFENSE"];
const PAIRING_GROUP_ORDER: PositionGroup[] = ["DEFENSE", "MID", "ATTACK"];
const MIN_TEAM_SIZE = 11;
const MAX_TEAM_SIZE = 18;
const PAIR_FLIP_MAX_ROUNDS = 30;
const STRONG_RESERVE_PER_TEAM = 2;
const MISMATCH_PENALTY = 1.5;
const MULTI_POSITION_BALANCE_PENALTY = 16;
const DEFAULT_QUARTER_TARGET = 3;
const QUARTER_BALANCE_PENALTY = 12;
const RELATION_PENALTY: Record<PlayerRelation["score"], number> = {
  1: 1000,
  2: 80,
};

export type TeamBalanceOptions = {
  quarterTargets?: Record<string, number>;
  dualTeamPlayerIds?: string[];
};

type FieldPlayer = Player & { primaryPosition: FieldPosition };
type AssignedFieldPlayer = AssignedPlayer & { primaryPosition: FieldPosition };
type RoleTargets = Record<PositionGroup, number>;

function isFieldPlayer(player: Player): player is FieldPlayer {
  return player.primaryPosition !== "GK";
}

function quarterTargetFor(id: string, options: TeamBalanceOptions = {}): number {
  return Math.max(1, Math.min(4, Math.round(options.quarterTargets?.[id] ?? DEFAULT_QUARTER_TARGET)));
}

function isDualTeamPlayer(id: string, options: TeamBalanceOptions = {}): boolean {
  return options.dualTeamPlayerIds?.includes(id) ?? false;
}

function ownQuarterWeight(player: { id: string }, options: TeamBalanceOptions = {}): number {
  if (isDualTeamPlayer(player.id, options)) return 1 / DEFAULT_QUARTER_TARGET;
  return quarterTargetFor(player.id, options) / DEFAULT_QUARTER_TARGET;
}

function virtualQuarterWeight(player: { id: string }, options: TeamBalanceOptions = {}): number {
  return isDualTeamPlayer(player.id, options) ? 1 / DEFAULT_QUARTER_TARGET : 0;
}

function playerQuarterContribution(player: { id: string }, options: TeamBalanceOptions = {}): number {
  return isDualTeamPlayer(player.id, options) ? 1 : quarterTargetFor(player.id, options);
}

function targetForTeamSize(size: number): RoleTargets {
  const attack = Math.max(2, Math.round(size * 0.31));
  const mid = Math.max(2, Math.round(size * 0.31));
  const defense = Math.max(3, size - attack - mid);
  return { ATTACK: attack, MID: mid, DEFENSE: defense };
}

function compositeScore(player: FieldPlayer): number {
  return player.attackScore + player.midScore + player.defenseScore + effectiveActivityScore(player);
}

function primaryRank(player: FieldPlayer, group: PositionGroup): number {
  const primary = getPositionGroup(player.primaryPosition);
  if (group === primary) return 0;
  if (hasGroup(player.secondaryPositions, group)) return 1;
  return 2;
}

function assignmentReason(player: FieldPlayer, group: PositionGroup): string {
  const primaryGroup = getPositionGroup(player.primaryPosition);
  if (primaryGroup === group) return "주포지션 그룹 배정";
  if (hasGroup(player.secondaryPositions, group)) return "부포지션 그룹 배정";
  return "인원 균형을 위한 포지션 변경";
}

function comparePlayersForPair(group: PositionGroup, a: FieldPlayer, b: FieldPlayer): number {
  const posDiff = scoreForGroup(group, b) - scoreForGroup(group, a);
  if (posDiff !== 0) return posDiff;
  const actDiff = effectiveActivityScore(b) - effectiveActivityScore(a);
  if (actDiff !== 0) return actDiff;
  const compositeDiff = compositeScore(b) - compositeScore(a);
  if (compositeDiff !== 0) return compositeDiff;
  return a.name.localeCompare(b.name, "ko");
}

function compareForMidPool(a: FieldPlayer, b: FieldPlayer): number {
  if (b.midScore !== a.midScore) return b.midScore - a.midScore;
  const activityDiff = effectiveActivityScore(b) - effectiveActivityScore(a);
  if (activityDiff !== 0) return activityDiff;
  const aMaxOther = Math.max(a.attackScore, a.defenseScore);
  const bMaxOther = Math.max(b.attackScore, b.defenseScore);
  if (aMaxOther !== bMaxOther) return aMaxOther - bMaxOther;
  if (compositeScore(b) !== compositeScore(a)) return compositeScore(b) - compositeScore(a);
  return a.name.localeCompare(b.name, "ko");
}

function compareForStrongPool(group: PositionGroup, a: FieldPlayer, b: FieldPlayer): number {
  const posDiff = scoreForGroup(group, b) - scoreForGroup(group, a);
  if (posDiff !== 0) return posDiff;
  const actDiff = effectiveActivityScore(b) - effectiveActivityScore(a);
  if (actDiff !== 0) return actDiff;
  const aRank = primaryRank(a, group);
  const bRank = primaryRank(b, group);
  if (aRank !== bRank) return aRank - bRank;
  if (compositeScore(b) !== compositeScore(a)) return compositeScore(b) - compositeScore(a);
  return a.name.localeCompare(b.name, "ko");
}

function pairCostByGroup(
  teamA: FieldPlayer[],
  teamB: FieldPlayer[],
  groupOf: Map<string, PositionGroup>,
  relations: PlayerRelation[] = [],
  options: TeamBalanceOptions = {},
): number {
  const sumByGroup = (
    ownTeam: FieldPlayer[],
    otherTeam: FieldPlayer[],
    group: PositionGroup,
    fn: (p: FieldPlayer) => number,
  ) => {
    const own = ownTeam
      .filter((p) => groupOf.get(p.id) === group)
      .reduce((acc, p) => acc + fn(p) * ownQuarterWeight(p, options), 0);
    const shared = otherTeam
      .filter((p) => groupOf.get(p.id) === group)
      .reduce((acc, p) => acc + fn(p) * virtualQuarterWeight(p, options), 0);
    return own + shared;
  };
  const sumActivity = (ownTeam: FieldPlayer[], otherTeam: FieldPlayer[]) =>
    ownTeam.reduce((acc, p) => acc + effectiveActivityScore(p) * ownQuarterWeight(p, options), 0)
    + otherTeam.reduce((acc, p) => acc + effectiveActivityScore(p) * virtualQuarterWeight(p, options), 0);
  const quarterTotal = (ownTeam: FieldPlayer[], otherTeam: FieldPlayer[]) =>
    ownTeam.reduce((acc, p) => acc + playerQuarterContribution(p, options), 0)
    + otherTeam.reduce((acc, p) => acc + (isDualTeamPlayer(p.id, options) ? 1 : 0), 0);

  const aAtt = sumByGroup(teamA, teamB, "ATTACK", (p) => p.attackScore);
  const aMid = sumByGroup(teamA, teamB, "MID", (p) => p.midScore);
  const aDef = sumByGroup(teamA, teamB, "DEFENSE", (p) => p.defenseScore);
  const aAct = sumActivity(teamA, teamB);
  const bAtt = sumByGroup(teamB, teamA, "ATTACK", (p) => p.attackScore);
  const bMid = sumByGroup(teamB, teamA, "MID", (p) => p.midScore);
  const bDef = sumByGroup(teamB, teamA, "DEFENSE", (p) => p.defenseScore);
  const bAct = sumActivity(teamB, teamA);
  const aMulti = teamA.filter(isMultiPositionPlayer).length;
  const bMulti = teamB.filter(isMultiPositionPlayer).length;
  const aQuarter = quarterTotal(teamA, teamB);
  const bQuarter = quarterTotal(teamB, teamA);
  const total = (aAtt + aMid + aDef + aAct) - (bAtt + bMid + bDef + bAct);
  return (Math.abs(aAtt - bAtt) + Math.abs(aMid - bMid) + Math.abs(aDef - bDef)) * 5
       + Math.abs(aAct - bAct) * 2
       + Math.abs(aQuarter - bQuarter) * QUARTER_BALANCE_PENALTY
       + Math.abs(aMulti - bMulti) * MULTI_POSITION_BALANCE_PENALTY
       + Math.abs(total)
       + relationPenaltyForSplit(teamA, teamB, relations);
}

type SplitResult = {
  teamA: FieldPlayer[];
  teamB: FieldPlayer[];
  partnerById: Map<string, string>;
  groupOf: Map<string, PositionGroup>;
};

function pairSplitPools(
  attPool: FieldPlayer[],
  midPool: FieldPlayer[],
  defPool: FieldPlayer[],
  relations: PlayerRelation[] = [],
  options: TeamBalanceOptions = {},
): SplitResult {
  const groupOf = new Map<string, PositionGroup>();
  attPool.forEach((p) => groupOf.set(p.id, "ATTACK"));
  midPool.forEach((p) => groupOf.set(p.id, "MID"));
  defPool.forEach((p) => groupOf.set(p.id, "DEFENSE"));

  const teamA: FieldPlayer[] = [];
  const teamB: FieldPlayer[] = [];
  const partnerById = new Map<string, string>();

  const poolsByGroup: Record<PositionGroup, FieldPlayer[]> = {
    ATTACK: attPool,
    MID: midPool,
    DEFENSE: defPool,
  };

  for (const group of PAIRING_GROUP_ORDER) {
    const pool = [...poolsByGroup[group]].sort((a, b) => comparePlayersForPair(group, a, b));

    for (let i = 0; i < pool.length; i += 2) {
      const stronger = pool[i];
      const weaker = pool[i + 1];

      if (!weaker) {
        if (teamA.length < teamB.length) {
          teamA.push(stronger);
        } else if (teamB.length < teamA.length) {
          teamB.push(stronger);
        } else {
          const costA = pairCostByGroup([...teamA, stronger], teamB, groupOf, relations, options);
          const costB = pairCostByGroup(teamA, [...teamB, stronger], groupOf, relations, options);
          if (costA <= costB) teamA.push(stronger);
          else teamB.push(stronger);
        }
        continue;
      }

      const cost1 = pairCostByGroup([...teamA, stronger], [...teamB, weaker], groupOf, relations, options);
      const cost2 = pairCostByGroup([...teamA, weaker], [...teamB, stronger], groupOf, relations, options);
      if (cost1 <= cost2) {
        teamA.push(stronger);
        teamB.push(weaker);
      } else {
        teamA.push(weaker);
        teamB.push(stronger);
      }
      partnerById.set(stronger.id, weaker.id);
      partnerById.set(weaker.id, stronger.id);
    }
  }

  return { teamA, teamB, partnerById, groupOf };
}

function relationPenaltyForSplit(teamA: Array<{ id: string }>, teamB: Array<{ id: string }>, relations: PlayerRelation[]): number {
  if (relations.length === 0) return 0;
  const teamAIds = new Set(teamA.map((p) => p.id));
  const teamBIds = new Set(teamB.map((p) => p.id));
  return relations.reduce((sum, relation) => {
    const sameA = teamAIds.has(relation.playerAId) && teamAIds.has(relation.playerBId);
    const sameB = teamBIds.has(relation.playerAId) && teamBIds.has(relation.playerBId);
    return sameA || sameB ? sum + RELATION_PENALTY[relation.score] : sum;
  }, 0);
}

function relationViolationsForTeams(
  teamA: Array<{ id: string }>,
  teamB: Array<{ id: string }>,
  relations: PlayerRelation[] = [],
): TeamRelationViolation[] {
  if (relations.length === 0) return [];
  const teamAIds = new Set(teamA.map((p) => p.id));
  const teamBIds = new Set(teamB.map((p) => p.id));
  return relations.flatMap((relation) => {
    const sameA = teamAIds.has(relation.playerAId) && teamAIds.has(relation.playerBId);
    const sameB = teamBIds.has(relation.playerAId) && teamBIds.has(relation.playerBId);
    if (!sameA && !sameB) return [];
    return [{
      playerAName: relation.playerAName,
      playerBName: relation.playerBName,
      score: relation.score,
      team: sameA ? "A" : "B",
      penalty: RELATION_PENALTY[relation.score],
    }];
  });
}

function buildAssigned(player: FieldPlayer, group: PositionGroup): AssignedFieldPlayer {
  const primaryGroup = getPositionGroup(player.primaryPosition);
  return {
    ...player,
    assignedGroup: group,
    assignmentReason: assignmentReason(player, group),
    isPositionOverride: primaryGroup !== group,
  };
}

function calcSummary(
  teamA: AssignedFieldPlayer[],
  teamB: AssignedFieldPlayer[],
  relations: PlayerRelation[] = [],
  options: TeamBalanceOptions = {},
): TeamBalanceSummary {
  const sum = (
    ownTeam: AssignedFieldPlayer[],
    otherTeam: AssignedFieldPlayer[],
    fn: (p: AssignedFieldPlayer) => number,
  ) =>
    ownTeam.reduce((acc, p) => acc + fn(p) * ownQuarterWeight(p, options), 0)
    + otherTeam.reduce((acc, p) => acc + fn(p) * virtualQuarterWeight(p, options), 0);
  const byGroup = (players: AssignedFieldPlayer[], group: PositionGroup) =>
    players.filter((p) => p.assignedGroup === group);
  const quarterTotal = (ownTeam: AssignedFieldPlayer[], otherTeam: AssignedFieldPlayer[]) =>
    ownTeam.reduce((acc, p) => acc + playerQuarterContribution(p, options), 0)
    + otherTeam.reduce((acc, p) => acc + (isDualTeamPlayer(p.id, options) ? 1 : 0), 0);

  const attackScoreA = sum(byGroup(teamA, "ATTACK"), byGroup(teamB, "ATTACK"), (p) => p.attackScore);
  const attackScoreB = sum(byGroup(teamB, "ATTACK"), byGroup(teamA, "ATTACK"), (p) => p.attackScore);
  const midScoreA = sum(byGroup(teamA, "MID"), byGroup(teamB, "MID"), (p) => p.midScore);
  const midScoreB = sum(byGroup(teamB, "MID"), byGroup(teamA, "MID"), (p) => p.midScore);
  const defenseScoreA = sum(byGroup(teamA, "DEFENSE"), byGroup(teamB, "DEFENSE"), (p) => p.defenseScore);
  const defenseScoreB = sum(byGroup(teamB, "DEFENSE"), byGroup(teamA, "DEFENSE"), (p) => p.defenseScore);
  const activityA = sum(teamA, teamB, (p) => effectiveActivityScore(p));
  const activityB = sum(teamB, teamA, (p) => effectiveActivityScore(p));
  const fieldGkA = teamA.filter((p) => p.canGk).length;
  const fieldGkB = teamB.filter((p) => p.canGk).length;
  const regularA = teamA.filter((p) => p.memberType === "REGULAR").length;
  const regularB = teamB.filter((p) => p.memberType === "REGULAR").length;
  const guestA = teamA.filter((p) => p.memberType === "GUEST").length;
  const guestB = teamB.filter((p) => p.memberType === "GUEST").length;
  const multiPositionA = teamA.filter(isMultiPositionPlayer).length;
  const multiPositionB = teamB.filter(isMultiPositionPlayer).length;
  const overrides = [...teamA, ...teamB].filter((p) => p.isPositionOverride).length;
  const relationViolations = relationViolationsForTeams(teamA, teamB, relations);
  const relationPenalty = relationViolations.reduce((acc, violation) => acc + violation.penalty, 0);
  const quarterTargetA = quarterTotal(teamA, teamB);
  const quarterTargetB = quarterTotal(teamB, teamA);
  const dualTeamA = teamA.filter((p) => isDualTeamPlayer(p.id, options)).length;
  const dualTeamB = teamB.filter((p) => isDualTeamPlayer(p.id, options)).length;

  const balanceScore =
    Math.abs(attackScoreA - attackScoreB) * 5 +
    Math.abs(midScoreA - midScoreB) * 5 +
    Math.abs(defenseScoreA - defenseScoreB) * 5 +
    Math.abs(activityA - activityB) * 2 +
    Math.abs(quarterTargetA - quarterTargetB) * QUARTER_BALANCE_PENALTY +
    Math.abs(fieldGkA - fieldGkB) * 3 +
    Math.abs(guestA - guestB) +
    Math.abs(multiPositionA - multiPositionB) * MULTI_POSITION_BALANCE_PENALTY +
    overrides * 1.5 +
    relationPenalty;

  return {
    attackScoreA,
    attackScoreB,
    midScoreA,
    midScoreB,
    defenseScoreA,
    defenseScoreB,
    activityA,
    activityB,
    fieldGkA,
    fieldGkB,
    regularA,
    regularB,
    guestA,
    guestB,
    multiPositionA,
    multiPositionB,
    relationPenalty,
    relationViolationCount: relationViolations.length,
    relationHardViolationCount: relationViolations.filter((violation) => violation.score === 1).length,
    quarterTargetA,
    quarterTargetB,
    dualTeamA,
    dualTeamB,
    balanceScore,
  };
}

function evaluatePoolAssignment(
  attPool: FieldPlayer[],
  midPool: FieldPlayer[],
  defPool: FieldPlayer[],
  relations: PlayerRelation[] = [],
  options: TeamBalanceOptions = {},
): { adjScore: number; balanceScore: number; mismatchCount: number; teamA: AssignedFieldPlayer[]; teamB: AssignedFieldPlayer[]; partnerById: Map<string, string>; summary: TeamBalanceSummary } {
  const split = pairSplitPools(attPool, midPool, defPool, relations, options);
  const teamA = split.teamA.map((p) => buildAssigned(p, split.groupOf.get(p.id)!));
  const teamB = split.teamB.map((p) => buildAssigned(p, split.groupOf.get(p.id)!));
  const summary = calcSummary(teamA, teamB, relations, options);
  const mismatchCount = [...teamA, ...teamB].filter((p) => {
    const primary = getPositionGroup(p.primaryPosition);
    return primary !== p.assignedGroup && !hasGroup(p.secondaryPositions, p.assignedGroup);
  }).length;
  const balanceScore = summary.balanceScore;
  return {
    adjScore: balanceScore + mismatchCount * MISMATCH_PENALTY,
    balanceScore,
    mismatchCount,
    teamA,
    teamB,
    partnerById: split.partnerById,
    summary,
  };
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  if (k === items.length) return [[...items]];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, k - 1).map((combo) => [first, ...combo]);
  const withoutFirst = combinations(rest, k);
  return withFirst.concat(withoutFirst);
}

function buildPools(fieldPlayers: FieldPlayer[], teamTargets: RoleTargets, variant: number, relations: PlayerRelation[] = [], options: TeamBalanceOptions = {}): {
  attPool: FieldPlayer[];
  midPool: FieldPlayer[];
  defPool: FieldPlayer[];
} {
  const totalMid = teamTargets.MID * 2;
  const totalAtt = teamTargets.ATTACK * 2;
  const totalDef = teamTargets.DEFENSE * 2;

  const midPool = [...fieldPlayers].sort(compareForMidPool).slice(0, totalMid);
  const remainingAfterMid = fieldPlayers.filter((p) => !midPool.includes(p));

  const strongDefCount = Math.max(0, (teamTargets.DEFENSE - STRONG_RESERVE_PER_TEAM) * 2);
  const strongDef = [...remainingAfterMid]
    .sort((a, b) => compareForStrongPool("DEFENSE", a, b))
    .slice(0, strongDefCount);

  const remainingAfterDef = remainingAfterMid.filter((p) => !strongDef.includes(p));

  const strongAttCount = Math.max(0, (teamTargets.ATTACK - STRONG_RESERVE_PER_TEAM) * 2);
  const strongAtt = [...remainingAfterDef]
    .sort((a, b) => compareForStrongPool("ATTACK", a, b))
    .slice(0, strongAttCount);

  const lastN = remainingAfterDef.filter((p) => !strongAtt.includes(p));
  const lastAttCount = totalAtt - strongAttCount;
  const lastDefCount = totalDef - strongDefCount;

  const attPickCount = Math.min(lastAttCount, lastN.length);
  if (attPickCount > 0 && lastN.length > 0) {
    const candidates: { adjScore: number; att: FieldPlayer[]; def: FieldPlayer[]; key: string }[] = [];
    for (const lastAttCombo of combinations(lastN, attPickCount)) {
      const attCandidate = [...strongAtt, ...lastAttCombo];
      const defCandidate = [...strongDef, ...lastN.filter((p) => !lastAttCombo.includes(p))];
      const result = evaluatePoolAssignment(attCandidate, midPool, defCandidate, relations, options);
      const key = [...attCandidate.map((p) => p.id).sort(), "|", ...defCandidate.map((p) => p.id).sort()].join(",");
      candidates.push({ adjScore: result.adjScore, att: attCandidate, def: defCandidate, key });
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        if (a.adjScore !== b.adjScore) return a.adjScore - b.adjScore;
        return a.key.localeCompare(b.key);
      });
      const pick = candidates[((variant % candidates.length) + candidates.length) % candidates.length];
      return { attPool: pick.att, midPool, defPool: pick.def };
    }
  }

  const bestAtt = [...strongAtt, ...lastN.slice(0, lastAttCount)];
  const bestDef = [...strongDef, ...lastN.slice(lastAttCount)];
  return { attPool: bestAtt, midPool, defPool: bestDef };
}

function refineByPairFlip(
  teamA: AssignedFieldPlayer[],
  teamB: AssignedFieldPlayer[],
  partnerById: Map<string, string>,
  relations: PlayerRelation[] = [],
  options: TeamBalanceOptions = {},
): { teamA: AssignedFieldPlayer[]; teamB: AssignedFieldPlayer[]; summary: TeamBalanceSummary } {
  const a = [...teamA];
  const b = [...teamB];
  let summary = calcSummary(a, b, relations, options);

  for (let round = 0; round < PAIR_FLIP_MAX_ROUNDS; round += 1) {
    let bestImprovement = 0;
    let bestFlip: { aIndex: number; bIndex: number } | null = null;
    const visited = new Set<string>();

    for (let i = 0; i < a.length; i += 1) {
      const player = a[i];
      const partnerId = partnerById.get(player.id);
      if (!partnerId || visited.has(player.id)) continue;
      const j = b.findIndex((other) => other.id === partnerId);
      if (j < 0) continue;
      visited.add(player.id);
      visited.add(partnerId);

      const trialA = [...a];
      const trialB = [...b];
      const movingFromA = a[i];
      const movingFromB = b[j];
      trialA[i] = { ...movingFromB, assignedGroup: movingFromA.assignedGroup, assignmentReason: assignmentReason(movingFromB, movingFromA.assignedGroup), isPositionOverride: getPositionGroup(movingFromB.primaryPosition) !== movingFromA.assignedGroup };
      trialB[j] = { ...movingFromA, assignedGroup: movingFromB.assignedGroup, assignmentReason: assignmentReason(movingFromA, movingFromB.assignedGroup), isPositionOverride: getPositionGroup(movingFromA.primaryPosition) !== movingFromB.assignedGroup };
      const trialSummary = calcSummary(trialA, trialB, relations, options);
      const improvement = summary.balanceScore - trialSummary.balanceScore;
      if (improvement > bestImprovement) {
        bestImprovement = improvement;
        bestFlip = { aIndex: i, bIndex: j };
      }
    }

    if (!bestFlip) break;
    const { aIndex, bIndex } = bestFlip;
    const movingFromA = a[aIndex];
    const movingFromB = b[bIndex];
    a[aIndex] = { ...movingFromB, assignedGroup: movingFromA.assignedGroup, assignmentReason: assignmentReason(movingFromB, movingFromA.assignedGroup), isPositionOverride: getPositionGroup(movingFromB.primaryPosition) !== movingFromA.assignedGroup };
    b[bIndex] = { ...movingFromA, assignedGroup: movingFromB.assignedGroup, assignmentReason: assignmentReason(movingFromA, movingFromB.assignedGroup), isPositionOverride: getPositionGroup(movingFromA.primaryPosition) !== movingFromB.assignedGroup };
    summary = calcSummary(a, b, relations, options);
  }

  return { teamA: a, teamB: b, summary };
}

function buildResult(
  teamA: AssignedFieldPlayer[],
  teamB: AssignedFieldPlayer[],
  summary: TeamBalanceSummary,
  relations: PlayerRelation[] = [],
): TeamBalanceResult {
  const warnings: string[] = [];
  const relationViolations = relationViolationsForTeams(teamA, teamB, relations);
  const overrides = [...teamA, ...teamB].filter((p) => p.isPositionOverride);
  if (overrides.length >= 6) warnings.push(`포지션 변경자가 ${overrides.length}명입니다. 역할 배정이 다소 억지일 수 있습니다.`);
  if (summary.fieldGkA === 0 || summary.fieldGkB === 0) warnings.push("한 팀에 필드 GK 가능자가 없습니다. 전담 GK가 없거나 부족하면 문제가 될 수 있습니다.");
  if (Math.abs(summary.activityA - summary.activityB) >= 8) warnings.push("팀별 활동량 차이가 큽니다.");
  if (Math.abs(summary.quarterTargetA - summary.quarterTargetB) >= 3) warnings.push(`팀별 목표 출전 쿼터 차이가 큽니다: ${formatTeamName("A")} ${summary.quarterTargetA}Q / ${formatTeamName("B")} ${summary.quarterTargetB}Q`);
  if (Math.abs(summary.guestA - summary.guestB) >= 5) warnings.push("정규 선수와 용병 비율이 한쪽으로 몰렸습니다.");
  if (Math.abs(summary.multiPositionA - summary.multiPositionB) >= 2) warnings.push("멀티포지션 선수가 한쪽으로 몰렸습니다.");
  const hardViolations = relationViolations.filter((violation) => violation.score === 1);
  if (hardViolations.length > 0) {
    warnings.push(`궁합도 1점 분리 우선 조합이 같은 팀에 있습니다: ${hardViolations.map((violation) => `${formatTeamName(violation.team)} ${violation.playerAName}/${violation.playerBName}`).join(", ")}`);
  }

  const quality: TeamBalanceResult["quality"] = warnings.length === 0 ? "좋음" : warnings.length <= 2 ? "주의" : "나쁨";

  return {
    teamA: { name: "A", players: teamA },
    teamB: { name: "B", players: teamB },
    summary,
    relationViolations,
    warnings,
    quality,
  };
}

export function balanceTeams(players: Player[], variant = 0, relations: PlayerRelation[] = [], options: TeamBalanceOptions = {}): TeamBalanceResult {
  if (players.length < MIN_TEAM_SIZE * 2 || players.length > MAX_TEAM_SIZE * 2) {
    throw new Error(`필드 참석자는 ${MIN_TEAM_SIZE * 2}명~${MAX_TEAM_SIZE * 2}명이어야 합니다. 현재 ${players.length}명입니다.`);
  }

  const gkPlayers = players.filter((p) => p.primaryPosition === "GK");
  if (gkPlayers.length > 0) {
    throw new Error(`GK는 필드 참석자에 포함할 수 없습니다: ${gkPlayers.map((p) => p.name).join(", ")}`);
  }

  const fieldPlayers = players.filter(isFieldPlayer);
  const halfSize = Math.ceil(fieldPlayers.length / 2);
  const teamTargets = targetForTeamSize(halfSize);

  const { attPool, midPool, defPool } = buildPools(fieldPlayers, teamTargets, variant, relations, options);
  const initial = evaluatePoolAssignment(attPool, midPool, defPool, relations, options);

  if (initial.teamA.length < MIN_TEAM_SIZE || initial.teamA.length > MAX_TEAM_SIZE
      || initial.teamB.length < MIN_TEAM_SIZE || initial.teamB.length > MAX_TEAM_SIZE) {
    throw new Error(`한 팀은 ${MIN_TEAM_SIZE}명~${MAX_TEAM_SIZE}명이어야 합니다. 현재 ${formatTeamName("A")} ${initial.teamA.length}명, ${formatTeamName("B")} ${initial.teamB.length}명입니다.`);
  }

  const refined = refineByPairFlip(initial.teamA, initial.teamB, initial.partnerById, relations, options);
  return buildResult(refined.teamA, refined.teamB, refined.summary, relations);
}

export function rebalanceTeams(teamAPlayers: Player[], teamBPlayers: Player[], variant = 0, relations: PlayerRelation[] = [], options: TeamBalanceOptions = {}): TeamBalanceResult {
  return balanceTeams([...teamAPlayers, ...teamBPlayers], variant, relations, options);
}

export function balanceTeamsVariants(players: Player[], maxVariants = 10, relations: PlayerRelation[] = [], options: TeamBalanceOptions = {}): TeamBalanceResult[] {
  const results: TeamBalanceResult[] = [];
  const seen = new Set<string>();
  const probe = Math.max(maxVariants * 10, 100);
  for (let v = 0; v < probe && results.length < maxVariants; v += 1) {
    let r: TeamBalanceResult;
    try {
      r = balanceTeams(players, v, relations, options);
    } catch {
      if (results.length === 0) throw new Error("팀 분배 실패");
      break;
    }
    const aIds = r.teamA.players.map((p) => p.id).sort().join(",");
    const bIds = r.teamB.players.map((p) => p.id).sort().join(",");
    const key = aIds < bIds ? `${aIds}|${bIds}` : `${bIds}|${aIds}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(r);
  }
  if (results.length === 0) throw new Error("팀 분배 실패");
  return results;
}

export function summarizeTeams(teamAPlayers: AssignedPlayer[], teamBPlayers: AssignedPlayer[], relations: PlayerRelation[] = [], options: TeamBalanceOptions = {}): TeamBalanceResult {
  const a = teamAPlayers as AssignedFieldPlayer[];
  const b = teamBPlayers as AssignedFieldPlayer[];
  const summary = calcSummary(a, b, relations, options);
  return buildResult(a, b, summary, relations);
}

export function playersByGroup(team: Team, group: PositionGroup): AssignedPlayer[] {
  return team.players.filter((player) => player.assignedGroup === group);
}
