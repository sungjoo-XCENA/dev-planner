import type { MemberType, Player } from "@/types/player";
import { parseSecondaryPositions, toPosition } from "./positions";

export type LoadPlayersResult = {
  players: Player[];
  errors: string[];
  warnings: string[];
};

const REQUIRED_COLUMNS = [
  "active",
  "member_type",
  "name",
  "primary_position",
  "attack_score",
  "mid_score",
  "defense_score",
  "activity_score",
  "gk",
];

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
  if (normalized === "Y") return true;
  if (normalized === "N") return false;
  errors.push(`${rowNumber}행 ${column}은 Y 또는 N이어야 합니다.`);
  return false;
}

function parseMemberType(value: string, rowNumber: number, errors: string[]): MemberType {
  const normalized = value.trim().toUpperCase();
  if (normalized === "REGULAR" || normalized === "GUEST") return normalized;
  errors.push(`${rowNumber}행 member_type은 REGULAR 또는 GUEST여야 합니다.`);
  return "REGULAR";
}

export async function loadPlayersFromCsv(url: string): Promise<LoadPlayersResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let text = "";
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    text = await response.text();
  } catch (error) {
    return {
      players: [],
      errors: [`CSV 데이터를 불러오지 못했습니다. 시트 공유 설정 또는 CSV URL을 확인해주세요. (${String(error)})`],
      warnings,
    };
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { players: [], errors: ["CSV에 헤더와 선수 데이터가 필요합니다."], warnings };
  }

  const headers = rows[0].map((header) => header.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    errors.push(`필수 컬럼이 누락되었습니다: ${missing.join(", ")}`);
  }

  const indexOf = (column: string) => headers.indexOf(column);
  const valueOf = (row: string[], column: string) => {
    const index = indexOf(column);
    return index >= 0 ? row[index]?.trim() ?? "" : "";
  };

  const players: Player[] = [];

  rows.slice(1).forEach((row, idx) => {
    const rowNumber = idx + 2;
    const active = parseBooleanYN(valueOf(row, "active") || "Y", rowNumber, "active", errors);
    if (!active) return;

    const name = valueOf(row, "name");
    if (!name) {
      errors.push(`${rowNumber}행 name은 필수입니다.`);
      return;
    }

    const primary = toPosition(valueOf(row, "primary_position"));
    if (!primary) {
      errors.push(`${rowNumber}행 primary_position이 허용되지 않은 포지션입니다: ${valueOf(row, "primary_position")}`);
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
      memberType: parseMemberType(valueOf(row, "member_type"), rowNumber, errors),
      active,
      name,
      primaryPosition: primary,
      secondaryPositions,
      attackScore: parseScore(valueOf(row, "attack_score"), rowNumber, "attack_score", errors),
      midScore: parseScore(valueOf(row, "mid_score"), rowNumber, "mid_score", errors),
      defenseScore: parseScore(valueOf(row, "defense_score"), rowNumber, "defense_score", errors),
      activityScore: parseScore(valueOf(row, "activity_score"), rowNumber, "activity_score", errors),
      canGk: parseBooleanYN(valueOf(row, "gk"), rowNumber, "gk", errors),
      memo: valueOf(row, "memo") || undefined,
    });
  });

  return { players, errors, warnings };
}
