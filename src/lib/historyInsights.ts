import type {
  HistoryDefenseForm,
  HistoryInsightResponse,
  HistoryPairInsight,
  HistoryPairLabel,
  HistoryPlayerForm,
  HistoryPlayerTrend,
  HistorySource,
  TeamHistoryInsight,
} from "@/types/history";

type UnknownRecord = Record<string, unknown>;

type HistoricalMatch = {
  id: string;
  dateKey: number;
  homeGoal: number;
  awayGoal: number;
  homePlayers: string[];
  awayPlayers: string[];
  homeGoalsByPlayer: Map<string, number>;
  awayGoalsByPlayer: Map<string, number>;
  homeAssistsByPlayer: Map<string, number>;
  awayAssistsByPlayer: Map<string, number>;
};

type MatchSide = "home" | "away";

type PairAccumulator = {
  players: [string, string];
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
};

type TeamAnalysisInput = {
  team: "A" | "B" | "ALL";
  players: string[];
  matches: HistoricalMatch[];
};

const PAIR_CONFIDENCE_MATCHES = 8;

function pairConfidenceGoalDiff(pair: HistoryPairInsight): number {
  return pair.avgGoalDiff * (pair.matches / (pair.matches + PAIR_CONFIDENCE_MATCHES));
}

export function normalizeHistoryName(value: string): string {
  return value.replace(/\s+/g, "").replace(/[＊*]/g, "").trim();
}

export function makeHistoryInsightKey(teamA: string[], teamB: string[], years: number[]): string {
  const namesKey = (names: string[]) => names.map(normalizeHistoryName).filter(Boolean).sort().join(",");
  return `A:${namesKey(teamA)}|B:${namesKey(teamB)}|Y:${years.slice().sort().join(",")}`;
}

export function parseFirebaseMatches(raw: unknown, years: number[]): HistoricalMatch[] {
  const root = asRecord(raw);
  if (!root) return [];

  const yearSet = new Set(years);
  const matches = Object.keys(root)
    .map((id) => parseFirebaseMatch(id, root[id], yearSet))
    .filter((match): match is HistoricalMatch => Boolean(match))
    .sort((a, b) => a.dateKey - b.dateKey);

  return matches;
}

export function buildHistoryInsightResponse({
  teamA,
  teamB,
  matches,
  years,
  source,
  warnings,
}: {
  teamA: string[];
  teamB: string[];
  matches: HistoricalMatch[];
  years: number[];
  source: HistorySource;
  warnings?: string[];
}): HistoryInsightResponse {
  const sortedYears = years.slice().sort();
  const extraWarnings = [...(warnings ?? [])];

  if (matches.length === 0) {
    extraWarnings.push("2025~2026 히스토리 경기 표본을 찾지 못했습니다.");
  }

  return {
    key: makeHistoryInsightKey(teamA, teamB, sortedYears),
    seasons: sortedYears,
    source,
    matchCount: matches.length,
    generatedAt: new Date().toISOString(),
    overall: analyzeTeamHistory({ team: "ALL", players: uniqueHistoryDisplayNames([...teamA, ...teamB]), matches }),
    teamA: analyzeTeamHistory({ team: "A", players: teamA, matches }),
    teamB: analyzeTeamHistory({ team: "B", players: teamB, matches }),
    warnings: extraWarnings,
  };
}

function parseFirebaseMatch(id: string, value: unknown, yearSet: Set<number>): HistoricalMatch | null {
  const record = asRecord(value);
  if (!record) return null;

  const year = parseYear(record.MatchDate, id);
  if (!year || !yearSet.has(year)) return null;

  const homePlayers = normalizeNameList(namesFromFirebaseList(record.HomePlayerInfo));
  const awayPlayers = normalizeNameList(namesFromFirebaseList(record.AwayPlayerInfo));
  if (homePlayers.length === 0 && awayPlayers.length === 0) return null;

  return {
    id,
    dateKey: parseDateKey(record.MatchDate, id),
    homeGoal: numberFrom(record.HomeGoal),
    awayGoal: numberFrom(record.AwayGoal),
    homePlayers,
    awayPlayers,
    homeGoalsByPlayer: countEvents(record.HomeGoalInfo),
    awayGoalsByPlayer: countEvents(record.AwayGoalInfo),
    homeAssistsByPlayer: countEvents(record.HomeAssistInfo),
    awayAssistsByPlayer: countEvents(record.AwayAssistInfo),
  };
}

