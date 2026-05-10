export type HistorySource = "firebase" | "cache";

export type HistoryPairLabel = "good" | "caution" | "sample";

export type HistoryPairInsight = {
  players: [string, string];
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  avgGoalDiff: number;
  points: number;
  label: HistoryPairLabel;
};

export type HistoryPlayerTrend = "hot" | "steady" | "caution" | "sample";

export type HistoryPlayerForm = {
  name: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  assists: number;
  points: number;
  goalsAgainst: number;
  cleanSheets: number;
  avgGoalsAgainst: number;
  avgGoalDiff: number;
  trend: HistoryPlayerTrend;
};

export type HistoryDefenseForm = {
  name: string;
  matches: number;
  cleanSheets: number;
  goalsAgainst: number;
  avgGoalsAgainst: number;
  avgGoalDiff: number;
  trend: HistoryPlayerTrend;
};

export type TeamHistoryInsight = {
  team: "A" | "B";
  playerCount: number;
  matchedPlayerCount: number;
  coPlaySamples: number;
  avgGoalDiff: number;
  cleanSheets: number;
  goalsAgainst: number;
  avgGoalsAgainst: number;
  goodPairs: HistoryPairInsight[];
  cautionPairs: HistoryPairInsight[];
  samplePairs: HistoryPairInsight[];
  recentForms: HistoryPlayerForm[];
  defenseForms: HistoryDefenseForm[];
  unmatchedNames: string[];
  summary: string[];
};

export type HistoryInsightResponse = {
  key: string;
  seasons: number[];
  source: HistorySource;
  matchCount: number;
  generatedAt: string;
  teamA: TeamHistoryInsight;
  teamB: TeamHistoryInsight;
  warnings: string[];
};

export type HistoryInsightRequest = {
  teamA: string[];
  teamB: string[];
  years?: number[];
};
