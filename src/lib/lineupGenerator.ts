import type { AssignedPlayer, DedicatedGoalkeeper, PositionGroup } from "@/types/player";
import type { LineupResult, LineupRole, PlayerLineupSummary, Quarter, TeamQuarterLineup } from "@/types/lineup";
import type { Team, TeamName } from "@/types/team";
import { playersByGroup } from "./teamBalancer";

const QUARTERS: Quarter[] = [1, 2, 3, 4];
const MAX_DEDICATED_GK_AUTO_ASSIGN = 2;
const FORMATION_OUTFIELD: Record<PositionGroup, number> = {
  ATTACK: 3,
  MID: 3,
  DEFENSE: 4,
};

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

function compositeScore(p: AssignedPlayer): number {
  return p.attackScore + p.midScore + p.defenseScore + p.activityScore;
}

function pickFairRest(
  pool: AssignedPlayer[],
  restCount: number,
  restCounts: Map<string, number>,
): AssignedPlayer[] {
  if (restCount <= 0) return [];
  return [...pool]
    .sort((a, b) => {
      const diff = (restCounts.get(a.id) ?? 0) - (restCounts.get(b.id) ?? 0);
      if (diff !== 0) return diff;
      const compDiff = compositeScore(a) - compositeScore(b);
      if (compDiff !== 0) return compDiff;
      return a.name.localeCompare(b.name, "ko");
    })
    .slice(0, restCount);
}

function pickGkCandidate(pool: AssignedPlayer[], gkUseCount: Map<string, number>): AssignedPlayer | null {
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    const diff = (gkUseCount.get(a.id) ?? 0) - (gkUseCount.get(b.id) ?? 0);
    if (diff !== 0) return diff;
    const compDiff = compositeScore(a) - compositeScore(b);
    if (compDiff !== 0) return compDiff;
    return a.name.localeCompare(b.name, "ko");
  })[0] ?? null;
}

function lineupForTeam(team: Team, dedicatedGks: DedicatedGoalkeeper[]) {
  const dedicatedSlice = dedicatedGks.slice(0, MAX_DEDICATED_GK_AUTO_ASSIGN);
  const dedicatedByQuarter: Record<Quarter, DedicatedGoalkeeper | null> = {
    1: dedicatedGkFor(team.name, 1, dedicatedSlice),
    2: dedicatedGkFor(team.name, 2, dedicatedSlice),
    3: dedicatedGkFor(team.name, 3, dedicatedSlice),
    4: dedicatedGkFor(team.name, 4, dedicatedSlice),
  };

  const groupedPlayers: Record<PositionGroup, AssignedPlayer[]> = {
    ATTACK: playersByGroup(team, "ATTACK"),
    MID: playersByGroup(team, "MID"),
    DEFENSE: playersByGroup(team, "DEFENSE"),
  };

  const warnings: string[] = [];
  const quarters: TeamQuarterLineup[] = [];
  const rotation: Record<string, string[]> = {};
  const gkUseCount = new Map<string, number>();
  const restCounts: Record<PositionGroup, Map<string, number>> = {
    ATTACK: new Map(),
    MID: new Map(),
    DEFENSE: new Map(),
  };

  for (const quarter of QUARTERS) {
    const dedicated = dedicatedByQuarter[quarter];

    const attRestCount = Math.max(0, groupedPlayers.ATTACK.length - FORMATION_OUTFIELD.ATTACK);
    const midRestCount = Math.max(0, groupedPlayers.MID.length - FORMATION_OUTFIELD.MID);
    const defRestCount = Math.max(0, groupedPlayers.DEFENSE.length - FORMATION_OUTFIELD.DEFENSE - (dedicated ? 0 : 1));

    const restingATT = pickFairRest(groupedPlayers.ATTACK, attRestCount, restCounts.ATTACK);
    const restingMID = pickFairRest(groupedPlayers.MID, midRestCount, restCounts.MID);
    const restingDEF = pickFairRest(groupedPlayers.DEFENSE, defRestCount, restCounts.DEFENSE);

    restingATT.forEach((p) => restCounts.ATTACK.set(p.id, (restCounts.ATTACK.get(p.id) ?? 0) + 1));
    restingMID.forEach((p) => restCounts.MID.set(p.id, (restCounts.MID.get(p.id) ?? 0) + 1));
    restingDEF.forEach((p) => restCounts.DEFENSE.set(p.id, (restCounts.DEFENSE.get(p.id) ?? 0) + 1));

    const restingIds = new Set<string>([
      ...restingATT.map((p) => p.id),
      ...restingMID.map((p) => p.id),
      ...restingDEF.map((p) => p.id),
    ]);

    let gkName = "";
    let teamGkPlayer: AssignedPlayer | null = null;
    if (dedicated) {
      gkName = dedicated.name;
      rotation[dedicated.name] = [...(rotation[dedicated.name] ?? []), `${quarter}Q ${team.name}팀`];
    } else {
      const onPitchDef = groupedPlayers.DEFENSE.filter((p) => !restingIds.has(p.id));
      teamGkPlayer = pickGkCandidate(onPitchDef, gkUseCount);
      if (teamGkPlayer) {
        gkName = teamGkPlayer.name;
        gkUseCount.set(teamGkPlayer.id, (gkUseCount.get(teamGkPlayer.id) ?? 0) + 1);
      } else {
        gkName = "없음";
        warnings.push(`${team.name}팀 ${quarter}Q GK 배정 필요`);
      }
    }

    const fieldExclude = new Set<string>(restingIds);
    if (teamGkPlayer) fieldExclude.add(teamGkPlayer.id);

    const attackNames = groupedPlayers.ATTACK.filter((p) => !fieldExclude.has(p.id)).map((p) => p.name);
    const midNames = groupedPlayers.MID.filter((p) => !fieldExclude.has(p.id)).map((p) => p.name);
    const defenseNames = groupedPlayers.DEFENSE.filter((p) => !fieldExclude.has(p.id)).map((p) => p.name);
    const benchNames = team.players.filter((p) => restingIds.has(p.id)).map((p) => p.name);

    quarters.push({
      quarter,
      team: team.name,
      attack: attackNames,
      mid: midNames,
      defense: defenseNames,
      gk: gkName,
      bench: benchNames,
      warnings: gkName === "없음" ? [`${team.name}팀 ${quarter}Q GK 배정 필요`] : [],
    });
  }

  const quarterByNumber = new Map(quarters.map((q) => [q.quarter, q]));
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
