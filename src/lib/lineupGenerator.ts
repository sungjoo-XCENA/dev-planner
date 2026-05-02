import type { AssignedPlayer, DedicatedGoalkeeper, Player, PositionGroup, StaffRole } from "@/types/player";
import type { LineupResult, LineupRole, PlayerLineupSummary, Quarter, TeamQuarterLineup } from "@/types/lineup";
import type { Team, TeamName } from "@/types/team";
import { formatTeamName } from "@/lib/teamLabels";
import { extractStaffRole } from "@/lib/staffRoles";

const QUARTERS: Quarter[] = [1, 2, 3, 4];
const MAX_DEDICATED_GK_AUTO_ASSIGN = 2;
const FORMATION_OUTFIELD: Record<PositionGroup, number> = {
  ATTACK: 3,
  MID: 3,
  DEFENSE: 4,
};
const TOTAL_DEPLOYED = FORMATION_OUTFIELD.ATTACK + FORMATION_OUTFIELD.MID + FORMATION_OUTFIELD.DEFENSE + 1;

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

function ironmanCountFor(teamSize: number): number {
  // Math: 4쿼터 풀가동 인원 = max(1, 팀인원 - 4×bench/Q - 4×GK)
  // bench/Q = teamSize - 11; total bench = 4(teamSize - 11); GK = 4
  // forced 4Q = teamSize - 4(teamSize - 11) - 4 = 40 - 3 × teamSize
  // 14명 이상 팀이면 0이지만 종합점수 1위는 4Q 보장 → 최소 1.
  return Math.max(1, 40 - 3 * teamSize);
}

function sortByCompositeDesc(players: AssignedPlayer[]): AssignedPlayer[] {
  return [...players].sort((a, b) => {
    const diff = compositeScore(b) - compositeScore(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "ko");
  });
}

type PerQuarterRotation = {
  benches: AssignedPlayer[];
  gk: AssignedPlayer | null;
};

function planRotation(
  nonIronmen: AssignedPlayer[],
  hasDedicatedGk: boolean[],
  benchPerQuarter: number[],
): PerQuarterRotation[] {
  // bench·GK 합산을 events 로 추적 → 같은 사람이 두 번 이벤트 받지 않게
  const eventCount = new Map<string, number>();
  const slots: PerQuarterRotation[] = [];

  const pickLowest = (pool: AssignedPlayer[], excluded: Set<string>): AssignedPlayer | null => {
    const filtered = pool.filter((p) => !excluded.has(p.id));
    if (filtered.length === 0) return null;
    return [...filtered].sort((a, b) => {
      const diff = (eventCount.get(a.id) ?? 0) - (eventCount.get(b.id) ?? 0);
      if (diff !== 0) return diff;
      const compDiff = compositeScore(a) - compositeScore(b);
      if (compDiff !== 0) return compDiff;
      return a.name.localeCompare(b.name, "ko");
    })[0] ?? null;
  };

  for (let qIdx = 0; qIdx < 4; qIdx += 1) {
    const benches: AssignedPlayer[] = [];
    let gk: AssignedPlayer | null = null;
    const usedThisQ = new Set<string>();

    const benchTarget = Math.min(benchPerQuarter[qIdx] ?? 0, nonIronmen.length);
    for (let bIdx = 0; bIdx < benchTarget; bIdx += 1) {
      const b = pickLowest(nonIronmen, usedThisQ);
      if (!b) break;
      benches.push(b);
      usedThisQ.add(b.id);
      eventCount.set(b.id, (eventCount.get(b.id) ?? 0) + 1);
    }

    if (!hasDedicatedGk[qIdx]) {
      gk = pickLowest(nonIronmen, usedThisQ);
      if (gk) {
        usedThisQ.add(gk.id);
        eventCount.set(gk.id, (eventCount.get(gk.id) ?? 0) + 1);
      }
    }

    slots.push({ benches, gk });
  }
  return slots;
}

