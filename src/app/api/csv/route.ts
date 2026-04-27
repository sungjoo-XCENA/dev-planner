import { NextResponse } from "next/server";

function normalizeGoogleSheetCsvUrl(url: string): string {
  const parsed = new URL(url);

  // Already an export CSV URL.
  if (parsed.pathname.includes("/export") && parsed.searchParams.get("format") === "csv") {
    return parsed.toString();
  }

  // Normal shared/edit URL:
  // https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit?usp=sharing#gid=0
  const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) {
    return parsed.toString();
  }

  const spreadsheetId = match[1];
  let gid = parsed.searchParams.get("gid") ?? "0";

  if (parsed.hash) {
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    gid = hashParams.get("gid") ?? gid;
  }

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

function buildCandidateCsvUrls(url: string): string[] {
  const normalized = normalizeGoogleSheetCsvUrl(url);
  const parsed = new URL(normalized);
  const gid = parsed.searchParams.get("gid") ?? "0";

  const candidates = [
    normalized,
    `https://docs.google.com/spreadsheets/d/${parsed.pathname.split("/")[3]}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`,
  ];

  return Array.from(new Set(candidates));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

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

  let candidates: string[];
  try {
    candidates = buildCandidateCsvUrls(url);
  } catch {
    return NextResponse.json({ error: "Could not normalize Google Sheets URL" }, { status: 400 });
  }

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
        failures.push(`${csvUrl} -> HTTP ${response.status} ${response.statusText}`);
        continue;
      }

      const text = await response.text();
      const trimmed = text.trimStart();
      if (!text.trim() || trimmed.startsWith("<!DOCTYPE html") || text.includes("ServiceLogin")) {
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
      error: "Failed to fetch CSV from Google Sheets",
      candidatesTried: candidates,
      failures,
    },
    { status: 502 },
  );
}
