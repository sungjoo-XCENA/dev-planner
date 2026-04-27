import type { AssignedPlayer, Player, PositionGroup } from "@/types/player";
import type { Team, TeamBalanceResult, TeamBalanceSummary } from "@/types/team";
import { getPositionGroup, hasGroup, scoreForGroup } from "./positions";

const ROLE_TARGETS: Record<PositionGroup, number> = {
  ATTACK: 8,
  MID: 8,
  DEFENSE: 10,
};

const TEAM_ROLE_TARGETS: Record<PositionGroup, number> = {
  ATTACK: 4,
  MID: 4,
  DEFENSE: 5,
};

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function assignmentScore(player: Player, group: PositionGroup): number {
  const primaryGroup = getPositionGroup(player.primaryPosition);
  const base = scoreForGroup(group, player);
  const primaryBonus = primaryGroup === group ? 2 : 0;
  const secondaryBonus = hasGroup(player.secondaryPositions, group) ? 1 : 0;
  const unrelatedPenalty = primaryGroup !== group && secondaryBonus === 0 ? -1 : 0;
  return base + primaryBonus + secondaryBonus + unrelatedPenalty;
}

function assignmentReason(player: Player, group: PositionGroup): string {
  const primaryGroup = getPositionGroup(player.primaryPosition);
  if (primaryGroup === group) return "주포지션 그룹 배정";
  if (hasGroup(player.secondaryPositions, group)) return "부포지션 그룹 배정";
  return "인원 균형을 위한 포지션 변경";
}

function assignRoles(players: Player[], iterations = 8000): AssignedPlayer[] {
  let best: AssignedPlayer[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const groups: PositionGroup[] = ["ATTACK", "MID", "DEFENSE"];

  for (let i = 0; i < iterations; i += 1) {
    const counts: Record<PositionGroup, number> = { ATTACK: 0, MID: 0, DEFENSE: 0 };
    const assigned: AssignedPlayer[] = [];
    let score = 0;

    for (const player of shuffled(players)) {
      const candidates = shuffled(groups)
        .filter((group) => counts[group] < ROLE_TARGETS[group])
        .sort((a, b) => assignmentScore(player, b) - assignmentScore(player, a));
      const selected = candidates[0];
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

    if (counts.ATTACK !== 8 || counts.MID !== 8 || counts.DEFENSE !== 10) continue;
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

function groupPlayers(players: AssignedPlayer[], group: PositionGroup): AssignedPlayer[] {
  return players.filter((player) => player.assignedGroup === group);
}

function calcTeamScore(teamA: AssignedPlayer[], teamB: AssignedPlayer[]): TeamBalanceSummary {
  const sum = (players: AssignedPlayer[], fn: (player: AssignedPlayer) => number) =>
    players.reduce((acc, player) => acc + fn(player), 0);
  const byGroup = (players: AssignedPlayer[], group: PositionGroup) =>
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

function splitByRoleBalance(assigned: AssignedPlayer[], iterations = 12000): TeamBalanceResult {
  let bestA: AssignedPlayer[] = [];
  let bestB: AssignedPlayer[] = [];
  let bestSummary: TeamBalanceSummary | null = null;

  for (let i = 0; i < iterations; i += 1) {
    const teamA: AssignedPlayer[] = [];
    const teamB: AssignedPlayer[] = [];

    (["ATTACK", "MID", "DEFENSE"] as PositionGroup[]).forEach((group) => {
      const pool = shuffled(groupPlayers(assigned, group));
      const target = TEAM_ROLE_TARGETS[group];
      teamA.push(...pool.slice(0, target));
      teamB.push(...pool.slice(target));
    });

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
  if (players.length !== 26) {
    throw new Error(`필드 참석자는 정확히 26명이어야 합니다. 현재 ${players.length}명입니다.`);
  }
  const assigned = assignRoles(players);
  return splitByRoleBalance(assigned);
}

export function playersByGroup(team: Team, group: PositionGroup): AssignedPlayer[] {
  return team.players.filter((player) => player.assignedGroup === group);
}