function analyzeTeamHistory({ team, players, matches }: TeamAnalysisInput): TeamHistoryInsight {
  const displayByName = new Map<string, string>();
  const normalizedPlayers = normalizeNameList(players);
  normalizedPlayers.forEach((name, index) => {
    displayByName.set(name, players[index] ?? name);
  });

  const seenNames = collectSeenNames(matches);
  const matchedPlayerCount = normalizedPlayers.filter((name) => seenNames.has(name)).length;
  const unmatchedNames = normalizedPlayers
    .filter((name) => !seenNames.has(name))
    .map((name) => displayByName.get(name) ?? name);

  const pairInsights = buildPairInsights(normalizedPlayers, displayByName, matches);
  const goodPairs = pairInsights
    .filter((pair) => pair.label === "good")
    .sort((a, b) => pairConfidenceGoalDiff(b) - pairConfidenceGoalDiff(a) || b.avgGoalDiff - a.avgGoalDiff || b.matches - a.matches || b.points - a.points);
  const cautionPairs = pairInsights
    .filter((pair) => pair.label === "caution")
    .sort((a, b) => pairConfidenceGoalDiff(a) - pairConfidenceGoalDiff(b) || a.avgGoalDiff - b.avgGoalDiff || b.matches - a.matches || a.points - b.points);
  const samplePairs = pairInsights
    .filter((pair) => pair.label === "sample")
    .sort((a, b) => b.matches - a.matches || Math.abs(b.avgGoalDiff) - Math.abs(a.avgGoalDiff));

  const coPlaySamples = pairInsights.reduce((sum, pair) => sum + pair.matches, 0);
  const goalDiffSum = pairInsights.reduce((sum, pair) => sum + pair.goalDiff, 0);
  const avgGoalDiff = coPlaySamples > 0 ? roundOne(goalDiffSum / coPlaySamples) : 0;
  const recentForms = buildRecentForms(normalizedPlayers, displayByName, matches);
  const defenseForms = buildDefenseForms(normalizedPlayers, displayByName, matches);
  const defenseSamples = defenseForms.reduce((sum, form) => sum + form.matches, 0);
  const cleanSheets = defenseForms.reduce((sum, form) => sum + form.cleanSheets, 0);
  const goalsAgainst = defenseForms.reduce((sum, form) => sum + form.goalsAgainst, 0);
  const avgGoalsAgainst = defenseSamples > 0 ? roundOne(goalsAgainst / defenseSamples) : 0;

  return {
    team,
    playerCount: normalizedPlayers.length,
    matchedPlayerCount,
    coPlaySamples,
    avgGoalDiff,
    cleanSheets,
    goalsAgainst,
    avgGoalsAgainst,
    goodPairs,
    cautionPairs,
    samplePairs,
    recentForms,
    defenseForms,
    unmatchedNames,
    summary: buildSummary({
      matchedPlayerCount,
      playerCount: normalizedPlayers.length,
      coPlaySamples,
      avgGoalDiff,
      cleanSheets,
      avgGoalsAgainst,
      goodPairs,
      cautionPairs,
      recentForms,
      defenseForms,
    }),
  };
}

