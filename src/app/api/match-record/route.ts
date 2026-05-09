import { NextResponse } from "next/server";
import { firebaseGetJson, firebasePatchJson } from "@/lib/firebaseRealtime";
import { buildMatchInfoPayload, validateMatchRecordRequest } from "@/lib/matchRecordPayload";
import type {
  MatchRecordConflictResponse,
  MatchRecordEvent,
  MatchRecordLoadResponse,
  MatchRecordSaveRequest,
  MatchRecordSaveResponse,
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
        ? "저장 미리보기 완료"
        : existing
          ? "기존 MatchInfo에 dev-planner 기록을 PATCH 저장했습니다."
          : "새 MatchInfo 기록을 저장했습니다.",
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
    homeTeamName: stringValue(record.HomeTeamName),
    awayTeamName: stringValue(record.AwayTeamName),
    homeGoal: numberValue(record.HomeGoal),
    awayGoal: numberValue(record.AwayGoal),
    comment: stringValue(record.Comment),
    hasPlannerQuarterInfo: Boolean(record.PlannerQuarterInfo),
    events: plannerEvents(planner.Events ?? planner.events),
  };
}

function conflictResponse(matchId: string, path: string, existing: unknown): MatchRecordConflictResponse {
  const record = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
  return {
    error: "MATCH_EXISTS",
    matchId,
    path,
    detail: "이미 같은 MatchInfo 키가 있습니다. 기존 기록에 반영하려면 overwriteExisting=true로 다시 저장하세요.",
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

function quarterValue(value: unknown): Quarter | null {
  const quarter = Number(value);
  return quarter === 1 || quarter === 2 || quarter === 3 || quarter === 4 ? quarter : null;
}

function teamValue(value: unknown): TeamName | null {
  return value === "A" || value === "B" ? value : null;
}
