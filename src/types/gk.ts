import type { DedicatedGoalkeeper } from "./player";
import type { Quarter } from "./lineup";
import type { TeamName } from "./team";

export type DedicatedGkAssignment = {
  goalkeeper: DedicatedGoalkeeper;
  quarter: Quarter;
  team: TeamName;
};
