import { NextResponse } from "next/server";

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
    return NextResponse.json({ error: "Invalid CSV URL" }, { status: 400 });
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only https URLs are allowed" }, { status: 400 });
  }

  const allowedHosts = ["docs.google.com", "spreadsheets.google.com"];
  if (!allowedHosts.includes(parsed.hostname)) {
    return NextResponse.json({ error: "Only Google Sheets CSV URLs are allowed" }, { status: 400 });
  }

  try {
    const response = await fetch(parsed.toString(), { cache: "no-store" });
    if (!response.ok) {
      return NextResponse.json({ error: `Failed to fetch CSV: HTTP ${response.status}` }, { status: 502 });
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
