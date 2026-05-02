"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DedicatedGoalkeeper, FieldPosition, Player, PositionGroup, StaffRole } from "@/types/player";
import type { LineupResult, LineupRole, Quarter } from "@/types/lineup";
import type { TeamBalanceResult, TeamName } from "@/types/team";
import { appConfig } from "@/config/appConfig";
import { loadPlayersFromCsv } from "@/lib/loadPlayersFromCsv";
import { POSITIONS, getPositionGroup, hasGroup } from "@/lib/positions";
import { balanceTeamsVariants, summarizeTeams } from "@/lib/teamBalancer";
import { generateLineups } from "@/lib/lineupGenerator";
import { planMatchLineup, type MatchPlanResult, type MatchSelection, type MatchQuarterLimits } from "@/lib/matchPlanner";
import { clearStoredAll, loadStored, saveStored } from "@/lib/persistedState";
import { formatTeamName } from "@/lib/teamLabels";
import { extractStaffRole } from "@/lib/staffRoles";

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
    ? "내부전은 24명 이상 권장, 22명부터 생성 가능합니다. 형광/주황팀 밸런스를 맞춥니다."
    : "매치는 필드 10명~18명과 전담 GK 기준으로 베스트 11과 1~4Q 라인업을 추천합니다.";
}

const LINEUP_SHARE_HASH_KEY = "lineup";
const COMPRESSED_LINEUP_PREFIX = "gz.";

