import type { DedicatedGoalkeeper, PositionGroup } from "@/types/player";
import type { LineupResult, LineupRole, PlayerLineupSummary, Quarter, TeamQuarterLineup } from "@/types/lineup";
import type { Team, TeamName } from "@/types/team";
import { playersByGroup } from "./teamBalancer";

const QUARTERS: Quarter[] = [1, 2, 3, 4];

function chooseDefenderIronman(team: Team) {
  const defenders = playersByGroup(team, "DEFENSE");
  return [...defenders].sort((a, b) => {
    if (a.canGk !== b.canGk) return a.canGk ? 1 : -1;
    if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
    return b.defenseScore - a.defenseScore;
  })[0];
}

function buildRestPlan(team: Team): Record<Quarter, Record<PositionGroup, string | null>> {
  const attack = playersByGroup(team, "ATTACK");
  const mid = playersByGroup(team, "MID");
  const defense = playersByGroup(team, "DEFENSE");
  const ironman = chooseDefenderIronman(team);
  const restingDefenders = defense.filter((player) => player.id !== ironman.id);

  return {
    1: { ATTACK: attack[0]?.id ?? null, MID: mid[0]?.id ?? null, DEFENSE: restingDefenders[0]?.id ?? null },
    2: { ATTACK: attack[1]?.id ?? null, MID: mid[1]?.id ?? null, DEFENSE: restingDefenders[1]?.id ?? null },
    3: { ATTACK: attack[2]?.id ?? null, MID: mid[2]?.id ?? null, DEFENSE: restingDefenders[2]?.id ?? null },
    4: { ATTACK: attack[3]?.id ?? null, MID: mid[3]?.id ?? null, DEFENSE: restingDefenders[3]?.id ?? null },
  };
}

function dedicatedGkFor(team: TeamName, quarter: Quarter, dedicatedGks: DedicatedGoalkeeper[]): DedicatedGoalkeeper | null {
  if (dedicatedGks.length === 0) return null;
  if (dedicatedGks.length === 1) {
    const assignedTeam: TeamName = quarter % 2 === 1 ? "A" : "B";
    return team === assignedTeam ? dedicatedGks[0] : null;
  }
  const firstToA = quarter % 2 === 1;
  if (team === "A") return firstToA ? dedicatedGks[0] : dedicatedGks[1];
  return firstToA ? dedicatedGks[1] : dedicatedGks[0];
}

function lineupForTeam(team: Team, dedicatedGks: DedicatedGoalkeeper[]) {
  const restPlan = buildRestPlan(team);
  const warnings: string[] = [];
  const quarters: TeamQuarterLineup[] = [];
  const rotation: Record<string, string[]> = {};
  const gkUseCount = new Map<string, number>();

  for (const quarter of QUARTERS) {
    const dedicated = dedicatedGkFor(team.name, quarter, dedicatedGks.slice(0, 2));
    const restingIds = Object.values(restPlan[quarter]).filter((id): id is string => Boolean(id));
    const restingPlayers = team.players.filter((player) => restingIds.includes(player.id));
    let gkName = "";
    let bench = restingPlayers.map((player) => player.name);

    if (dedicated) {
      gkName = dedicated.name;
      rotation[dedicated.name] = [...(rotation[dedicated.name] ?? []), `${quarter}Q ${team.name}팀`];
    } else {
      const gkCandidate = [...restingPlayers]
        .filter((player) => player.canGk)
        .sort((a, b) => (gkUseCount.get(a.id) ?? 0) - (gkUseCount.get(b.id) ?? 0))[0];
      if (gkCandidate) {
        gkName = gkCandidate.name;
        gkUseCount.set(gkCandidate.id, (gkUseCount.get(gkCandidate.id) ?? 0) + 1);
        bench = restingPlayers.filter((player) => player.id !== gkCandidate.id).map((player) => player.name);
      } else {
        gkName = "GK 필요";
        warnings.push(`${team.name}팀 ${quarter}Q 쉬는 선수 중 GK 가능자가 없습니다.`);
      }
    }

    const fieldByGroup = (group: PositionGroup) =>
      team.players
        .filter((player) => player.assignedGroup === group)
        .filter((player) => player.id !== restPlan[quarter][group])
        .map((player) => player.name);

    quarters.push({
      quarter,
      team: team.name,
      attack: fieldByGroup("ATTACK"),
      mid: fieldByGroup("MID"),
      defense: fieldByGroup("DEFENSE"),
      gk: gkName,
      bench,
      warnings: gkName === "GK 필요" ? [`${team.name}팀 ${quarter}Q GK 배정 필요`] : [],
    });
  }

  const summaries: PlayerLineupSummary[] = team.players.map((player) => {
    const roles = QUARTERS.map((quarter) => {
      const q = quarters.find((item) => item.quarter === quarter && item.team === team.name);
      if (!q) return "BENCH" as LineupRole;
      if (q.gk === player.name) return "GK" as LineupRole;
      return [...q.attack, ...q.mid, ...q.defense].includes(player.name) ? "FIELD" : "BENCH";
    });
    return {
      playerId: player.id,
      playerName: player.name,
      team: team.name,
      assignedGroup: player.assignedGroup,
      q1: roles[0],
      q2: roles[1],
      q3: roles[2],
      q4: roles[3],
      fieldCount: roles.filter((role) => role === "FIELD").length,
      gkCount: roles.filter((role) => role === "GK").length,
      benchCount: roles.filter((role) => role === "BENCH").length,
    };
  });

  return { quarters, summaries, warnings, rotation };
}

export function generateLineups(teamA: Team, teamB: Team, dedicatedGks: DedicatedGoalkeeper[]): LineupResult {
  const warnings: string[] = [];
  if (dedicatedGks.length >= 3) warnings.push("전담 GK가 3명 이상입니다. MVP에서는 2명만 자동 배정합니다.");

  const a = lineupForTeam(teamA, dedicatedGks);
  const b = lineupForTeam(teamB, dedicatedGks);
  const rotation: Record<string, string[]> = { ...a.rotation };
  Object.entries(b.rotation).forEach(([name, items]) => {
    rotation[name] = [...(rotation[name] ?? []), ...items];
  });
  dedicatedGks.slice(2).forEach((gk) => {
    rotation[gk.name] = ["교대/대기"];
  });

  return {
    quarters: [...a.quarters, ...b.quarters].sort((x, y) => x.quarter - y.quarter || x.team.localeCompare(y.team)),
    playerSummaries: [...a.summaries, ...b.summaries],
    dedicatedGkRotation: rotation,
    warnings: [...warnings, ...a.warnings, ...b.warnings],
  };
}
