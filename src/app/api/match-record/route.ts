import { NextResponse } from "next/server";
import { firebaseDeleteJson, firebaseGetJson, firebasePatchJson } from "@/lib/firebaseRealtime";
import { buildMatchInfoPayload, validateMatchRecordRequest } from "@/lib/matchRecordPayload";
import type {
  MatchRecordConflictResponse,
  MatchRecordEvent,
  MatchRecordLoadResponse,
  MatchRecordPlayerStat,
  MatchRecordSaveRequest,
  MatchRecordSaveResponse,
  MatchRecordTeamScore,
} from "@/types/matchRecord";
import type { Quarter } from "@/types/lineup";
import type { StaffRole } from "@/types/player";
import type { TeamName } from "@/types/team";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get("matchId")?.trim() ?? "";

  if (!matchId || !/^[A-Za-z0-9_-]{6,40}$/.test(matchId)) {
    return NextResponse.json({ error: "Invalid matchId" }, { status: 400 });
  }

  try {
    const existing = await firebaseGetJson(["MatchInfo", matchId]);
    if (!existing) {
      return NextResponse.json({ error: "MATCH_NOT_FOUND", matchId, path: `MatchInfo/${matchId}` }, { status: 404 });
    }

    return NextResponse.json(loadResponse(matchId, existing), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load match record",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get("matchId")?.trim() ?? "";

  if (!matchId || !/^[A-Za-z0-9_-]{6,40}$/.test(matchId)) {
    return NextResponse.json({ error: "Invalid matchId" }, { status: 400 });
  }

  const path = `MatchInfo/${matchId}`;

  try {
    const existing = await firebaseGetJson(["MatchInfo", matchId]);
    await firebaseDeleteJson(["MatchInfo", matchId]);

    return NextResponse.json(
      {
        ok: true,
        matchId,
        path,
        deleted: Boolean(existing),
        message: existing ? "해당 날짜 기록을 삭제했습니다." : "해당 날짜에 삭제할 기록이 없습니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to delete match record",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let body: MatchRecordSaveRequest;

  try {
    body = (await request.json()) as MatchRecordSaveRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const errors = validateMatchRecordRequest(body);
  if (errors.length > 0) {
    return NextResponse.json({ error: "Invalid match record", details: errors }, { status: 400 });
  }

  const payload = buildMatchInfoPayload(body);
  const path = `MatchInfo/${body.matchId}`;

  try {
    const existing = await firebaseGetJson(["MatchInfo", body.matchId]);

    if (existing && !body.overwriteExisting && !body.dryRun) {
      return NextResponse.json(conflictResponse(body.matchId, path, existing), { status: 409 });
    }

    if (!body.dryRun) {
      await firebasePatchJson(["MatchInfo", body.matchId], payload);
    }

    const response: MatchRecordSaveResponse = {
      ok: true,
      matchId: body.matchId,
      path,
      dryRun: Boolean(body.dryRun),
      existing: Boolean(existing),
      homeGoal: payload.HomeGoal,
      awayGoal: payload.AwayGoal,
      plannerEventCount: payload.PlannerQuarterInfo.events.length,
      message: body.dryRun
        ? "저장 내용 확인 완료"
        : existing
          ? "기존 경기 기록에 수정 내용을 저장했습니다."
          : "새 경기 기록을 저장했습니다.",
      ...(body.dryRun ? { payload } : {}),
    };

    return NextResponse.json(response, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to save match record",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

function loadResponse(matchId: string, existing: unknown): MatchRecordLoadResponse {
  const record = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
  const planner = record.PlannerQuarterInfo && typeof record.PlannerQuarterInfo === "object"
    ? (record.PlannerQuarterInfo as Record<string, unknown>)
    : {};
  const plannerStats = plannerSummaryStats(planner.summaryStats);

  return {
    ok: true,
    matchId,
    path: `MatchInfo/${matchId}`,
    matchDate: stringValue(record.MatchDate),
    matchTime: stringValue(record.MatchTime),
    matchKind: plannerMatchKind(planner.matchKind) ?? legacyMatchKind(record.MatchType),
    venueName: stringValue(planner.venueName) || stringValue(record.Comment),
    homeTeamName: stringValue(record.HomeTeamName),
    awayTeamName: stringValue(record.AwayTeamName),
    homeGoal: numberValue(record.HomeGoal),
    awayGoal: numberValue(record.AwayGoal),
    comment: stringValue(planner.note),
    hasPlannerQuarterInfo: Boolean(record.PlannerQuarterInfo),
    events: plannerEvents(planner.Events ?? planner.events),
    summaryStats: plannerStats.length > 0 ? plannerStats : legacySummaryStats(record),
    teamScores: plannerTeamScores(planner.teamScores, record.HomeGoal, record.AwayGoal),
    players: playerListsFromRecord(planner, record),
    staffRoles: staffRolesFromRecord(planner, record),
    scoreOverride: plannerScoreOverride(planner.scoreOverride, record.HomeGoal, record.AwayGoal),
    recordMode: plannerRecordMode(planner.recordMode),
  };
}

function conflictResponse(matchId: string, path: string, existing: unknown): MatchRecordConflictResponse {
  const record = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
  return {
    error: "MATCH_EXISTS",
    matchId,
    path,
    detail: "이미 같은 기록 키가 있습니다. 기존 기록에 반영하려면 기존 기록에 저장을 눌러주세요.",
    existingSummary: {
      matchDate: stringValue(record.MatchDate),
      homeTeamName: stringValue(record.HomeTeamName),
      awayTeamName: stringValue(record.AwayTeamName),
      homeGoal: numberValue(record.HomeGoal),
      awayGoal: numberValue(record.AwayGoal),
      hasPlannerQuarterInfo: Boolean(record.PlannerQuarterInfo),
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function plannerMatchKind(value: unknown): "SELF" | "MATCH" | undefined {
  return value === "SELF" || value === "MATCH" ? value : undefined;
}

function plannerRecordMode(value: unknown): "SUMMARY" | "QUARTER" | undefined {
  return value === "SUMMARY" || value === "QUARTER" ? value : undefined;
}

function legacyMatchKind(value: unknown): "SELF" | "MATCH" | undefined {
  if (value === 1) return "SELF";
  if (value === 0) return "MATCH";
  return undefined;
}

function plannerEvents(value: unknown): MatchRecordEvent[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((event, index) => {
      const record = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
      const quarter = quarterValue(record.quarter);
      const team = teamValue(record.team);
      const scorer = stringValue(record.scorer)?.trim() ?? "";
      const assist = stringValue(record.assist)?.trim();

      if (!quarter || !team || !scorer) return null;
      return {
        id: stringValue(record.id) || `event-${index + 1}`,
        quarter,
        team,
        scorer,
        ...(assist ? { assist } : {}),
      };
    })
    .filter((event): event is MatchRecordEvent => Boolean(event));
}

function plannerSummaryStats(value: unknown): MatchRecordPlayerStat[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const team = teamValue(record.team);
      const player = normalizePersonName(stringValue(record.player) ?? "");
      const goals = countValue(record.goals);
      const assists = countValue(record.assists);
      const quarter = quarterValue(record.quarter);

      if (!team || !player || (goals === 0 && assists === 0)) return null;
      return {
        team,
        player,
        goals,
        assists,
        ...(quarter ? { quarter } : {}),
      };
    })
    .filter((stat): stat is MatchRecordPlayerStat => Boolean(stat));
}

function playerListsFromRecord(planner: Record<string, unknown>, record: Record<string, unknown>): Partial<Record<TeamName, string[]>> {
  const teams = planner.teams && typeof planner.teams === "object" ? (planner.teams as Record<string, unknown>) : {};
  const plannerA = plannerTeamPlayers(teams.A);
  const plannerB = plannerTeamPlayers(teams.B);
  return {
    A: plannerA.length > 0 ? plannerA : namesFromFirebaseList(record.AwayPlayerInfo),
    B: plannerB.length > 0 ? plannerB : namesFromFirebaseList(record.HomePlayerInfo),
  };
}

function plannerTeamPlayers(value: unknown): string[] {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return namesFromFirebaseList(record.players);
}

function legacySummaryStats(record: Record<string, unknown>): MatchRecordPlayerStat[] {
  return [
    ...legacyStatsForTeam("A", countNames(namesFromFirebaseList(record.AwayGoalInfo, { unique: false })), countNames(namesFromFirebaseList(record.AwayAssistInfo, { unique: false }))),
    ...legacyStatsForTeam("B", countNames(namesFromFirebaseList(record.HomeGoalInfo, { unique: false })), countNames(namesFromFirebaseList(record.HomeAssistInfo, { unique: false }))),
  ];
}

function legacyStatsForTeam(team: TeamName, goals: Map<string, number>, assists: Map<string, number>): MatchRecordPlayerStat[] {
  const names = uniqueNames([...Array.from(goals.keys()), ...Array.from(assists.keys())]);
  return names.map((player) => ({
    team,
    player,
    goals: goals.get(player) ?? 0,
    assists: assists.get(player) ?? 0,
  })).filter((stat) => stat.goals > 0 || stat.assists > 0);
}

function countNames(names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  names.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
  return counts;
}

function namesFromFirebaseList(value: unknown, options: { unique?: boolean } = {}): string[] {
  const names = firebaseListItems(value).map(nameFromFirebaseItem).filter(Boolean);
  return options.unique === false ? names : uniqueNames(names);
}

function firebaseListItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.keys(record).map((key) => record[key]);
}

function nameFromFirebaseItem(value: unknown): string {
  if (typeof value === "string") return normalizePersonName(value);
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return normalizePersonName(stringValue(record.Name ?? record.name ?? record.PlayerName ?? record.playerName) ?? "");
}

function normalizePersonName(value: string): string {
  return value
    .replace(/\b\dQ(?:-GK\d)?\b/g, " ")
    .replace(/\bGK\d\b/g, " ")
    .replace(/(코치|감독|단장)/g, " ")
    .replace(/[·+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  names.forEach((name) => {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result;
}

const KNOWN_STAFF_ROLES: Partial<Record<string, StaffRole>> = {
  "박지환": "단장",
  "유지웅": "감독",
  "정창영": "코치",
  "하성주": "코치",
  "박경덕": "코치",
  "윤원빈": "코치",
};

function staffRolesFromRecord(planner: Record<string, unknown>, record: Record<string, unknown>): Partial<Record<string, StaffRole>> {
  const roles: Partial<Record<string, StaffRole>> = {};
  applyStaffRolesObject(roles, planner.staffRoles);
  collectStaffRolesFromList(roles, record.AwayPlayerInfo);
  collectStaffRolesFromList(roles, record.HomePlayerInfo);
  collectStaffRolesFromList(roles, record.AwayGoalInfo);
  collectStaffRolesFromList(roles, record.HomeGoalInfo);
  collectStaffRolesFromList(roles, record.AwayAssistInfo);
  collectStaffRolesFromList(roles, record.HomeAssistInfo);

  const seenNames = uniqueNames([
    ...namesFromFirebaseList(record.AwayPlayerInfo),
    ...namesFromFirebaseList(record.HomePlayerInfo),
    ...namesFromFirebaseList(record.AwayGoalInfo),
    ...namesFromFirebaseList(record.HomeGoalInfo),
    ...namesFromFirebaseList(record.AwayAssistInfo),
    ...namesFromFirebaseList(record.HomeAssistInfo),
    ...plannerSummaryStats(planner.summaryStats).map((stat) => stat.player),
  ]);
  seenNames.forEach((name) => {
    if (!roles[name] && KNOWN_STAFF_ROLES[name]) roles[name] = KNOWN_STAFF_ROLES[name];
  });
  return roles;
}

function applyStaffRolesObject(target: Partial<Record<string, StaffRole>>, value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  Object.entries(source).forEach(([rawName, rawRole]) => {
    const name = normalizePersonName(rawName);
    const role = staffRoleValue(rawRole);
    if (name && role) target[name] = role;
  });
}

function collectStaffRolesFromList(target: Partial<Record<string, StaffRole>>, value: unknown) {
  firebaseListItems(value).forEach((item) => {
    const name = nameFromFirebaseItem(item);
    const role = staffRoleFromFirebaseItem(item);
    if (name && role) target[name] = role;
  });
}

function staffRoleFromFirebaseItem(value: unknown): StaffRole | undefined {
  if (typeof value === "string") return staffRoleFromText(value);
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return staffRoleValue(record.staffRole ?? record.StaffRole ?? record.role ?? record.Role)
    ?? staffRoleFromText(stringValue(record.Memo ?? record.memo ?? record.Note ?? record.note ?? record.Name ?? record.name ?? record.PlayerName ?? record.playerName) ?? "");
}

function staffRoleValue(value: unknown): StaffRole | undefined {
  return value === "단장" || value === "감독" || value === "코치" ? value : undefined;
}

function staffRoleFromText(value: string): StaffRole | undefined {
  if (value.includes("단장")) return "단장";
  if (value.includes("감독")) return "감독";
  if (value.includes("코치")) return "코치";
  return undefined;
}

function plannerTeamScores(value: unknown, homeGoal: unknown, awayGoal: unknown): MatchRecordTeamScore[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const team = teamValue(record.team);
        const goals = countValue(record.goals);
        const quarter = quarterValue(record.quarter);
        if (!team || goals === 0) return null;
        return {
          team,
          goals,
          ...(quarter ? { quarter } : {}),
        };
      })
      .filter((score): score is MatchRecordTeamScore => Boolean(score));
  }

  return [
    { team: "A" as const, goals: countValue(awayGoal) },
    { team: "B" as const, goals: countValue(homeGoal) },
  ].filter((score) => score.goals > 0);
}

function plannerScoreOverride(value: unknown, homeGoal: unknown, awayGoal: unknown): Partial<Record<TeamName, number>> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    A: countValue(record.A ?? awayGoal),
    B: countValue(record.B ?? homeGoal),
  };
}

function countValue(value: unknown): number {
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(count, 20);
}

function quarterValue(value: unknown): Quarter | null {
  const quarter = Number(value);
  return quarter === 1 || quarter === 2 || quarter === 3 || quarter === 4 ? quarter : null;
}

function teamValue(value: unknown): TeamName | null {
  return value === "A" || value === "B" ? value : null;
}
