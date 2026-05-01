import type { AssignedPlayer, DedicatedGoalkeeper, Player, PositionGroup } from "@/types/player";
import type { LineupResult, LineupRole, PlayerLineupSummary, Quarter, TeamQuarterLineup } from "@/types/lineup";
import type { Team, TeamName } from "@/types/team";
import { playersByGroup } from "./teamBalancer";

const QUARTERS: Quarter[] = [1, 2, 3, 4];
const POSITION_GROUPS: PositionGroup[] = ["ATTACK", "MID", "DEFENSE"];
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

function findIronmen(team: Team, count: number): AssignedPlayer[] {
  const sorted = [...team.players].sort((a, b) => {
    const diff = compositeScore(b) - compositeScore(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "ko");
  });
  return sorted.slice(0, Math.max(0, Math.min(count, sorted.length)));
}

function ironmanCount(teamSize: number): number {
  // Math: 4-Q players (forced) = max(1, team_size − bench-events − GK-events)
  // bench-events/Q = team_size − 11; total bench-events = 4 × (team_size − 11)
  // GK-events = 4
  // forced = team_size − 4(team_size − 11) − 4 = 40 − 3 × team_size
  return Math.max(1, 40 - 3 * teamSize);
}

function rotateRest(members: AssignedPlayer[], restPerQ: number): Record<Quarter, AssignedPlayer[]> {
  const result: Record<Quarter, AssignedPlayer[]> = { 1: [], 2: [], 3: [], 4: [] };
  if (members.length === 0 || restPerQ <= 0) return result;
  const sorted = [...members].sort((a, b) => {
    const diff = compositeScore(a) - compositeScore(b);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "ko");
  });
  let cursor = 0;
  for (const q of QUARTERS) {
    for (let i = 0; i < restPerQ; i += 1) {
      result[q].push(sorted[cursor % sorted.length]);
      cursor += 1;
    }
  }
  return result;
}

type TeamLineupPlan = {
  quarters: TeamQuarterLineup[];
  summaries: PlayerLineupSummary[];
  warnings: string[];
  rotation: Record<string, string[]>;
};

