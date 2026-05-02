import type { PositionGroup, StaffRole } from "./player";
import type { TeamName } from "./team";

export type Quarter = 1 | 2 | 3 | 4;
export type LineupRole = "FIELD" | "GK" | "BENCH";

export type LineupSlot = {
  quarter: Quarter;
  team: TeamName;
  playerId: string;
  playerName: string;
  assignedGroup?: PositionGroup;
  role: LineupRole;
  isDedicatedGk?: boolean;
};

export type TeamQuarterLineup = {
  quarter: Quarter;
  team: TeamName;
  attack: string[];
  mid: string[];
  defense: string[];
  gk: string;
  bench: string[];
  warnings: string[];
};

export type PlayerLineupSummary = {
  playerId: string;
  playerName: string;
  staffRole?: StaffRole;
  team: TeamName;
  assignedGroup: PositionGroup;
  q1: LineupRole;
  q2: LineupRole;
  q3: LineupRole;
  q4: LineupRole;
  fieldCount: number;
  gkCount: number;
  benchCount: number;
};

export type LineupResult = {
  quarters: TeamQuarterLineup[];
  playerSummaries: PlayerLineupSummary[];
  staffRoles?: Record<string, StaffRole>;
  dedicatedGkRotation: Record<string, string[]>;
  warnings: string[];
};
