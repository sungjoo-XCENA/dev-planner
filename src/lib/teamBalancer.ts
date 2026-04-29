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

function calcOverallScore(player: FieldPlayer): number {
  return player.attackScore + player.midScore + player.defenseScore + player.activityScore;
}

function pairAndSplit(players: FieldPlayer[]): { teamA: FieldPlayer[]; teamB: FieldPlayer[] } {
  const sorted = [...players].sort((a, b) => {
    const diff = calcOverallScore(b) - calcOverallScore(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "ko");
  });

  const teamA: FieldPlayer[] = [];
  const teamB: FieldPlayer[] = [];

  for (let i = 0; i < sorted.length; i += 2) {
    const stronger = sorted[i];
    const weaker = sorted[i + 1];
    const pairIndex = Math.floor(i / 2);

    if (!weaker) {
      const sumA = teamA.reduce((acc, player) => acc + calcOverallScore(player), 0);
      const sumB = teamB.reduce((acc, player) => acc + calcOverallScore(player), 0);
      if (sumA <= sumB) teamA.push(stronger);
      else teamB.push(stronger);
      continue;
    }

    const strongerToA = pairIndex % 2 === 0;
    if (strongerToA) {
      teamA.push(stronger);
      teamB.push(weaker);
    } else {
      teamB.push(stronger);
      teamA.push(weaker);
    }
  }

  return { teamA, teamB };
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

export function balanceTeams(players: Player[]): TeamBalanceResult {
  if (players.length < MIN_TEAM_SIZE * 2 || players.length > MAX_TEAM_SIZE * 2) {
    throw new Error(`필드 참석자는 ${MIN_TEAM_SIZE * 2}명~${MAX_TEAM_SIZE * 2}명이어야 합니다. 현재 ${players.length}명입니다.`);
  }

  const gkPlayers = players.filter((player) => player.primaryPosition === "GK");
  if (gkPlayers.length > 0) {
    throw new Error(`GK는 필드 참석자에 포함할 수 없습니다: ${gkPlayers.map((player) => player.name).join(", ")}`);
  }

  const fieldPlayers = players.filter(isFieldPlayer);

  const { teamA: teamAPlayers, teamB: teamBPlayers } = pairAndSplit(fieldPlayers);
  if (teamAPlayers.length > MAX_TEAM_SIZE || teamBPlayers.length < MIN_TEAM_SIZE) {
    throw new Error(`한 팀은 ${MIN_TEAM_SIZE}명~${MAX_TEAM_SIZE}명이어야 합니다. 현재 A팀 ${teamAPlayers.length}명, B팀 ${teamBPlayers.length}명입니다.`);
  }

  const teamATargets = targetForTeamSize(teamAPlayers.length);
  const teamBTargets = targetForTeamSize(teamBPlayers.length);
  const assignedA = assignRoles(teamAPlayers, teamATargets);
  const assignedB = assignRoles(teamBPlayers, teamBTargets);

  const summary = calcTeamScore(assignedA, assignedB);

  const warnings: string[] = [];
  const overrides = [...assignedA, ...assignedB].filter((p) => p.isPositionOverride);
  if (overrides.length >= 6) warnings.push(`포지션 변경자가 ${overrides.length}명입니다. 역할 배정이 다소 억지일 수 있습니다.`);
  if (summary.fieldGkA === 0 || summary.fieldGkB === 0) warnings.push("한 팀에 필드 GK 가능자가 없습니다. 전담 GK가 없거나 부족하면 문제가 될 수 있습니다.");
  if (Math.abs(summary.activityA - summary.activityB) >= 8) warnings.push("팀별 활동량 차이가 큽니다.");
  if (Math.abs(summary.guestA - summary.guestB) >= 5) warnings.push("정규 선수와 용병 비율이 한쪽으로 몰렸습니다.");

  const quality: TeamBalanceResult["quality"] = warnings.length === 0 ? "좋음" : warnings.length <= 2 ? "주의" : "나쁨";

  return {
    teamA: { name: "A", players: assignedA },
    teamB: { name: "B", players: assignedB },
    summary,
    warnings,
    quality,
  };
}

export function playersByGroup(team: Team, group: PositionGroup): AssignedPlayer[] {
  return team.players.filter((player) => player.assignedGroup === group);
}
