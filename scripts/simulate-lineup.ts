import { balanceTeamsVariants } from "../src/lib/teamBalancer";
import { generateLineups } from "../src/lib/lineupGenerator";
import type { Player } from "../src/types/player";

function mkPlayer(
  id: string,
  name: string,
  primary: Player["primaryPosition"],
  scores: { att: number; mid: number; def: number; act: number },
  memberType: Player["memberType"] = "REGULAR",
): Player {
  return {
    id,
    source: "SHEET",
    memberType,
    active: true,
    name,
    primaryPosition: primary,
    secondaryPositions: [],
    attackScore: scores.att,
    midScore: scores.mid,
    defenseScore: scores.def,
    activityScore: scores.act,
    canGk: true,
  };
}

const pool24: Player[] = [
  mkPlayer("p01", "이영웅", "CF", { att: 9, mid: 6, def: 5, act: 6 }),
  mkPlayer("p02", "전병철", "CF", { att: 6, mid: 5, def: 6, act: 6 }),
  mkPlayer("p03", "황인상", "RB", { att: 5, mid: 3, def: 6, act: 5 }),
  mkPlayer("p04", "방인철", "CF", { att: 8, mid: 4, def: 7, act: 7 }),
  mkPlayer("p05", "허승", "CF", { att: 7, mid: 5, def: 7, act: 7 }),
  mkPlayer("p06", "한관진", "CF", { att: 5, mid: 4, def: 4, act: 2 }),
  mkPlayer("p07", "송준석", "RB", { att: 1, mid: 1, def: 2, act: 2 }),
  mkPlayer("p08", "방정현", "RB", { att: 1, mid: 1, def: 2, act: 2 }),
  mkPlayer("p09", "정창영", "MF", { att: 6, mid: 9, def: 7, act: 7 }),
  mkPlayer("p10", "박성진", "MF", { att: 6, mid: 7, def: 8, act: 9 }),
  mkPlayer("p11", "김지훈", "MF", { att: 8, mid: 6, def: 10, act: 9 }),
  mkPlayer("p12", "조재형", "MF", { att: 7, mid: 8, def: 8, act: 9 }),
  mkPlayer("p13", "문경원", "LB", { att: 6, mid: 6, def: 8, act: 8 }),
  mkPlayer("p14", "유지웅", "MF", { att: 5, mid: 7, def: 5, act: 7 }),
  mkPlayer("p15", "임세랑", "MF", { att: 5, mid: 7, def: 7, act: 7 }),
  mkPlayer("p16", "최경희", "MF", { att: 5, mid: 6, def: 5, act: 7 }),
  mkPlayer("p17", "채운정", "RW", { att: 6, mid: 6, def: 6, act: 8 }),
  mkPlayer("p18", "이은총", "RB", { att: 6, mid: 1, def: 4, act: 4 }),
  mkPlayer("p19", "신연준", "RB", { att: 6, mid: 5, def: 9, act: 10 }),
  mkPlayer("p20", "하성주", "CF", { att: 9, mid: 6, def: 8, act: 7 }),
  mkPlayer("p21", "홍재현", "CB", { att: 6, mid: 1, def: 9, act: 7 }),
  mkPlayer("p22", "박준호", "RB", { att: 5, mid: 3, def: 8, act: 8 }),
  mkPlayer("p23", "정진윤", "RB", { att: 5, mid: 5, def: 7, act: 8 }),
  mkPlayer("p24", "한국일", "RB", { att: 1, mid: 1, def: 2, act: 2 }),
];

const extras: Player[] = [
  mkPlayer("p25", "예비1", "MF", { att: 5, mid: 5, def: 5, act: 5 }),
  mkPlayer("p26", "예비2", "MF", { att: 4, mid: 6, def: 5, act: 5 }),
  mkPlayer("p27", "대기A", "CF", { att: 4, mid: 4, def: 4, act: 4 }, "WAITING"),
];

