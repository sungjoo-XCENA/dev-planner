import { NextResponse } from "next/server";
import { firebaseGetJson, firebasePatchJson } from "@/lib/firebaseRealtime";
import { buildMatchInfoPayload, validateMatchRecordRequest } from "@/lib/matchRecordPayload";
import type { MatchRecordConflictResponse, MatchRecordSaveRequest, MatchRecordSaveResponse } from "@/types/matchRecord";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
