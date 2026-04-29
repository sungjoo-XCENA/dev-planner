import type { AssignedPlayer, FieldPosition, Player, PositionGroup } from "@/types/player";
import type { Team, TeamBalanceResult, TeamBalanceSummary } from "@/types/team";
import { getPositionGroup, hasGroup, scoreForGroup } from "./positions";

const POSITION_GROUPS: PositionGroup[] = ["ATTACK", "MID", "DEFENSE"];
const PAIRING_GROUP_ORDER: PositionGroup[] = ["DEFENSE", "MID", "ATTACK"];
const MIN_TEAM_SIZE = 11;
const MAX_TEAM_SIZE = 18;
const SWAP_REFINE_MAX_ROUNDS = 30;

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

function calcOverallScore(player: FieldPlayer): number {
  return player.attackScore + player.midScore + player.defenseScore + player.activityScore;
}

function assignmentScore(player: FieldPlayer, group: PositionGroup): number {
  const primaryGroup = getPositionGroup(player.primaryPosition);
  const base = scoreForGroup(group, player);
  const primaryBonus = primaryGroup === group ? 2 : 0;
  const secondaryBonus = hasGroup(player.secondaryPositions, group) ? 1 : 0;
  const unrelatedPenalty = primaryGroup !== group && secondaryBonus === 0 ? -1 : 0;
  return base + primaryBonus + secondaryBonus + unrelatedPenalty;
}

function assignmentReason(player: FieldPlayer, group: PositionGroup): string {
  const primaryGroup = getPositionGroup(player.primaryPosition);
  if (primaryGroup === group) return "주포지션 그룹 배정";
  if (hasGroup(player.secondaryPositions, group)) return "부포지션 그룹 배정";
  return "인원 균형을 위한 포지션 변경";
}

function maxAssignmentScore(player: FieldPlayer): number {
  return Math.max(...POSITION_GROUPS.map((group) => assignmentScore(player, group)));
}

function groupTiebreakRank(player: FieldPlayer, group: PositionGroup): number {
  const primary = getPositionGroup(player.primaryPosition);
  if (group === primary) return 0;
  if (hasGroup(player.secondaryPositions, group)) return 1;
  return 2;
}

function assignRoles(players: FieldPlayer[], roleTargets: RoleTargets): AssignedFieldPlayer[] {
  const ordered = [...players].sort((a, b) => {
    const diff = maxAssignmentScore(b) - maxAssignmentScore(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "ko");
  });

  const counts: RoleTargets = { ATTACK: 0, MID: 0, DEFENSE: 0 };
  const assigned: AssignedFieldPlayer[] = [];

  for (const player of ordered) {
    const available = POSITION_GROUPS.filter((group) => counts[group] < roleTargets[group]);
    if (available.length === 0) continue;
    available.sort((a, b) => {
      const diff = assignmentScore(player, b) - assignmentScore(player, a);
      if (diff !== 0) return diff;
      return groupTiebreakRank(player, a) - groupTiebreakRank(player, b);
    });
    const selected = available[0];
    counts[selected] += 1;
    const primaryGroup = getPositionGroup(player.primaryPosition);
    assigned.push({
      ...player,
      assignedGroup: selected,
      assignmentReason: assignmentReason(player, selected),
      isPositionOverride: primaryGroup !== selected,
    });
  }

  if (assigned.length !== players.length || POSITION_GROUPS.some((group) => counts[group] !== roleTargets[group])) {
    throw new Error("역할 배정에 실패했습니다.");
  }

  return assigned;
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

function pairCostAtPrimary(teamA: FieldPlayer[], teamB: FieldPlayer[]): number {
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

function pairByPosition(players: FieldPlayer[]): { teamA: FieldPlayer[]; teamB: FieldPlayer[] } {
  const byGroup = new Map<PositionGroup, FieldPlayer[]>();
  POSITION_GROUPS.forEach((g) => byGroup.set(g, []));
  for (const player of players) {
    byGroup.get(getPositionGroup(player.primaryPosition))!.push(player);
  }
  POSITION_GROUPS.forEach((g) => {
    byGroup.get(g)!.sort((a, b) => {
      const diff = calcOverallScore(b) - calcOverallScore(a);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, "ko");
    });
  });

  const teamA: FieldPlayer[] = [];
  const teamB: FieldPlayer[] = [];

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
          const costA = pairCostAtPrimary([...teamA, stronger], teamB);
          const costB = pairCostAtPrimary(teamA, [...teamB, stronger]);
          if (costA <= costB) teamA.push(stronger);
          else teamB.push(stronger);
        }
        continue;
      }

      const cost1 = pairCostAtPrimary([...teamA, stronger], [...teamB, weaker]);
      const cost2 = pairCostAtPrimary([...teamA, weaker], [...teamB, stronger]);
      if (cost1 <= cost2) {
        teamA.push(stronger);
        teamB.push(weaker);
      } else {
        teamA.push(weaker);
        teamB.push(stronger);
      }
    }
  }

  return { teamA, teamB };
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

function refineWithSwaps(teamA: FieldPlayer[], teamB: FieldPlayer[]): { teamA: FieldPlayer[]; teamB: FieldPlayer[] } {
  const a = [...teamA];
  const b = [...teamB];

  for (let round = 0; round < SWAP_REFINE_MAX_ROUNDS; round += 1) {
    const baseline = evaluateSplit(a, b).score;
    let bestImprovement = 0;
    let bestSwap: [number, number] | null = null;

    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < b.length; j += 1) {
        if (getPositionGroup(a[i].primaryPosition) !== getPositionGroup(b[j].primaryPosition)) continue;
        const trialA = [...a];
        const trialB = [...b];
        trialA[i] = b[j];
        trialB[j] = a[i];
        const trialScore = evaluateSplit(trialA, trialB).score;
        const improvement = baseline - trialScore;
        if (improvement > bestImprovement) {
          bestImprovement = improvement;
          bestSwap = [i, j];
        }
      }
    }

    if (!bestSwap) break;
    const [i, j] = bestSwap;
    const tmp = a[i];
    a[i] = b[j];
    b[j] = tmp;
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

  const refined = refineWithSwaps(initial.teamA, initial.teamB);
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

export function playersByGroup(team: Team, group: PositionGroup): AssignedPlayer[] {
  return team.players.filter((player) => player.assignedGroup === group);
}
