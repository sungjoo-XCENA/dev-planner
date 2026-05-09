import { NextResponse } from "next/server";
import { firebaseGetJson, firebasePatchJson } from "@/lib/firebaseRealtime";
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
    summaryStats: plannerSummaryStats(planner.summaryStats),
    teamScores: plannerTeamScores(planner.teamScores, record.HomeGoal, record.AwayGoal),
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
      const player = stringValue(record.player)?.trim() ?? "";
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
