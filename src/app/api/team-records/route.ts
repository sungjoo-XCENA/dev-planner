import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { firebaseDeleteJson, firebaseGetJson, firebasePatchJson } from "@/lib/firebaseRealtime";
import type { TeamRecord, TeamRecordGroups, TeamRecordPlayer, TeamRecordSummary } from "@/types/teamRecord";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TeamRecordDb = {
  records: Record<string, TeamRecord>;
};

const STORE_PATH = path.join(process.cwd(), "data", "team-records.json");
const REDIS_RECORDS_KEY = "dev-planner:team-records:v1";
const FIREBASE_RECORDS_PATH = process.env.FIREBASE_TEAM_RECORDS_PATH || "PlannerTeamRecords";

type RedisConfig = {
  url: string;
  token: string;
};

function emptyDb(): TeamRecordDb {
  return { records: {} };
}

function getRedisConfig(): RedisConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function shouldUseFileStore(): boolean {
  return process.env.VERCEL !== "1";
}

function hasFirebaseConfig(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
}

function firebaseRecordsPath(): string[] {
  return FIREBASE_RECORDS_PATH.split("/").map((part) => part.trim()).filter(Boolean);
}

function storageNotConfiguredError(): Error {
  return new Error("Vercel 배포 환경에서는 기존 Firebase 서비스 계정 환경변수(FIREBASE_SERVICE_ACCOUNT_JSON 또는 FIREBASE_SERVICE_ACCOUNT_PATH)가 필요합니다.");
}

async function redisCommand<T>(config: RedisConfig, command: unknown[]): Promise<T> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!response.ok || body.error) {
    throw new Error(body.error ?? `Redis HTTP ${response.status}`);
  }
  return body.result as T;
}

function parseDb(raw: unknown): TeamRecordDb {
  if (!raw) return emptyDb();
  const parsed = typeof raw === "string" ? JSON.parse(raw) as Partial<TeamRecordDb> : raw as Partial<TeamRecordDb>;
  return { records: parsed.records ?? {} };
}

async function readDb(): Promise<TeamRecordDb> {
  const redis = getRedisConfig();
  if (redis) {
    return parseDb(await redisCommand<string | null>(redis, ["GET", REDIS_RECORDS_KEY]));
  }

  if (hasFirebaseConfig()) {
    return { records: parseFirebaseRecords(await firebaseGetJson(firebaseRecordsPath())) };
  }

  if (!shouldUseFileStore()) {
    throw storageNotConfiguredError();
  }

  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return parseDb(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyDb();
    }
    throw error;
  }
}

async function writeDb(db: TeamRecordDb): Promise<void> {
  const redis = getRedisConfig();
  if (redis) {
    await redisCommand<string>(redis, ["SET", REDIS_RECORDS_KEY, JSON.stringify(db)]);
    return;
  }

  if (hasFirebaseConfig()) {
    await firebasePatchJson(firebaseRecordsPath(), db.records);
    return;
  }

  if (!shouldUseFileStore()) {
    throw storageNotConfiguredError();
  }

  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, STORE_PATH);
}

async function deleteRecordByDate(date: string): Promise<boolean> {
  const redis = getRedisConfig();
  if (redis) {
    const db = await readDb();
    const existed = Boolean(db.records[date]);
    delete db.records[date];
    await redisCommand<string>(redis, ["SET", REDIS_RECORDS_KEY, JSON.stringify(db)]);
    return existed;
  }

  if (hasFirebaseConfig()) {
    const pathParts = [...firebaseRecordsPath(), date];
    const existing = await firebaseGetJson(pathParts);
    await firebaseDeleteJson(pathParts);
    const remaining = await firebaseGetJson(pathParts);
    if (remaining) {
      throw new Error(`Firebase team record delete verification failed for ${pathParts.join("/")}`);
    }
    return Boolean(existing);
  }

  if (!shouldUseFileStore()) {
    throw storageNotConfiguredError();
  }

  const db = await readDb();
  const existed = Boolean(db.records[date]);
  delete db.records[date];
  await writeDb(db);
  return existed;
}

