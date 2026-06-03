import type { AssignedPlayer, AssignedSubRole, FieldPosition, Player, PositionGroup } from "@/types/player";
import type { PlayerRelation, TeamRelationViolation } from "@/types/relation";
import type { Team, TeamBalanceResult, TeamBalanceSummary } from "@/types/team";
import { formatTeamName } from "@/lib/teamLabels";
import { effectiveActivityScore } from "@/lib/injury";
import { isMultiPositionPlayer } from "@/lib/multiPosition";
import { centerBackScore, centerForwardScore, detailedTechnicalTotal, wingBackScore, wingScore } from "@/lib/playerScores";
import { extractStaffRole } from "@/lib/staffRoles";
import { getPositionGroup, hasGroup, scoreForGroup } from "./positions";

const POSITION_GROUPS: PositionGroup[] = ["ATTACK", "MID", "DEFENSE"];
const PAIRING_GROUP_ORDER: PositionGroup[] = ["DEFENSE", "MID", "ATTACK"];
const MIN_TEAM_SIZE = 11;
const MAX_TEAM_SIZE = 18;
const PAIR_FLIP_MAX_ROUNDS = 30;
const STRONG_RESERVE_PER_TEAM = 2;
const ROLE_VARIANT_WINDOW = 6;
const ROLE_VARIANT_MAX_SWAPS = 2;
const MISMATCH_PENALTY = 1.5;
const OFF_BEST_GROUP_GAP_THRESHOLD = 5;
const OFF_BEST_GROUP_SOFT_PENALTY = 18;
const OFF_BEST_GROUP_HARD_PENALTY = 160;
const PROFILE_OVERLAP_MIN_SCORE = 7;
const PROFILE_OVERLAP_BASELINE = 14;
const PROFILE_STACK_VARIANT_WEIGHT = 6;
const MULTI_POSITION_BALANCE_PENALTY = 16;
const COACH_BALANCE_PENALTY = 80;
const VARIANT_TOTAL_DIFF_TOLERANCE = 2;
const FIELD_PLAYERS_PER_QUARTER = 11;
const MATCH_QUARTERS = 4;
const RELATION_PENALTY: Record<PlayerRelation["score"], number> = {
  1: 1000,
  2: 80,
};

type FieldPlayer = Player & { primaryPosition: FieldPosition };
type AssignedFieldPlayer = AssignedPlayer & { primaryPosition: FieldPosition };
type RoleTargets = Record<PositionGroup, number>;
type SubRoleScores = {
  centerForward: number;
  wing: number;
  attack: number;
  mid: number;
  centerBack: number;
  wingBack: number;
  defense: number;
};
type QuarterCounts = Record<1 | 2 | 3 | 4, number>;
type RotationProjection = {
  adjustedTotal: number;
  quarterCounts: QuarterCounts;
};

function isFieldPlayer(player: Player): player is FieldPlayer {
  return player.primaryPosition !== "GK";
}

function targetForTeamSize(size: number): RoleTargets {
  const attack = Math.max(2, Math.round(size * 0.31));
  const mid = Math.max(2, Math.round(size * 0.31));
  const defense = Math.max(3, size - attack - mid);
  return { ATTACK: attack, MID: mid, DEFENSE: defense };
}

function compositeScore(player: FieldPlayer): number {
  return detailedTechnicalTotal(player) + effectiveActivityScore(player);
}

function isCoach(player: Pick<Player, "memo">): boolean {
  return extractStaffRole(player.memo) === "코치";
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
  const rankDiff = groupFitRank(a, "MID") - groupFitRank(b, "MID");
  if (rankDiff !== 0) return rankDiff;
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
  const aFitRank = groupFitRank(a, group);
  const bFitRank = groupFitRank(b, group);
  const forcedRankDiff = (aFitRank >= 4 ? 1 : 0) - (bFitRank >= 4 ? 1 : 0);
  if (forcedRankDiff !== 0) return forcedRankDiff;
  const posDiff = scoreForGroup(group, b) - scoreForGroup(group, a);
  if (posDiff !== 0) return posDiff;
  if (aFitRank !== bFitRank) return aFitRank - bFitRank;
  const gapDiff = offBestGroupGap(a, group) - offBestGroupGap(b, group);
  if (gapDiff !== 0) return gapDiff;
  const actDiff = effectiveActivityScore(b) - effectiveActivityScore(a);
  if (actDiff !== 0) return actDiff;
  const aRank = primaryRank(a, group);
  const bRank = primaryRank(b, group);
  if (aRank !== bRank) return aRank - bRank;
  if (compositeScore(b) !== compositeScore(a)) return compositeScore(b) - compositeScore(a);
  return a.name.localeCompare(b.name, "ko");
}

function subRoleScore(player: Pick<Player, "centerForwardScore" | "wingScore" | "midScore" | "centerBackScore" | "wingBackScore" | "attackScore" | "defenseScore">, role: AssignedSubRole): number {
  if (role === "CF") return centerForwardScore(player);
  if (role === "WING") return wingScore(player);
  if (role === "MID") return player.midScore;
  if (role === "CB") return centerBackScore(player);
  return wingBackScore(player);
}

