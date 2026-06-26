import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { firebaseGetJson, firebasePatchJson } from "@/lib/firebaseRealtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ShareKind = "teams" | "lineup" | "matchLineup";

type StoredShare = {
  version: 1;
  kind: ShareKind;
  payload: unknown;
  createdAt: string;
};

const FIREBASE_SHARE_PATH = process.env.FIREBASE_SHARE_PATH || "PlannerShares";

function shareBasePath(): string[] {
  return FIREBASE_SHARE_PATH.split("/").map((part) => part.trim()).filter(Boolean);
}

function createShareId(): string {
  return randomBytes(9).toString("base64url");
}

function isValidShareId(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

function normalizeKind(value: unknown): ShareKind | null {
  return value === "teams" || value === "lineup" || value === "matchLineup" ? value : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { kind?: unknown; payload?: unknown };
    const kind = normalizeKind(body.kind);
    if (!kind || body.payload == null) {
      return NextResponse.json({ error: "공유 데이터가 올바르지 않습니다." }, { status: 400 });
    }

    const id = createShareId();
    const record: StoredShare = {
      version: 1,
      kind,
      payload: body.payload,
      createdAt: new Date().toISOString(),
    };

    await firebasePatchJson([...shareBasePath(), id], record);
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { error: "공유 링크 저장에 실패했습니다.", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    if (!isValidShareId(id)) {
      return NextResponse.json({ error: "공유 링크 키가 올바르지 않습니다." }, { status: 400 });
    }

    const record = await firebaseGetJson([...shareBasePath(), id]) as Partial<StoredShare> | null;
    const kind = normalizeKind(record?.kind);
    if (!record || record.version !== 1 || !kind || record.payload == null) {
      return NextResponse.json({ error: "공유 데이터를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ kind, payload: record.payload });
  } catch (error) {
    return NextResponse.json(
      { error: "공유 링크 조회에 실패했습니다.", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