function assignPositions(
  outfield: AssignedPlayer[],
): { attack: AssignedPlayer[]; mid: AssignedPlayer[]; defense: AssignedPlayer[] } {
  const attack: AssignedPlayer[] = [];
  const mid: AssignedPlayer[] = [];
  const defense: AssignedPlayer[] = [];
  const overflow: AssignedPlayer[] = [];

  for (const p of outfield) {
    if (p.assignedGroup === "ATTACK" && attack.length < FORMATION_OUTFIELD.ATTACK) attack.push(p);
    else if (p.assignedGroup === "MID" && mid.length < FORMATION_OUTFIELD.MID) mid.push(p);
    else if (p.assignedGroup === "DEFENSE" && defense.length < FORMATION_OUTFIELD.DEFENSE) defense.push(p);
    else overflow.push(p);
  }
  for (const p of overflow) {
    if (defense.length < FORMATION_OUTFIELD.DEFENSE) defense.push(p);
    else if (mid.length < FORMATION_OUTFIELD.MID) mid.push(p);
    else if (attack.length < FORMATION_OUTFIELD.ATTACK) attack.push(p);
  }
  return { attack, mid, defense };
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

  const teamSize = team.players.length;
  const sortedComposite = sortByCompositeDesc(team.players);
  const ironmenCount = Math.min(ironmanCountFor(teamSize), Math.max(0, teamSize - 1));
  const ironmen = sortedComposite.slice(0, ironmenCount);
  const ironmanIds = new Set(ironmen.map((p) => p.id));
  const topIronman: AssignedPlayer | null = ironmen[0] ?? null;
  const nonIronmen = team.players.filter((p) => !ironmanIds.has(p.id));
  const willHaveWaiting = waitingPlayer !== null && waitingQuarter !== null;

  const hasDedicatedGk = QUARTERS.map((q) => dedicatedByQuarter[q] !== null);
  // Per-Q nonIM bench count: 정상 팀이면 teamSize - 11.
  // 대기 콜업 쿼터: 대기 들어오면서 ironman 1명 양보 → 추가 bench는 ironman으로 채우므로 nonIM은 baseBench 그대로.
  const baseBench = Math.max(0, teamSize - TOTAL_DEPLOYED);
  const benchPerQuarter = QUARTERS.map(() => baseBench);
  const rotation = planRotation(nonIronmen, hasDedicatedGk, benchPerQuarter);

  const warnings: string[] = [];
  const dedicatedRotation: Record<string, string[]> = {};
  const quarters: TeamQuarterLineup[] = [];

  for (let qIdx = 0; qIdx < QUARTERS.length; qIdx += 1) {
    const quarter = QUARTERS[qIdx];
    const isWaitingQuarter = willHaveWaiting && waitingQuarter === quarter;
    const dedicated = dedicatedByQuarter[quarter];

    let benchPlayers = [...rotation[qIdx].benches];
    let gkPlayer = rotation[qIdx].gk;

    let gkName = "";
    if (dedicated) {
      gkName = dedicated.name;
      gkPlayer = null;
      dedicatedRotation[dedicated.name] = [...(dedicatedRotation[dedicated.name] ?? []), `${quarter}Q ${team.name}팀`];
    } else if (gkPlayer) {
      gkName = gkPlayer.name;
    } else {
      gkName = "없음";
      warnings.push(`${team.name}팀 ${quarter}Q GK 배정 필요`);
    }

    if (isWaitingQuarter && topIronman) {
      // 대기 들어오는 쿼터는 ironman 양보. benches 마지막에 ironman 추가 (rotation에서 이미 추가 1명 산정됨)
      benchPlayers = benchPlayers.filter((p) => p.id !== topIronman.id);
      benchPlayers.push(topIronman);
    }

    const excluded = new Set<string>();
    benchPlayers.forEach((p) => excluded.add(p.id));
    if (gkPlayer) excluded.add(gkPlayer.id);

    const outfieldPool = team.players.filter((p) => !excluded.has(p.id));
    const sortedForAssign = [...outfieldPool].sort((a, b) => {
      const aIron = ironmanIds.has(a.id) ? 0 : 1;
      const bIron = ironmanIds.has(b.id) ? 0 : 1;
      if (aIron !== bIron) return aIron - bIron;
      return compositeScore(b) - compositeScore(a);
    });
    const positions = assignPositions(sortedForAssign);

    let attackNames = positions.attack.map((p) => p.name);
    let midNames = positions.mid.map((p) => p.name);
    let defenseNames = positions.defense.map((p) => p.name);

    if (isWaitingQuarter && waitingPlayer && topIronman) {
      const slotGroup = topIronman.assignedGroup;
      if (slotGroup === "ATTACK") attackNames = [...attackNames, waitingPlayer.name];
      else if (slotGroup === "MID") midNames = [...midNames, waitingPlayer.name];
      else if (slotGroup === "DEFENSE") defenseNames = [...defenseNames, waitingPlayer.name];
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
    const staffRole = extractStaffRole(player.memo);
    return {
      playerId: player.id,
      playerName: player.name,
      staffRole: staffRole ?? undefined,
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

  return { quarters, summaries, warnings, rotation: dedicatedRotation };
}

function buildStaffRoleMap(
  players: Player[],
  dedicatedGks: DedicatedGoalkeeper[],
  waitingPlayers: Player[],
): Record<string, StaffRole> {
  const result: Record<string, StaffRole> = {};
  const add = (item: { name: string; memo?: string }) => {
    const role = extractStaffRole(item.memo);
    if (role) result[item.name] = role;
  };

  players.forEach(add);
  dedicatedGks.forEach(add);
  waitingPlayers.forEach(add);

  return result;
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
    warnings.push(`대기 1명이 ${formatTeamName("A")} ${waitingQuarterA}Q · ${formatTeamName("B")} ${waitingQuarterB}Q에 콜업되었습니다.`);
  }

  return {
    quarters: [...a.quarters, ...b.quarters].sort((x, y) => x.quarter - y.quarter || x.team.localeCompare(y.team)),
    playerSummaries: [...a.summaries, ...b.summaries],
    staffRoles: buildStaffRoleMap([...teamA.players, ...teamB.players], dedicatedGks, waitingPlayers),
    dedicatedGkRotation: rotation,
    warnings: [...warnings, ...a.warnings, ...b.warnings],
  };
}
