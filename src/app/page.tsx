"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { AssignedPlayer, AssignedSubRole, DedicatedGoalkeeper, FieldPosition, Player, PositionGroup, StaffRole } from "@/types/player";
import type { PlayerRelation } from "@/types/relation";
import type { LineupResult, LineupRole, Quarter, TeamQuarterLineup } from "@/types/lineup";
import type { TeamBalanceResult, TeamName } from "@/types/team";
import type { HistoryDefenseForm, HistoryInsightResponse, HistoryPairInsight, HistoryPlayerForm, TeamHistoryInsight } from "@/types/history";
import type { TeamRecord, TeamRecordGroups, TeamRecordPlayer } from "@/types/teamRecord";
import type { MatchRecordSaveRequest, MatchRecordSaveResponse } from "@/types/matchRecord";
import { appConfig } from "@/config/appConfig";
import { loadPlayersFromCsv } from "@/lib/loadPlayersFromCsv";
import { POSITIONS, getPositionGroup, hasGroup } from "@/lib/positions";
import { balanceTeamsVariants, summarizeTeams, type TeamBalanceOptions } from "@/lib/teamBalancer";
import { generateLineups } from "@/lib/lineupGenerator";
import { planMatchLineup, type MatchPlanResult, type MatchQuarterLimits, type MatchSelection } from "@/lib/matchPlanner";
import { clearStoredAll, loadStored, saveStored } from "@/lib/persistedState";
import { formatTeamName } from "@/lib/teamLabels";
import { extractStaffRole } from "@/lib/staffRoles";
import { INJURY_ACTIVITY_RATE, effectiveActivityScore, formatScore, hasInjury } from "@/lib/injury";
import { centerBackScore, centerForwardScore, detailedTechnicalTotal, wingBackScore, wingScore } from "@/lib/playerScores";
import { isMultiPositionPlayer, multiPositionGroups } from "@/lib/multiPosition";
import { makeHistoryInsightKey, normalizeHistoryName } from "@/lib/historyInsights";

const SCORE_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);
const QUARTER_OPTIONS = [1, 2, 3, 4];
const DEFAULT_BALANCE_QUARTERS = 3;
const DEFAULT_MATCH_QUARTERS = 3;
const BALANCE_FIELD_QUARTERS_REQUIRED = 80;
const MATCH_FIELD_QUARTERS_REQUIRED = 40;
type PlannerMode = "BALANCE" | "MATCH";
type TeamScoreChipKey = "CF" | "W" | "M" | "CB" | "WB";
const SCORE_CHIP_SUB_ROLES: Record<TeamScoreChipKey, AssignedSubRole> = {
  CF: "CF",
  W: "WING",
  M: "MID",
  CB: "CB",
  WB: "WB",
};
const STAFF_SEARCH_PRIORITY: Partial<Record<StaffRole, number>> = {
  "단장": 0,
  "감독": 1,
  "코치": 2,
};

function staffSearchPriority(role: StaffRole | null): number {
  return role ? STAFF_SEARCH_PRIORITY[role] ?? 99 : 99;
}

function groupForAssignedSubRole(role: AssignedSubRole): PositionGroup {
  if (role === "CF" || role === "WING") return "ATTACK";
  if (role === "MID") return "MID";
  return "DEFENSE";
}

function normalizeStoredPlayerName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function storedSheetIdName(id: string): string | null {
  const match = id.match(/^sheet(?:_gk)?_\d+_(.+)$/);
  return match?.[1] ?? null;
}

function uniqueItemsByName<T extends { name: string }>(items: T[]): Map<string, T> {
  const byName = new Map<string, T>();
  const duplicates = new Set<string>();
  items.forEach((item) => {
    const key = normalizeStoredPlayerName(item.name);
    if (!key) return;
    if (byName.has(key)) {
      duplicates.add(key);
      return;
    }
    byName.set(key, item);
  });
  duplicates.forEach((key) => byName.delete(key));
  return byName;
}

function reconcileStoredPlayerIds(storedIds: string[], storedNames: string[], selectablePlayers: Player[]): string[] {
  const byId = new Map(selectablePlayers.map((player) => [player.id, player]));
  const byName = uniqueItemsByName(selectablePlayers);
  const resolved: string[] = [];
  const seen = new Set<string>();
  const addPlayer = (player: Player | undefined) => {
    if (!player || seen.has(player.id)) return;
    seen.add(player.id);
    resolved.push(player.id);
  };

  storedIds.forEach((id, index) => {
    const direct = byId.get(id);
    if (direct) {
      addPlayer(direct);
      return;
    }
    const fallbackName = storedSheetIdName(id) ?? storedNames[index] ?? "";
    addPlayer(byName.get(normalizeStoredPlayerName(fallbackName)));
  });
  storedNames.forEach((name) => addPlayer(byName.get(normalizeStoredPlayerName(name))));
  return resolved;
}

function reconcileStoredGoalkeepers(storedIds: string[], storedNames: string[], goalkeepers: DedicatedGoalkeeper[]): DedicatedGoalkeeper[] {
  const byId = new Map(goalkeepers.map((goalkeeper) => [goalkeeper.id, goalkeeper]));
  const byName = uniqueItemsByName(goalkeepers);
  const resolved: DedicatedGoalkeeper[] = [];
  const seen = new Set<string>();
  const addGoalkeeper = (goalkeeper: DedicatedGoalkeeper | undefined) => {
    if (!goalkeeper || seen.has(goalkeeper.id)) return;
    seen.add(goalkeeper.id);
    resolved.push(goalkeeper);
  };

  storedIds.forEach((id, index) => {
    const direct = byId.get(id);
    if (direct) {
      addGoalkeeper(direct);
      return;
    }
    const fallbackName = storedSheetIdName(id) ?? storedNames[index] ?? "";
    addGoalkeeper(byName.get(normalizeStoredPlayerName(fallbackName)));
  });
  storedNames.forEach((name) => addGoalkeeper(byName.get(normalizeStoredPlayerName(name))));
  return resolved;
}

type GuestForm = {
  name: string;
  primaryPosition: FieldPosition;
  secondaryPositions: FieldPosition[];
  centerForwardScore: number;
  wingScore: number;
  midScore: number;
  centerBackScore: number;
  wingBackScore: number;
  activityScore: number;
  memo: string;
};

const emptyGuest: GuestForm = {
  name: "",
  primaryPosition: "CF",
  secondaryPositions: [],
  centerForwardScore: 5,
  wingScore: 5,
  midScore: 5,
  centerBackScore: 5,
  wingBackScore: 5,
  activityScore: 5,
  memo: "",
};

function reassignPlayerGroup<T extends { primaryPosition: Player["primaryPosition"]; secondaryPositions: FieldPosition[] }>(
  player: T,
  newGroup: PositionGroup,
): T & { assignedGroup: PositionGroup; assignmentReason: string; isPositionOverride: boolean } {
  if (player.primaryPosition === "GK") {
    return { ...player, assignedGroup: newGroup, assignmentReason: "주포지션 그룹 배정", isPositionOverride: false };
  }
  const primaryGroup = getPositionGroup(player.primaryPosition);
  const reason = primaryGroup === newGroup
    ? "주포지션 그룹 배정"
    : hasGroup(player.secondaryPositions, newGroup)
      ? "부포지션 그룹 배정"
      : "인원 균형을 위한 포지션 변경";
  return {
    ...player,
    assignedGroup: newGroup,
    assignmentReason: reason,
    isPositionOverride: primaryGroup !== newGroup,
  };
}

function modeHelp(mode: PlannerMode): string {
  return mode === "BALANCE"
    ? "내부전은 24명 이상 권장, 22명부터 생성 가능합니다. 형광/주황팀 밸런스를 맞춥니다."
    : "매치는 필드 10명~18명과 전담 GK 기준으로 베스트 11과 1~4Q 라인업을 추천합니다.";
}

const LINEUP_SHARE_HASH_KEY = "lineup";
const MATCH_LINEUP_SHARE_HASH_KEY = "matchLineup";
const TEAM_SHARE_HASH_KEY = "teams";
const SHORT_SHARE_HASH_KEY = "s";
const COMPRESSED_LINEUP_PREFIX = "gz.";
const RAW_LINEUP_PREFIX = "raw.";

type SharedLineupPayload = {
  version: 1;
  lineup: LineupResult;
  teamResult?: TeamBalanceResult | null;
  teamVariants?: TeamBalanceResult[];
  selectedVariantIdx?: number;
};

type SharedLineupData = {
  lineup: LineupResult;
  teamResult?: TeamBalanceResult | null;
  teamVariants?: TeamBalanceResult[];
  selectedVariantIdx?: number;
};

type LineupShareTeamContext = {
  teamResult?: TeamBalanceResult | null;
  selectedVariantIdx?: number;
};

type SharedTeamPayload = {
  version: 1;
  teamResult?: TeamBalanceResult | null;
  teamVariants: TeamBalanceResult[];
  selectedVariantIdx?: number;
};

type SharedTeamData = {
  teamResult: TeamBalanceResult | null;
  teamVariants: TeamBalanceResult[];
  selectedVariantIdx: number;
};

type StoredShareResponse = {
  kind?: string;
  payload?: unknown;
  error?: string;
  detail?: string;
};

type ShareKind = "teams" | "lineup" | "matchLineup";

type SharedMatchLineupPayload = {
  version: 1;
  match: MatchPlanResult;
};

type TeamRecordSourcePlayer = TeamBalanceResult["teamA"]["players"][number];

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j += 1) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("현재 브라우저가 압축 URL 생성을 지원하지 않습니다.");
  }
  const stream = new Blob([toBlobPart(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("현재 브라우저가 압축 URL 열기를 지원하지 않습니다.");
  }
  const stream = new Blob([toBlobPart(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function normalizeSharedVariants(payload: Partial<SharedLineupPayload>): SharedLineupData {
  const variants = Array.isArray(payload.teamVariants)
    ? payload.teamVariants.map(normalizeSharedTeamResult).filter((result): result is TeamBalanceResult => Boolean(result))
    : [];
  const normalizedTeamResult = normalizeSharedTeamResult(payload.teamResult);
  const fallbackVariants = variants.length > 0 ? variants : (normalizedTeamResult ? [normalizedTeamResult] : []);
  const maxIdx = Math.max(0, fallbackVariants.length - 1);
  const selectedVariantIdx = Math.min(Math.max(Number(payload.selectedVariantIdx ?? 0) || 0, 0), maxIdx);
  return {
    lineup: normalizeSharedLineup(payload.lineup),
    teamResult: normalizedTeamResult ?? fallbackVariants[selectedVariantIdx] ?? null,
    teamVariants: fallbackVariants,
    selectedVariantIdx,
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeSharedLineup(lineup: unknown): LineupResult {
  const source = lineup as Partial<LineupResult>;
  return {
    quarters: Array.isArray(source.quarters)
      ? source.quarters.map((quarter) => ({
        ...quarter,
        attack: stringList(quarter.attack),
        mid: stringList(quarter.mid),
        defense: stringList(quarter.defense),
        gk: typeof quarter.gk === "string" ? quarter.gk : "없음",
        bench: stringList(quarter.bench),
        warnings: stringList(quarter.warnings),
      }))
      : [],
    playerSummaries: Array.isArray(source.playerSummaries) ? source.playerSummaries : [],
    staffRoles: source.staffRoles && typeof source.staffRoles === "object" ? source.staffRoles : {},
    dedicatedGkRotation: source.dedicatedGkRotation && typeof source.dedicatedGkRotation === "object" ? source.dedicatedGkRotation : {},
    warnings: stringList(source.warnings),
  };
}

function normalizeSharedAssignedPlayer(player: AssignedPlayer): AssignedPlayer {
  return {
    ...player,
    secondaryPositions: Array.isArray(player.secondaryPositions) ? player.secondaryPositions : [],
  };
}

function normalizeSharedTeamResult(result: TeamBalanceResult | null | undefined): TeamBalanceResult | null {
  if (!result) return null;
  return {
    ...result,
    teamA: {
      ...result.teamA,
      players: Array.isArray(result.teamA?.players) ? result.teamA.players.map(normalizeSharedAssignedPlayer) : [],
    },
    teamB: {
      ...result.teamB,
      players: Array.isArray(result.teamB?.players) ? result.teamB.players.map(normalizeSharedAssignedPlayer) : [],
    },
    relationViolations: Array.isArray(result.relationViolations) ? result.relationViolations : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

function createSharedLineupPayload(lineup: LineupResult, teamContext?: LineupShareTeamContext): SharedLineupPayload {
  return {
    version: 1,
    lineup,
    ...(teamContext?.teamResult ? { teamResult: teamContext.teamResult } : {}),
    ...(teamContext?.selectedVariantIdx != null ? { selectedVariantIdx: teamContext.selectedVariantIdx } : {}),
  };
}

function createSharedTeamPayload(teamVariants: TeamBalanceResult[], selectedVariantIdx: number): SharedTeamPayload {
  const variants = teamVariants.filter(Boolean);
  const idx = variants.length > 0 ? Math.min(Math.max(selectedVariantIdx, 0), variants.length - 1) : 0;
  return {
    version: 1,
    teamResult: variants[idx] ?? null,
    teamVariants: variants,
    selectedVariantIdx: idx,
  };
}

function createSharedMatchLineupPayload(match: MatchPlanResult): SharedMatchLineupPayload {
  return { version: 1, match };
}

async function encodeSharedLineup(lineup: LineupResult, teamContext?: LineupShareTeamContext): Promise<string> {
  const payload = createSharedLineupPayload(lineup, teamContext);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "undefined") {
    return `${RAW_LINEUP_PREFIX}${bytesToBase64Url(bytes)}`;
  }
  return `${COMPRESSED_LINEUP_PREFIX}${bytesToBase64Url(await gzip(bytes))}`;
}

async function encodeSharedTeams(teamVariants: TeamBalanceResult[], selectedVariantIdx: number): Promise<string> {
  const payload = createSharedTeamPayload(teamVariants, selectedVariantIdx);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "undefined") {
    return `${RAW_LINEUP_PREFIX}${bytesToBase64Url(bytes)}`;
  }
  return `${COMPRESSED_LINEUP_PREFIX}${bytesToBase64Url(await gzip(bytes))}`;
}

async function decodeSharedTeams(value: string): Promise<SharedTeamData> {
  const parsePayload = (json: string) => {
    const payload = JSON.parse(json) as Partial<SharedTeamPayload>;
    if (payload.version !== 1 || !Array.isArray(payload.teamVariants)) {
      throw new Error("팀분배 공유 데이터 형식이 올바르지 않습니다.");
    }
    const variants = payload.teamVariants.filter(Boolean);
    const idx = variants.length > 0
      ? Math.min(Math.max(Number(payload.selectedVariantIdx ?? 0) || 0, 0), variants.length - 1)
      : 0;
    return {
      teamResult: payload.teamResult ?? variants[idx] ?? null,
      teamVariants: variants,
      selectedVariantIdx: idx,
    };
  };

  if (value.startsWith(RAW_LINEUP_PREFIX)) {
    return parsePayload(new TextDecoder().decode(base64UrlToBytes(value.slice(RAW_LINEUP_PREFIX.length))));
  }
  if (!value.startsWith(COMPRESSED_LINEUP_PREFIX)) {
    throw new Error("팀분배 공유 URL 형식이 올바르지 않습니다.");
  }
  const compressed = base64UrlToBytes(value.slice(COMPRESSED_LINEUP_PREFIX.length));
  return parsePayload(new TextDecoder().decode(await gunzip(compressed)));
}

function normalizeSharedTeamPayload(payload: Partial<SharedTeamPayload>): SharedTeamData {
  if (payload.version !== 1 || !Array.isArray(payload.teamVariants)) {
    throw new Error("팀분배 공유 데이터 형식이 올바르지 않습니다.");
  }
  const variants = payload.teamVariants.map(normalizeSharedTeamResult).filter((result): result is TeamBalanceResult => Boolean(result));
  const normalizedTeamResult = normalizeSharedTeamResult(payload.teamResult);
  const idx = variants.length > 0
    ? Math.min(Math.max(Number(payload.selectedVariantIdx ?? 0) || 0, 0), variants.length - 1)
    : 0;
  return {
    teamResult: normalizedTeamResult ?? variants[idx] ?? null,
    teamVariants: variants,
    selectedVariantIdx: idx,
  };
}

async function decodeSharedLineup(value: string): Promise<SharedLineupData> {
  if (value.startsWith(RAW_LINEUP_PREFIX)) {
    const json = new TextDecoder().decode(base64UrlToBytes(value.slice(RAW_LINEUP_PREFIX.length)));
    const payload = JSON.parse(json) as Partial<SharedLineupPayload>;
    if (payload.version !== 1 || !payload.lineup || !Array.isArray(payload.lineup.quarters)) {
      throw new Error("라인업 공유 데이터 형식이 올바르지 않습니다.");
    }
    return normalizeSharedVariants(payload);
  }

  if (!value.startsWith(COMPRESSED_LINEUP_PREFIX)) {
    throw new Error("라인업 공유 URL 형식이 올바르지 않습니다.");
  }
  const compressed = base64UrlToBytes(value.slice(COMPRESSED_LINEUP_PREFIX.length));
  const json = new TextDecoder().decode(await gunzip(compressed));
  const payload = JSON.parse(json) as Partial<SharedLineupPayload>;
  if (payload.version !== 1 || !payload.lineup || !Array.isArray(payload.lineup.quarters)) {
    throw new Error("라인업 공유 데이터 형식이 올바르지 않습니다.");
  }
  return normalizeSharedVariants(payload);
}

async function encodeSharedMatchLineup(match: MatchPlanResult): Promise<string> {
  const payload = createSharedMatchLineupPayload(match);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "undefined") {
    return `${RAW_LINEUP_PREFIX}${bytesToBase64Url(bytes)}`;
  }
  return `${COMPRESSED_LINEUP_PREFIX}${bytesToBase64Url(await gzip(bytes))}`;
}

async function decodeSharedMatchLineup(value: string): Promise<MatchPlanResult> {
  const parsePayload = (json: string) => {
    const payload = JSON.parse(json) as Partial<SharedMatchLineupPayload>;
    if (payload.version !== 1 || !payload.match || !Array.isArray(payload.match.quarters)) {
      throw new Error("매치 라인업 공유 데이터 형식이 올바르지 않습니다.");
    }
    return payload.match;
  };

  if (value.startsWith(RAW_LINEUP_PREFIX)) {
    return parsePayload(new TextDecoder().decode(base64UrlToBytes(value.slice(RAW_LINEUP_PREFIX.length))));
  }
  if (!value.startsWith(COMPRESSED_LINEUP_PREFIX)) {
    throw new Error("매치 라인업 공유 URL 형식이 올바르지 않습니다.");
  }
  const compressed = base64UrlToBytes(value.slice(COMPRESSED_LINEUP_PREFIX.length));
  return parsePayload(new TextDecoder().decode(await gunzip(compressed)));
}

function buildHashUrl(key: string, value: string): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  url.search = "";
  const params = new URLSearchParams();
  params.set(key, value);
  url.hash = params.toString();
  return url.toString();
}

async function buildShortShareUrl(kind: ShareKind, payload: unknown): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const response = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, payload }),
  });
  const data = await response.json().catch(() => ({})) as { id?: string; error?: string; detail?: string };
  if (!response.ok || !data.id) {
    throw new Error(data.detail || data.error || "공유 링크 저장에 실패했습니다.");
  }
  return buildHashUrl(SHORT_SHARE_HASH_KEY, data.id);
}

async function loadShortShare(id: string): Promise<StoredShareResponse> {
  const response = await fetch(`/api/share?id=${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as StoredShareResponse;
  if (!response.ok) {
    throw new Error(data.detail || data.error || "공유 링크 조회에 실패했습니다.");
  }
  return data;
}

async function buildLineupShareUrl(lineup: LineupResult, teamContext?: LineupShareTeamContext): Promise<string | null> {
  const payload = createSharedLineupPayload(lineup, teamContext);
  try {
    return await buildShortShareUrl("lineup", payload);
  } catch {
    return buildHashUrl(LINEUP_SHARE_HASH_KEY, await encodeSharedLineup(lineup, teamContext));
  }
}

async function buildTeamShareUrl(teamVariants: TeamBalanceResult[], selectedVariantIdx: number): Promise<string | null> {
  const payload = createSharedTeamPayload(teamVariants, selectedVariantIdx);
  try {
    return await buildShortShareUrl("teams", payload);
  } catch {
    return buildHashUrl(TEAM_SHARE_HASH_KEY, await encodeSharedTeams(teamVariants, selectedVariantIdx));
  }
}

async function buildMatchLineupShareUrl(match: MatchPlanResult): Promise<string | null> {
  const payload = createSharedMatchLineupPayload(match);
  try {
    return await buildShortShareUrl("matchLineup", payload);
  } catch {
    return buildHashUrl(MATCH_LINEUP_SHARE_HASH_KEY, await encodeSharedMatchLineup(match));
  }
}

function clearLineupShareHash() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  if (!params.has(LINEUP_SHARE_HASH_KEY) && !params.has(MATCH_LINEUP_SHARE_HASH_KEY) && !params.has(TEAM_SHARE_HASH_KEY) && !params.has(SHORT_SHARE_HASH_KEY)) return;
  params.delete(LINEUP_SHARE_HASH_KEY);
  params.delete(MATCH_LINEUP_SHARE_HASH_KEY);
  params.delete(TEAM_SHARE_HASH_KEY);
  params.delete(SHORT_SHARE_HASH_KEY);
  url.hash = params.toString();
  window.history.replaceState(null, "", url.toString());
}

function formatLocalDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compactRecordDate(date: string): string {
  return date.replace(/\D/g, "").slice(0, 8);
}

function formatDefaultMatchTime(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00`);
  const day = Number.isNaN(date.getTime()) ? "" : ` (${"일월화수목금토"[date.getDay()]})`;
  return `20:00 ~ 22:00${day}`;
}

function toRecordPlayer(player: TeamRecordSourcePlayer): TeamRecordPlayer {
  const staffRole = extractStaffRole(player.memo);
  return {
    id: player.id,
    name: player.name,
    memberType: player.memberType,
    primaryPosition: player.primaryPosition,
    assignedGroup: player.assignedGroup,
    assignmentReason: player.assignmentReason,
    isPositionOverride: player.isPositionOverride,
    ...(staffRole ? { staffRole } : {}),
  };
}

function toRecordGroups(players: TeamRecordSourcePlayer[]): TeamRecordGroups {
  const groups: TeamRecordGroups = { attack: [], mid: [], defense: [] };
  players.forEach((player) => {
    const target = player.assignedGroup === "ATTACK"
      ? groups.attack
      : player.assignedGroup === "MID"
        ? groups.mid
        : groups.defense;
    target.push(toRecordPlayer(player));
  });
  return groups;
}

function buildTeamRecord(result: TeamBalanceResult, date: string, shareUrl: string, lineup?: Pick<LineupResult, "quarters">): TeamRecord {
  const now = new Date().toISOString();
  return {
    date,
    teams: {
      A: toRecordGroups(result.teamA.players),
      B: toRecordGroups(result.teamB.players),
    },
    ...(lineup ? { lineup: { savedAt: now, quarters: lineup.quarters } } : {}),
    shareUrl,
    createdAt: now,
    updatedAt: now,
  };
}

async function upsertTeamRecord(record: TeamRecord): Promise<TeamRecord> {
  const response = await fetch("/api/team-records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`);
  }
  return body.record as TeamRecord;
}

