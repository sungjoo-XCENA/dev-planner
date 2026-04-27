import type { MemberType, Player } from "@/types/player";
import { parseSecondaryPositions, toPosition } from "./positions";

export type LoadPlayersResult = {
  players: Player[];
  errors: string[];
  warnings: string[];
};

type CanonicalColumn =
  | "active"
  | "name"
  | "primary_position"
  | "secondary_positions"
  | "attack_score"
  | "mid_score"
  | "defense_score"
  | "activity_score"
  | "gk"
  | "memo"
  | "member_type";

// MVP policy: use one regular-player sheet. Guests are added in the web UI.
// member_type is still accepted for backward compatibility, but is no longer required.
const REQUIRED_COLUMNS: CanonicalColumn[] = [
  "active",
  "name",
  "primary_position",
  "attack_score",
  "mid_score",
  "defense_score",
  "activity_score",
  "gk",
];

const HEADER_ALIASES: Record<CanonicalColumn, string[]> = {
  active: ["사용", "active", "활성", "사용여부", "활성여부"],
  name: ["이름", "name", "성명", "선수", "선수명"],
  primary_position: ["주포지션", "primary_position", "primary position", "주 포지션", "포지션", "메인포지션"],
  secondary_positions: ["부포지션", "secondary_positions", "secondary positions", "부 포지션", "서브포지션", "가능포지션"],
  attack_score: ["공격", "attack_score", "attack", "공격점수", "공격 점수"],
  mid_score: ["미드", "mid_score", "mid", "middle", "midfield", "미드점수", "미드 점수", "중원"],
  defense_score: ["수비", "defense_score", "defense", "defence", "수비점수", "수비 점수"],
  activity_score: ["활동량", "activity_score", "activity", "활동", "체력", "활동점수"],
  gk: ["키퍼", "gk", "GK", "골키퍼", "키퍼가능", "키퍼 가능", "gk가능"],
  memo: ["메모", "memo", "비고", "참고", "특이사항"],
  member_type: ["구분", "member_type", "member type", "회원구분", "멤버구분", "타입"],
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-]/g, "");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  rows.push(row);
  return rows.filter((items) => items.some((item) => item.trim().length > 0));
}

function buildHeaderMap(headers: string[]): Partial<Record<CanonicalColumn, number>> {
  const normalizedHeaders = headers.map(normalizeHeader);
  const result: Partial<Record<CanonicalColumn, number>> = {};

  (Object.keys(HEADER_ALIASES) as CanonicalColumn[]).forEach((column) => {
    const aliases = HEADER_ALIASES[column].map(normalizeHeader);
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    if (index >= 0) result[column] = index;
  });

  return result;
}

function parseScore(value: string, rowNumber: number, column: string, errors: string[]): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    errors.push(`${rowNumber}행 ${column}은 1~5 숫자여야 합니다.`);
    return 3;
  }
  return parsed;
}

function parseBooleanYN(value: string, rowNumber: number, column: string, errors: string[]): boolean {
  const normalized = value.trim().toUpperCase();
  if (["Y", "YES", "O", "TRUE", "가능", "예", "1"].includes(normalized)) return true;
  if (["N", "NO", "X", "FALSE", "불가", "아니오", "0"].includes(normalized)) return false;
  errors.push(`${rowNumber}행 ${column}은 Y/N, O/X, 가능/불가 중 하나여야 합니다.`);
  return false;
}

function parseActive(value: string): boolean {
  if (!value.trim()) return true;
  const normalized = value.trim().toUpperCase();
  return !["N", "NO", "X", "FALSE", "미사용", "숨김", "0"].includes(normalized);
}

function parseMemberType(value: string): MemberType {
  const normalized = value.trim().toUpperCase();
  if (["GUEST", "용병", "게스트"].includes(normalized)) return "GUEST";
  return "REGULAR";
}

function proxiedCsvUrl(url: string): string {
  return `/api/csv?url=${encodeURIComponent(url)}`;
}

export async function loadPlayersFromCsv(url: string): Promise<LoadPlayersResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let text = "";
  try {
    const response = await fetch(proxiedCsvUrl(url));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    text = await response.text();
  } catch (error) {
    return {
      players: [],
      errors: [`시트 데이터를 불러오지 못했습니다. 공유 설정 또는 URL을 확인해주세요. (${String(error)})`],
      warnings,
    };
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { players: [], errors: ["시트에 헤더 1행과 선수 데이터가 필요합니다."], warnings };
  }

  const headers = rows[0].map((header) => header.trim());
  const headerMap = buildHeaderMap(headers);
  const missing = REQUIRED_COLUMNS.filter((column) => headerMap[column] === undefined);
  if (missing.length > 0) {
    errors.push(`필수 컬럼이 누락되었습니다: ${missing.join(", ")}`);
    errors.push(`현재 인식한 헤더: ${headers.join(", ")}`);
  }

  const valueOf = (row: string[], column: CanonicalColumn) => {
    const index = headerMap[column];
    return index !== undefined ? row[index]?.trim() ?? "" : "";
  };

  const players: Player[] = [];

  rows.slice(1).forEach((row, idx) => {
    const rowNumber = idx + 2;
    const active = parseActive(valueOf(row, "active"));
    if (!active) return;

    const name = valueOf(row, "name");
    if (!name) {
      errors.push(`${rowNumber}행 이름은 필수입니다.`);
      return;
    }

    const primary = toPosition(valueOf(row, "primary_position"));
    if (!primary) {
      errors.push(`${rowNumber}행 주포지션이 허용되지 않은 포지션입니다: ${valueOf(row, "primary_position")}`);
      return;
    }

    const rawSecondary = valueOf(row, "secondary_positions");
    const secondaryPositions = parseSecondaryPositions(rawSecondary);
    const secondaryTokens = rawSecondary.trim() ? rawSecondary.split(",").map((v) => v.trim()).filter(Boolean) : [];
    if (secondaryPositions.length !== secondaryTokens.length) {
      warnings.push(`${rowNumber}행 ${name}의 부포지션 중 일부가 무시되었습니다. 허용값을 확인해주세요.`);
    }

    players.push({
      id: `sheet_${rowNumber}_${name}`,
      source: "SHEET",
      memberType: parseMemberType(valueOf(row, "member_type")),
      active,
      name,
      primaryPosition: primary,
      secondaryPositions,
      attackScore: parseScore(valueOf(row, "attack_score"), rowNumber, "공격", errors),
      midScore: parseScore(valueOf(row, "mid_score"), rowNumber, "미드", errors),
      defenseScore: parseScore(valueOf(row, "defense_score"), rowNumber, "수비", errors),
      activityScore: parseScore(valueOf(row, "activity_score"), rowNumber, "활동량", errors),
      canGk: parseBooleanYN(valueOf(row, "gk"), rowNumber, "키퍼", errors),
      memo: valueOf(row, "memo") || undefined,
    });
  });

  return { players, errors, warnings };
}
