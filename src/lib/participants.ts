import type { DedicatedGoalkeeper, Player } from "@/types/player";

export function hasDuplicateName(players: Player[], name: string): boolean {
  return players.some((player) => player.name.trim() === name.trim());
}

export function isInFieldParticipants(fieldPlayerIds: string[], id: string): boolean {
  return fieldPlayerIds.includes(id);
}

export function isInDedicatedGoalkeepers(goalkeepers: DedicatedGoalkeeper[], id: string): boolean {
  return goalkeepers.some((goalkeeper) => goalkeeper.id === id);
}

export function validateParticipantState(
  fieldPlayerIds: string[],
  dedicatedGoalkeepers: DedicatedGoalkeeper[],
): string[] {
  const errors: string[] = [];
  if (fieldPlayerIds.length !== 26) {
    errors.push(`필드 참석자는 정확히 26명이어야 합니다. 현재 ${fieldPlayerIds.length}명입니다.`);
  }
  const duplicated = dedicatedGoalkeepers.filter((goalkeeper) => fieldPlayerIds.includes(goalkeeper.id));
  if (duplicated.length > 0) {
    errors.push(`필드 참석자와 전담 GK에 동시에 포함된 사람이 있습니다: ${duplicated.map((item) => item.name).join(", ")}`);
  }
  return errors;
}
