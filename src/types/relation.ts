export type RelationScore = 1 | 2 | 3;

export type PlayerRelation = {
  playerAId: string;
  playerBId: string;
  playerAName: string;
  playerBName: string;
  score: Exclude<RelationScore, 3>;
};

export type TeamRelationViolation = {
  playerAName: string;
  playerBName: string;
  score: Exclude<RelationScore, 3>;
  team: "A" | "B";
  penalty: number;
};
