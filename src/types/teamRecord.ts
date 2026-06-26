import type { MemberType, Position, PositionGroup, StaffRole } from "./player";
import type { TeamQuarterLineup } from "./lineup";
import type { TeamName } from "./team";

export type TeamRecordPlayer = {
  id: string;
  name: string;
  memberType: MemberType;
  primaryPosition: Position;
  assignedGroup: PositionGroup;
  assignmentReason: string;
  isPositionOverride: boolean;
  staffRole?: StaffRole;
};

export type TeamRecordGroups = {
  attack: TeamRecordPlayer[];
  mid: TeamRecordPlayer[];
  defense: TeamRecordPlayer[];
};

export type TeamRecord = {
  date: string;
  teams: Record<TeamName, TeamRecordGroups>;
  lineup?: {
    savedAt: string;
    quarters: TeamQuarterLineup[];
  };
  shareUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamRecordSummary = {
  date: string;
  shareUrl: string;
  updatedAt: string;
  teamAPlayers: number;
  teamBPlayers: number;
  hasLineup: boolean;
};
