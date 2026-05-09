import { NextResponse } from "next/server";
import { firebaseGetJson, firebasePatchJson } from "@/lib/firebaseRealtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StadiumOption = {
  name: string;
  address?: string;
};

type TeamOption = {
  name: string;
};

export async function GET() {
  try {
    const [stadiumInfo, teamInfo] = await Promise.all([
      firebaseGetJson(["StadiumInfo"]),
      firebaseGetJson(["TeamInfo"]),
    ]);

    return NextResponse.json(
      {
        ok: true,
        stadiums: stadiumOptions(stadiumInfo),
        teams: teamOptions(teamInfo),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load match record options",
        detail: error instanceof Error ? error.message : String(error),
        stadiums: [],
        teams: [],
      },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let body: { type?: string; name?: string };

  try {
    body = (await request.json()) as { type?: string; name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  if (body.type !== "team" || !name || name.length > 40 || /[.#$[\]/]/.test(name)) {
    return NextResponse.json({ error: "Invalid team name" }, { status: 400 });
  }

  try {
    await firebasePatchJson(["TeamInfo", name], {
      TeamName: name,
      TeamLogoURL: "",
    });
    return NextResponse.json(
      { ok: true, team: { name } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to add team",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

function stadiumOptions(value: unknown): StadiumOption[] {
  const records = objectRecords(value);
  return records
    .map(([key, record]) => ({
      name: stringValue(record.StadiumName) || key,
      address: stringValue(record.Address),
    }))
    .filter((stadium) => stadium.name)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function teamOptions(value: unknown): TeamOption[] {
  const records = objectRecords(value);
  return records
    .map(([key, record]) => ({ name: stringValue(record.TeamName) || key }))
    .filter((team) => team.name)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function objectRecords(value: unknown): Array<[string, Record<string, unknown>]> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).map(([key, record]) => [
    key,
    record && typeof record === "object" ? (record as Record<string, unknown>) : {},
  ]);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}
