import type { AssignedPlayer, FieldPosition, Player, PositionGroup } from "@/types/player";
import type { Team, TeamBalanceResult, TeamBalanceSummary } from "@/types/team";
import { getPositionGroup, hasGroup, scoreForGroup } from "./positions";

const POSITION_GROUPS: PositionGroup[] = ["ATTACK", "MID", "DEFENSE"];
const PAIRING_GROUP_ORDER: PositionGroup[] = ["DEFENSE", "MID", "ATTACK"];
const MIN_TEAM_SIZE = 11;
const MAX_TEAM_SIZE = 18;
const PAIR_FLIP_MAX_ROUNDS = 30;

type FieldPlayer = Player & { primaryPosition: FieldPosition };
type AssignedFieldPlayer = AssignedPlayer & { primaryPosition: FieldPosition };
type RoleTargets = Record<PositionGroup, number>;

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
  return player.attackScore + player.midScore + player.defenseScore + player.activityScore;
}

function groupActivityScore(player: FieldPlayer, group: PositionGroup): number {
  return scoreForGroup(group, player) + player.activityScore;
}

function comparePlayersForPair(group: PositionGroup, a: FieldPlayer, b: FieldPlayer): number {
  const metricDiff = groupActivityScore(b, group) - groupActivityScore(a, group);
  if (metricDiff !== 0) return metricDiff;
  const compositeDiff = compositeScore(b) - compositeScore(a);
  if (compositeDiff !== 0) return compositeDiff;
  return a.name.localeCompare(b.name, "ko");
}

function compareSurplusForRelocation(a: FieldPlayer, b: FieldPlayer): number {
  const aGroup = getPositionGroup(a.primaryPosition);
  const bGroup = getPositionGroup(b.primaryPosition);
  const metricDiff = groupActivityScore(a, aGroup) - groupActivityScore(b, bGroup);
  if (metricDiff !== 0) return metricDiff;
  const compositeDiff = compositeScore(a) - compositeScore(b);
  if (compositeDiff !== 0) return compositeDiff;
  return a.name.localeCompare(b.name, "ko");
}

function assignmentReason(player: FieldPlayer, group: PositionGroup): string {
  const primaryGroup = getPositionGroup(player.primaryPosition);
  if (primaryGroup === group) return "주포지션 그룹 배정";
  if (hasGroup(player.secondaryPositions, group)) return "부포지션 그룹 배정";
  return "인원 균형을 위한 포지션 변경";
}

function assignRoles(players: FieldPlayer[], roleTargets: RoleTargets): AssignedFieldPlayer[] {
  const byPrimary = new Map<PositionGroup, FieldPlayer[]>();
  POSITION_GROUPS.forEach((group) => byPrimary.set(group, []));
  for (const player of players) {
    byPrimary.get(getPositionGroup(player.primaryPosition))!.push(player);
  }

  POSITION_GROUPS.forEach((group) => {
    byPrimary.get(group)!.sort((a, b) => comparePlayersForPair(group, a, b));
  });

  const counts: RoleTargets = { ATTACK: 0, MID: 0, DEFENSE: 0 };
  const groupOf = new Map<string, PositionGroup>();
  const surplus: FieldPlayer[] = [];

  for (const group of POSITION_GROUPS) {
    const pool = byPrimary.get(group)!;
    const target = roleTargets[group];
    pool.slice(0, target).forEach((player) => {
      groupOf.set(player.id, group);
      counts[group] += 1;
    });
    pool.slice(target).forEach((player) => surplus.push(player));
  }

  surplus.sort(compareSurplusForRelocation);

  for (const player of surplus) {
    const deficits = POSITION_GROUPS.filter((group) => counts[group] < roleTargets[group]);
    if (deficits.length === 0) {
      throw new Error("역할 배정에 실패했습니다.");
    }
    deficits.sort((a, b) => {
      const scoreDiff = scoreForGroup(b, player) - scoreForGroup(a, player);
      if (scoreDiff !== 0) return scoreDiff;
      return (roleTargets[b] - counts[b]) - (roleTargets[a] - counts[a]);
    });
    const target = deficits[0];
    groupOf.set(player.id, target);
    counts[target] += 1;
  }

  if (POSITION_GROUPS.some((group) => counts[group] !== roleTargets[group])) {
    throw new Error("역할 배정에 실패했습니다.");
  }

  return players.map((player) => {
    const group = groupOf.get(player.id);
    if (!group) {
      throw new Error("역할 배정에 실패했습니다.");
    }
    return {
      ...player,
      assignedGroup: group,
      assignmentReason: assignmentReason(player, group),
      isPositionOverride: getPositionGroup(player.primaryPosition) !== group,
    };
  });
}

