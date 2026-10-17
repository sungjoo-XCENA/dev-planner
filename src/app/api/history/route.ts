import { NextResponse } from "next/server";
import { dataGetJson } from "@/lib/sharedData";
import { buildHistoryInsightResponse, parseFirebaseMatches } from "@/lib/historyInsights";
import type { HistoryInsightRequest, HistorySource } from "@/types/history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_YEARS = [2025, 2026];
type HistorySourceResult = {
  raw: unknown;
  source: HistorySource;
  warnings: string[];
};

export async function POST(request: Request) {
  let body: HistoryInsightRequest;

  try {
    body = (await request.json()) as HistoryInsightRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const teamA = normalizeRequestNames(body.teamA);
  const teamB = normalizeRequestNames(body.teamB);
  const years = normalizeYears(body.years);

  if (teamA.length === 0 && teamB.length === 0) {
    return NextResponse.json({ error: "teamA or teamB is required" }, { status: 400 });
  }

  const sourceResult = await loadHistorySource();
  if (!sourceResult) {
    return NextResponse.json(
      {
        error: "Match history is unavailable",
        detail:
          "경기 기록 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
      },
      { status: 503 },
    );
  }

  const matches = parseFirebaseMatches(sourceResult.raw, years);
  const response = buildHistoryInsightResponse({
    teamA,
    teamB,
    matches,
    years,
    source: sourceResult.source,
    warnings: sourceResult.warnings,
  });

  return NextResponse.json(response, {
    headers: {
      "cache-control": "no-store",
    },
  });
}

async function loadHistorySource(): Promise<HistorySourceResult | null> {
  try {
    return { raw: await dataGetJson(["MatchInfo"]), source: "oracle", warnings: [] };
  } catch {
    return null;
  }
}

function normalizeRequestNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((name) => (typeof name === "string" ? name.trim() : "")).filter(Boolean);
}

function normalizeYears(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_YEARS;
  const years = value.map((year) => Number(year)).filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100);
  return years.length > 0 ? years : DEFAULT_YEARS;
}
