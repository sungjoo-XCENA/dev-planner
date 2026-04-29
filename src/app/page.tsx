"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { DedicatedGoalkeeper, FieldPosition, Player, PositionGroup } from "@/types/player";
import type { LineupResult, LineupRole } from "@/types/lineup";
import type { TeamBalanceResult } from "@/types/team";
import { appConfig } from "@/config/appConfig";
import { loadPlayersFromCsv } from "@/lib/loadPlayersFromCsv";
import { POSITIONS } from "@/lib/positions";
import { balanceTeams } from "@/lib/teamBalancer";
import { generateLineups } from "@/lib/lineupGenerator";
import { planMatchLineup, type MatchPlanResult, type MatchSelection, type MatchQuarterLimits } from "@/lib/matchPlanner";

const SCORE_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);
const QUARTER_OPTIONS = [1, 2, 3, 4];
const DEFAULT_MATCH_QUARTERS = 3;
type PlannerMode = "BALANCE" | "MATCH";

type GuestForm = {
  name: string;
  primaryPosition: FieldPosition;
  secondaryPositions: FieldPosition[];
  attackScore: number;
  midScore: number;
  defenseScore: number;
  activityScore: number;
  memo: string;
};

const emptyGuest: GuestForm = {
  name: "",
  primaryPosition: "CF",
  secondaryPositions: [],
  attackScore: 5,
  midScore: 5,
  defenseScore: 5,
  activityScore: 5,
  memo: "",
};

function modeHelp(mode: PlannerMode): string {
  return mode === "BALANCE"
    ? "내부전은 24명 이상 권장, 22명부터 생성 가능합니다. A/B팀 밸런스를 맞춥니다."
    : "매치는 필드 10명~18명과 전담 GK 기준으로 베스트 11과 1~4Q 라인업을 추천합니다.";
}