function bestSubRoleScore(player: FieldPlayer | AssignedFieldPlayer, group: PositionGroup): number {
  if (group === "ATTACK") return Math.max(centerForwardScore(player), wingScore(player));
  if (group === "DEFENSE") return Math.max(centerBackScore(player), wingBackScore(player));
  return player.midScore;
}

function bestScoringGroup(player: FieldPlayer): PositionGroup {
  return POSITION_GROUPS.reduce((best, group) => {
    const bestScore = scoreForGroup(best, player);
    const groupScore = scoreForGroup(group, player);
    if (groupScore !== bestScore) return groupScore > bestScore ? group : best;

    const bestRank = primaryRank(player, best);
    const groupRank = primaryRank(player, group);
    if (groupRank !== bestRank) return groupRank < bestRank ? group : best;

    return best;
  }, POSITION_GROUPS[0]);
}

function offBestGroupGap(player: FieldPlayer, group: PositionGroup): number {
  const bestScore = scoreForGroup(bestScoringGroup(player), player);
  return Math.max(0, bestScore - scoreForGroup(group, player));
}

function offBestGroupPenalty(player: FieldPlayer, group: PositionGroup): number {
  const gap = offBestGroupGap(player, group);
  if (gap <= 0) return 0;
  const hardPenalty = gap >= OFF_BEST_GROUP_GAP_THRESHOLD ? OFF_BEST_GROUP_HARD_PENALTY : 0;
  return hardPenalty + gap * OFF_BEST_GROUP_SOFT_PENALTY;
}

function groupFitRank(player: FieldPlayer, group: PositionGroup): number {
  const primary = getPositionGroup(player.primaryPosition);
  if (primary === group) return 0;
  if (hasGroup(player.secondaryPositions, group)) return 1;
  if (scoreForGroup(group, player) >= 7 && offBestGroupGap(player, group) < OFF_BEST_GROUP_GAP_THRESHOLD) return 2;
  if (offBestGroupGap(player, group) < OFF_BEST_GROUP_GAP_THRESHOLD) return 3;
  return 4;
}

function assignmentFitPenalty(players: AssignedFieldPlayer[]): number {
  return players.reduce((sum, player) => sum + offBestGroupPenalty(player, player.assignedGroup), 0);
}

function subRoleTargets(group: "ATTACK" | "DEFENSE", count: number): { firstRole: AssignedSubRole; firstCount: number; secondRole: AssignedSubRole } {
  if (group === "ATTACK") {
    const centerForwardCount = Math.max(1, Math.min(count, Math.round(count * 0.35)));
    return { firstRole: "CF", firstCount: centerForwardCount, secondRole: "WING" };
  }

  const wingBackCount = Math.max(1, Math.min(count - 1, Math.round(count * 0.4)));
  return { firstRole: "WB", firstCount: wingBackCount, secondRole: "CB" };
}

function assignGroupSubRoles<T extends (FieldPlayer | AssignedFieldPlayer) & { assignedGroup: PositionGroup }>(
  players: T[],
  group: "ATTACK" | "DEFENSE",
): Array<T & { assignedSubRole: AssignedSubRole }> {
  if (players.length === 0) return [];
  if (players.length === 1) {
    const role = group === "ATTACK"
      ? centerForwardScore(players[0]) >= wingScore(players[0]) ? "CF" : "WING"
      : centerBackScore(players[0]) >= wingBackScore(players[0]) ? "CB" : "WB";
    return [{ ...players[0], assignedSubRole: role }];
  }

  const { firstRole, firstCount, secondRole } = subRoleTargets(group, players.length);
  const firstRoleIds = new Set(
    [...players]
      .sort((a, b) => {
        const aDelta = subRoleScore(a, firstRole) - subRoleScore(a, secondRole);
        const bDelta = subRoleScore(b, firstRole) - subRoleScore(b, secondRole);
        if (aDelta !== bDelta) return bDelta - aDelta;
        const firstRoleScoreDiff = subRoleScore(b, firstRole) - subRoleScore(a, firstRole);
        if (firstRoleScoreDiff !== 0) return firstRoleScoreDiff;
        const bestScoreDiff = bestSubRoleScore(b, group) - bestSubRoleScore(a, group);
        if (bestScoreDiff !== 0) return bestScoreDiff;
        return a.name.localeCompare(b.name, "ko");
      })
      .slice(0, firstCount)
      .map((player) => player.id),
  );

  return players.map((player) => ({
    ...player,
    assignedSubRole: firstRoleIds.has(player.id) ? firstRole : secondRole,
  }));
}

