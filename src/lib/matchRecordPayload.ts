import type { TeamQuarterLineup } from "@/types/lineup";
import type { MatchRecordEvent, MatchRecordGuestPlayer, MatchRecordKind, MatchRecordMode, MatchRecordPlayerStat, MatchRecordSaveRequest, MatchRecordTeamScore } from "@/types/matchRecord";
import type { StaffRole } from "@/types/player";
import type { TeamName } from "@/types/team";

const NONE_GK = "없음";
const HOME_TEAM: TeamName = "B";
const AWAY_TEAM: TeamName = "A";
const DEFAULT_SELF_HOME = "DevUtd 주황";
const DEFAULT_SELF_AWAY = "DevUtd 형광";
const DEFAULT_MATCH_HOME = "DevUtd";
const DEFAULT_MATCH_AWAY = "상대팀";

type MatchInfoPayload = {
  MatchDate: string;
  MatchTime: string;
  MatchType: 0 | 1;
  InfoType: 1;
  HomeTeamName: string;
  AwayTeamName: string;
  HomeGoal: number;
  AwayGoal: number;
  HomePlayerInfo: Array<{ Name: string } | null>;
  AwayPlayerInfo: Array<{ Name: string } | null>;
  HomeGoalInfo: Array<{ Name: string } | null>;
  AwayGoalInfo: Array<{ Name: string } | null>;
  HomeAssistInfo: Array<{ Name: string } | null>;
  AwayAssistInfo: Array<{ Name: string } | null>;
  Comment: string;
  PlannerQuarterInfo: PlannerQuarterInfo;
};

type PlannerQuarterInfo = {
  schemaVersion: 1;
  source: "dev-planner";
  savedAt: string;
  matchId: string;
  matchDate: string;
  matchTime: string;
  matchKind: MatchRecordKind;
  venueName: string;
  note: string;
  recordMode: MatchRecordMode;
  scoreOverride: {
    A: number;
    B: number;
    home: number;
    away: number;
  };
  teamMapping: {
    home: TeamName;
    away: TeamName;
    A: "fluorescent";
    B: "orange";
  };
  teams: Record<TeamName, PlannerTeamRecord>;
  staffRoles: Partial<Record<string, StaffRole>>;
  quarters: Record<string, PlannerQuarterRecord>;
  events: PlannerEventRecord[];
  summaryStats: PlannerSummaryStatRecord[];
  guestStats: PlannerSummaryStatRecord[];
  guestPlayers: PlannerGuestPlayerRecord[];
  teamScores: PlannerTeamScoreRecord[];
};

type PlannerQuarterRecord = {
  quarter: number;
  A: PlannerLineupSide;
  B: PlannerLineupSide;
  score: {
    A: number;
    B: number;
    home: number;
    away: number;
  };
  events: PlannerEventRecord[];
};

type PlannerLineupSide = {
  attack: string[];
  mid: string[];
  defense: string[];
  gk: string;
  bench: string[];
};

type PlannerTeamRecord = PlannerLineupSide & {
  label: string;
  players: string[];
};

type PlannerEventRecord = {
  id: string;
  quarter: number;
  team: TeamName;
  side: "home" | "away";
  scorer: string;
  assist?: string;
};

type PlannerSummaryStatRecord = {
  team: TeamName;
  side: "home" | "away";
  player: string;
  goals: number;
  assists: number;
  quarter?: number;
};

type PlannerTeamScoreRecord = {
  team: TeamName;
  side: "home" | "away";
  goals: number;
  quarter?: number;
};

type PlannerGuestPlayerRecord = {
  team: TeamName;
  side: "home" | "away";
  name: string;
  role?: string;
  quarter?: number;
};