export default function Home() {
  const [csvUrl, setCsvUrl] = useState(appConfig.defaultSheetUrl);
  const [players, setPlayers] = useState<Player[]>([]);
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [dedicatedGks, setDedicatedGks] = useState<DedicatedGoalkeeper[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [guest, setGuest] = useState<GuestForm>(emptyGuest);
  const [guestRole, setGuestRole] = useState<"FIELD" | "GK">("FIELD");
  const [plannerMode, setPlannerMode] = useState<PlannerMode>("BALANCE");
  const [teamResult, setTeamResult] = useState<TeamBalanceResult | null>(null);
  const [lineupResult, setLineupResult] = useState<LineupResult | null>(null);
  const [matchResult, setMatchResult] = useState<MatchPlanResult | null>(null);
  const [matchQuarterLimits, setMatchQuarterLimits] = useState<MatchQuarterLimits>({});
  const [copied, setCopied] = useState(false);
  const [showSheetUrl, setShowSheetUrl] = useState(false);
  const [playerQuery, setPlayerQuery] = useState("");

  const fieldPlayers = useMemo(() => players.filter((p) => fieldIds.includes(p.id)), [players, fieldIds]);
  const regularCount = fieldPlayers.filter((p) => p.memberType === "REGULAR").length;
  const guestCount = fieldPlayers.filter((p) => p.memberType === "GUEST").length;
  const sortedPlayers = useMemo(() => [...players].sort((a, b) => a.name.localeCompare(b.name, "ko")), [players]);
  const searchedPlayers = useMemo(() => {
    const query = playerQuery.trim().toLowerCase();
    if (!query) return [];
    if (query === ".") return sortedPlayers;
    return sortedPlayers
      .filter((player) => [player.name, player.primaryPosition, player.secondaryPositions.join(",")].join(" ").toLowerCase().includes(query))
      .slice(0, 20);
  }, [playerQuery, sortedPlayers]);

  const canGenerate = plannerMode === "BALANCE"
    ? fieldPlayers.length >= 22 && fieldPlayers.length <= 36
    : fieldPlayers.length >= 10 && fieldPlayers.length <= 18;

  function resetResults() {
    setTeamResult(null);
    setLineupResult(null);
    setMatchResult(null);
    setCopied(false);
  }

  async function handleLoad() {
    resetResults();
    setErrors([]);
    setWarnings([]);
    const result = await loadPlayersFromCsv(csvUrl);
    setPlayers(result.players);
    setDedicatedGks([]);
    setErrors(result.errors);
    setWarnings(result.warnings);
    setFieldIds([]);
    setPlayerQuery("");
    setMatchQuarterLimits({});
  }

  function addFieldPlayer(player: Player) {
    if (player.primaryPosition === "GK") {
      setWarnings((prev) => [...prev, `${player.name}은 GK입니다. 전담 GK로 추가해주세요.`]);
      return;
    }
    if (dedicatedGks.some((gk) => gk.id === player.id)) {
      setWarnings((prev) => [...prev, `${player.name}은 이미 전담 GK로 추가되어 있습니다.`]);
      return;
    }
    if (fieldIds.includes(player.id)) return;
    setFieldIds((prev) => [...prev, player.id]);
    setMatchQuarterLimits((prev) => ({ ...prev, [player.id]: prev[player.id] ?? DEFAULT_MATCH_QUARTERS }));
  }

  function removeFieldPlayer(id: string) {
    setFieldIds((prev) => prev.filter((item) => item !== id));
    setMatchQuarterLimits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function addDedicatedGk(player: Player) {
    if (fieldIds.includes(player.id)) {
      setWarnings((prev) => [...prev, `${player.name}은 이미 필드 참석자로 추가되어 있습니다.`]);
      return;
    }
    if (dedicatedGks.some((gk) => gk.id === player.id)) return;
    setDedicatedGks((prev) => [...prev, { id: player.id, source: "SHEET", name: player.name, memo: player.memo }]);
  }

  function removeDedicatedGk(id: string) {
    setDedicatedGks((prev) => prev.filter((item) => item.id !== id));
  }

  function resetGuest() {
    setGuest(emptyGuest);
    setGuestRole("FIELD");
  }

  function addTempGuest() {
    if (!guest.name.trim()) return;
    const player: Player = {
      id: `temp_${Date.now()}_${guest.name}`,
      source: "TEMP_GUEST",
      memberType: "GUEST",
      active: true,
      name: guest.name.trim(),
      primaryPosition: guest.primaryPosition,
      secondaryPositions: guest.secondaryPositions,
      attackScore: guest.attackScore,
      midScore: guest.midScore,
      defenseScore: guest.defenseScore,
      activityScore: guest.activityScore,
      canGk: true,
      memo: guest.memo || undefined,
    };
    setPlayers((prev) => [...prev, player]);
    setFieldIds((prev) => [...prev, player.id]);
    setMatchQuarterLimits((prev) => ({ ...prev, [player.id]: DEFAULT_MATCH_QUARTERS }));
    resetGuest();
  }

  function addTempGk() {
    if (!guest.name.trim()) return;
    setDedicatedGks((prev) => [
      ...prev,
      { id: `temp_gk_${Date.now()}_${guest.name}`, source: "TEMP_GK", name: guest.name.trim(), memo: guest.memo || undefined },
    ]);
    resetGuest();
  }

  function setQuarterLimit(playerId: string, value: number) {
    setMatchQuarterLimits((prev) => ({ ...prev, [playerId]: value }));
  }

  function runPlanner() {
    resetResults();
    try {
      if (plannerMode === "MATCH") {
        setMatchResult(planMatchLineup(fieldPlayers, dedicatedGks, matchQuarterLimits));
      } else {
        const team = balanceTeams(fieldPlayers);
        const lineup = generateLineups(team.teamA, team.teamB, dedicatedGks);
        setTeamResult(team);
        setLineupResult(lineup);
      }
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  const shareText = useMemo(() => {
    if (matchResult) {
      const lines: string[] = ["[DEV FC 매치 라인업]", ""];
      lines.push("[베스트 라인업]");
      lines.push(`GK: ${matchResult.starters.gk?.name ?? "없음"}`);
      lines.push(`공격: ${matchResult.starters.attack.map((item) => item.player.name).join(", ")}`);
      lines.push(`미드: ${matchResult.starters.mid.map((item) => item.player.name).join(", ")}`);
      lines.push(`수비: ${matchResult.starters.defense.map((item) => item.player.name).join(", ")}`);
      lines.push("");
      matchResult.quarters.forEach((q) => {
        lines.push(`${q.quarter}Q`);
        lines.push(`GK: ${q.gk}`);
        lines.push(`공격: ${q.attack.join(", ")}`);
        lines.push(`미드: ${q.mid.join(", ")}`);
        lines.push(`수비: ${q.defense.join(", ")}`);
        lines.push(`대기: ${q.bench.join(", ") || "없음"}`);
        lines.push("");
      });
      lines.push(`후보: ${matchResult.bench.map((item) => item.player.name).join(", ") || "없음"}`);
      return lines.join("\n");
    }
    if (!teamResult || !lineupResult) return "";
    const lines: string[] = ["[DEV FC 라인업]", ""];
    for (const team of ["A", "B"] as const) {
      lines.push(`[${team}팀]`);
      lineupResult.quarters.filter((q) => q.team === team).forEach((q) => {
        lines.push(`${q.quarter}Q`);
        lines.push(`공격: ${q.attack.join(", ")}`);
        lines.push(`미드: ${q.mid.join(", ")}`);
        lines.push(`수비: ${q.defense.join(", ")}`);
        lines.push(`GK: ${q.gk}`);
        lines.push(`대기: ${q.bench.join(", ") || "없음"}`);
        lines.push("");
      });
    }
    return lines.join("\n");
  }, [teamResult, lineupResult, matchResult]);

  async function copyShareText() {
    await navigator.clipboard.writeText(shareText);
    setCopied(true);
  }

  return (
    <main className="mx-auto max-w-7xl p-4 pb-28 sm:p-8">
      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight">DEV FC Planner</h1>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold">선수정보</h2>
            <p className="mt-1 break-all text-sm text-slate-600">{csvUrl}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold" href={csvUrl} target="_blank" rel="noreferrer">시트 수정하기</a>
            <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold" onClick={() => setShowSheetUrl((v) => !v)}>{showSheetUrl ? "URL 숨기기" : "URL 변경"}</button>
            <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={handleLoad}>불러오기</button>
          </div>
        </div>
        {showSheetUrl && (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input className="flex-1 rounded-xl border border-slate-300 px-4 py-3" value={csvUrl} onChange={(e) => setCsvUrl(e.target.value)} placeholder="Google Sheets URL" />
            <button className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white" onClick={handleLoad} disabled={!csvUrl.trim()}>다시 불러오기</button>
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="불러온 선수" value={`${players.length}명`} />
          <Stat label="필드 참석자" value={`${fieldIds.length}명`} />
          <Stat label="전담 GK" value={`${dedicatedGks.length}명`} />
        </div>
      </section>

      {(errors.length > 0 || warnings.length > 0) && (
        <section className="mb-6 grid gap-4 md:grid-cols-2">
          {errors.length > 0 && <MessageBox title="오류" items={errors} tone="error" />}
          {warnings.length > 0 && <MessageBox title="경고" items={warnings} tone="warning" />}
        </section>
      )}

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">선수검색</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">{players.length}명</span>
        </div>
        <p className="mt-2 text-sm text-slate-600">이름을 검색해서 필드 참석자 또는 전담 GK로 추가하세요. . 을 입력하면 전체 인원을 볼 수 있습니다.</p>
        <div className="mt-4 flex gap-2">
          <input className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3" value={playerQuery} onChange={(e) => setPlayerQuery(e.target.value)} placeholder="이름 검색 예: 하성주 / 전체 보기: ." />
          {playerQuery && <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold" onClick={() => setPlayerQuery("")}>초기화</button>}
        </div>
        <div className="mt-3 grid gap-2 overflow-y-auto pr-1" style={{ maxHeight: "520px" }}>
          {searchedPlayers.map((p) => {
            const isField = fieldIds.includes(p.id);
            const isGk = dedicatedGks.some((gk) => gk.id === p.id);
            return <PlayerSearchRow key={p.id} player={p} isField={isField} isGk={isGk} onAddField={() => addFieldPlayer(p)} onRemoveField={() => removeFieldPlayer(p.id)} onAddGk={() => addDedicatedGk(p)} onRemoveGk={() => removeDedicatedGk(p.id)} />;
          })}
          {players.length > 0 && playerQuery.trim() && searchedPlayers.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">검색 결과가 없습니다.</p>}
          {players.length > 0 && !playerQuery.trim() && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">검색어를 입력하거나 . 을 입력하면 전체 목록을 볼 수 있습니다.</p>}
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">용병추가</h2>
        <div className="mt-4 grid gap-4">
          <input className="rounded-xl border border-slate-300 px-3 py-3" placeholder="이름" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
          <PositionPicker title="주포지션" includeGk selectedRole={guestRole} primary={guest.primaryPosition} onGk={() => setGuestRole("GK")} onField={(position) => { setGuestRole("FIELD"); setGuest({ ...guest, primaryPosition: position }); }} />
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-600">부포지션</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`rounded-full px-3 py-2 text-sm font-bold ${guest.secondaryPositions.length === 0 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} onClick={() => setGuest({ ...guest, secondaryPositions: [] })}>없음</button>
              {POSITIONS.map((position) => {
                const selected = guest.secondaryPositions[0] === position;
                return <button key={position} type="button" className={`rounded-full px-3 py-2 text-sm font-bold ${selected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} onClick={() => setGuest({ ...guest, secondaryPositions: [position] })}>{position}</button>;
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ScoreSelect label="공격" value={guest.attackScore} onChange={(v) => setGuest({ ...guest, attackScore: v })} />
            <ScoreSelect label="미드" value={guest.midScore} onChange={(v) => setGuest({ ...guest, midScore: v })} />
            <ScoreSelect label="수비" value={guest.defenseScore} onChange={(v) => setGuest({ ...guest, defenseScore: v })} />
            <ScoreSelect label="활동" value={guest.activityScore} onChange={(v) => setGuest({ ...guest, activityScore: v })} />
          </div>
          <input className="rounded-xl border border-slate-300 px-3 py-2" placeholder="메모" value={guest.memo} onChange={(e) => setGuest({ ...guest, memo: e.target.value })} />
          <button className={`w-full rounded-xl px-4 py-3 font-semibold text-white ${guestRole === "GK" ? "bg-emerald-600" : "bg-blue-600"}`} onClick={guestRole === "GK" ? addTempGk : addTempGuest}>{guestRole === "GK" ? "임시 GK 추가" : "임시 용병 추가"}</button>
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">참석자</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="정규" value={`${regularCount}명`} />
          <Stat label="용병" value={`${guestCount}명`} />
          <Stat label="필드" value={`${fieldIds.length}명`} />
          <Stat label="GK" value={`${dedicatedGks.length}`} />
        </div>
        <h3 className="mt-5 font-semibold">필드 참석자</h3>
        <div className="mt-2 flex flex-wrap gap-2">{fieldPlayers.map((p) => <Chip key={p.id} label={`${p.name}(${p.primaryPosition})`} tone={p.memberType === "GUEST" ? "guest" : "regular"} onRemove={() => removeFieldPlayer(p.id)} />)}</div>
        <h3 className="mt-5 font-semibold">전담 GK</h3>
        <div className="mt-2 flex flex-wrap gap-2">{dedicatedGks.map((gk) => <Chip key={gk.id} label={gk.name} onRemove={() => removeDedicatedGk(gk.id)} />)}</div>
      </section>

      {plannerMode === "MATCH" && fieldPlayers.length > 0 && (
        <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">매치 출전 쿼터 설정</h2>
          <p className="mt-1 text-sm text-slate-600">자동 생성 전에 선수별로 몇 쿼터 뛸지 정하세요. 기본값은 3Q입니다.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fieldPlayers.map((player) => (
              <div key={player.id} className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{player.name}</p>
                  <p className="text-xs text-slate-500">{player.primaryPosition}</p>
                </div>
                <select className="rounded-xl border border-slate-300 px-2 py-1 text-sm" value={matchQuarterLimits[player.id] ?? DEFAULT_MATCH_QUARTERS} onChange={(e) => setQuarterLimit(player.id, Number(e.target.value))}>
                  {QUARTER_OPTIONS.map((q) => <option key={q} value={q}>{q}Q</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">팀분배&라인업</h2>
            <p className="mt-1 text-sm text-slate-600">{modeHelp(plannerMode)}</p>
            <div className="mt-3 flex gap-2">
              <ModeButton active={plannerMode === "BALANCE"} onClick={() => setPlannerMode("BALANCE")}>내부전</ModeButton>
              <ModeButton active={plannerMode === "MATCH"} onClick={() => setPlannerMode("MATCH")}>매치</ModeButton>
            </div>
          </div>
          <button className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:bg-slate-300" onClick={runPlanner} disabled={!canGenerate}>자동 생성</button>
        </div>
      </section>

      {teamResult && <TeamResultView result={teamResult} />}
      {lineupResult && <LineupResultView result={lineupResult} />}
      {matchResult && <MatchResultView result={matchResult} />}

      {shareText && (
        <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">공유 텍스트</h2>
            <button className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white" onClick={copyShareText}>{copied ? "복사됨" : "복사"}</button>
          </div>
          <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-sm text-slate-100">{shareText}</pre>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="text-sm font-semibold">
            {plannerMode === "BALANCE" ? "내부전" : "매치"} · 필드 {fieldIds.length}명 · 전담 GK {dedicatedGks.length}
            {!canGenerate && <p className="text-xs font-normal text-slate-500">{plannerMode === "BALANCE" ? "내부전은 24명 이상 권장, 22명부터 가능" : "매치는 필드 10명~18명 필요"}</p>}
          </div>
          <button className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300" onClick={runPlanner} disabled={!canGenerate}>자동 생성</button>
        </div>
      </div>
    </main>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} onClick={onClick}>{children}</button>;
}

function PositionPicker({ title, includeGk, selectedRole, primary, onGk, onField }: { title: string; includeGk?: boolean; selectedRole: "FIELD" | "GK"; primary: FieldPosition; onGk: () => void; onField: (position: FieldPosition) => void }) {
  return <div><p className="mb-2 text-sm font-semibold text-slate-600">{title}</p><div className="flex flex-wrap gap-2">{includeGk && <button type="button" className={`rounded-full px-3 py-2 text-sm font-bold ${selectedRole === "GK" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} onClick={onGk}>GK</button>}{POSITIONS.map((position) => <button key={position} type="button" className={`rounded-full px-3 py-2 text-sm font-bold ${selectedRole === "FIELD" && primary === position ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`} onClick={() => onField(position)}>{position}</button>)}</div></div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-100 p-4"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>;
}

function MessageBox({ title, items, tone }: { title: string; items: string[]; tone: "error" | "warning" }) {
  return <div className={`rounded-3xl p-5 ${tone === "error" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900"}`}><h3 className="font-bold">{title}</h3><ul className="mt-2 list-disc pl-5 text-sm">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>;
}

function Chip({ label, onRemove, tone = "regular" }: { label: string; onRemove: () => void; tone?: "regular" | "guest" }) {
  const className = tone === "guest" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${className}`}>{label}<button className="font-bold opacity-70" onClick={onRemove}>×</button></span>;
}

function PlayerSearchRow({ player, isField, isGk, onAddField, onRemoveField, onAddGk, onRemoveGk }: { player: Player; isField: boolean; isGk: boolean; onAddField: () => void; onRemoveField: () => void; onAddGk: () => void; onRemoveGk: () => void }) {
  const secondary = player.secondaryPositions.length > 0 ? player.secondaryPositions.join(",") : "-";
  const isSheetGk = player.primaryPosition === "GK";
  return <div className={`rounded-2xl border p-3 ${isField || isGk ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}><div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{player.name}</p>{isField && <RoleBadge role="FIELD" />}{(isGk || isSheetGk) && <RoleBadge role="GK" />}</div><p className="mt-1 text-xs text-slate-500">주 {player.primaryPosition} · 부 {secondary}</p><p className="mt-0.5 text-xs text-slate-400">공격{player.attackScore} · 미드{player.midScore} · 수비{player.defenseScore} · 활동{player.activityScore}</p></div><div className="flex shrink-0 gap-1">{isField ? <button className="rounded-lg bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700" onClick={onRemoveField}>해제</button> : <button className="rounded-lg bg-blue-600 px-2.5 py-2 text-xs font-bold text-white disabled:bg-slate-300" onClick={onAddField} disabled={isGk || isSheetGk}>필드</button>}{isGk ? <button className="rounded-lg bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700" onClick={onRemoveGk}>해제</button> : <button className="rounded-lg bg-amber-500 px-2.5 py-2 text-xs font-bold text-white disabled:bg-slate-300" onClick={onAddGk} disabled={isField}>GK</button>}</div></div></div>;
}

function ScoreSelect({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <label className="grid gap-1 text-sm font-semibold text-slate-600">{label}<select className="rounded-xl border border-slate-300 px-3 py-2 font-normal text-slate-900" value={value} onChange={(e) => onChange(Number(e.target.value))}>{SCORE_OPTIONS.map((score) => <option key={score} value={score}>{score}</option>)}</select></label>;
}

function GroupBadge({ group }: { group: PositionGroup }) {
  const label = group === "ATTACK" ? "공격" : group === "MID" ? "미드" : "수비";
  const cls = group === "ATTACK" ? "bg-rose-100 text-rose-700" : group === "MID" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span>;
}

function RoleBadge({ role }: { role: LineupRole }) {
  const cls = role === "FIELD" ? "bg-blue-600 text-white" : role === "GK" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600";
  const label = role === "FIELD" ? "FIELD" : role === "GK" ? "GK" : "BENCH";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span>;
}

function MetricCard({ label, a, b }: { label: string; a: number; b: number }) {
  return <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">{label}</p><div className="mt-2 flex items-end justify-between gap-3"><div><p className="text-xs text-slate-500">A팀</p><p className="text-lg font-black">{a}</p></div><div className="text-center"><p className="text-xs text-slate-500">차이</p><p className="text-sm font-bold">{Math.abs(a - b)}</p></div><div className="text-right"><p className="text-xs text-slate-500">B팀</p><p className="text-lg font-black">{b}</p></div></div></div>;
}

function TeamResultView({ result }: { result: TeamBalanceResult }) {
  const s = result.summary;
  return <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold">팀 분배 결과</h2><span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">{result.quality}</span></div>{result.warnings.length > 0 && <div className="mt-4"><MessageBox title="팀 경고" items={result.warnings} tone="warning" /></div>}<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MetricCard label="공격 점수" a={s.attackScoreA} b={s.attackScoreB} /><MetricCard label="미드 점수" a={s.midScoreA} b={s.midScoreB} /><MetricCard label="수비 점수" a={s.defenseScoreA} b={s.defenseScoreB} /><MetricCard label="활동량" a={s.activityA} b={s.activityB} /><MetricCard label="정규" a={s.regularA} b={s.regularB} /><MetricCard label="용병" a={s.guestA} b={s.guestB} /></div><div className="mt-6 grid gap-4 md:grid-cols-2"><TeamCard title="A팀" players={result.teamA.players} /><TeamCard title="B팀" players={result.teamB.players} /></div><p className="mt-4 text-xs text-slate-500"><span className="font-bold">*</span> 부포지션으로 배정된 선수 · <span className="font-bold">**</span> 인원 균형을 위해 주·부와 무관한 포지션으로 강제 배정된 선수</p></section>;
}

function overrideMark(reason: string): string {
  if (reason === "부포지션 그룹 배정") return "*";
  if (reason === "인원 균형을 위한 포지션 변경") return "**";
  return "";
}

function TeamCard({ title, players }: { title: string; players: TeamBalanceResult["teamA"]["players"] }) {
  return <div className="rounded-2xl border border-slate-200 p-4"><h3 className="font-bold">{title}</h3>{(["ATTACK", "MID", "DEFENSE"] as PositionGroup[]).map((g) => <div key={g} className="mt-4"><GroupBadge group={g} /><div className="mt-2 flex flex-wrap gap-2">{players.filter((p) => p.assignedGroup === g).map((p) => <span key={p.id} title={p.assignmentReason} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{p.name}{overrideMark(p.assignmentReason)}</span>)}</div></div>)}</div>;
}

function LineupResultView({ result }: { result: LineupResult }) {
  return <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm"><h2 className="text-xl font-bold">라인업 결과</h2>{result.warnings.length > 0 && <div className="mt-4"><MessageBox title="라인업 경고" items={result.warnings} tone="warning" /></div>}<div className="mt-4 grid gap-3 md:grid-cols-2">{result.quarters.map((q) => <div key={`${q.team}-${q.quarter}`} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-2"><p className="text-lg font-black">{q.team}팀 {q.quarter}Q</p><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">GK {q.gk}</span></div><LineupNames group="ATTACK" names={q.attack} /><LineupNames group="MID" names={q.mid} /><LineupNames group="DEFENSE" names={q.defense} /><div className="mt-3"><p className="text-xs font-bold text-slate-500">대기</p><div className="mt-1 flex flex-wrap gap-2">{(q.bench.length ? q.bench : ["없음"]).map((name) => <span key={name} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{name}</span>)}</div></div></div>)}</div></section>;
}

function LineupNames({ group, names }: { group: PositionGroup; names: string[] }) {
  return <div className="mt-3"><GroupBadge group={group} /><div className="mt-1 flex flex-wrap gap-2">{names.map((name) => <span key={name} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{name}</span>)}</div></div>;
}

function MatchResultView({ result }: { result: MatchPlanResult }) {
  return <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm"><h2 className="text-xl font-bold">매치 라인업 추천</h2>{result.warnings.length > 0 && <div className="mt-4"><MessageBox title="매치 경고" items={result.warnings} tone="warning" /></div>}<div className="mt-4 rounded-2xl border border-slate-200 p-4"><h3 className="font-bold">베스트 라인업</h3><div className="mt-3"><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">GK</span><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{result.starters.gk?.name ?? "없음"}</span></div></div><MatchGroup group="ATTACK" items={result.starters.attack} /><MatchGroup group="MID" items={result.starters.mid} /><MatchGroup group="DEFENSE" items={result.starters.defense} /></div><div className="mt-4 grid gap-3 md:grid-cols-2">{result.quarters.map((q) => <div key={q.quarter} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-2"><p className="text-lg font-black">{q.quarter}Q</p><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">GK {q.gk}</span></div><LineupNames group="ATTACK" names={q.attack} /><LineupNames group="MID" names={q.mid} /><LineupNames group="DEFENSE" names={q.defense} /><div className="mt-3"><p className="text-xs font-bold text-slate-500">대기</p><div className="mt-1 flex flex-wrap gap-2">{(q.bench.length ? q.bench : ["없음"]).map((name) => <span key={name} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{name}</span>)}</div></div></div>)}</div><div className="mt-4 rounded-2xl border border-slate-200 p-4"><h3 className="font-bold">후보 / 교체 우선순위</h3><div className="mt-2 flex flex-wrap gap-2">{result.bench.map((item) => <span key={item.player.id} className="rounded-full bg-violet-100 px-3 py-1 text-sm font-semibold text-violet-800">{item.player.name}({groupKorean(item.group)})</span>)}{result.bench.length === 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">없음</span>}</div></div></section>;
}

function MatchGroup({ group, items }: { group: PositionGroup; items: MatchSelection[] }) {
  return <div className="mt-3"><GroupBadge group={group} /><div className="mt-2 flex flex-wrap gap-2">{items.map((item) => <span key={item.player.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700" title={item.reason}>{item.player.name}</span>)}</div></div>;
}

function groupKorean(group: PositionGroup): string {
  if (group === "ATTACK") return "공격";
  if (group === "MID") return "미드";
  return "수비";
}
