const fs = require('fs');

const p = 'src/app/page.tsx';
let s = fs.readFileSync(p, 'utf8');

function replaceAllText(from, to) {
  s = s.split(from).join(to);
}

function replaceOnce(from, to) {
  if (s.includes(from)) s = s.replace(from, to);
}

replaceAllText('primaryPosition: "ST" as Position,', 'primaryPosition: "CF" as Position,');
replaceAllText('setDedicatedGks([]);', 'setDedicatedGks(result.dedicatedGks);');
replaceAllText('canGk: guest.canGk,', 'canGk: true,');
replaceAllText('<Stat label="필드 GK 가능" value={`${fieldPlayers.filter((p) => p.canGk).length}명`} />', '');
replaceAllText('<MetricCard label="필드 GK 가능" a={s.fieldGkA} b={s.fieldGkB} />', '');

replaceOnce(
  '  const [guest, setGuest] = useState(emptyGuest);',
  '  const [guest, setGuest] = useState(emptyGuest);\n  const [guestRole, setGuestRole] = useState<"FIELD" | "GK">("FIELD");'
);

replaceOnce(
  '    setGuest(emptyGuest);\n  }\n\n  function addTempGk()',
  '    setGuest(emptyGuest);\n    setGuestRole("FIELD");\n  }\n\n  function addTempGk()'
);

replaceOnce(
  '    setGuest(emptyGuest);\n  }\n\n  function runPlanner()',
  '    setGuest(emptyGuest);\n    setGuestRole("FIELD");\n  }\n\n  function runPlanner()'
);

replaceOnce(
  `          <PositionButtonGroup
            label="주포지션"
            mode="single"
            selected={[guest.primaryPosition]}
            onToggle={(position) => setGuest({ ...guest, primaryPosition: position })}
          />`,
  `          <div>
            <p className="mb-2 text-sm font-semibold text-slate-600">주포지션</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={\`rounded-full px-3 py-2 text-sm font-bold \${guestRole === "GK" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}\`}
                onClick={() => setGuestRole("GK")}
              >
                GK
              </button>
              {POSITIONS.map((position) => {
                const isSelected = guestRole === "FIELD" && guest.primaryPosition === position;
                return (
                  <button
                    key={position}
                    type="button"
                    className={\`rounded-full px-3 py-2 text-sm font-bold \${isSelected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}\`}
                    onClick={() => {
                      setGuestRole("FIELD");
                      setGuest({ ...guest, primaryPosition: position });
                    }}
                  >
                    {position}
                  </button>
                );
              })}
            </div>
          </div>`
);

replaceOnce(
  `          <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2"><input type="checkbox" checked={guest.canGk} onChange={(e) => setGuest({ ...guest, canGk: e.target.checked })} /> 필드 GK 가능</label>
          <input className="rounded-xl border border-slate-300 px-3 py-2" placeholder="메모" value={guest.memo} onChange={(e) => setGuest({ ...guest, memo: e.target.value })} />`,
  `          <input className="rounded-xl border border-slate-300 px-3 py-2" placeholder="메모" value={guest.memo} onChange={(e) => setGuest({ ...guest, memo: e.target.value })} />`
);

replaceOnce(
  `          <div className="grid gap-2 sm:grid-cols-2">
            <button className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white" onClick={addTempGuest}>임시 용병 추가</button>
            <button className="rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white" onClick={addTempGk}>임시 GK 추가</button>
          </div>`,
  `          <div>
            <button
              className={\`w-full rounded-xl px-4 py-3 font-semibold text-white \${guestRole === "GK" ? "bg-emerald-600" : "bg-blue-600"}\`}
              onClick={guestRole === "GK" ? addTempGk : addTempGuest}
            >
              {guestRole === "GK" ? "임시 GK 추가" : "임시 용병 추가"}
            </button>
          </div>`
);

replaceOnce(
  `      <div className="flex flex-wrap gap-2">
        {POSITIONS.map((position) => {`,
  `      <div className="flex flex-wrap gap-2">
        {mode === "multiple" && (
          <button
            type="button"
            className={\`rounded-full px-3 py-2 text-sm font-bold \${selected.length === 0 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}\`}
            onClick={() => selected.forEach((position) => onToggle(position))}
          >
            없음
          </button>
        )}
        {POSITIONS.map((position) => {`
);

replaceOnce(
  '<h2 className="text-xl font-bold">4. 임시 용병 / 임시 GK 추가</h2>',
  '<h2 className="text-xl font-bold">4. 임시 참석자 추가</h2>'
);

replaceOnce(
  '<h3 className="mt-8 font-bold">선수별 출전표</h3>',
  '<h3 className="mt-8 hidden font-bold">선수별 출전표</h3>'
);

replaceOnce(
  '<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">\n        {result.playerSummaries.map((p) => (',
  '<div className="mt-3 hidden grid gap-3 sm:grid-cols-2 lg:grid-cols-3">\n        {result.playerSummaries.map((p) => ('
);

fs.writeFileSync(p, s);
