import type { TeamName } from "@/types/team";

export const TEAM_DISPLAY_NAMES: Record<TeamName, string> = {
  A: "형광",
  B: "주황",
};

export function formatTeamName(team: TeamName): string {
  return `${TEAM_DISPLAY_NAMES[team]}팀`;
}