export function normalizeMatchRecordDate(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function validateMatchRecordRequest(body: MatchRecordSaveRequest): string[] {
  const errors: string[] = [];
  if (!body.matchId || !/^[A-Za-z0-9_-]{6,40}$/.test(body.matchId)) {
    errors.push("matchId는 영문/숫자/하이픈/언더스코어 6~40자로 입력해주세요.");
  }
  if (normalizeMatchRecordDate(body.matchDate).length !== 8) {
    errors.push("matchDate는 YYYY-MM-DD 또는 YYYYMMDD 형식이어야 합니다.");
  }
  if (!Array.isArray(body.quarters)) {
    errors.push("라인업 쿼터 정보가 올바르지 않습니다.");
  }
  if (!Array.isArray(body.events)) {
    errors.push("득점 이벤트 정보가 올바르지 않습니다.");
  }
  if (body.summaryStats !== undefined && !Array.isArray(body.summaryStats)) {
    errors.push("선수별 일괄 기록 정보가 올바르지 않습니다.");
  }
  if (body.guestStats !== undefined && !Array.isArray(body.guestStats)) {
    errors.push("용병 골 기록 정보가 올바르지 않습니다.");
  }
  if (body.guestPlayers !== undefined && !Array.isArray(body.guestPlayers)) {
    errors.push("용병 선수 정보가 올바르지 않습니다.");
  }
  if (body.lineupQuarters !== undefined && !Array.isArray(body.lineupQuarters)) {
    errors.push("전체 라인업 쿼터 정보가 올바르지 않습니다.");
  }
  if (body.teamScores !== undefined && !Array.isArray(body.teamScores)) {
    errors.push("팀 점수 정보가 올바르지 않습니다.");
  }
  return errors;
}

export function buildMatchInfoPayload(body: MatchRecordSaveRequest, savedAt = new Date().toISOString()): MatchInfoPayload {
  const matchDate = normalizeMatchRecordDate(body.matchDate);
  const matchTime = body.matchTime?.trim() ?? "";
  const matchKind = normalizeMatchKind(body.matchKind);
  const venueName = body.venueName?.trim() || body.memo?.trim() || "";
  const note = body.venueName?.trim() ? body.memo?.trim() ?? "" : "";
  const homeTeamName = body.homeTeamName?.trim() || (matchKind === "SELF" ? DEFAULT_SELF_HOME : DEFAULT_MATCH_HOME);
  const awayTeamName = body.awayTeamName?.trim() || (matchKind === "SELF" ? DEFAULT_SELF_AWAY : DEFAULT_MATCH_AWAY);
  const recordMode = body.recordMode === "QUARTER" ? "QUARTER" : "SUMMARY";
  const events = normalizeEvents(body.events ?? []);
  const summaryStats = normalizeSummaryStats(body.summaryStats ?? []);
  const guestStats = normalizeSummaryStats(body.guestStats ?? []);
  const guestPlayers = normalizeGuestPlayers(body.guestPlayers ?? []);
  const teamScores = normalizeTeamScores(body.teamScores ?? []);
  const homeEvents = events.filter((event) => event.team === HOME_TEAM);
  const awayEvents = events.filter((event) => event.team === AWAY_TEAM);
  const homeSummaryStats = summaryStats.filter((stat) => stat.team === HOME_TEAM);
  const awaySummaryStats = summaryStats.filter((stat) => stat.team === AWAY_TEAM);
  const homeGoalNames = [...homeEvents.map((event) => event.scorer), ...repeatStatNames(homeSummaryStats, "goals")];
  const awayGoalNames = [...awayEvents.map((event) => event.scorer), ...repeatStatNames(awaySummaryStats, "goals")];
  const homeAssistNames = [
    ...homeEvents.map((event) => event.assist).filter((name): name is string => Boolean(name)),
    ...repeatStatNames(homeSummaryStats, "assists"),
  ];
  const awayAssistNames = [
    ...awayEvents.map((event) => event.assist).filter((name): name is string => Boolean(name)),
    ...repeatStatNames(awaySummaryStats, "assists"),
  ];
  const scoreOverride = normalizeScoreOverride(body.scoreOverride);
  const teamScoreTotals = teamScoreSummary(teamScores);
  const homeGoal = teamScores.length > 0 ? teamScoreTotals.B : (scoreOverride?.B ?? homeGoalNames.length);
  const awayGoal = teamScores.length > 0 ? teamScoreTotals.A : (scoreOverride?.A ?? awayGoalNames.length);
  const lineupQuarters = Array.isArray(body.lineupQuarters) ? body.lineupQuarters : body.quarters;
  const memberTeams = {
    A: teamSummary(body.quarters, "A", awayTeamName),
    B: teamSummary(body.quarters, "B", homeTeamName),
  };
  const teams = {
    A: teamSummary(lineupQuarters, "A", awayTeamName),
    B: teamSummary(lineupQuarters, "B", homeTeamName),
  };

  return {
    MatchDate: matchDate,
    MatchTime: matchTime,
    MatchType: matchKind === "SELF" ? 1 : 0,
    InfoType: 1,
    HomeTeamName: homeTeamName,
    AwayTeamName: awayTeamName,
    HomeGoal: homeGoal,
    AwayGoal: awayGoal,
    HomePlayerInfo: firebaseNameList(memberTeams.B.players),
    AwayPlayerInfo: firebaseNameList(memberTeams.A.players),
    HomeGoalInfo: firebaseNameList(homeGoalNames, { unique: false }),
    AwayGoalInfo: firebaseNameList(awayGoalNames, { unique: false }),
    HomeAssistInfo: firebaseNameList(homeAssistNames, { unique: false }),
    AwayAssistInfo: firebaseNameList(awayAssistNames, { unique: false }),
    Comment: venueName,
    PlannerQuarterInfo: {
      schemaVersion: 1,
      source: "dev-planner",
      savedAt,
      matchId: body.matchId,
      matchDate,
      matchTime,
      matchKind,
      venueName,
      note,
      recordMode,
      scoreOverride: {
        A: awayGoal,
        B: homeGoal,
        home: homeGoal,
        away: awayGoal,
      },
      teamMapping: {
        home: HOME_TEAM,
        away: AWAY_TEAM,
        A: "fluorescent",
        B: "orange",
      },
      teams,
      staffRoles: normalizeStaffRoles(body.staffRoles),
      quarters: quarterRecords(lineupQuarters, events, teamScores),
      events: events.map(toPlannerEvent),
      summaryStats: summaryStats.map(toPlannerSummaryStat),
      guestStats: guestStats.map(toPlannerSummaryStat),
      guestPlayers: guestPlayers.map(toPlannerGuestPlayer),
      teamScores: teamScores.map(toPlannerTeamScore),
    },
  };
}

function normalizeMatchKind(value: MatchRecordSaveRequest["matchKind"]): MatchRecordKind {
  return value === "MATCH" ? "MATCH" : "SELF";
}

function quarterRecords(quarters: TeamQuarterLineup[], events: MatchRecordEvent[], teamScores: MatchRecordTeamScore[]): Record<string, PlannerQuarterRecord> {
  const records: Record<string, PlannerQuarterRecord> = {};
  const quarterNumbers = uniqueNumbers(quarters.map((quarter) => quarter.quarter));

  quarterNumbers.forEach((quarterNumber) => {
    const teamA = quarters.find((quarter) => quarter.team === "A" && quarter.quarter === quarterNumber);
    const teamB = quarters.find((quarter) => quarter.team === "B" && quarter.quarter === quarterNumber);
    const quarterEvents = events.filter((event) => event.quarter === quarterNumber);
    const quarterTeamScores = teamScores.filter((score) => score.quarter === quarterNumber);
    const scoreA = quarterTeamScores.length > 0
      ? quarterTeamScores.filter((score) => score.team === "A").reduce((sum, score) => sum + score.goals, 0)
      : quarterEvents.filter((event) => event.team === "A").length;
    const scoreB = quarterTeamScores.length > 0
      ? quarterTeamScores.filter((score) => score.team === "B").reduce((sum, score) => sum + score.goals, 0)
      : quarterEvents.filter((event) => event.team === "B").length;

    records[`Q${quarterNumber}`] = {
      quarter: quarterNumber,
      A: toPlannerSide(teamA),
      B: toPlannerSide(teamB),
      score: {
        A: scoreA,
        B: scoreB,
        home: scoreB,
        away: scoreA,
      },
      events: quarterEvents.map(toPlannerEvent),
    };
  });

  return records;
}

function toPlannerSide(quarter?: TeamQuarterLineup): PlannerLineupSide {
  return {
    attack: quarter?.attack ?? [],
    mid: quarter?.mid ?? [],
    defense: quarter?.defense ?? [],
    gk: quarter?.gk ?? NONE_GK,
    bench: quarter?.bench ?? [],
  };
}

function toPlannerEvent(event: MatchRecordEvent): PlannerEventRecord {
  return {
    id: event.id,
    quarter: event.quarter,
    team: event.team,
    side: event.team === HOME_TEAM ? "home" : "away",
    scorer: event.scorer,
    ...(event.assist ? { assist: event.assist } : {}),
  };
}

function toPlannerSummaryStat(stat: MatchRecordPlayerStat): PlannerSummaryStatRecord {
  return {
    team: stat.team,
    side: stat.team === HOME_TEAM ? "home" : "away",
    player: stat.player,
    goals: stat.goals,
    assists: stat.assists,
    ...(stat.quarter ? { quarter: stat.quarter } : {}),
  };
}

function toPlannerTeamScore(score: MatchRecordTeamScore): PlannerTeamScoreRecord {
  return {
    team: score.team,
    side: score.team === HOME_TEAM ? "home" : "away",
    goals: score.goals,
    ...(score.quarter ? { quarter: score.quarter } : {}),
  };
}

function toPlannerGuestPlayer(player: MatchRecordGuestPlayer): PlannerGuestPlayerRecord {
  return {
    team: player.team,
    side: player.team === HOME_TEAM ? "home" : "away",
    name: player.name,
    ...(player.role ? { role: player.role } : {}),
    ...(player.quarter ? { quarter: player.quarter } : {}),
  };
}

function normalizeEvents(events: MatchRecordEvent[]): MatchRecordEvent[] {
  return events
    .map((event, index) => ({
      id: event.id || `event-${index + 1}`,
      quarter: event.quarter,
      team: event.team,
      scorer: event.scorer.trim(),
      assist: event.assist?.trim() || undefined,
    }))
    .filter((event) => event.scorer && (event.team === "A" || event.team === "B"));
}

function normalizeSummaryStats(stats: MatchRecordPlayerStat[]): MatchRecordPlayerStat[] {
  return stats
    .map((stat) => ({
      team: stat.team,
      player: stat.player.trim(),
      goals: clampCount(stat.goals),
      assists: clampCount(stat.assists),
      quarter: normalizeQuarter(stat.quarter),
    }))
    .filter((stat) => (stat.team === "A" || stat.team === "B") && stat.player && (stat.goals > 0 || stat.assists > 0));
}

function normalizeTeamScores(scores: MatchRecordTeamScore[]): MatchRecordTeamScore[] {
  return scores
    .map((score) => ({
      team: score.team,
      goals: clampCount(score.goals),
      quarter: normalizeQuarter(score.quarter),
    }))
    .filter((score) => (score.team === "A" || score.team === "B") && score.goals > 0);
}

function teamScoreSummary(scores: MatchRecordTeamScore[]): Record<TeamName, number> {
  return scores.reduce<Record<TeamName, number>>((acc, score) => {
    acc[score.team] += score.goals;
    return acc;
  }, { A: 0, B: 0 });
}

function normalizeScoreOverride(value: MatchRecordSaveRequest["scoreOverride"]): { A: number; B: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const A = clampCount(value.A ?? 0);
  const B = clampCount(value.B ?? 0);
  return { A, B };
}

function repeatStatNames(stats: MatchRecordPlayerStat[], key: "goals" | "assists"): string[] {
  return stats.flatMap((stat) => Array.from({ length: stat[key] }, () => stat.player));
}

function clampCount(value: number): number {
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(count, 20);
}

function normalizeQuarter(value: unknown): MatchRecordPlayerStat["quarter"] {
  const quarter = Number(value);
  return quarter === 1 || quarter === 2 || quarter === 3 || quarter === 4 ? quarter : undefined;
}

function teamSummary(quarters: TeamQuarterLineup[], team: TeamName, label: string): PlannerTeamRecord {
  const groups: PlannerLineupSide = {
    attack: [],
    mid: [],
    defense: [],
    gk: NONE_GK,
    bench: [],
  };
  const players: string[] = [];
  const seenPlayers = new Set<string>();

  function addPlayer(name: string) {
    const normalized = name.trim();
    if (!normalized || normalized === NONE_GK || seenPlayers.has(normalized)) return;
    seenPlayers.add(normalized);
    players.push(normalized);
  }

  function addGroupNames(group: keyof Omit<PlannerLineupSide, "gk">, names: string[]) {
    names.forEach((name) => {
      const normalized = name.trim();
      if (!normalized || normalized === NONE_GK || groups[group].includes(normalized)) return;
      groups[group].push(normalized);
      addPlayer(normalized);
    });
  }

  quarters
    .filter((quarter) => quarter.team === team)
    .forEach((quarter) => {
      addGroupNames("attack", quarter.attack);
      addGroupNames("mid", quarter.mid);
      addGroupNames("defense", quarter.defense);
      addGroupNames("bench", quarter.bench);
      if (quarter.gk && quarter.gk !== NONE_GK) {
        if (groups.gk === NONE_GK) groups.gk = quarter.gk.trim();
        addPlayer(quarter.gk);
      }
    });

  return {
    label,
    players,
    ...groups,
  };
}

function normalizeGuestPlayers(players: MatchRecordGuestPlayer[]): MatchRecordGuestPlayer[] {
  return players
    .map((player) => ({
      team: player.team,
      name: player.name?.trim() ?? "",
      role: player.role?.trim() || undefined,
      quarter: normalizeQuarter(player.quarter),
    }))
    .filter((player) => (player.team === "A" || player.team === "B") && player.name);
}

function firebaseNameList(names: string[], options: { unique?: boolean } = {}): Array<{ Name: string } | null> {
  const normalized = names
    .map((name) => name.trim())
    .filter((name) => name && name !== NONE_GK);
  const output = options.unique === false ? normalized : uniqueNames(normalized);
  if (output.length === 0) return [];
  return [null, ...output.map((name) => ({ Name: name }))];
}

function normalizeStaffRoles(value: MatchRecordSaveRequest["staffRoles"]): Partial<Record<string, StaffRole>> {
  const source = value && typeof value === "object" ? value : {};
  const result: Partial<Record<string, StaffRole>> = {};
  Object.entries(source).forEach(([rawName, rawRole]) => {
    const name = rawName.trim();
    if (!name || rawRole !== "단장" && rawRole !== "감독" && rawRole !== "코치") return;
    result[name] = rawRole;
  });
  return result;
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  names.forEach((name) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === NONE_GK || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result;
}

function uniqueNumbers(numbers: number[]): number[] {
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}
