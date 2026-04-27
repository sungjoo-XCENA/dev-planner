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

  let csvUrl: string;
  try {
    csvUrl = normalizeGoogleSheetCsvUrl(url);
  } catch {
    return NextResponse.json({ error: "Could not normalize Google Sheets URL" }, { status: 400 });
  }

  try {
    const response = await fetch(csvUrl, { cache: "no-store" });
    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Failed to fetch CSV from Google Sheets",
          upstreamStatus: response.status,
          upstreamStatusText: response.statusText,
          csvUrl,
        },
        { status: 502 },
      );
    }

    const text = await response.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 });
  }
}
