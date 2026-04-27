import type { AssignedPlayer } from "./player";

export type TeamName = "A" | "B";

export type Team = {
  name: TeamName;
  players: AssignedPlayer[];
};

export type TeamBalanceSummary = {
  attackScoreA: number;
  attackScoreB: number;
  midScoreA: number;
  midScoreB: number;
  defenseScoreA: number;
  defenseScoreB: number;
  activityA: number;
  activityB: number;
  fieldGkA: number;
  fieldGkB: number;
  regularA: number;
  regularB: number;
  guestA: number;
  guestB: number;
  balanceScore: number;
};

export type TeamBalanceResult = {
  teamA: Team;
  teamB: Team;
  summary: TeamBalanceSummary;
  warnings: string[];
  quality: "좋음" | "주의" | "나쁨";
};
