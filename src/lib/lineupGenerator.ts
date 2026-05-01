import type { AssignedPlayer, DedicatedGoalkeeper, Player, PositionGroup } from "@/types/player";
import type { LineupResult, LineupRole, PlayerLineupSummary, Quarter, TeamQuarterLineup } from "@/types/lineup";
import type { Team, TeamName } from "@/types/team";

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
  bench: AssignedPlayer | null;
  gk: AssignedPlayer | null;
};

function planRotation(
  nonIronmen: AssignedPlayer[],
  hasDedicatedGk: boolean[],
): PerQuarterRotation[] {
  const benchCount = new Map<string, number>();
  const gkCount = new Map<string, number>();
  const slots: PerQuarterRotation[] = [];

  for (let qIdx = 0; qIdx < 4; qIdx += 1) {
    let bench: AssignedPlayer | null = null;
    let gk: AssignedPlayer | null = null;

    if (nonIronmen.length > 0) {
      const benchCandidates = sortByCompositeDesc([...nonIronmen]).reverse();
      benchCandidates.sort((a, b) => {
        const diff = (benchCount.get(a.id) ?? 0) - (benchCount.get(b.id) ?? 0);
        if (diff !== 0) return diff;
        const compDiff = compositeScore(a) - compositeScore(b);
        if (compDiff !== 0) return compDiff;
        return a.name.localeCompare(b.name, "ko");
      });
      bench = benchCandidates[0] ?? null;
      if (bench) benchCount.set(bench.id, (benchCount.get(bench.id) ?? 0) + 1);
    }

    if (!hasDedicatedGk[qIdx] && nonIronmen.length > 0) {
      const gkCandidates = nonIronmen.filter((p) => !bench || p.id !== bench.id);
      gkCandidates.sort((a, b) => {
        const diff = (gkCount.get(a.id) ?? 0) - (gkCount.get(b.id) ?? 0);
        if (diff !== 0) return diff;
        const benchDiff = (benchCount.get(a.id) ?? 0) - (benchCount.get(b.id) ?? 0);
        if (benchDiff !== 0) return benchDiff;
        const compDiff = compositeScore(a) - compositeScore(b);
        if (compDiff !== 0) return compDiff;
        return a.name.localeCompare(b.name, "ko");
      });
      gk = gkCandidates[0] ?? null;
      if (gk) gkCount.set(gk.id, (gkCount.get(gk.id) ?? 0) + 1);
    }

    slots.push({ bench, gk });
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
  const rotation = planRotation(nonIronmen, hasDedicatedGk);

  const warnings: string[] = [];
  const dedicatedRotation: Record<string, string[]> = {};
  const quarters: TeamQuarterLineup[] = [];

  for (let qIdx = 0; qIdx < QUARTERS.length; qIdx += 1) {
    const quarter = QUARTERS[qIdx];
    const isWaitingQuarter = willHaveWaiting && waitingQuarter === quarter;
    const dedicated = dedicatedByQuarter[quarter];

    let benchPlayer = rotation[qIdx].bench;
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
      benchPlayer = topIronman;
    }

    const excluded = new Set<string>();
    if (benchPlayer) excluded.add(benchPlayer.id);
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

    const benchNames: string[] = [];
    if (benchPlayer) benchNames.push(benchPlayer.name);
    const totalDeployed = attackNames.length + midNames.length + defenseNames.length + (gkName && gkName !== "없음" ? 1 : 0);
    if (totalDeployed !== TOTAL_DEPLOYED && !isWaitingQuarter) {
      // sanity guard: shouldn't normally trigger, but warn if formation broken
      warnings.push(`${team.name}팀 ${quarter}Q 라인업 인원 ${totalDeployed} (목표 ${TOTAL_DEPLOYED})`);
    }

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

  return { quarters, summaries, warnings, rotation: dedicatedRotation };
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
