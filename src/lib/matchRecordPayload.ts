import type { TeamQuarterLineup } from "@/types/lineup";
import type { MatchRecordEvent, MatchRecordSaveRequest } from "@/types/matchRecord";
import type { TeamName } from "@/types/team";

const NONE_GK = "없음";
const HOME_TEAM: TeamName = "B";
const AWAY_TEAM: TeamName = "A";

type MatchInfoPayload = {
  MatchDate: string;
  MatchTime: string;
  MatchType: 1;
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
  teamMapping: {
    home: TeamName;
    away: TeamName;
    A: "fluorescent";
    B: "orange";
  };
  teams: Record<TeamName, { label: string; players: string[] }>;
  quarters: Record<string, PlannerQuarterRecord>;
  events: PlannerEventRecord[];
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

type PlannerEventRecord = {
  id: string;
  quarter: number;
  team: TeamName;
  side: "home" | "away";
  scorer: string;
  assist?: string;
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
  if (!Array.isArray(body.quarters) || body.quarters.length === 0) {
    errors.push("라인업 쿼터 정보가 없습니다.");
  }
  if (!Array.isArray(body.events)) {
    errors.push("득점 이벤트 정보가 올바르지 않습니다.");
  }
  return errors;
}

export function buildMatchInfoPayload(body: MatchRecordSaveRequest, savedAt = new Date().toISOString()): MatchInfoPayload {
  const matchDate = normalizeMatchRecordDate(body.matchDate);
  const matchTime = body.matchTime?.trim() ?? "";
  const events = normalizeEvents(body.events ?? []);
  const homeEvents = events.filter((event) => event.team === HOME_TEAM);
  const awayEvents = events.filter((event) => event.team === AWAY_TEAM);
  const teams = {
    A: teamPlayers(body.quarters, "A"),
    B: teamPlayers(body.quarters, "B"),
  };

  return {
    MatchDate: matchDate,
    MatchTime: matchTime,
    MatchType: 1,
    InfoType: 1,
    HomeTeamName: "DevUtd 주황",
    AwayTeamName: "DevUtd 형광",
    HomeGoal: homeEvents.length,
    AwayGoal: awayEvents.length,
    HomePlayerInfo: firebaseNameList(teams.B),
    AwayPlayerInfo: firebaseNameList(teams.A),
    HomeGoalInfo: firebaseNameList(homeEvents.map((event) => event.scorer)),
    AwayGoalInfo: firebaseNameList(awayEvents.map((event) => event.scorer)),
    HomeAssistInfo: firebaseNameList(homeEvents.map((event) => event.assist).filter((name): name is string => Boolean(name))),
    AwayAssistInfo: firebaseNameList(awayEvents.map((event) => event.assist).filter((name): name is string => Boolean(name))),
    Comment: body.memo?.trim() ?? "",
    PlannerQuarterInfo: {
      schemaVersion: 1,
      source: "dev-planner",
      savedAt,
      matchId: body.matchId,
      matchDate,
      matchTime,
      teamMapping: {
        home: HOME_TEAM,
        away: AWAY_TEAM,
        A: "fluorescent",
        B: "orange",
      },
      teams: {
        A: { label: "형광팀", players: teams.A },
        B: { label: "주황팀", players: teams.B },
      },
      quarters: quarterRecords(body.quarters, events),
      events: events.map(toPlannerEvent),
    },
  };
}

function quarterRecords(quarters: TeamQuarterLineup[], events: MatchRecordEvent[]): Record<string, PlannerQuarterRecord> {
  const records: Record<string, PlannerQuarterRecord> = {};
  const quarterNumbers = uniqueNumbers(quarters.map((quarter) => quarter.quarter));

  quarterNumbers.forEach((quarterNumber) => {
    const teamA = quarters.find((quarter) => quarter.team === "A" && quarter.quarter === quarterNumber);
    const teamB = quarters.find((quarter) => quarter.team === "B" && quarter.quarter === quarterNumber);
    const quarterEvents = events.filter((event) => event.quarter === quarterNumber);
    const scoreA = quarterEvents.filter((event) => event.team === "A").length;
    const scoreB = quarterEvents.filter((event) => event.team === "B").length;

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

function teamPlayers(quarters: TeamQuarterLineup[], team: TeamName): string[] {
  const names: string[] = [];
  quarters
    .filter((quarter) => quarter.team === team)
    .forEach((quarter) => {
      names.push(...quarter.attack, ...quarter.mid, ...quarter.defense, ...quarter.bench);
      if (quarter.gk && quarter.gk !== NONE_GK) names.push(quarter.gk);
    });
  return uniqueNames(names);
}

function firebaseNameList(names: string[]): Array<{ Name: string } | null> {
  const unique = uniqueNames(names);
  if (unique.length === 0) return [];
  return [null, ...unique.map((name) => ({ Name: name }))];
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
