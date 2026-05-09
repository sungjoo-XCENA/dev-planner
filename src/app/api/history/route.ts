import { createSign } from "crypto";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { buildHistoryInsightResponse, parseFirebaseMatches } from "@/lib/historyInsights";
import type { HistoryInsightRequest, HistorySource } from "@/types/history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_YEARS = [2025, 2026];
const DEFAULT_MATCH_INFO_PATH =
  "C:\\Users\\admin\\Documents\\카카오톡 받은 파일\\DevUtd_Tool_20240107\\240107\\last_FireBaseDB_MatchInfo.json";
const DEFAULT_SERVICE_ACCOUNT_PATH =
  "C:\\Users\\admin\\Documents\\카카오톡 받은 파일\\DevUtd_Tool_20240107\\240107\\DevUtd_Firebase_key.json";

type FirebaseServiceAccount = {
  client_email?: string;
  private_key?: string;
  project_id?: string;
};

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
        detail: "Set FIREBASE_DATABASE_URL or FIREBASE_MATCHINFO_PATH, or keep the local Firebase cache file in place.",
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
  const databaseUrl = process.env.FIREBASE_DATABASE_URL?.replace(/\/+$/, "");
  if (!databaseUrl) return null;

  try {
    const serviceAccount = await readServiceAccount();
    if (!serviceAccount?.client_email || !serviceAccount.private_key) {
      warnings.push("Firebase 서비스 계정 정보를 찾지 못해 로컬 캐시로 대체합니다.");
      return null;
    }

    const accessToken = await createFirebaseAccessToken(serviceAccount);
    const response = await fetch(`${databaseUrl}/MatchInfo.json`, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      warnings.push(`Firebase MatchInfo 조회 실패: HTTP ${response.status}`);
      return null;
    }

    return {
      raw: await response.json(),
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

async function readServiceAccount(): Promise<FirebaseServiceAccount | null> {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) as FirebaseServiceAccount;
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || DEFAULT_SERVICE_ACCOUNT_PATH;
  try {
    const text = await readFile(serviceAccountPath, "utf8");
    return JSON.parse(text) as FirebaseServiceAccount;
  } catch {
    return null;
  }
}

async function createFirebaseAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Firebase service account is missing client_email or private_key");
  }

  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const jwtPayload = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsignedJwt = `${jwtHeader}.${jwtPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`OAuth token request failed: HTTP ${tokenResponse.status}`);
  }

  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error("OAuth token response did not include access_token");
  }

  return tokenJson.access_token;
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

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
