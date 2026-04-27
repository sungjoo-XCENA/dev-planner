import type { DedicatedGoalkeeper, MemberType, Player } from "@/types/player";
import { parseSecondaryPositions, toPosition } from "./positions";

export type LoadPlayersResult = {
  players: Player[];
  dedicatedGks: DedicatedGoalkeeper[];
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
type ScoreColumn = "attack_score" | "mid_score" | "defense_score" | "activity_score";

const REQUIRED_COLUMNS: CanonicalColumn[] = [
  "active",
  "name",
  "primary_position",
  "attack_score",
  "mid_score",
  "defense_score",
  "activity_score",
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

function parseScore(value: string, playerName: string, column: string, errors: string[]): number | null {
  const raw = value.trim();
  if (!raw) return null;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    errors.push(`${playerName}: ${column} 점수는 1~10 숫자여야 합니다.`);
    return null;
  }
  return parsed;
}

const SCORE_COLUMNS: Array<{ key: ScoreColumn; label: string }> = [
  { key: "attack_score", label: "공격" },
  { key: "mid_score", label: "미드" },
  { key: "defense_score", label: "수비" },
  { key: "activity_score", label: "활동량" },
];

function parseBooleanYN(value: string): boolean | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (["Y", "YES", "O", "TRUE", "가능", "예", "1"].includes(normalized)) return true;
  if (["N", "NO", "X", "FALSE", "불가", "아니오", "0"].includes(normalized)) return false;
  return null;
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

function isDedicatedGkPosition(value: string): boolean {
  return value.trim().toUpperCase() === "GK";
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
      let detail = "";
      try {
        const body = await response.json();
        if (body?.upstreamStatus) {
          detail = ` (Google 응답: ${body.upstreamStatus}${body.upstreamStatusText ? ` ${body.upstreamStatusText}` : ""})`;
        } else if (body?.error) {
          detail = ` (${body.error})`;
        }
      } catch {
        // ignore json parse errors
      }
      throw new Error(`HTTP ${response.status}${detail}`);
    }
    text = await response.text();
  } catch (error) {
    return {
      players: [],
      dedicatedGks: [],
      errors: [`시트 데이터를 불러오지 못했습니다. 공유 설정 또는 URL을 확인해주세요. (${String(error)})`],
      warnings,
    };
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { players: [], dedicatedGks: [], errors: ["시트에 헤더 1행과 선수 데이터가 필요합니다."], warnings };
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
  const dedicatedGks: DedicatedGoalkeeper[] = [];

  rows.slice(1).forEach((row, idx) => {
    const rowNumber = idx + 2;
    const active = parseActive(valueOf(row, "active"));
    if (!active) return;

    const name = valueOf(row, "name");
    if (!name) {
      errors.push(`${rowNumber}행 이름은 필수입니다.`);
      return;
    }

    const primaryValue = valueOf(row, "primary_position");
    const isSheetGk = isDedicatedGkPosition(primaryValue);
    const primary = isSheetGk ? "GK" : toPosition(primaryValue);
    if (!primary) {
      errors.push(`${rowNumber}행 주포지션이 허용되지 않은 포지션입니다: ${primaryValue}`);
      return;
    }

    const rawSecondary = valueOf(row, "secondary_positions");
    const secondaryPositions = isSheetGk ? [] : parseSecondaryPositions(rawSecondary);
    const secondaryTokens = rawSecondary.trim() && rawSecondary.trim() !== "-"
      ? rawSecondary.split(",").map((v) => v.trim()).filter(Boolean)
      : [];
    if (!isSheetGk && secondaryPositions.length !== secondaryTokens.length) {
      warnings.push(`${rowNumber}행 ${name}의 부포지션 중 일부가 무시되었습니다. 허용값을 확인해주세요.`);
    }

    const oldGkValue = valueOf(row, "gk");
    const oldGkParsed = parseBooleanYN(oldGkValue);

    const missingScoreLabels = SCORE_COLUMNS
      .filter(({ key }) => !valueOf(row, key).trim())
      .map(({ label }) => label);
    if (missingScoreLabels.length > 0) {
      errors.push(`${name}: ${missingScoreLabels.join(", ")} 점수가 비어있습니다.`);
      return;
    }

    const attackScore = parseScore(valueOf(row, "attack_score"), name, "공격", errors);
    const midScore = parseScore(valueOf(row, "mid_score"), name, "미드", errors);
    const defenseScore = parseScore(valueOf(row, "defense_score"), name, "수비", errors);
    const activityScore = parseScore(valueOf(row, "activity_score"), name, "활동량", errors);

    if (attackScore === null || midScore === null || defenseScore === null || activityScore === null) return;

    players.push({
      id: isSheetGk ? `sheet_gk_${rowNumber}_${name}` : `sheet_${rowNumber}_${name}`,
      source: "SHEET",
      memberType: parseMemberType(valueOf(row, "member_type")),
      active,
      name,
      primaryPosition: primary,
      secondaryPositions,
      attackScore,
      midScore,
      defenseScore,
      activityScore,
      canGk: oldGkParsed ?? true,
      memo: valueOf(row, "memo") || undefined,
    });
  });

  return { players, dedicatedGks, errors, warnings };
}
