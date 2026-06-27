import type { Quarter, TeamQuarterLineup } from "@/types/lineup";
import type { StaffRole } from "@/types/player";
import type { TeamName } from "@/types/team";

export type MatchRecordKind = "SELF" | "MATCH";
export type MatchRecordMode = "SUMMARY" | "QUARTER";

export type MatchRecordEvent = {
  id: string;
  quarter: Quarter;
  team: TeamName;
  scorer: string;
  assist?: string;
};

export type MatchRecordPlayerStat = {
  team: TeamName;
  player: string;
  goals: number;
  assists: number;
  quarter?: Quarter;
};

export type MatchRecordTeamScore = {
  team: TeamName;
  goals: number;
  quarter?: Quarter;
};

export type MatchRecordGuestPlayer = {
  team: TeamName;
  name: string;
  role?: string;
  quarter?: Quarter;
};

export type MatchRecordSaveRequest = {
  matchId: string;
  matchDate: string;
  matchTime?: string;
  matchKind?: MatchRecordKind;
  recordMode?: MatchRecordMode;
  venueName?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  memo?: string;
  quarters: TeamQuarterLineup[];
  lineupQuarters?: TeamQuarterLineup[];
  events: MatchRecordEvent[];
  summaryStats?: MatchRecordPlayerStat[];
  guestStats?: MatchRecordPlayerStat[];
  guestPlayers?: MatchRecordGuestPlayer[];
  teamScores?: MatchRecordTeamScore[];
  scoreOverride?: Partial<Record<TeamName, number>>;
  staffRoles?: Partial<Record<string, StaffRole>>;
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
  matchKind?: MatchRecordKind;
  venueName?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeGoal?: number;
  awayGoal?: number;
  comment?: string;
  hasPlannerQuarterInfo: boolean;
  events: MatchRecordEvent[];
  summaryStats?: MatchRecordPlayerStat[];
  guestStats?: MatchRecordPlayerStat[];
  guestPlayers?: MatchRecordGuestPlayer[];
  teamScores?: MatchRecordTeamScore[];
  players?: Partial<Record<TeamName, string[]>>;
  staffRoles?: Partial<Record<string, StaffRole>>;
  scoreOverride?: Partial<Record<TeamName, number>>;
  recordMode?: MatchRecordMode;
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
