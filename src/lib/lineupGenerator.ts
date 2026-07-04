import type { AssignedPlayer, DedicatedGoalkeeper, Player, PositionGroup, StaffRole } from "@/types/player";
import type { LineupResult, LineupRole, PlayerLineupSummary, Quarter, TeamQuarterLineup } from "@/types/lineup";
import type { Team, TeamName } from "@/types/team";
import type { TeamBalanceOptions } from "@/lib/teamBalancer";
import { formatTeamName } from "@/lib/teamLabels";
import { extractStaffRole } from "@/lib/staffRoles";
import { centerBackScore, centerForwardScore, detailedTechnicalTotal, wingBackScore, wingScore } from "@/lib/playerScores";

const QUARTERS: Quarter[] = [1, 2, 3, 4];
const MAX_DEDICATED_GK_AUTO_ASSIGN = 2;
const DEFAULT_QUARTER_TARGET = 3;
const FORMATION_OUTFIELD: Record<PositionGroup, number> = {
  ATTACK: 3,
  MID: 3,
  DEFENSE: 4,
};
const OUTFIELD_DEPLOYED = FORMATION_OUTFIELD.ATTACK + FORMATION_OUTFIELD.MID + FORMATION_OUTFIELD.DEFENSE;

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
  return detailedTechnicalTotal(p) + p.activityScore;
}

function targetQuarterFor(player: AssignedPlayer, options: TeamBalanceOptions = {}): number {
  const raw = options.quarterTargets?.[player.id] ?? DEFAULT_QUARTER_TARGET;
  return Math.max(1, Math.min(4, Math.round(raw)));
}

function ironmanCountFor(teamSize: number): number {
  // Math: 4쿼터 풀가동 인원 = max(1, 팀인원 - 4×bench/Q - 4×GK)
  // bench/Q = teamSize - 11; total bench = 4(teamSize - 11); GK = 4
  // forced 4Q = teamSize - 4(teamSize - 11) - 4 = 40 - 3 × teamSize
  // 14명 이상 팀이면 0이지만 종합점수 1위는 4Q 보장 → 최소 1.
  return Math.max(1, 40 - 3 * teamSize);
}

function byName(a: AssignedPlayer, b: AssignedPlayer): number {
  return a.name.localeCompare(b.name, "ko");
}

function byCenterForward(a: AssignedPlayer, b: AssignedPlayer): number {
  return centerForwardScore(b) - centerForwardScore(a)
    || wingScore(b) - wingScore(a)
    || compositeScore(b) - compositeScore(a)
    || byName(a, b);
}

function byWing(a: AssignedPlayer, b: AssignedPlayer): number {
  return wingScore(b) - wingScore(a)
    || centerForwardScore(b) - centerForwardScore(a)
    || compositeScore(b) - compositeScore(a)
    || byName(a, b);
}

function byCenterBack(a: AssignedPlayer, b: AssignedPlayer): number {
  return centerBackScore(b) - centerBackScore(a)
    || wingBackScore(b) - wingBackScore(a)
    || compositeScore(b) - compositeScore(a)
    || byName(a, b);
}

function byWingBack(a: AssignedPlayer, b: AssignedPlayer): number {
  return wingBackScore(b) - wingBackScore(a)
    || centerBackScore(b) - centerBackScore(a)
    || compositeScore(b) - compositeScore(a)
    || byName(a, b);
}

function arrangeAttackLine(players: AssignedPlayer[]): AssignedPlayer[] {
  if (players.length <= 1) return players;
  const center = [...players].sort(byCenterForward)[0];
  const wings = players.filter((player) => player.id !== center.id).sort(byWing);
  if (wings.length === 1) return [wings[0], center];
  return [wings[0], center, ...wings.slice(1)];
}