function assignDetailedSubRoles<T extends (FieldPlayer | AssignedFieldPlayer) & { assignedGroup: PositionGroup }>(players: T[]): Array<T & { assignedSubRole: AssignedSubRole }> {
  const attackers = assignGroupSubRoles(players.filter((player) => player.assignedGroup === "ATTACK"), "ATTACK");
  const mids = players
    .filter((player) => player.assignedGroup === "MID")
    .map((player) => ({ ...player, assignedSubRole: "MID" as const }));
  const defenders = assignGroupSubRoles(players.filter((player) => player.assignedGroup === "DEFENSE"), "DEFENSE");
  const byId = new Map([...attackers, ...mids, ...defenders].map((player) => [player.id, player]));
  return players.map((player) => byId.get(player.id) ?? { ...player, assignedSubRole: "MID" as const });
}

function subRoleScores(players: Array<FieldPlayer & { assignedGroup: PositionGroup }>): SubRoleScores {
  const assigned = assignDetailedSubRoles(players);
  return assigned.reduce<SubRoleScores>((scores, player) => {
    if (player.assignedSubRole === "CF") {
      scores.centerForward += centerForwardScore(player);
      scores.attack += centerForwardScore(player);
    } else if (player.assignedSubRole === "WING") {
      scores.wing += wingScore(player);
      scores.attack += wingScore(player);
    } else if (player.assignedSubRole === "MID") {
      scores.mid += player.midScore;
    } else if (player.assignedSubRole === "CB") {
      scores.centerBack += centerBackScore(player);
      scores.defense += centerBackScore(player);
    } else {
      scores.wingBack += wingBackScore(player);
      scores.defense += wingBackScore(player);
    }
    return scores;
  }, { centerForward: 0, wing: 0, attack: 0, mid: 0, centerBack: 0, wingBack: 0, defense: 0 });
}

function assignedPlayerImpact(player: FieldPlayer & { assignedSubRole: AssignedSubRole }): number {
  return subRoleScore(player, player.assignedSubRole) + effectiveActivityScore(player);
}

function projectRotationTotal(players: Array<FieldPlayer & { assignedGroup: PositionGroup }>): RotationProjection {
  const count = players.length;
  const quarterCounts: QuarterCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  if (count === 0) return { adjustedTotal: 0, quarterCounts };

  const totalSlots = Math.min(count * MATCH_QUARTERS, FIELD_PLAYERS_PER_QUARTER * MATCH_QUARTERS);
  const baseQuarters = Math.floor(totalSlots / count);
  const bonusPlayers = totalSlots - baseQuarters * count;
  const assigned = assignDetailedSubRoles(players).sort((a, b) => {
    const impactDiff = assignedPlayerImpact(b) - assignedPlayerImpact(a);
    if (impactDiff !== 0) return impactDiff;
    return a.name.localeCompare(b.name, "ko");
  });

  const adjustedTotal = assigned.reduce((total, player, index) => {
    const quarters = Math.min(MATCH_QUARTERS, baseQuarters + (index < bonusPlayers ? 1 : 0)) as 1 | 2 | 3 | 4;
    quarterCounts[quarters] += 1;
    return total + assignedPlayerImpact(player) * (quarters / MATCH_QUARTERS);
  }, 0);

  return { adjustedTotal, quarterCounts };
}

function pairCostByGroup(
  teamA: FieldPlayer[],
  teamB: FieldPlayer[],
  groupOf: Map<string, PositionGroup>,
  relations: PlayerRelation[] = [],
): number {
  const withGroups = (team: FieldPlayer[]) => team.map((player) => ({ ...player, assignedGroup: groupOf.get(player.id)! }));
  const aScores = subRoleScores(withGroups(teamA));
  const bScores = subRoleScores(withGroups(teamB));
  const aAct = teamA.reduce((acc, p) => acc + effectiveActivityScore(p), 0);
  const bAct = teamB.reduce((acc, p) => acc + effectiveActivityScore(p), 0);
  const aCoach = teamA.filter(isCoach).length;
  const bCoach = teamB.filter(isCoach).length;
  const aMulti = teamA.filter(isMultiPositionPlayer).length;
  const bMulti = teamB.filter(isMultiPositionPlayer).length;
  const rawTotalA = aScores.attack + aScores.mid + aScores.defense + aAct;
  const rawTotalB = bScores.attack + bScores.mid + bScores.defense + bAct;
  const totalDiff = teamA.length === teamB.length
    ? Math.abs(rawTotalA - rawTotalB)
    : Math.abs(projectRotationTotal(withGroups(teamA)).adjustedTotal - projectRotationTotal(withGroups(teamB)).adjustedTotal);
  return (Math.abs(aScores.centerForward - bScores.centerForward)
       + Math.abs(aScores.wing - bScores.wing)
       + Math.abs(aScores.mid - bScores.mid)
       + Math.abs(aScores.centerBack - bScores.centerBack)
       + Math.abs(aScores.wingBack - bScores.wingBack)) * 5
       + Math.abs(aAct - bAct) * 2
       + Math.abs(aCoach - bCoach) * COACH_BALANCE_PENALTY
       + Math.abs(aMulti - bMulti) * MULTI_POSITION_BALANCE_PENALTY
       + totalDiff
       + relationPenaltyForSplit(teamA, teamB, relations);
}

