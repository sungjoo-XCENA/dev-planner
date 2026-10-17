import { NextResponse } from "next/server";
import { sharedGetJson } from "@/lib/sharedData";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await sharedGetJson("schedules"), { headers: { "cache-control": "no-store" } }); }
  catch { return NextResponse.json({ error: "일정을 불러오지 못했습니다." }, { status: 502 }); }
}