async function saveMatchRecord(record: MatchRecordSaveRequest): Promise<MatchRecordSaveResponse> {
  const response = await fetch("/api/match-record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(body?.details) ? `: ${body.details.join(", ")}` : "";
    const detail = typeof body?.detail === "string" ? `: ${body.detail}` : "";
    const error = new Error(typeof body?.error === "string" ? `${body.error}${details}${detail}` : `HTTP ${response.status}`) as Error & { status?: number; body?: unknown };
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body as MatchRecordSaveResponse;
}

function collectMatchStaffRoles(result: MatchPlanResult): Partial<Record<string, StaffRole>> {
  const roles: Partial<Record<string, StaffRole>> = {};
  const add = (name: string | undefined, memo: string | undefined) => {
    if (!name) return;
    const role = extractStaffRole(memo);
    if (role) roles[name] = role;
  };
  result.starters.attack.forEach((item) => add(item.player.name, item.player.memo));
  result.starters.mid.forEach((item) => add(item.player.name, item.player.memo));
  result.starters.defense.forEach((item) => add(item.player.name, item.player.memo));
  result.bench.forEach((item) => add(item.player.name, item.player.memo));
  add(result.starters.gk?.name, result.starters.gk?.memo);
  return roles;
}

function matchQuartersForRecord(quarters: MatchPlanResult["quarters"]): TeamQuarterLineup[] {
  return quarters.flatMap((quarter) => {
    const emptyAway: TeamQuarterLineup = {
      quarter: quarter.quarter,
      team: "A",
      attack: [],
      mid: [],
      defense: [],
      gk: "없음",
      bench: [],
      warnings: [],
    };
    const home: TeamQuarterLineup = {
      quarter: quarter.quarter,
      team: "B",
      attack: quarter.attack,
      mid: quarter.mid,
      defense: quarter.defense,
      gk: quarter.gk,
      bench: quarter.bench,
      warnings: quarter.unavailable.length > 0 ? [`출전 제외: ${quarter.unavailable.join(", ")}`] : [],
    };
    return [emptyAway, home];
  });
}

function buildMatchRecord(result: MatchPlanResult, quarters: MatchPlanResult["quarters"], date: string, overwriteExisting: boolean): MatchRecordSaveRequest {
  const lineupQuarters = matchQuartersForRecord(quarters);
  return {
    matchId: compactRecordDate(date),
    matchDate: date,
    matchTime: formatDefaultMatchTime(date),
    matchKind: "MATCH",
    recordMode: "SUMMARY",
    venueName: "",
    homeTeamName: "DevUtd",
    awayTeamName: "상대팀",
    memo: "dev-planner 매치 라인업 확정",
    quarters: lineupQuarters,
    lineupQuarters,
    events: [],
    summaryStats: [],
    guestStats: [],
    guestPlayers: [],
    teamScores: [],
    scoreOverride: { A: 0, B: 0 },
    staffRoles: collectMatchStaffRoles(result),
    overwriteExisting,
  };
}


type SwapSelection = { team: "A" | "B"; playerId: string } | null;

export default function Home() {
  const [csvUrl, setCsvUrl] = useState(appConfig.defaultSheetUrl);
  const [players, setPlayers] = useState<Player[]>([]);
  const [relations, setRelations] = useState<PlayerRelation[]>([]);
  const [tempGuests, setTempGuests] = useState<Player[]>([]);
  const [tempGks, setTempGks] = useState<DedicatedGoalkeeper[]>([]);
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [waitingIds, setWaitingIds] = useState<string[]>([]);
  const [dedicatedGks, setDedicatedGks] = useState<DedicatedGoalkeeper[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [guest, setGuest] = useState<GuestForm>(emptyGuest);
  const [guestRole, setGuestRole] = useState<"FIELD" | "GK">("FIELD");
  const [plannerMode, setPlannerMode] = useState<PlannerMode>("BALANCE");
  const [teamResult, setTeamResult] = useState<TeamBalanceResult | null>(null);
  const [teamVariants, setTeamVariants] = useState<TeamBalanceResult[]>([]);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const [lineupResult, setLineupResult] = useState<LineupResult | null>(null);
  const [matchResult, setMatchResult] = useState<MatchPlanResult | null>(null);
  const [matchQuarterLimits, setMatchQuarterLimits] = useState<MatchQuarterLimits>({});
  const [balanceQuarterLimits, setBalanceQuarterLimits] = useState<Record<string, number>>({});
  const [dualTeamIds, setDualTeamIds] = useState<string[]>([]);
  const [draggedMatchPlayerId, setDraggedMatchPlayerId] = useState<string | null>(null);
  const [dragOverMatchTarget, setDragOverMatchTarget] = useState<string | null>(null);
  const [draggedBalancePlayerId, setDraggedBalancePlayerId] = useState<string | null>(null);
  const [dragOverBalanceTarget, setDragOverBalanceTarget] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSheetUrl, setShowSheetUrl] = useState(false);
  const [playerQuery, setPlayerQuery] = useState("");
  const [teamsConfirmed, setTeamsConfirmed] = useState(false);
  const [swapSelection, setSwapSelection] = useState<SwapSelection>(null);
  const [hydrated, setHydrated] = useState(false);
  const [showRecordEdit, setShowRecordEdit] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("record") !== "1") return;
    setShowRecordEdit(true);
    window.setTimeout(() => document.querySelector("[data-mrw-active='true']")?.scrollIntoView({ block: "start" }), 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const storedCsvUrl = loadStored<string>("csvUrl", appConfig.defaultSheetUrl);
      const storedMode = loadStored<PlannerMode>("plannerMode", "BALANCE");
      const storedFieldIds = loadStored<string[]>("fieldIds", []);
      const storedFieldNames = loadStored<string[]>("fieldNames", []);
      const storedWaitingIds = loadStored<string[]>("waitingIds", []);
      const storedWaitingNames = loadStored<string[]>("waitingNames", []);
      const storedGkIds = loadStored<string[]>("dedicatedGkIds", []);
      const storedGkNames = loadStored<string[]>("dedicatedGkNames", []);
      const storedTempGuests = loadStored<Player[]>("tempGuests", []);
      const storedTempGks = loadStored<DedicatedGoalkeeper[]>("tempGks", []);
      const storedMatchLimits = loadStored<MatchQuarterLimits>("matchQuarterLimits", {});
      const storedBalanceLimits = loadStored<Record<string, number>>("balanceQuarterLimits", {});
      const storedDualTeamIds = loadStored<string[]>("dualTeamIds", []);
      const storedFieldIdSet = new Set(storedFieldIds);
      const storedFieldNameSet = new Set(storedFieldNames.map(normalizeStoredPlayerName));
      const activeStoredTempGuests = storedTempGuests.filter((guestPlayer) => (
        storedFieldIdSet.has(guestPlayer.id) || storedFieldNameSet.has(normalizeStoredPlayerName(guestPlayer.name))
      ));

      setCsvUrl(storedCsvUrl);
      setPlannerMode(storedMode);
      setMatchQuarterLimits(storedMatchLimits);
      setBalanceQuarterLimits(storedBalanceLimits);
      setTempGuests(activeStoredTempGuests);
      setTempGks(storedTempGks);

      const result = await loadPlayersFromCsv(storedCsvUrl);
      if (cancelled) return;

      if (result.players.length === 0 && result.errors.length > 0) {
        setPlayers([]);
        setRelations([]);
        setErrors(result.errors);
        setWarnings(result.warnings);
        setFieldIds(storedFieldIds);
        setWaitingIds(storedWaitingIds);
        setDualTeamIds(storedDualTeamIds);
        setDedicatedGks(storedTempGks);
        setHydrated(true);
        return;
      }

      const selectablePlayers: Player[] = [...result.players, ...activeStoredTempGuests];
      setPlayers(result.players);
      setRelations(result.relations);
      setErrors(result.errors);
      setWarnings(result.warnings);

      const validFieldIds = reconcileStoredPlayerIds(storedFieldIds, storedFieldNames, selectablePlayers);
      setFieldIds(validFieldIds);
      const validWaitingIds = reconcileStoredPlayerIds(storedWaitingIds, storedWaitingNames, selectablePlayers);
      setWaitingIds(validWaitingIds);
      const validSelectableIds = new Set(selectablePlayers.map((player) => player.id));
      setDualTeamIds(storedDualTeamIds.filter((id) => validSelectableIds.has(id)));
      setMatchQuarterLimits((prev) => {
        const next: MatchQuarterLimits = {};
        for (const [id, value] of Object.entries(prev)) {
          if (validSelectableIds.has(id)) next[id] = value;
        }
        return next;
      });
      setBalanceQuarterLimits((prev) => {
        const next: Record<string, number> = {};
        for (const [id, value] of Object.entries(prev)) {
          if (validSelectableIds.has(id)) next[id] = value;
        }
        return next;
      });

      const sheetGkPool: DedicatedGoalkeeper[] = result.players
        .filter((p) => p.primaryPosition === "GK")
        .map((p) => ({ id: p.id, source: "SHEET" as const, name: p.name, memo: p.memo }));
      const allGks = [...sheetGkPool, ...storedTempGks];
      const validGks = reconcileStoredGoalkeepers(storedGkIds, storedGkNames, allGks);
      setDedicatedGks(validGks);

      setHydrated(true);
    }
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveStored("csvUrl", csvUrl);
  }, [csvUrl, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("plannerMode", plannerMode);
  }, [plannerMode, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("fieldIds", fieldIds);
  }, [fieldIds, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("waitingIds", waitingIds);
  }, [waitingIds, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("dedicatedGkIds", dedicatedGks.map((gk) => gk.id));
    saveStored("dedicatedGkNames", dedicatedGks.map((gk) => gk.name));
  }, [dedicatedGks, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("tempGuests", tempGuests);
  }, [tempGuests, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("tempGks", tempGks);
  }, [tempGks, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("matchQuarterLimits", matchQuarterLimits);
  }, [matchQuarterLimits, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("balanceQuarterLimits", balanceQuarterLimits);
  }, [balanceQuarterLimits, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("dualTeamIds", dualTeamIds);
  }, [dualTeamIds, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const applySharedLineup = async () => {
      const params = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
      const shortId = params.get(SHORT_SHARE_HASH_KEY);
      const encodedMatch = params.get(MATCH_LINEUP_SHARE_HASH_KEY);
      const encodedTeams = params.get(TEAM_SHARE_HASH_KEY);
      const encoded = params.get(LINEUP_SHARE_HASH_KEY);
      if (!shortId && !encodedMatch && !encodedTeams && !encoded) return;
      try {
        if (shortId) {
          const sharedShort = await loadShortShare(shortId);
          if (sharedShort.kind === "matchLineup") {
            const payload = sharedShort.payload as Partial<SharedMatchLineupPayload>;
            if (payload.version !== 1 || !payload.match || !Array.isArray(payload.match.quarters)) {
              throw new Error("매치 라인업 공유 데이터 형식이 올바르지 않습니다.");
            }
            if (cancelled) return;
            setPlannerMode("MATCH");
            setTeamResult(null);
            setTeamVariants([]);
            setSelectedVariantIdx(0);
            setLineupResult(null);
            setMatchResult(payload.match);
            setTeamsConfirmed(false);
            setSwapSelection(null);
            setCopied(false);
            window.setTimeout(() => document.getElementById("match-result")?.scrollIntoView({ block: "start" }), 0);
            return;
          }
          if (sharedShort.kind === "teams") {
            const sharedTeams = normalizeSharedTeamPayload(sharedShort.payload as Partial<SharedTeamPayload>);
            if (cancelled) return;
            setPlannerMode("BALANCE");
            setTeamResult(sharedTeams.teamResult);
            setTeamVariants(sharedTeams.teamVariants);
            setSelectedVariantIdx(sharedTeams.selectedVariantIdx);
            setLineupResult(null);
            setMatchResult(null);
            setTeamsConfirmed(false);
            setSwapSelection(null);
            setCopied(false);
            window.setTimeout(() => document.getElementById("team-result")?.scrollIntoView({ block: "start" }), 0);
            return;
          }
          if (sharedShort.kind === "lineup") {
            const payload = sharedShort.payload as Partial<SharedLineupPayload>;
            if (payload.version !== 1 || !payload.lineup || !Array.isArray(payload.lineup.quarters)) {
              throw new Error("라인업 공유 데이터 형식이 올바르지 않습니다.");
            }
            if (cancelled) return;
            const shared = normalizeSharedVariants(payload);
            const sharedVariants = shared.teamVariants ?? (shared.teamResult ? [shared.teamResult] : []);
            const sharedVariantIdx = sharedVariants.length > 0
              ? Math.min(Math.max(shared.selectedVariantIdx ?? 0, 0), sharedVariants.length - 1)
              : 0;
            setPlannerMode("BALANCE");
            setTeamResult(shared.teamResult ?? sharedVariants[sharedVariantIdx] ?? null);
            setTeamVariants(sharedVariants);
            setSelectedVariantIdx(sharedVariantIdx);
            setLineupResult(shared.lineup);
            setMatchResult(null);
            setTeamsConfirmed(true);
            setSwapSelection(null);
            setCopied(false);
            window.setTimeout(() => document.getElementById("lineup-result")?.scrollIntoView({ block: "start" }), 0);
            return;
          }
          throw new Error("공유 링크 종류를 확인할 수 없습니다.");
        }
        if (encodedMatch) {
          const sharedMatch = await decodeSharedMatchLineup(encodedMatch);
          if (cancelled) return;
          setPlannerMode("MATCH");
          setTeamResult(null);
          setTeamVariants([]);
          setSelectedVariantIdx(0);
          setLineupResult(null);
          setMatchResult(sharedMatch);
          setTeamsConfirmed(false);
          setSwapSelection(null);
          setCopied(false);
          window.setTimeout(() => document.getElementById("match-result")?.scrollIntoView({ block: "start" }), 0);
          return;
        }
        if (encodedTeams) {
          const sharedTeams = await decodeSharedTeams(encodedTeams);
          if (cancelled) return;
          setPlannerMode("BALANCE");
          setTeamResult(sharedTeams.teamResult);
          setTeamVariants(sharedTeams.teamVariants);
          setSelectedVariantIdx(sharedTeams.selectedVariantIdx);
          setLineupResult(null);
          setMatchResult(null);
          setTeamsConfirmed(false);
          setSwapSelection(null);
          setCopied(false);
          window.setTimeout(() => document.getElementById("team-result")?.scrollIntoView({ block: "start" }), 0);
          return;
        }
        if (!encoded) return;
        const shared = await decodeSharedLineup(encoded);
        if (cancelled) return;
        const sharedVariants = shared.teamVariants ?? (shared.teamResult ? [shared.teamResult] : []);
        const sharedVariantIdx = sharedVariants.length > 0
          ? Math.min(Math.max(shared.selectedVariantIdx ?? 0, 0), sharedVariants.length - 1)
          : 0;
        setPlannerMode("BALANCE");
        setTeamResult(shared.teamResult ?? sharedVariants[sharedVariantIdx] ?? null);
        setTeamVariants(sharedVariants);
        setSelectedVariantIdx(sharedVariantIdx);
        setLineupResult(shared.lineup);
        setMatchResult(null);
        setTeamsConfirmed(true);
        setSwapSelection(null);
        setCopied(false);
        window.setTimeout(() => document.getElementById("lineup-result")?.scrollIntoView({ block: "start" }), 0);
      } catch (error) {
        if (!cancelled) setErrors([error instanceof Error ? error.message : String(error)]);
      }
    };
    applySharedLineup();
    window.addEventListener("hashchange", applySharedLineup);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", applySharedLineup);
    };
  }, [hydrated]);

  const selectablePlayers = useMemo(() => [...players, ...tempGuests], [players, tempGuests]);
  const fieldPlayers = useMemo(() => selectablePlayers.filter((p) => fieldIds.includes(p.id)), [selectablePlayers, fieldIds]);
  const isWaitingPlayer = useMemo(() => {
    const set = new Set(waitingIds);
    return (p: Player) => set.has(p.id) || p.memberType === "WAITING";
  }, [waitingIds]);
  const activeFieldPlayers = useMemo(() => fieldPlayers.filter((p) => !isWaitingPlayer(p)), [fieldPlayers, isWaitingPlayer]);
  const waitingPlayers = useMemo(() => fieldPlayers.filter((p) => isWaitingPlayer(p)), [fieldPlayers, isWaitingPlayer]);
  const matchActiveFieldPlayers = useMemo(() => activeFieldPlayers.filter((p) => p.primaryPosition !== "GK"), [activeFieldPlayers]);
  const matchCallupPlayers = useMemo(() => waitingPlayers.filter((p) => p.primaryPosition !== "GK"), [waitingPlayers]);
  const matchFieldPlayers = useMemo(() => [...matchActiveFieldPlayers, ...matchCallupPlayers], [matchActiveFieldPlayers, matchCallupPlayers]);
  const matchRequiredIds = useMemo(() => new Set(matchActiveFieldPlayers.map((player) => player.id)), [matchActiveFieldPlayers]);
  const matchRosterSize = matchActiveFieldPlayers.length;
  const regularCount = fieldPlayers.filter((p) => p.memberType === "REGULAR").length;
  const guestCount = fieldPlayers.filter((p) => p.memberType === "GUEST").length;
  const waitingCount = waitingPlayers.length;
  const activeFieldIds = useMemo(() => new Set(activeFieldPlayers.map((p) => p.id)), [activeFieldPlayers]);
  const matchQuarterTargets = useMemo(() => {
    const targets: MatchQuarterLimits = {};
    matchFieldPlayers.forEach((player) => {
      targets[player.id] = Math.max(1, Math.min(4, Math.round(matchQuarterLimits[player.id] ?? DEFAULT_MATCH_QUARTERS)));
    });
    return targets;
  }, [matchFieldPlayers, matchQuarterLimits]);
  const matchQuarterTotal = useMemo(
    () => matchFieldPlayers.reduce((sum, player) => sum + (matchQuarterTargets[player.id] ?? DEFAULT_MATCH_QUARTERS), 0),
    [matchFieldPlayers, matchQuarterTargets],
  );
  const matchQuarterDiff = matchQuarterTotal - MATCH_FIELD_QUARTERS_REQUIRED;
  const activeDualTeamIds = useMemo(() => dualTeamIds.filter((id) => activeFieldIds.has(id)), [dualTeamIds, activeFieldIds]);
  const balanceQuarterTargets = useMemo(() => {
    const targets: Record<string, number> = {};
    activeFieldPlayers.forEach((player) => {
      targets[player.id] = Math.max(1, Math.min(4, Math.round(balanceQuarterLimits[player.id] ?? DEFAULT_BALANCE_QUARTERS)));
    });
    activeDualTeamIds.forEach((id) => {
      targets[id] = 2;
    });
    return targets;
  }, [activeFieldPlayers, activeDualTeamIds, balanceQuarterLimits]);
  const balanceOptions = useMemo<TeamBalanceOptions>(() => ({
    quarterTargets: balanceQuarterTargets,
    dualTeamPlayerIds: activeDualTeamIds,
  }), [balanceQuarterTargets, activeDualTeamIds]);
  const balanceQuarterTotal = useMemo(
    () => activeFieldPlayers.reduce((sum, player) => sum + (balanceQuarterTargets[player.id] ?? DEFAULT_BALANCE_QUARTERS), 0),
    [activeFieldPlayers, balanceQuarterTargets],
  );
  const balanceQuarterDiff = balanceQuarterTotal - BALANCE_FIELD_QUARTERS_REQUIRED;
  const sortedSheetPlayers = useMemo(
    () => players.filter((p) => p.source === "SHEET").sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [players],
  );

  useEffect(() => {
    if (!hydrated) return;
    if (fieldIds.length > 0 && fieldPlayers.length === 0) return;
    saveStored("fieldNames", fieldPlayers.map((player) => player.name));
  }, [fieldIds.length, fieldPlayers, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (waitingIds.length > 0 && waitingPlayers.length === 0) return;
    saveStored("waitingNames", waitingPlayers.map((player) => player.name));
  }, [waitingIds.length, waitingPlayers, hydrated]);

  const staffFirstSheetPlayers = useMemo(
    () => [...sortedSheetPlayers].sort((a, b) => {
      const aPriority = staffSearchPriority(extractStaffRole(a.memo));
      const bPriority = staffSearchPriority(extractStaffRole(b.memo));
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.name.localeCompare(b.name, "ko");
    }),
    [sortedSheetPlayers],
  );
  const searchedPlayers = useMemo(() => {
    const query = playerQuery.trim().toLowerCase();
    if (!query) return [];
    if (query === ".") return staffFirstSheetPlayers;
    return sortedSheetPlayers
      .filter((player) => [player.name, player.primaryPosition, player.secondaryPositions.join(",")].join(" ").toLowerCase().includes(query))
      .slice(0, 20);
  }, [playerQuery, sortedSheetPlayers, staffFirstSheetPlayers]);
  const recordPlayerOptions = useMemo(
    () => uniqueRecordNames([...sortedSheetPlayers.map((player) => player.name), ...dedicatedGks.map((gk) => gk.name)]),
    [sortedSheetPlayers, dedicatedGks],
  );

  const canGenerate = plannerMode === "BALANCE"
    ? activeFieldPlayers.length >= 22 && activeFieldPlayers.length <= 36
    : matchRosterSize >= 10 && matchRosterSize <= 18 && matchFieldPlayers.length >= matchRosterSize;

  function resetResults() {
    clearLineupShareHash();
    setTeamResult(null);
    setTeamVariants([]);
    setSelectedVariantIdx(0);
    setLineupResult(null);
    setMatchResult(null);
    setCopied(false);
    setTeamsConfirmed(false);
    setSwapSelection(null);
  }

  function changePlannerMode(nextMode: PlannerMode) {
    if (nextMode === plannerMode) return;
    clearLineupShareHash();
    setPlannerMode(nextMode);
    setTeamResult(null);
    setTeamVariants([]);
    setSelectedVariantIdx(0);
    setLineupResult(null);
    setMatchResult(null);
    setCopied(false);
    setTeamsConfirmed(false);
    setSwapSelection(null);
  }

  function toggleRecordEdit() {
    setShowRecordEdit((value) => {
      const next = !value;
      if (next) window.setTimeout(() => document.querySelector("[data-mrw-active='true']")?.scrollIntoView({ block: "start" }), 0);
      return next;
    });
  }

  async function handleLoad() {
    resetResults();
    setErrors([]);
    setWarnings([]);
    const result = await loadPlayersFromCsv(csvUrl);

    const fieldIdSet = new Set(fieldIds);
    const activeTempGuests = tempGuests.filter((guestPlayer) => fieldIdSet.has(guestPlayer.id));
    const selectablePlayers = [...result.players, ...activeTempGuests];
    const validIds = new Set(selectablePlayers.map((p) => p.id));

    setPlayers(result.players);
    if (activeTempGuests.length !== tempGuests.length) {
      setTempGuests(activeTempGuests);
    }
    setRelations(result.relations);
    setErrors(result.errors);
    setWarnings(result.warnings);
    setPlayerQuery("");
    setFieldIds((prev) => {
      const next: string[] = [];
      const seen = new Set<string>();
      for (const id of prev) {
        if (!validIds.has(id) || seen.has(id)) continue;
        seen.add(id);
        next.push(id);
      }
      return next;
    });
    setWaitingIds((prev) => {
      const next: string[] = [];
      const seen = new Set<string>();
      for (const id of prev) {
        if (!validIds.has(id) || seen.has(id)) continue;
        seen.add(id);
        next.push(id);
      }
      return next;
    });
    setDedicatedGks((prev) =>
      prev
        .filter((gk) => gk.source !== "SHEET" || result.players.some((p) => p.id === gk.id)),
    );
    setMatchQuarterLimits((prev) => {
      const next: MatchQuarterLimits = {};
      for (const [id, value] of Object.entries(prev)) {
        if (validIds.has(id)) next[id] = value;
      }
      return next;
    });
    setBalanceQuarterLimits((prev) => {
      const next: Record<string, number> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (validIds.has(id)) next[id] = value;
      }
      return next;
    });
    setDualTeamIds((prev) => prev.filter((id) => validIds.has(id)));
  }

  function handleResetAll() {
    if (!window.confirm("저장된 모든 선택과 캐시를 초기화하시겠습니까?")) return;
    clearStoredAll();
    resetResults();
    setFieldIds([]);
    setDedicatedGks([]);
    setTempGuests([]);
    setTempGks([]);
    setMatchQuarterLimits({});
    setBalanceQuarterLimits({});
    setDualTeamIds([]);
    setPlayers((prev) => prev.filter((p) => p.source === "SHEET"));
  }

  function addFieldPlayer(player: Player) {
    if (player.primaryPosition === "GK") {
      setWarnings((prev) => [...prev, `${player.name}은 GK입니다. 전담 GK로 추가해주세요.`]);
      return;
    }
    if (dedicatedGks.some((gk) => gk.id === player.id)) {
      setWarnings((prev) => [...prev, `${player.name}은 이미 전담 GK로 추가되어 있습니다.`]);
      return;
    }
    if (!fieldIds.includes(player.id)) {
      setFieldIds((prev) => [...prev, player.id]);
    }
    setWaitingIds((prev) => prev.filter((x) => x !== player.id));
    setMatchQuarterLimits((prev) => ({ ...prev, [player.id]: prev[player.id] ?? DEFAULT_MATCH_QUARTERS }));
    setBalanceQuarterLimits((prev) => ({ ...prev, [player.id]: prev[player.id] ?? DEFAULT_BALANCE_QUARTERS }));
  }

  function addWaitingFieldPlayer(player: Player) {
    if (player.primaryPosition === "GK") {
      setWarnings((prev) => [...prev, `${player.name}은 GK입니다. 전담 GK로 추가해주세요.`]);
      return;
    }
    if (dedicatedGks.some((gk) => gk.id === player.id)) {
      setWarnings((prev) => [...prev, `${player.name}은 이미 전담 GK로 추가되어 있습니다.`]);
      return;
    }
    if (!fieldIds.includes(player.id)) {
      setFieldIds((prev) => [...prev, player.id]);
    }
    setWaitingIds((prev) => (prev.includes(player.id) ? prev : [...prev, player.id]));
    setMatchQuarterLimits((prev) => ({ ...prev, [player.id]: prev[player.id] ?? DEFAULT_MATCH_QUARTERS }));
    setBalanceQuarterLimits((prev) => ({ ...prev, [player.id]: prev[player.id] ?? DEFAULT_BALANCE_QUARTERS }));
    setDualTeamIds((prev) => prev.filter((x) => x !== player.id));
  }

  function removeFieldPlayer(id: string) {
    setFieldIds((prev) => prev.filter((item) => item !== id));
    setWaitingIds((prev) => prev.filter((item) => item !== id));
    setTempGuests((prev) => prev.filter((item) => item.id !== id));
    setMatchQuarterLimits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setBalanceQuarterLimits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setDualTeamIds((prev) => prev.filter((item) => item !== id));
  }

  function addDedicatedGk(player: Player) {
    if (fieldIds.includes(player.id)) {
      setWarnings((prev) => [...prev, `${player.name}은 이미 필드 참석자로 추가되어 있습니다.`]);
      return;
    }
    if (dedicatedGks.some((gk) => gk.id === player.id)) return;
    setDedicatedGks((prev) => [...prev, { id: player.id, source: "SHEET", name: player.name, memo: player.memo }]);
  }

  function removeDedicatedGk(id: string) {
    setDedicatedGks((prev) => prev.filter((item) => item.id !== id));
  }

  function resetGuest() {
    setGuest(emptyGuest);
    setGuestRole("FIELD");
  }

  function addTempGuest() {
    const trimmedName = guest.name.trim();
    if (!trimmedName) return;
    const player: Player = {
      id: `temp_${Date.now()}_${guest.name}`,
      source: "TEMP_GUEST",
      memberType: "GUEST",
      active: true,
      name: trimmedName,
      primaryPosition: guest.primaryPosition,
      secondaryPositions: guest.secondaryPositions,
      centerForwardScore: guest.centerForwardScore,
      wingScore: guest.wingScore,
      attackScore: Math.max(guest.centerForwardScore, guest.wingScore),
      midScore: guest.midScore,
      centerBackScore: guest.centerBackScore,
      wingBackScore: guest.wingBackScore,
      defenseScore: Math.max(guest.centerBackScore, guest.wingBackScore),
      activityScore: guest.activityScore,
      canGk: true,
      memo: guest.memo || undefined,
    };
    setTempGuests((prev) => [...prev, player]);
    setFieldIds((prev) => [...prev, player.id]);
    setMatchQuarterLimits((prev) => ({ ...prev, [player.id]: DEFAULT_MATCH_QUARTERS }));
    setBalanceQuarterLimits((prev) => ({ ...prev, [player.id]: DEFAULT_BALANCE_QUARTERS }));
    resetGuest();
  }

  function addTempGk() {
    if (!guest.name.trim()) return;
    const newGk: DedicatedGoalkeeper = {
      id: `temp_gk_${Date.now()}_${guest.name}`,
      source: "TEMP_GK",
      name: guest.name.trim(),
      memo: guest.memo || undefined,
    };
    setDedicatedGks((prev) => [...prev, newGk]);
    setTempGks((prev) => [...prev, newGk]);
    resetGuest();
  }

  function setBalanceQuarterLimit(playerId: string, value: number) {
    const nextValue = Math.max(1, Math.min(4, Math.round(value)));
    setBalanceQuarterLimits((prev) => ({ ...prev, [playerId]: nextValue }));
    if (nextValue !== 2) {
      setDualTeamIds((prev) => prev.filter((id) => id !== playerId));
    }
  }

  function setBalanceDualTeam(playerId: string, enabled: boolean) {
    setBalanceQuarterLimits((prev) => ({ ...prev, [playerId]: 2 }));
    setDualTeamIds((prev) => {
      if (enabled) return prev.includes(playerId) ? prev : [...prev, playerId];
      return prev.filter((id) => id !== playerId);
    });
  }

  function setMatchQuarterLimit(playerId: string, value: number) {
    const nextValue = Math.max(1, Math.min(4, Math.round(value)));
    setMatchQuarterLimits((prev) => ({ ...prev, [playerId]: nextValue }));
  }

  function handleMatchDragStart(playerId: string) {
    setDraggedMatchPlayerId(playerId);
  }

  function handleMatchDragEnd() {
    setDraggedMatchPlayerId(null);
    setDragOverMatchTarget(null);
  }

  function handleMatchDragOver(event: DragEvent<HTMLElement>, target: string) {
    event.preventDefault();
    setDragOverMatchTarget(target);
  }

  function handleMatchDragLeave() {
    setDragOverMatchTarget(null);
  }

  function handleMatchDropQuarter(event: DragEvent<HTMLElement>, quarter: number) {
    event.preventDefault();
    if (!draggedMatchPlayerId) return;
    setMatchQuarterLimit(draggedMatchPlayerId, quarter);
    handleMatchDragEnd();
  }

  function handleBalanceDragStart(playerId: string) {
    setDraggedBalancePlayerId(playerId);
  }

  function handleBalanceDragEnd() {
    setDraggedBalancePlayerId(null);
    setDragOverBalanceTarget(null);
  }

  function handleBalanceDragOver(event: DragEvent<HTMLElement>, target: string) {
    event.preventDefault();
    setDragOverBalanceTarget(target);
  }

  function handleBalanceDragLeave() {
    setDragOverBalanceTarget(null);
  }

  function handleBalanceDropQuarter(event: DragEvent<HTMLElement>, quarter: number) {
    event.preventDefault();
    if (!draggedBalancePlayerId) return;
    setBalanceQuarterLimit(draggedBalancePlayerId, quarter);
    handleBalanceDragEnd();
  }

  function handleBalanceDropDual(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!draggedBalancePlayerId) return;
    setBalanceDualTeam(draggedBalancePlayerId, true);
    handleBalanceDragEnd();
  }

  function runPlanner() {
    resetResults();
    try {
      if (plannerMode === "MATCH") {
        setMatchResult(planMatchLineup(matchActiveFieldPlayers, dedicatedGks, matchQuarterTargets, matchCallupPlayers));
      } else {
        const variants = balanceTeamsVariants(activeFieldPlayers, 10, relations, balanceOptions);
        setTeamVariants(variants);
        setSelectedVariantIdx(0);
        setTeamResult(variants[0]);
      }
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  function selectVariant(idx: number) {
    if (idx < 0 || idx >= teamVariants.length) return;
    setSelectedVariantIdx(idx);
    setTeamResult(teamVariants[idx]);
    setSwapSelection(null);
    setLineupResult(null);
    setTeamsConfirmed(false);
  }

  async function handleConfirmTeams() {
    if (!teamResult) return;
    try {
      const lineup = generateLineups(teamResult.teamA, teamResult.teamB, dedicatedGks, waitingPlayers, balanceOptions);
      setLineupResult(lineup);
      setTeamsConfirmed(true);
      setSwapSelection(null);

      const recordDate = formatLocalDate();
      let shareUrl = typeof window !== "undefined" ? window.location.href : "/";
      try {
        shareUrl = await buildLineupShareUrl(lineup, { teamResult, selectedVariantIdx }) ?? shareUrl;
      } catch {
        // 기록 저장은 공유 URL 압축 지원 여부와 별개로 진행한다.
      }
      const record = buildTeamRecord(teamResult, recordDate, shareUrl);
      try {
        await upsertTeamRecord(record);
        setWarnings((prev) => prev.filter((item) => !item.startsWith("팀 확정 기록 저장 실패:")));
      } catch (error) {
        const message = `팀 확정 기록 저장 실패: ${error instanceof Error ? error.message : String(error)}`;
        setWarnings((prev) => [...prev.filter((item) => !item.startsWith("팀 확정 기록 저장 실패:")), message]);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  function handleReadjustTeams() {
    setLineupResult(null);
    setTeamsConfirmed(false);
  }

  function handleGroupTarget(targetTeam: "A" | "B", targetGroup: PositionGroup) {
    if (!teamResult || teamsConfirmed || !swapSelection) return;
    const sourceTeamPlayers = swapSelection.team === "A" ? teamResult.teamA.players : teamResult.teamB.players;
    const targetTeamPlayers = targetTeam === "A" ? teamResult.teamA.players : teamResult.teamB.players;
    const sourcePlayer = sourceTeamPlayers.find((p) => p.id === swapSelection.playerId);
    if (!sourcePlayer) return;
    if (swapSelection.team === targetTeam) {
      if (sourcePlayer.assignedGroup === targetGroup) {
        setSwapSelection(null);
        return;
      }
      const updated = sourceTeamPlayers.map((p) => (p.id === sourcePlayer.id ? reassignPlayerGroup(p, targetGroup) : p));
      try {
        const next = targetTeam === "A"
          ? summarizeTeams(updated, teamResult.teamB.players, relations, balanceOptions)
          : summarizeTeams(teamResult.teamA.players, updated, relations, balanceOptions);
        setTeamResult(next);
        setSwapSelection(null);
      } catch (error) {
        setErrors([error instanceof Error ? error.message : String(error)]);
      }
      return;
    }
    const movedPlayer = reassignPlayerGroup(sourcePlayer, targetGroup);
    const sourceNext = sourceTeamPlayers.filter((p) => p.id !== sourcePlayer.id);
    const targetNext = [...targetTeamPlayers, movedPlayer];
    try {
      const next = swapSelection.team === "A"
        ? summarizeTeams(sourceNext, targetNext, relations, balanceOptions)
        : summarizeTeams(targetNext, sourceNext, relations, balanceOptions);
      setTeamResult(next);
      setSwapSelection(null);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  function handleSubRoleTarget(targetTeam: "A" | "B", playerId: string, targetSubRole: AssignedSubRole) {
    if (!teamResult || teamsConfirmed) return;
    const targetGroup = groupForAssignedSubRole(targetSubRole);
    const updatePlayers = (players: TeamBalanceResult["teamA"]["players"]) => players.map((player) => {
      if (player.id !== playerId) return player;
      const reassigned = player.assignedGroup === targetGroup ? player : reassignPlayerGroup(player, targetGroup);
      return { ...reassigned, assignedSubRole: targetSubRole };
    });
    const nextA = targetTeam === "A" ? updatePlayers(teamResult.teamA.players) : teamResult.teamA.players;
    const nextB = targetTeam === "B" ? updatePlayers(teamResult.teamB.players) : teamResult.teamB.players;
    try {
      const next = summarizeTeams(nextA, nextB, relations, balanceOptions);
      setTeamResult(next);
      setSwapSelection(null);
      setLineupResult(null);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  function handlePlayerClick(team: "A" | "B", playerId: string) {
    if (!teamResult || teamsConfirmed) return;
    if (!swapSelection) {
      setSwapSelection({ team, playerId });
      return;
    }
    if (swapSelection.team === team && swapSelection.playerId === playerId) {
      setSwapSelection(null);
      return;
    }
    if (swapSelection.team === team) {
      const teamPlayers = team === "A" ? teamResult.teamA.players : teamResult.teamB.players;
      const playerA = teamPlayers.find((p) => p.id === swapSelection.playerId);
      const playerB = teamPlayers.find((p) => p.id === playerId);
      if (!playerA || !playerB) {
        setSwapSelection(null);
        return;
      }
      if (playerA.assignedGroup === playerB.assignedGroup) {
        setSwapSelection({ team, playerId });
        return;
      }
      const reassign = (p: typeof playerA, newGroup: PositionGroup) => {
        if (p.primaryPosition === "GK") return p;
        const primaryGroup = getPositionGroup(p.primaryPosition);
        const reason = primaryGroup === newGroup
          ? "주포지션 그룹 배정"
          : hasGroup(p.secondaryPositions, newGroup)
            ? "부포지션 그룹 배정"
            : "인원 균형을 위한 포지션 변경";
        return {
          ...p,
          assignedGroup: newGroup,
          assignmentReason: reason,
          isPositionOverride: primaryGroup !== newGroup,
        };
      };
      const updated = teamPlayers.map((p) => {
        if (p.id === playerA.id) return reassign(playerB, playerA.assignedGroup);
        if (p.id === playerB.id) return reassign(playerA, playerB.assignedGroup);
        return p;
      });
      try {
        const next = team === "A"
          ? summarizeTeams(updated, teamResult.teamB.players, relations, balanceOptions)
          : summarizeTeams(teamResult.teamA.players, updated, relations, balanceOptions);
        setTeamResult(next);
        setSwapSelection(null);
      } catch (error) {
        setErrors([error instanceof Error ? error.message : String(error)]);
      }
      return;
    }
    const teamAPlayers = teamResult.teamA.players;
    const teamBPlayers = teamResult.teamB.players;
    const aPlayer = swapSelection.team === "A"
      ? teamAPlayers.find((p) => p.id === swapSelection.playerId)
      : teamAPlayers.find((p) => p.id === playerId);
    const bPlayer = swapSelection.team === "B"
      ? teamBPlayers.find((p) => p.id === swapSelection.playerId)
      : teamBPlayers.find((p) => p.id === playerId);
    if (!aPlayer || !bPlayer) {
      setSwapSelection(null);
      return;
    }
    const reassign = <T extends { primaryPosition: Player["primaryPosition"]; secondaryPositions: FieldPosition[] }>(p: T, newGroup: PositionGroup): T & { assignedGroup: PositionGroup; assignmentReason: string; isPositionOverride: boolean } => {
      if (p.primaryPosition === "GK") {
        return { ...p, assignedGroup: newGroup, assignmentReason: "주포지션 그룹 배정", isPositionOverride: false };
      }
      const primaryGroup = getPositionGroup(p.primaryPosition);
      const reason = primaryGroup === newGroup
        ? "주포지션 그룹 배정"
        : hasGroup(p.secondaryPositions, newGroup)
          ? "부포지션 그룹 배정"
          : "인원 균형을 위한 포지션 변경";
      return {
        ...p,
        assignedGroup: newGroup,
        assignmentReason: reason,
        isPositionOverride: primaryGroup !== newGroup,
      };
    };
    const newA = teamAPlayers.map((p) => (p.id === aPlayer.id ? reassign(bPlayer, aPlayer.assignedGroup) : p));
    const newB = teamBPlayers.map((p) => (p.id === bPlayer.id ? reassign(aPlayer, bPlayer.assignedGroup) : p));
    try {
      const next = summarizeTeams(newA, newB, relations, balanceOptions);
      setTeamResult(next);
      setSwapSelection(null);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  const handleLineupQuartersChange = useCallback((quarters: LineupResult["quarters"]) => {
    clearLineupShareHash();
    setCopied(false);
    setLineupResult((prev) => {
      if (!prev || prev.quarters === quarters) return prev;
      return { ...prev, quarters };
    });
  }, []);

  const handleMatchQuartersChange = useCallback((quarters: MatchPlanResult["quarters"]) => {
    clearLineupShareHash();
    setCopied(false);
    setMatchResult((prev) => {
      if (!prev || prev.quarters === quarters) return prev;
      return { ...prev, quarters };
    });
  }, []);

  async function copyLineupShareUrl(lineup: LineupResult, teamContext?: LineupShareTeamContext, prebuiltUrl?: string | null) {
    try {
      const url = prebuiltUrl ?? await buildLineupShareUrl(lineup, teamContext);
      if (!url) return;
      const shareData = { title: "DEV FC 라인업", text: "DEV FC 라인업/팀분배 공유", url };
      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(shareData))) {
        try {
          await navigator.share(shareData);
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === "AbortError") return;
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
          } else {
            window.prompt("공유 URL을 복사하세요.", url);
          }
        }
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        window.prompt("공유 URL을 복사하세요.", url);
      }
      window.history.replaceState(null, "", url);
      setCopied(true);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  async function copyTeamShareUrl() {
    try {
      const url = await buildTeamShareUrl(teamVariants, selectedVariantIdx);
      if (!url) return;
      const shareData = { title: "DEV FC 팀분배", text: "DEV FC 팀분배 10개 조합 공유", url };
      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(shareData))) {
        try {
          await navigator.share(shareData);
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === "AbortError") return;
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
          } else {
            window.prompt("공유 URL을 복사하세요", url);
          }
        }
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        window.prompt("공유 URL을 복사하세요", url);
      }
      window.history.replaceState(null, "", url);
      setCopied(true);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  async function copyMatchLineupShareUrl(match: MatchPlanResult, prebuiltUrl?: string | null) {
    try {
      const url = prebuiltUrl ?? await buildMatchLineupShareUrl(match);
      if (!url) return;
      const shareData = { title: "DEV FC 매치 라인업", text: "DEV FC 매치 라인업 공유", url };
      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(shareData))) {
        try {
          await navigator.share(shareData);
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === "AbortError") return;
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
          } else {
            window.prompt("공유 URL을 복사하세요.", url);
          }
        }
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        window.prompt("공유 URL을 복사하세요.", url);
      }
      window.history.replaceState(null, "", url);
      setCopied(true);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  return (
    <main className="mx-auto max-w-7xl p-4 pb-28 sm:p-8">
      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">DEV FC Planner</h1>
          <button
            type="button"
            className={`rounded-xl px-4 py-2 text-sm font-bold ${showRecordEdit ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
            onClick={toggleRecordEdit}
          >
            기록 수정
          </button>
        </div>
      </section>

      {showRecordEdit && (
        <RecordEntryAnchor
          title="기록 수정"
          description="저장된 경기 기록을 날짜로 불러와 스코어, 구성원, 개인 골/도움을 수정합니다."
          matchKind={plannerMode === "MATCH" ? "MATCH" : "SELF"}
          records={[]}
          staffRoles={{}}
          playerOptions={recordPlayerOptions}
          editOnly
          allowEdit={false}
          allowPlayerEdit
          onClose={() => setShowRecordEdit(false)}
        />
      )}

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold">선수정보</h2>
            <p className="mt-1 break-all text-sm text-slate-600">{csvUrl}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold" href={csvUrl} target="_blank" rel="noreferrer">시트 수정</a>
            <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold" onClick={() => setShowSheetUrl((v) => !v)}>{showSheetUrl ? "URL 숨기기" : "URL 변경"}</button>
            <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={handleLoad}>불러오기</button>
            <button className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700" onClick={handleResetAll}>초기화</button>
          </div>
        </div>
        {showSheetUrl && (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input className="flex-1 rounded-xl border border-slate-300 px-4 py-3" value={csvUrl} onChange={(e) => setCsvUrl(e.target.value)} placeholder="Google Sheets URL" />
            <button className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white" onClick={handleLoad} disabled={!csvUrl.trim()}>다시 불러오기</button>
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="불러온 선수" value={`${players.length}명`} />
          <Stat label="필드 참석자" value={`${fieldIds.length}명`} />
          <Stat label="전담 GK" value={`${dedicatedGks.length}명`} />
          <Stat label="궁합도 조건" value={`${relations.length}개`} />
        </div>
      </section>

      {(errors.length > 0 || warnings.length > 0) && (
        <section className="mb-6 grid gap-4 md:grid-cols-2">
          {errors.length > 0 && <MessageBox title="오류" items={errors} tone="error" />}
          {warnings.length > 0 && <MessageBox title="경고" items={warnings} tone="warning" />}
        </section>
      )}

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">선수검색</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">{players.length}명</span>
        </div>
        <p className="mt-2 text-sm text-slate-600">이름을 검색해서 필드 참석자 또는 전담 GK로 추가하세요. . 을 입력하면 전체 인원을 볼 수 있습니다.</p>
        <div className="mt-4 flex gap-2">
          <input className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3" value={playerQuery} onChange={(e) => setPlayerQuery(e.target.value)} placeholder="이름 검색 예: 하성주 / 전체 보기: ." />
          {playerQuery && <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold" onClick={() => setPlayerQuery("")}>초기화</button>}
        </div>
        <div className="mt-3 grid gap-2 overflow-y-auto pr-1" style={{ maxHeight: "520px" }}>
          {searchedPlayers.map((p) => {
            const isField = fieldIds.includes(p.id);
            const isGk = dedicatedGks.some((gk) => gk.id === p.id);
            const isWaiting = waitingIds.includes(p.id);
            return <PlayerSearchRow key={p.id} player={p} isField={isField} isWaiting={isWaiting} isGk={isGk} onAddField={() => addFieldPlayer(p)} onRemoveField={() => removeFieldPlayer(p.id)} onAddWaiting={() => addWaitingFieldPlayer(p)} onAddGk={() => addDedicatedGk(p)} onRemoveGk={() => removeDedicatedGk(p.id)} />;
          })}
          {players.length > 0 && playerQuery.trim() && searchedPlayers.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">검색 결과가 없습니다.</p>}
          {players.length > 0 && !playerQuery.trim() && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">검색어를 입력하거나 . 을 입력하면 전체 목록을 볼 수 있습니다.</p>}
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">선수추가</h2>
        <p className="mt-1 text-xs text-slate-500">시트에 없는 용병을 정식 참석자로 추가합니다. 대기는 시트 선수만 가능 — 선수검색의 대기 버튼을 사용하세요.</p>
        <div className="mt-4 grid gap-4">
          <input className="rounded-xl border border-slate-300 px-3 py-3" placeholder="이름" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
          <PositionPicker title="주포지션" includeGk selectedRole={guestRole} primary={guest.primaryPosition} onGk={() => setGuestRole("GK")} onField={(position) => { setGuestRole("FIELD"); setGuest({ ...guest, primaryPosition: position }); }} />
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-600">부포지션</p>
            <div className="grid grid-cols-8 gap-1 sm:flex sm:flex-wrap sm:gap-2">
              <button type="button" className={`min-w-0 whitespace-nowrap rounded-full px-1 py-1.5 text-[11px] font-bold leading-none sm:px-3 sm:py-2 sm:text-sm ${guest.secondaryPositions.length === 0 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} onClick={() => setGuest({ ...guest, secondaryPositions: [] })}>없음</button>
              {POSITIONS.map((position) => {
                const selected = guest.secondaryPositions[0] === position;
                return <button key={position} type="button" className={`min-w-0 whitespace-nowrap rounded-full px-1 py-1.5 text-[11px] font-bold leading-none sm:px-3 sm:py-2 sm:text-sm ${selected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} onClick={() => setGuest({ ...guest, secondaryPositions: [position] })}>{position}</button>;
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <ScoreSelect label="CF" value={guest.centerForwardScore} onChange={(v) => setGuest({ ...guest, centerForwardScore: v })} />
            <ScoreSelect label="WING" value={guest.wingScore} onChange={(v) => setGuest({ ...guest, wingScore: v })} />
            <ScoreSelect label="MID" value={guest.midScore} onChange={(v) => setGuest({ ...guest, midScore: v })} />
            <ScoreSelect label="CB" value={guest.centerBackScore} onChange={(v) => setGuest({ ...guest, centerBackScore: v })} />
            <ScoreSelect label="WB" value={guest.wingBackScore} onChange={(v) => setGuest({ ...guest, wingBackScore: v })} />
            <ScoreSelect label="ACT" value={guest.activityScore} onChange={(v) => setGuest({ ...guest, activityScore: v })} />
          </div>
          <input className="rounded-xl border border-slate-300 px-3 py-2" placeholder="메모" value={guest.memo} onChange={(e) => setGuest({ ...guest, memo: e.target.value })} />
          <button className={`w-full rounded-xl px-4 py-3 font-semibold text-white ${guestRole === "GK" ? "bg-emerald-600" : "bg-violet-600"}`} onClick={guestRole === "GK" ? addTempGk : addTempGuest}>
            {guestRole === "GK" ? "임시 GK 추가" : "용병 추가"}
          </button>
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">참석자</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="정규" value={`${regularCount}명`} />
          <Stat label="용병" value={`${guestCount}명`} />
          <Stat label="대기" value={`${waitingCount}명`} />
          <Stat label={plannerMode === "MATCH" ? "매치" : "필드"} value={`${plannerMode === "MATCH" ? matchRosterSize : activeFieldPlayers.length}명`} />
          <Stat label="GK" value={`${dedicatedGks.length}`} />
        </div>
        <h3 className="mt-5 font-semibold">필드 참석자</h3>
        <div className="mt-2 flex flex-wrap gap-2">{fieldPlayers.map((p) => {
          const waitingState = isWaitingPlayer(p);
          const tone = waitingState ? "waiting" : p.memberType === "GUEST" ? "guest" : "regular";
          return <Chip key={p.id} label={`${p.name}(${p.primaryPosition})`} tone={tone} badge={<StaffRoleBadge role={extractStaffRole(p.memo)} compact />} onRemove={() => removeFieldPlayer(p.id)} />;
        })}</div>
        <h3 className="mt-5 font-semibold">전담 GK</h3>
        <div className="mt-2 flex flex-wrap gap-2">{dedicatedGks.map((gk) => <Chip key={gk.id} label={gk.name} badge={<StaffRoleBadge role={extractStaffRole(gk.memo)} compact />} onRemove={() => removeDedicatedGk(gk.id)} />)}</div>
      </section>

      {plannerMode === "BALANCE" && activeFieldPlayers.length > 0 && (
        <section className="mb-6 rounded-3xl bg-white p-4 shadow-sm sm:p-6">
          <BalanceQuarterPlanner
            players={activeFieldPlayers}
            quarterTargets={balanceQuarterTargets}
            dualTeamIds={activeDualTeamIds}
            total={balanceQuarterTotal}
            diff={balanceQuarterDiff}
            draggedPlayerId={draggedBalancePlayerId}
            dragOverTarget={dragOverBalanceTarget}
            onDragStart={handleBalanceDragStart}
            onDragEnd={handleBalanceDragEnd}
            onDragOver={handleBalanceDragOver}
            onDragLeave={handleBalanceDragLeave}
            onDropQuarter={handleBalanceDropQuarter}
            onDropDual={handleBalanceDropDual}
            onSetQuarter={setBalanceQuarterLimit}
            onSetDual={setBalanceDualTeam}
          />
        </section>
      )}

      {plannerMode === "MATCH" && matchFieldPlayers.length > 0 && (
        <section className="mb-6 rounded-3xl bg-white p-4 shadow-sm sm:p-6">
          <MatchQuarterPlanner
            players={matchFieldPlayers}
            requiredIds={matchRequiredIds}
            quarterTargets={matchQuarterTargets}
            total={matchQuarterTotal}
            diff={matchQuarterDiff}
            draggedPlayerId={draggedMatchPlayerId}
            dragOverTarget={dragOverMatchTarget}
            onDragStart={handleMatchDragStart}
            onDragEnd={handleMatchDragEnd}
            onDragOver={handleMatchDragOver}
            onDragLeave={handleMatchDragLeave}
            onDropQuarter={handleMatchDropQuarter}
            onSetQuarter={setMatchQuarterLimit}
          />
        </section>
      )}

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">팀분배&라인업</h2>
            <p className="mt-1 text-sm text-slate-600">{modeHelp(plannerMode)}</p>
            <div className="mt-3 flex gap-2">
              <ModeButton active={plannerMode === "BALANCE"} onClick={() => changePlannerMode("BALANCE")}>내부전</ModeButton>
              <ModeButton active={plannerMode === "MATCH"} onClick={() => changePlannerMode("MATCH")}>매치</ModeButton>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:bg-slate-300" onClick={runPlanner} disabled={!canGenerate}>자동 생성</button>
          </div>
        </div>
      </section>

      {plannerMode === "BALANCE" && teamResult && (
        <TeamResultView
          result={teamResult}
          confirmed={teamsConfirmed}
          selection={swapSelection}
          variantCount={teamVariants.length}
          selectedVariantIdx={selectedVariantIdx}
          onSelectVariant={selectVariant}
          onPlayerClick={handlePlayerClick}
          onGroupTarget={handleGroupTarget}
          onSubRoleTarget={handleSubRoleTarget}
          onConfirm={handleConfirmTeams}
          onReadjust={handleReadjustTeams}
          onCopyTeamShareUrl={copyTeamShareUrl}
          copied={copied}
        />
      )}
      {lineupResult && (
        <LineupResultView
          result={lineupResult}
          teamResult={plannerMode === "BALANCE" ? teamResult : null}
          selectedVariantIdx={plannerMode === "BALANCE" ? selectedVariantIdx : 0}
          copied={copied}
          onCopyShareUrl={copyLineupShareUrl}
          onQuartersChange={handleLineupQuartersChange}
        />
      )}
      {plannerMode === "MATCH" && matchResult && (
        <MatchResultView
          result={matchResult}
          copied={copied}
          quarterPlanTotal={matchQuarterTotal}
          quarterPlanRequired={MATCH_FIELD_QUARTERS_REQUIRED}
          onCopyShareUrl={copyMatchLineupShareUrl}
          onQuartersChange={handleMatchQuartersChange}
        />
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="text-sm font-semibold">
            {plannerMode === "BALANCE"
              ? `내부전 · 필드 ${activeFieldPlayers.length}명${waitingCount > 0 ? ` (대기 ${waitingCount})` : ""} · 전담 GK ${dedicatedGks.length}`
              : `매치 · 참석 ${matchRosterSize}명${waitingCount > 0 ? ` (콜업 후보 ${waitingCount})` : ""} · 설정 ${matchQuarterTotal}/${MATCH_FIELD_QUARTERS_REQUIRED}Q · 전담 GK ${dedicatedGks.length}`}
            {!canGenerate && <p className="text-xs font-normal text-slate-500">{plannerMode === "BALANCE" ? "내부전은 24명 이상 권장, 22명부터 가능" : "매치는 필드 10명~18명 필요"}</p>}
          </div>
          <button className="shrink-0 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300" onClick={runPlanner} disabled={!canGenerate}>자동 생성</button>
        </div>
      </div>
    </main>
  );
}

type RecordEntryRecord = {
  quarter: Quarter;
  team: TeamName;
  attack: string[];
  mid: string[];
  defense: string[];
  gk: string;
  bench: string[];
};

function RecordEntryAnchor({
  title,
  description,
  matchKind,
  records,
  staffRoles,
  playerOptions,
  awayTeamName,
  editOnly = false,
  allowEdit = true,
  allowPlayerEdit = false,
  onClose,
}: {
  title: string;
  description: string;
  matchKind: "SELF" | "MATCH";
  records: RecordEntryRecord[];
  staffRoles: Partial<Record<string, StaffRole>>;
  playerOptions?: string[];
  awayTeamName?: string;
  editOnly?: boolean;
  allowEdit?: boolean;
  allowPlayerEdit?: boolean;
  onClose: () => void;
}) {
  const payload = {
    key: editOnly ? `EDIT:${matchKind}` : recordEntryKey(matchKind, records),
    matchKind,
    awayTeamName,
    records,
    staffRoles,
    playerOptions,
    editOnly,
    allowEdit,
    allowPlayerEdit,
  };
  return (
    <section id="record-edit-panel" data-mrw-standalone="true" data-mrw-active="true" className="mb-6 rounded-3xl bg-white p-4 shadow-sm sm:p-6">
      <script
        type="application/json"
        data-mrw-records
        dangerouslySetInnerHTML={{ __html: safeJson(payload) }}
      />
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <button className="shrink-0 whitespace-nowrap rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700" onClick={onClose}>닫기</button>
      </div>
    </section>
  );
}

function recordEntryKey(matchKind: "SELF" | "MATCH", records: RecordEntryRecord[]): string {
  return `${matchKind}:${records
    .map((record) =>
      [
        record.quarter,
        record.team,
        record.attack.join("|"),
        record.mid.join("|"),
        record.defense.join("|"),
        record.gk,
        record.bench.join("|"),
      ].join(":"),
    )
    .join("::")}`;
}

function uniqueRecordNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  names.forEach((name) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === "없음" || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} onClick={onClick}>{children}</button>;
}

function MatchQuarterPlanner({
  players,
  requiredIds,
  quarterTargets,
  total,
  diff,
  draggedPlayerId,
  dragOverTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDropQuarter,
  onSetQuarter,
}: {
  players: Player[];
  requiredIds: Set<string>;
  quarterTargets: MatchQuarterLimits;
  total: number;
  diff: number;
  draggedPlayerId: string | null;
  dragOverTarget: string | null;
  onDragStart: (playerId: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, target: string) => void;
  onDragLeave: () => void;
  onDropQuarter: (event: DragEvent<HTMLElement>, quarter: number) => void;
  onSetQuarter: (playerId: string, value: number) => void;
}) {
  const diffTone = diff === 0
    ? "bg-emerald-100 text-emerald-700"
    : Math.abs(diff) <= 2
      ? "bg-amber-100 text-amber-700"
      : "bg-rose-100 text-rose-700";
  const diffLabel = diff === 0 ? "정상" : diff > 0 ? `+${diff}Q 초과` : `${Math.abs(diff)}Q 부족`;
  const byQuarter = (quarter: number) => players.filter((player) => (quarterTargets[player.id] ?? DEFAULT_MATCH_QUARTERS) === quarter);
  const callupCount = players.filter((player) => !requiredIds.has(player.id)).length;

  const renderChip = (player: Player) => {
    const quarter = quarterTargets[player.id] ?? DEFAULT_MATCH_QUARTERS;
    const isCallup = !requiredIds.has(player.id);
    const isDragging = draggedPlayerId === player.id;
    const toneClass = isCallup
      ? "bg-orange-100 text-orange-800"
      : player.memberType === "GUEST"
        ? "bg-violet-100 text-violet-800"
        : "bg-slate-100 text-slate-700";
    return (
      <div
        key={player.id}
        draggable
        onDragStart={() => onDragStart(player.id)}
        onDragEnd={onDragEnd}
        className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1.5 text-sm font-semibold ${toneClass} ${isDragging ? "opacity-40" : ""}`}
        title="드래그해서 매치 출전 쿼터를 바꿀 수 있습니다."
      >
        <span className="truncate">{player.name}({player.primaryPosition})</span>
        <StaffRoleBadge role={extractStaffRole(player.memo)} compact />
        {isCallup && <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black">콜업</span>}
        <button
          type="button"
          className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-xs font-black disabled:opacity-30"
          onClick={(event) => {
            event.stopPropagation();
            onSetQuarter(player.id, quarter - 1);
          }}
          disabled={quarter <= 1}
          aria-label={`${player.name} 매치 출전 쿼터 줄이기`}
        >
          -
        </button>
        <span className="min-w-6 text-center text-xs font-black">{quarter}Q</span>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-xs font-black disabled:opacity-30"
          onClick={(event) => {
            event.stopPropagation();
            onSetQuarter(player.id, quarter + 1);
          }}
          disabled={quarter >= 4}
          aria-label={`${player.name} 매치 출전 쿼터 늘리기`}
        >
          +
        </button>
      </div>
    );
  };

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-bold">매치 출전 쿼터 설정</h2>
          <p className="mt-1 text-sm text-slate-600">참석자와 콜업 후보를 1Q~4Q 칸으로 옮기면 매치 베스트 라인업과 1~4Q 회전에 반영됩니다. 모바일에서는 칩의 -/+ 버튼으로 조정하세요.</p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">필요 총 {MATCH_FIELD_QUARTERS_REQUIRED}Q</span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${diffTone}`}>설정 {total}Q</span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${diffTone}`}>{diffLabel}</span>
          {callupCount > 0 && <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800">콜업 후보 {callupCount}명 포함</span>}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {QUARTER_OPTIONS.map((quarter) => {
          const items = byQuarter(quarter);
          const target = `match-quarter-${quarter}`;
          return (
            <div
              key={quarter}
              className={`min-h-36 rounded-2xl border p-3 ${dragOverTarget === target ? "border-slate-900 bg-indigo-50" : "border-slate-200 bg-slate-50"}`}
              onDragOver={(event) => onDragOver(event, target)}
              onDragLeave={onDragLeave}
              onDrop={(event) => onDropQuarter(event, quarter)}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-black">{quarter}Q</h3>
                <span className="text-xs font-bold text-slate-500">{items.length}명 · {items.length * quarter}Q</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {items.map(renderChip)}
                {items.length === 0 && <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-400">여기로 드래그</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BalanceQuarterPlanner({
  players,
  quarterTargets,
  dualTeamIds,
  total,
  diff,
  draggedPlayerId,
  dragOverTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDropQuarter,
  onDropDual,
  onSetQuarter,
  onSetDual,
}: {
  players: Player[];
  quarterTargets: Record<string, number>;
  dualTeamIds: string[];
  total: number;
  diff: number;
  draggedPlayerId: string | null;
  dragOverTarget: string | null;
  onDragStart: (playerId: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, target: string) => void;
  onDragLeave: () => void;
  onDropQuarter: (event: DragEvent<HTMLElement>, quarter: number) => void;
  onDropDual: (event: DragEvent<HTMLElement>) => void;
  onSetQuarter: (playerId: string, value: number) => void;
  onSetDual: (playerId: string, enabled: boolean) => void;
}) {
  const dualSet = new Set(dualTeamIds);
  const diffTone = diff === 0
    ? "bg-emerald-100 text-emerald-700"
    : Math.abs(diff) <= 2
      ? "bg-amber-100 text-amber-700"
      : "bg-rose-100 text-rose-700";
  const diffLabel = diff === 0 ? "정상" : diff > 0 ? `+${diff}Q 초과` : `${Math.abs(diff)}Q 부족`;
  const byQuarter = (quarter: number) => players.filter((player) => !dualSet.has(player.id) && (quarterTargets[player.id] ?? DEFAULT_BALANCE_QUARTERS) === quarter);

  const renderChip = (player: Player) => {
    const quarter = quarterTargets[player.id] ?? DEFAULT_BALANCE_QUARTERS;
    const isDual = dualSet.has(player.id);
    const isDragging = draggedPlayerId === player.id;
    return (
      <div
        key={player.id}
        draggable
        onDragStart={() => onDragStart(player.id)}
        onDragEnd={onDragEnd}
        className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1.5 text-sm font-semibold ${isDual ? "bg-cyan-100 text-cyan-800" : player.memberType === "GUEST" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"} ${isDragging ? "opacity-40" : ""}`}
        title="드래그해서 출전 쿼터를 바꿀 수 있습니다."
      >
        <span className="truncate">{player.name}({player.primaryPosition})</span>
        <StaffRoleBadge role={extractStaffRole(player.memo)} compact />
        {isDual && <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black">양팀</span>}
        <button
          type="button"
          className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-xs font-black disabled:opacity-30"
          onClick={(event) => {
            event.stopPropagation();
            onSetQuarter(player.id, quarter - 1);
          }}
          disabled={quarter <= 1}
          aria-label={`${player.name} 출전 쿼터 줄이기`}
        >
          -
        </button>
        <span className="min-w-6 text-center text-xs font-black">{quarter}Q</span>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-xs font-black disabled:opacity-30"
          onClick={(event) => {
            event.stopPropagation();
            onSetQuarter(player.id, quarter + 1);
          }}
          disabled={quarter >= 4}
          aria-label={`${player.name} 출전 쿼터 늘리기`}
        >
          +
        </button>
        {quarter === 2 && (
          <button
            type="button"
            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${isDual ? "bg-cyan-700 text-white" : "bg-white/80 text-slate-600"}`}
            onClick={(event) => {
              event.stopPropagation();
              onSetDual(player.id, !isDual);
            }}
          >
            양팀
          </button>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-bold">내부전 출전 쿼터 설정</h2>
          <p className="mt-1 text-sm text-slate-600">참석자를 1Q~4Q 칸으로 옮기면 팀분배와 라인업 회전에 반영됩니다. 모바일에서는 칩의 -/+ 버튼으로 조정하세요.</p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">필요 팀당 40Q · 총 {BALANCE_FIELD_QUARTERS_REQUIRED}Q</span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${diffTone}`}>설정 {total}Q</span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${diffTone}`}>{diffLabel}</span>
          <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-bold text-cyan-800">양팀 {dualTeamIds.length}명</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {QUARTER_OPTIONS.map((quarter) => {
          const items = byQuarter(quarter);
          const target = `quarter-${quarter}`;
          return (
            <div
              key={quarter}
              className={`min-h-36 rounded-2xl border p-3 ${dragOverTarget === target ? "border-slate-900 bg-indigo-50" : "border-slate-200 bg-slate-50"}`}
              onDragOver={(event) => onDragOver(event, target)}
              onDragLeave={onDragLeave}
              onDrop={(event) => onDropQuarter(event, quarter)}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-black">{quarter}Q</h3>
                <span className="text-xs font-bold text-slate-500">{items.length}명 · {items.length * quarter}Q</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {items.map(renderChip)}
                {items.length === 0 && <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-400">여기로 드래그</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={`mt-3 rounded-2xl border p-3 ${dragOverTarget === "dual" ? "border-cyan-500 bg-cyan-50" : "border-slate-200 bg-white"}`}
        onDragOver={(event) => onDragOver(event, "dual")}
        onDragLeave={onDragLeave}
        onDrop={onDropDual}
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-bold">양팀 1Q씩 필요한 선수</h3>
            <p className="text-xs text-slate-500">여기로 드래그하면 자동으로 2Q가 되고, 팀분배 점수는 양팀에 1Q씩 나눠 반영합니다.</p>
          </div>
          <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-bold text-cyan-800">{dualTeamIds.length}명</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {players.filter((player) => dualSet.has(player.id)).map(renderChip)}
          {dualTeamIds.length === 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-500">없음</span>}
        </div>
      </div>
    </div>
  );
}

function PositionPicker({ title, includeGk, selectedRole, primary, onGk, onField }: { title: string; includeGk?: boolean; selectedRole: "FIELD" | "GK"; primary: FieldPosition; onGk: () => void; onField: (position: FieldPosition) => void }) {
  const columnCount = includeGk ? POSITIONS.length + 1 : POSITIONS.length;
  const buttonClass = (selected: boolean) => `min-w-0 whitespace-nowrap rounded-full px-1 py-1.5 text-[11px] font-bold leading-none sm:px-3 sm:py-2 sm:text-sm ${selected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`;
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-600">{title}</p>
      <div className="grid gap-1 sm:flex sm:flex-wrap sm:gap-2" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
        {includeGk && <button type="button" className={buttonClass(selectedRole === "GK")} onClick={onGk}>GK</button>}
        {POSITIONS.map((position) => <button key={position} type="button" className={buttonClass(selectedRole === "FIELD" && primary === position)} onClick={() => onField(position)}>{position}</button>)}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-100 p-4"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>;
}

function MessageBox({ title, items, tone }: { title: string; items: string[]; tone: "error" | "warning" | "info" }) {
  const toneClass = tone === "error"
    ? "bg-red-50 text-red-900"
    : tone === "warning"
      ? "bg-amber-50 text-amber-900"
      : "bg-sky-50 text-sky-900";
  return <div className={`rounded-3xl p-5 ${toneClass}`}><h3 className="font-bold">{title}</h3><ul className="mt-2 list-disc pl-5 text-sm">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>;
}

function Chip({ label, onRemove, tone = "regular", badge }: { label: string; onRemove: () => void; tone?: "regular" | "guest" | "waiting"; badge?: ReactNode }) {
  const className = tone === "waiting"
    ? "bg-orange-100 text-orange-800"
    : tone === "guest"
      ? "bg-violet-100 text-violet-800"
      : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ${className}`}>
      <span>{label}</span>
      {badge}
      <button className="font-bold opacity-70" onClick={onRemove}>×</button>
    </span>
  );
}

function PlayerSearchRow({ player, isField, isWaiting, isGk, onAddField, onRemoveField, onAddWaiting, onAddGk, onRemoveGk }: { player: Player; isField: boolean; isWaiting: boolean; isGk: boolean; onAddField: () => void; onRemoveField: () => void; onAddWaiting: () => void; onAddGk: () => void; onRemoveGk: () => void }) {
  const secondary = player.secondaryPositions.length > 0 ? player.secondaryPositions.join(",") : "-";
  const isSheetGk = player.primaryPosition === "GK";
  const fieldRegular = isField && !isWaiting;
  const staffRole = extractStaffRole(player.memo);
  return (
    <div className={`rounded-2xl border p-3 ${isField || isGk ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">{player.name}</p>
            <StaffRoleBadge role={staffRole} />
            <InjuryBadge player={player} />
            {fieldRegular && <RoleBadge role="FIELD" />}
            {isField && isWaiting && <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">대기</span>}
            {(isGk || isSheetGk) && <RoleBadge role="GK" />}
          </div>
          <p className="mt-1 text-xs text-slate-500">주 {player.primaryPosition} · 부 {secondary}</p>
          <p className="mt-0.5 text-xs text-slate-400">{playerScoreLine(player)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {fieldRegular
            ? <button className="rounded-lg bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700" onClick={onRemoveField}>해제</button>
            : <button className="rounded-lg bg-blue-600 px-2.5 py-2 text-xs font-bold text-white disabled:bg-slate-300" onClick={onAddField} disabled={isGk || isSheetGk}>필드</button>}
          {isField && isWaiting
            ? <button className="rounded-lg bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700" onClick={onRemoveField}>해제</button>
            : <button className="rounded-lg bg-orange-500 px-2.5 py-2 text-xs font-bold text-white disabled:bg-slate-300" onClick={onAddWaiting} disabled={isGk || isSheetGk}>대기</button>}
          {isGk
            ? <button className="rounded-lg bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700" onClick={onRemoveGk}>해제</button>
            : <button className="rounded-lg bg-amber-500 px-2.5 py-2 text-xs font-bold text-white disabled:bg-slate-300" onClick={onAddGk} disabled={isField}>GK</button>}
        </div>
      </div>
    </div>
  );
}

function ScoreSelect({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <label className="grid gap-1 text-sm font-semibold text-slate-600">{label}<select className="rounded-xl border border-slate-300 px-3 py-2 font-normal text-slate-900" value={value} onChange={(e) => onChange(Number(e.target.value))}>{SCORE_OPTIONS.map((score) => <option key={score} value={score}>{score}</option>)}</select></label>;
}

function GroupBadge({ group }: { group: PositionGroup }) {
  const label = group === "ATTACK" ? "공격" : group === "MID" ? "미드" : "수비";
  const cls = group === "ATTACK" ? "bg-rose-100 text-rose-700" : group === "MID" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span>;
}

function RoleBadge({ role }: { role: LineupRole }) {
  const cls = role === "FIELD" ? "bg-blue-600 text-white" : role === "GK" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600";
  const label = role === "FIELD" ? "FIELD" : role === "GK" ? "GK" : "BENCH";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span>;
}

function staffRoleBadgeClass(role: StaffRole): string {
  if (role === "단장") return "bg-slate-100 text-slate-800 ring-slate-300";
  if (role === "감독") return "bg-indigo-100 text-indigo-800 ring-indigo-200";
  return "bg-cyan-100 text-cyan-800 ring-cyan-200";
}

function StaffRoleBadge({ role, compact = false, hideOnMobile = false, imageMode = false }: { role?: StaffRole | null; compact?: boolean; hideOnMobile?: boolean; imageMode?: boolean }) {
  if (!role) return null;
  const sizeClass = imageMode
    ? compact
      ? "min-h-4 px-1.5 py-0 text-[9px]"
      : "min-h-5 px-2 py-0 text-[11px]"
    : compact
      ? "px-0.5 py-0 text-[7px]"
      : "px-2 py-0.5 text-[11px]";
  const displayClass = hideOnMobile ? "hidden sm:inline-flex" : "inline-flex";
  return (
    <span className={`${displayClass} shrink-0 items-center rounded-full font-black leading-none ring-1 ${sizeClass} ${staffRoleBadgeClass(role)}`} title={role}>
      {imageMode ? <span className="inline-block -translate-y-[2px] leading-none">{role}</span> : role}
    </span>
  );
}

function InjuryBadge({ player, compact = false }: { player: Player; compact?: boolean }) {
  if (!hasInjury(player)) return null;
  const level = player.injuryLevel as 1 | 2 | 3;
  const rate = Math.round(INJURY_ACTIVITY_RATE[level] * 100);
  const sizeClass = compact ? "px-0.5 py-0 text-[7px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-md border font-black leading-none ${compact ? "[&>span:last-child]:hidden" : ""} ${sizeClass} ${injuryBadgeClass(level)}`}
      title={`부상 ${level}: 활동량 ${rate}% 반영 (${player.activityScore} → ${formatScore(effectiveActivityScore(player))})`}
    >
      <span aria-hidden="true">✚</span>
      <span>부{level}</span>
    </span>
  );
}

function MultiPositionBadge({ player, compact = false }: { player: Pick<Player, "attackScore" | "midScore" | "defenseScore"> & Partial<Pick<Player, "centerForwardScore" | "wingScore" | "centerBackScore" | "wingBackScore">>; compact?: boolean }) {
  if (!isMultiPositionPlayer(player)) return null;
  const groups = multiPositionGroups(player).map(groupKorean).join("/");
  const sizeClass = compact ? "px-0.5 py-0 text-[7px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border border-fuchsia-200 bg-fuchsia-50 font-black leading-none text-fuchsia-700 ${sizeClass}`}
      title={`멀티포지션: ${groups}`}
    >
      멀티
    </span>
  );
}

function GuestBadge({ player, compact = false }: { player: Pick<Player, "memberType">; compact?: boolean }) {
  if (player.memberType !== "GUEST") return null;
  const sizeClass = compact ? "px-0.5 py-0 text-[7px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border border-violet-200 bg-violet-50 font-black leading-none text-violet-700 ${sizeClass}`}
      title="용병"
    >
      용병
    </span>
  );
}

function injuryBadgeClass(level: 1 | 2 | 3): string {
  if (level === 1) return "border-amber-200 bg-amber-50 text-amber-700";
  if (level === 2) return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function activityDisplay(player: { activityScore: number; injuryLevel?: Player["injuryLevel"] }): string {
  if (!hasInjury(player)) return String(player.activityScore);
  return `${player.activityScore}→${formatScore(effectiveActivityScore(player))}`;
}

function playerScoreLine(player: Player): string {
  return `CF${centerForwardScore(player)} · W${wingScore(player)} · MID${player.midScore} · CB${centerBackScore(player)} · WB${wingBackScore(player)} · ACT${activityDisplay(player)}`;
}

function appliedScoreKeyForSubRole(role?: AssignedSubRole): TeamScoreChipKey | null {
  if (role === "CF") return "CF";
  if (role === "WING") return "W";
  if (role === "MID") return "M";
  if (role === "CB") return "CB";
  if (role === "WB") return "WB";
  return null;
}

function appliedScoreKeys(player: Player & { assignedSubRole?: AssignedSubRole }, group: PositionGroup): TeamScoreChipKey[] {
  const assignedKey = appliedScoreKeyForSubRole(player.assignedSubRole);
  if (assignedKey) return [assignedKey];
  if (group === "MID") return ["M"];
  if (group === "ATTACK") {
    const cf = centerForwardScore(player);
    const wing = wingScore(player);
    if (cf === wing) return ["CF", "W"];
    return cf > wing ? ["CF"] : ["W"];
  }
  const cb = centerBackScore(player);
  const wb = wingBackScore(player);
  if (cb === wb) return ["CB", "WB"];
  return cb > wb ? ["CB"] : ["WB"];
}

function TeamPlayerScoreChips({
  player,
  group,
  interactive = false,
  onApplySubRole,
}: {
  player: Player & { assignedSubRole?: AssignedSubRole };
  group: PositionGroup;
  interactive?: boolean;
  onApplySubRole?: (targetSubRole: AssignedSubRole) => void;
}) {
  const activeKeys = new Set(appliedScoreKeys(player, group));
  const items: Array<{
    key: TeamScoreChipKey | "ACT";
    value: string | number;
    active: boolean;
    tone: "attack" | "mid" | "defense" | "activity";
    role?: AssignedSubRole;
  }> = [
    { key: "CF", value: centerForwardScore(player), active: activeKeys.has("CF"), tone: "attack", role: SCORE_CHIP_SUB_ROLES.CF },
    { key: "W", value: wingScore(player), active: activeKeys.has("W"), tone: "attack", role: SCORE_CHIP_SUB_ROLES.W },
    { key: "M", value: player.midScore, active: activeKeys.has("M"), tone: "mid", role: SCORE_CHIP_SUB_ROLES.M },
    { key: "CB", value: centerBackScore(player), active: activeKeys.has("CB"), tone: "defense", role: SCORE_CHIP_SUB_ROLES.CB },
    { key: "WB", value: wingBackScore(player), active: activeKeys.has("WB"), tone: "defense", role: SCORE_CHIP_SUB_ROLES.WB },
    { key: "ACT", value: activityDisplay(player), active: false, tone: "activity" },
  ];

  return (
    <div className="mt-1 flex max-w-full flex-wrap items-center justify-center gap-0.5">
      {items.map((item) => {
        const canApply = interactive && item.role != null && !item.active;
        const apply = () => {
          if (!canApply || !item.role) return;
          onApplySubRole?.(item.role);
        };
        return (
          <span
            key={item.key}
            role={canApply ? "button" : undefined}
            tabIndex={canApply ? 0 : undefined}
            className={`inline-flex items-center gap-0.5 rounded-md border px-1 py-0.5 text-[8px] font-black leading-none transition sm:text-[9px] ${teamScoreChipClass(item.active, item.tone)} ${canApply ? "cursor-pointer hover:-translate-y-px hover:border-slate-400 hover:bg-white focus:outline-none focus:ring-2 focus:ring-slate-300" : ""}`}
            title={canApply ? `${item.key} ${item.value} score로 적용` : `${item.key} ${item.value}${item.active ? " 적용 중" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              apply();
            }}
            onKeyDown={(event) => {
              if (!canApply || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              event.stopPropagation();
              apply();
            }}
          >
            <span>{item.key}</span>
            <span>{item.value}</span>
          </span>
        );
      })}
      <MultiPositionBadge player={player} compact />
    </div>
  );
}

function teamScoreChipClass(active: boolean, tone: "attack" | "mid" | "defense" | "activity"): string {
  if (!active) return "border-slate-200 bg-white/80 text-slate-400";
  if (tone === "attack") return "border-rose-200 bg-rose-50 text-rose-700";
  if (tone === "mid") return "border-sky-200 bg-sky-50 text-sky-700";
  if (tone === "defense") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-white/80 text-slate-400";
}

function staffRoleChipClass(role?: StaffRole | null): string {
  if (role === "단장") return "bg-white text-slate-950 ring-slate-300 border-b-2 border-slate-500";
  if (role === "감독") return "bg-white text-indigo-950 ring-indigo-300 border-b-2 border-indigo-500";
  if (role === "코치") return "bg-white text-cyan-950 ring-cyan-300 border-b-2 border-cyan-500";
  return "bg-white text-slate-700 ring-slate-200 border-b-2 border-transparent";
}

function staffRolePitchClass(role?: StaffRole | null): string {
  if (role === "단장") return "bg-white text-slate-950 ring-1 ring-slate-300 border-b-2 border-slate-500";
  if (role === "감독") return "bg-indigo-50 text-indigo-950 ring-1 ring-indigo-300 border-b-2 border-indigo-500";
  if (role === "코치") return "bg-cyan-50 text-cyan-950 ring-1 ring-cyan-300 border-b-2 border-cyan-500";
  return "border-b-2 border-transparent";
}

function MetricCard({ label, a, b, highlight }: { label: string; a: number; b: number; highlight?: boolean }) {
  const containerClass = highlight ? "rounded-2xl bg-slate-900 p-3 text-white" : "rounded-2xl bg-slate-50 p-3";
  const labelClass = highlight ? "text-xs font-bold text-slate-300" : "text-xs font-bold text-slate-500";
  const subLabelClass = highlight ? "text-xs text-slate-400" : "text-xs text-slate-500";
  return (
    <div className={containerClass}>
      <p className={labelClass}>{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div><p className={subLabelClass}>{formatTeamName("A")}</p><p className="text-lg font-black">{formatScore(a)}</p></div>
        <div className="text-center"><p className={subLabelClass}>차이</p><p className="text-sm font-bold">{formatScore(Math.abs(a - b))}</p></div>
        <div className="text-right"><p className={subLabelClass}>{formatTeamName("B")}</p><p className="text-lg font-black">{formatScore(b)}</p></div>
      </div>
    </div>
  );
}

function TeamResultView({
  result,
  confirmed,
  selection,
  variantCount,
  selectedVariantIdx,
  onSelectVariant,
  onPlayerClick,
  onGroupTarget,
  onSubRoleTarget,
  onConfirm,
  onReadjust,
  onCopyTeamShareUrl,
  copied,
}: {
  result: TeamBalanceResult;
  confirmed: boolean;
  selection: SwapSelection;
  variantCount: number;
  selectedVariantIdx: number;
  onSelectVariant: (idx: number) => void;
  onPlayerClick: (team: "A" | "B", playerId: string) => void;
  onGroupTarget: (targetTeam: "A" | "B", targetGroup: PositionGroup) => void;
  onSubRoleTarget: (targetTeam: "A" | "B", playerId: string, targetSubRole: AssignedSubRole) => void;
  onConfirm: () => void;
  onReadjust: () => void;
  onCopyTeamShareUrl: () => void;
  copied: boolean;
}) {
  const s = result.summary;
  const totalA = s.centerForwardScoreA + s.wingScoreA + s.midScoreA + s.centerBackScoreA + s.wingBackScoreA + s.activityA;
  const totalB = s.centerForwardScoreB + s.wingScoreB + s.midScoreB + s.centerBackScoreB + s.wingBackScoreB + s.activityB;
  const overridesA = result.teamA.players.filter((p) => p.isPositionOverride).length;
  const overridesB = result.teamB.players.filter((p) => p.isPositionOverride).length;
  const [history, setHistory] = useState<HistoryInsightResponse | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const teamAHistoryNames = useMemo(() => historyNames(result.teamA.players), [result.teamA.players]);
  const teamBHistoryNames = useMemo(() => historyNames(result.teamB.players), [result.teamB.players]);
  const teamAHistoryGroups = useMemo(() => historyGroupMap(result.teamA.players), [result.teamA.players]);
  const teamBHistoryGroups = useMemo(() => historyGroupMap(result.teamB.players), [result.teamB.players]);
  const overallHistoryGroups = useMemo(() => mergeHistoryGroupMaps(teamAHistoryGroups, teamBHistoryGroups), [teamAHistoryGroups, teamBHistoryGroups]);
  const historyKey = useMemo(
    () => makeHistoryInsightKey(teamAHistoryNames, teamBHistoryNames, [2025, 2026]),
    [teamAHistoryNames, teamBHistoryNames],
  );
  const isHistoryStale = history != null && history.key !== historyKey;
  const loadHistoryInsights = useCallback(async (openModal = true) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamA: teamAHistoryNames, teamB: teamBHistoryNames, years: [2025, 2026] }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || "히스토리 조회에 실패했습니다.");
      }
      setHistory(data as HistoryInsightResponse);
      if (openModal) setHistoryOpen(true);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setHistoryLoading(false);
    }
  }, [teamAHistoryNames, teamBHistoryNames]);
  return (
    <section id="team-result" className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold">팀 분배 결과</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${qualityBadgeClass(result.quality)}`}>{result.quality}</span>
        {!confirmed && <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">조정 가능</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
            onClick={onCopyTeamShareUrl}
          >
            {copied ? "공유 링크 복사됨" : "팀분배 10개 공유"}
          </button>
          <button
            type="button"
            className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
            onClick={() => void loadHistoryInsights(true)}
            disabled={historyLoading}
          >
            {historyLoading ? "히스토리 읽는 중" : history ? "히스토리 다시 읽기" : "히스토리 인사이트"}
          </button>
          {history && (
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
              onClick={() => setHistoryOpen(true)}
            >
              상세 대시보드
            </button>
          )}
        </div>
      </div>
      {historyError && (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          히스토리 조회 실패: {historyError}
        </div>
      )}
      {result.warnings.length > 0 && <div className="mt-4"><MessageBox title="팀 경고" items={result.warnings} tone="warning" /></div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="CF" a={s.centerForwardScoreA} b={s.centerForwardScoreB} />
        <MetricCard label="WING" a={s.wingScoreA} b={s.wingScoreB} />
        <MetricCard label="MID" a={s.midScoreA} b={s.midScoreB} />
        <MetricCard label="CB" a={s.centerBackScoreA} b={s.centerBackScoreB} />
        <MetricCard label="WB" a={s.wingBackScoreA} b={s.wingBackScoreB} />
        <MetricCard label="ACT" a={s.activityA} b={s.activityB} />
        <MetricCard label="총합" a={totalA} b={totalB} highlight />
        <MetricCard label="정규" a={s.regularA} b={s.regularB} />
        <MetricCard label="용병" a={s.guestA} b={s.guestB} />
        <MetricCard label="출전쿼터" a={s.quarterTargetA} b={s.quarterTargetB} />
        <MetricCard label="양팀 대상" a={s.dualTeamA} b={s.dualTeamB} />
        <MetricCard label="운영진" a={s.coachA} b={s.coachB} />
        <MetricCard label="멀티포지션" a={s.multiPositionA} b={s.multiPositionB} />
        <MetricCard label="포지션 변경자" a={overridesA} b={overridesB} />
      </div>
      {result.relationViolations.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-amber-900">궁합도 조건</p>
            <p className="text-xs font-semibold text-amber-800">
              같은 팀 배정 {s.relationViolationCount}개 · 분리 우선 {s.relationHardViolationCount}개 · 페널티 {s.relationPenalty}
            </p>
          </div>
          <ul className="mt-2 grid gap-1 text-sm text-amber-900 sm:grid-cols-2">
            {result.relationViolations.slice(0, 6).map((violation) => (
              <li key={`${violation.team}-${violation.playerAName}-${violation.playerBName}-${violation.score}`}>
                {formatTeamName(violation.team)} · {violation.playerAName}/{violation.playerBName} · {relationScoreLabel(violation.score)}
              </li>
            ))}
          </ul>
          {result.relationViolations.length > 6 && (
            <p className="mt-1 text-xs font-semibold text-amber-800">외 {result.relationViolations.length - 6}개</p>
          )}
        </div>
      )}
      {!confirmed && (
        <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
          선수를 한 명 누르면 선택되고, 다른 팀 선수를 누르면 자리를 바꿔요. <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-900">노란 테두리</span>는 종합 점수(CF+WING+MID+CB+WB+ACT)가 ±3 이내라 swap해도 균형이 잘 유지되는 후보예요. 조정이 끝나면 <strong>팀 확정</strong> 버튼을 누르세요.
        </p>
      )}
      {selection && (() => {
        const sourcePlayers = selection.team === "A" ? result.teamA.players : result.teamB.players;
        const sel = sourcePlayers.find((p) => p.id === selection.playerId);
        if (!sel) return null;
        const composite = detailedTechnicalTotal(sel) + effectiveActivityScore(sel);
        const secondary = sel.secondaryPositions.length > 0 ? sel.secondaryPositions.join(",") : "-";
        const staffRole = extractStaffRole(sel.memo);
        return (
          <div className="fixed inset-x-3 bottom-24 z-30 mx-auto max-w-3xl rounded-2xl border border-blue-300 bg-blue-50/95 p-3 shadow-xl backdrop-blur sm:bottom-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-blue-900">선택: {formatTeamName(selection.team)} · {sel.name}</p>
                  <GuestBadge player={sel} />
                  <StaffRoleBadge role={staffRole} />
                  <InjuryBadge player={sel} />
                  <MultiPositionBadge player={sel} />
                </div>
                <p className="text-xs text-blue-800">주포 {sel.primaryPosition} · 부포 {secondary} · 종합 {formatScore(composite)}</p>
              </div>
              <p className="text-xs font-mono text-blue-900">{playerScoreLine(sel)}</p>
            </div>
          </div>
        );
      })()}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <TeamCard
          title={formatTeamName("A")}
          players={result.teamA.players}
          team="A"
          selection={selection}
          otherTeamPlayers={result.teamB.players}
          onPlayerClick={onPlayerClick}
          onGroupTarget={onGroupTarget}
          onSubRoleTarget={onSubRoleTarget}
          interactive={!confirmed}
          groupScores={{ ATTACK: s.attackScoreA, MID: s.midScoreA, DEFENSE: s.defenseScoreA }}
        />
        <TeamCard
          title={formatTeamName("B")}
          players={result.teamB.players}
          team="B"
          selection={selection}
          otherTeamPlayers={result.teamA.players}
          onPlayerClick={onPlayerClick}
          onGroupTarget={onGroupTarget}
          onSubRoleTarget={onSubRoleTarget}
          interactive={!confirmed}
          groupScores={{ ATTACK: s.attackScoreB, MID: s.midScoreB, DEFENSE: s.defenseScoreB }}
        />
      </div>
      <p className="mt-4 text-xs text-slate-500"><span className="font-bold">*</span> 부포지션으로 배정된 선수 · <span className="font-bold">**</span> 인원 균형을 위해 주·부와 무관한 포지션으로 강제 배정된 선수 · <span className="inline-flex rounded-md border border-fuchsia-200 bg-fuchsia-50 px-1 py-0 text-[10px] font-black leading-none text-fuchsia-700">멀티</span> 공격/미드/수비 중 7점 이상이 2개 이상인 선수</p>
      {variantCount > 1 && (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 px-3 py-3">
          <span className="text-xs font-semibold text-slate-500">버전</span>
          {Array.from({ length: variantCount }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`min-w-[2.25rem] rounded-lg px-2.5 py-1.5 text-sm font-bold ${i === selectedVariantIdx ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"}`}
              onClick={() => onSelectVariant(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
      <div className="mt-5 flex justify-end">
        {confirmed ? (
          <button className="w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold sm:w-auto" onClick={onReadjust}>팀 다시 조정</button>
        ) : (
          <button className="w-full rounded-xl bg-emerald-600 px-5 py-3 text-base font-bold text-white sm:w-auto" onClick={onConfirm}>팀 확정 → 라인업 생성</button>
        )}
      </div>
      {historyOpen && history && (
        <HistoryInsightModal
          history={history}
          onClose={() => setHistoryOpen(false)}
          stale={isHistoryStale}
          groupMaps={{ A: teamAHistoryGroups, B: teamBHistoryGroups, ALL: overallHistoryGroups }}
        />
      )}
    </section>
  );
}

function historyNames(players: TeamBalanceResult["teamA"]["players"]): string[] {
  return players.map((player) => player.name.trim()).filter(Boolean);
}

type HistoryGroupMap = Map<string, PositionGroup>;

function historyGroupMap(players: TeamBalanceResult["teamA"]["players"]): HistoryGroupMap {
  const map: HistoryGroupMap = new Map();
  players.forEach((player) => {
    const key = normalizeHistoryName(player.name);
    if (key) map.set(key, player.assignedGroup);
  });
  return map;
}

function mergeHistoryGroupMaps(...maps: HistoryGroupMap[]): HistoryGroupMap {
  const merged: HistoryGroupMap = new Map();
  maps.forEach((map) => {
    map.forEach((group, name) => merged.set(name, group));
  });
  return merged;
}

function historySourceLabel(source: HistoryInsightResponse["source"]): string {
  return source === "firebase" ? "Firebase 직접 조회" : "로컬 Firebase 캐시";
}

function formatHistorySigned(value: number): string {
  if (value > 0) return `+${formatScore(value)}`;
  return formatScore(value);
}

function pairLabelText(label: HistoryPairInsight["label"]): string {
  if (label === "good") return "좋음";
  if (label === "caution") return "주의";
  return "중립";
}

function pairLabelClass(label: HistoryPairInsight["label"]): string {
  if (label === "good") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (label === "caution") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function trendLabel(trend: HistoryPlayerForm["trend"]): string {
  if (trend === "hot") return "상승";
  if (trend === "caution") return "주의";
  if (trend === "steady") return "안정";
  return "기록";
}

function trendClass(trend: HistoryPlayerForm["trend"]): string {
  if (trend === "hot") return "bg-emerald-500";
  if (trend === "caution") return "bg-rose-500";
  if (trend === "steady") return "bg-sky-500";
  return "bg-slate-400";
}

function HistoryMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
    </div>
  );
}

function GoalDiffBar({ value }: { value: number }) {
  const width = Math.min(50, Math.max(4, Math.abs(value) * 16));
  const isPositive = value >= 0;

  return (
    <div className="relative h-5 rounded-full bg-white ring-1 ring-slate-200">
      <div className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
      <div
        className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${isPositive ? "left-1/2 bg-emerald-500" : "right-1/2 bg-rose-500"}`}
        style={{ width: `${width}%` }}
      />
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-rose-500">-</span>
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-emerald-600">+</span>
    </div>
  );
}

function allHistoryPairs(insight: TeamHistoryInsight): HistoryPairInsight[] {
  const seen = new Set<string>();
  return [...insight.goodPairs, ...insight.cautionPairs, ...insight.samplePairs].filter((pair) => {
    const key = pair.players.slice().sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function historyInsightNames(insight: TeamHistoryInsight): string[] {
  const names = new Map<string, string>();
  const add = (name: string) => {
    const normalized = normalizeHistoryName(name);
    if (normalized && !names.has(normalized)) names.set(normalized, name);
  };

  allHistoryPairs(insight).forEach((pair) => pair.players.forEach(add));
  insight.recentForms.forEach((form) => add(form.name));
  insight.defenseForms.forEach((form) => add(form.name));
  insight.unmatchedNames.forEach(add);

  return Array.from(names.values());
}

function topGoodPairs(insight: TeamHistoryInsight, limit: number): HistoryPairInsight[] {
  return sortGoodPairs(allHistoryPairs(insight)).slice(0, limit);
}

function topBadPairs(insight: TeamHistoryInsight, limit: number): HistoryPairInsight[] {
  return sortBadPairs(allHistoryPairs(insight)).slice(0, limit);
}

const PAIR_CONFIDENCE_MATCHES = 8;

function pairConfidenceGoalDiff(pair: HistoryPairInsight): number {
  return pair.avgGoalDiff * (pair.matches / (pair.matches + PAIR_CONFIDENCE_MATCHES));
}

function sortGoodPairs(pairs: HistoryPairInsight[]): HistoryPairInsight[] {
  return pairs
    .filter((pair) => pair.matches > 0)
    .slice()
    .sort((a, b) => pairConfidenceGoalDiff(b) - pairConfidenceGoalDiff(a) || b.avgGoalDiff - a.avgGoalDiff || b.wins - a.wins || b.points - a.points || b.matches - a.matches);
}

function sortBadPairs(pairs: HistoryPairInsight[]): HistoryPairInsight[] {
  return pairs
    .filter((pair) => pair.matches > 0)
    .slice()
    .sort((a, b) => pairConfidenceGoalDiff(a) - pairConfidenceGoalDiff(b) || a.avgGoalDiff - b.avgGoalDiff || b.losses - a.losses || b.goalsAgainst / b.matches - a.goalsAgainst / a.matches || b.matches - a.matches);
}

function betweenGroupPairs(insight: TeamHistoryInsight, groupMap: HistoryGroupMap, groupA: PositionGroup, groupB: PositionGroup): HistoryPairInsight[] {
  return allHistoryPairs(insight).filter((pair) => {
    const first = groupMap.get(normalizeHistoryName(pair.players[0]));
    const second = groupMap.get(normalizeHistoryName(pair.players[1]));
    return (first === groupA && second === groupB) || (first === groupB && second === groupA);
  });
}

type CompatibilityMapNode = {
  name: string;
  group?: PositionGroup;
  x: number;
  y: number;
};

function compatibilityPairTone(pair: HistoryPairInsight): "good" | "risk" | "watch" {
  if (pair.avgGoalDiff < 0) return "risk";
  if (pair.avgGoalDiff >= 0.5) return "good";
  return "watch";
}

function compatibilityStroke(pair: HistoryPairInsight): string {
  const tone = compatibilityPairTone(pair);
  if (tone === "risk") return "#ef4444";
  if (tone === "good") return "#10b981";
  return "#f59e0b";
}

function compatibilityPairTouches(pair: HistoryPairInsight, activeKey: string): boolean {
  return pair.players.some((name) => normalizeHistoryName(name) === activeKey);
}

function compatibilityStrokeWidth(pair: HistoryPairInsight, maxMatches: number, highlighted: boolean): number {
  const ratio = maxMatches > 0 ? pair.matches / maxMatches : 0;
  const width = 0.2 + Math.sqrt(ratio) * 0.75;
  return highlighted ? Math.min(5.2, 1.2 + Math.sqrt(ratio) * 3.3) : width;
}

function compatibilityStrokeOpacity(pair: HistoryPairInsight, maxMatches: number, highlighted: boolean, hasSelection: boolean): number {
  const ratio = maxMatches > 0 ? pair.matches / maxMatches : 0;
  if (highlighted) return Math.min(0.9, 0.48 + ratio * 0.34);
  if (hasSelection) return 0.025;
  return Math.min(0.105, 0.025 + ratio * 0.08);
}

function compatibilityNodeClass(group?: PositionGroup): string {
  if (group === "ATTACK") return "bg-violet-50 text-violet-950 ring-violet-200";
  if (group === "MID") return "bg-cyan-50 text-cyan-950 ring-cyan-200";
  if (group === "DEFENSE") return "bg-slate-100 text-slate-800 ring-slate-300";
  return "bg-white text-slate-900 ring-slate-200";
}

function compatibilityChipClass(pair: HistoryPairInsight): string {
  const tone = compatibilityPairTone(pair);
  if (tone === "risk") return "border-rose-200 bg-rose-50 text-rose-800";
  if (tone === "good") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function buildCompatibilityMapNodes(pairs: HistoryPairInsight[], groupMap: HistoryGroupMap, nodeNames?: string[]): CompatibilityMapNode[] {
  const names = Array.from(new Set([...(nodeNames ?? []), ...pairs.flatMap((pair) => pair.players)]));
  const groupRank: Record<PositionGroup, number> = { ATTACK: 0, MID: 1, DEFENSE: 2 };
  names.sort((a, b) => {
    const groupA = groupMap.get(normalizeHistoryName(a));
    const groupB = groupMap.get(normalizeHistoryName(b));
    const rankA = groupA ? groupRank[groupA] : 9;
    const rankB = groupB ? groupRank[groupB] : 9;
    return rankA - rankB || a.localeCompare(b, "ko");
  });

  if (names.length === 1) {
    return [{ name: names[0], group: groupMap.get(normalizeHistoryName(names[0])), x: 50, y: 50 }];
  }

  return names.map((name, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / names.length;
    const radiusX = names.length > 18 && index % 2 === 1 ? 30 : 40;
    const radiusY = names.length > 18 && index % 2 === 1 ? 27 : 35;
    return {
      name,
      group: groupMap.get(normalizeHistoryName(name)),
      x: 50 + Math.cos(angle) * radiusX,
      y: 50 + Math.sin(angle) * radiusY,
    };
  });
}

function CompatibilityMapCard({
  title,
  subtitle,
  pairs,
  nodeNames,
  groupMap,
}: {
  title: string;
  subtitle: string;
  pairs: HistoryPairInsight[];
  nodeNames?: string[];
  groupMap: HistoryGroupMap;
}) {
  const nodes = buildCompatibilityMapNodes(pairs, groupMap, nodeNames);
  const nodeByName = new Map(nodes.map((node) => [normalizeHistoryName(node.name), node]));
  const dense = nodes.length > 18;
  const maxPairMatches = Math.max(1, ...pairs.map((pair) => pair.matches));
  const highlightPairs = [...sortGoodPairs(pairs).slice(0, 4), ...sortBadPairs(pairs).slice(0, 4)].filter((pair, index, array) => {
    const key = pair.players.slice().sort().join("|");
    return array.findIndex((item) => item.players.slice().sort().join("|") === key) === index;
  });
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const activeName = selectedName && nodes.some((node) => normalizeHistoryName(node.name) === normalizeHistoryName(selectedName))
    ? selectedName
    : null;
  const activeKey = activeName ? normalizeHistoryName(activeName) : "";
  const hasActiveSelection = Boolean(activeKey);
  const mapLinePairs = pairs
    .slice()
    .sort((a, b) => {
      const aActive = activeKey ? compatibilityPairTouches(a, activeKey) : false;
      const bActive = activeKey ? compatibilityPairTouches(b, activeKey) : false;
      return Number(aActive) - Number(bActive) || a.matches - b.matches || Math.abs(a.avgGoalDiff) - Math.abs(b.avgGoalDiff);
    });
  const activeConnections = activeKey ? pairs.filter((pair) => compatibilityPairTouches(pair, activeKey)) : [];
  const activeGoodConnections = sortGoodPairs(activeConnections).slice(0, 5);
  const activeLowConnections = sortBadPairs(activeConnections).slice(0, 5);

  return (
    <div className="mt-4 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-slate-900">{title}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-black">
          <span className="inline-flex items-center gap-1 text-emerald-700"><span className="h-2 w-4 rounded-full bg-emerald-500" />좋음</span>
          <span className="inline-flex items-center gap-1 text-amber-700"><span className="h-2 w-4 rounded-full bg-amber-500" />보통</span>
          <span className="inline-flex items-center gap-1 text-rose-700"><span className="h-2 w-4 rounded-full bg-rose-500" />주의</span>
          <span className="inline-flex items-center gap-1 text-slate-500"><span className="h-2 w-5 rounded-full bg-slate-300" />두께=경기 수</span>
          <span className="inline-flex items-center gap-1 text-violet-700"><span className="h-2 w-2 rounded-full bg-violet-300" />공격</span>
          <span className="inline-flex items-center gap-1 text-cyan-700"><span className="h-2 w-2 rounded-full bg-cyan-300" />미드</span>
          <span className="inline-flex items-center gap-1 text-slate-600"><span className="h-2 w-2 rounded-full bg-slate-300" />수비</span>
          <span className="text-slate-400">선수 클릭=강조/해제</span>
        </div>
      </div>

      {pairs.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-center text-xs font-bold text-slate-400 ring-1 ring-slate-200">궁합 지도로 볼 기록이 아직 부족합니다.</p>
      ) : (
        <>
          <div className={`relative mt-3 overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_center,_#ffffff_0,_#f8fafc_58%,_#eef2ff_100%)] ring-1 ring-slate-200 ${dense ? "h-96" : "h-72"}`}>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {mapLinePairs.map((pair) => {
                const from = nodeByName.get(normalizeHistoryName(pair.players[0]));
                const to = nodeByName.get(normalizeHistoryName(pair.players[1]));
                if (!from || !to) return null;
                const highlighted = activeKey ? compatibilityPairTouches(pair, activeKey) : false;
                return (
                  <line
                    key={`${pair.players[0]}-${pair.players[1]}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={hasActiveSelection && !highlighted ? "#94a3b8" : compatibilityStroke(pair)}
                    strokeWidth={compatibilityStrokeWidth(pair, maxPairMatches, highlighted)}
                    strokeLinecap="round"
                    opacity={compatibilityStrokeOpacity(pair, maxPairMatches, highlighted, hasActiveSelection)}
                  />
                );
              })}
            </svg>
            {nodes.map((node) => (
              <button
                key={node.name}
                type="button"
                className={`absolute -translate-x-1/2 -translate-y-1/2 truncate rounded-full text-center font-black shadow-sm ring-1 transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-slate-900 ${dense ? "max-w-[4.5rem] px-1.5 py-0.5 text-[10px]" : "max-w-[5.75rem] px-2.5 py-1 text-[11px]"} ${compatibilityNodeClass(node.group)} ${activeKey === normalizeHistoryName(node.name) ? "ring-2 ring-slate-900" : ""}`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                title={node.group ? `${node.name} · ${groupKorean(node.group)}` : node.name}
                onClick={() => setSelectedName((current) => current && normalizeHistoryName(current) === normalizeHistoryName(node.name) ? null : node.name)}
              >
                {node.name}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {highlightPairs.map((pair) => (
              <span key={`${title}-${pair.players[0]}-${pair.players[1]}`} className={`rounded-full border px-2 py-1 text-[11px] font-black ${compatibilityChipClass(pair)}`}>
                {pair.players[0]}-{pair.players[1]} {formatHistorySigned(pair.avgGoalDiff)}
              </span>
            ))}
          </div>
          {!activeName && (
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 ring-1 ring-slate-200">
              전체 조합은 흐린 선으로 모두 깔려 있습니다. 선수 이름을 누르면 그 선수의 연결만 진하게 표시되고, 다시 누르면 해제됩니다.
            </p>
          )}
          {activeName && (
            <div className="mt-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-black text-slate-900">{activeName} 연결 궁합</p>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 ring-1 ring-slate-200">
                  연결 {activeConnections.length}개
                </span>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <CompatibilityConnectionList title="좋은 연결 Top 5" pairs={activeGoodConnections} activeName={activeName} empty="좋은 연결 기록이 아직 부족합니다." />
                <CompatibilityConnectionList title="낮은 연결 Worst 5" pairs={activeLowConnections} activeName={activeName} empty="낮은 연결 기록이 아직 부족합니다." />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CompatibilityConnectionList({
  title,
  pairs,
  activeName,
  empty,
}: {
  title: string;
  pairs: HistoryPairInsight[];
  activeName: string;
  empty: string;
}) {
  const activeKey = normalizeHistoryName(activeName);

  return (
    <div className="rounded-xl bg-white p-2 ring-1 ring-slate-200">
      <p className="px-1 text-xs font-black text-slate-700">{title}</p>
      {pairs.length === 0 ? (
        <p className="mt-1 rounded-lg bg-slate-50 px-2 py-2 text-[11px] font-bold text-slate-400">{empty}</p>
      ) : (
        <div className="mt-1 space-y-1">
          {pairs.map((pair) => {
            const partner = pair.players.find((name) => normalizeHistoryName(name) !== activeKey) ?? pair.players[0];
            return (
              <div key={`${title}-${activeName}-${partner}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-slate-800">{partner}</p>
                  <p className="mt-0.5 text-[10px] font-bold text-slate-500">
                    {pair.matches}경기 {pair.wins}승 {pair.draws}무 {pair.losses}패
                  </p>
                </div>
                <span className={`font-mono text-xs font-black ${pair.avgGoalDiff < 0 ? "text-rose-600" : pair.avgGoalDiff >= 0.5 ? "text-emerald-600" : "text-amber-600"}`}>
                  {formatHistorySigned(pair.avgGoalDiff)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentFormBars({ forms }: { forms: HistoryPlayerForm[] }) {
  const maxPoints = Math.max(1, ...forms.map((form) => form.points));

  if (forms.length === 0) {
    return <p className="mt-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-400 ring-1 ring-slate-200">최근 출전 기록 부족</p>;
  }

  return (
    <div className="mt-1 space-y-1.5">
      {forms.map((form) => (
        <div key={form.name} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-black text-slate-800">{form.name}</span>
            <span className="font-mono font-bold text-slate-500">{form.matches}경기 {form.points}P · {formatHistorySigned(form.avgGoalDiff)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 rounded-full bg-slate-100">
              <div className={`h-2 rounded-full ${trendClass(form.trend)}`} style={{ width: `${Math.max(8, (form.points / maxPoints) * 100)}%` }} />
            </div>
            <span className="w-9 text-right text-[10px] font-black text-slate-500">{trendLabel(form.trend)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DefenseFormBars({ forms }: { forms: HistoryDefenseForm[] }) {
  const maxCleanSheets = Math.max(1, ...forms.map((form) => form.cleanSheets));

  if (forms.length === 0) {
    return <p className="mt-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-400 ring-1 ring-slate-200">수비 기록 부족</p>;
  }

  return (
    <div className="mt-1 space-y-1.5">
      {forms.map((form) => (
        <div key={form.name} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-black text-slate-800">{form.name}</span>
            <span className="font-mono font-bold text-slate-500">{form.matches}경기 clean sheet {form.cleanSheets}회 · 평균 실점 {formatScore(form.avgGoalsAgainst)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 rounded-full bg-slate-100">
              <div className={`h-2 rounded-full ${trendClass(form.trend)}`} style={{ width: `${Math.max(8, (form.cleanSheets / maxCleanSheets) * 100)}%` }} />
            </div>
            <span className="w-14 text-right text-[10px] font-black text-slate-500">평균실점</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function GoalsAgainstBars({ forms }: { forms: HistoryDefenseForm[] }) {
  const ranked = forms
    .slice()
    .sort((a, b) => a.avgGoalsAgainst - b.avgGoalsAgainst || b.cleanSheets - a.cleanSheets || b.avgGoalDiff - a.avgGoalDiff || b.matches - a.matches);
  const maxAvgAgainst = Math.max(1, ...ranked.map((form) => form.avgGoalsAgainst));

  if (ranked.length === 0) {
    return <p className="mt-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-400 ring-1 ring-slate-200">실점 기록 부족</p>;
  }

  return (
    <div className="mt-1 space-y-1.5">
      {ranked.map((form) => {
        const width = Math.max(8, 100 - (form.avgGoalsAgainst / maxAvgAgainst) * 82);
        return (
          <div key={form.name} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-black text-slate-800">{form.name}</span>
              <span className="font-mono font-bold text-slate-500">{form.matches}경기 평균 실점 {formatScore(form.avgGoalsAgainst)} · 총 실점 {form.goalsAgainst}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2 flex-1 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-cyan-500" style={{ width: `${width}%` }} />
              </div>
              <span className="w-14 text-right text-[10px] font-black text-slate-500">낮을수록 좋음</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type HistoryInsightTab = "OVERALL" | "A" | "B" | "PLAYERS";

function HistoryInsightModal({
  history,
  onClose,
  stale,
  groupMaps,
}: {
  history: HistoryInsightResponse;
  onClose: () => void;
  stale: boolean;
  groupMaps: Record<"A" | "B" | "ALL", HistoryGroupMap>;
}) {
  const [activeTab, setActiveTab] = useState<HistoryInsightTab>("OVERALL");
  const tabs: Array<{ id: HistoryInsightTab; label: string }> = [
    { id: "OVERALL", label: "전체" },
    { id: "A", label: formatTeamName("A") },
    { id: "B", label: formatTeamName("B") },
    { id: "PLAYERS", label: "선수별" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 px-3 py-6 backdrop-blur-sm">
      <div className="w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-lg font-black text-slate-950">라인업 히스토리 대시보드</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {history.seasons.join(", ")} 시즌 {history.matchCount}경기 · {historySourceLabel(history.source)} · 현재 A/B팀 조합 기준
            </p>
          </div>
          <button type="button" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="max-h-[82vh] overflow-y-auto p-5">
          {stale && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              이 대시보드는 이전 팀 구성 기준입니다. 선수 이동 후에는 히스토리 다시 읽기로 갱신하세요.
            </div>
          )}
          {history.warnings.length > 0 && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-black text-amber-900">조회 주의</p>
              <div className="mt-1 space-y-1">
                {history.warnings.map((warning) => (
                  <p key={warning} className="text-xs font-semibold text-amber-800">{warning}</p>
                ))}
              </div>
            </div>
          )}
          <div className="sticky top-0 z-10 mb-4 grid grid-cols-4 gap-2 rounded-2xl bg-white/95 p-2 shadow-sm ring-1 ring-slate-200 backdrop-blur">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`rounded-xl px-3 py-2 text-sm font-black transition ${activeTab === tab.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "OVERALL" && <HistoryOverallInsight insight={history.overall} groupMap={groupMaps.ALL} />}
          {activeTab === "A" && <HistoryTeamDetail title={formatTeamName("A")} insight={history.teamA} groupMap={groupMaps.A} />}
          {activeTab === "B" && <HistoryTeamDetail title={formatTeamName("B")} insight={history.teamB} groupMap={groupMaps.B} />}
          {activeTab === "PLAYERS" && <HistoryPlayerInsight insight={history.overall} />}
        </div>
      </div>
    </div>
  );
}

function HistoryPlayerInsight({ insight }: { insight: TeamHistoryInsight }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-black text-slate-950">선수별</p>
          <p className="mt-1 text-xs font-semibold text-slate-600">전체 인원 기준 개인 기록 랭킹입니다.</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 ring-1 ring-slate-200">
          매칭 {insight.matchedPlayerCount}/{insight.playerCount}명
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div>
          <p className="text-sm font-black text-slate-800">공격 포인트 순위</p>
          <RecentFormBars forms={insight.recentForms.slice(0, 10)} />
        </div>
        <div>
          <p className="text-sm font-black text-slate-800">clean sheet 순위</p>
          <DefenseFormBars forms={insight.defenseForms.slice(0, 10)} />
        </div>
        <div>
          <p className="text-sm font-black text-slate-800">평균 실점 낮은 순위</p>
          <GoalsAgainstBars forms={insight.defenseForms.slice(0, 10)} />
        </div>
      </div>
    </div>
  );
}

function HistoryOverallInsight({ insight, groupMap }: { insight: TeamHistoryInsight; groupMap: HistoryGroupMap }) {
  const allPairs = allHistoryPairs(insight);
  const allNames = historyInsightNames(insight);
  const goodPairs = topGoodPairs(insight, 10);
  const badPairs = topBadPairs(insight, 10);
  const defenseMidPairs = betweenGroupPairs(insight, groupMap, "DEFENSE", "MID");
  const midAttackPairs = betweenGroupPairs(insight, groupMap, "MID", "ATTACK");

  return (
    <div className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-black text-slate-950">전체 인원 히스토리</p>
          <p className="mt-1 text-xs font-semibold text-slate-600">형광/주황으로 나누기 전, 현재 선택된 전체 인원끼리 과거 같은 편으로 뛴 조합입니다.</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">
          {insight.matchedPlayerCount}/{insight.playerCount}명 매칭
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-5">
        <HistoryMiniStat label="조합 수" value={`${allPairs.length}개`} />
        <HistoryMiniStat label="같이 뛴 기록" value={`${insight.coPlaySamples}건`} />
        <HistoryMiniStat label="평균 득실" value={formatHistorySigned(insight.avgGoalDiff)} />
        <HistoryMiniStat label="clean sheet" value={`${insight.cleanSheets}회`} />
        <HistoryMiniStat label="평균 실점" value={formatScore(insight.avgGoalsAgainst)} />
      </div>

      <CompatibilityMapCard
        title="전체 인원 궁합지도"
        subtitle="현재 선택된 전체 인원에서 같이 뛴 기록이 있는 모든 조합을 선으로 표시합니다."
        pairs={allPairs}
        nodeNames={allNames}
        groupMap={groupMap}
      />

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <HistoryPairTable title="전체 좋은 궁합 Top 10" pairs={goodPairs} empty="전체 인원 기준 좋은 궁합 기록이 아직 부족합니다." />
        <HistoryPairTable title="전체 낮은 궁합 Top 10" pairs={badPairs} empty="전체 인원 기준 낮은 궁합 기록이 아직 부족합니다." />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <HistoryPairTable title="수비-미드 좋은 궁합 Top 5" pairs={sortGoodPairs(defenseMidPairs).slice(0, 5)} empty="수비-미드 좋은 궁합 기록이 아직 부족합니다." />
        <HistoryPairTable title="수비-미드 낮은 궁합 Worst 5" pairs={sortBadPairs(defenseMidPairs).slice(0, 5)} empty="수비-미드 낮은 궁합 기록이 아직 부족합니다." />
        <HistoryPairTable title="미드-공격 좋은 궁합 Top 5" pairs={sortGoodPairs(midAttackPairs).slice(0, 5)} empty="미드-공격 좋은 궁합 기록이 아직 부족합니다." />
        <HistoryPairTable title="미드-공격 낮은 궁합 Worst 5" pairs={sortBadPairs(midAttackPairs).slice(0, 5)} empty="미드-공격 낮은 궁합 기록이 아직 부족합니다." />
      </div>
    </div>
  );
}

function HistoryTeamDetail({ title, insight, groupMap }: { title: string; insight: TeamHistoryInsight; groupMap: HistoryGroupMap }) {
  const allPairs = allHistoryPairs(insight);
  const allNames = historyInsightNames(insight);
  const goodPairs = topGoodPairs(insight, 5);
  const badPairs = topBadPairs(insight, 5);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-black text-slate-900">{title}</p>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 ring-1 ring-slate-200">
          조합 {allPairs.length}개 · 기록 {insight.coPlaySamples}건 · 평균득실 {formatHistorySigned(insight.avgGoalDiff)}
        </span>
      </div>

      <div className="mt-3">
        <GoalDiffBar value={insight.avgGoalDiff} />
      </div>

      <CompatibilityMapCard
        title={`${title} 내부 궁합지도`}
        subtitle={`현재 ${title} 선수끼리 같이 뛴 기록이 있는 모든 조합을 표시합니다.`}
        pairs={allPairs}
        nodeNames={allNames}
        groupMap={groupMap}
      />

      <HistoryPairTable title={`${title} 좋은 궁합 Top 5`} pairs={goodPairs} empty="좋은 궁합으로 볼 만큼 누적된 조합이 아직 없습니다." />
      <HistoryPairTable title={`${title} 낮은 궁합 Top 5`} pairs={badPairs} empty="낮은 궁합으로 볼 만큼 누적된 조합이 아직 없습니다." />

      {insight.unmatchedNames.length > 0 && (
        <div className="mt-4 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <p className="text-xs font-black text-slate-600">히스토리 매칭 안 된 선수</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">{insight.unmatchedNames.join(", ")}</p>
        </div>
      )}
    </div>
  );
}

function HistoryPairTable({ title, pairs, empty }: { title: string; pairs: HistoryPairInsight[]; empty: string }) {
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black text-slate-800">{title}</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">신뢰보정 순</span>
      </div>
      {pairs.length === 0 ? (
        <p className="mt-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-400 ring-1 ring-slate-200">{empty}</p>
      ) : (
        <div className="mt-1 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          {pairs.map((pair) => (
            <div key={`${title}-${pair.players[0]}-${pair.players[1]}`} className="grid grid-cols-[1fr_auto] gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-xs font-black text-slate-800">{pair.players[0]} · {pair.players[1]}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${pairLabelClass(pair.label)}`}>{pairLabelText(pair.label)}</span>
                </div>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                  {pair.matches}경기 {pair.wins}승 {pair.draws}무 {pair.losses}패 · 평균득점 {formatScore(pair.goalsFor / pair.matches)} · 평균실점 {formatScore(pair.goalsAgainst / pair.matches)} · 득점관여 {pair.points}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-black text-slate-900">{formatHistorySigned(pair.avgGoalDiff)}</p>
                <p className="text-[10px] font-bold text-slate-400">평균득실</p>
                <p className="text-[10px] font-bold text-slate-400">보정 {formatHistorySigned(pairConfidenceGoalDiff(pair))}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function relationScoreLabel(score: 1 | 2): string {
  return score === 1 ? "1점 분리 우선" : "2점 가능하면 분리";
}

function qualityBadgeClass(quality: TeamBalanceResult["quality"]): string {
  if (quality === "좋음") return "bg-emerald-100 text-emerald-700";
  if (quality === "주의") return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function overrideMark(reason: string): string {
  if (reason === "부포지션 그룹 배정") return "*";
  if (reason === "인원 균형을 위한 포지션 변경") return "**";
  return "";
}

function TeamCard({
  title,
  players,
  team,
  selection,
  otherTeamPlayers,
  onPlayerClick,
  onGroupTarget,
  onSubRoleTarget,
  interactive,
  groupScores,
}: {
  title: string;
  players: TeamBalanceResult["teamA"]["players"];
  team: "A" | "B";
  selection: SwapSelection;
  otherTeamPlayers: TeamBalanceResult["teamA"]["players"];
  onPlayerClick: (team: "A" | "B", playerId: string) => void;
  onGroupTarget: (targetTeam: "A" | "B", targetGroup: PositionGroup) => void;
  onSubRoleTarget: (targetTeam: "A" | "B", playerId: string, targetSubRole: AssignedSubRole) => void;
  interactive: boolean;
  groupScores: Record<PositionGroup, number>;
}) {
  const selectedPlayer = selection
    ? (selection.team === team
        ? players.find((p) => p.id === selection.playerId)
        : otherTeamPlayers.find((p) => p.id === selection.playerId))
    : undefined;
  const selectedComposite = selectedPlayer
    ? detailedTechnicalTotal(selectedPlayer) + effectiveActivityScore(selectedPlayer)
    : null;
  const showSwapHints = selection != null && selection.team !== team;
  const showGroupTargets = selection != null && interactive;
  return (
    <div className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${teamBorderClass(team)}`}>
      <div className={`h-2 ${teamAccentClass(team)}`} />
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <span className={`rounded-full px-3 py-1 text-sm font-black ${teamPillClass(team)}`}>{title}</span>
        <span className="text-xs font-bold text-slate-500">팀 분배</span>
      </div>
      <div className="px-2 pb-3 pt-1 sm:p-4 sm:pt-1">
        {(["ATTACK", "MID", "DEFENSE"] as PositionGroup[]).map((g) => {
          const score = groupScores[g];
          const groupPlayers = players
            .filter((p) => p.assignedGroup === g)
            .sort((a, b) =>
              (a.balancePairOrder ?? Number.MAX_SAFE_INTEGER) - (b.balancePairOrder ?? Number.MAX_SAFE_INTEGER)
              || a.name.localeCompare(b.name, "ko"),
            );
          const selectedSameTeam = selection?.team === team;
          const canTargetGroup = showGroupTargets && (!selectedSameTeam || selectedPlayer?.assignedGroup !== g);
          return (
            <div key={g} className="mt-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {canTargetGroup ? (
                    <button
                      type="button"
                      className={`rounded-full transition hover:brightness-95 focus:outline-none focus:ring-2 ${selectedSameTeam ? "focus:ring-sky-300 ring-2 ring-sky-200" : "focus:ring-amber-300 ring-2 ring-amber-200"}`}
                      onClick={() => onGroupTarget(team, g)}
                      title={selectedSameTeam ? "선택한 선수를 이 그룹으로 이동" : "선택한 선수를 이 그룹 선수와 교체"}
                    >
                      <GroupBadge group={g} />
                    </button>
                  ) : (
                    <GroupBadge group={g} />
                  )}
                </div>
                <span className="text-xs font-bold text-slate-600">합계 {formatScore(score)}</span>
              </div>
              <div className="mt-1.5 grid gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, groupPlayers.length)}, minmax(0, 1fr))` }}>
                {groupPlayers.map((p) => {
                  const isSelected = selection?.team === team && selection.playerId === p.id;
                  const composite = detailedTechnicalTotal(p) + effectiveActivityScore(p);
                  const isSwapHint = showSwapHints && selectedComposite != null && Math.abs(composite - selectedComposite) <= 3;
                  const staffRole = extractStaffRole(p.memo);
                  const pairTitle = p.balancePairPartnerName ? `페어 ${p.balancePairPartnerName} · ` : "";
                  const baseClass = "min-h-[3.65rem] min-w-0 rounded-lg border px-0.5 py-1.5 text-center transition";
                  const stateClass = isSelected
                    ? teamSelectedPlayerClass(team)
                    : isSwapHint
                      ? "bg-amber-50 text-slate-700 border-amber-300 hover:bg-amber-100 cursor-pointer"
                      : interactive
                        ? `bg-slate-50 text-slate-700 border-transparent ${teamHoverClass(team)} cursor-pointer`
                        : "bg-slate-50 text-slate-700 border-transparent";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      title={`${pairTitle}${staffRole ? `${staffRole} · ` : ""}${p.assignmentReason} · ${playerScoreLine(p)}`}
                      className={`${baseClass} ${stateClass}`}
                      disabled={!interactive}
                      onClick={() => onPlayerClick(team, p.id)}
                    >
                      <div className="flex min-w-0 items-center justify-center gap-px overflow-hidden">
                        <span className="min-w-0 truncate text-[11px] font-bold leading-tight">
                          {p.name}{overrideMark(p.assignmentReason)}
                        </span>
                        <span className="flex shrink-0 items-center justify-center gap-px">
                          <GuestBadge player={p} compact />
                          <StaffRoleBadge role={staffRole} compact />
                          <InjuryBadge player={p} compact />
                        </span>
                      </div>
                      <TeamPlayerScoreChips
                        player={p}
                        group={g}
                        interactive={interactive}
                        onApplySubRole={(targetSubRole) => onSubRoleTarget(team, p.id, targetSubRole)}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function downloadElementAsImage(elem: HTMLElement, filename: string) {
  const html2canvas = (await import("html2canvas")).default;
  await document.fonts?.ready;
  const canvas = await html2canvas(elem, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
  await new Promise<void>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve();
      }, 200);
    }, "image/png");
  });
}

type LineupSection = "attack" | "mid" | "defense" | "gk" | "bench";

type PlayerCount = { field: number; gk: number };
type OverviewPlayer = { name: string; staffRole?: StaffRole };

function isEmptyPlayerName(name: string | undefined): boolean {
  return !name || name === "없음";
}

const OVERVIEW_GROUPS: Array<{ group: PositionGroup; label: string }> = [
  { group: "ATTACK", label: "공격" },
  { group: "MID", label: "미드" },
  { group: "DEFENSE", label: "수비" },
];

function formatCount(c: PlayerCount | undefined): string {
  if (!c) return "";
  const gkPart = c.gk > 0 ? `·GK${c.gk}` : "";
  return `${c.field}Q${gkPart}`;
}

function teamPanelClass(team: TeamName): string {
  return team === "A"
    ? "border-slate-200 bg-white shadow-sm ring-1 ring-lime-200/70"
    : "border-slate-200 bg-white shadow-sm ring-1 ring-orange-200/70";
}

function teamBorderClass(team: TeamName): string {
  return team === "A"
    ? "border-lime-300"
    : "border-orange-300";
}

function teamAccentClass(team: TeamName): string {
  return team === "A"
    ? "bg-lime-400"
    : "bg-orange-500";
}

function teamPillClass(team: TeamName): string {
  return team === "A"
    ? "bg-lime-300 text-lime-950"
    : "bg-orange-500 text-white";
}

function teamHoverClass(team: TeamName): string {
  return team === "A"
    ? "hover:bg-lime-50 hover:border-lime-200"
    : "hover:bg-orange-50 hover:border-orange-200";
}

function teamSelectedPlayerClass(team: TeamName): string {
  return team === "A"
    ? "bg-lime-300 text-lime-950 shadow-md border-lime-500"
    : "bg-orange-500 text-white shadow-md border-orange-600";
}

function overviewGroupPillClass(group: PositionGroup): string {
  if (group === "ATTACK") return "bg-rose-100 text-rose-700 ring-rose-200";
  if (group === "MID") return "bg-sky-100 text-sky-700 ring-sky-200";
  return "bg-emerald-100 text-emerald-700 ring-emerald-200";
}

function TeamOverviewCard({ team, groups, imageMode = false }: { team: TeamName; groups: Record<PositionGroup, OverviewPlayer[]>; imageMode?: boolean }) {
  const columnCount = Math.max(1, ...OVERVIEW_GROUPS.map(({ group }) => groups[group].length));
  const headerClass = imageMode ? "flex items-center justify-between gap-2 px-3 py-3" : "flex items-center justify-between gap-2 px-2 py-2 sm:px-3 sm:py-3";
  const teamLabelClass = imageMode ? "inline-flex min-h-8 items-center rounded-full px-3 py-0 text-sm font-black leading-none" : "rounded-full px-2.5 py-0.5 text-xs font-black sm:px-3 sm:py-1 sm:text-sm";
  const bodyClass = imageMode ? "space-y-2 px-3 pb-3" : "space-y-1.5 px-2 pb-2 sm:space-y-2 sm:px-3 sm:pb-3";
  const rowClass = imageMode ? "grid grid-cols-[2.8rem_minmax(0,1fr)] items-center gap-1.5" : "grid grid-cols-[2.1rem_minmax(0,1fr)] items-center gap-1 sm:grid-cols-[2.8rem_minmax(0,1fr)] sm:gap-1.5";
  const groupLabelClass = imageMode ? "inline-flex min-h-7 items-center justify-center rounded-full px-2.5 py-0 text-xs font-black leading-none ring-1" : "inline-flex justify-center rounded-full px-1 py-0.5 text-[10px] font-black ring-1 sm:px-2.5 sm:py-1 sm:text-xs";
  const playerChipClass = imageMode
    ? "inline-flex min-h-8 min-w-0 items-center justify-center gap-1 overflow-visible rounded-full px-2.5 py-0 text-xs font-bold leading-none shadow-sm ring-1"
    : "inline-flex min-h-6 min-w-0 items-center justify-center gap-1 rounded-full px-1 py-0.5 text-[10px] font-bold leading-normal shadow-sm ring-1 sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-xs";
  return (
    <div className={`overflow-hidden rounded-xl border ${teamPanelClass(team)}`}>
      <div className={`h-1.5 ${teamAccentClass(team)}`} />
      <div className={headerClass}>
        <span className={`${teamLabelClass} ${teamPillClass(team)}`}>{imageMode ? <span className="inline-block -translate-y-[4px] leading-none">{formatTeamName(team)}</span> : formatTeamName(team)}</span>
        <span className={imageMode ? "text-xs font-bold text-slate-500" : "text-[10px] font-bold text-slate-500 sm:text-xs"}>팀 배정</span>
      </div>
      <div className={bodyClass}>
        {OVERVIEW_GROUPS.map(({ group, label }) => (
          <div key={group} className={rowClass}>
            <span className={`${groupLabelClass} ${overviewGroupPillClass(group)}`}>{imageMode ? <span className="inline-block -translate-y-[3px] leading-none">{label}</span> : label}</span>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
              {groups[group].map((player) => (
                <span key={player.name} className={`${playerChipClass} ${staffRoleChipClass(player.staffRole)}`}>
                  <span className={imageMode ? "inline-block min-w-0 -translate-y-[4px] overflow-visible whitespace-nowrap leading-[1.15]" : "min-w-0 overflow-visible whitespace-nowrap py-0.5 leading-[1.55]"}>{player.name}</span>
                  <StaffRoleBadge role={player.staffRole} compact hideOnMobile={!imageMode} imageMode={imageMode} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PitchChip({ name, accent, selected, onClick, count, staffRole, fill = false, imageMode = false }: { name: string; accent?: "gk" | "bench"; selected?: boolean; onClick?: () => void; count?: PlayerCount; staffRole?: StaffRole; fill?: boolean; imageMode?: boolean }) {
  const base = imageMode
    ? "inline-flex min-w-0 flex-col items-center justify-center overflow-visible border-0 bg-transparent p-0 text-sm font-bold leading-normal whitespace-nowrap transition"
    : "inline-flex min-h-10 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-extrabold leading-normal shadow-sm whitespace-nowrap transition sm:min-h-0 sm:flex-row sm:gap-1 sm:rounded-full sm:px-3 sm:py-1.5 sm:text-sm sm:shadow";
  const defaultPalette = accent === "gk"
    ? "bg-amber-300 text-amber-950"
    : accent === "bench"
      ? "bg-slate-200 text-slate-700"
      : "bg-white text-slate-900";
  const palette = staffRole ? staffRolePitchClass(staffRole) : `${defaultPalette} ${staffRolePitchClass(null)}`;
  const ring = selected ? "ring-2 ring-offset-1 ring-yellow-400" : "";
  const Tag = onClick ? "button" : "span";
  const countText = formatCount(count);
  const sizeClass = imageMode ? "w-auto min-w-[5.6rem]" : fill ? "w-full sm:w-auto" : "w-[4.2rem] sm:w-auto sm:min-w-[4.75rem]";
  if (imageMode) {
    return (
      <Tag type={onClick ? "button" : undefined} className={`${base} ${sizeClass}`} onClick={onClick} title={staffRole ? `${name} · ${staffRole}` : undefined}>
        <span className={`inline-flex min-h-[3.05rem] min-w-[5.6rem] flex-col items-center justify-center overflow-visible rounded-2xl px-3 py-1 text-sm font-bold leading-none shadow ${palette} ${ring}`}>
          <span className="inline-flex -translate-y-[2px] items-center justify-center gap-1 overflow-visible leading-none">
            <span className="inline-block max-w-full overflow-visible whitespace-nowrap leading-[1.15]">{name}</span>
            <StaffRoleBadge role={staffRole} compact hideOnMobile={false} imageMode />
          </span>
          {countText && <span className="mt-0.5 inline-block -translate-y-[1px] text-center text-[10px] font-black leading-none text-slate-600">{countText}</span>}
        </span>
      </Tag>
    );
  }
  const contentClass = "flex min-w-0 items-center justify-center gap-0.5 overflow-visible leading-[1.55]";
  const nameClass = "inline-block max-w-full overflow-visible whitespace-nowrap py-0.5 leading-[1.55]";
  const countClass = "text-[9px] font-black leading-tight opacity-70 sm:ml-1 sm:text-[11px]";
  return (
    <Tag type={onClick ? "button" : undefined} className={`${base} ${sizeClass} ${palette} ${ring}`} onClick={onClick} title={staffRole ? `${name} · ${staffRole}` : undefined}>
      <span className={contentClass}>
        <span className={nameClass}>{name}</span>
        <StaffRoleBadge role={staffRole} compact hideOnMobile={!imageMode} />
      </span>
      {countText && <span className={countClass}>{countText}</span>}
    </Tag>
  );
}

function PitchRow({ players, section, selectedKey, onSelect, counts, staffRoles, imageMode = false }: { players: string[]; section: LineupSection; selectedKey: string | null; onSelect?: (section: LineupSection, name: string) => void; counts?: Map<string, PlayerCount>; staffRoles?: Map<string, StaffRole>; imageMode?: boolean }) {
  if (!players.length) return <div className="flex h-6" />;
  const rowClass = imageMode ? "flex items-center justify-around gap-1.5 px-2" : "grid items-center justify-center gap-1 px-1 sm:flex sm:flex-wrap sm:justify-around sm:gap-1.5 sm:px-2";
  return (
    <div className={rowClass} style={imageMode ? undefined : { gridTemplateColumns: `repeat(${players.length}, minmax(0, 4.2rem))` }}>
      {players.map((name) => (
        <PitchChip key={name} name={name} selected={selectedKey === `${section}|${name}`} onClick={onSelect ? () => onSelect(section, name) : undefined} count={counts?.get(name)} staffRole={staffRoles?.get(name)} fill imageMode={imageMode} />
      ))}
    </div>
  );
}

function Pitch({ title, gk, attack, mid, defense, bench, accent = "emerald", selectedKey, onSelect, counts, staffRoles, imageMode = false }: {
  title: string;
  gk: string;
  attack: string[];
  mid: string[];
  defense: string[];
  bench: string[];
  accent?: "emerald" | "orange";
  selectedKey?: string | null;
  onSelect?: (section: LineupSection, name: string) => void;
  counts?: Map<string, PlayerCount>;
  staffRoles?: Map<string, StaffRole>;
  imageMode?: boolean;
}) {
  const headerClass = accent === "orange" ? "from-orange-500 to-orange-700" : "from-lime-500 to-emerald-600";
  const fieldClass = accent === "orange" ? "from-orange-400 to-orange-600" : "from-lime-400 to-emerald-600";
  const sel = selectedKey ?? null;
  const shellClass = imageMode ? "rounded-2xl shadow-lg" : "overflow-hidden rounded-2xl shadow-lg";
  const headerPaddingClass = imageMode ? "px-5 py-3" : "px-3 py-2 sm:px-5 sm:py-3";
  const titleClass = imageMode ? "text-lg font-black leading-normal" : "text-base font-black sm:text-lg";
  const fieldPaddingClass = imageMode ? "p-3" : "p-2 sm:p-3";
  const rowsClass = imageMode ? "relative flex h-full flex-col justify-around py-2" : "relative flex h-full flex-col justify-around py-1";
  const benchClass = imageMode ? "rounded-b-2xl bg-slate-50 px-4 py-3" : "bg-slate-50 px-4 py-3";
  const hasGk = !isEmptyPlayerName(gk);
  return (
    <div className={shellClass}>
      <div className={`rounded-t-2xl bg-gradient-to-r ${headerClass} ${headerPaddingClass} text-white`}>
        <p className={titleClass}>{title}</p>
      </div>
      <div className={`relative bg-gradient-to-b ${fieldClass} ${fieldPaddingClass}`} style={{ aspectRatio: "5 / 4" }}>
        <div className="absolute inset-3 rounded-lg border-2 border-white/40" />
        <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-white/40" />
        <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/40" />
        <div className="absolute left-1/4 right-1/4 top-3 h-9 rounded-b-md border-2 border-t-0 border-white/40" />
        <div className="absolute left-1/4 right-1/4 bottom-3 h-9 rounded-t-md border-2 border-b-0 border-white/40" />
        <div className={rowsClass}>
          <PitchRow players={attack} section="attack" selectedKey={sel} onSelect={onSelect} counts={counts} staffRoles={staffRoles} imageMode={imageMode} />
          <PitchRow players={mid} section="mid" selectedKey={sel} onSelect={onSelect} counts={counts} staffRoles={staffRoles} imageMode={imageMode} />
          <PitchRow players={defense} section="defense" selectedKey={sel} onSelect={onSelect} counts={counts} staffRoles={staffRoles} imageMode={imageMode} />
          <div className="flex justify-center">
            {hasGk ? (
              <PitchChip name={gk} accent="gk" selected={sel === `gk|${gk}`} onClick={onSelect ? () => onSelect("gk", gk) : undefined} count={counts?.get(gk)} staffRole={staffRoles?.get(gk)} imageMode={imageMode} />
            ) : (
              <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800">GK 미배정</span>
            )}
          </div>
        </div>
      </div>
      <div className={benchClass}>
        <p className="text-xs font-bold text-slate-500">대기</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {bench.length === 0 ? (
            <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-500">없음</span>
          ) : (
            bench.map((name) => (
              <PitchChip key={name} name={name} accent="bench" selected={sel === `bench|${name}`} onClick={onSelect ? () => onSelect("bench", name) : undefined} count={counts?.get(name)} staffRole={staffRoles?.get(name)} imageMode={imageMode} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

type SwappableQuarter = {
  attack: string[];
  mid: string[];
  defense: string[];
  gk: string;
  bench: string[];
};

function swapInsideQuarter<T extends SwappableQuarter>(q: T, sec1: LineupSection, name1: string, sec2: LineupSection, name2: string): T {
  if (sec1 === sec2) {
    if (sec1 === "gk" || name1 === name2) return q;
    const arr = (q[sec1] as string[]).map((name) => {
      if (name === name1) return name2;
      if (name === name2) return name1;
      return name;
    });
    return { ...q, [sec1]: arr } as T;
  }

  const setSection = (
    target: T,
    section: LineupSection,
    oldName: string,
    newName: string,
  ): T => {
    if (section === "gk") return { ...target, gk: newName };
    const arr = (target[section] as string[]).map((n) => (n === oldName ? newName : n));
    return { ...target, [section]: arr } as T;
  };
  let updated = setSection(q, sec1, name1, name2);
  updated = setSection(updated, sec2, name2, name1);
  return updated;
}

function LineupResultView({
  result,
  teamResult,
  selectedVariantIdx = 0,
  copied,
  onCopyShareUrl,
  onQuartersChange,
}: {
  result: LineupResult;
  teamResult?: TeamBalanceResult | null;
  selectedVariantIdx?: number;
  copied: boolean;
  onCopyShareUrl: (result: LineupResult, teamContext?: LineupShareTeamContext, prebuiltUrl?: string | null) => void;
  onQuartersChange: (quarters: LineupResult["quarters"]) => void;
}) {
  const [quarters, setQuarters] = useState(result.quarters);
  const [selection, setSelection] = useState<{ key: string; section: LineupSection; name: string } | null>(null);
  const [quarterSwapKey, setQuarterSwapKey] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareUrlError, setShareUrlError] = useState<string | null>(null);
  const [lineupSaveStatus, setLineupSaveStatus] = useState<string | null>(null);
  const [lineupSaveError, setLineupSaveError] = useState<string | null>(null);
  const refs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const currentLineup = useMemo(() => ({ ...result, quarters }), [result, quarters]);

  useEffect(() => {
    setQuarters(result.quarters);
    setSelection(null);
    setQuarterSwapKey(null);
  }, [result]);

  useEffect(() => {
    let active = true;
    setShareUrl(null);
    setShareUrlError(null);
    void buildLineupShareUrl(currentLineup, { teamResult, selectedVariantIdx })
      .then((url) => {
        if (active) setShareUrl(url);
      })
      .catch((error) => {
        if (active) setShareUrlError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [currentLineup, teamResult, selectedVariantIdx]);

  function handleQuarterSwap(key: string) {
    if (!quarterSwapKey) {
      setQuarterSwapKey(key);
      setSelection(null);
      return;
    }
    if (quarterSwapKey === key) {
      setQuarterSwapKey(null);
      return;
    }
    const team1 = quarterSwapKey.split("-")[0];
    const team2 = key.split("-")[0];
    if (team1 !== team2) {
      setQuarterSwapKey(key);
      return;
    }
    const firstIdx = quarters.findIndex((q) => `${q.team}-${q.quarter}` === quarterSwapKey);
    const secondIdx = quarters.findIndex((q) => `${q.team}-${q.quarter}` === key);
    if (firstIdx < 0 || secondIdx < 0) {
      setQuarterSwapKey(null);
      return;
    }
    const reordered = [...quarters];
    const first = reordered[firstIdx];
    reordered[firstIdx] = reordered[secondIdx];
    reordered[secondIdx] = first;

    const nextQuarterByTeam: Record<TeamName, number> = { A: 1, B: 1 };
    const next = reordered.map((q) => {
      const quarter = nextQuarterByTeam[q.team] as Quarter;
      nextQuarterByTeam[q.team] += 1;
      return { ...q, quarter };
    });
    setQuarters(next);
    onQuartersChange(next);
    setQuarterSwapKey(null);
    setSelection(null);
  }

  const countsByTeam = useMemo(() => {
    const map = new Map<string, Map<string, PlayerCount>>();
    for (const q of quarters) {
      let teamMap = map.get(q.team);
      if (!teamMap) {
        teamMap = new Map<string, PlayerCount>();
        map.set(q.team, teamMap);
      }
      const ensurePlayer = (name: string) => {
        if (!name || name === "없음") return;
        if (!teamMap!.has(name)) teamMap!.set(name, { field: 0, gk: 0 });
      };
      const bumpField = (name: string) => {
        ensurePlayer(name);
        const c = teamMap!.get(name) ?? { field: 0, gk: 0 };
        teamMap!.set(name, { field: c.field + 1, gk: c.gk });
      };
      const bumpGk = (name: string) => {
        if (!name || name === "없음") return;
        ensurePlayer(name);
        const c = teamMap!.get(name) ?? { field: 0, gk: 0 };
        teamMap!.set(name, { field: c.field, gk: c.gk + 1 });
      };
      q.attack.forEach(bumpField);
      q.mid.forEach(bumpField);
      q.defense.forEach(bumpField);
      bumpGk(q.gk);
      q.bench.forEach(ensurePlayer);
    }
    return map;
  }, [quarters]);

  const staffRolesByName = useMemo(() => {
    const map = new Map<string, StaffRole>();
    for (const summary of result.playerSummaries) {
      if (summary.staffRole) map.set(summary.playerName, summary.staffRole);
    }
    Object.entries(result.staffRoles ?? {}).forEach(([name, role]) => {
      map.set(name, role);
    });
    return map;
  }, [result.playerSummaries, result.staffRoles]);

  function handleSelect(key: string, section: LineupSection, name: string) {
    if (!selection) {
      setSelection({ key, section, name });
      return;
    }
    if (selection.key === key && selection.section === section && selection.name === name) {
      setSelection(null);
      return;
    }
    // 다른 쿼터 클릭 시: 선택 옮김
    if (selection.key !== key) {
      setSelection({ key, section, name });
      return;
    }
    if (selection.section === section && selection.name === name) {
      setSelection(null);
      return;
    }
    // 같은 쿼터 안에서는 필드, GK, 대기 어디든 서로 자리를 바꿀 수 있다.
    const next = quarters.map((q) => {
      const qKey = `${q.team}-${q.quarter}`;
      if (qKey !== key) return q;
      return swapInsideQuarter(q, selection.section, selection.name, section, name);
    });
    setQuarters(next);
    onQuartersChange(next);
    setSelection(null);
  }

  const teamCaptureRefs = useRef<Record<TeamName, HTMLDivElement | null>>({ A: null, B: null });
  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);
  async function downloadTeam(team: TeamName) {
    const elem = teamCaptureRefs.current[team];
    if (!elem) return;
    const teamFileName = team === "A" ? "fluorescent" : "orange";
    await downloadElementAsImage(elem, `dev_fc_${teamFileName}_lineup_${today}.png`);
    if (!teamResult) return;

    setLineupSaveStatus(null);
    setLineupSaveError(null);
    try {
      let recordShareUrl = shareUrl;
      if (!recordShareUrl && !shareUrlError) {
        recordShareUrl = await buildLineupShareUrl(currentLineup, { teamResult, selectedVariantIdx });
      }
      const fallbackUrl = typeof window !== "undefined" ? window.location.href : "/";
      const record = buildTeamRecord(teamResult, today, recordShareUrl ?? fallbackUrl, currentLineup);
      await upsertTeamRecord(record);
      setLineupSaveStatus(`${formatTeamName(team)} 라인업 확정 저장 완료`);
    } catch (error) {
      setLineupSaveError(`라인업 확정 저장 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const teamOverview = useMemo(() => {
    const grouped: Record<TeamName, Record<PositionGroup, OverviewPlayer[]>> = {
      A: { ATTACK: [], MID: [], DEFENSE: [] },
      B: { ATTACK: [], MID: [], DEFENSE: [] },
    };
    for (const s of result.playerSummaries) {
      const teamKey = s.team;
      grouped[teamKey][s.assignedGroup].push({
        name: s.playerName,
        staffRole: s.staffRole ?? staffRolesByName.get(s.playerName),
      });
    }
    return grouped;
  }, [result.playerSummaries, staffRolesByName]);

  const quartersByTeam = useMemo(() => {
    const grouped: Record<TeamName, LineupResult["quarters"]> = { A: [], B: [] };
    for (const quarter of quarters) grouped[quarter.team].push(quarter);
    grouped.A.sort((a, b) => a.quarter - b.quarter);
    grouped.B.sort((a, b) => a.quarter - b.quarter);
    return grouped;
  }, [quarters]);

  const renderQuarterCard = (q: LineupResult["quarters"][0]) => {
    const key = `${q.team}-${q.quarter}`;
    const selectedKey = selection && selection.key === key ? `${selection.section}|${selection.name}` : null;
    const isSwapSelected = quarterSwapKey === key;
    const isSwapPending = quarterSwapKey !== null && !isSwapSelected;
    const isSameTeamPending = isSwapPending && quarterSwapKey?.split("-")[0] === q.team;
    return (
      <div key={key} className="space-y-2">
        <div ref={(el) => { refs.current.set(key, el); }} className={isSwapSelected ? "ring-2 ring-amber-400 rounded-2xl" : ""}>
          <Pitch
            title={`${formatTeamName(q.team)} ${q.quarter}Q`}
            gk={q.gk}
            attack={q.attack}
            mid={q.mid}
            defense={q.defense}
            bench={q.bench}
            accent={q.team === "A" ? "emerald" : "orange"}
            selectedKey={selectedKey}
            onSelect={(section, name) => handleSelect(key, section, name)}
            counts={countsByTeam.get(q.team)}
            staffRoles={staffRolesByName}
          />
        </div>
        <button
          className={`w-full rounded-xl px-3 py-2 text-xs font-semibold ${isSwapSelected ? "bg-amber-400 text-amber-950" : isSameTeamPending ? "bg-amber-100 text-amber-900 hover:bg-amber-200" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          onClick={() => handleQuarterSwap(key)}
        >
          {isSwapSelected ? "선택됨 (취소)" : isSameTeamPending ? "여기와 바꾸기" : "쿼터 순서 바꾸기"}
        </button>
      </div>
    );
  };

  return (
    <section id="lineup-result" className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">라인업 결과</h2>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
            onClick={() => onCopyShareUrl(currentLineup, { teamResult, selectedVariantIdx }, shareUrl)}
            disabled={!shareUrl && !shareUrlError}
          >
            {copied ? "공유 링크 복사됨" : !shareUrl && !shareUrlError ? "공유 링크 준비 중" : "라인업/팀분배 공유"}
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">같은 쿼터 안에서는 <span className="font-bold">필드, GK, 대기</span> 어디든 서로 자리를 바꿀 수 있어요. 쿼터 순서는 각 피치 아래 <span className="font-bold">쿼터 순서 바꾸기</span> 버튼으로 조정하면 위에서부터 1~4Q로 다시 정렬됩니다. 코치별 미세조정과 확정된 팀분배는 <span className="font-bold">라인업/팀분배 공유</span>로 현재 상태를 공유하세요.</p>
      {result.warnings.length > 0 && <div className="mt-4"><MessageBox title="라인업 경고" items={result.warnings} tone="warning" /></div>}

      <div className="mt-4 rounded-2xl border-2 border-slate-300 bg-white p-2 sm:p-5">
        <div className="mb-2 flex items-baseline justify-center gap-2 sm:mb-3">
          <h3 className="text-base font-black text-slate-900 sm:text-lg">DEV FC 라인업</h3>
          <span className="text-xs font-semibold text-slate-500 sm:text-sm">{today}</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2 md:gap-4">
          {(["A", "B"] as const).map((team) => <TeamOverviewCard key={team} team={team} groups={teamOverview[team]} />)}
        </div>

        <div className="mt-2 grid gap-3 md:hidden">
          {(["A", "B"] as const).flatMap((team) => quartersByTeam[team].map(renderQuarterCard))}
        </div>

        <div className="mt-4 hidden gap-4 md:grid md:grid-cols-2">
          {quarters.map(renderQuarterCard)}
        </div>
      </div>

      <div aria-hidden className="fixed left-[-10000px] top-0 w-[720px] bg-white">
        {(["A", "B"] as const).map((team) => (
          <TeamLineupImage
            key={team}
            refCallback={(el) => { teamCaptureRefs.current[team] = el; }}
            team={team}
            today={today}
            groups={teamOverview[team]}
            quarters={quartersByTeam[team]}
            counts={countsByTeam.get(team)}
            staffRoles={staffRolesByName}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button className="rounded-xl bg-lime-500 px-4 py-3 text-sm font-black text-lime-950 shadow-sm hover:bg-lime-400" onClick={() => downloadTeam("A")}>형광팀 라인업 확정 (이미지 저장)</button>
        <button className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-orange-400" onClick={() => downloadTeam("B")}>주황팀 라인업 확정 (이미지 저장)</button>
      </div>
      {(lineupSaveStatus || lineupSaveError) && (
        <p className={`mt-3 text-right text-xs font-semibold ${lineupSaveError ? "text-red-600" : "text-emerald-700"}`}>
          {lineupSaveError ?? lineupSaveStatus}
        </p>
      )}
    </section>
  );
}

function TeamLineupImage({
  refCallback,
  team,
  today,
  groups,
  quarters,
  counts,
  staffRoles,
}: {
  refCallback: (el: HTMLDivElement | null) => void;
  team: TeamName;
  today: string;
  groups: Record<PositionGroup, OverviewPlayer[]>;
  quarters: LineupResult["quarters"];
  counts?: Map<string, PlayerCount>;
  staffRoles: Map<string, StaffRole>;
}) {
  return (
    <div ref={refCallback} className="mb-6 rounded-2xl border-2 border-slate-300 bg-white p-5" style={{ fontFamily: `"Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif` }}>
      <div className="mb-3 flex items-baseline justify-center gap-2">
        <h3 className="text-lg font-black text-slate-900">DEV FC {formatTeamName(team)} 라인업</h3>
        <span className="text-sm font-semibold text-slate-500">{today}</span>
      </div>
      <TeamOverviewCard team={team} groups={groups} imageMode />
      <div className="mt-4 grid gap-4">
        {quarters.map((q) => (
          <Pitch
            key={`${q.team}-${q.quarter}`}
            title={`${formatTeamName(q.team)} ${q.quarter}Q`}
            gk={q.gk}
            attack={q.attack}
            mid={q.mid}
            defense={q.defense}
            bench={q.bench}
            accent={q.team === "A" ? "emerald" : "orange"}
            counts={counts}
            staffRoles={staffRoles}
            imageMode
          />
        ))}
      </div>
    </div>
  );
}

function MatchResultView({
  result,
  copied,
  quarterPlanTotal,
  quarterPlanRequired,
  onCopyShareUrl,
  onQuartersChange,
}: {
  result: MatchPlanResult;
  copied: boolean;
  quarterPlanTotal: number;
  quarterPlanRequired: number;
  onCopyShareUrl: (result: MatchPlanResult, prebuiltUrl?: string | null) => void;
  onQuartersChange: (quarters: MatchPlanResult["quarters"]) => void;
}) {
  const [quarters, setQuarters] = useState(result.quarters);
  const [selection, setSelection] = useState<{ key: string; section: LineupSection; name: string } | null>(null);
  const [quarterSwapKey, setQuarterSwapKey] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareUrlError, setShareUrlError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const refs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const currentMatch = useMemo(() => ({ ...result, quarters }), [result, quarters]);
  const today = useMemo(() => formatLocalDate(), []);
  const quarterPlanDiff = quarterPlanTotal - quarterPlanRequired;

  useEffect(() => {
    setQuarters(result.quarters);
    setSelection(null);
    setQuarterSwapKey(null);
    setSaveStatus(null);
    setSaveError(null);
  }, [result]);

  useEffect(() => {
    let active = true;
    setShareUrl(null);
    setShareUrlError(null);
    void buildMatchLineupShareUrl(currentMatch)
      .then((url) => {
        if (active) setShareUrl(url);
      })
      .catch((error) => {
        if (active) setShareUrlError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [currentMatch]);

  const staffRolesByName = useMemo(() => {
    const map = new Map<string, StaffRole>();
    const addPlayer = (player?: { name: string; memo?: string } | null) => {
      if (!player) return;
      const role = extractStaffRole(player.memo);
      if (role) map.set(player.name, role);
    };
    result.starters.attack.forEach((item) => addPlayer(item.player));
    result.starters.mid.forEach((item) => addPlayer(item.player));
    result.starters.defense.forEach((item) => addPlayer(item.player));
    result.bench.forEach((item) => addPlayer(item.player));
    addPlayer(result.starters.gk);
    return map;
  }, [result]);
  const counts = useMemo(() => {
    const map = new Map<string, PlayerCount>();
    const ensurePlayer = (name: string) => {
      if (isEmptyPlayerName(name)) return;
      if (!map.has(name)) map.set(name, { field: 0, gk: 0 });
    };
    const bumpField = (name: string) => {
      ensurePlayer(name);
      const c = map.get(name);
      if (c) map.set(name, { field: c.field + 1, gk: c.gk });
    };
    const bumpGk = (name: string) => {
      ensurePlayer(name);
      const c = map.get(name);
      if (c) map.set(name, { field: c.field, gk: c.gk + 1 });
    };

    for (const quarter of quarters) {
      quarter.attack.forEach(bumpField);
      quarter.mid.forEach(bumpField);
      quarter.defense.forEach(bumpField);
      bumpGk(quarter.gk);
    }
    return map;
  }, [quarters]);

  function handleSelect(key: string, section: LineupSection, name: string) {
    if (!selection) {
      setSelection({ key, section, name });
      return;
    }
    if (selection.key === key && selection.section === section && selection.name === name) {
      setSelection(null);
      return;
    }
    if (selection.key !== key) {
      setSelection({ key, section, name });
      return;
    }
    const next = quarters.map((quarter) => (
      `match-${quarter.quarter}` === key ? swapInsideQuarter(quarter, selection.section, selection.name, section, name) : quarter
    ));
    setQuarters(next);
    onQuartersChange(next);
    setSaveStatus(null);
    setSaveError(null);
    setSelection(null);
  }

  function handleQuarterSwap(key: string) {
    if (!quarterSwapKey) {
      setQuarterSwapKey(key);
      setSelection(null);
      return;
    }
    if (quarterSwapKey === key) {
      setQuarterSwapKey(null);
      return;
    }

    const firstIdx = quarters.findIndex((quarter) => `match-${quarter.quarter}` === quarterSwapKey);
    const secondIdx = quarters.findIndex((quarter) => `match-${quarter.quarter}` === key);
    if (firstIdx < 0 || secondIdx < 0) {
      setQuarterSwapKey(null);
      return;
    }

    const reordered = [...quarters];
    const first = reordered[firstIdx];
    reordered[firstIdx] = reordered[secondIdx];
    reordered[secondIdx] = first;
    const next = reordered.map((quarter, index) => ({ ...quarter, quarter: (index + 1) as Quarter }));
    setQuarters(next);
    onQuartersChange(next);
    setQuarterSwapKey(null);
    setSelection(null);
    setSaveStatus(null);
    setSaveError(null);
  }

  async function saveCurrentMatch(overwriteExisting = false, skipQuarterCheck = false): Promise<void> {
    if (!skipQuarterCheck && quarterPlanTotal !== quarterPlanRequired) {
      const diffText = quarterPlanDiff > 0 ? `${quarterPlanDiff}Q 초과` : `${Math.abs(quarterPlanDiff)}Q 부족`;
      const ok = window.confirm(`출전 쿼터 설정 합계가 ${quarterPlanTotal}Q라서 기준 ${quarterPlanRequired}Q보다 ${diffText}입니다. 그래도 매치 라인업을 저장할까요?`);
      if (!ok) return;
    }

    setSaving(true);
    setSaveStatus(null);
    setSaveError(null);
    try {
      const record = buildMatchRecord(currentMatch, quarters, today, overwriteExisting);
      const saved = await saveMatchRecord(record);
      setSaveStatus(`${saved.matchId} 매치 라인업 확정 저장 완료`);
    } catch (error) {
      const apiError = error as Error & { status?: number; body?: unknown };
      if (apiError.status === 409 && !overwriteExisting) {
        const ok = window.confirm(`오늘(${today}) 매치 기록이 이미 있습니다. 기존 스코어/라인업 기록을 덮어쓰고 저장할까요?`);
        if (ok) {
          await saveCurrentMatch(true, true);
          return;
        }
      }
      setSaveError(`매치 라인업 저장 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function downloadOne(quarter: number) {
    const key = `match-${quarter}`;
    const elem = refs.current.get(key);
    if (!elem) return;
    await downloadElementAsImage(elem, `match_${quarter}Q.png`);
  }

  async function downloadAll() {
    for (const q of quarters) {
      const key = `match-${q.quarter}`;
      const elem = refs.current.get(key);
      if (!elem) continue;
      await downloadElementAsImage(elem, `match_${q.quarter}Q.png`);
    }
  }

  return (
    <section id="match-result" className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">매치 라인업 추천</h2>
        <div className="flex flex-wrap gap-2">
          <button
            className="whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-wait disabled:bg-emerald-300"
            onClick={() => void saveCurrentMatch()}
            disabled={saving}
          >
            {saving ? "저장 중" : "매치 라인업 확정 저장"}
          </button>
          <button
            className="whitespace-nowrap rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            onClick={() => onCopyShareUrl(currentMatch, shareUrl)}
            disabled={!shareUrl && !shareUrlError}
          >
            {copied ? "공유 링크 복사됨" : !shareUrl && !shareUrlError ? "공유 링크 준비 중" : "매치 라인업 공유"}
          </button>
          <button className="whitespace-nowrap rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white" onClick={downloadAll}>전체 이미지 저장</button>
        </div>
      </div>
      {quarterPlanTotal !== quarterPlanRequired && (
        <div className="mt-4">
          <MessageBox
            title="쿼터 설정 확인"
            items={[`설정 합계가 ${quarterPlanTotal}Q입니다. 기준 ${quarterPlanRequired}Q와 다르지만, 확정 저장 시 확인 후 저장할 수 있습니다.`]}
            tone="warning"
          />
        </div>
      )}
      {(saveStatus || saveError) && (
        <p className={`mt-3 text-right text-xs font-semibold ${saveError ? "text-red-600" : "text-emerald-700"}`}>
          {saveError ?? saveStatus}
        </p>
      )}
      {result.warnings.length > 0 && <div className="mt-4"><MessageBox title="매치 경고" items={result.warnings} tone="warning" /></div>}
      {result.notes.length > 0 && <div className="mt-4"><MessageBox title="운영 메모" items={result.notes} tone="info" /></div>}
      <p className="mt-3 text-xs text-slate-500">같은 쿼터 안에서는 <span className="font-bold">필드, GK, 대기</span> 어디든 서로 자리를 바꿀 수 있어요. 쿼터 순서는 각 피치 아래 <span className="font-bold">쿼터 순서 바꾸기</span> 버튼으로 조정하면 위에서부터 1~4Q로 다시 정렬됩니다.</p>
      <div className="mt-4 rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold">베스트 라인업</h3>
        <div className="mt-3">
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">GK</span>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
              <span>{result.starters.gk?.name ?? "없음"}</span>
              <StaffRoleBadge role={extractStaffRole(result.starters.gk?.memo)} compact />
            </span>
          </div>
        </div>
        <MatchGroup group="ATTACK" items={result.starters.attack} />
        <MatchGroup group="MID" items={result.starters.mid} />
        <MatchGroup group="DEFENSE" items={result.starters.defense} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {quarters.map((q) => {
          const key = `match-${q.quarter}`;
          const selectedKey = selection && selection.key === key ? `${selection.section}|${selection.name}` : null;
          const isSwapSelected = quarterSwapKey === key;
          const isSwapPending = quarterSwapKey !== null && !isSwapSelected;
          return (
            <div key={key} className="space-y-2">
              <div ref={(el) => { refs.current.set(key, el); }} className={isSwapSelected ? "ring-2 ring-amber-400 rounded-2xl" : ""}>
                <Pitch
                  title={`${q.quarter}Q`}
                  gk={q.gk}
                  attack={q.attack}
                  mid={q.mid}
                  defense={q.defense}
                  bench={q.bench}
                  staffRoles={staffRolesByName}
                  counts={counts}
                  selectedKey={selectedKey}
                  onSelect={(section, name) => handleSelect(key, section, name)}
                />
              </div>
              <button
                className={`w-full rounded-xl px-3 py-2 text-xs font-semibold ${isSwapSelected ? "bg-amber-400 text-amber-950" : isSwapPending ? "bg-amber-100 text-amber-900 hover:bg-amber-200" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                onClick={() => handleQuarterSwap(key)}
              >
                {isSwapSelected ? "선택됨 (취소)" : isSwapPending ? "여기와 바꾸기" : "쿼터 순서 바꾸기"}
              </button>
              <button className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700" onClick={() => downloadOne(q.quarter)}>이 화면 이미지 저장</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MatchOperationBoard({ operation, staffRoles }: { operation: MatchPlanResult["operation"]; staffRoles: Map<string, StaffRole> }) {
  const rotateRef = useRef<HTMLDivElement | null>(null);
  const hasPriority = operation.q4PriorityNames.length > 0;
  const hasSwaps = operation.rotateSwaps.length > 0;

  async function downloadRotate() {
    if (!rotateRef.current) return;
    await downloadElementAsImage(rotateRef.current, "match_4Q_rotate.png");
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">4Q 운영판</h3>
          <p className="mt-1 text-xs text-slate-500">스코어 상황에 따라 바로 고를 수 있게 정리했습니다.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">접전: 베스트 유지</span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">여유: 보장 교체</span>
          <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">2Q 이상 {operation.coveredByQ3Names.length}명</span>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-xs font-bold text-slate-500">지고 있거나 접전</p>
          <p className="mt-1 text-sm font-bold text-slate-800">4Q 베스트 라인업 그대로</p>
          <p className="mt-1 text-xs text-slate-500">이미 생성된 4Q 피치를 쓰면 됩니다.</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-3">
          <p className="text-xs font-bold text-emerald-700">리드하거나 여유 있음</p>
          <p className="mt-1 text-sm font-bold text-emerald-900">{hasSwaps ? "아래 교체 추천 적용" : "추가 교체 없이 베스트 유지"}</p>
          <p className="mt-1 text-xs text-emerald-700">{hasPriority ? "3Q까지 덜 뛴 정규 참석자를 먼저 챙깁니다." : "정규 참석자 2Q 보장이 이미 충분합니다."}</p>
        </div>
      </div>

      {hasPriority && (
        <div className="mt-3">
          <p className="text-xs font-bold text-slate-500">4Q 먼저 챙길 선수</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {operation.q4PriorityNames.map((name) => (
              <span key={name} className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">{name}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <p className="text-xs font-bold text-slate-500">교체 추천</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {operation.rotateSwaps.map((swap) => (
            <span key={`${swap.outName}-${swap.inName}-${swap.group}`} className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800" title={swap.reason}>
              {swap.outName} → {swap.inName} ({groupKorean(swap.group)})
            </span>
          ))}
          {!hasSwaps && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">없음</span>}
        </div>
      </div>

      {(operation.callupUsedNames.length > 0 || operation.callupUnusedNames.length > 0) && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-bold text-slate-500">콜업 사용</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {operation.callupUsedNames.map((name) => <span key={name} className="rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-800">{name}</span>)}
              {operation.callupUsedNames.length === 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">없음</span>}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500">콜업 대기</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {operation.callupUnusedNames.map((name) => <span key={name} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{name}</span>)}
              {operation.callupUnusedNames.length === 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">없음</span>}
            </div>
          </div>
        </div>
      )}

      {hasSwaps && (
        <div className="mt-4 space-y-2">
          <div ref={rotateRef}>
            <Pitch
              title="4Q 여유 운영안"
              gk={operation.rotateLineup.gk}
              attack={operation.rotateLineup.attack}
              mid={operation.rotateLineup.mid}
              defense={operation.rotateLineup.defense}
              bench={operation.rotateLineup.bench}
              staffRoles={staffRoles}
            />
          </div>
          <button className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700" onClick={downloadRotate}>여유 운영안 이미지 저장</button>
        </div>
      )}
    </div>
  );
}

function MatchGroup({ group, items }: { group: PositionGroup; items: MatchSelection[] }) {
  return (
    <div className="mt-3">
      <GroupBadge group={group} />
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => {
          return (
            <span key={item.player.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700" title={item.reason}>
              <span>{item.player.name}</span>
              <StaffRoleBadge role={extractStaffRole(item.player.memo)} compact />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function groupKorean(group: PositionGroup): string {
  if (group === "ATTACK") return "공격";
  if (group === "MID") return "미드";
  return "수비";
}
