/** Server-only client. Google Sheets remains the planner's editable skill source. */
function configuration() {
  const base = process.env.DEVUTD_API_URL?.replace(/\/+$/, "");
  const token = process.env.DEVUTD_API_TOKEN;
  if (!base || !token) throw new Error("공통 데이터 서버 설정이 필요합니다.");
  const url = new URL(base);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "127.0.0.1")) {
    throw new Error("공통 데이터 서버에는 HTTPS가 필요합니다.");
  }
  return { base, token };
}

export async function dataRequest(parts: string[], init: RequestInit): Promise<Response> {
  const { base, token } = configuration();
  const path = parts.map(encodeURIComponent).join("/");
  const response = await fetch(`${base}/data/${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    // Do not forward internal response bodies or credentials to the browser.
    throw new Error(`공통 데이터 서버 요청 실패 (${response.status})`);
  }
  return response;
}

export async function dataGetJson(parts: string[]): Promise<unknown> {
  return (await dataRequest(parts, { method: "GET" })).json();
}

export async function dataPatchJson(parts: string[], payload: unknown): Promise<unknown> {
  return (await dataRequest(parts, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  })).json();
}

export async function dataDeleteJson(parts: string[]): Promise<unknown> {
  return (await dataRequest(parts, { method: "DELETE" })).json();
}

export async function sharedGetJson(resource: "schedules" | "members"): Promise<unknown> {
  const { base, token } = configuration();
  const response = await fetch(`${base}/${resource}`, { cache: "no-store", signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`공통 데이터 조회 실패 (${response.status})`);
  return response.json();
}
