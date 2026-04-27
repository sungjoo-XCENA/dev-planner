"use client";

import { useMemo, useState } from "react";
import type { DedicatedGoalkeeper, Player, Position, PositionGroup } from "@/types/player";
import type { LineupResult, LineupRole } from "@/types/lineup";
import type { TeamBalanceResult } from "@/types/team";
import { appConfig } from "@/config/appConfig";
import { loadPlayersFromCsv } from "@/lib/loadPlayersFromCsv";
import { POSITIONS } from "@/lib/positions";
import { balanceTeams } from "@/lib/teamBalancer";
import { generateLineups } from "@/lib/lineupGenerator";

const SCORE_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);

const emptyGuest = {
  name: "",
  primaryPosition: "ST" as Position,
  secondaryPositions: [] as Position[],
  attackScore: 5,
  midScore: 5,
  defenseScore: 5,
  activityScore: 5,
  canGk: false,
  memo: "",
};

export default function Home() {
  const [csvUrl, setCsvUrl] = useState(appConfig.defaultSheetUrl);
  const [players, setPlayers] = useState<Player[]>([]);
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [dedicatedGks, setDedicatedGks] = useState<DedicatedGoalkeeper[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [guest, setGuest] = useState(emptyGuest);
  const [teamResult, setTeamResult] = useState<TeamBalanceResult | null>(null);
  const [lineupResult, setLineupResult] = useState<LineupResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSheetUrl, setShowSheetUrl] = useState(false);

  const fieldPlayers = useMemo(() => players.filter((p) => fieldIds.includes(p.id)), [players, fieldIds]);
  const regularCount = fieldPlayers.filter((p) => p.memberType === "REGULAR").length;
  const guestCount = fieldPlayers.filter((p) => p.memberType === "GUEST").length;
  const sortedPlayers = useMemo(() => [...players].sort((a, b) => a.name.localeCompare(b.name, "ko")), [players]);

  async function handleLoad() {
    setTeamResult(null);
    setLineupResult(null);
    setErrors([]);
    setWarnings([]);
    const result = await loadPlayersFromCsv(csvUrl);
    setPlayers(result.players);
    setErrors(result.errors);
    setWarnings(result.warnings);
    setFieldIds([]);
    setDedicatedGks([]);
  }

  function addFieldPlayer(player: Player) {
    if (dedicatedGks.some((gk) => gk.id === player.id)) {
      setWarnings((prev) => [...prev, `${player.name}은 이미 전담 GK로 추가되어 있습니다.`]);
      return;
    }
    if (fieldIds.includes(player.id)) return;
    setFieldIds((prev) => [...prev, player.id]);
  }

  function removeFieldPlayer(id: string) {
    setFieldIds((prev) => prev.filter((item) => item !== id));
  }

  function addDedicatedGk(player: Player) {
    if (fieldIds.includes(player.id)) {
      setWarnings((prev) => [...prev, `${player.name}은 이미 필드 참석자로 추가되어 있습니다.`]);
      return;
    }
    if (dedicatedGks.some((gk) => gk.id === player.id)) return;
    setDedicatedGks((prev) => [...prev, { id: player.id, source: "SHEET", name: player.name, memo: player.memo }]);
  }

  function toggleGuestSecondaryPosition(position: Position) {
    setGuest((prev) => {
      const exists = prev.secondaryPositions.includes(position);
      return {
        ...prev,
        secondaryPositions: exists
          ? prev.secondaryPositions.filter((item) => item !== position)
          : [...prev.secondaryPositions, position],
      };
    });
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
      canGk: guest.canGk,
      memo: guest.memo || undefined,
    };
    setPlayers((prev) => [...prev, player]);
    setFieldIds((prev) => [...prev, player.id]);
    setGuest(emptyGuest);
  }

  function addTempGk() {
    if (!guest.name.trim()) return;
    setDedicatedGks((prev) => [
      ...prev,
      { id: `temp_gk_${Date.now()}_${guest.name}`, source: "TEMP_GK", name: guest.name.trim(), memo: guest.memo || undefined },
    ]);
    setGuest(emptyGuest);
  }

  function runPlanner() {
    setCopied(false);
    try {
      const team = balanceTeams(fieldPlayers);
      const lineup = generateLineups(team.teamA, team.teamB, dedicatedGks);
      setTeamResult(team);
      setLineupResult(lineup);
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  const shareText = useMemo(() => {
    if (!teamResult || !lineupResult) return "";
    const lines: string[] = [];
    lines.push("[DEV FC 라인업]");
    lines.push("");
    for (const team of ["A", "B"] as const) {
      lines.push(`[${team}팀]`);
      lineupResult.quarters
        .filter((q) => q.team === team)
        .forEach((q) => {
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
  }, [teamResult, lineupResult]);

  async function copyShareText() {
    await navigator.clipboard.writeText(shareText);
    setCopied(true);
  }

  return (
    <main className="mx-auto max-w-7xl p-4 pb-28 sm:p-8">
      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-500">DEV FC Planner</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">팀 밸런서 & 쿼터 라인업 플래너</h1>
        <p className="mt-3 text-slate-600">정규 선수 시트를 불러오고, 투표한 사람만 빠르게 추가한 뒤 13:13 팀과 쿼터 라인업을 생성합니다.</p>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold">1. 정규 선수 시트</h2>
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
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat label="불러온 선수" value={`${players.length}명`} />
          <Stat label="필드 참석자" value={`${fieldIds.length} / 26명`} />
          <Stat label="전담 GK" value={`${dedicatedGks.length}명`} />
          <Stat label="필드 GK 가능" value={`${fieldPlayers.filter((p) => p.canGk).length}명`} />
        </div>
      </section>

      {(errors.length > 0 || warnings.length > 0) && (
        <section className="mb-6 grid gap-4 md:grid-cols-2">
          {errors.length > 0 && <MessageBox title="오류" items={errors} tone="error" />}
          {warnings.length > 0 && <MessageBox title="경고" items={warnings} tone="warning" />}
        </section>
      )}

      <section className="mb-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">2. 선수 빠른 추가</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">가나다순</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">투표한 사람은 이름 버튼을 누르면 바로 필드 참석자로 추가됩니다. 키퍼만 온 사람은 GK 버튼을 누르세요.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {sortedPlayers.map((p) => {
              const isField = fieldIds.includes(p.id);
              const isGk = dedicatedGks.some((gk) => gk.id === p.id);
              return (
                <div key={p.id} className={`rounded-2xl border p-3 ${isField || isGk ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button className="min-w-0 flex-1 text-left" onClick={() => addFieldPlayer(p)} disabled={isField || isGk}>
                      <p className="truncate text-base font-bold">{p.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{p.primaryPosition} · 공격{p.attackScore}/미드{p.midScore}/수비{p.defenseScore} · 활동{p.activityScore}</p>
                    </button>
                    <button className="shrink-0 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300" onClick={() => addDedicatedGk(p)} disabled={isField || isGk}>GK</button>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>필드GK {p.canGk ? "가능" : "불가"}</span>
                    {isField && <button className="font-bold text-red-600" onClick={() => removeFieldPlayer(p.id)}>필드 제거</button>}
                    {isGk && <button className="font-bold text-red-600" onClick={() => setDedicatedGks((prev) => prev.filter((item) => item.id !== p.id))}>GK 제거</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">3. 오늘 참석자</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <Stat label="정규" value={`${regularCount}명`} />
            <Stat label="용병" value={`${guestCount}명`} />
            <Stat label="필드" value={`${fieldIds.length}/26`} />
            <Stat label="GK" value={`${dedicatedGks.length}`} />
          </div>
          <h3 className="mt-5 font-semibold">필드 참석자</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {fieldPlayers.map((p) => <Chip key={p.id} label={`${p.name}(${p.primaryPosition})`} onRemove={() => removeFieldPlayer(p.id)} />)}
          </div>
          <h3 className="mt-5 font-semibold">전담 GK</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {dedicatedGks.map((gk) => <Chip key={gk.id} label={gk.name} onRemove={() => setDedicatedGks((prev) => prev.filter((item) => item.id !== gk.id))} />)}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">4. 임시 용병 / 임시 GK 추가</h2>
        <div className="mt-4 grid gap-4">
          <input className="rounded-xl border border-slate-300 px-3 py-3" placeholder="이름" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />

          <PositionButtonGroup
            label="주포지션"
            mode="single"
            selected={[guest.primaryPosition]}
            onToggle={(position) => setGuest({ ...guest, primaryPosition: position })}
          />

          <PositionButtonGroup
            label="부포지션"
            mode="multiple"
            selected={guest.secondaryPositions}
            onToggle={toggleGuestSecondaryPosition}
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ScoreSelect label="공격" value={guest.attackScore} onChange={(v) => setGuest({ ...guest, attackScore: v })} />
            <ScoreSelect label="미드" value={guest.midScore} onChange={(v) => setGuest({ ...guest, midScore: v })} />
            <ScoreSelect label="수비" value={guest.defenseScore} onChange={(v) => setGuest({ ...guest, defenseScore: v })} />
            <ScoreSelect label="활동" value={guest.activityScore} onChange={(v) => setGuest({ ...guest, activityScore: v })} />
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2"><input type="checkbox" checked={guest.canGk} onChange={(e) => setGuest({ ...guest, canGk: e.target.checked })} /> 필드 GK 가능</label>
          <input className="rounded-xl border border-slate-300 px-3 py-2" placeholder="메모" value={guest.memo} onChange={(e) => setGuest({ ...guest, memo: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white" onClick={addTempGuest}>임시 용병 추가</button>
            <button className="rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white" onClick={addTempGk}>임시 GK 추가</button>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">5. 팀 분배 & 라인업 생성</h2>
            <p className="mt-1 text-sm text-slate-600">현재 MVP는 13:13 고정이라 필드 참석자 정확히 26명일 때 생성할 수 있습니다.</p>
          </div>
          <button className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white" onClick={runPlanner} disabled={fieldPlayers.length !== 26 || errors.length > 0}>자동 생성</button>
        </div>
      </section>

      {teamResult && <TeamResultView result={teamResult} />}
      {lineupResult && <LineupResultView result={lineupResult} />}

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
            필드 {fieldIds.length}/26 · 전담 GK {dedicatedGks.length}
            {fieldIds.length !== 26 && <p className="text-xs font-normal text-slate-500">{fieldIds.length < 26 ? `${26 - fieldIds.length}명 더 필요` : `${fieldIds.length - 26}명 제외 필요`}</p>}
          </div>
          <button className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300" onClick={runPlanner} disabled={fieldPlayers.length !== 26 || errors.length > 0}>자동 생성</button>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-100 p-4"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>;
}

function MessageBox({ title, items, tone }: { title: string; items: string[]; tone: "error" | "warning" }) {
  return <div className={`rounded-3xl p-5 ${tone === "error" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900"}`}><h3 className="font-bold">{title}</h3><ul className="mt-2 list-disc pl-5 text-sm">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>;
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm">{label}<button className="font-bold text-slate-500" onClick={onRemove}>×</button></span>;
}

function PositionButtonGroup({
  label,
  mode,
  selected,
  onToggle,
}: {
  label: string;
  mode: "single" | "multiple";
  selected: Position[];
  onToggle: (position: Position) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold text-slate-600">{label}</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{mode === "single" ? "1개 선택" : "여러 개 선택"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {POSITIONS.map((position) => {
          const isSelected = selected.includes(position);
          return (
            <button
              key={position}
              type="button"
              className={`rounded-full px-3 py-2 text-sm font-bold ${isSelected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
              onClick={() => onToggle(position)}
            >
              {position}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScoreSelect({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-slate-600">
      {label}
      <select className="rounded-xl border border-slate-300 px-3 py-2 font-normal text-slate-900" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {SCORE_OPTIONS.map((score) => <option key={score} value={score}>{score}</option>)}
      </select>
    </label>
  );
}

function GroupBadge({ group }: { group: PositionGroup }) {
  const label = group === "ATTACK" ? "공격" : group === "MID" ? "미드" : "수비";
  const cls = group === "ATTACK" ? "bg-rose-100 text-rose-700" : group === "MID" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span>;
}

function RoleBadge({ role }: { role: LineupRole }) {
  const cls = role === "FIELD" ? "bg-slate-900 text-white" : role === "GK" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600";
  const label = role === "FIELD" ? "필드" : role === "GK" ? "GK" : "대기";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span>;
}

function MetricCard({ label, a, b }: { label: string; a: number; b: number }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div><p className="text-xs text-slate-500">A팀</p><p className="text-lg font-black">{a}</p></div>
        <div className="text-center"><p className="text-xs text-slate-500">차이</p><p className="text-sm font-bold">{Math.abs(a - b)}</p></div>
        <div className="text-right"><p className="text-xs text-slate-500">B팀</p><p className="text-lg font-black">{b}</p></div>
      </div>
    </div>
  );
}

function TeamResultView({ result }: { result: TeamBalanceResult }) {
  const s = result.summary;
  return (
    <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold">팀 분배 결과</h2>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">{result.quality}</span>
      </div>
      {result.warnings.length > 0 && <div className="mt-4"><MessageBox title="팀 경고" items={result.warnings} tone="warning" /></div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="공격 점수" a={s.attackScoreA} b={s.attackScoreB} />
        <MetricCard label="미드 점수" a={s.midScoreA} b={s.midScoreB} />
        <MetricCard label="수비 점수" a={s.defenseScoreA} b={s.defenseScoreB} />
        <MetricCard label="활동량" a={s.activityA} b={s.activityB} />
        <MetricCard label="필드 GK 가능" a={s.fieldGkA} b={s.fieldGkB} />
        <MetricCard label="정규" a={s.regularA} b={s.regularB} />
        <MetricCard label="용병" a={s.guestA} b={s.guestB} />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <TeamCard title="A팀" players={result.teamA.players} />
        <TeamCard title="B팀" players={result.teamB.players} />
      </div>
    </section>
  );
}

function TeamCard({ title, players }: { title: string; players: TeamBalanceResult["teamA"]["players"] }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <h3 className="font-bold">{title}</h3>
      {(["ATTACK", "MID", "DEFENSE"] as PositionGroup[]).map((g) => (
        <div key={g} className="mt-4">
          <GroupBadge group={g} />
          <div className="mt-2 flex flex-wrap gap-2">
            {players.filter((p) => p.assignedGroup === g).map((p) => (
              <span key={p.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                {p.name}{p.isPositionOverride ? "*" : ""}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LineupResultView({ result }: { result: LineupResult }) {
  return (
    <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">라인업 결과</h2>
      {result.warnings.length > 0 && <div className="mt-4"><MessageBox title="라인업 경고" items={result.warnings} tone="warning" /></div>}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {result.quarters.map((q) => (
          <div key={`${q.team}-${q.quarter}`} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg font-black">{q.team}팀 {q.quarter}Q</p>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">GK {q.gk}</span>
            </div>
            <LineupNames group="ATTACK" names={q.attack} />
            <LineupNames group="MID" names={q.mid} />
            <LineupNames group="DEFENSE" names={q.defense} />
            <div className="mt-3">
              <p className="text-xs font-bold text-slate-500">대기</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {(q.bench.length ? q.bench : ["없음"]).map((name) => <span key={name} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{name}</span>)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <h3 className="mt-8 font-bold">선수별 출전표</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {result.playerSummaries.map((p) => (
          <div key={p.playerId} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-bold">{p.playerName}</p>
                <p className="text-xs text-slate-500">{p.team}팀</p>
              </div>
              <GroupBadge group={p.assignedGroup} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <QuarterBadge label="1Q" role={p.q1} />
              <QuarterBadge label="2Q" role={p.q2} />
              <QuarterBadge label="3Q" role={p.q3} />
              <QuarterBadge label="4Q" role={p.q4} />
            </div>
            <p className="mt-3 text-xs text-slate-500">필드 {p.fieldCount} · GK {p.gkCount} · 대기 {p.benchCount}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function LineupNames({ group, names }: { group: PositionGroup; names: string[] }) {
  return (
    <div className="mt-3">
      <GroupBadge group={group} />
      <div className="mt-1 flex flex-wrap gap-2">
        {names.map((name) => <span key={name} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{name}</span>)}
      </div>
    </div>
  );
}

function QuarterBadge({ label, role }: { label: string; role: LineupRole }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2">
      <p className="mb-1 text-xs font-bold text-slate-500">{label}</p>
      <RoleBadge role={role} />
    </div>
  );
}