type SplitResult = {
  teamA: FieldPlayer[];
  teamB: FieldPlayer[];
  partnerById: Map<string, string>;
  groupOf: Map<string, PositionGroup>;
};

function rotateItems<T>(items: T[], offset: number): T[] {
  if (items.length === 0) return items;
  const normalized = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

function midPairingOrder(sortedMidPool: FieldPlayer[], variant: number): FieldPlayer[] {
  if (variant <= 0) return sortedMidPool;
  if (sortedMidPool.length <= 2) return sortedMidPool;

  const half = Math.ceil(sortedMidPool.length / 2);
  const adjustedVariant = variant - 1;
  const upper = rotateItems(sortedMidPool.slice(0, half), Math.floor(adjustedVariant / Math.max(1, sortedMidPool.length - half)));
  const lower = rotateItems(sortedMidPool.slice(half), adjustedVariant);
  const ordered: FieldPlayer[] = [];
  for (let index = 0; index < upper.length; index += 1) {
    ordered.push(upper[index]);
    if (lower[index]) ordered.push(lower[index]);
  }
  return ordered;
}

function pairSplitPools(
  attPool: FieldPlayer[],
  midPool: FieldPlayer[],
  defPool: FieldPlayer[],
  relations: PlayerRelation[] = [],
  variant = 0,
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
    const sortedPool = [...poolsByGroup[group]].sort((a, b) => comparePlayersForPair(group, a, b));
    const pool = group === "MID" ? midPairingOrder(sortedPool, variant) : sortedPool;

    for (let i = 0; i < pool.length; i += 2) {
      const stronger = pool[i];
      const weaker = pool[i + 1];

      if (!weaker) {
        if (teamA.length < teamB.length) {
          teamA.push(stronger);
        } else if (teamB.length < teamA.length) {
          teamB.push(stronger);
        } else {
          const costA = pairCostByGroup([...teamA, stronger], teamB, groupOf, relations);
          const costB = pairCostByGroup(teamA, [...teamB, stronger], groupOf, relations);
          if (costA <= costB) teamA.push(stronger);
          else teamB.push(stronger);
        }
        continue;
      }

      const cost1 = pairCostByGroup([...teamA, stronger], [...teamB, weaker], groupOf, relations);
      const cost2 = pairCostByGroup([...teamA, weaker], [...teamB, stronger], groupOf, relations);
      const pairIndex = Math.floor(i / 2);
      const flipTie = group === "MID" && Math.abs(cost1 - cost2) < 0.0001 && ((variant + pairIndex) % 2 === 1);
      if (cost1 < cost2 || (cost1 <= cost2 && !flipTie)) {
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
): TeamBalanceSummary {
  const sum = (players: AssignedFieldPlayer[], fn: (p: AssignedFieldPlayer) => number) =>
    players.reduce((acc, p) => acc + fn(p), 0);
  const aScores = subRoleScores(teamA);
  const bScores = subRoleScores(teamB);
  const centerForwardScoreA = aScores.centerForward;
  const centerForwardScoreB = bScores.centerForward;
  const wingScoreA = aScores.wing;
  const wingScoreB = bScores.wing;
  const attackScoreA = aScores.attack;
  const attackScoreB = bScores.attack;
  const midScoreA = aScores.mid;
  const midScoreB = bScores.mid;
  const centerBackScoreA = aScores.centerBack;
  const centerBackScoreB = bScores.centerBack;
  const wingBackScoreA = aScores.wingBack;
  const wingBackScoreB = bScores.wingBack;
  const defenseScoreA = aScores.defense;
  const defenseScoreB = bScores.defense;
  const activityA = sum(teamA, (p) => effectiveActivityScore(p));
  const activityB = sum(teamB, (p) => effectiveActivityScore(p));
  const fieldGkA = teamA.filter((p) => p.canGk).length;
  const fieldGkB = teamB.filter((p) => p.canGk).length;
  const playerCountA = teamA.length;
  const playerCountB = teamB.length;
  const regularA = teamA.filter((p) => p.memberType === "REGULAR").length;
  const regularB = teamB.filter((p) => p.memberType === "REGULAR").length;
  const guestA = teamA.filter((p) => p.memberType === "GUEST").length;
  const guestB = teamB.filter((p) => p.memberType === "GUEST").length;
  const coachA = teamA.filter(isCoach).length;
  const coachB = teamB.filter(isCoach).length;
  const multiPositionA = teamA.filter(isMultiPositionPlayer).length;
  const multiPositionB = teamB.filter(isMultiPositionPlayer).length;
  const overrides = [...teamA, ...teamB].filter((p) => p.isPositionOverride).length;
  const relationViolations = relationViolationsForTeams(teamA, teamB, relations);
  const relationPenalty = relationViolations.reduce((acc, violation) => acc + violation.penalty, 0);
  const rotationA = projectRotationTotal(teamA);
  const rotationB = projectRotationTotal(teamB);
  const rawTotalA = centerForwardScoreA + wingScoreA + midScoreA + centerBackScoreA + wingBackScoreA + activityA;
  const rawTotalB = centerForwardScoreB + wingScoreB + midScoreB + centerBackScoreB + wingBackScoreB + activityB;
  const totalDiffForBalance = playerCountA === playerCountB
    ? Math.abs(rawTotalA - rawTotalB)
    : Math.abs(rotationA.adjustedTotal - rotationB.adjustedTotal);

  const balanceScore =
    Math.abs(centerForwardScoreA - centerForwardScoreB) * 5 +
    Math.abs(wingScoreA - wingScoreB) * 5 +
    Math.abs(midScoreA - midScoreB) * 5 +
    Math.abs(centerBackScoreA - centerBackScoreB) * 5 +
    Math.abs(wingBackScoreA - wingBackScoreB) * 5 +
    Math.abs(activityA - activityB) * 2 +
    Math.abs(fieldGkA - fieldGkB) * 3 +
    Math.abs(guestA - guestB) +
    Math.abs(coachA - coachB) * COACH_BALANCE_PENALTY +
    Math.abs(multiPositionA - multiPositionB) * MULTI_POSITION_BALANCE_PENALTY +
    overrides * 1.5 +
    totalDiffForBalance * 3 +
    relationPenalty;

  return {
    centerForwardScoreA,
    centerForwardScoreB,
    wingScoreA,
    wingScoreB,
    attackScoreA,
    attackScoreB,
    midScoreA,
    midScoreB,
    centerBackScoreA,
    centerBackScoreB,
    wingBackScoreA,
    wingBackScoreB,
    defenseScoreA,
    defenseScoreB,
    activityA,
    activityB,
    fieldGkA,
    fieldGkB,
    playerCountA,
    playerCountB,
    regularA,
    regularB,
    guestA,
    guestB,
    rotationAdjustedTotalA: rotationA.adjustedTotal,
    rotationAdjustedTotalB: rotationB.adjustedTotal,
    rotationOneQuarterA: rotationA.quarterCounts[1],
    rotationOneQuarterB: rotationB.quarterCounts[1],
    rotationTwoQuarterA: rotationA.quarterCounts[2],
    rotationTwoQuarterB: rotationB.quarterCounts[2],
    rotationThreeQuarterA: rotationA.quarterCounts[3],
    rotationThreeQuarterB: rotationB.quarterCounts[3],
    rotationFourQuarterA: rotationA.quarterCounts[4],
    rotationFourQuarterB: rotationB.quarterCounts[4],
    coachA,
    coachB,
    multiPositionA,
    multiPositionB,
    relationPenalty,
    relationViolationCount: relationViolations.length,
    relationHardViolationCount: relationViolations.filter((violation) => violation.score === 1).length,
    balanceScore,
  };
}

function evaluatePoolAssignment(
  attPool: FieldPlayer[],
  midPool: FieldPlayer[],
  defPool: FieldPlayer[],
  relations: PlayerRelation[] = [],
  variant = 0,
): { adjScore: number; balanceScore: number; mismatchCount: number; teamA: AssignedFieldPlayer[]; teamB: AssignedFieldPlayer[]; partnerById: Map<string, string>; summary: TeamBalanceSummary } {
  const split = pairSplitPools(attPool, midPool, defPool, relations, variant);
  const teamA = split.teamA.map((p) => buildAssigned(p, split.groupOf.get(p.id)!));
  const teamB = split.teamB.map((p) => buildAssigned(p, split.groupOf.get(p.id)!));
  const summary = calcSummary(teamA, teamB, relations);
  const mismatchCount = [...teamA, ...teamB].filter((p) => {
    const primary = getPositionGroup(p.primaryPosition);
    return primary !== p.assignedGroup && !hasGroup(p.secondaryPositions, p.assignedGroup);
  }).length;
  const balanceScore = summary.balanceScore;
  const fitPenalty = assignmentFitPenalty([...teamA, ...teamB]);
  return {
    adjScore: balanceScore + mismatchCount * MISMATCH_PENALTY + fitPenalty,
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

function pickRankedPool<T extends { id: string }>(ranked: T[], count: number, variant: number): T[] {
  if (count <= 0) return [];
  const base = ranked.slice(0, count);
  const alternates = ranked.slice(count, count + ROLE_VARIANT_WINDOW);
  if (variant <= 0 || base.length === 0 || alternates.length === 0) return base;

  const pool = [...base];
  const maxSwapCount = Math.min(ROLE_VARIANT_MAX_SWAPS, pool.length, alternates.length);
  const swapCount = 1 + (Math.floor(variant / Math.max(1, alternates.length)) % maxSwapCount);
  const replaceableCount = Math.min(pool.length, Math.max(3, Math.ceil(pool.length / 2)));

  for (let swap = 0; swap < swapCount; swap += 1) {
    const outIndex = pool.length - 1 - ((variant + swap * 3) % replaceableCount);
    const alternate = alternates[(Math.floor(variant / (swap + 1)) + swap * 2) % alternates.length];
    if (!alternate || pool.some((player) => player.id === alternate.id)) continue;
    pool[outIndex] = alternate;
  }

  return pool;
}

function buildPools(fieldPlayers: FieldPlayer[], teamTargets: RoleTargets, variant: number, relations: PlayerRelation[] = []): {
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
  const strongDef = pickRankedPool(
    [...remainingAfterMid].sort((a, b) => compareForStrongPool("DEFENSE", a, b)),
    strongDefCount,
    Math.floor(variant / 2),
  );

  const remainingAfterDef = remainingAfterMid.filter((p) => !strongDef.includes(p));

  const strongAttCount = Math.max(0, (teamTargets.ATTACK - STRONG_RESERVE_PER_TEAM) * 2);
  const strongAtt = pickRankedPool(
    [...remainingAfterDef].sort((a, b) => compareForStrongPool("ATTACK", a, b)),
    strongAttCount,
    Math.floor(variant / 3),
  );

  const lastN = remainingAfterDef.filter((p) => !strongAtt.includes(p));
  const lastAttCount = totalAtt - strongAttCount;
  const lastDefCount = totalDef - strongDefCount;

  const attPickCount = Math.min(lastAttCount, lastN.length);
  if (attPickCount > 0 && lastN.length > 0) {
    const candidates: { adjScore: number; att: FieldPlayer[]; def: FieldPlayer[]; key: string }[] = [];
    for (const lastAttCombo of combinations(lastN, attPickCount)) {
      const attCandidate = [...strongAtt, ...lastAttCombo];
      const defCandidate = [...strongDef, ...lastN.filter((p) => !lastAttCombo.includes(p))];
      const result = evaluatePoolAssignment(attCandidate, midPool, defCandidate, relations, variant);
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
): { teamA: AssignedFieldPlayer[]; teamB: AssignedFieldPlayer[]; summary: TeamBalanceSummary } {
  const a = [...teamA];
  const b = [...teamB];
  let summary = calcSummary(a, b, relations);

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
      const trialSummary = calcSummary(trialA, trialB, relations);
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
    summary = calcSummary(a, b, relations);
  }

  return { teamA: a, teamB: b, summary };
}

function buildResult(
  teamA: AssignedFieldPlayer[],
  teamB: AssignedFieldPlayer[],
  summary: TeamBalanceSummary,
  relations: PlayerRelation[] = [],
): TeamBalanceResult {
  const teamAWithSubRoles = assignDetailedSubRoles(teamA);
  const teamBWithSubRoles = assignDetailedSubRoles(teamB);
  const warnings: string[] = [];
  const relationViolations = relationViolationsForTeams(teamAWithSubRoles, teamBWithSubRoles, relations);
  const overrides = [...teamAWithSubRoles, ...teamBWithSubRoles].filter((p) => p.isPositionOverride);
  if (overrides.length >= 6) warnings.push(`포지션 변경자가 ${overrides.length}명입니다. 역할 배정이 다소 억지일 수 있습니다.`);
  if (summary.fieldGkA === 0 || summary.fieldGkB === 0) warnings.push("한 팀에 필드 GK 가능자가 없습니다. 전담 GK가 없거나 부족하면 문제가 될 수 있습니다.");
  if (Math.abs(summary.activityA - summary.activityB) >= 8) warnings.push("팀별 활동량 차이가 큽니다.");
  if (Math.abs(summary.guestA - summary.guestB) >= 5) warnings.push("정규 선수와 용병 비율이 한쪽으로 몰렸습니다.");
  if (Math.abs(summary.coachA - summary.coachB) > 1) warnings.push("코치가 한쪽 팀으로 몰렸습니다.");
  if (Math.abs(summary.multiPositionA - summary.multiPositionB) >= 2) warnings.push("멀티포지션 선수가 한쪽으로 몰렸습니다.");
  const hardViolations = relationViolations.filter((violation) => violation.score === 1);
  if (hardViolations.length > 0) {
    warnings.push(`궁합도 1점 분리 우선 조합이 같은 팀에 있습니다: ${hardViolations.map((violation) => `${formatTeamName(violation.team)} ${violation.playerAName}/${violation.playerBName}`).join(", ")}`);
  }

  const quality: TeamBalanceResult["quality"] = warnings.length === 0 ? "좋음" : warnings.length <= 2 ? "주의" : "나쁨";

  return {
    teamA: { name: "A", players: teamAWithSubRoles },
    teamB: { name: "B", players: teamBWithSubRoles },
    summary,
    relationViolations,
    warnings,
    quality,
  };
}

export function balanceTeams(players: Player[], variant = 0, relations: PlayerRelation[] = []): TeamBalanceResult {
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

  const { attPool, midPool, defPool } = buildPools(fieldPlayers, teamTargets, variant, relations);
  const initial = evaluatePoolAssignment(attPool, midPool, defPool, relations, variant);

  if (initial.teamA.length < MIN_TEAM_SIZE || initial.teamA.length > MAX_TEAM_SIZE
      || initial.teamB.length < MIN_TEAM_SIZE || initial.teamB.length > MAX_TEAM_SIZE) {
    throw new Error(`한 팀은 ${MIN_TEAM_SIZE}명~${MAX_TEAM_SIZE}명이어야 합니다. 현재 ${formatTeamName("A")} ${initial.teamA.length}명, ${formatTeamName("B")} ${initial.teamB.length}명입니다.`);
  }

  const refined = refineByPairFlip(initial.teamA, initial.teamB, initial.partnerById, relations);
  return buildResult(refined.teamA, refined.teamB, refined.summary, relations);
}

export function rebalanceTeams(teamAPlayers: Player[], teamBPlayers: Player[], variant = 0, relations: PlayerRelation[] = []): TeamBalanceResult {
  return balanceTeams([...teamAPlayers, ...teamBPlayers], variant, relations);
}

function detailedTotalDiff(summary: TeamBalanceSummary): number {
  const totalA = summary.centerForwardScoreA + summary.wingScoreA + summary.midScoreA + summary.centerBackScoreA + summary.wingBackScoreA + summary.activityA;
  const totalB = summary.centerForwardScoreB + summary.wingScoreB + summary.midScoreB + summary.centerBackScoreB + summary.wingBackScoreB + summary.activityB;
  if (summary.playerCountA !== summary.playerCountB) {
    return Math.abs(summary.rotationAdjustedTotalA - summary.rotationAdjustedTotalB);
  }
  return Math.abs(totalA - totalB);
}

function totalDiffBucket(result: TeamBalanceResult): number {
  return Math.ceil(detailedTotalDiff(result.summary) * 2);
}

function roleBalanceDiff(summary: TeamBalanceSummary): number {
  return Math.abs(summary.centerForwardScoreA - summary.centerForwardScoreB)
    + Math.abs(summary.wingScoreA - summary.wingScoreB)
    + Math.abs(summary.midScoreA - summary.midScoreB)
    + Math.abs(summary.centerBackScoreA - summary.centerBackScoreB)
    + Math.abs(summary.wingBackScoreA - summary.wingBackScoreB)
    + Math.abs(summary.activityA - summary.activityB);
}

function strongProfileOverlap(a: AssignedFieldPlayer, b: AssignedFieldPlayer): number {
  const pairs = [
    [centerForwardScore(a), centerForwardScore(b)],
    [wingScore(a), wingScore(b)],
    [a.midScore, b.midScore],
    [centerBackScore(a), centerBackScore(b)],
    [wingBackScore(a), wingBackScore(b)],
  ];
  const overlaps = pairs
    .filter(([aScore, bScore]) => aScore >= PROFILE_OVERLAP_MIN_SCORE && bScore >= PROFILE_OVERLAP_MIN_SCORE)
    .map(([aScore, bScore]) => Math.min(aScore, bScore));

  if (overlaps.length < 2) return 0;
  const overlapTotal = overlaps.reduce((sum, score) => sum + score, 0);
  return Math.max(0, overlapTotal - PROFILE_OVERLAP_BASELINE) + (overlaps.length - 2) * 2;
}

function teamProfileStackPenalty(players: AssignedFieldPlayer[]): number {
  let penalty = 0;
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      penalty += strongProfileOverlap(players[i], players[j]);
    }
  }
  return penalty;
}

function profileStackPenalty(result: TeamBalanceResult): number {
  return teamProfileStackPenalty(result.teamA.players as AssignedFieldPlayer[])
    + teamProfileStackPenalty(result.teamB.players as AssignedFieldPlayer[]);
}

function multiPositionStrength(player: AssignedFieldPlayer): number {
  const scores = [
    centerForwardScore(player),
    wingScore(player),
    player.midScore,
    centerBackScore(player),
    wingBackScore(player),
  ].filter((score) => score >= PROFILE_OVERLAP_MIN_SCORE);

  if (scores.length < 2) return 0;
  return scores.length * 20 + scores.reduce((sum, score) => sum + score, 0);
}

function teamMultiStrength(players: AssignedFieldPlayer[]): number {
  return players.reduce((sum, player) => sum + multiPositionStrength(player), 0);
}

function multiStrengthDiff(result: TeamBalanceResult): number {
  return Math.abs(
    teamMultiStrength(result.teamA.players as AssignedFieldPlayer[])
    - teamMultiStrength(result.teamB.players as AssignedFieldPlayer[]),
  );
}

function fitPenaltyForResult(result: TeamBalanceResult): number {
  return assignmentFitPenalty([...(result.teamA.players as AssignedFieldPlayer[]), ...(result.teamB.players as AssignedFieldPlayer[])]);
}

function variantQualityScore(result: TeamBalanceResult): number {
  const summary = result.summary;
  const coachDiff = Math.abs(summary.coachA - summary.coachB);
  const coachPenalty = Math.max(0, coachDiff - 1) * 1500 + coachDiff * 25;
  return coachPenalty
    + totalDiffBucket(result) * 1000
    + profileStackPenalty(result) * PROFILE_STACK_VARIANT_WEIGHT
    + multiStrengthDiff(result) * 2
    + detailedTotalDiff(summary) * 20
    + roleBalanceDiff(summary) * 8
    + fitPenaltyForResult(result);
}

function teamVariantKey(result: TeamBalanceResult): string {
  const aIds = result.teamA.players.map((p) => `${p.id}:${p.assignedGroup}`).sort().join(",");
  const bIds = result.teamB.players.map((p) => `${p.id}:${p.assignedGroup}`).sort().join(",");
  return aIds < bIds ? `${aIds}|${bIds}` : `${bIds}|${aIds}`;
}

function groupIds(result: TeamBalanceResult, team: "A" | "B", group: PositionGroup): string[] {
  const players = team === "A" ? result.teamA.players : result.teamB.players;
  return players
    .filter((player) => player.assignedGroup === group)
    .map((player) => player.id)
    .sort();
}

function midVariantKey(result: TeamBalanceResult): string {
  const aIds = groupIds(result, "A", "MID").join(",");
  const bIds = groupIds(result, "B", "MID").join(",");
  return aIds < bIds ? `${aIds}|${bIds}` : `${bIds}|${aIds}`;
}

function overlapCount(a: string[], b: string[]): number {
  const bIds = new Set(b);
  return a.reduce((count, id) => count + (bIds.has(id) ? 1 : 0), 0);
}

function midSimilarity(a: TeamBalanceResult, b: TeamBalanceResult): number {
  const aMidA = groupIds(a, "A", "MID");
  const aMidB = groupIds(a, "B", "MID");
  const bMidA = groupIds(b, "A", "MID");
  const bMidB = groupIds(b, "B", "MID");
  const sameOrientation = overlapCount(aMidA, bMidA) + overlapCount(aMidB, bMidB);
  const flippedOrientation = overlapCount(aMidA, bMidB) + overlapCount(aMidB, bMidA);
  return Math.max(sameOrientation, flippedOrientation);
}

function selectDiverseVariants(candidates: TeamBalanceResult[], maxVariants: number): TeamBalanceResult[] {
  if (candidates.length <= maxVariants) return candidates;

  const bestTotalDiff = detailedTotalDiff(candidates[0].summary);
  const selected: TeamBalanceResult[] = [];
  const selectedKeys = new Set<string>();
  const selectedMidKeys = new Set<string>();
  const add = (candidate: TeamBalanceResult): boolean => {
    const key = teamVariantKey(candidate);
    const midKey = midVariantKey(candidate);
    if (selectedKeys.has(key) || selectedMidKeys.has(midKey)) return false;
    selectedKeys.add(key);
    selectedMidKeys.add(midKey);
    selected.push(candidate);
    return true;
  };

  add(candidates[0]);

  for (const maxSimilarity of [4, 6, 8]) {
    for (const candidate of candidates) {
      if (selected.length >= maxVariants) break;
      if (detailedTotalDiff(candidate.summary) > bestTotalDiff + VARIANT_TOTAL_DIFF_TOLERANCE) continue;
      if (selected.some((selectedCandidate) => midSimilarity(candidate, selectedCandidate) > maxSimilarity)) continue;
      add(candidate);
    }
  }

  for (const candidate of candidates) {
    if (selected.length >= maxVariants) break;
    add(candidate);
  }

  for (const candidate of candidates) {
    if (selected.length >= maxVariants) break;
    const key = teamVariantKey(candidate);
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    selected.push(candidate);
  }

  return selected;
}

export function balanceTeamsVariants(players: Player[], maxVariants = 10, relations: PlayerRelation[] = []): TeamBalanceResult[] {
  const candidates: TeamBalanceResult[] = [];
  const seen = new Set<string>();
  const probe = Math.max(maxVariants * 40, 400);
  for (let v = 0; v < probe; v += 1) {
    let r: TeamBalanceResult;
    try {
      r = balanceTeams(players, v, []);
    } catch {
      if (candidates.length === 0) throw new Error("팀 분배 실패");
      break;
    }
    const key = teamVariantKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(r);
  }
  if (candidates.length === 0) throw new Error("팀 분배 실패");

  candidates.sort((a, b) => {
    const qualityDiff = variantQualityScore(a) - variantQualityScore(b);
    if (qualityDiff !== 0) return qualityDiff;
    return teamVariantKey(a).localeCompare(teamVariantKey(b));
  });

  return selectDiverseVariants(candidates, maxVariants);
}

export function summarizeTeams(teamAPlayers: AssignedPlayer[], teamBPlayers: AssignedPlayer[], relations: PlayerRelation[] = []): TeamBalanceResult {
  const a = teamAPlayers as AssignedFieldPlayer[];
  const b = teamBPlayers as AssignedFieldPlayer[];
  const summary = calcSummary(a, b, relations);
  return buildResult(a, b, summary, relations);
}

export function playersByGroup(team: Team, group: PositionGroup): AssignedPlayer[] {
  return team.players.filter((player) => player.assignedGroup === group);
}