function parseFirebaseRecords(raw: unknown): Record<string, TeamRecord> {
  if (!raw || typeof raw !== "object") return {};
  const records: Record<string, TeamRecord> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([date, value]) => {
    const record = normalizeStoredRecord(date, value);
    if (record) records[date] = record;
  });
  return records;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function isRecordPlayer(value: unknown): value is TeamRecordPlayer {
  if (!value || typeof value !== "object") return false;
  const player = value as Partial<TeamRecordPlayer>;
  return (
    typeof player.id === "string" &&
    typeof player.name === "string" &&
    typeof player.memberType === "string" &&
    typeof player.primaryPosition === "string" &&
    typeof player.assignedGroup === "string" &&
    typeof player.assignmentReason === "string" &&
    typeof player.isPositionOverride === "boolean"
  );
}

function isRecordGroups(value: unknown): value is TeamRecordGroups {
  if (!value || typeof value !== "object") return false;
  const groups = value as Partial<TeamRecordGroups>;
  return (
    Array.isArray(groups.attack) &&
    Array.isArray(groups.mid) &&
    Array.isArray(groups.defense) &&
    groups.attack.every(isRecordPlayer) &&
    groups.mid.every(isRecordPlayer) &&
    groups.defense.every(isRecordPlayer)
  );
}

function normalizeRecord(input: unknown, existing?: TeamRecord): TeamRecord | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Partial<TeamRecord>;
  if (!isIsoDate(record.date)) return null;
  if (!record.teams || !isRecordGroups(record.teams.A) || !isRecordGroups(record.teams.B)) return null;
  if (typeof record.shareUrl !== "string" || record.shareUrl.trim().length === 0) return null;

  const now = new Date().toISOString();
  return {
    date: record.date,
    teams: record.teams,
    shareUrl: record.shareUrl,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function normalizeStoredRecord(date: string, input: unknown): TeamRecord | null {
  if (!isIsoDate(date) || !input || typeof input !== "object") return null;
  const record = input as Partial<TeamRecord>;
  if (!record.teams || !isRecordGroups(record.teams.A) || !isRecordGroups(record.teams.B)) return null;
  if (typeof record.shareUrl !== "string" || record.shareUrl.trim().length === 0) return null;
  const now = new Date().toISOString();
  return {
    date,
    teams: record.teams,
    shareUrl: record.shareUrl,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };
}

function teamSize(groups: TeamRecordGroups): number {
  return groups.attack.length + groups.mid.length + groups.defense.length;
}

function toSummary(record: TeamRecord): TeamRecordSummary {
  return {
    date: record.date,
    shareUrl: record.shareUrl,
    updatedAt: record.updatedAt,
    teamAPlayers: teamSize(record.teams.A),
    teamBPlayers: teamSize(record.teams.B),
  };
}

function storageErrorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const month = searchParams.get("month");

  if (date && !isIsoDate(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (month && !isIsoMonth(month)) {
    return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  }

  let db: TeamRecordDb;
  try {
    db = await readDb();
  } catch (error) {
    return storageErrorResponse(error);
  }

  if (date) {
    return NextResponse.json({ record: db.records[date] ?? null });
  }

  const records = Object.values(db.records)
    .filter((record) => !month || record.date.startsWith(`${month}-`))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(toSummary);

  return NextResponse.json({ records });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let db: TeamRecordDb;
  try {
    db = await readDb();
  } catch (error) {
    return storageErrorResponse(error);
  }

  const input = body && typeof body === "object" && "record" in body ? (body as { record: unknown }).record : body;
  const inputDate = input && typeof input === "object" && "date" in input ? (input as { date: unknown }).date : null;
  const existing = isIsoDate(inputDate) ? db.records[inputDate] : undefined;
  const normalized = normalizeRecord(input, existing);
  if (!normalized) {
    return NextResponse.json({ error: "Invalid team record" }, { status: 400 });
  }

  db.records[normalized.date] = normalized;
  try {
    await writeDb(db);
  } catch (error) {
    return storageErrorResponse(error);
  }
  return NextResponse.json({ record: normalized });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!isIsoDate(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  try {
    const deleted = await deleteRecordByDate(date);
    return NextResponse.json(
      {
        ok: true,
        date,
        deleted,
        message: deleted ? "팀 확정 기록을 삭제했습니다." : "삭제할 팀 확정 기록이 없습니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return storageErrorResponse(error);
  }
}
