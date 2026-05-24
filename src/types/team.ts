import type { AssignedPlayer } from "./player";
import type { TeamRelationViolation } from "./relation";

export type TeamName = "A" | "B";

export type Team = {
  name: TeamName;
  players: AssignedPlayer[];
};

export type TeamBalanceSummary = {
  centerForwardScoreA: number;
  centerForwardScoreB: number;
  wingScoreA: number;
  wingScoreB: number;
  attackScoreA: number;
  attackScoreB: number;
  midScoreA: number;
  midScoreB: number;
  centerBackScoreA: number;
  centerBackScoreB: number;
  wingBackScoreA: number;
  wingBackScoreB: number;
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
  coachA: number;
  coachB: number;
  multiPositionA: number;
  multiPositionB: number;
  relationPenalty: number;
  relationViolationCount: number;
  relationHardViolationCount: number;
  balanceScore: number;
};

export type TeamBalanceResult = {
  teamA: Team;
  teamB: Team;
  summary: TeamBalanceSummary;
  relationViolations: TeamRelationViolation[];
  warnings: string[];
  quality: "좋음" | "주의" | "나쁨";
};
