/* dojo-practice.jsx — Build-the-sentence exercise + inline result reveal */

function Practice({ belt, onTab, onExit, headerStreak = 4 }) {
  const [idx, setIdx] = React.useState(0);
  const [placed, setPlaced] = React.useState([]);   // indices into shuffled tiles
  const [phase, setPhase] = React.useState("solve"); // solve | right | wrong
  const ex = BUILD[idx % BUILD.length];

  // stable shuffle per exercise
  const shuffled = React.useMemo(() => {
    const a = ex.tiles.map((t, i) => ({ t, i }));
    for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
    return a;
  }, [idx]);

  const placedTiles = placed.map((p) => shuffled[p]);
  const bankLeft = shuffled.map((_, i) => i).filter((i) => !placed.includes(i));
  const complete = placed.length === ex.tiles.length;
  const built = placedTiles.map((p) => p.t).join(" ");

  function place(i) { if (phase !== "solve") return; setPlaced((p) => [...p, i]); }
  function unplace(i) { if (phase !== "solve") return; setPlaced((p) => p.filter((x) => x !== i)); }
  function check() {
    if (!complete) return;
    setPhase(built.trim() === ex.answer.trim() ? "right" : "wrong");
  }
  function next() { setPlaced([]); setPhase("solve"); setIdx((i) => i + 1); }

  const sessionDone = (idx % 10);
  const exBelt = beltByCefr(ex.cefr);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {phase === "right" && <Confetti />}

      {/* header: exit + session progress dots */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px var(--pad) 4px", height: 48 }}>
        <button onClick={onExit} aria-label="Close" style={{ all: "unset", cursor: "pointer", width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--surface-2)", color: "var(--ink-2)" }}>
          <Icon name="x" size={20} />
        </button>
        <div style={{ flex: 1, height: 12, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden" }}>
          <div className="fill" style={{ width: `${(sessionDone / 10) * 100}%` }} />
        </div>
        <StreakBadge n={headerStreak} />
      </div>

      <Body top={6} style={{ padding: "0 var(--pad)" }}>
        {/* topic + level */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 800, fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--accent)" }}>
            <Icon name="practice" size={16} /> Build the sentence
          </span>
          <BeltTag belt={exBelt} size="sm" />
        </div>

        {/* prompt: RU source */}
        <div className="card" style={{ padding: "var(--pad)", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div className="dj-bob" style={{ flexShrink: 0, marginTop: -2 }}>
            <Sensei belt={belt} size={52} mood={phase === "wrong" ? "think" : phase === "right" ? "cheer" : "happy"} />
          </div>
          <div style={{ flex: 1 }}>
            <Label style={{ marginBottom: 6 }}>Translate to English</Label>
            <div className="brand" style={{ fontSize: 21, lineHeight: 1.3, fontWeight: 700 }}>{ex.ru}</div>
          </div>
          <button aria-label="Listen" style={{ all: "unset", cursor: "pointer", color: "var(--ink-3)", padding: 4 }}><Icon name="sound" size={22} /></button>
        </div>

        {/* answer track */}
        <div className={phase === "wrong" ? "dj-shake" : ""} style={{ minHeight: 96, marginTop: 16, padding: "14px 6px", borderRadius: "var(--r)",
          background: phase === "right" ? "var(--accent-soft)" : phase === "wrong" ? "var(--bad-soft)" : "var(--surface-2)",
          border: `2px dashed ${phase === "right" ? "var(--accent)" : phase === "wrong" ? "var(--bad)" : "var(--line-2)"}`,
          display: "flex", flexWrap: "wrap", gap: 8, alignContent: "flex-start", transition: "all .2s" }}>
          {placedTiles.length === 0
            ? <div style={{ color: "var(--ink-3)", fontWeight: 600, alignSelf: "center", margin: "0 auto", fontSize: 14 }}>Tap the words below to build it…</div>
            : placedTiles.map((p, k) => (
              <button key={k} onClick={() => unplace(placed[k])} disabled={phase !== "solve"} className="dj-pop"
                style={{ all: "unset", cursor: phase === "solve" ? "pointer" : "default", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 15,
                  padding: "9px 13px", borderRadius: 10,
                  background: phase === "right" ? "var(--accent)" : phase === "wrong" ? "var(--surface)" : "var(--surface)",
                  color: phase === "right" ? "var(--accent-ink)" : "var(--ink)",
                  border: `1.5px solid ${phase === "right" ? "var(--accent)" : "var(--line-2)"}`, boxShadow: "var(--shadow-sm)" }}>
                {p.t}
              </button>
            ))}
        </div>

        {/* word bank */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginTop: 18, minHeight: 50 }}>
          {bankLeft.map((i) => (
            <button key={i} onClick={() => place(i)} disabled={phase !== "solve"}
              style={{ all: "unset", cursor: "pointer", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 15,
                padding: "11px 14px", borderRadius: 12, background: "var(--surface)", color: "var(--ink)",
                border: "1.5px solid var(--line-2)", boxShadow: "0 2px 0 var(--line-2)" }}>
              {shuffled[i].t}
            </button>
          ))}
        </div>

        {/* result panel */}
        {phase !== "solve" && (
          <div className="dj-rise" style={{ marginTop: 20, padding: "var(--pad)", borderRadius: "var(--r)",
            background: phase === "right" ? "var(--accent-soft)" : "var(--bad-soft)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 999, display: "grid", placeItems: "center",
                background: phase === "right" ? "var(--accent)" : "var(--bad)", color: "#fff" }}>
                <Icon name={phase === "right" ? "check" : "x"} size={19} sw={3} />
              </div>
              <div className="brand" style={{ fontSize: 19, fontWeight: 700, color: phase === "right" ? "var(--accent)" : "var(--bad)" }}>
                {phase === "right" ? "Clean strike!" : "Not quite"}
              </div>
              {phase === "right" && <span style={{ marginLeft: "auto", fontWeight: 800, color: "var(--gold)" }}>+12 XP</span>}
            </div>
            {phase === "wrong" && (
              <div style={{ marginTop: 10, fontSize: 15 }}>
                <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>Answer: </span>
                <span className="mono" style={{ fontWeight: 600 }}>{ex.answer}</span>
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
              <span style={{ fontWeight: 800, color: "var(--ink)" }}>💡 </span>{ex.note}
            </div>
            {phase === "right" && (
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
                <span className="dj-flicker">🔥</span> {headerStreak + 1} correct in a row!
              </div>
            )}
          </div>
        )}

        <div style={{ height: 14 }} />
      </Body>

      {/* sticky action */}
      <div style={{ padding: "10px var(--pad) 14px", background: "var(--screen)", borderTop: "1px solid var(--line)" }}>
        {phase === "solve"
          ? <button className="btn btn-primary" style={{ width: "100%" }} disabled={!complete} onClick={check}>Check</button>
          : <button className="btn btn-primary" style={{ width: "100%" }} onClick={next}>Next exercise</button>}
      </div>
    </div>
  );
}

Object.assign(window, { Practice });
