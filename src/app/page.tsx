"use client";

import { useMemo, useState } from "react";
import type { DedicatedGoalkeeper, Player, Position } from "@/types/player";
import type { LineupResult } from "@/types/lineup";
import type { TeamBalanceResult } from "@/types/team";
import { loadPlayersFromCsv } from "@/lib/loadPlayersFromCsv";
import { POSITIONS } from "@/lib/positions";
import { balanceTeams } from "@/lib/teamBalancer";
import { generateLineups } from "@/lib/lineupGenerator";

const emptyGuest = {
  name: "",
  primaryPosition: "ST" as Position,
  secondaryPositions: "",
  attackScore: 3,
  midScore: 3,
  defenseScore: 3,
  activityScore: 3,
  canGk: false,
  memo: "",
};

export default function Home() {
  const [csvUrl, setCsvUrl] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [dedicatedGks, setDedicatedGks] = useState<DedicatedGoalkeeper[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [guest, setGuest] = useState(emptyGuest);
  const [teamResult, setTeamResult] = useState<TeamBalanceResult | null>(null);
  const [lineupResult, setLineupResult] = useState<LineupResult | null>(null);
  const [copied, setCopied] = useState(false);

  const fieldPlayers = useMemo(() => players.filter((p) => fieldIds.includes(p.id)), [players, fieldIds]);
  const regularCount = fieldPlayers.filter((p) => p.memberType === "REGULAR").length;
  const guestCount = fieldPlayers.filter((p) => p.memberType === "GUEST").length;

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

  function addTempGuest() {
    if (!guest.name.trim()) return;
    const player: Player = {
      id: `temp_${Date.now()}_${guest.name}`,
      source: "TEMP_GUEST",
      memberType: "GUEST",
      active: true,
      name: guest.name.trim(),
      primaryPosition: guest.primaryPosition,
      secondaryPositions: guest.secondaryPositions
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter((item): item is Position => (POSITIONS as readonly string[]).includes(item)),
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
    <main className="mx-auto max-w-7xl p-4 sm:p-8">
      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-500">DEV FC Planner</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">팀 밸런서 & 쿼터 라인업 플래너</h1>
        <p className="mt-3 text-slate-600">Google Sheets CSV를 불러와 필드 참석자 26명과 전담 GK를 구성하고, 4/4/5 팀 분배와 3/3/4 쿼터 라인업을 생성합니다.</p>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">1. Google Sheets CSV 불러오기</h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input className="flex-1 rounded-xl border border-slate-300 px-4 py-3" value={csvUrl} onChange={(e) => setCsvUrl(e.target.value)} placeholder="CSV export URL" />
          <button className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white" onClick={handleLoad} disabled={!csvUrl.trim()}>불러오기</button>
        </div>
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

      <section className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">2. 선수 풀</h2>
          <div className="mt-4 max-h-[520px] overflow-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <Th>이름</Th><Th>구분</Th><Th>주/부</Th><Th>공/미/수</Th><Th>활동</Th><Th>GK</Th><Th>액션</Th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <Td>{p.name}</Td>
                    <Td>{p.memberType}</Td>
                    <Td>{p.primaryPosition} / {p.secondaryPositions.join(",") || "-"}</Td>
                    <Td>{p.attackScore}/{p.midScore}/{p.defenseScore}</Td>
                    <Td>{p.activityScore}</Td>
                    <Td>{p.canGk ? "Y" : "N"}</Td>
                    <Td>
                      <div className="flex gap-2">
                        <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => addFieldPlayer(p)}>필드</button>
                        <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => addDedicatedGk(p)}>전담GK</button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">3. 오늘 참석자</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
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
        <div className="mt-4 grid gap-3 md:grid-cols-6">
          <input className="rounded-xl border border-slate-300 px-3 py-2" placeholder="이름" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
          <select className="rounded-xl border border-slate-300 px-3 py-2" value={guest.primaryPosition} onChange={(e) => setGuest({ ...guest, primaryPosition: e.target.value as Position })}>{POSITIONS.map((p) => <option key={p}>{p}</option>)}</select>
          <input className="rounded-xl border border-slate-300 px-3 py-2" placeholder="부포지션 예: CM,CB" value={guest.secondaryPositions} onChange={(e) => setGuest({ ...guest, secondaryPositions: e.target.value })} />
          <ScoreInput label="공" value={guest.attackScore} onChange={(v) => setGuest({ ...guest, attackScore: v })} />
          <ScoreInput label="미" value={guest.midScore} onChange={(v) => setGuest({ ...guest, midScore: v })} />
          <ScoreInput label="수" value={guest.defenseScore} onChange={(v) => setGuest({ ...guest, defenseScore: v })} />
          <ScoreInput label="활동" value={guest.activityScore} onChange={(v) => setGuest({ ...guest, activityScore: v })} />
          <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2"><input type="checkbox" checked={guest.canGk} onChange={(e) => setGuest({ ...guest, canGk: e.target.checked })} /> GK 가능</label>
          <input className="rounded-xl border border-slate-300 px-3 py-2 md:col-span-2" placeholder="메모" value={guest.memo} onChange={(e) => setGuest({ ...guest, memo: e.target.value })} />
          <button className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white" onClick={addTempGuest}>임시 용병 추가</button>
          <button className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white" onClick={addTempGk}>임시 GK 추가</button>
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">5. 팀 분배 & 라인업 생성</h2>
            <p className="mt-1 text-sm text-slate-600">필드 참석자 26명이 되어야 실행할 수 있습니다.</p>
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

function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-2 font-semibold text-slate-600">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-3 py-2 align-top">{children}</td>; }
function ScoreInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm">{label}<input className="w-12 bg-transparent" type="number" min={1} max={5} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}

function TeamResultView({ result }: { result: TeamBalanceResult }) {
  const s = result.summary;
  return <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm"><h2 className="text-xl font-bold">팀 분배 결과 · {result.quality}</h2>{result.warnings.length > 0 && <MessageBox title="팀 경고" items={result.warnings} tone="warning" />}<div className="mt-4 overflow-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="bg-slate-50"><Th>항목</Th><Th>A팀</Th><Th>B팀</Th><Th>차이</Th></tr></thead><tbody>{[["공격 점수", s.attackScoreA, s.attackScoreB], ["미드 점수", s.midScoreA, s.midScoreB], ["수비 점수", s.defenseScoreA, s.defenseScoreB], ["활동량", s.activityA, s.activityB], ["필드 GK 가능", s.fieldGkA, s.fieldGkB], ["정규", s.regularA, s.regularB], ["용병", s.guestA, s.guestB]].map(([label, a, b]) => <tr key={String(label)} className="border-t"><Td>{label}</Td><Td>{a}</Td><Td>{b}</Td><Td>{Math.abs(Number(a)-Number(b))}</Td></tr>)}</tbody></table></div><div className="mt-6 grid gap-4 md:grid-cols-2"><TeamCard title="A팀" players={result.teamA.players} /><TeamCard title="B팀" players={result.teamB.players} /></div></section>;
}

function TeamCard({ title, players }: { title: string; players: TeamBalanceResult["teamA"]["players"] }) {
  return <div className="rounded-2xl border border-slate-200 p-4"><h3 className="font-bold">{title}</h3>{(["ATTACK", "MID", "DEFENSE"] as const).map((g) => <div key={g} className="mt-3"><p className="text-xs font-bold text-slate-500">{g}</p><p className="text-sm">{players.filter((p) => p.assignedGroup === g).map((p) => `${p.name}${p.isPositionOverride ? "*" : ""}`).join(", ")}</p></div>)}</div>;
}

function LineupResultView({ result }: { result: LineupResult }) {
  return <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm"><h2 className="text-xl font-bold">라인업 결과</h2>{result.warnings.length > 0 && <MessageBox title="라인업 경고" items={result.warnings} tone="warning" />}<div className="mt-4 overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="bg-slate-50"><Th>팀</Th><Th>Q</Th><Th>공격</Th><Th>미드</Th><Th>수비</Th><Th>GK</Th><Th>대기</Th></tr></thead><tbody>{result.quarters.map((q) => <tr key={`${q.team}-${q.quarter}`} className="border-t"><Td>{q.team}</Td><Td>{q.quarter}Q</Td><Td>{q.attack.join(", ")}</Td><Td>{q.mid.join(", ")}</Td><Td>{q.defense.join(", ")}</Td><Td>{q.gk}</Td><Td>{q.bench.join(", ")}</Td></tr>)}</tbody></table></div><h3 className="mt-6 font-bold">선수별 출전표</h3><div className="mt-2 overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-slate-50"><Th>팀</Th><Th>선수</Th><Th>역할</Th><Th>1Q</Th><Th>2Q</Th><Th>3Q</Th><Th>4Q</Th><Th>필드/GK/대기</Th></tr></thead><tbody>{result.playerSummaries.map((p) => <tr key={p.playerId} className="border-t"><Td>{p.team}</Td><Td>{p.playerName}</Td><Td>{p.assignedGroup}</Td><Td>{p.q1}</Td><Td>{p.q2}</Td><Td>{p.q3}</Td><Td>{p.q4}</Td><Td>{p.fieldCount}/{p.gkCount}/{p.benchCount}</Td></tr>)}</tbody></table></div></section>;
}
