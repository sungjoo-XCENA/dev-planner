import type { Quarter, TeamQuarterLineup } from "@/types/lineup";
import type { TeamName } from "@/types/team";

export type MatchRecordEvent = {
  id: string;
  quarter: Quarter;
  team: TeamName;
  scorer: string;
  assist?: string;
};

export type MatchRecordSaveRequest = {
  matchId: string;
  matchDate: string;
  matchTime?: string;
  memo?: string;
  quarters: TeamQuarterLineup[];
  events: MatchRecordEvent[];
  overwriteExisting?: boolean;
  dryRun?: boolean;
};

export type MatchRecordSaveResponse = {
  ok: boolean;
  matchId: string;
  path: string;
  dryRun: boolean;
  existing: boolean;
  homeGoal: number;
  awayGoal: number;
  plannerEventCount: number;
  message: string;
  payload?: unknown;
};

export type MatchRecordLoadResponse = {
  ok: true;
  matchId: string;
  path: string;
  matchDate?: string;
  matchTime?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeGoal?: number;
  awayGoal?: number;
  comment?: string;
  hasPlannerQuarterInfo: boolean;
  events: MatchRecordEvent[];
};

export type MatchRecordConflictResponse = {
  error: "MATCH_EXISTS";
  matchId: string;
  path: string;
  detail: string;
  existingSummary: {
    matchDate?: string;
    homeTeamName?: string;
    awayTeamName?: string;
    homeGoal?: number;
    awayGoal?: number;
    hasPlannerQuarterInfo: boolean;
  };
};