function calcTeamScore(teamA: AssignedFieldPlayer[], teamB: AssignedFieldPlayer[]): TeamBalanceSummary {
  const sum = (players: AssignedFieldPlayer[], fn: (player: AssignedFieldPlayer) => number) =>
    players.reduce((acc, player) => acc + fn(player), 0);
  const byGroup = (players: AssignedFieldPlayer[], group: PositionGroup) =>
    players.filter((player) => player.assignedGroup === group);

  const attackScoreA = sum(byGroup(teamA, "ATTACK"), (p) => p.attackScore);
  const attackScoreB = sum(byGroup(teamB, "ATTACK"), (p) => p.attackScore);
  const midScoreA = sum(byGroup(teamA, "MID"), (p) => p.midScore);
  const midScoreB = sum(byGroup(teamB, "MID"), (p) => p.midScore);
  const defenseScoreA = sum(byGroup(teamA, "DEFENSE"), (p) => p.defenseScore);
  const defenseScoreB = sum(byGroup(teamB, "DEFENSE"), (p) => p.defenseScore);
  const activityA = sum(teamA, (p) => p.activityScore);
  const activityB = sum(teamB, (p) => p.activityScore);
  const fieldGkA = teamA.filter((p) => p.canGk).length;
  const fieldGkB = teamB.filter((p) => p.canGk).length;
  const regularA = teamA.filter((p) => p.memberType === "REGULAR").length;
  const regularB = teamB.filter((p) => p.memberType === "REGULAR").length;
  const guestA = teamA.filter((p) => p.memberType === "GUEST").length;
  const guestB = teamB.filter((p) => p.memberType === "GUEST").length;
  const overrides = [...teamA, ...teamB].filter((p) => p.isPositionOverride).length;

  const balanceScore =
    Math.abs(attackScoreA - attackScoreB) * 5 +
    Math.abs(midScoreA - midScoreB) * 5 +
    Math.abs(defenseScoreA - defenseScoreB) * 5 +
    Math.abs(activityA - activityB) * 2 +
    Math.abs(fieldGkA - fieldGkB) * 3 +
    Math.abs(guestA - guestB) +
    overrides * 1.5;

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
    balanceScore,
  };
}

function pairCostByPrimary(teamA: FieldPlayer[], teamB: FieldPlayer[]): number {
  const primarySum = (team: FieldPlayer[], group: PositionGroup, scoreFn: (player: FieldPlayer) => number) =>
    team.filter((player) => getPositionGroup(player.primaryPosition) === group)
      .reduce((acc, player) => acc + scoreFn(player), 0);
  const aAtt = primarySum(teamA, "ATTACK", (p) => p.attackScore);
  const aMid = primarySum(teamA, "MID", (p) => p.midScore);
  const aDef = primarySum(teamA, "DEFENSE", (p) => p.defenseScore);
  const aAct = teamA.reduce((acc, p) => acc + p.activityScore, 0);
  const bAtt = primarySum(teamB, "ATTACK", (p) => p.attackScore);
  const bMid = primarySum(teamB, "MID", (p) => p.midScore);
  const bDef = primarySum(teamB, "DEFENSE", (p) => p.defenseScore);
  const bAct = teamB.reduce((acc, p) => acc + p.activityScore, 0);
  const aTotal = aAtt + aMid + aDef + aAct;
  const bTotal = bAtt + bMid + bDef + bAct;
  return (Math.abs(aAtt - bAtt) + Math.abs(aMid - bMid) + Math.abs(aDef - bDef)) * 5
       + Math.abs(aAct - bAct) * 2
       + Math.abs(aTotal - bTotal);
}

type PairAndSplitResult = {
  teamA: FieldPlayer[];
  teamB: FieldPlayer[];
  partnerById: Map<string, string>;
};

