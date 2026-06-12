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
const PAIRING_GROUP_ORDER: PositionGroup[] = ["MID", "DEFENSE", "ATTACK"];
const MIN_TEAM_SIZE = 11;
const MAX_TEAM_SIZE = 18;
const STRONG_RESERVE_PER_TEAM = 2;
const ROLE_VARIANT_WINDOW = 6;
const ROLE_VARIANT_MAX_SWAPS = 2;
const MISMATCH_PENALTY = 1.5;
const OFF_BEST_GROUP_GAP_THRESHOLD = 5;
const OFF_BEST_GROUP_SOFT_PENALTY = 120;
const OFF_BEST_GROUP_HARD_PENALTY = 300;
const PROFILE_OVERLAP_MIN_SCORE = 7;
const PROFILE_OVERLAP_BASELINE = 14;
const PROFILE_STACK_VARIANT_WEIGHT = 6;
const MULTI_POSITION_BALANCE_PENALTY = 16;
const COACH_BALANCE_PENALTY = 80;
const LINE_BALANCE_WEIGHT = 8;
const DETAIL_SLOT_BALANCE_WEIGHT = 4;
const ACTIVITY_BALANCE_WEIGHT = 2;
const MULTI_POSITION_VARIANT_PENALTY = 600;
const GOOD_TOTAL_DIFF_LIMIT = 3;
const VARIANT_TOTAL_DIFF_TOLERANCE = 3;
const RELATION_PENALTY: Record<PlayerRelation["score"], number> = {
  1: 1000,
  2: 80,
};