function lineupForTeam(
  team: Team,
  dedicatedGks: DedicatedGoalkeeper[],
  waitingPlayer: Player | null,
  waitingQuarter: Quarter | null,
): TeamLineupPlan {
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

  const ironmen = findIronmen(team, ironmanCount(team.players.length));
  const topIronman: AssignedPlayer | null = ironmen[0] ?? null;
  const ironmanIds = new Set(ironmen.map((p) => p.id));
  const ironmenByGroup: Record<PositionGroup, number> = {
    ATTACK: ironmen.filter((p) => p.assignedGroup === "ATTACK").length,
    MID: ironmen.filter((p) => p.assignedGroup === "MID").length,
    DEFENSE: ironmen.filter((p) => p.assignedGroup === "DEFENSE").length,
  };
  const topIronmanGroup: PositionGroup | null = topIronman ? topIronman.assignedGroup : null;
  const willHaveWaiting = waitingPlayer !== null && waitingQuarter !== null;

  const nonIronmanByGroup: Record<PositionGroup, AssignedPlayer[]> = {
    ATTACK: groupedPlayers.ATTACK.filter((p) => !ironmanIds.has(p.id)),
    MID: groupedPlayers.MID.filter((p) => !ironmanIds.has(p.id)),
    DEFENSE: groupedPlayers.DEFENSE.filter((p) => !ironmanIds.has(p.id)),
  };

  const demandByGroup: Record<PositionGroup, number> = {
    ATTACK: Math.max(0, FORMATION_OUTFIELD.ATTACK - ironmenByGroup.ATTACK),
    MID: Math.max(0, FORMATION_OUTFIELD.MID - ironmenByGroup.MID),
    DEFENSE: Math.max(0, FORMATION_OUTFIELD.DEFENSE - ironmenByGroup.DEFENSE),
  };

  const restByGroup: Record<PositionGroup, Record<Quarter, AssignedPlayer[]>> = {
    ATTACK: rotateRest(nonIronmanByGroup.ATTACK, Math.max(0, nonIronmanByGroup.ATTACK.length - demandByGroup.ATTACK)),
    MID: rotateRest(nonIronmanByGroup.MID, Math.max(0, nonIronmanByGroup.MID.length - demandByGroup.MID)),
    DEFENSE: rotateRest(nonIronmanByGroup.DEFENSE, Math.max(0, nonIronmanByGroup.DEFENSE.length - demandByGroup.DEFENSE)),
  };

  const warnings: string[] = [];
  const rotation: Record<string, string[]> = {};
  const quarters: TeamQuarterLineup[] = [];
  const gkUseCount = new Map<string, number>();

  for (const quarter of QUARTERS) {
    const isWaitingQuarter = willHaveWaiting && waitingQuarter === quarter;
    const dedicated = dedicatedByQuarter[quarter];

    const restingByGroup: Record<PositionGroup, Set<string>> = {
      ATTACK: new Set(restByGroup.ATTACK[quarter].map((p) => p.id)),
      MID: new Set(restByGroup.MID[quarter].map((p) => p.id)),
      DEFENSE: new Set(restByGroup.DEFENSE[quarter].map((p) => p.id)),
    };

    let gkName = "";
    let gkPlayer: AssignedPlayer | null = null;
    if (dedicated) {
      gkName = dedicated.name;
      rotation[dedicated.name] = [...(rotation[dedicated.name] ?? []), `${quarter}Q ${team.name}팀`];
    } else {
      const candidates: AssignedPlayer[] = [
        ...restByGroup.ATTACK[quarter],
        ...restByGroup.MID[quarter],
        ...restByGroup.DEFENSE[quarter],
      ];
      if (candidates.length === 0) {
        gkName = "없음";
        warnings.push(`${team.name}팀 ${quarter}Q GK 배정 필요`);
      } else {
        candidates.sort((a, b) => {
          const useDiff = (gkUseCount.get(a.id) ?? 0) - (gkUseCount.get(b.id) ?? 0);
          if (useDiff !== 0) return useDiff;
          const compDiff = compositeScore(a) - compositeScore(b);
          if (compDiff !== 0) return compDiff;
          return a.name.localeCompare(b.name, "ko");
        });
        gkPlayer = candidates[0];
        gkName = gkPlayer.name;
        gkUseCount.set(gkPlayer.id, (gkUseCount.get(gkPlayer.id) ?? 0) + 1);
      }
    }

    const buildField = (group: PositionGroup): string[] => {
      const restingHere = restingByGroup[group];
      const groupMembers = groupedPlayers[group];
      const inSlot = groupMembers.filter((p) => {
        if (topIronman && p.id === topIronman.id) {
          return topIronmanGroup === group ? !isWaitingQuarter : true;
        }
        if (ironmanIds.has(p.id)) return true;
        if (gkPlayer && p.id === gkPlayer.id) return false;
        return !restingHere.has(p.id);
      });
      return inSlot.map((p) => p.name);
    };

    let attackNames = buildField("ATTACK");
    let midNames = buildField("MID");
    let defenseNames = buildField("DEFENSE");

    if (isWaitingQuarter && waitingPlayer && topIronmanGroup) {
      if (topIronmanGroup === "ATTACK") attackNames = [...attackNames, waitingPlayer.name];
      else if (topIronmanGroup === "MID") midNames = [...midNames, waitingPlayer.name];
      else if (topIronmanGroup === "DEFENSE") defenseNames = [...defenseNames, waitingPlayer.name];
    }

    const benchPlayers: AssignedPlayer[] = [];
    if (isWaitingQuarter && topIronman) benchPlayers.push(topIronman);
    for (const group of POSITION_GROUPS) {
      for (const p of restByGroup[group][quarter]) {
        if (gkPlayer && p.id === gkPlayer.id) continue;
        benchPlayers.push(p);
      }
    }
    const benchNames = benchPlayers.map((p) => p.name);

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

export function generateLineups(
  teamA: Team,
  teamB: Team,
  dedicatedGks: DedicatedGoalkeeper[],
  waitingPlayers: Player[] = [],
): LineupResult {
  const warnings: string[] = [];
  if (dedicatedGks.length > MAX_DEDICATED_GK_AUTO_ASSIGN) warnings.push("전담 GK가 3명 이상입니다. 2명만 자동 배정합니다.");

  const fieldWaiting = waitingPlayers.filter((p) => p.primaryPosition !== "GK");
  const waitingPlayer = fieldWaiting[0] ?? null;
  const waitingQuarterA: Quarter | null = waitingPlayer ? 1 : null;
  const waitingQuarterB: Quarter | null = waitingPlayer ? 2 : null;

  const a = lineupForTeam(teamA, dedicatedGks, waitingPlayer, waitingQuarterA);
  const b = lineupForTeam(teamB, dedicatedGks, waitingPlayer, waitingQuarterB);

  const rotation: Record<string, string[]> = { ...a.rotation };
  Object.entries(b.rotation).forEach(([name, items]) => {
    rotation[name] = [...(rotation[name] ?? []), ...items];
  });
  dedicatedGks.slice(MAX_DEDICATED_GK_AUTO_ASSIGN).forEach((gk) => {
    rotation[gk.name] = ["교대/대기"];
  });
  if (waitingPlayer) {
    rotation[waitingPlayer.name] = [...(rotation[waitingPlayer.name] ?? []), "대기 콜업"];
  }
  fieldWaiting.slice(1).forEach((wp) => {
    rotation[wp.name] = [...(rotation[wp.name] ?? []), "대기 (콜업 미배정)"];
  });
  if (fieldWaiting.length > 1) {
    warnings.push(`대기 ${fieldWaiting.length}명 중 1명만 자동 콜업됩니다.`);
  }
  if (waitingPlayer && waitingQuarterA && waitingQuarterB) {
    warnings.push(`대기 1명이 A팀 ${waitingQuarterA}Q · B팀 ${waitingQuarterB}Q에 콜업되었습니다.`);
  }

  return {
    quarters: [...a.quarters, ...b.quarters].sort((x, y) => x.quarter - y.quarter || x.team.localeCompare(y.team)),
    playerSummaries: [...a.summaries, ...b.summaries],
    dedicatedGkRotation: rotation,
    warnings: [...warnings, ...a.warnings, ...b.warnings],
  };
}