function pairByPosition(players: FieldPlayer[]): PairAndSplitResult {
  const byGroup = new Map<PositionGroup, FieldPlayer[]>();
  POSITION_GROUPS.forEach((g) => byGroup.set(g, []));
  for (const player of players) {
    byGroup.get(getPositionGroup(player.primaryPosition))!.push(player);
  }
  POSITION_GROUPS.forEach((group) => {
    byGroup.get(group)!.sort((a, b) => comparePlayersForPair(group, a, b));
  });

  const teamA: FieldPlayer[] = [];
  const teamB: FieldPlayer[] = [];
  const partnerById = new Map<string, string>();

  for (const group of PAIRING_GROUP_ORDER) {
    const pool = byGroup.get(group)!;
    for (let i = 0; i < pool.length; i += 2) {
      const stronger = pool[i];
      const weaker = pool[i + 1];

      if (!weaker) {
        if (teamA.length < teamB.length) {
          teamA.push(stronger);
        } else if (teamB.length < teamA.length) {
          teamB.push(stronger);
        } else {
          const costA = pairCostByPrimary([...teamA, stronger], teamB);
          const costB = pairCostByPrimary(teamA, [...teamB, stronger]);
          if (costA <= costB) teamA.push(stronger);
          else teamB.push(stronger);
        }
        continue;
      }

      const cost1 = pairCostByPrimary([...teamA, stronger], [...teamB, weaker]);
      const cost2 = pairCostByPrimary([...teamA, weaker], [...teamB, stronger]);
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

  return { teamA, teamB, partnerById };
}

type EvalResult = {
  score: number;
  assignedA: AssignedFieldPlayer[];
  assignedB: AssignedFieldPlayer[];
  summary: TeamBalanceSummary;
};

function evaluateSplit(teamA: FieldPlayer[], teamB: FieldPlayer[]): EvalResult {
  const targetsA = targetForTeamSize(teamA.length);
  const targetsB = targetForTeamSize(teamB.length);
  const assignedA = assignRoles(teamA, targetsA);
  const assignedB = assignRoles(teamB, targetsB);
  const summary = calcTeamScore(assignedA, assignedB);
  return { score: summary.balanceScore, assignedA, assignedB, summary };
}

function refineByPairFlip(
  teamA: FieldPlayer[],
  teamB: FieldPlayer[],
  partnerById: Map<string, string>,
): { teamA: FieldPlayer[]; teamB: FieldPlayer[] } {
  const a = [...teamA];
  const b = [...teamB];

  for (let round = 0; round < PAIR_FLIP_MAX_ROUNDS; round += 1) {
    const baseline = evaluateSplit(a, b).score;
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
      trialA[i] = b[j];
      trialB[j] = a[i];
      const trialScore = evaluateSplit(trialA, trialB).score;
      const improvement = baseline - trialScore;
      if (improvement > bestImprovement) {
        bestImprovement = improvement;
        bestFlip = { aIndex: i, bIndex: j };
      }
    }

    if (!bestFlip) break;
    const { aIndex, bIndex } = bestFlip;
    const tmp = a[aIndex];
    a[aIndex] = b[bIndex];
    b[bIndex] = tmp;
  }

  return { teamA: a, teamB: b };
}

export function balanceTeams(players: Player[]): TeamBalanceResult {
  if (players.length < MIN_TEAM_SIZE * 2 || players.length > MAX_TEAM_SIZE * 2) {
    throw new Error(`필드 참석자는 ${MIN_TEAM_SIZE * 2}명~${MAX_TEAM_SIZE * 2}명이어야 합니다. 현재 ${players.length}명입니다.`);
  }

  const gkPlayers = players.filter((player) => player.primaryPosition === "GK");
  if (gkPlayers.length > 0) {
    throw new Error(`GK는 필드 참석자에 포함할 수 없습니다: ${gkPlayers.map((player) => player.name).join(", ")}`);
  }

  const fieldPlayers = players.filter(isFieldPlayer);

  const initial = pairByPosition(fieldPlayers);
  if (initial.teamA.length < MIN_TEAM_SIZE || initial.teamA.length > MAX_TEAM_SIZE
      || initial.teamB.length < MIN_TEAM_SIZE || initial.teamB.length > MAX_TEAM_SIZE) {
    throw new Error(`한 팀은 ${MIN_TEAM_SIZE}명~${MAX_TEAM_SIZE}명이어야 합니다. 현재 A팀 ${initial.teamA.length}명, B팀 ${initial.teamB.length}명입니다.`);
  }

  const refined = refineByPairFlip(initial.teamA, initial.teamB, initial.partnerById);
  const final = evaluateSplit(refined.teamA, refined.teamB);

  const warnings: string[] = [];
  const overrides = [...final.assignedA, ...final.assignedB].filter((p) => p.isPositionOverride);
  if (overrides.length >= 6) warnings.push(`포지션 변경자가 ${overrides.length}명입니다. 역할 배정이 다소 억지일 수 있습니다.`);
  if (final.summary.fieldGkA === 0 || final.summary.fieldGkB === 0) warnings.push("한 팀에 필드 GK 가능자가 없습니다. 전담 GK가 없거나 부족하면 문제가 될 수 있습니다.");
  if (Math.abs(final.summary.activityA - final.summary.activityB) >= 8) warnings.push("팀별 활동량 차이가 큽니다.");
  if (Math.abs(final.summary.guestA - final.summary.guestB) >= 5) warnings.push("정규 선수와 용병 비율이 한쪽으로 몰렸습니다.");

  const quality: TeamBalanceResult["quality"] = warnings.length === 0 ? "좋음" : warnings.length <= 2 ? "주의" : "나쁨";

  return {
    teamA: { name: "A", players: final.assignedA },
    teamB: { name: "B", players: final.assignedB },
    summary: final.summary,
    warnings,
    quality,
  };
}

export function rebalanceTeams(teamAPlayers: Player[], teamBPlayers: Player[]): TeamBalanceResult {
  const totalCount = teamAPlayers.length + teamBPlayers.length;
  if (totalCount < MIN_TEAM_SIZE * 2 || totalCount > MAX_TEAM_SIZE * 2) {
    throw new Error(`필드 참석자는 ${MIN_TEAM_SIZE * 2}명~${MAX_TEAM_SIZE * 2}명이어야 합니다. 현재 ${totalCount}명입니다.`);
  }

  const fieldA = teamAPlayers.filter(isFieldPlayer);
  const fieldB = teamBPlayers.filter(isFieldPlayer);
  if (fieldA.length < MIN_TEAM_SIZE || fieldA.length > MAX_TEAM_SIZE
      || fieldB.length < MIN_TEAM_SIZE || fieldB.length > MAX_TEAM_SIZE) {
    throw new Error(`한 팀은 ${MIN_TEAM_SIZE}명~${MAX_TEAM_SIZE}명이어야 합니다. 현재 A팀 ${fieldA.length}명, B팀 ${fieldB.length}명입니다.`);
  }

  const final = evaluateSplit(fieldA, fieldB);

  const warnings: string[] = [];
  const overrides = [...final.assignedA, ...final.assignedB].filter((p) => p.isPositionOverride);
  if (overrides.length >= 6) warnings.push(`포지션 변경자가 ${overrides.length}명입니다. 역할 배정이 다소 억지일 수 있습니다.`);
  if (final.summary.fieldGkA === 0 || final.summary.fieldGkB === 0) warnings.push("한 팀에 필드 GK 가능자가 없습니다. 전담 GK가 없거나 부족하면 문제가 될 수 있습니다.");
  if (Math.abs(final.summary.activityA - final.summary.activityB) >= 8) warnings.push("팀별 활동량 차이가 큽니다.");
  if (Math.abs(final.summary.guestA - final.summary.guestB) >= 5) warnings.push("정규 선수와 용병 비율이 한쪽으로 몰렸습니다.");

  const quality: TeamBalanceResult["quality"] = warnings.length === 0 ? "좋음" : warnings.length <= 2 ? "주의" : "나쁨";

  return {
    teamA: { name: "A", players: final.assignedA },
    teamB: { name: "B", players: final.assignedB },
    summary: final.summary,
    warnings,
    quality,
  };
}

export function playersByGroup(team: Team, group: PositionGroup): AssignedPlayer[] {
  return team.players.filter((player) => player.assignedGroup === group);
}