type FieldPlayer = Player & { primaryPosition: FieldPosition };
type AssignedFieldPlayer = AssignedPlayer & { primaryPosition: FieldPosition };
type RoleTargets = Record<PositionGroup, number>;
type SlotAssignment = {
  group: PositionGroup;
  subRole: AssignedSubRole;
};
type SubRoleScores = {
  centerForward: number;
  wing: number;
  attack: number;
  mid: number;
  centerBack: number;
  wingBack: number;
  defense: number;
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

function isStaffMember(player: Pick<Player, "memo">): boolean {
  return extractStaffRole(player.memo) !== null;
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

function compareForMidPool(a: FieldPlayer, b: FieldPlayer): number {
  if (b.midScore !== a.midScore) return b.midScore - a.midScore;
  const rankDiff = groupFitRank(a, "MID") - groupFitRank(b, "MID");
  if (rankDiff !== 0) return rankDiff;
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

function groupForSubRole(role: AssignedSubRole): PositionGroup {
  if (role === "CF" || role === "WING") return "ATTACK";
  if (role === "MID") return "MID";
  return "DEFENSE";
}

function isSubRoleForGroup(role: AssignedSubRole | undefined, group: PositionGroup): role is AssignedSubRole {
  return role !== undefined && groupForSubRole(role) === group;
}

function lateralSide(player: Pick<Player, "primaryPosition" | "secondaryPositions">): "LB" | "RB" | "NEUTRAL" {
  if (player.primaryPosition === "LB" || player.primaryPosition === "RB") return player.primaryPosition;
  if (player.secondaryPositions.includes("LB") && !player.secondaryPositions.includes("RB")) return "LB";
  if (player.secondaryPositions.includes("RB") && !player.secondaryPositions.includes("LB")) return "RB";
  return "NEUTRAL";
}

function lateralSideRank(player: Pick<Player, "primaryPosition" | "secondaryPositions">): number {
  const side = lateralSide(player);
  if (side === "LB") return 0;
  if (side === "RB") return 1;
  return 2;
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

function assignGroupSubRoles<T extends (FieldPlayer | AssignedFieldPlayer) & { assignedGroup: PositionGroup; assignedSubRole?: AssignedSubRole }>(
  players: T[],
  group: "ATTACK" | "DEFENSE",
): Array<T & { assignedSubRole: AssignedSubRole }> {
  if (players.length === 0) return [];
  if (players.every((player) => isSubRoleForGroup(player.assignedSubRole, group))) {
    return players as Array<T & { assignedSubRole: AssignedSubRole }>;
  }

  return players.map((player) => ({
    ...player,
    assignedSubRole: preferredSubRole(player, group),
  }));
}

function preferredSubRole(player: FieldPlayer | AssignedFieldPlayer, group: "ATTACK" | "DEFENSE"): AssignedSubRole {
  if (group === "ATTACK") {
    const cf = centerForwardScore(player);
    const wing = wingScore(player);
    if (cf !== wing) return cf > wing ? "CF" : "WING";
    if (player.primaryPosition === "CF") return "CF";
    if (player.primaryPosition === "LW" || player.primaryPosition === "RW") return "WING";
    if (player.secondaryPositions.includes("CF")) return "CF";
    if (player.secondaryPositions.includes("LW") || player.secondaryPositions.includes("RW")) return "WING";
    return "CF";
  }

  const cb = centerBackScore(player);
  const wb = wingBackScore(player);
  if (cb !== wb) return cb > wb ? "CB" : "WB";
  if (player.primaryPosition === "CB") return "CB";
  if (player.primaryPosition === "LB" || player.primaryPosition === "RB") return "WB";
  if (player.secondaryPositions.includes("CB")) return "CB";
  if (player.secondaryPositions.includes("LB") || player.secondaryPositions.includes("RB")) return "WB";
  return "CB";
}

function assignDetailedSubRoles<T extends (FieldPlayer | AssignedFieldPlayer) & { assignedGroup: PositionGroup; assignedSubRole?: AssignedSubRole }>(players: T[]): Array<T & { assignedSubRole: AssignedSubRole }> {
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

function buildSlotAssignments(
  attPool: FieldPlayer[],
  midPool: FieldPlayer[],
  defPool: FieldPlayer[],
): Map<string, SlotAssignment> {
  const assignments = new Map<string, SlotAssignment>();
  const attackers = assignGroupSubRoles(
    attPool.map((player) => ({ ...player, assignedGroup: "ATTACK" as const })),
    "ATTACK",
  );
  const defenders = assignGroupSubRoles(
    defPool.map((player) => ({ ...player, assignedGroup: "DEFENSE" as const })),
    "DEFENSE",
  );

  attackers.forEach((player) => assignments.set(player.id, { group: "ATTACK", subRole: player.assignedSubRole }));
  midPool.forEach((player) => assignments.set(player.id, { group: "MID", subRole: "MID" }));
  defenders.forEach((player) => assignments.set(player.id, { group: "DEFENSE", subRole: player.assignedSubRole }));
  return assignments;
}

function pairingGroupForPlayer(player: FieldPlayer, assignments: Map<string, SlotAssignment>): PositionGroup {
  const assignedGroup = assignments.get(player.id)?.group;
  if (assignedGroup) return assignedGroup;

  const attackScore = scoreForGroup("ATTACK", player);
  const defenseScore = scoreForGroup("DEFENSE", player);
  if (attackScore !== defenseScore) return attackScore > defenseScore ? "ATTACK" : "DEFENSE";

  const primaryGroup = getPositionGroup(player.primaryPosition);
  if (primaryGroup === "ATTACK" || primaryGroup === "DEFENSE") return primaryGroup;
  if (assignedGroup === "ATTACK" || assignedGroup === "DEFENSE") return assignedGroup;
  return "DEFENSE";
}

function comparePlayersForPairingGroup(group: PositionGroup, a: FieldPlayer, b: FieldPlayer): number {
  const groupDiff = scoreForGroup(group, b) - scoreForGroup(group, a);
  if (groupDiff !== 0) return groupDiff;
  const fitDiff = groupFitRank(a, group) - groupFitRank(b, group);
  if (fitDiff !== 0) return fitDiff;
  if (group === "DEFENSE") {
    const sideDiff = lateralSideRank(a) - lateralSideRank(b);
    if (sideDiff !== 0) return sideDiff;
  }
  const subRoleDiff = group === "ATTACK"
    ? Math.max(centerForwardScore(b), wingScore(b)) - Math.max(centerForwardScore(a), wingScore(a))
    : group === "DEFENSE"
      ? Math.max(centerBackScore(b), wingBackScore(b)) - Math.max(centerBackScore(a), wingBackScore(a))
      : b.midScore - a.midScore;
  if (subRoleDiff !== 0) return subRoleDiff;
  const actDiff = effectiveActivityScore(b) - effectiveActivityScore(a);
  if (actDiff !== 0) return actDiff;
  const compositeDiff = compositeScore(b) - compositeScore(a);
  if (compositeDiff !== 0) return compositeDiff;
  return a.name.localeCompare(b.name, "ko");
}

function profileDistance(a: FieldPlayer, b: FieldPlayer): number {
  return Math.abs(centerForwardScore(a) - centerForwardScore(b))
    + Math.abs(wingScore(a) - wingScore(b))
    + Math.abs(a.midScore - b.midScore)
    + Math.abs(centerBackScore(a) - centerBackScore(b))
    + Math.abs(wingBackScore(a) - wingBackScore(b))
    + Math.abs(effectiveActivityScore(a) - effectiveActivityScore(b));
}

function pairSimilarityCost(group: PositionGroup, a: FieldPlayer, b: FieldPlayer): number {
  const sidePenalty = group === "DEFENSE" && lateralSide(a) !== "NEUTRAL" && lateralSide(b) !== "NEUTRAL" && lateralSide(a) !== lateralSide(b) ? 8 : 0;
  const detailDiff = group === "ATTACK"
    ? Math.abs(centerForwardScore(a) - centerForwardScore(b)) + Math.abs(wingScore(a) - wingScore(b))
    : group === "DEFENSE"
      ? Math.abs(centerBackScore(a) - centerBackScore(b)) + Math.abs(wingBackScore(a) - wingBackScore(b))
      : Math.abs(a.midScore - b.midScore);

  return Math.abs(scoreForGroup(group, a) - scoreForGroup(group, b)) * 10
    + detailDiff * 2
    + Math.abs(compositeScore(a) - compositeScore(b))
    + profileDistance(a, b)
    + sidePenalty;
}

function buildGroupPairs(players: FieldPlayer[], group: PositionGroup): Array<[FieldPlayer, FieldPlayer?]> {
  const remaining = [...players].sort((a, b) => comparePlayersForPairingGroup(group, a, b));
  const pairs: Array<[FieldPlayer, FieldPlayer?]> = [];

  while (remaining.length > 0) {
    const first = remaining.shift()!;
    if (remaining.length === 0) {
      pairs.push([first]);
      break;
    }

    let bestIndex = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const cost = pairSimilarityCost(group, first, candidate);
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    });
    const [second] = remaining.splice(bestIndex, 1);
    pairs.push([first, second]);
  }

  return pairs;
}

function mergeAttackDefenseSingles(pairs: PairChoice[]): PairChoice[] {
  const attackSingleIndex = pairs.findIndex((pair) => pair.group === "ATTACK" && !pair.weaker);
  const defenseSingleIndex = pairs.findIndex((pair) => pair.group === "DEFENSE" && !pair.weaker);
  if (attackSingleIndex < 0 || defenseSingleIndex < 0) return pairs;

  const attackSingle = pairs[attackSingleIndex];
  const defenseSingle = pairs[defenseSingleIndex];
  return pairs
    .filter((_, index) => index !== attackSingleIndex && index !== defenseSingleIndex)
    .concat({ group: "ATTACK", stronger: attackSingle.stronger, weaker: defenseSingle.stronger });
}

function assignedPlayersForCost(team: FieldPlayer[], assignments: Map<string, SlotAssignment>): AssignedFieldPlayer[] {
  return team.map((player) => {
    const assignment = assignments.get(player.id);
    return buildAssigned(player, assignment?.group ?? bestScoringGroup(player), assignment?.subRole);
  });
}

function lateralBalancePenalty(
  teamA: Array<FieldPlayer | AssignedFieldPlayer>,
  teamB: Array<FieldPlayer | AssignedFieldPlayer>,
  assignments?: Map<string, SlotAssignment>,
): number {
  const counts = (players: Array<FieldPlayer | AssignedFieldPlayer>) => {
    const result = { LB: 0, RB: 0 };
    players.forEach((player) => {
      const role = assignments?.get(player.id)?.subRole ?? ("assignedSubRole" in player ? player.assignedSubRole : undefined);
      if (role !== "WB") return;
      const side = lateralSide(player);
      if (side === "LB") result.LB += 1;
      else if (side === "RB") result.RB += 1;
    });
    return result;
  };
  const a = counts(teamA);
  const b = counts(teamB);
  return Math.abs(a.LB - b.LB) + Math.abs(a.RB - b.RB);
}

function assignedGroupCountDiff(
  teamA: Array<FieldPlayer | AssignedFieldPlayer>,
  teamB: Array<FieldPlayer | AssignedFieldPlayer>,
  assignments?: Map<string, SlotAssignment>,
): number {
  const counts = (players: Array<FieldPlayer | AssignedFieldPlayer>) => {
    const result: RoleTargets = { ATTACK: 0, MID: 0, DEFENSE: 0 };
    players.forEach((player) => {
      const group = assignments?.get(player.id)?.group ?? ("assignedGroup" in player ? player.assignedGroup : undefined);
      if (group) result[group] += 1;
    });
    return result;
  };
  const a = counts(teamA);
  const b = counts(teamB);
  return POSITION_GROUPS.reduce((sum, group) => sum + Math.abs(a[group] - b[group]), 0);
}

function pairCostByAssignments(
  teamA: FieldPlayer[],
  teamB: FieldPlayer[],
  assignments: Map<string, SlotAssignment>,
  relations: PlayerRelation[] = [],
): number {
  const aScores = subRoleScores(assignedPlayersForCost(teamA, assignments));
  const bScores = subRoleScores(assignedPlayersForCost(teamB, assignments));
  const aAct = teamA.reduce((acc, p) => acc + effectiveActivityScore(p), 0);
  const bAct = teamB.reduce((acc, p) => acc + effectiveActivityScore(p), 0);
  const aCoach = teamA.filter(isStaffMember).length;
  const bCoach = teamB.filter(isStaffMember).length;
  const aGuest = teamA.filter((player) => player.memberType === "GUEST").length;
  const bGuest = teamB.filter((player) => player.memberType === "GUEST").length;
  const aMulti = teamA.filter(isMultiPositionPlayer).length;
  const bMulti = teamB.filter(isMultiPositionPlayer).length;
  const total = (aScores.attack + aScores.mid + aScores.defense + aAct) - (bScores.attack + bScores.mid + bScores.defense + bAct);
  const lineDiff = Math.abs(aScores.attack - bScores.attack)
    + Math.abs(aScores.mid - bScores.mid)
    + Math.abs(aScores.defense - bScores.defense);
  const detailSlotDiff = Math.abs(aScores.centerForward - bScores.centerForward)
    + Math.abs(aScores.wing - bScores.wing)
    + Math.abs(aScores.centerBack - bScores.centerBack)
    + Math.abs(aScores.wingBack - bScores.wingBack);
  return lineDiff * LINE_BALANCE_WEIGHT
       + detailSlotDiff * DETAIL_SLOT_BALANCE_WEIGHT
       + Math.abs(aAct - bAct) * ACTIVITY_BALANCE_WEIGHT
       + Math.abs(aCoach - bCoach) * COACH_BALANCE_PENALTY
       + Math.abs(aGuest - bGuest) * 100
       + Math.abs(aMulti - bMulti) * MULTI_POSITION_BALANCE_PENALTY
       + assignedGroupCountDiff(teamA, teamB, assignments) * 120
       + lateralBalancePenalty(teamA, teamB, assignments) * 8
       + Math.abs(total)
       + relationPenaltyForSplit(teamA, teamB, relations);
}

type SplitResult = {
  teamA: FieldPlayer[];
  teamB: FieldPlayer[];
  partnerById: Map<string, string>;
  assignments: Map<string, SlotAssignment>;
  pairMetaById: Map<string, BalancePairMeta>;
};
type PairChoice = {
  group: PositionGroup;
  stronger: FieldPlayer;
  weaker?: FieldPlayer;
};
type BalancePairMeta = {
  balancePairKey: string;
  balancePairOrder: number;
  balancePairPartnerName?: string;
  balancePairGroup: PositionGroup;
};
type PairPlan = {
  pairs: PairChoice[];
  assignments: Map<string, SlotAssignment>;
};

function buildPairPlan(attPool: FieldPlayer[], midPool: FieldPlayer[], defPool: FieldPlayer[]): PairPlan {
  const assignments = buildSlotAssignments(attPool, midPool, defPool);
  const allPlayers = [...attPool, ...midPool, ...defPool];
  const pairs: PairChoice[] = [];

  for (const group of PAIRING_GROUP_ORDER) {
    const sortedPool = allPlayers
      .filter((player) => pairingGroupForPlayer(player, assignments) === group)
      .sort((a, b) => comparePlayersForPairingGroup(group, a, b));
    buildGroupPairs(sortedPool, group).forEach(([stronger, weaker]) => {
      pairs.push({ group, stronger, weaker });
    });
  }

  return { pairs: mergeAttackDefenseSingles(pairs), assignments };
}

function pairPlanKey(pairPlan: PairPlan): string {
  return pairPlan.pairs
    .map(({ group, stronger, weaker }) => {
      if (!weaker) return `${group}:${stronger.id}`;
      const [a, b] = [stronger.id, weaker.id].sort();
      return `${group}:${a}/${b}`;
    })
    .sort()
    .join("|");
}

function assignedPlayersForPairPlan(pairPlan: PairPlan): AssignedFieldPlayer[] {
  return pairPlan.pairs.flatMap(({ stronger, weaker }) => weaker ? [stronger, weaker] : [stronger]).map((player) => {
    const assignment = pairPlan.assignments.get(player.id)!;
    return buildAssigned(player, assignment.group, assignment.subRole);
  });
}

function balancePairKey(stronger: FieldPlayer, weaker?: FieldPlayer): string {
  if (!weaker) return stronger.id;
  return [stronger.id, weaker.id].sort().join("|");
}

function pairMetaMap(pairPlan: PairPlan): Map<string, BalancePairMeta> {
  const meta = new Map<string, BalancePairMeta>();
  pairPlan.pairs.forEach(({ group, stronger, weaker }, index) => {
    const key = balancePairKey(stronger, weaker);
    meta.set(stronger.id, {
      balancePairKey: key,
      balancePairOrder: index,
      balancePairPartnerName: weaker?.name,
      balancePairGroup: group,
    });
    if (weaker) {
      meta.set(weaker.id, {
        balancePairKey: key,
        balancePairOrder: index,
        balancePairPartnerName: stronger.name,
        balancePairGroup: group,
      });
    }
  });
  return meta;
}

function pairPlanFitScore(pairPlan: PairPlan): number {
  const assigned = assignedPlayersForPairPlan(pairPlan);
  const overridePenalty = assigned.filter((player) => player.isPositionOverride).length * 80;
  const pairShapePenalty = pairPlan.pairs.reduce((sum, { group, stronger, weaker }) => {
    if (!weaker) return sum;
    return sum + pairSimilarityCost(group, stronger, weaker) * 0.1;
  }, 0);
  return assignmentFitPenalty(assigned) + overridePenalty + pairShapePenalty;
}

function chooseBasePairPlan(
  fieldPlayers: FieldPlayer[],
  teamTargets: RoleTargets,
  relations: PlayerRelation[],
  maxVariants: number,
): PairPlan {
  const probe = Math.max(maxVariants * 40, 400);
  const seen = new Set<string>();
  let best: { pairPlan: PairPlan; result: TeamBalanceResult; fitScore: number } | null = null;

  for (let variant = 0; variant < probe; variant += 1) {
    const { attPool, midPool, defPool } = buildPools(fieldPlayers, teamTargets, variant, relations);
    const pairPlan = buildPairPlan(attPool, midPool, defPool);
    const key = pairPlanKey(pairPlan);
    if (seen.has(key)) continue;
    seen.add(key);

    const evaluated = evaluatePoolAssignment(attPool, midPool, defPool, relations, variant);
    const result = buildResult(evaluated.teamA, evaluated.teamB, evaluated.summary, relations);
    const fitScore = pairPlanFitScore(pairPlan);
    if (!best || fitScore < best.fitScore
        || (fitScore === best.fitScore && variantQualityScore(result) < variantQualityScore(best.result))
        || (fitScore === best.fitScore && variantQualityScore(result) === variantQualityScore(best.result) && variantDisplayOrder(result, best.result) < 0)) {
      best = { pairPlan, result, fitScore };
    }
  }

  if (!best) throw new Error("팀 분배 실패");
  return best.pairPlan;
}

function pairSplitPools(
  attPool: FieldPlayer[],
  midPool: FieldPlayer[],
  defPool: FieldPlayer[],
  relations: PlayerRelation[] = [],
  variant = 0,
): SplitResult {
  const pairPlan = buildPairPlan(attPool, midPool, defPool);
  const { assignments } = pairPlan;
  const pairMetaById = pairMetaMap(pairPlan);

  const teamA: FieldPlayer[] = [];
  const teamB: FieldPlayer[] = [];
  const partnerById = new Map<string, string>();

  let pairSequence = 0;

  for (const { group, stronger, weaker } of pairPlan.pairs) {
    if (!weaker) {
      if (teamA.length < teamB.length) {
        teamA.push(stronger);
      } else if (teamB.length < teamA.length) {
        teamB.push(stronger);
      } else {
        const costA = pairCostByAssignments([...teamA, stronger], teamB, assignments, relations);
        const costB = pairCostByAssignments(teamA, [...teamB, stronger], assignments, relations);
        if (costA <= costB) teamA.push(stronger);
        else teamB.push(stronger);
      }
      continue;
    }

    const cost1 = pairCostByAssignments([...teamA, stronger], [...teamB, weaker], assignments, relations);
    const cost2 = pairCostByAssignments([...teamA, weaker], [...teamB, stronger], assignments, relations);
    const preferFlipped = Math.floor(variant / (2 ** (pairSequence % 20))) % 2 === 1;
    const variantTolerance = group === "MID" ? 120 : 48;
    const useFlipped = cost2 < cost1 || (preferFlipped && Math.abs(cost1 - cost2) <= variantTolerance);
    pairSequence += 1;
    if (!useFlipped) {
      teamA.push(stronger);
      teamB.push(weaker);
    } else {
      teamA.push(weaker);
      teamB.push(stronger);
    }
    partnerById.set(stronger.id, weaker.id);
    partnerById.set(weaker.id, stronger.id);
  }

  return { teamA, teamB, partnerById, assignments, pairMetaById };
}

function evaluatePairMask(pairPlan: PairPlan, relations: PlayerRelation[], mask: number): { teamA: AssignedFieldPlayer[]; teamB: AssignedFieldPlayer[]; summary: TeamBalanceSummary } {
  const teamA: FieldPlayer[] = [];
  const teamB: FieldPlayer[] = [];
  const pairMetaById = pairMetaMap(pairPlan);

  pairPlan.pairs.forEach(({ stronger, weaker }, index) => {
    if (!weaker) {
      const putA = teamA.length < teamB.length || (teamA.length === teamB.length && Math.floor(mask / (2 ** index)) % 2 === 0);
      if (putA) teamA.push(stronger);
      else teamB.push(stronger);
      return;
    }

    const flipped = Math.floor(mask / (2 ** index)) % 2 === 1;
    if (flipped) {
      teamA.push(weaker);
      teamB.push(stronger);
    } else {
      teamA.push(stronger);
      teamB.push(weaker);
    }
  });

  const assignedA = teamA.map((player) => {
    const assignment = pairPlan.assignments.get(player.id)!;
    return { ...buildAssigned(player, assignment.group, assignment.subRole), ...pairMetaById.get(player.id) };
  });
  const assignedB = teamB.map((player) => {
    const assignment = pairPlan.assignments.get(player.id)!;
    return { ...buildAssigned(player, assignment.group, assignment.subRole), ...pairMetaById.get(player.id) };
  });

  return { teamA: assignedA, teamB: assignedB, summary: calcSummary(assignedA, assignedB, relations) };
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

function buildAssigned(player: FieldPlayer, group: PositionGroup, subRole?: AssignedSubRole): AssignedFieldPlayer {
  const primaryGroup = getPositionGroup(player.primaryPosition);
  return {
    ...player,
    assignedGroup: group,
    assignedSubRole: subRole,
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
  const regularA = teamA.filter((p) => p.memberType === "REGULAR").length;
  const regularB = teamB.filter((p) => p.memberType === "REGULAR").length;
  const guestA = teamA.filter((p) => p.memberType === "GUEST").length;
  const guestB = teamB.filter((p) => p.memberType === "GUEST").length;
  const coachA = teamA.filter(isStaffMember).length;
  const coachB = teamB.filter(isStaffMember).length;
  const multiPositionA = teamA.filter(isMultiPositionPlayer).length;
  const multiPositionB = teamB.filter(isMultiPositionPlayer).length;
  const overrides = [...teamA, ...teamB].filter((p) => p.isPositionOverride).length;
  const relationViolations = relationViolationsForTeams(teamA, teamB, relations);
  const relationPenalty = relationViolations.reduce((acc, violation) => acc + violation.penalty, 0);

  const lineDiff = Math.abs(attackScoreA - attackScoreB)
    + Math.abs(midScoreA - midScoreB)
    + Math.abs(defenseScoreA - defenseScoreB);
  const detailSlotDiff = Math.abs(centerForwardScoreA - centerForwardScoreB)
    + Math.abs(wingScoreA - wingScoreB)
    + Math.abs(centerBackScoreA - centerBackScoreB)
    + Math.abs(wingBackScoreA - wingBackScoreB);

  const balanceScore =
    lineDiff * LINE_BALANCE_WEIGHT +
    detailSlotDiff * DETAIL_SLOT_BALANCE_WEIGHT +
    Math.abs(activityA - activityB) * ACTIVITY_BALANCE_WEIGHT +
    Math.abs(fieldGkA - fieldGkB) * 3 +
    Math.abs(guestA - guestB) +
    Math.abs(coachA - coachB) * COACH_BALANCE_PENALTY +
    Math.abs(multiPositionA - multiPositionB) * MULTI_POSITION_BALANCE_PENALTY +
    overrides * 1.5 +
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
    regularA,
    regularB,
    guestA,
    guestB,
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
  const teamA = split.teamA.map((p) => {
    const assignment = split.assignments.get(p.id)!;
    return { ...buildAssigned(p, assignment.group, assignment.subRole), ...split.pairMetaById.get(p.id) };
  });
  const teamB = split.teamB.map((p) => {
    const assignment = split.assignments.get(p.id)!;
    return { ...buildAssigned(p, assignment.group, assignment.subRole), ...split.pairMetaById.get(p.id) };
  });
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
  if (Math.abs(summary.coachA - summary.coachB) > 1) warnings.push("코치/감독/단장이 한쪽 팀으로 몰렸습니다.");
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

  return buildResult(initial.teamA, initial.teamB, initial.summary, relations);
}

export function rebalanceTeams(teamAPlayers: Player[], teamBPlayers: Player[], variant = 0, relations: PlayerRelation[] = []): TeamBalanceResult {
  return balanceTeams([...teamAPlayers, ...teamBPlayers], variant, relations);
}

function detailedTotalDiff(summary: TeamBalanceSummary): number {
  const totalA = summary.centerForwardScoreA + summary.wingScoreA + summary.midScoreA + summary.centerBackScoreA + summary.wingBackScoreA + summary.activityA;
  const totalB = summary.centerForwardScoreB + summary.wingScoreB + summary.midScoreB + summary.centerBackScoreB + summary.wingBackScoreB + summary.activityB;
  return Math.abs(totalA - totalB);
}

function roleBalanceDiff(summary: TeamBalanceSummary): number {
  return Math.abs(summary.attackScoreA - summary.attackScoreB)
    + Math.abs(summary.midScoreA - summary.midScoreB)
    + Math.abs(summary.defenseScoreA - summary.defenseScoreB);
}

function detailSlotBalanceDiff(summary: TeamBalanceSummary): number {
  return Math.abs(summary.centerForwardScoreA - summary.centerForwardScoreB)
    + Math.abs(summary.wingScoreA - summary.wingScoreB)
    + Math.abs(summary.centerBackScoreA - summary.centerBackScoreB)
    + Math.abs(summary.wingBackScoreA - summary.wingBackScoreB);
}

function scoreCardBalanceDiff(summary: TeamBalanceSummary): number {
  return detailSlotBalanceDiff(summary)
    + Math.abs(summary.midScoreA - summary.midScoreB)
    + Math.abs(summary.activityA - summary.activityB);
}

function multiPositionDiff(summary: TeamBalanceSummary): number {
  return Math.abs(summary.multiPositionA - summary.multiPositionB);
}

function staffBalanceDiff(summary: TeamBalanceSummary): number {
  return Math.abs(summary.coachA - summary.coachB);
}

function guestBalanceDiff(summary: TeamBalanceSummary): number {
  return Math.abs(summary.guestA - summary.guestB);
}

function totalDiffPenalty(result: TeamBalanceResult): number {
  const diff = detailedTotalDiff(result.summary);
  if (diff <= GOOD_TOTAL_DIFF_LIMIT) return diff * 60;
  return GOOD_TOTAL_DIFF_LIMIT * 60 + (diff - GOOD_TOTAL_DIFF_LIMIT) * 800;
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
  return assignmentFitPenalty([...(result.teamA.players as AssignedFieldPlayer[]), ...(result.teamB.players as AssignedFieldPlayer[])])
    + assignedGroupCountDiff(result.teamA.players as AssignedFieldPlayer[], result.teamB.players as AssignedFieldPlayer[]) * 500
    + lateralBalancePenalty(result.teamA.players as AssignedFieldPlayer[], result.teamB.players as AssignedFieldPlayer[]) * 8;
}

function variantQualityScore(result: TeamBalanceResult): number {
  const summary = result.summary;
  const coachDiff = Math.abs(summary.coachA - summary.coachB);
  const coachPenalty = Math.max(0, coachDiff - 1) * 1500 + coachDiff * 25;
  return coachPenalty
    + totalDiffPenalty(result)
    + roleBalanceDiff(summary) * 140
    + scoreCardBalanceDiff(summary) * 90
    + profileStackPenalty(result) * PROFILE_STACK_VARIANT_WEIGHT
    + Math.abs(summary.multiPositionA - summary.multiPositionB) * MULTI_POSITION_VARIANT_PENALTY
    + multiStrengthDiff(result) * 2
    + detailedTotalDiff(summary) * 20
    + fitPenaltyForResult(result);
}

function variantDisplayOrder(a: TeamBalanceResult, b: TeamBalanceResult): number {
  const coachDiff = staffBalanceDiff(a.summary) - staffBalanceDiff(b.summary);
  if (coachDiff !== 0) return coachDiff;

  const guestDiff = guestBalanceDiff(a.summary) - guestBalanceDiff(b.summary);
  if (guestDiff !== 0) return guestDiff;

  const scoreCardDiff = scoreCardBalanceDiff(a.summary) - scoreCardBalanceDiff(b.summary);
  if (scoreCardDiff !== 0) return scoreCardDiff;

  const totalDiff = detailedTotalDiff(a.summary) - detailedTotalDiff(b.summary);
  if (totalDiff !== 0) return totalDiff;

  const roleDiff = roleBalanceDiff(a.summary) - roleBalanceDiff(b.summary);
  if (roleDiff !== 0) return roleDiff;

  const detailDiff = detailSlotBalanceDiff(a.summary) - detailSlotBalanceDiff(b.summary);
  if (detailDiff !== 0) return detailDiff;

  const multiDiff = multiPositionDiff(a.summary) - multiPositionDiff(b.summary);
  if (multiDiff !== 0) return multiDiff;

  const qualityDiff = variantQualityScore(a) - variantQualityScore(b);
  if (qualityDiff !== 0) return qualityDiff;

  return teamVariantKey(a).localeCompare(teamVariantKey(b));
}

function teamVariantKey(result: TeamBalanceResult): string {
  const aIds = result.teamA.players.map((p) => `${p.id}:${p.assignedGroup}:${p.assignedSubRole ?? ""}`).sort().join(",");
  const bIds = result.teamB.players.map((p) => `${p.id}:${p.assignedGroup}:${p.assignedSubRole ?? ""}`).sort().join(",");
  return aIds < bIds ? `${aIds}|${bIds}` : `${bIds}|${aIds}`;
}

function groupIds(result: TeamBalanceResult, team: "A" | "B", group: PositionGroup): string[] {
  const players = team === "A" ? result.teamA.players : result.teamB.players;
  return players
    .filter((player) => player.assignedGroup === group)
    .map((player) => player.id)
    .sort();
}

function splitKey(aIds: string[], bIds: string[]): string {
  const a = [...aIds].sort().join(",");
  const b = [...bIds].sort().join(",");
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function groupVariantKey(result: TeamBalanceResult, group: PositionGroup): string {
  return splitKey(groupIds(result, "A", group), groupIds(result, "B", group));
}

function multiVariantKey(result: TeamBalanceResult): string {
  const aIds = result.teamA.players.filter(isMultiPositionPlayer).map((player) => player.id);
  const bIds = result.teamB.players.filter(isMultiPositionPlayer).map((player) => player.id);
  return splitKey(aIds, bIds);
}

function overlapCount(a: string[], b: string[]): number {
  const bIds = new Set(b);
  return a.reduce((count, id) => count + (bIds.has(id) ? 1 : 0), 0);
}

function splitSimilarity(aA: string[], aB: string[], bA: string[], bB: string[]): number {
  const sameOrientation = overlapCount(aA, bA) + overlapCount(aB, bB);
  const flippedOrientation = overlapCount(aA, bB) + overlapCount(aB, bA);
  return Math.max(sameOrientation, flippedOrientation);
}

function groupSimilarity(a: TeamBalanceResult, b: TeamBalanceResult, group: PositionGroup): number {
  return splitSimilarity(groupIds(a, "A", group), groupIds(a, "B", group), groupIds(b, "A", group), groupIds(b, "B", group));
}

function multiSimilarity(a: TeamBalanceResult, b: TeamBalanceResult): number {
  const aA = a.teamA.players.filter(isMultiPositionPlayer).map((player) => player.id);
  const aB = a.teamB.players.filter(isMultiPositionPlayer).map((player) => player.id);
  const bA = b.teamA.players.filter(isMultiPositionPlayer).map((player) => player.id);
  const bB = b.teamB.players.filter(isMultiPositionPlayer).map((player) => player.id);
  return splitSimilarity(aA, aB, bA, bB);
}

function diversityOverlapScore(candidate: TeamBalanceResult, selected: TeamBalanceResult[]): number {
  if (selected.length === 0) return 0;

  let maxMid = 0;
  let maxDefense = 0;
  let maxAttack = 0;
  let maxMulti = 0;
  let totalMid = 0;
  let totalDefense = 0;
  let totalAttack = 0;
  let totalMulti = 0;

  selected.forEach((selectedCandidate) => {
    const mid = groupSimilarity(candidate, selectedCandidate, "MID");
    const defense = groupSimilarity(candidate, selectedCandidate, "DEFENSE");
    const attack = groupSimilarity(candidate, selectedCandidate, "ATTACK");
    const multi = multiSimilarity(candidate, selectedCandidate);
    maxMid = Math.max(maxMid, mid);
    maxDefense = Math.max(maxDefense, defense);
    maxAttack = Math.max(maxAttack, attack);
    maxMulti = Math.max(maxMulti, multi);
    totalMid += mid;
    totalDefense += defense;
    totalAttack += attack;
    totalMulti += multi;
  });

  const averageMid = totalMid / selected.length;
  const averageDefense = totalDefense / selected.length;
  const averageAttack = totalAttack / selected.length;
  const averageMulti = totalMulti / selected.length;
  return maxMid * 1000
    + averageMid * 140
    + maxMulti * 260
    + averageMulti * 45
    + maxDefense * 220
    + averageDefense * 35
    + maxAttack * 70
    + averageAttack * 12;
}

function closeScoreTieBreaker(candidate: TeamBalanceResult, bestTotalDiff: number): number {
  return (detailedTotalDiff(candidate.summary) - bestTotalDiff) * 90
    + scoreCardBalanceDiff(candidate.summary) * 80
    + roleBalanceDiff(candidate.summary) * 12
    + staffBalanceDiff(candidate.summary) * 240
    + guestBalanceDiff(candidate.summary) * 220
    + multiPositionDiff(candidate.summary) * 40
    + variantQualityScore(candidate) * 0.001;
}

function selectDiverseVariants(candidates: TeamBalanceResult[], maxVariants: number): TeamBalanceResult[] {
  if (candidates.length <= maxVariants) return [...candidates].sort(variantDisplayOrder);

  const bestTotalDiff = Math.min(...candidates.map((candidate) => detailedTotalDiff(candidate.summary)));
  const acceptableTotalDiff = Math.max(GOOD_TOTAL_DIFF_LIMIT, bestTotalDiff + VARIANT_TOTAL_DIFF_TOLERANCE);
  const bestLineDiff = Math.min(...candidates.map((candidate) => roleBalanceDiff(candidate.summary)));
  const acceptableLineDiff = Math.max(6, bestLineDiff + 4);
  const acceptableStaffDiff = Math.min(...candidates.map((candidate) => staffBalanceDiff(candidate.summary)));
  const acceptableGuestDiff = Math.min(...candidates.map((candidate) => guestBalanceDiff(candidate.summary)));
  const bestScoreCardDiff = Math.min(...candidates.map((candidate) => scoreCardBalanceDiff(candidate.summary)));
  const acceptableScoreCardDiff = Math.max(18, bestScoreCardDiff + 10);
  const acceptableMultiDiff = Math.min(...candidates.map((candidate) => multiPositionDiff(candidate.summary)));
  const selected: TeamBalanceResult[] = [];
  const selectedKeys = new Set<string>();
  const selectedMidKeys = new Set<string>();
  const selectedDefenseKeys = new Set<string>();
  const selectedAttackKeys = new Set<string>();
  const selectedMultiKeys = new Set<string>();
  const add = (candidate: TeamBalanceResult): void => {
    selectedKeys.add(teamVariantKey(candidate));
    selectedMidKeys.add(groupVariantKey(candidate, "MID"));
    selectedDefenseKeys.add(groupVariantKey(candidate, "DEFENSE"));
    selectedAttackKeys.add(groupVariantKey(candidate, "ATTACK"));
    selectedMultiKeys.add(multiVariantKey(candidate));
    selected.push(candidate);
  };
  const eligible = candidates.filter((candidate) =>
    detailedTotalDiff(candidate.summary) <= acceptableTotalDiff
    && roleBalanceDiff(candidate.summary) <= acceptableLineDiff
    && staffBalanceDiff(candidate.summary) <= acceptableStaffDiff
    && guestBalanceDiff(candidate.summary) <= acceptableGuestDiff
    && scoreCardBalanceDiff(candidate.summary) <= acceptableScoreCardDiff
    && multiPositionDiff(candidate.summary) <= acceptableMultiDiff,
  );
  const pool = eligible.length >= maxVariants ? eligible : candidates;

  while (selected.length < maxVariants) {
    const unused = pool.filter((candidate) => !selectedKeys.has(teamVariantKey(candidate)));
    if (unused.length === 0) break;

    const unseenMid = unused.filter((candidate) => !selectedMidKeys.has(groupVariantKey(candidate, "MID")));
    const midPool = unseenMid.length > 0 ? unseenMid : unused;
    const unseenMulti = midPool.filter((candidate) => !selectedMultiKeys.has(multiVariantKey(candidate)));
    const multiPool = unseenMulti.length > 0 ? unseenMulti : midPool;
    const unseenDefense = multiPool.filter((candidate) => !selectedDefenseKeys.has(groupVariantKey(candidate, "DEFENSE")));
    const defensePool = unseenDefense.length > 0 ? unseenDefense : multiPool;
    const unseenAttack = defensePool.filter((candidate) => !selectedAttackKeys.has(groupVariantKey(candidate, "ATTACK")));
    const attackPool = unseenAttack.length > 0 ? unseenAttack : defensePool;

    const next = attackPool.reduce((best, candidate) => {
      const bestScore = diversityOverlapScore(best, selected) + closeScoreTieBreaker(best, bestTotalDiff);
      const candidateScore = diversityOverlapScore(candidate, selected) + closeScoreTieBreaker(candidate, bestTotalDiff);
      if (candidateScore !== bestScore) return candidateScore < bestScore ? candidate : best;
      return variantDisplayOrder(candidate, best) < 0 ? candidate : best;
    });
    add(next);
  }

  if (selected.length < maxVariants) {
    for (const candidate of candidates) {
      if (selected.length >= maxVariants) break;
      if (!selectedKeys.has(teamVariantKey(candidate))) {
        add(candidate);
      }
    }
  }

  return selected.sort(variantDisplayOrder);
}

export function balanceTeamsVariants(players: Player[], maxVariants = 10, relations: PlayerRelation[] = []): TeamBalanceResult[] {
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
  const pairPlan = chooseBasePairPlan(fieldPlayers, teamTargets, relations, maxVariants);
  const maskCount = 2 ** pairPlan.pairs.length;
  const candidates: TeamBalanceResult[] = [];
  const seen = new Set<string>();

  for (let mask = 0; mask < maskCount; mask += 1) {
    const evaluated = evaluatePairMask(pairPlan, relations, mask);
    if (evaluated.teamA.length < MIN_TEAM_SIZE || evaluated.teamA.length > MAX_TEAM_SIZE
        || evaluated.teamB.length < MIN_TEAM_SIZE || evaluated.teamB.length > MAX_TEAM_SIZE) {
      continue;
    }

    const result = buildResult(evaluated.teamA, evaluated.teamB, evaluated.summary, relations);
    const key = teamVariantKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(result);
  }

  if (candidates.length === 0) throw new Error("팀 분배 실패");

  candidates.sort(variantDisplayOrder);

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