function buildPairInsights(
  normalizedPlayers: string[],
  displayByName: Map<string, string>,
  matches: HistoricalMatch[],
): HistoryPairInsight[] {
  const pairs: PairAccumulator[] = [];

  for (let i = 0; i < normalizedPlayers.length; i += 1) {
    for (let j = i + 1; j < normalizedPlayers.length; j += 1) {
      pairs.push({
        players: [displayByName.get(normalizedPlayers[i]) ?? normalizedPlayers[i], displayByName.get(normalizedPlayers[j]) ?? normalizedPlayers[j]],
        matches: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDiff: 0,
        points: 0,
      });
    }
  }

  pairs.forEach((pair) => {
    const a = normalizeHistoryName(pair.players[0]);
    const b = normalizeHistoryName(pair.players[1]);

    matches.forEach((match) => {
      const side = sameSide(match, a, b);
      if (!side) return;

      const sideStats = statsForSide(match, side);
      const diff = sideStats.goalsFor - sideStats.goalsAgainst;
      pair.matches += 1;
      pair.goalsFor += sideStats.goalsFor;
      pair.goalsAgainst += sideStats.goalsAgainst;
      pair.goalDiff += diff;
      pair.points += eventCount(sideStats.goalsByPlayer, a) + eventCount(sideStats.assistsByPlayer, a)
        + eventCount(sideStats.goalsByPlayer, b) + eventCount(sideStats.assistsByPlayer, b);

      if (diff > 0) pair.wins += 1;
      else if (diff < 0) pair.losses += 1;
      else pair.draws += 1;
    });
  });

  return pairs
    .filter((pair) => pair.matches > 0)
    .map((pair) => {
      const avgGoalDiff = roundOne(pair.goalDiff / pair.matches);
      return {
        ...pair,
        avgGoalDiff,
        label: labelPair(pair.matches, avgGoalDiff, pair.wins, pair.losses),
      };
    });
}

function buildRecentForms(
  normalizedPlayers: string[],
  displayByName: Map<string, string>,
  matches: HistoricalMatch[],
): HistoryPlayerForm[] {
  const recentMatches = matches.slice().sort((a, b) => b.dateKey - a.dateKey);

  return normalizedPlayers
    .map((name) => {
      const form: HistoryPlayerForm = {
        name: displayByName.get(name) ?? name,
        matches: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goals: 0,
        assists: 0,
        points: 0,
        goalsAgainst: 0,
        cleanSheets: 0,
        avgGoalsAgainst: 0,
        avgGoalDiff: 0,
        trend: "sample",
      };
      let goalDiffSum = 0;

      for (let i = 0; i < recentMatches.length && form.matches < 5; i += 1) {
        const match = recentMatches[i];
        const side = sideForPlayer(match, name);
        if (!side) continue;

        const sideStats = statsForSide(match, side);
        const diff = sideStats.goalsFor - sideStats.goalsAgainst;
        const goals = eventCount(sideStats.goalsByPlayer, name);
        const assists = eventCount(sideStats.assistsByPlayer, name);

        form.matches += 1;
        form.goals += goals;
        form.assists += assists;
        form.points += goals + assists;
        form.goalsAgainst += sideStats.goalsAgainst;
        if (sideStats.goalsAgainst === 0) form.cleanSheets += 1;
        goalDiffSum += diff;

        if (diff > 0) form.wins += 1;
        else if (diff < 0) form.losses += 1;
        else form.draws += 1;
      }

      form.avgGoalDiff = form.matches > 0 ? roundOne(goalDiffSum / form.matches) : 0;
      form.avgGoalsAgainst = form.matches > 0 ? roundOne(form.goalsAgainst / form.matches) : 0;
      form.trend = labelForm(form);
      return form;
    })
    .filter((form) => form.matches > 0)
    .sort((a, b) => b.points - a.points || b.avgGoalDiff - a.avgGoalDiff || b.matches - a.matches || a.name.localeCompare(b.name, "ko"));
}