type SharedLineupPayload = {
  version: 1;
  lineup: LineupResult;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j += 1) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("현재 브라우저가 압축 URL 생성을 지원하지 않습니다.");
  }
  const stream = new Blob([toBlobPart(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("현재 브라우저가 압축 URL 열기를 지원하지 않습니다.");
  }
  const stream = new Blob([toBlobPart(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodeSharedLineup(lineup: LineupResult): Promise<string> {
  const payload: SharedLineupPayload = { version: 1, lineup };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return `${COMPRESSED_LINEUP_PREFIX}${bytesToBase64Url(await gzip(bytes))}`;
}

async function decodeSharedLineup(value: string): Promise<LineupResult> {
  if (!value.startsWith(COMPRESSED_LINEUP_PREFIX)) {
    throw new Error("라인업 공유 URL 형식이 올바르지 않습니다.");
  }
  const compressed = base64UrlToBytes(value.slice(COMPRESSED_LINEUP_PREFIX.length));
  const json = new TextDecoder().decode(await gunzip(compressed));
  const payload = JSON.parse(json) as Partial<SharedLineupPayload>;
  if (payload.version !== 1 || !payload.lineup || !Array.isArray(payload.lineup.quarters)) {
    throw new Error("라인업 공유 데이터 형식이 올바르지 않습니다.");
  }
  return payload.lineup;
}

async function buildLineupShareUrl(lineup: LineupResult): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  url.search = "";
  const params = new URLSearchParams();
  params.set(LINEUP_SHARE_HASH_KEY, await encodeSharedLineup(lineup));
  url.hash = params.toString();
  return url.toString();
}

function clearLineupShareHash() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  if (!params.has(LINEUP_SHARE_HASH_KEY)) return;
  params.delete(LINEUP_SHARE_HASH_KEY);
  url.hash = params.toString();
  window.history.replaceState(null, "", url.toString());
}

type SwapSelection = { team: "A" | "B"; playerId: string } | null;

export default function Home() {
  const [csvUrl, setCsvUrl] = useState(appConfig.defaultSheetUrl);
  const [players, setPlayers] = useState<Player[]>([]);
  const [tempGuests, setTempGuests] = useState<Player[]>([]);
  const [tempGks, setTempGks] = useState<DedicatedGoalkeeper[]>([]);
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [waitingIds, setWaitingIds] = useState<string[]>([]);
  const [dedicatedGks, setDedicatedGks] = useState<DedicatedGoalkeeper[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [guest, setGuest] = useState<GuestForm>(emptyGuest);
  const [guestRole, setGuestRole] = useState<"FIELD" | "GK">("FIELD");
  const [plannerMode, setPlannerMode] = useState<PlannerMode>("BALANCE");
  const [teamResult, setTeamResult] = useState<TeamBalanceResult | null>(null);
  const [teamVariants, setTeamVariants] = useState<TeamBalanceResult[]>([]);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const [lineupResult, setLineupResult] = useState<LineupResult | null>(null);
  const [matchResult, setMatchResult] = useState<MatchPlanResult | null>(null);
  const [matchQuarterLimits, setMatchQuarterLimits] = useState<MatchQuarterLimits>({});
  const [copied, setCopied] = useState(false);
  const [showSheetUrl, setShowSheetUrl] = useState(false);
  const [playerQuery, setPlayerQuery] = useState("");
  const [teamsConfirmed, setTeamsConfirmed] = useState(false);
  const [swapSelection, setSwapSelection] = useState<SwapSelection>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const storedCsvUrl = loadStored<string>("csvUrl", appConfig.defaultSheetUrl);
      const storedMode = loadStored<PlannerMode>("plannerMode", "BALANCE");
      const storedLimits = loadStored<MatchQuarterLimits>("matchQuarterLimits", {});
      const storedFieldIds = loadStored<string[]>("fieldIds", []);
      const storedWaitingIds = loadStored<string[]>("waitingIds", []);
      const storedGkIds = loadStored<string[]>("dedicatedGkIds", []);
      const storedTempGuests = loadStored<Player[]>("tempGuests", []);
      const storedTempGks = loadStored<DedicatedGoalkeeper[]>("tempGks", []);

      setCsvUrl(storedCsvUrl);
      setPlannerMode(storedMode);
      setMatchQuarterLimits(storedLimits);
      setTempGuests(storedTempGuests);
      setTempGks(storedTempGks);

      const result = await loadPlayersFromCsv(storedCsvUrl);
      if (cancelled) return;

      const allPlayers: Player[] = [...result.players, ...storedTempGuests];
      setPlayers(allPlayers);
      setErrors(result.errors);
      setWarnings(result.warnings);

      const validFieldIds = storedFieldIds.filter((id) => allPlayers.some((p) => p.id === id));
      setFieldIds(validFieldIds);
      const validWaitingIds = storedWaitingIds.filter((id) => allPlayers.some((p) => p.id === id));
      setWaitingIds(validWaitingIds);

      const sheetGkPool: DedicatedGoalkeeper[] = result.players
        .filter((p) => p.primaryPosition === "GK")
        .map((p) => ({ id: p.id, source: "SHEET" as const, name: p.name, memo: p.memo }));
      const allGks = [...sheetGkPool, ...storedTempGks];
      const validGks = storedGkIds
        .map((id) => allGks.find((gk) => gk.id === id))
        .filter((gk): gk is DedicatedGoalkeeper => Boolean(gk));
      setDedicatedGks(validGks);

      setHydrated(true);
    }
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveStored("csvUrl", csvUrl);
  }, [csvUrl, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("plannerMode", plannerMode);
  }, [plannerMode, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("fieldIds", fieldIds);
  }, [fieldIds, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("waitingIds", waitingIds);
  }, [waitingIds, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("dedicatedGkIds", dedicatedGks.map((gk) => gk.id));
  }, [dedicatedGks, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("tempGuests", tempGuests);
  }, [tempGuests, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("tempGks", tempGks);
  }, [tempGks, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveStored("matchQuarterLimits", matchQuarterLimits);
  }, [matchQuarterLimits, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const applySharedLineup = async () => {
      const params = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
      const encoded = params.get(LINEUP_SHARE_HASH_KEY);
      if (!encoded) return;
      try {
        const sharedLineup = await decodeSharedLineup(encoded);
        if (cancelled) return;
        setPlannerMode("BALANCE");
        setTeamResult(null);
        setTeamVariants([]);
        setSelectedVariantIdx(0);
        setLineupResult(sharedLineup);
        setMatchResult(null);
        setTeamsConfirmed(true);
        setSwapSelection(null);
        setCopied(false);
        window.setTimeout(() => document.getElementById("lineup-result")?.scrollIntoView({ block: "start" }), 0);
      } catch (error) {
        if (!cancelled) setErrors([error instanceof Error ? error.message : String(error)]);
      }
    };
    applySharedLineup();
    window.addEventListener("hashchange", applySharedLineup);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", applySharedLineup);
    };
  }, [hydrated]);

  const fieldPlayers = useMemo(() => players.filter((p) => fieldIds.includes(p.id)), [players, fieldIds]);
  const isWaitingPlayer = useMemo(() => {
    const set = new Set(waitingIds);
    return (p: Player) => set.has(p.id) || p.memberType === "WAITING";
  }, [waitingIds]);
  const activeFieldPlayers = useMemo(() => fieldPlayers.filter((p) => !isWaitingPlayer(p)), [fieldPlayers, isWaitingPlayer]);
  const waitingPlayers = useMemo(() => fieldPlayers.filter((p) => isWaitingPlayer(p)), [fieldPlayers, isWaitingPlayer]);
  const regularCount = fieldPlayers.filter((p) => p.memberType === "REGULAR").length;
  const guestCount = fieldPlayers.filter((p) => p.memberType === "GUEST").length;
  const waitingCount = waitingPlayers.length;
  const sortedSheetPlayers = useMemo(
    () => players.filter((p) => p.source === "SHEET").sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [players],
  );
  const searchedPlayers = useMemo(() => {
    const query = playerQuery.trim().toLowerCase();
    if (!query) return [];
    if (query === ".") return sortedSheetPlayers;
    return sortedSheetPlayers
      .filter((player) => [player.name, player.primaryPosition, player.secondaryPositions.join(",")].join(" ").toLowerCase().includes(query))
      .slice(0, 20);
  }, [playerQuery, sortedSheetPlayers]);

  const canGenerate = plannerMode === "BALANCE"
    ? activeFieldPlayers.length >= 22 && activeFieldPlayers.length <= 36
    : activeFieldPlayers.length >= 10 && activeFieldPlayers.length <= 18;

  function resetResults() {
    clearLineupShareHash();
    setTeamResult(null);
    setTeamVariants([]);
    setSelectedVariantIdx(0);
    setLineupResult(null);
    setMatchResult(null);
    setCopied(false);
    setTeamsConfirmed(false);
    setSwapSelection(null);
  }

  async function handleLoad() {
    resetResults();
    setErrors([]);
    setWarnings([]);
    const result = await loadPlayersFromCsv(csvUrl);

    const sheetByName = new Map(result.players.map((p) => [p.name.trim(), p]));
    const idMigration = new Map<string, string>();
    const overriddenNames: string[] = [];
    const filteredTempGuests = tempGuests.filter((tg) => {
      const sheetMatch = sheetByName.get(tg.name.trim());
      if (sheetMatch) {
        idMigration.set(tg.id, sheetMatch.id);
        overriddenNames.push(tg.name.trim());
        return false;
      }
      return true;
    });
    const migrate = (id: string) => idMigration.get(id) ?? id;

    const mergedPlayers = [...result.players, ...filteredTempGuests];
    const validIds = new Set(mergedPlayers.map((p) => p.id));

    setPlayers(mergedPlayers);
    if (filteredTempGuests.length !== tempGuests.length) {
      setTempGuests(filteredTempGuests);
    }
    setErrors(result.errors);
    setWarnings([
      ...result.warnings,
      ...(overriddenNames.length > 0
        ? [`시트와 이름이 같은 임시 등록 선수 ${overriddenNames.length}명을 시트 데이터로 갱신했습니다: ${overriddenNames.join(", ")}`]
        : []),
    ]);
    setPlayerQuery("");
    setFieldIds((prev) => {
      const next: string[] = [];
      const seen = new Set<string>();
      for (const id of prev) {
        const mig = migrate(id);
        if (!validIds.has(mig) || seen.has(mig)) continue;
        seen.add(mig);
        next.push(mig);
      }
      return next;
    });
    setWaitingIds((prev) => {
      const next: string[] = [];
      const seen = new Set<string>();
      for (const id of prev) {
        const mig = migrate(id);
        if (!validIds.has(mig) || seen.has(mig)) continue;
        seen.add(mig);
        next.push(mig);
      }
      return next;
    });
    setMatchQuarterLimits((prev) => {
      const next: Record<string, number> = {};
      for (const [id, val] of Object.entries(prev)) {
        const mig = migrate(id);
        if (validIds.has(mig)) next[mig] = val;
      }
      return next;
    });
    setDedicatedGks((prev) =>
      prev
        .map((gk) => {
          const mig = migrate(gk.id);
          if (mig === gk.id) return gk;
          return { ...gk, id: mig, source: "SHEET" as const };
        })
        .filter((gk) => gk.source !== "SHEET" || result.players.some((p) => p.id === gk.id)),
    );
  }

  function handleResetAll() {
    if (!window.confirm("저장된 모든 선택과 캐시를 초기화하시겠습니까?")) return;
    clearStoredAll();
    resetResults();
    setFieldIds([]);
    setDedicatedGks([]);
    setTempGuests([]);
    setTempGks([]);
    setMatchQuarterLimits({});
    setPlayers((prev) => prev.filter((p) => p.source === "SHEET"));
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
    if (!fieldIds.includes(player.id)) {
      setFieldIds((prev) => [...prev, player.id]);
    }
    setWaitingIds((prev) => prev.filter((x) => x !== player.id));
    setMatchQuarterLimits((prev) => ({ ...prev, [player.id]: prev[player.id] ?? DEFAULT_MATCH_QUARTERS }));
  }

  function addWaitingFieldPlayer(player: Player) {
    if (player.primaryPosition === "GK") {
      setWarnings((prev) => [...prev, `${player.name}은 GK입니다. 전담 GK로 추가해주세요.`]);
      return;
    }
    if (dedicatedGks.some((gk) => gk.id === player.id)) {
      setWarnings((prev) => [...prev, `${player.name}은 이미 전담 GK로 추가되어 있습니다.`]);
      return;
    }
    if (!fieldIds.includes(player.id)) {
      setFieldIds((prev) => [...prev, player.id]);
    }
    setWaitingIds((prev) => (prev.includes(player.id) ? prev : [...prev, player.id]));
    setMatchQuarterLimits((prev) => ({ ...prev, [player.id]: prev[player.id] ?? DEFAULT_MATCH_QUARTERS }));
  }

  function removeFieldPlayer(id: string) {
    setFieldIds((prev) => prev.filter((item) => item !== id));
    setWaitingIds((prev) => prev.filter((item) => item !== id));
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
    const trimmedName = guest.name.trim();
    if (!trimmedName) return;
    const existing = players.find((p) => p.source === "SHEET" && p.name.trim() === trimmedName);
    if (existing) {
      if (!fieldIds.includes(existing.id)) {
        setFieldIds((prev) => [...prev, existing.id]);
      }
      setMatchQuarterLimits((prev) => ({ ...prev, [existing.id]: prev[existing.id] ?? DEFAULT_MATCH_QUARTERS }));
      setWaitingIds((prev) => prev.filter((x) => x !== existing.id));
      setWarnings((prev) => [...prev, `${trimmedName}은 이미 시트에 있어 임시 등록 대신 해당 선수를 필드로 추가했습니다.`]);
      resetGuest();
      return;
    }
    const player: Player = {
      id: `temp_${Date.now()}_${guest.name}`,
      source: "TEMP_GUEST",
      memberType: "GUEST",
      active: true,
      name: trimmedName,
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
    setTempGuests((prev) => [...prev, player]);
    setFieldIds((prev) => [...prev, player.id]);
    setMatchQuarterLimits((prev) => ({ ...prev, [player.id]: DEFAULT_MATCH_QUARTERS }));
    resetGuest();
  }

  function addTempGk() {
    if (!guest.name.trim()) return;
    const newGk: DedicatedGoalkeeper = {
      id: `temp_gk_${Date.now()}_${guest.name}`,
      source: "TEMP_GK",
      name: guest.name.trim(),
      memo: guest.memo || undefined,
    };
    setDedicatedGks((prev) => [...prev, newGk]);
    setTempGks((prev) => [...prev, newGk]);
    resetGuest();
  }

  function setQuarterLimit(playerId: string, value: number) {
    setMatchQuarterLimits((prev) => ({ ...prev, [playerId]: value }));
  }

  function runPlanner() {
    resetResults();
    try {
      if (plannerMode === "MATCH") {
        setMatchResult(planMatchLineup(activeFieldPlayers, dedicatedGks, matchQuarterLimits));
      } else {
        const variants = balanceTeamsVariants(activeFieldPlayers, 10);
        setTeamVariants(variants);
        setSelectedVariantIdx(0);
        setTeamResult(variants[0]);
      }
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  function selectVariant(idx: number) {
    if (idx < 0 || idx >= teamVariants.length) return;
    setSelectedVariantIdx(idx);
    setTeamResult(teamVariants[idx]);
    setSwapSelection(null);
    setLineupResult(null);
    setTeamsConfirmed(false);
  }

  function handleConfirmTeams() {
    if (!teamResult) return;
    try {
      const lineup = generateLineups(teamResult.teamA, teamResult.teamB, dedicatedGks, waitingPlayers);
      setLineupResult(lineup);
      setTeamsConfirmed(true);
      setSwapSelection(null);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  function handleReadjustTeams() {
    setLineupResult(null);
    setTeamsConfirmed(false);
  }

  function handleGroupTarget(targetTeam: "A" | "B", targetGroup: PositionGroup) {
    if (!teamResult || teamsConfirmed || !swapSelection) return;
    if (swapSelection.team === targetTeam) return;
    const sourceTeamPlayers = swapSelection.team === "A" ? teamResult.teamA.players : teamResult.teamB.players;
    const targetTeamPlayers = targetTeam === "A" ? teamResult.teamA.players : teamResult.teamB.players;
    const sourcePlayer = sourceTeamPlayers.find((p) => p.id === swapSelection.playerId);
    if (!sourcePlayer) return;
    const candidates = targetTeamPlayers.filter((p) => p.assignedGroup === targetGroup);
    if (candidates.length === 0) return;
    const sourceComposite = sourcePlayer.attackScore + sourcePlayer.midScore + sourcePlayer.defenseScore + sourcePlayer.activityScore;
    const closest = candidates.reduce((best, p) => {
      const cP = p.attackScore + p.midScore + p.defenseScore + p.activityScore;
      const cBest = best.attackScore + best.midScore + best.defenseScore + best.activityScore;
      return Math.abs(cP - sourceComposite) < Math.abs(cBest - sourceComposite) ? p : best;
    });
    handlePlayerClick(targetTeam, closest.id);
  }

  function handlePlayerClick(team: "A" | "B", playerId: string) {
    if (!teamResult || teamsConfirmed) return;
    if (!swapSelection) {
      setSwapSelection({ team, playerId });
      return;
    }
    if (swapSelection.team === team && swapSelection.playerId === playerId) {
      setSwapSelection(null);
      return;
    }
    if (swapSelection.team === team) {
      const teamPlayers = team === "A" ? teamResult.teamA.players : teamResult.teamB.players;
      const playerA = teamPlayers.find((p) => p.id === swapSelection.playerId);
      const playerB = teamPlayers.find((p) => p.id === playerId);
      if (!playerA || !playerB) {
        setSwapSelection(null);
        return;
      }
      if (playerA.assignedGroup === playerB.assignedGroup) {
        setSwapSelection({ team, playerId });
        return;
      }
      const reassign = (p: typeof playerA, newGroup: PositionGroup) => {
        if (p.primaryPosition === "GK") return p;
        const primaryGroup = getPositionGroup(p.primaryPosition);
        const reason = primaryGroup === newGroup
          ? "주포지션 그룹 배정"
          : hasGroup(p.secondaryPositions, newGroup)
            ? "부포지션 그룹 배정"
            : "인원 균형을 위한 포지션 변경";
        return {
          ...p,
          assignedGroup: newGroup,
          assignmentReason: reason,
          isPositionOverride: primaryGroup !== newGroup,
        };
      };
      const updated = teamPlayers.map((p) => {
        if (p.id === playerA.id) return reassign(p, playerB.assignedGroup);
        if (p.id === playerB.id) return reassign(p, playerA.assignedGroup);
        return p;
      });
      try {
        const next = team === "A"
          ? summarizeTeams(updated, teamResult.teamB.players)
          : summarizeTeams(teamResult.teamA.players, updated);
        setTeamResult(next);
        setSwapSelection(null);
      } catch (error) {
        setErrors([error instanceof Error ? error.message : String(error)]);
      }
      return;
    }
    const teamAPlayers = teamResult.teamA.players;
    const teamBPlayers = teamResult.teamB.players;
    const aPlayer = swapSelection.team === "A"
      ? teamAPlayers.find((p) => p.id === swapSelection.playerId)
      : teamAPlayers.find((p) => p.id === playerId);
    const bPlayer = swapSelection.team === "B"
      ? teamBPlayers.find((p) => p.id === swapSelection.playerId)
      : teamBPlayers.find((p) => p.id === playerId);
    if (!aPlayer || !bPlayer) {
      setSwapSelection(null);
      return;
    }
    const reassign = <T extends { primaryPosition: Player["primaryPosition"]; secondaryPositions: FieldPosition[] }>(p: T, newGroup: PositionGroup): T & { assignedGroup: PositionGroup; assignmentReason: string; isPositionOverride: boolean } => {
      if (p.primaryPosition === "GK") {
        return { ...p, assignedGroup: newGroup, assignmentReason: "주포지션 그룹 배정", isPositionOverride: false };
      }
      const primaryGroup = getPositionGroup(p.primaryPosition);
      const reason = primaryGroup === newGroup
        ? "주포지션 그룹 배정"
        : hasGroup(p.secondaryPositions, newGroup)
          ? "부포지션 그룹 배정"
          : "인원 균형을 위한 포지션 변경";
      return {
        ...p,
        assignedGroup: newGroup,
        assignmentReason: reason,
        isPositionOverride: primaryGroup !== newGroup,
      };
    };
    const newA = teamAPlayers.map((p) => (p.id === aPlayer.id ? reassign(bPlayer, aPlayer.assignedGroup) : p));
    const newB = teamBPlayers.map((p) => (p.id === bPlayer.id ? reassign(aPlayer, bPlayer.assignedGroup) : p));
    try {
      const next = summarizeTeams(newA, newB);
      setTeamResult(next);
      setSwapSelection(null);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  }

  const handleLineupQuartersChange = useCallback((quarters: LineupResult["quarters"]) => {
    clearLineupShareHash();
    setCopied(false);
    setLineupResult((prev) => {
      if (!prev || prev.quarters === quarters) return prev;
      return { ...prev, quarters };
    });
  }, []);

  async function copyLineupShareUrl(lineup: LineupResult) {
    try {
      const url = await buildLineupShareUrl(lineup);
      if (!url) return;
      await navigator.clipboard.writeText(url);
      window.history.replaceState(null, "", url);
      setCopied(true);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
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
            <button className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700" onClick={handleResetAll}>초기화</button>
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
            const isWaiting = waitingIds.includes(p.id);
            return <PlayerSearchRow key={p.id} player={p} isField={isField} isWaiting={isWaiting} isGk={isGk} onAddField={() => addFieldPlayer(p)} onRemoveField={() => removeFieldPlayer(p.id)} onAddWaiting={() => addWaitingFieldPlayer(p)} onAddGk={() => addDedicatedGk(p)} onRemoveGk={() => removeDedicatedGk(p.id)} />;
          })}
          {players.length > 0 && playerQuery.trim() && searchedPlayers.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">검색 결과가 없습니다.</p>}
          {players.length > 0 && !playerQuery.trim() && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">검색어를 입력하거나 . 을 입력하면 전체 목록을 볼 수 있습니다.</p>}
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">선수추가</h2>
        <p className="mt-1 text-xs text-slate-500">시트에 없는 용병을 정식 참석자로 추가합니다. 대기는 시트 선수만 가능 — 선수검색의 대기 버튼을 사용하세요.</p>
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
          <button className={`w-full rounded-xl px-4 py-3 font-semibold text-white ${guestRole === "GK" ? "bg-emerald-600" : "bg-violet-600"}`} onClick={guestRole === "GK" ? addTempGk : addTempGuest}>
            {guestRole === "GK" ? "임시 GK 추가" : "용병 추가"}
          </button>
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">참석자</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="정규" value={`${regularCount}명`} />
          <Stat label="용병" value={`${guestCount}명`} />
          <Stat label="대기" value={`${waitingCount}명`} />
          <Stat label="필드" value={`${activeFieldPlayers.length}명`} />
          <Stat label="GK" value={`${dedicatedGks.length}`} />
        </div>
        <h3 className="mt-5 font-semibold">필드 참석자</h3>
        <div className="mt-2 flex flex-wrap gap-2">{fieldPlayers.map((p) => {
          const waitingState = isWaitingPlayer(p);
          const tone = waitingState ? "waiting" : p.memberType === "GUEST" ? "guest" : "regular";
          return <Chip key={p.id} label={`${p.name}(${p.primaryPosition})`} tone={tone} badge={<StaffRoleBadge role={extractStaffRole(p.memo)} compact />} onRemove={() => removeFieldPlayer(p.id)} />;
        })}</div>
        <h3 className="mt-5 font-semibold">전담 GK</h3>
        <div className="mt-2 flex flex-wrap gap-2">{dedicatedGks.map((gk) => <Chip key={gk.id} label={gk.name} badge={<StaffRoleBadge role={extractStaffRole(gk.memo)} compact />} onRemove={() => removeDedicatedGk(gk.id)} />)}</div>
      </section>

      {plannerMode === "MATCH" && fieldPlayers.length > 0 && (
        <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">매치 출전 쿼터 설정</h2>
          <p className="mt-1 text-sm text-slate-600">자동 생성 전에 선수별로 몇 쿼터 뛸지 정하세요. 기본값은 3Q입니다.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fieldPlayers.map((player) => (
              <div key={player.id} className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="truncate text-sm font-bold">{player.name}</p>
                    <StaffRoleBadge role={extractStaffRole(player.memo)} compact />
                  </div>
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

      {teamResult && (
        <TeamResultView
          result={teamResult}
          confirmed={teamsConfirmed}
          selection={swapSelection}
          variantCount={teamVariants.length}
          selectedVariantIdx={selectedVariantIdx}
          onSelectVariant={selectVariant}
          onPlayerClick={handlePlayerClick}
          onGroupTarget={handleGroupTarget}
          onConfirm={handleConfirmTeams}
          onReadjust={handleReadjustTeams}
        />
      )}
      {lineupResult && (
        <LineupResultView
          result={lineupResult}
          copied={copied}
          onCopyShareUrl={copyLineupShareUrl}
          onQuartersChange={handleLineupQuartersChange}
        />
      )}
      {matchResult && <MatchResultView result={matchResult} />}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="text-sm font-semibold">
            {plannerMode === "BALANCE" ? "내부전" : "매치"} · 필드 {activeFieldPlayers.length}명{waitingCount > 0 ? ` (대기 ${waitingCount})` : ""} · 전담 GK {dedicatedGks.length}
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

function Chip({ label, onRemove, tone = "regular", badge }: { label: string; onRemove: () => void; tone?: "regular" | "guest" | "waiting"; badge?: ReactNode }) {
  const className = tone === "waiting"
    ? "bg-orange-100 text-orange-800"
    : tone === "guest"
      ? "bg-violet-100 text-violet-800"
      : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ${className}`}>
      <span>{label}</span>
      {badge}
      <button className="font-bold opacity-70" onClick={onRemove}>×</button>
    </span>
  );
}

function PlayerSearchRow({ player, isField, isWaiting, isGk, onAddField, onRemoveField, onAddWaiting, onAddGk, onRemoveGk }: { player: Player; isField: boolean; isWaiting: boolean; isGk: boolean; onAddField: () => void; onRemoveField: () => void; onAddWaiting: () => void; onAddGk: () => void; onRemoveGk: () => void }) {
  const secondary = player.secondaryPositions.length > 0 ? player.secondaryPositions.join(",") : "-";
  const isSheetGk = player.primaryPosition === "GK";
  const fieldRegular = isField && !isWaiting;
  const staffRole = extractStaffRole(player.memo);
  return (
    <div className={`rounded-2xl border p-3 ${isField || isGk ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">{player.name}</p>
            <StaffRoleBadge role={staffRole} />
            {fieldRegular && <RoleBadge role="FIELD" />}
            {isField && isWaiting && <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">대기</span>}
            {(isGk || isSheetGk) && <RoleBadge role="GK" />}
          </div>
          <p className="mt-1 text-xs text-slate-500">주 {player.primaryPosition} · 부 {secondary}</p>
          <p className="mt-0.5 text-xs text-slate-400">공격{player.attackScore} · 미드{player.midScore} · 수비{player.defenseScore} · 활동{player.activityScore}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {fieldRegular
            ? <button className="rounded-lg bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700" onClick={onRemoveField}>해제</button>
            : <button className="rounded-lg bg-blue-600 px-2.5 py-2 text-xs font-bold text-white disabled:bg-slate-300" onClick={onAddField} disabled={isGk || isSheetGk}>필드</button>}
          {isField && isWaiting
            ? <button className="rounded-lg bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700" onClick={onRemoveField}>해제</button>
            : <button className="rounded-lg bg-orange-500 px-2.5 py-2 text-xs font-bold text-white disabled:bg-slate-300" onClick={onAddWaiting} disabled={isGk || isSheetGk}>대기</button>}
          {isGk
            ? <button className="rounded-lg bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700" onClick={onRemoveGk}>해제</button>
            : <button className="rounded-lg bg-amber-500 px-2.5 py-2 text-xs font-bold text-white disabled:bg-slate-300" onClick={onAddGk} disabled={isField}>GK</button>}
        </div>
      </div>
    </div>
  );
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

function staffRoleBadgeClass(role: StaffRole): string {
  if (role === "단장") return "bg-slate-900 text-white ring-slate-900/10";
  if (role === "감독") return "bg-indigo-100 text-indigo-800 ring-indigo-200";
  return "bg-cyan-100 text-cyan-800 ring-cyan-200";
}

function StaffRoleBadge({ role, compact = false, hideOnMobile = false }: { role?: StaffRole | null; compact?: boolean; hideOnMobile?: boolean }) {
  if (!role) return null;
  const sizeClass = compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[11px]";
  const displayClass = hideOnMobile ? "hidden sm:inline-flex" : "inline-flex";
  return (
    <span className={`${displayClass} shrink-0 items-center rounded-full font-black leading-none ring-1 ${sizeClass} ${staffRoleBadgeClass(role)}`} title={role}>
      {role}
    </span>
  );
}

function staffRoleChipClass(role?: StaffRole | null): string {
  if (role === "단장") return "bg-slate-900 text-white ring-slate-900 border-b-2 border-slate-500";
  if (role === "감독") return "bg-white text-indigo-950 ring-indigo-300 border-b-2 border-indigo-500";
  if (role === "코치") return "bg-white text-cyan-950 ring-cyan-300 border-b-2 border-cyan-500";
  return "bg-white text-slate-700 ring-slate-200 border-b-2 border-transparent";
}

function staffRolePitchClass(role?: StaffRole | null): string {
  if (role === "단장") return "bg-slate-900 text-white ring-1 ring-slate-900/30 border-b-2 border-slate-500";
  if (role === "감독") return "bg-indigo-50 text-indigo-950 ring-1 ring-indigo-300 border-b-2 border-indigo-500";
  if (role === "코치") return "bg-cyan-50 text-cyan-950 ring-1 ring-cyan-300 border-b-2 border-cyan-500";
  return "border-b-2 border-transparent";
}

function MetricCard({ label, a, b, highlight }: { label: string; a: number; b: number; highlight?: boolean }) {
  const containerClass = highlight ? "rounded-2xl bg-slate-900 p-3 text-white" : "rounded-2xl bg-slate-50 p-3";
  const labelClass = highlight ? "text-xs font-bold text-slate-300" : "text-xs font-bold text-slate-500";
  const subLabelClass = highlight ? "text-xs text-slate-400" : "text-xs text-slate-500";
  return (
    <div className={containerClass}>
      <p className={labelClass}>{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div><p className={subLabelClass}>{formatTeamName("A")}</p><p className="text-lg font-black">{a}</p></div>
        <div className="text-center"><p className={subLabelClass}>차이</p><p className="text-sm font-bold">{Math.abs(a - b)}</p></div>
        <div className="text-right"><p className={subLabelClass}>{formatTeamName("B")}</p><p className="text-lg font-black">{b}</p></div>
      </div>
    </div>
  );
}

function TeamResultView({
  result,
  confirmed,
  selection,
  variantCount,
  selectedVariantIdx,
  onSelectVariant,
  onPlayerClick,
  onGroupTarget,
  onConfirm,
  onReadjust,
}: {
  result: TeamBalanceResult;
  confirmed: boolean;
  selection: SwapSelection;
  variantCount: number;
  selectedVariantIdx: number;
  onSelectVariant: (idx: number) => void;
  onPlayerClick: (team: "A" | "B", playerId: string) => void;
  onGroupTarget: (targetTeam: "A" | "B", targetGroup: PositionGroup) => void;
  onConfirm: () => void;
  onReadjust: () => void;
}) {
  const s = result.summary;
  const totalA = s.attackScoreA + s.midScoreA + s.defenseScoreA + s.activityA;
  const totalB = s.attackScoreB + s.midScoreB + s.defenseScoreB + s.activityB;
  const overridesA = result.teamA.players.filter((p) => p.isPositionOverride).length;
  const overridesB = result.teamB.players.filter((p) => p.isPositionOverride).length;
  return (
    <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold">팀 분배 결과</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${qualityBadgeClass(result.quality)}`}>{result.quality}</span>
        {!confirmed && <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">조정 가능</span>}
      </div>
      {result.warnings.length > 0 && <div className="mt-4"><MessageBox title="팀 경고" items={result.warnings} tone="warning" /></div>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="공격 점수" a={s.attackScoreA} b={s.attackScoreB} />
        <MetricCard label="미드 점수" a={s.midScoreA} b={s.midScoreB} />
        <MetricCard label="수비 점수" a={s.defenseScoreA} b={s.defenseScoreB} />
        <MetricCard label="활동량" a={s.activityA} b={s.activityB} />
        <MetricCard label="총합" a={totalA} b={totalB} highlight />
        <MetricCard label="정규" a={s.regularA} b={s.regularB} />
        <MetricCard label="용병" a={s.guestA} b={s.guestB} />
        <MetricCard label="포지션 변경자" a={overridesA} b={overridesB} />
      </div>
      {!confirmed && (
        <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
          선수를 한 명 누르면 선택되고, 다른 팀 선수를 누르면 자리를 바꿔요. <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-900">노란 테두리</span>는 종합 점수(공+미+수+활)가 ±3 이내라 swap해도 균형이 잘 유지되는 후보예요. 조정이 끝나면 <strong>팀 확정</strong> 버튼을 누르세요.
        </p>
      )}
      {selection && (() => {
        const sourcePlayers = selection.team === "A" ? result.teamA.players : result.teamB.players;
        const sel = sourcePlayers.find((p) => p.id === selection.playerId);
        if (!sel) return null;
        const composite = sel.attackScore + sel.midScore + sel.defenseScore + sel.activityScore;
        const secondary = sel.secondaryPositions.length > 0 ? sel.secondaryPositions.join(",") : "-";
        const staffRole = extractStaffRole(sel.memo);
        return (
          <div className="fixed inset-x-3 bottom-24 z-30 mx-auto max-w-3xl rounded-2xl border border-blue-300 bg-blue-50/95 p-3 shadow-xl backdrop-blur sm:bottom-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-blue-900">선택: {formatTeamName(selection.team)} · {sel.name}</p>
                  <StaffRoleBadge role={staffRole} />
                </div>
                <p className="text-xs text-blue-800">주포 {sel.primaryPosition} · 부포 {secondary} · 종합 {composite}</p>
              </div>
              <p className="text-xs font-mono text-blue-900">공 {sel.attackScore} · 미 {sel.midScore} · 수 {sel.defenseScore} · 활 {sel.activityScore}</p>
            </div>
          </div>
        );
      })()}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <TeamCard
          title={formatTeamName("A")}
          players={result.teamA.players}
          team="A"
          selection={selection}
          otherTeamPlayers={result.teamB.players}
          onPlayerClick={onPlayerClick}
          onGroupTarget={onGroupTarget}
          interactive={!confirmed}
          groupScores={{ ATTACK: s.attackScoreA, MID: s.midScoreA, DEFENSE: s.defenseScoreA }}
        />
        <TeamCard
          title={formatTeamName("B")}
          players={result.teamB.players}
          team="B"
          selection={selection}
          otherTeamPlayers={result.teamA.players}
          onPlayerClick={onPlayerClick}
          onGroupTarget={onGroupTarget}
          interactive={!confirmed}
          groupScores={{ ATTACK: s.attackScoreB, MID: s.midScoreB, DEFENSE: s.defenseScoreB }}
        />
      </div>
      <p className="mt-4 text-xs text-slate-500"><span className="font-bold">*</span> 부포지션으로 배정된 선수 · <span className="font-bold">**</span> 인원 균형을 위해 주·부와 무관한 포지션으로 강제 배정된 선수</p>
      {variantCount > 1 && !confirmed && (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 px-3 py-3">
          <span className="text-xs font-semibold text-slate-500">버전</span>
          {Array.from({ length: variantCount }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`min-w-[2.25rem] rounded-lg px-2.5 py-1.5 text-sm font-bold ${i === selectedVariantIdx ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"}`}
              onClick={() => onSelectVariant(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
      <div className="mt-5 flex justify-end">
        {confirmed ? (
          <button className="w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold sm:w-auto" onClick={onReadjust}>팀 다시 조정</button>
        ) : (
          <button className="w-full rounded-xl bg-emerald-600 px-5 py-3 text-base font-bold text-white sm:w-auto" onClick={onConfirm}>팀 확정 → 라인업 생성</button>
        )}
      </div>
    </section>
  );
}

function qualityBadgeClass(quality: TeamBalanceResult["quality"]): string {
  if (quality === "좋음") return "bg-emerald-100 text-emerald-700";
  if (quality === "주의") return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function overrideMark(reason: string): string {
  if (reason === "부포지션 그룹 배정") return "*";
  if (reason === "인원 균형을 위한 포지션 변경") return "**";
  return "";
}

function TeamCard({
  title,
  players,
  team,
  selection,
  otherTeamPlayers,
  onPlayerClick,
  onGroupTarget,
  interactive,
  groupScores,
}: {
  title: string;
  players: TeamBalanceResult["teamA"]["players"];
  team: "A" | "B";
  selection: SwapSelection;
  otherTeamPlayers: TeamBalanceResult["teamA"]["players"];
  onPlayerClick: (team: "A" | "B", playerId: string) => void;
  onGroupTarget: (targetTeam: "A" | "B", targetGroup: PositionGroup) => void;
  interactive: boolean;
  groupScores: Record<PositionGroup, number>;
}) {
  const selectedPlayer = selection
    ? (selection.team === team
        ? players.find((p) => p.id === selection.playerId)
        : otherTeamPlayers.find((p) => p.id === selection.playerId))
    : undefined;
  const selectedComposite = selectedPlayer
    ? selectedPlayer.attackScore + selectedPlayer.midScore + selectedPlayer.defenseScore + selectedPlayer.activityScore
    : null;
  const showSwapHints = selection != null && selection.team !== team;
  return (
    <div className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${teamBorderClass(team)}`}>
      <div className={`h-2 ${teamAccentClass(team)}`} />
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <span className={`rounded-full px-3 py-1 text-sm font-black ${teamPillClass(team)}`}>{title}</span>
        <span className="text-xs font-bold text-slate-500">팀 분배</span>
      </div>
      <div className="p-4 pt-1">
        {(["ATTACK", "MID", "DEFENSE"] as PositionGroup[]).map((g) => {
          const score = groupScores[g];
          return (
            <div key={g} className="mt-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GroupBadge group={g} />
                  {showSwapHints && interactive && (
                    <button
                      type="button"
                      className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900 hover:bg-amber-300"
                      onClick={() => onGroupTarget(team, g)}
                      title="선택한 선수를 이 그룹으로 보내기"
                    >
                      여기로
                    </button>
                  )}
                </div>
                <span className="text-xs font-bold text-slate-600">합계 {score}</span>
              </div>
              <div className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${players.filter((p) => p.assignedGroup === g).length}, minmax(0, 1fr))` }}>
                {players.filter((p) => p.assignedGroup === g).map((p) => {
                  const isSelected = selection?.team === team && selection.playerId === p.id;
                  const composite = p.attackScore + p.midScore + p.defenseScore + p.activityScore;
                  const isSwapHint = showSwapHints && selectedComposite != null && Math.abs(composite - selectedComposite) <= 3;
                  const staffRole = extractStaffRole(p.memo);
                  const baseClass = "min-w-0 rounded-lg px-1 py-0.5 text-center transition border";
                  const stateClass = isSelected
                    ? teamSelectedPlayerClass(team)
                    : isSwapHint
                      ? "bg-amber-50 text-slate-700 border-amber-300 hover:bg-amber-100 cursor-pointer"
                      : interactive
                        ? `bg-slate-50 text-slate-700 border-transparent ${teamHoverClass(team)} cursor-pointer`
                        : "bg-slate-50 text-slate-700 border-transparent";
                  const statClass = isSelected ? teamSelectedStatClass(team) : "text-slate-500";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      title={`${staffRole ? `${staffRole} · ` : ""}${p.assignmentReason} · 공${p.attackScore} 미${p.midScore} 수${p.defenseScore} 활${p.activityScore}`}
                      className={`${baseClass} ${stateClass}`}
                      disabled={!interactive}
                      onClick={() => onPlayerClick(team, p.id)}
                    >
                      <div className="flex min-w-0 items-center justify-center gap-0.5">
                        <span className="truncate text-[11px] font-bold leading-tight">{p.name}{overrideMark(p.assignmentReason)}</span>
                        <StaffRoleBadge role={staffRole} compact hideOnMobile />
                      </div>
                      <div className={`truncate font-mono text-[9px] leading-tight ${statClass}`}>
                        {p.attackScore}/{p.midScore}/{p.defenseScore}/{p.activityScore}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function downloadElementAsImage(elem: HTMLElement, filename: string) {
  const html2canvas = (await import("html2canvas")).default;
  const canvas = await html2canvas(elem, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
  await new Promise<void>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve();
      }, 200);
    }, "image/png");
  });
}

type LineupSection = "attack" | "mid" | "defense" | "gk" | "bench";

type PlayerCount = { field: number; gk: number };
type OverviewPlayer = { name: string; staffRole?: StaffRole };

const OVERVIEW_GROUPS: Array<{ group: PositionGroup; label: string }> = [
  { group: "ATTACK", label: "공격" },
  { group: "MID", label: "미드" },
  { group: "DEFENSE", label: "수비" },
];

function formatCount(c: PlayerCount | undefined): string {
  if (!c) return "";
  const gkPart = c.gk > 0 ? `·G${c.gk > 1 ? c.gk : ""}` : "";
  return `(${c.field}${gkPart})`;
}

function teamPanelClass(team: TeamName): string {
  return team === "A"
    ? "border-slate-200 bg-white shadow-sm ring-1 ring-lime-200/70"
    : "border-slate-200 bg-white shadow-sm ring-1 ring-orange-200/70";
}

function teamBorderClass(team: TeamName): string {
  return team === "A"
    ? "border-lime-300"
    : "border-orange-300";
}

function teamAccentClass(team: TeamName): string {
  return team === "A"
    ? "bg-lime-400"
    : "bg-orange-500";
}

function teamPillClass(team: TeamName): string {
  return team === "A"
    ? "bg-lime-300 text-lime-950"
    : "bg-orange-500 text-white";
}

function teamHoverClass(team: TeamName): string {
  return team === "A"
    ? "hover:bg-lime-50 hover:border-lime-200"
    : "hover:bg-orange-50 hover:border-orange-200";
}

function teamSelectedPlayerClass(team: TeamName): string {
  return team === "A"
    ? "bg-lime-300 text-lime-950 shadow-md border-lime-500"
    : "bg-orange-500 text-white shadow-md border-orange-600";
}

function teamSelectedStatClass(team: TeamName): string {
  return team === "A" ? "text-lime-800" : "text-orange-100";
}

function overviewGroupPillClass(group: PositionGroup): string {
  if (group === "ATTACK") return "bg-rose-100 text-rose-700 ring-rose-200";
  if (group === "MID") return "bg-sky-100 text-sky-700 ring-sky-200";
  return "bg-emerald-100 text-emerald-700 ring-emerald-200";
}

function TeamOverviewCard({ team, groups }: { team: TeamName; groups: Record<PositionGroup, OverviewPlayer[]> }) {
  const columnCount = Math.max(1, ...OVERVIEW_GROUPS.map(({ group }) => groups[group].length));
  return (
    <div className={`overflow-hidden rounded-xl border ${teamPanelClass(team)}`}>
      <div className={`h-1.5 ${teamAccentClass(team)}`} />
      <div className="flex items-center justify-between gap-2 px-2 py-2 sm:px-3 sm:py-3">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-black sm:px-3 sm:py-1 sm:text-sm ${teamPillClass(team)}`}>{formatTeamName(team)}</span>
        <span className="text-[10px] font-bold text-slate-500 sm:text-xs">팀 배정</span>
      </div>
      <div className="space-y-1.5 px-2 pb-2 sm:space-y-2 sm:px-3 sm:pb-3">
        {OVERVIEW_GROUPS.map(({ group, label }) => (
          <div key={group} className="grid grid-cols-[2.1rem_minmax(0,1fr)] items-center gap-1 sm:grid-cols-[2.8rem_minmax(0,1fr)] sm:gap-1.5">
            <span className={`inline-flex justify-center rounded-full px-1 py-0.5 text-[10px] font-black ring-1 sm:px-2.5 sm:py-1 sm:text-xs ${overviewGroupPillClass(group)}`}>{label}</span>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
              {groups[group].map((player) => (
                <span key={player.name} className={`inline-flex h-5 min-w-0 items-center justify-center gap-1 rounded-full px-1 text-[10px] font-bold shadow-sm ring-1 sm:h-auto sm:px-2.5 sm:py-1 sm:text-xs ${staffRoleChipClass(player.staffRole)}`}>
                  <span className="truncate">{player.name}</span>
                  <StaffRoleBadge role={player.staffRole} compact hideOnMobile />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PitchChip({ name, accent, selected, onClick, count, staffRole, fill = false }: { name: string; accent?: "gk" | "bench"; selected?: boolean; onClick?: () => void; count?: PlayerCount; staffRole?: StaffRole; fill?: boolean }) {
  const base = "inline-flex h-7 min-w-0 items-center justify-center gap-0.5 rounded-full px-1 text-[11px] font-extrabold shadow-sm whitespace-nowrap transition sm:h-auto sm:gap-1 sm:px-3 sm:py-1.5 sm:text-sm sm:shadow";
  const palette = accent === "gk"
    ? "bg-amber-300 text-amber-950"
    : accent === "bench"
      ? "bg-slate-200 text-slate-700"
      : "bg-white text-slate-900";
  const ring = selected ? "ring-2 ring-offset-1 ring-yellow-400" : "";
  const Tag = onClick ? "button" : "span";
  const countText = formatCount(count);
  return (
    <Tag type={onClick ? "button" : undefined} className={`${base} ${fill ? "w-full sm:w-auto" : "w-[4.2rem] sm:w-auto sm:min-w-[4.75rem]"} ${palette} ${staffRolePitchClass(staffRole)} ${ring}`} onClick={onClick} title={staffRole ? `${name} · ${staffRole}` : undefined}>
      <span className="truncate">{name}</span>
      <StaffRoleBadge role={staffRole} compact hideOnMobile />
      {countText && <span className="ml-1 hidden text-[11px] font-bold opacity-70 sm:inline">{countText}</span>}
    </Tag>
  );
}

function PitchRow({ players, section, selectedKey, onSelect, counts, staffRoles }: { players: string[]; section: LineupSection; selectedKey: string | null; onSelect?: (section: LineupSection, name: string) => void; counts?: Map<string, PlayerCount>; staffRoles?: Map<string, StaffRole> }) {
  if (!players.length) return <div className="flex h-6" />;
  return (
    <div className="grid items-center justify-center gap-1 px-1 sm:flex sm:flex-wrap sm:justify-around sm:gap-1.5 sm:px-2" style={{ gridTemplateColumns: `repeat(${players.length}, minmax(0, 4.2rem))` }}>
      {players.map((name) => (
        <PitchChip key={name} name={name} selected={selectedKey === `${section}|${name}`} onClick={onSelect ? () => onSelect(section, name) : undefined} count={counts?.get(name)} staffRole={staffRoles?.get(name)} fill />
      ))}
    </div>
  );
}

function Pitch({ title, gk, attack, mid, defense, bench, accent = "emerald", selectedKey, onSelect, counts, staffRoles }: {
  title: string;
  gk: string;
  attack: string[];
  mid: string[];
  defense: string[];
  bench: string[];
  accent?: "emerald" | "orange";
  selectedKey?: string | null;
  onSelect?: (section: LineupSection, name: string) => void;
  counts?: Map<string, PlayerCount>;
  staffRoles?: Map<string, StaffRole>;
}) {
  const headerClass = accent === "orange" ? "from-orange-500 to-orange-700" : "from-lime-500 to-emerald-600";
  const fieldClass = accent === "orange" ? "from-orange-400 to-orange-600" : "from-lime-400 to-emerald-600";
  const sel = selectedKey ?? null;
  return (
    <div className="overflow-hidden rounded-2xl shadow-lg">
      <div className={`bg-gradient-to-r ${headerClass} px-3 py-2 text-white sm:px-5 sm:py-3`}>
        <p className="text-base font-black sm:text-lg">{title}</p>
      </div>
      <div className={`relative bg-gradient-to-b ${fieldClass} p-2 sm:p-3`} style={{ aspectRatio: "5 / 4" }}>
        <div className="absolute inset-3 rounded-lg border-2 border-white/40" />
        <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-white/40" />
        <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/40" />
        <div className="absolute left-1/4 right-1/4 top-3 h-9 rounded-b-md border-2 border-t-0 border-white/40" />
        <div className="absolute left-1/4 right-1/4 bottom-3 h-9 rounded-t-md border-2 border-b-0 border-white/40" />
        <div className="relative flex h-full flex-col justify-around py-1">
          <PitchRow players={attack} section="attack" selectedKey={sel} onSelect={onSelect} counts={counts} staffRoles={staffRoles} />
          <PitchRow players={mid} section="mid" selectedKey={sel} onSelect={onSelect} counts={counts} staffRoles={staffRoles} />
          <PitchRow players={defense} section="defense" selectedKey={sel} onSelect={onSelect} counts={counts} staffRoles={staffRoles} />
          <div className="flex justify-center">
            <PitchChip name={gk} accent="gk" selected={sel === `gk|${gk}`} onClick={onSelect ? () => onSelect("gk", gk) : undefined} count={counts?.get(gk)} staffRole={staffRoles?.get(gk)} />
          </div>
        </div>
      </div>
      <div className="bg-slate-50 px-4 py-3">
        <p className="text-xs font-bold text-slate-500">대기</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {bench.length === 0 ? (
            <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-500">없음</span>
          ) : (
            bench.map((name) => (
              <PitchChip key={name} name={name} accent="bench" selected={sel === `bench|${name}`} onClick={onSelect ? () => onSelect("bench", name) : undefined} count={counts?.get(name)} staffRole={staffRoles?.get(name)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function swapInsideQuarter(q: LineupResult["quarters"][0], sec1: LineupSection, name1: string, sec2: LineupSection, name2: string): LineupResult["quarters"][0] {
  const setSection = (
    target: LineupResult["quarters"][0],
    section: LineupSection,
    oldName: string,
    newName: string,
  ): LineupResult["quarters"][0] => {
    if (section === "gk") return { ...target, gk: newName };
    const arr = (target[section] as string[]).map((n) => (n === oldName ? newName : n));
    return { ...target, [section]: arr };
  };
  let updated = setSection(q, sec1, name1, name2);
  updated = setSection(updated, sec2, name2, name1);
  return updated;
}

function LineupResultView({
  result,
  copied,
  onCopyShareUrl,
  onQuartersChange,
}: {
  result: LineupResult;
  copied: boolean;
  onCopyShareUrl: (result: LineupResult) => void;
  onQuartersChange: (quarters: LineupResult["quarters"]) => void;
}) {
  const [quarters, setQuarters] = useState(result.quarters);
  const [selection, setSelection] = useState<{ key: string; section: LineupSection; name: string } | null>(null);
  const [quarterSwapKey, setQuarterSwapKey] = useState<string | null>(null);
  const refs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  useEffect(() => {
    setQuarters(result.quarters);
    setSelection(null);
    setQuarterSwapKey(null);
  }, [result]);

  function handleQuarterSwap(key: string) {
    if (!quarterSwapKey) {
      setQuarterSwapKey(key);
      setSelection(null);
      return;
    }
    if (quarterSwapKey === key) {
      setQuarterSwapKey(null);
      return;
    }
    const team1 = quarterSwapKey.split("-")[0];
    const team2 = key.split("-")[0];
    if (team1 !== team2) {
      setQuarterSwapKey(key);
      return;
    }
    const firstIdx = quarters.findIndex((q) => `${q.team}-${q.quarter}` === quarterSwapKey);
    const secondIdx = quarters.findIndex((q) => `${q.team}-${q.quarter}` === key);
    if (firstIdx < 0 || secondIdx < 0) {
      setQuarterSwapKey(null);
      return;
    }
    const reordered = [...quarters];
    const first = reordered[firstIdx];
    reordered[firstIdx] = reordered[secondIdx];
    reordered[secondIdx] = first;

    const nextQuarterByTeam: Record<TeamName, number> = { A: 1, B: 1 };
    const next = reordered.map((q) => {
      const quarter = nextQuarterByTeam[q.team] as Quarter;
      nextQuarterByTeam[q.team] += 1;
      return { ...q, quarter };
    });
    setQuarters(next);
    onQuartersChange(next);
    setQuarterSwapKey(null);
    setSelection(null);
  }

  const countsByTeam = useMemo(() => {
    const map = new Map<string, Map<string, PlayerCount>>();
    for (const q of quarters) {
      let teamMap = map.get(q.team);
      if (!teamMap) {
        teamMap = new Map<string, PlayerCount>();
        map.set(q.team, teamMap);
      }
      const bumpField = (name: string) => {
        const c = teamMap!.get(name) ?? { field: 0, gk: 0 };
        teamMap!.set(name, { field: c.field + 1, gk: c.gk });
      };
      const bumpGk = (name: string) => {
        if (!name || name === "없음") return;
        const c = teamMap!.get(name) ?? { field: 0, gk: 0 };
        teamMap!.set(name, { field: c.field, gk: c.gk + 1 });
      };
      q.attack.forEach(bumpField);
      q.mid.forEach(bumpField);
      q.defense.forEach(bumpField);
      bumpGk(q.gk);
    }
    return map;
  }, [quarters]);

  const staffRolesByName = useMemo(() => {
    const map = new Map<string, StaffRole>();
    for (const summary of result.playerSummaries) {
      if (summary.staffRole) map.set(summary.playerName, summary.staffRole);
    }
    Object.entries(result.staffRoles ?? {}).forEach(([name, role]) => {
      map.set(name, role);
    });
    return map;
  }, [result.playerSummaries, result.staffRoles]);

  function handleSelect(key: string, section: LineupSection, name: string) {
    if (!selection) {
      setSelection({ key, section, name });
      return;
    }
    if (selection.key === key && selection.section === section && selection.name === name) {
      setSelection(null);
      return;
    }
    // 다른 쿼터 클릭 시: 선택 옮김
    if (selection.key !== key) {
      setSelection({ key, section, name });
      return;
    }
    if (selection.section === section && selection.name === name) {
      setSelection(null);
      return;
    }
    // 같은 쿼터 내: 대기 ↔ 필드/GK swap만 허용 (필드 안 다른 포지션끼리 swap 비활성)
    const oneIsBench = selection.section === "bench" || section === "bench";
    if (!oneIsBench) {
      setSelection({ key, section, name });
      return;
    }
    const next = quarters.map((q) => {
      const qKey = `${q.team}-${q.quarter}`;
      if (qKey !== key) return q;
      return swapInsideQuarter(q, selection.section, selection.name, section, name);
    });
    setQuarters(next);
    onQuartersChange(next);
    setSelection(null);
  }

  const combinedRef = useRef<HTMLDivElement | null>(null);
  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);
  async function downloadCombined() {
    if (!combinedRef.current) return;
    await downloadElementAsImage(combinedRef.current, `dev_fc_lineup_${today}.png`);
  }

  const teamOverview = useMemo(() => {
    const grouped: Record<TeamName, Record<PositionGroup, OverviewPlayer[]>> = {
      A: { ATTACK: [], MID: [], DEFENSE: [] },
      B: { ATTACK: [], MID: [], DEFENSE: [] },
    };
    for (const s of result.playerSummaries) {
      const teamKey = s.team;
      grouped[teamKey][s.assignedGroup].push({
        name: s.playerName,
        staffRole: s.staffRole ?? staffRolesByName.get(s.playerName),
      });
    }
    return grouped;
  }, [result.playerSummaries, staffRolesByName]);

  return (
    <section id="lineup-result" className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">라인업 결과</h2>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700" onClick={() => onCopyShareUrl({ ...result, quarters })}>{copied ? "URL 복사됨" : "압축 조정 URL 복사"}</button>
          <button className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white" onClick={downloadCombined}>라인업 확정 (이미지 저장)</button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">필드/GK 선수와 <span className="font-bold">대기</span> 선수만 자리를 바꿀 수 있어요. 쿼터 순서는 각 피치 아래 <span className="font-bold">쿼터 순서 바꾸기</span> 버튼으로 조정하면 위에서부터 1~4Q로 다시 정렬됩니다. 코치별 미세조정은 <span className="font-bold">압축 조정 URL 복사</span>로 현재 상태를 공유하세요.</p>
      {result.warnings.length > 0 && <div className="mt-4"><MessageBox title="라인업 경고" items={result.warnings} tone="warning" /></div>}

      <div ref={combinedRef} className="mt-4 rounded-2xl border-2 border-slate-300 bg-white p-2 sm:p-5">
        <div className="mb-2 flex items-baseline justify-center gap-2 sm:mb-3">
          <h3 className="text-base font-black text-slate-900 sm:text-lg">DEV FC 라인업</h3>
          <span className="text-xs font-semibold text-slate-500 sm:text-sm">{today}</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2 md:gap-4">
          {(["A", "B"] as const).map((team) => <TeamOverviewCard key={team} team={team} groups={teamOverview[team]} />)}
        </div>

        <div className="mt-2 grid gap-3 md:mt-4 md:grid-cols-2 md:gap-4">
          {quarters.map((q) => {
            const key = `${q.team}-${q.quarter}`;
            const selectedKey = selection && selection.key === key ? `${selection.section}|${selection.name}` : null;
            const isSwapSelected = quarterSwapKey === key;
            const isSwapPending = quarterSwapKey !== null && !isSwapSelected;
            const isSameTeamPending = isSwapPending && quarterSwapKey?.split("-")[0] === q.team;
            return (
              <div key={key} className="space-y-2">
                <div ref={(el) => { refs.current.set(key, el); }} className={isSwapSelected ? "ring-2 ring-amber-400 rounded-2xl" : ""}>
                  <Pitch
                    title={`${formatTeamName(q.team)} ${q.quarter}Q`}
                    gk={q.gk}
                    attack={q.attack}
                    mid={q.mid}
                    defense={q.defense}
                    bench={q.bench}
                    accent={q.team === "A" ? "emerald" : "orange"}
                    selectedKey={selectedKey}
                    onSelect={(section, name) => handleSelect(key, section, name)}
                    counts={countsByTeam.get(q.team)}
                    staffRoles={staffRolesByName}
                  />
                </div>
                <button
                  className={`w-full rounded-xl px-3 py-2 text-xs font-semibold ${isSwapSelected ? "bg-amber-400 text-amber-950" : isSameTeamPending ? "bg-amber-100 text-amber-900 hover:bg-amber-200" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                  onClick={() => handleQuarterSwap(key)}
                >
                  {isSwapSelected ? "선택됨 (취소)" : isSameTeamPending ? "여기와 바꾸기" : "쿼터 순서 바꾸기"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MatchResultView({ result }: { result: MatchPlanResult }) {
  const refs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const staffRolesByName = useMemo(() => {
    const map = new Map<string, StaffRole>();
    const addPlayer = (player?: { name: string; memo?: string } | null) => {
      if (!player) return;
      const role = extractStaffRole(player.memo);
      if (role) map.set(player.name, role);
    };
    result.starters.attack.forEach((item) => addPlayer(item.player));
    result.starters.mid.forEach((item) => addPlayer(item.player));
    result.starters.defense.forEach((item) => addPlayer(item.player));
    result.bench.forEach((item) => addPlayer(item.player));
    addPlayer(result.starters.gk);
    return map;
  }, [result]);

  async function downloadOne(quarter: number) {
    const key = `match-${quarter}`;
    const elem = refs.current.get(key);
    if (!elem) return;
    await downloadElementAsImage(elem, `match_${quarter}Q.png`);
  }

  async function downloadAll() {
    for (const q of result.quarters) {
      const key = `match-${q.quarter}`;
      const elem = refs.current.get(key);
      if (!elem) continue;
      await downloadElementAsImage(elem, `match_${q.quarter}Q.png`);
    }
  }

  return (
    <section className="mb-6 rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">매치 라인업 추천</h2>
        <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white" onClick={downloadAll}>전체 이미지 저장</button>
      </div>
      {result.warnings.length > 0 && <div className="mt-4"><MessageBox title="매치 경고" items={result.warnings} tone="warning" /></div>}
      <div className="mt-4 rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold">베스트 라인업</h3>
        <div className="mt-3">
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">GK</span>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
              <span>{result.starters.gk?.name ?? "없음"}</span>
              <StaffRoleBadge role={extractStaffRole(result.starters.gk?.memo)} compact />
            </span>
          </div>
        </div>
        <MatchGroup group="ATTACK" items={result.starters.attack} />
        <MatchGroup group="MID" items={result.starters.mid} />
        <MatchGroup group="DEFENSE" items={result.starters.defense} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {result.quarters.map((q) => {
          const key = `match-${q.quarter}`;
          return (
            <div key={key} className="space-y-2">
              <div ref={(el) => { refs.current.set(key, el); }}>
                <Pitch
                  title={`${q.quarter}Q`}
                  gk={q.gk}
                  attack={q.attack}
                  mid={q.mid}
                  defense={q.defense}
                  bench={q.bench}
                  staffRoles={staffRolesByName}
                />
              </div>
              <button className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700" onClick={() => downloadOne(q.quarter)}>이 화면 이미지 저장</button>
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold">후보 / 교체 우선순위</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {result.bench.map((item) => (
            <span key={item.player.id} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-3 py-1 text-sm font-semibold text-violet-800">
              <span>{item.player.name}({groupKorean(item.group)})</span>
              <StaffRoleBadge role={extractStaffRole(item.player.memo)} compact />
            </span>
          ))}
          {result.bench.length === 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">없음</span>}
        </div>
      </div>
    </section>
  );
}

function MatchGroup({ group, items }: { group: PositionGroup; items: MatchSelection[] }) {
  return (
    <div className="mt-3">
      <GroupBadge group={group} />
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item.player.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700" title={item.reason}>
            <span>{item.player.name}</span>
            <StaffRoleBadge role={extractStaffRole(item.player.memo)} compact />
          </span>
        ))}
      </div>
    </div>
  );
}

function groupKorean(group: PositionGroup): string {
  if (group === "ATTACK") return "공격";
  if (group === "MID") return "미드";
  return "수비";
}
