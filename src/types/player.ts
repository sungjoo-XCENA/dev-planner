export type FieldPosition =
  | "CF"
  | "LW"
  | "RW"
  | "MF"
  | "LB"
  | "RB"
  | "CB";

export type Position = FieldPosition | "GK";

export type PositionGroup = "ATTACK" | "MID" | "DEFENSE";
export type AssignedSubRole = "CF" | "WING" | "MID" | "CB" | "WB";

export type PlayerSource = "SHEET" | "TEMP_GUEST" | "LOCAL_GUEST";

export type MemberType = "REGULAR" | "GUEST" | "WAITING";

export type StaffRole = "단장" | "감독" | "코치";

export type InjuryLevel = 0 | 1 | 2 | 3;

export type Player = {
  id: string;
  source: PlayerSource;
  memberType: MemberType;
  active: boolean;
  name: string;
  primaryPosition: Position;
  secondaryPositions: FieldPosition[];
  centerForwardScore: number;
  wingScore: number;
  attackScore: number;
  midScore: number;
  centerBackScore: number;
  wingBackScore: number;
  defenseScore: number;
  activityScore: number;
  injuryLevel?: InjuryLevel;
  canGk: boolean;
  memo?: string;
};

export type DedicatedGoalkeeper = {
  id: string;
  source: "SHEET" | "TEMP_GK" | "LOCAL_GK";
  name: string;
  memo?: string;
};

export type AssignedPlayer = Player & {
  assignedGroup: PositionGroup;
  assignedSubRole?: AssignedSubRole;
  assignmentReason: string;
  isPositionOverride: boolean;
  balancePairKey?: string;
  balancePairOrder?: number;
  balancePairPartnerName?: string;
  balancePairGroup?: PositionGroup;
};