function buildDefenseForms(
  normalizedPlayers: string[],
  displayByName: Map<string, string>,
  matches: HistoricalMatch[],
): HistoryDefenseForm[] {
  return normalizedPlayers
    .map((name) => {
      const form: HistoryDefenseForm = {
        name: displayByName.get(name) ?? name,
        matches: 0,
        cleanSheets: 0,
        goalsAgainst: 0,
        avgGoalsAgainst: 0,
        avgGoalDiff: 0,
        trend: "sample",
      };
      let goalDiffSum = 0;

      matches.forEach((match) => {
        const side = sideForPlayer(match, name);
        if (!side) return;

        const sideStats = statsForSide(match, side);
        form.matches += 1;
        form.goalsAgainst += sideStats.goalsAgainst;
        if (sideStats.goalsAgainst === 0) form.cleanSheets += 1;
        goalDiffSum += sideStats.goalsFor - sideStats.goalsAgainst;
      });

      form.avgGoalsAgainst = form.matches > 0 ? roundOne(form.goalsAgainst / form.matches) : 0;
      form.avgGoalDiff = form.matches > 0 ? roundOne(goalDiffSum / form.matches) : 0;
      form.trend = labelDefenseForm(form);
      return form;
    })
    .filter((form) => form.matches > 0)
    .sort((a, b) => b.cleanSheets - a.cleanSheets || a.avgGoalsAgainst - b.avgGoalsAgainst || b.matches - a.matches || b.avgGoalDiff - a.avgGoalDiff || a.name.localeCompare(b.name, "ko"));
}

function buildSummary({
  matchedPlayerCount,
  playerCount,
  coPlaySamples,
  avgGoalDiff,
  cleanSheets,
  avgGoalsAgainst,
  goodPairs,
  cautionPairs,
  recentForms,
  defenseForms,
}: {
  matchedPlayerCount: number;
  playerCount: number;
  coPlaySamples: number;
  avgGoalDiff: number;
  cleanSheets: number;
  avgGoalsAgainst: number;
  goodPairs: HistoryPairInsight[];
  cautionPairs: HistoryPairInsight[];
  recentForms: HistoryPlayerForm[];
  defenseForms: HistoryDefenseForm[];
}): string[] {
  const summary: string[] = [];

  if (coPlaySamples === 0) {
    summary.push("현재 팀 안에서 과거 같은 편 조합 표본이 아직 부족합니다.");
  } else {
    summary.push(`현재 팀 조합 표본 ${coPlaySamples}경기, 평균 득실 ${formatSigned(avgGoalDiff)}입니다.`);
  }

  summary.push(`히스토리에 매칭된 선수는 ${matchedPlayerCount}/${playerCount}명입니다.`);

  if (goodPairs.length > 0) {
    const pair = goodPairs[0];
    summary.push(`가장 좋은 조합은 ${pair.players[0]}-${pair.players[1]} (${pair.matches}경기, ${formatSigned(pair.avgGoalDiff)})입니다.`);
  }

  if (cautionPairs.length > 0) {
    const pair = cautionPairs[0];
    summary.push(`주의 조합은 ${pair.players[0]}-${pair.players[1]} (${pair.matches}경기, ${formatSigned(pair.avgGoalDiff)})입니다.`);
  }

  if (recentForms.length > 0) {
    const player = recentForms[0];
    summary.push(`최근 폼은 ${player.name}이 ${player.matches}경기 ${player.points}포인트로 가장 눈에 띕니다.`);
  }

  if (defenseForms.length > 0) {
    const player = defenseForms[0];
    summary.push(`수비 표본은 clean sheet ${cleanSheets}회, 선수별 평균 실점 ${avgGoalsAgainst}입니다.`);
    summary.push(`clean sheet가 많은 선수는 ${player.name} (${player.matches}경기 ${player.cleanSheets}회, 평균 실점 ${player.avgGoalsAgainst})입니다.`);
  }

  return summary;
}

function labelPair(matches: number, avgGoalDiff: number, wins: number, losses: number): HistoryPairLabel {
  if (matches < 2) return "sample";
  if (avgGoalDiff >= 0.5 || (wins > losses && avgGoalDiff > 0)) return "good";
  if (avgGoalDiff <= -0.5 || (losses > wins && avgGoalDiff < 0)) return "caution";
  return "sample";
}

