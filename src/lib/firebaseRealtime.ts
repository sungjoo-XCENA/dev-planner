import { createSign } from "crypto";
import { readFile } from "fs/promises";

const DEFAULT_DATABASE_URL = "https://devutd-8c34e-default-rtdb.firebaseio.com";
const DEFAULT_SERVICE_ACCOUNT_PATH =
  "C:\\Users\\admin\\Documents\\카카오톡 받은 파일\\DevUtd_Tool_20240107\\240107\\DevUtd_Firebase_key.json";
const FIREBASE_SCOPE = "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email";

type FirebaseServiceAccount = {
  client_email?: string;
  private_key?: string;
  project_id?: string;
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export async function firebaseGetJson(pathParts: string[]): Promise<unknown> {
  const response = await firebaseGetRequest(pathParts);
  return response.json();
}

export async function firebasePatchJson(pathParts: string[], payload: unknown): Promise<unknown> {
  const response = await firebaseRequest(pathParts, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

export async function firebaseDeleteJson(pathParts: string[]): Promise<unknown> {
  const response = await firebaseRequest(pathParts, { method: "DELETE" });
  return response.json();
}

export async function firebaseRequest(pathParts: string[], init: RequestInit): Promise<Response> {
  const serviceAccount = await readServiceAccount();
  const databaseUrl = getDatabaseUrl(serviceAccount);
  const accessToken = await getAccessToken(serviceAccount);
  const encodedPath = pathParts.map((part) => encodeURIComponent(part)).join("/");
  const separator = encodedPath.includes("?") ? "&" : "?";
  const url = `${databaseUrl}/${encodedPath}.json${separator}access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url, { cache: "no-store", ...init });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Firebase request failed: HTTP ${response.status} ${detail.slice(0, 240)}`);
  }

  return response;
}

async function firebaseGetRequest(pathParts: string[]): Promise<Response> {
  try {
    return await firebaseRequest(pathParts, { method: "GET" });
  } catch (authError) {
    const response = await firebasePublicRequest(pathParts, { method: "GET" });
    if (response.ok) return response;

    const detail = await response.text();
    throw new Error(
      `Firebase public read failed after authenticated read failed: ${authError instanceof Error ? authError.message : String(authError)}; HTTP ${response.status} ${detail.slice(0, 240)}`,
    );
  }
}

async function firebasePublicRequest(pathParts: string[], init: RequestInit): Promise<Response> {
  const databaseUrl = getDatabaseUrl(null);
  const encodedPath = pathParts.map((part) => encodeURIComponent(part)).join("/");
  return fetch(`${databaseUrl}/${encodedPath}.json`, { cache: "no-store", ...init });
}

async function readServiceAccount(): Promise<FirebaseServiceAccount> {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) as FirebaseServiceAccount;
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || DEFAULT_SERVICE_ACCOUNT_PATH;
  const text = await readFile(serviceAccountPath, "utf8");
  return JSON.parse(text) as FirebaseServiceAccount;
}

function getDatabaseUrl(serviceAccount: FirebaseServiceAccount | null): string {
  if (process.env.FIREBASE_DATABASE_URL) return process.env.FIREBASE_DATABASE_URL.replace(/\/+$/, "");
  if (serviceAccount?.project_id) return `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;
  return DEFAULT_DATABASE_URL;
}

async function getAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.accessToken;

  const accessToken = await createFirebaseAccessToken(serviceAccount, now);
  cachedToken = { accessToken, expiresAt: now + 3600 };
  return accessToken;
}

async function createFirebaseAccessToken(serviceAccount: FirebaseServiceAccount, now: number): Promise<string> {
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Firebase service account is missing client_email or private_key");
  }

  const jwtHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const jwtPayload = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: FIREBASE_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsignedJwt = `${jwtHeader}.${jwtPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`OAuth token request failed: HTTP ${tokenResponse.status}`);
  }

  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error("OAuth token response did not include access_token");
  }

  return tokenJson.access_token;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
