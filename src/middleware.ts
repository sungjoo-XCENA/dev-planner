import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const readOnly = ["GET", "HEAD"].includes(request.method);
  if ((readOnly && !["/admin", "/api/team-records"].includes(path)) || (path === "/api/history" && request.method === "POST")) {
    return NextResponse.next();
  }
  const expected = process.env.DEVUTD_ADMIN_CREDENTIAL;
  if (!expected) return new NextResponse("관리자 인증 설정이 필요합니다.", { status: 503 });
  let supplied = "";
  try {
    const authorization = request.headers.get("authorization") || "";
    if (authorization.startsWith("Basic ")) supplied = atob(authorization.slice(6));
  } catch { /* Treat malformed credentials as anonymous. */ }
  // Compare every byte, including length, without an early mismatch return.
  let mismatch = supplied.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) mismatch |= (supplied.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  if (mismatch) return new NextResponse("관리자 로그인이 필요합니다.", {
    status: 401, headers: { "WWW-Authenticate": 'Basic realm="DevUtd admin", charset="UTF-8"', "Cache-Control": "no-store" },
  });
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    let sameOrigin = false;
    try {
      const source = new URL(origin || "");
      // Next's internal URL can use localhost even when the request Host differs.
      sameOrigin = source.host === request.headers.get("host") && source.protocol === request.nextUrl.protocol;
    } catch { /* Missing or invalid Origin fails closed. */ }
    if (!sameOrigin) return new NextResponse("허용되지 않은 요청입니다.", { status: 403 });
  }
  return path === "/admin" ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
