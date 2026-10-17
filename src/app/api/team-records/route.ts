import { NextResponse } from "next/server";
import { dataDeleteJson, dataGetJson, dataPatchJson } from "@/lib/sharedData";
import type { TeamQuarterLineup } from "@/types/lineup";
import type { TeamRecord, TeamRecordGroups, TeamRecordPlayer, TeamRecordSummary } from "@/types/teamRecord";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TeamRecordDb = {
  records: Record<string, TeamRecord>;
};

const RECORDS_PATH = "PlannerTeamRecords";

async function readDb(): Promise<TeamRecordDb> {
  return { records: parseFirebaseRecords(await dataGetJson([RECORDS_PATH])) };
}

async function writeRecord(record: TeamRecord): Promise<void> {
  await dataPatchJson([RECORDS_PATH, record.date], record);
}

async function deleteRecordByDate(date: string): Promise<boolean> {
  const existing = await dataGetJson([RECORDS_PATH, date]);
  await dataDeleteJson([RECORDS_PATH, date]);
  return Boolean(existing);
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

function isQuarterNumber(value: unknown): value is TeamQuarterLineup["quarter"] {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isTeamName(value: unknown): value is TeamQuarterLineup["team"] {
  return value === "A" || value === "B";
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value;
}

function normalizeLineupQuarter(value: unknown): TeamQuarterLineup | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<TeamQuarterLineup>;
  const attack = stringArray(record.attack);
  const mid = stringArray(record.mid);
  const defense = stringArray(record.defense);
  const bench = stringArray(record.bench);
  const warnings = stringArray(record.warnings);

  if (!isQuarterNumber(record.quarter) || !isTeamName(record.team) || !attack || !mid || !defense || !bench) return null;

  return {
    quarter: record.quarter,
    team: record.team,
    attack,
    mid,
    defense,
    gk: typeof record.gk === "string" ? record.gk : "",
    bench,
    warnings: warnings ?? [],
  };
}

function normalizeLineup(value: unknown): TeamRecord["lineup"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<NonNullable<TeamRecord["lineup"]>>;
  if (typeof record.savedAt !== "string" || !Array.isArray(record.quarters)) return undefined;
  const quarters = record.quarters.map(normalizeLineupQuarter);
  if (quarters.some((quarter) => !quarter)) return undefined;
  return {
    savedAt: record.savedAt,
    quarters: quarters as TeamQuarterLineup[],
  };
}

function normalizeRecord(input: unknown, existing?: TeamRecord): TeamRecord | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Partial<TeamRecord>;
  if (!isIsoDate(record.date)) return null;
  if (!record.teams || !isRecordGroups(record.teams.A) || !isRecordGroups(record.teams.B)) return null;
  if (typeof record.shareUrl !== "string" || record.shareUrl.trim().length === 0) return null;

  const now = new Date().toISOString();
  const lineup = normalizeLineup(record.lineup);
  return {
    date: record.date,
    teams: record.teams,
    ...(lineup ? { lineup } : {}),
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
  const lineup = normalizeLineup(record.lineup);
  return {
    date,
    teams: record.teams,
    ...(lineup ? { lineup } : {}),
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
    hasLineup: Boolean(record.lineup?.quarters.length),
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
    await writeRecord(normalized);
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