function runScenario(label: string, players: Player[], waiting: Player[] = []) {
  console.log(`\n████ ${label} (필드 ${players.length}명${waiting.length ? ` + 대기 ${waiting.length}` : ""}) ████`);
  const variants = balanceTeamsVariants(players, 1);
  const result = variants[0];
  const lineup = generateLineups(result.teamA, result.teamB, [], waiting);

  let issuesFound = 0;
  const teams = [result.teamA, result.teamB];
  for (const team of teams) {
    const counts = new Map<string, { name: string; field: number; gk: number; bench: number; composite: number; group: string }>();
    for (const p of team.players) {
      counts.set(p.name, {
        name: p.name,
        field: 0,
        gk: 0,
        bench: 0,
        composite: p.attackScore + p.midScore + p.defenseScore + p.activityScore,
        group: p.assignedGroup,
      });
    }
    for (const w of waiting) {
      counts.set(w.name, {
        name: w.name,
        field: 0,
        gk: 0,
        bench: 0,
        composite: w.attackScore + w.midScore + w.defenseScore + w.activityScore,
        group: "WAITING",
      });
    }

    const teamQuarters = lineup.quarters.filter((q) => q.team === team.name);
    for (const q of teamQuarters) {
      [...q.attack, ...q.mid, ...q.defense].forEach((n) => {
        const c = counts.get(n);
        if (c) c.field += 1;
      });
      if (q.gk && q.gk !== "없음") {
        const c = counts.get(q.gk);
        if (c) c.gk += 1;
      }
      q.bench.forEach((n) => {
        const c = counts.get(n);
        if (c) c.bench += 1;
      });
    }

    const sorted = Array.from(counts.values()).sort((a, b) => b.composite - a.composite);
    console.log(`\n${team.name}팀 (인원 ${team.players.length}, 종합점수 1위 = ${sorted[0].name})`);
    console.log("  점수 | 그룹  | 선수    | F  GK B");
    for (const c of sorted) {
      const flag = c.field === 4 ? " *4Q" : c.field <= 1 ? " ⚠" : c.field === 2 ? " ⚠" : "";
      const isWaitingPlayer = c.group === "WAITING";
      const expected = isWaitingPlayer ? 1 : 3;
      const ok = isWaitingPlayer ? c.field === 1 : c.field === 3 || c.field === 4;
      if (!ok) issuesFound += 1;
      console.log(`   ${c.composite.toString().padStart(2)} | ${c.group.padEnd(5)} | ${c.name.padEnd(7)} | ${c.field}  ${c.gk}  ${c.bench}${flag} ${ok ? "" : `❌ (목표 ${expected})`}`);
    }

    const fourQ = sorted.filter((c) => c.group !== "WAITING" && c.field === 4).length;
    const lowField = sorted.filter((c) => c.group !== "WAITING" && c.field <= 2).length;
    console.log(`  → 4Q ${fourQ}명, 2Q이하 ${lowField}명`);
  }
  if (issuesFound === 0) console.log("✅ 시나리오 통과");
  else console.log(`❌ ${issuesFound}개 문제`);
  return issuesFound;
}

let totalIssues = 0;

// 시나리오 1: 24명 자체전 (12+12)
totalIssues += runScenario("24명 자체전", pool24);

// 시나리오 2: 26명 자체전 (13+13)
totalIssues += runScenario("26명 자체전", [...pool24, ...extras.slice(0, 2)]);

// 시나리오 3: 27명 자체전 + 대기 (13+13+1)
totalIssues += runScenario("26명 + 대기 1명", [...pool24, ...extras.slice(0, 2)], [extras[2]]);

// 시나리오 4: 22명 (11+11)
totalIssues += runScenario("22명 (11+11)", pool24.slice(0, 22));

console.log(`\n${totalIssues === 0 ? "🎉 모든 시나리오 통과" : `⚠ 총 ${totalIssues}개 문제`}`);