function arrangeDefenseLine(players: AssignedPlayer[]): AssignedPlayer[] {
  if (players.length <= 2) return [...players].sort(byCenterBack);
  const centerBacks = [...players].sort(byCenterBack).slice(0, Math.min(2, players.length));
  const centerBackIds = new Set(centerBacks.map((player) => player.id));
  const wingBacks = players.filter((player) => !centerBackIds.has(player.id)).sort(byWingBack);
  if (wingBacks.length === 0) return centerBacks;
  if (wingBacks.length === 1) return [wingBacks[0], ...centerBacks];
  return [wingBacks[0], ...centerBacks, ...wingBacks.slice(1)];
}

type PerQuarterRotation = {
  benches: AssignedPlayer[];
  gk: AssignedPlayer | null;
};

function emptyGroupCounts(): Record<PositionGroup, number> {
  return { ATTACK: 0, MID: 0, DEFENSE: 0 };
}

function countByAssignedGroup(players: AssignedPlayer[]): Record<PositionGroup, number> {
  return players.reduce((counts, player) => {
    counts[player.assignedGroup] += 1;
    return counts;
  }, emptyGroupCounts());
}

function planRotation(
  players: AssignedPlayer[],
  nonIronmen: AssignedPlayer[],
  hasDedicatedGk: boolean[],
  benchPerQuarter: number[],
  options: TeamBalanceOptions = {},
): PerQuarterRotation[] {
  // bench·GK 합산을 events 로 추적 → 같은 사람이 두 번 이벤트 받지 않게
  const eventCount = new Map<string, number>();
  const slots: PerQuarterRotation[] = [];

  const groupSize = countByAssignedGroup(players);

  const positionShortagePenalty = (player: AssignedPlayer, currentAbsences: AssignedPlayer[]): number => {
    const currentGroupAbsences = currentAbsences.filter((item) => item.assignedGroup === player.assignedGroup).length;
    const remainingGroupPlayers = groupSize[player.assignedGroup] - currentGroupAbsences - 1;
    return remainingGroupPlayers < FORMATION_OUTFIELD[player.assignedGroup] ? 1 : 0;
  };

  const pickLowest = (pool: AssignedPlayer[], excluded: Set<string>, currentAbsences: AssignedPlayer[]): AssignedPlayer | null => {
    const filtered = pool.filter((p) => !excluded.has(p.id));
    if (filtered.length === 0) return null;
    return [...filtered].sort((a, b) => {
      const aNeed = (eventCount.get(a.id) ?? 0) - Math.max(0, 4 - targetQuarterFor(a, options));
      const bNeed = (eventCount.get(b.id) ?? 0) - Math.max(0, 4 - targetQuarterFor(b, options));
      const diff = aNeed - bNeed;
      if (diff !== 0) return diff;
      const shortageDiff = positionShortagePenalty(a, currentAbsences) - positionShortagePenalty(b, currentAbsences);
      if (shortageDiff !== 0) return shortageDiff;
      const compDiff = compositeScore(a) - compositeScore(b);
      if (compDiff !== 0) return compDiff;
      return a.name.localeCompare(b.name, "ko");
    })[0] ?? null;
  };

  for (let qIdx = 0; qIdx < 4; qIdx += 1) {
    const absences: AssignedPlayer[] = [];
    const usedThisQ = new Set<string>();

    const benchTarget = Math.min(benchPerQuarter[qIdx] ?? 0, nonIronmen.length);
    const gkTarget = hasDedicatedGk[qIdx] ? 0 : 1;
    const absenceTarget = Math.min(benchTarget + gkTarget, nonIronmen.length);

    const addAbsence = (player: AssignedPlayer | null) => {
      if (!player) return;
      absences.push(player);
      usedThisQ.add(player.id);
      eventCount.set(player.id, (eventCount.get(player.id) ?? 0) + 1);
    };

    while (absences.length < absenceTarget) {
      const fallback = pickLowest(nonIronmen, usedThisQ, absences);
      if (!fallback) break;
      addAbsence(fallback);
    }

    const benches = absences.slice(0, benchTarget);
    const gk = hasDedicatedGk[qIdx] ? null : (absences[benchTarget] ?? null);

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
  return {
    attack: arrangeAttackLine(attack),
    mid,
    defense: arrangeDefenseLine(defense),
  };
}

type TeamLineupPlan = {
  quarters: TeamQuarterLineup[];
  summaries: PlayerLineupSummary[];
  warnings: string[];
  rotation: Record<string, string[]>;
};

type WaitingCallup = {
  player: Player;
  quarter: Quarter;
};

function lineupForTeam(
  team: Team,
  dedicatedGks: DedicatedGoalkeeper[],
  waitingCallups: WaitingCallup[] = [],
  options: TeamBalanceOptions = {},
): TeamLineupPlan {
  const dedicatedSlice = dedicatedGks.slice(0, MAX_DEDICATED_GK_AUTO_ASSIGN);
  const dedicatedByQuarter: Record<Quarter, DedicatedGoalkeeper | null> = {
    1: dedicatedGkFor(team.name, 1, dedicatedSlice),
    2: dedicatedGkFor(team.name, 2, dedicatedSlice),
    3: dedicatedGkFor(team.name, 3, dedicatedSlice),
    4: dedicatedGkFor(team.name, 4, dedicatedSlice),
  };

  const teamSize = team.players.length;
  const sortedComposite = [...team.players].sort((a, b) => {
    const targetDiff = targetQuarterFor(b, options) - targetQuarterFor(a, options);
    if (targetDiff !== 0) return targetDiff;
    const scoreDiff = compositeScore(b) - compositeScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.name.localeCompare(b.name, "ko");
  });
  const ironmenCount = Math.min(ironmanCountFor(teamSize), Math.max(0, teamSize - 1));
  const preferredIronmen = sortedComposite.filter((player) => targetQuarterFor(player, options) >= 4);
  const ironmen = [...preferredIronmen, ...sortedComposite.filter((player) => targetQuarterFor(player, options) < 4)].slice(0, ironmenCount);
  const ironmanIds = new Set(ironmen.map((p) => p.id));
  const nonIronmen = team.players.filter((p) => !ironmanIds.has(p.id));

  const hasDedicatedGk = QUARTERS.map((q) => dedicatedByQuarter[q] !== null);
  // Per-Q nonIM bench count: field slots are always 10, while GK comes from the team only without a dedicated GK.
  // 대기 콜업 쿼터: 대기 들어오면서 ironman 1명 양보 → 추가 bench는 ironman으로 채우므로 nonIM은 쿼터 기준 그대로.
  const benchPerQuarter = QUARTERS.map((quarter) => {
    const deployedFromTeam = OUTFIELD_DEPLOYED + (dedicatedByQuarter[quarter] ? 0 : 1);
    return Math.max(0, teamSize - deployedFromTeam);
  });
  const rotation = planRotation(team.players, nonIronmen, hasDedicatedGk, benchPerQuarter, options);

  const warnings: string[] = [];
  const dedicatedRotation: Record<string, string[]> = {};
  const quarters: TeamQuarterLineup[] = [];

  for (let qIdx = 0; qIdx < QUARTERS.length; qIdx += 1) {
    const quarter = QUARTERS[qIdx];
    const callupsThisQuarter = waitingCallups.filter((callup) => callup.quarter === quarter);
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

    const replacementExcluded = new Set<string>();
    benchPlayers.forEach((p) => replacementExcluded.add(p.id));
    if (gkPlayer) replacementExcluded.add(gkPlayer.id);
    const replacementPool = [...ironmen, ...sortedComposite]
      .filter((player, index, source) => source.findIndex((item) => item.id === player.id) === index)
      .filter((player) => !replacementExcluded.has(player.id));
    const callupSlots = callupsThisQuarter.flatMap((callup) => {
      const replacement = replacementPool.shift();
      if (!replacement) return [];
      benchPlayers = benchPlayers.filter((p) => p.id !== replacement.id);
      benchPlayers.push(replacement);
      replacementExcluded.add(replacement.id);
      return [{ player: callup.player, group: replacement.assignedGroup }];
    });
    if (callupsThisQuarter.length > callupSlots.length) {
      warnings.push(`${team.name}팀 ${quarter}Q 대기 콜업 ${callupsThisQuarter.length - callupSlots.length}명 배정 필요`);
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

    callupSlots.forEach((slot) => {
      if (slot.group === "ATTACK") attackNames = [...attackNames, slot.player.name];
      else if (slot.group === "MID") midNames = [...midNames, slot.player.name];
      else if (slot.group === "DEFENSE") defenseNames = [...defenseNames, slot.player.name];
    });

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

function waitingQuarterPair(index: number): { first: Quarter; second: Quarter } {
  const pairIndex = Math.floor(index / 2) % 2;
  return pairIndex === 0 ? { first: 1, second: 3 } : { first: 2, second: 4 };
}

function buildWaitingCallups(waitingPlayers: Player[], team: TeamName): WaitingCallup[] {
  return waitingPlayers.map((player, index) => {
    const pair = waitingQuarterPair(index);
    const useFirst = index % 2 === 0;
    const quarter = team === "A"
      ? useFirst ? pair.first : pair.second
      : useFirst ? pair.second : pair.first;
    return { player, quarter };
  });
}

export function generateLineups(
  teamA: Team,
  teamB: Team,
  dedicatedGks: DedicatedGoalkeeper[],
  waitingPlayers: Player[] = [],
  options: TeamBalanceOptions = {},
): LineupResult {
  const warnings: string[] = [];
  if (dedicatedGks.length > MAX_DEDICATED_GK_AUTO_ASSIGN) warnings.push("전담 GK가 3명 이상입니다. 2명만 자동 배정합니다.");

  const fieldWaiting = waitingPlayers.filter((p) => p.primaryPosition !== "GK");
  const waitingCallupsA = buildWaitingCallups(fieldWaiting, "A");
  const waitingCallupsB = buildWaitingCallups(fieldWaiting, "B");

  const a = lineupForTeam(teamA, dedicatedGks, waitingCallupsA, options);
  const b = lineupForTeam(teamB, dedicatedGks, waitingCallupsB, options);

  const rotation: Record<string, string[]> = { ...a.rotation };
  Object.entries(b.rotation).forEach(([name, items]) => {
    rotation[name] = [...(rotation[name] ?? []), ...items];
  });
  dedicatedGks.slice(MAX_DEDICATED_GK_AUTO_ASSIGN).forEach((gk) => {
    rotation[gk.name] = ["교대/대기"];
  });
  waitingCallupsA.forEach((callup) => {
    rotation[callup.player.name] = [...(rotation[callup.player.name] ?? []), `${formatTeamName("A")} ${callup.quarter}Q`];
  });
  waitingCallupsB.forEach((callup) => {
    rotation[callup.player.name] = [...(rotation[callup.player.name] ?? []), `${formatTeamName("B")} ${callup.quarter}Q`];
  });
  if (fieldWaiting.length > 0) {
    warnings.push(`대기 ${fieldWaiting.length}명이 양 팀에 1쿼터씩 공용 출전합니다.`);
  }

  return {
    quarters: [...a.quarters, ...b.quarters].sort((x, y) => x.quarter - y.quarter || x.team.localeCompare(y.team)),
    playerSummaries: [...a.summaries, ...b.summaries],
    staffRoles: buildStaffRoleMap([...teamA.players, ...teamB.players], dedicatedGks, waitingPlayers),
    dedicatedGkRotation: rotation,
    warnings: [...warnings, ...a.warnings, ...b.warnings],
  };
}
