import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { firebaseGetJson } from "@/lib/firebaseRealtime";
import { buildHistoryInsightResponse, parseFirebaseMatches } from "@/lib/historyInsights";
import type { HistoryInsightRequest, HistorySource } from "@/types/history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_YEARS = [2025, 2026];
const DEFAULT_MATCH_INFO_PATH =
  "C:\\Users\\admin\\Documents\\카카오톡 받은 파일\\DevUtd_Tool_20240107\\240107\\last_FireBaseDB_MatchInfo.json";

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
        error: "Firebase match history was not found",
        detail:
          "Firebase MatchInfo 조회에 실패했습니다. FIREBASE_SERVICE_ACCOUNT_JSON/FIREBASE_SERVICE_ACCOUNT_PATH 또는 FIREBASE_MATCHINFO_PATH를 확인해주세요.",
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
  const warnings: string[] = [];
  const firebase = await loadFromFirebase(warnings);
  if (firebase) return firebase;

  const cache = await loadFromCache(warnings);
  if (cache) return cache;

  return null;
}

async function loadFromFirebase(warnings: string[]): Promise<HistorySourceResult | null> {
  try {
    return {
      raw: await firebaseGetJson(["MatchInfo"]),
      source: "firebase",
      warnings,
    };
  } catch (error) {
    warnings.push(`Firebase MatchInfo 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function loadFromCache(warnings: string[]): Promise<HistorySourceResult | null> {
  const matchInfoPath = process.env.FIREBASE_MATCHINFO_PATH || DEFAULT_MATCH_INFO_PATH;

  try {
    const text = await readFile(matchInfoPath, "utf8");
    return {
      raw: JSON.parse(text),
      source: "cache",
      warnings,
    };
  } catch (error) {
    warnings.push(`Firebase 캐시 파일 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
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
