import type { AssignedPlayer, DedicatedGoalkeeper, PositionGroup } from "@/types/player";
import type { LineupResult, LineupRole, PlayerLineupSummary, Quarter, TeamQuarterLineup } from "@/types/lineup";
import type { Team, TeamName } from "@/types/team";
import { playersByGroup } from "./teamBalancer";

const QUARTERS: Quarter[] = [1, 2, 3, 4];
const MAX_DEDICATED_GK_AUTO_ASSIGN = 2;
const OUTFIELD_PER_TEAM = 10;
const ON_PITCH_PER_TEAM = 11;

function teamEngagement(hasDedicatedGk: boolean): number {
  return hasDedicatedGk ? OUTFIELD_PER_TEAM : ON_PITCH_PER_TEAM;
}

function buildRestPlan(team: Team, engagementByQuarter: Record<Quarter, number>): Record<Quarter, Set<string>> {
  const result: Record<Quarter, Set<string>> = {
    1: new Set<string>(),
    2: new Set<string>(),
    3: new Set<string>(),
    4: new Set<string>(),
  };
  if (team.players.length === 0) return result;

  const pool = [...team.players].sort((a, b) => {
    const scoreA = a.activityScore + (a.canGk ? 0.5 : 0);
    const scoreB = b.activityScore + (b.canGk ? 0.5 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.name.localeCompare(b.name, "ko");
  });

  const restCounts = new Map<string, number>();
  for (const quarter of QUARTERS) {
    const restCountPerQuarter = Math.max(0, team.players.length - engagementByQuarter[quarter]);
    if (restCountPerQuarter === 0) continue;
    const selected = [...pool]
      .sort((a, b) => {
        const countDiff = (restCounts.get(a.id) ?? 0) - (restCounts.get(b.id) ?? 0);
        if (countDiff !== 0) return countDiff;
        return a.activityScore - b.activityScore;
      })
      .slice(0, restCountPerQuarter);

    selected.forEach((player) => {
      result[quarter].add(player.id);
      restCounts.set(player.id, (restCounts.get(player.id) ?? 0) + 1);
    });
  }

  return result;
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

function groupFieldNames(team: Team, group: PositionGroup, excludedIds: Set<string>): string[] {
  return playersByGroup(team, group)
    .filter((player) => !excludedIds.has(player.id))
    .map((player) => player.name);
}

function chooseFieldGk(onPitchPlayers: AssignedPlayer[], gkUseCount: Map<string, number>): AssignedPlayer | null {
  return [...onPitchPlayers]
    .filter((player) => player.canGk)
    .sort((a, b) => (gkUseCount.get(a.id) ?? 0) - (gkUseCount.get(b.id) ?? 0))[0] ?? null;
}

function lineupForTeam(team: Team, dedicatedGks: DedicatedGoalkeeper[]) {
  const dedicatedSlice = dedicatedGks.slice(0, MAX_DEDICATED_GK_AUTO_ASSIGN);
  const dedicatedByQuarter: Record<Quarter, DedicatedGoalkeeper | null> = {
    1: dedicatedGkFor(team.name, 1, dedicatedSlice),
    2: dedicatedGkFor(team.name, 2, dedicatedSlice),
    3: dedicatedGkFor(team.name, 3, dedicatedSlice),
    4: dedicatedGkFor(team.name, 4, dedicatedSlice),
  };
  const engagementByQuarter: Record<Quarter, number> = {
    1: teamEngagement(!!dedicatedByQuarter[1]),
    2: teamEngagement(!!dedicatedByQuarter[2]),
    3: teamEngagement(!!dedicatedByQuarter[3]),
    4: teamEngagement(!!dedicatedByQuarter[4]),
  };
  const restPlan = buildRestPlan(team, engagementByQuarter);
  const warnings: string[] = [];
  const quarters: TeamQuarterLineup[] = [];
  const rotation: Record<string, string[]> = {};
  const gkUseCount = new Map<string, number>();

  for (const quarter of QUARTERS) {
    const dedicated = dedicatedByQuarter[quarter];
    const restingIds = restPlan[quarter];
    const restingPlayers = team.players.filter((player) => restingIds.has(player.id));
    const onPitchPlayers = team.players.filter((player) => !restingIds.has(player.id));
    const fieldExcludeIds = new Set<string>(restingIds);
    let gkName = "";

    if (dedicated) {
      gkName = dedicated.name;
      rotation[dedicated.name] = [...(rotation[dedicated.name] ?? []), `${quarter}Q ${team.name}팀`];
    } else {
      const gkCandidate = chooseFieldGk(onPitchPlayers, gkUseCount);
      if (gkCandidate) {
        gkName = gkCandidate.name;
        gkUseCount.set(gkCandidate.id, (gkUseCount.get(gkCandidate.id) ?? 0) + 1);
        fieldExcludeIds.add(gkCandidate.id);
      } else {
        gkName = "없음";
        warnings.push(`${team.name}팀 ${quarter}Q GK 배정 필요`);
      }
    }

    quarters.push({
      quarter,
      team: team.name,
      attack: groupFieldNames(team, "ATTACK", fieldExcludeIds),
      mid: groupFieldNames(team, "MID", fieldExcludeIds),
      defense: groupFieldNames(team, "DEFENSE", fieldExcludeIds),
      gk: gkName,
      bench: restingPlayers.map((player) => player.name),
      warnings: gkName === "없음" ? [`${team.name}팀 ${quarter}Q GK 배정 필요`] : [],
    });
  }

  const quarterByNumber = new Map(quarters.map((quarter) => [quarter.quarter, quarter]));
  const roleInQuarter = (playerName: string, quarter: Quarter): LineupRole => {
    const currentQuarter = quarterByNumber.get(quarter);
    if (!currentQuarter) return "BENCH";
    if (currentQuarter.gk === playerName) return "GK";
    const isField = [...currentQuarter.attack, ...currentQuarter.mid, ...currentQuarter.defense].includes(playerName);
    return isField ? "FIELD" : "BENCH";
  };

  const summaries: PlayerLineupSummary[] = team.players.map((player) => {
    const roles = QUARTERS.map((quarter) => roleInQuarter(player.name, quarter));
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
  if (dedicatedGks.length > MAX_DEDICATED_GK_AUTO_ASSIGN) warnings.push("전담 GK가 3명 이상입니다. 2명만 자동 배정합니다.");

  const a = lineupForTeam(teamA, dedicatedGks);
  const b = lineupForTeam(teamB, dedicatedGks);
  const rotation: Record<string, string[]> = { ...a.rotation };
  Object.entries(b.rotation).forEach(([name, items]) => {
    rotation[name] = [...(rotation[name] ?? []), ...items];
  });
  dedicatedGks.slice(MAX_DEDICATED_GK_AUTO_ASSIGN).forEach((gk) => {
    rotation[gk.name] = ["교대/대기"];
  });

  return {
    quarters: [...a.quarters, ...b.quarters].sort((x, y) => x.quarter - y.quarter || x.team.localeCompare(y.team)),
    playerSummaries: [...a.summaries, ...b.summaries],
    dedicatedGkRotation: rotation,
    warnings: [...warnings, ...a.warnings, ...b.warnings],
  };
}