function labelForm(form: HistoryPlayerForm): HistoryPlayerTrend {
  if (form.matches < 2) return "sample";
  if (form.points >= 2 || form.avgGoalDiff >= 0.5) return "hot";
  if (form.avgGoalDiff <= -0.5) return "caution";
  return "steady";
}

function labelDefenseForm(form: HistoryDefenseForm): HistoryPlayerTrend {
  if (form.matches < 2) return "sample";
  if (form.avgGoalsAgainst <= 1 || form.cleanSheets >= 2) return "hot";
  if (form.avgGoalsAgainst >= 3) return "caution";
  return "steady";
}

function sideForPlayer(match: HistoricalMatch, name: string): MatchSide | null {
  if (match.homePlayers.includes(name)) return "home";
  if (match.awayPlayers.includes(name)) return "away";
  return null;
}

function sameSide(match: HistoricalMatch, a: string, b: string): MatchSide | null {
  if (match.homePlayers.includes(a) && match.homePlayers.includes(b)) return "home";
  if (match.awayPlayers.includes(a) && match.awayPlayers.includes(b)) return "away";
  return null;
}

function statsForSide(match: HistoricalMatch, side: MatchSide) {
  if (side === "home") {
    return {
      goalsFor: match.homeGoal,
      goalsAgainst: match.awayGoal,
      goalsByPlayer: match.homeGoalsByPlayer,
      assistsByPlayer: match.homeAssistsByPlayer,
    };
  }

  return {
    goalsFor: match.awayGoal,
    goalsAgainst: match.homeGoal,
    goalsByPlayer: match.awayGoalsByPlayer,
    assistsByPlayer: match.awayAssistsByPlayer,
  };
}

function collectSeenNames(matches: HistoricalMatch[]): Set<string> {
  const seen = new Set<string>();
  matches.forEach((match) => {
    match.homePlayers.forEach((name) => seen.add(name));
    match.awayPlayers.forEach((name) => seen.add(name));
  });
  return seen;
}

function namesFromFirebaseList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(nameFromFirebaseItem).filter(Boolean);
  }

  const record = asRecord(value);
  if (!record) return [];

  return Object.keys(record)
    .map((key) => nameFromFirebaseItem(record[key]))
    .filter(Boolean);
}

function nameFromFirebaseItem(value: unknown): string {
  if (typeof value === "string") return value.trim();

  const record = asRecord(value);
  if (!record) return "";

  return stringFrom(record.Name ?? record.name ?? record.PlayerName ?? record.playerName).trim();
}

function uniqueHistoryDisplayNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  names.forEach((name) => {
    const trimmed = name.trim();
    const normalized = normalizeHistoryName(trimmed);
    if (!trimmed || !normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(trimmed);
  });

  return result;
}

function normalizeNameList(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  names.forEach((name) => {
    const normalized = normalizeHistoryName(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

function countEvents(value: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  namesFromFirebaseList(value).forEach((name) => {
    const normalized = normalizeHistoryName(name);
    if (!normalized) return;
    counts.set(normalized, eventCount(counts, normalized) + 1);
  });
  return counts;
}

function eventCount(counts: Map<string, number>, name: string): number {
  return counts.get(name) ?? 0;
}

function parseYear(value: unknown, fallback: string): number | null {
  const source = `${stringFrom(value)} ${fallback}`;
  const match = source.match(/(20\d{2})/);
  if (!match) return null;
  return Number(match[1]);
}

function parseDateKey(value: unknown, fallback: string): number {
  const source = stringFrom(value) || fallback;
  const digits = source.replace(/\D/g, "");
  if (digits.length >= 8) return Number(digits.slice(0, 8));
  if (digits.length >= 6) return Number(digits.slice(0, 6).padEnd(8, "0"));
  return Number(digits.padEnd(8, "0")) || 0;
}

function numberFrom(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(stringFrom(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringFrom(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}
