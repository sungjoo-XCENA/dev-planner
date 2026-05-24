import { NextResponse } from "next/server";

function getSheetInfo(url: string): { spreadsheetId: string; gid: string } | null {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) return null;

  let gid = parsed.searchParams.get("gid") ?? "0";
  if (parsed.hash) {
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    gid = hashParams.get("gid") ?? gid;
  }

  return { spreadsheetId: match[1], gid };
}

function csvCandidateUrls(url: string, sheetName?: string): string[] {
  const parsed = new URL(url);

  if (!sheetName && parsed.pathname.includes("/export") && parsed.searchParams.get("format") === "csv") {
    return [parsed.toString()];
  }

  const info = getSheetInfo(url);
  if (!info) return [parsed.toString()];

  const { spreadsheetId, gid } = info;
  if (sheetName) {
    return [
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&headers=1`,
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`,
    ];
  }

  return [
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}&headers=1`,
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`,
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`,
  ];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const sheetName = searchParams.get("sheet")?.trim() || undefined;

  if (!url) {
    return NextResponse.json({ error: "url query parameter is required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid Google Sheets URL" }, { status: 400 });
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only https URLs are allowed" }, { status: 400 });
  }

  const allowedHosts = ["docs.google.com", "spreadsheets.google.com"];
  if (!allowedHosts.includes(parsed.hostname)) {
    return NextResponse.json({ error: "Only Google Sheets URLs are allowed" }, { status: 400 });
  }

  const candidates = csvCandidateUrls(url, sheetName);
  const failures: string[] = [];

  for (const csvUrl of candidates) {
    try {
      const response = await fetch(csvUrl, {
        cache: "no-store",
        headers: {
          "user-agent": "Mozilla/5.0 dev-planner",
          accept: "text/csv,text/plain,*/*",
        },
      });

      if (!response.ok) {
        failures.push(`${csvUrl} -> HTTP ${response.status}`);
        continue;
      }

      const text = await response.text();
      if (!text.trim() || text.trimStart().startsWith("<!DOCTYPE html") || text.includes("ServiceLogin")) {
        failures.push(`${csvUrl} -> non-csv response`);
        continue;
      }

      return new NextResponse(text, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      failures.push(`${csvUrl} -> ${String(error)}`);
    }
  }

  return NextResponse.json(
    {
      error: "Failed to fetch CSV",
      detail: failures.join(" | "),
    },
    { status: 502 },
  );
}
