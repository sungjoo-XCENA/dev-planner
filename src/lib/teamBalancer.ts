import type { AssignedPlayer, FieldPosition, Player, PositionGroup } from "@/types/player";
import type { Team, TeamBalanceResult, TeamBalanceSummary } from "@/types/team";
import { getPositionGroup, hasGroup, scoreForGroup } from "./positions";

const POSITION_GROUPS: PositionGroup[] = ["ATTACK", "MID", "DEFENSE"];
const MIN_TEAM_SIZE = 11;
const MAX_TEAM_SIZE = 18;

type FieldPlayer = Player & { primaryPosition: FieldPosition };
type AssignedFieldPlayer = AssignedPlayer & { primaryPosition: FieldPosition };
type RoleTargets = Record<PositionGroup, number>;

function isFieldPlayer(player: Player): player is FieldPlayer {
  return player.primaryPosition !== "GK";
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function targetForTeamSize(size: number): RoleTargets {
  const attack = Math.max(2, Math.round(size * 0.31));
  const mid = Math.max(2, Math.round(size * 0.31));
  const defense = Math.max(3, size - attack - mid);
  return { ATTACK: attack, MID: mid, DEFENSE: defense };
}

function splitTarget(total: number): { a: number; b: number } {
  return { a: Math.ceil(total / 2), b: Math.floor(total / 2) };
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

function assignRoles(players: FieldPlayer[], roleTargets: RoleTargets, iterations = 8000): AssignedFieldPlayer[] {
  let best: AssignedFieldPlayer[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < iterations; i += 1) {
    const counts: RoleTargets = { ATTACK: 0, MID: 0, DEFENSE: 0 };
    const assigned: AssignedFieldPlayer[] = [];
    let score = 0;

    for (const player of shuffled(players)) {
      const candidates = shuffled(POSITION_GROUPS)
        .filter((group) => counts[group] < roleTargets[group])
        .sort((a, b) => assignmentScore(player, b) - assignmentScore(player, a));
      const selected = candidates[0];
      if (!selected) continue;
      counts[selected] += 1;
      score += assignmentScore(player, selected);
      const primaryGroup = getPositionGroup(player.primaryPosition);
      assigned.push({
        ...player,
        assignedGroup: selected,
        assignmentReason: assignmentReason(player, selected),
        isPositionOverride: primaryGroup !== selected,
      });
    }

    if (assigned.length !== players.length) continue;
    if (POSITION_GROUPS.some((group) => counts[group] !== roleTargets[group])) continue;
    if (score > bestScore) {
      bestScore = score;
      best = assigned;
    }
  }

  if (!best) {
    throw new Error("역할 배정에 실패했습니다.");
  }

  return best;
}

function groupPlayers(players: AssignedFieldPlayer[], group: PositionGroup): AssignedFieldPlayer[] {
  return players.filter((player) => player.assignedGroup === group);
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
    Math.abs(teamA.length - teamB.length) * 20 +
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

function splitByRoleBalance(assigned: AssignedFieldPlayer[], teamSizeA: number, teamTargetsA: RoleTargets, iterations = 12000): TeamBalanceResult {
  let bestA: AssignedFieldPlayer[] = [];
  let bestB: AssignedFieldPlayer[] = [];
  let bestSummary: TeamBalanceSummary | null = null;

  for (let i = 0; i < iterations; i += 1) {
    const teamA: AssignedFieldPlayer[] = [];
    const teamB: AssignedFieldPlayer[] = [];

    POSITION_GROUPS.forEach((group) => {
      const pool = shuffled(groupPlayers(assigned, group));
      const target = teamTargetsA[group];
      teamA.push(...pool.slice(0, target));
      teamB.push(...pool.slice(target));
    });

    if (teamA.length !== teamSizeA) continue;

    const summary = calcTeamScore(teamA, teamB);
    if (!bestSummary || summary.balanceScore < bestSummary.balanceScore) {
      bestA = teamA;
      bestB = teamB;
      bestSummary = summary;
    }
  }

  if (!bestSummary) throw new Error("팀 분배에 실패했습니다.");

  const warnings: string[] = [];
  const overrides = [...bestA, ...bestB].filter((p) => p.isPositionOverride);
  if (overrides.length >= 6) warnings.push(`포지션 변경자가 ${overrides.length}명입니다. 역할 배정이 다소 억지일 수 있습니다.`);
  if (bestSummary.fieldGkA === 0 || bestSummary.fieldGkB === 0) warnings.push("한 팀에 필드 GK 가능자가 없습니다. 전담 GK가 없거나 부족하면 문제가 될 수 있습니다.");
  if (Math.abs(bestSummary.activityA - bestSummary.activityB) >= 8) warnings.push("팀별 활동량 차이가 큽니다.");
  if (Math.abs(bestSummary.guestA - bestSummary.guestB) >= 5) warnings.push("정규 선수와 용병 비율이 한쪽으로 몰렸습니다.");

  const quality: TeamBalanceResult["quality"] = warnings.length === 0 ? "좋음" : warnings.length <= 2 ? "주의" : "나쁨";

  return {
    teamA: { name: "A", players: bestA },
    teamB: { name: "B", players: bestB },
    summary: bestSummary,
    warnings,
    quality,
  };
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
  const teamSizeA = Math.ceil(fieldPlayers.length / 2);
  const teamSizeB = Math.floor(fieldPlayers.length / 2);
  if (teamSizeA > MAX_TEAM_SIZE || teamSizeB < MIN_TEAM_SIZE) {
    throw new Error(`한 팀은 ${MIN_TEAM_SIZE}명~${MAX_TEAM_SIZE}명이어야 합니다. 현재 A팀 ${teamSizeA}명, B팀 ${teamSizeB}명입니다.`);
  }

  const teamTargetsA = targetForTeamSize(teamSizeA);
  const teamTargetsB = targetForTeamSize(teamSizeB);
  const totalTargets: RoleTargets = {
    ATTACK: teamTargetsA.ATTACK + teamTargetsB.ATTACK,
    MID: teamTargetsA.MID + teamTargetsB.MID,
    DEFENSE: teamTargetsA.DEFENSE + teamTargetsB.DEFENSE,
  };
  const splitAttack = splitTarget(totalTargets.ATTACK);
  const splitMid = splitTarget(totalTargets.MID);
  const splitDefense = splitTarget(totalTargets.DEFENSE);
  const normalizedTeamTargetsA: RoleTargets = {
    ATTACK: splitAttack.a,
    MID: splitMid.a,
    DEFENSE: teamSizeA - splitAttack.a - splitMid.a,
  };
  const normalizedTotalTargets: RoleTargets = {
    ATTACK: splitAttack.a + splitAttack.b,
    MID: splitMid.a + splitMid.b,
    DEFENSE: splitDefense.a + splitDefense.b,
  };

  const assigned = assignRoles(fieldPlayers, normalizedTotalTargets);
  return splitByRoleBalance(assigned, teamSizeA, normalizedTeamTargetsA);
}

export function playersByGroup(team: Team, group: PositionGroup): AssignedPlayer[] {
  return team.players.filter((player) => player.assignedGroup === group);
}
