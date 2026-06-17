/* dojo-home.jsx — three Home directions */

function Greeting({ name = "Alex", sub }) {
  return (
    <div style={{ padding: "10px var(--pad) 0" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-3)" }}>Good evening</div>
      <div className="brand" style={{ fontSize: 27, fontWeight: 700, lineHeight: 1.1 }}>{name}</div>
      {sub && <div style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/* ============ V1 — Daily ring ============ */
function HomeRing({ belt, streak, xp, goal, onStart, onTopics, onBelt }) {
  return (
    <>
      <TopBar belt={belt} streak={streak} xp={xp} onBelt={onBelt} />
      <Body>
        <Greeting name="Alex" sub="Three drills left to hit today’s goal." />

        {/* daily goal hero */}
        <div className="card" style={{ margin: "16px var(--pad) 0", padding: "var(--pad)", display: "flex", alignItems: "center", gap: 16 }}>
          <Ring pct={(goal.done / goal.target) * 100} size={116} stroke={13}>
            <div className="brand" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{goal.done}<span style={{ color: "var(--ink-3)", fontSize: 17 }}>/{goal.target}</span></div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--ink-3)" }}>today</div>
          </Ring>
          <div style={{ flex: 1 }}>
            <div className="brand" style={{ fontSize: 18, fontWeight: 700 }}>Daily goal</div>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.45 }}>~10 min · keep your streak alive.</div>
            <div style={{ marginTop: 12 }}><Sensei belt={belt} size={46} mood="happy" /></div>
          </div>
        </div>

        {/* primary CTA */}
        <div style={{ padding: "16px var(--pad) 0" }}>
          <button onClick={onStart} className="btn" style={{ width: "100%", background: "var(--accent)", color: "var(--accent-ink)", padding: 0, boxShadow: "0 5px 0 var(--accent-press)", borderRadius: "var(--r)", overflow: "hidden", textTransform: "none" }}>
            <div style={{ width: "100%", padding: "18px 20px", display: "flex", alignItems: "center", gap: 14, textAlign: "left" }}>
              <div style={{ width: 46, height: 46, borderRadius: 14, background: "rgba(255,255,255,.18)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icon name="bolt" size={26} stroke="#fff" />
              </div>
              <div style={{ flex: 1 }}>
                <div className="brand" style={{ fontSize: 18, fontWeight: 700 }}>Daily practice</div>
                <div style={{ fontSize: 13, opacity: .9, fontWeight: 500 }}>Adaptive — we pick what you need next</div>
              </div>
              <Icon name="chevron" size={22} stroke="#fff" />
            </div>
          </button>
        </div>

        {/* topic shortcut */}
        <div style={{ padding: "12px var(--pad) 0" }}>
          <button onClick={onTopics} className="card" style={{ width: "100%", textAlign: "left", cursor: "pointer", padding: "16px var(--pad)", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: "var(--accent-soft)", display: "grid", placeItems: "center", color: "var(--accent)", flexShrink: 0 }}><Icon name="target" size={24} /></div>
            <div style={{ flex: 1 }}>
              <div className="brand" style={{ fontSize: 17, fontWeight: 700 }}>Choose a topic</div>
              <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Drill a specific grammar point</div>
            </div>
            <Icon name="chevron" size={20} stroke="var(--ink-3)" />
          </button>
        </div>

        {/* belt progress strip */}
        <BeltStrip belt={belt} pct={64} style={{ margin: "16px var(--pad) 20px" }} />
      </Body>
    </>
  );
}

/* shared: progress toward next belt */
function BeltStrip({ belt, pct, style }) {
  const nextIdx = Math.min(BELTS.length - 1, BELTS.indexOf(belt) + 1);
  const next = BELTS[nextIdx];
  return (
    <div className="card" style={{ padding: "14px var(--pad)", ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 14 }}>
          <BeltKnot belt={belt} size={22} /> {belt.name}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)" }}>{pct}% to {next.name}</span>
      </div>
      <div className="track" style={{ height: 10 }}><div className="fill" style={{ width: pct + "%" }} /></div>
    </div>
  );
}

/* ============ V2 — Belt journey (path) ============ */
function HomePath({ belt, streak, xp, onStart, onTopics, onTopic, onBelt }) {
  const byLabel = (l) => TOPICS.find((t) => t.label === l);
  const nodes = [
    { id: 1, label: "Articles", state: "done" },
    { id: 2, label: "Prepositions", state: "done" },
    { id: 3, label: "Modal verbs", state: "current" },
    { id: 4, label: "Conditionals", state: "next" },
    { id: 5, label: "Verb tenses", state: "locked" },
    { id: 6, label: "Belt test", state: "locked", test: true },
  ].map((n) => ({ ...n, topic: byLabel(n.label) }));

  const tap = (n) => {
    if (n.state === "locked") return;
    if (n.test) { onStart(); return; }
    if (n.state === "current") { onStart(); return; }
    if (n.topic) onTopic(n.topic);
  };

  return (
    <>
      <TopBar belt={belt} streak={streak} xp={xp} onBelt={onBelt} />
      <Body>
        {/* belt hero */}
        <div style={{ margin: "12px var(--pad) 0", padding: "var(--pad)", borderRadius: "var(--r-lg)",
          background: `linear-gradient(150deg, ${belt.color} 0%, ${belt.edge} 100%)`, color: belt.ink, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -18, top: -10, opacity: .9 }}><Sensei belt={belt} size={104} mood="happy" /></div>
          <Label style={{ color: belt.ink, opacity: .8 }}>Your belt</Label>
          <div className="brand" style={{ fontSize: 30, fontWeight: 700, marginTop: 2 }}>{belt.name}</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, opacity: .85, marginTop: 2 }}>CEFR {belt.cefr} · 64% to {BELTS[BELTS.indexOf(belt) + 1].name}</div>
          <div style={{ marginTop: 14, height: 9, borderRadius: 999, background: "rgba(0,0,0,.16)", width: "62%" }}>
            <div style={{ width: "64%", height: "100%", borderRadius: 999, background: belt.ink, opacity: .85 }} />
          </div>
        </div>

        {/* daily mix — adaptive shortcut (kept for parity with other layouts) */}
        <div style={{ padding: "14px var(--pad) 0" }}>
          <button onClick={onStart} className="btn" style={{ width: "100%", padding: 0, borderRadius: "var(--r)", overflow: "hidden", boxShadow: "0 5px 0 var(--accent-press)", background: "var(--accent)", color: "var(--accent-ink)", textTransform: "none" }}>
            <div style={{ width: "100%", padding: "15px 18px", display: "flex", alignItems: "center", gap: 13, textAlign: "left" }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: "rgba(255,255,255,.18)", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name="bolt" size={23} stroke="#fff" /></div>
              <div style={{ flex: 1 }}>
                <div className="brand" style={{ fontSize: 17, fontWeight: 700 }}>Daily mix</div>
                <div style={{ fontSize: 12.5, opacity: .9 }}>Adaptive — across all your topics</div>
              </div>
              <Icon name="chevron" size={20} stroke="#fff" />
            </div>
          </button>
        </div>

        <div style={{ padding: "18px var(--pad) 4px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span className="brand" style={{ fontSize: 18, fontWeight: 700 }}>Today’s path</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)" }}>2 of 6 done</span>
        </div>

        {/* the path */}
        <div style={{ padding: "8px var(--pad) 4px" }}>
          {nodes.map((n, i) => {
            const last = i === nodes.length - 1;
            const tb = n.topic ? beltByCefr(n.topic.cefr) : belt;
            const c = n.state === "done" ? "var(--accent)" : n.state === "current" ? "var(--accent)" : n.test ? belt.knot : "var(--surface-3)";
            const ink = n.state === "locked" ? "var(--ink-3)" : "var(--ink)";
            const tappable = n.state !== "locked";
            const sub = n.state === "done" ? `Mastered · ${tb.name}`
              : n.state === "current" ? "Continue →"
              : n.test ? "Earn your next belt"
              : n.state === "next" ? "Up next · tap to start"
              : "Locked";
            return (
              <div key={n.id} style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
                {/* rail */}
                <div style={{ width: 44, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <button onClick={() => tap(n)} disabled={!tappable} aria-label={n.label} style={{ all: "unset", cursor: tappable ? "pointer" : "default",
                    width: 44, height: 44, borderRadius: 999, display: "grid", placeItems: "center", flexShrink: 0,
                    background: n.state === "next" || n.state === "locked" ? "var(--surface-3)" : c,
                    border: n.state === "current" ? "3px solid var(--accent-soft-2)" : "none",
                    boxShadow: n.state === "current" ? "0 4px 0 var(--accent-press)" : "none", color: "#fff" }}>
                    {n.state === "done" ? <Icon name="check" size={22} sw={3} stroke="#fff" />
                      : n.test ? <BeltKnot belt={belt} size={24} />
                      : n.state === "locked" ? <Icon name="lock" size={18} stroke="var(--ink-3)" />
                      : <Icon name="bolt" size={20} stroke={n.state === "next" ? "var(--ink-3)" : "#fff"} />}
                  </button>
                  {!last && <div style={{ flex: 1, width: 3, background: n.state === "done" ? "var(--accent)" : "var(--line-2)", margin: "2px 0", borderRadius: 2, minHeight: 22 }} />}
                </div>
                {/* card */}
                <div style={{ flex: 1, paddingBottom: 14 }}>
                  <button onClick={() => tap(n)} disabled={!tappable} className="card" style={{ width: "100%", textAlign: "left", cursor: tappable ? "pointer" : "default",
                    padding: "13px 15px", display: "flex", alignItems: "center", gap: 10,
                    borderColor: n.state === "current" ? "var(--accent)" : "var(--line)",
                    boxShadow: n.state === "current" ? "var(--shadow-md)" : "var(--shadow-sm)",
                    opacity: n.state === "locked" ? .6 : 1 }}>
                    {!n.test && n.topic && <div style={{ width: 14, height: 14, borderRadius: 4, background: tb.color, border: `1.5px solid ${tb.edge}`, flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="brand" style={{ fontSize: 16, fontWeight: 700, color: ink }}>{n.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: n.state === "current" ? "var(--accent)" : "var(--ink-3)" }}>{sub}</div>
                    </div>
                    {n.state === "current" ? <span className="dj-bob"><Sensei belt={belt} size={40} mood="cheer" /></span>
                      : n.state === "done" && n.topic ? <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-3)" }}>{n.topic.acc}%</span>
                      : tappable ? <Icon name="chevron" size={18} stroke="var(--ink-3)" /> : null}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* browse all topics — full library access */}
        <div style={{ padding: "4px var(--pad) 22px" }}>
          <button onClick={onTopics} className="btn btn-ghost" style={{ width: "100%" }}>
            <Icon name="target" size={18} /> Browse all topics
          </button>
        </div>
      </Body>
    </>
  );
}

/* ============ V3 — Focus coach ============ */
function HomeFocus({ belt, streak, xp, onStart, onTopics, onTopic, onBelt }) {
  const weak = TOPICS.find((t) => t.weak) || TOPICS[1];
  const wb = beltByCefr(weak.cefr);
  const stats = [
    { k: "streak", label: "Day streak", val: streak, glyph: "🔥", color: "var(--fire)" },
    { k: "belt", label: belt.name, val: belt.cefr, knot: true, color: belt.knot },
    { k: "xp", label: "Total XP", val: (xp / 1000).toFixed(1) + "k", glyph: "✦", color: "var(--gold)" },
  ];
  return (
    <>
      <TopBar belt={belt} streak={streak} xp={xp} onBelt={onBelt} />
      <Body>
        {/* coach line */}
        <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px var(--pad) 0" }}>
          <span className="dj-bob"><Sensei belt={belt} size={64} mood="think" /></span>
          <div style={{ position: "relative", background: "var(--surface-2)", borderRadius: 16, borderTopLeftRadius: 4, padding: "12px 14px", flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>Let’s fix <b style={{ color: "var(--accent)" }}>{weak.label.toLowerCase()}</b> today — it’s your weakest spot.</div>
          </div>
        </div>

        {/* stat tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, padding: "18px var(--pad) 0" }}>
          {stats.map((s) => (
            <div key={s.k} className="card" style={{ padding: "13px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 18, marginBottom: 2 }}>{s.knot ? <span style={{ display: "inline-block" }}><BeltKnot belt={belt} size={22} /></span> : <span style={{ color: s.color }}>{s.glyph}</span>}</div>
              <div className="brand" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)", marginTop: 3, textTransform: "uppercase", letterSpacing: ".04em" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* focus recommendation */}
        <div style={{ padding: "18px var(--pad) 0" }}>
          <Label style={{ marginBottom: 10 }}>Recommended for you</Label>
          <button onClick={() => onTopic(weak)} className="card" style={{ width: "100%", textAlign: "left", cursor: "pointer", padding: "var(--pad)", borderColor: "var(--accent)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 12, height: 12, borderRadius: 4, background: wb.color, border: `1.5px solid ${wb.edge}` }} />
              <span className="brand" style={{ fontSize: 19, fontWeight: 700 }}>{weak.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, color: "var(--bad)", background: "var(--bad-soft)", padding: "4px 9px", borderRadius: 999 }}>{weak.acc}% acc</span>
            </div>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "8px 0 13px" }}>You miss <span className="code">{weak.hint}</span> often. 6 fresh cards ready.</div>
            <div className="track" style={{ height: 9, marginBottom: 12 }}><div className="fill" style={{ width: weak.acc + "%", background: "var(--bad)" }} /></div>
            <div className="btn btn-primary" style={{ width: "100%" }}>Train this topic</div>
          </button>
        </div>

        {/* quick chips */}
        <div style={{ padding: "18px var(--pad) 0" }}>
          <Label style={{ marginBottom: 10 }}>Or jump into</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
            <button onClick={onStart} className="chip" data-on="true">⚡ Daily mix</button>
            {TOPICS.slice(0, 4).map((t) => <button key={t.id} className="chip" onClick={() => onTopic(t)}>{t.label}</button>)}
            <button onClick={onTopics} className="chip">All topics →</button>
          </div>
        </div>
        <div style={{ height: 20 }} />
      </Body>
    </>
  );
}

const HOME_VARIANTS = [
  { id: "ring", name: "Daily ring", Comp: HomeRing },
  { id: "path", name: "Belt journey", Comp: HomePath },
  { id: "focus", name: "Focus coach", Comp: HomeFocus },
];

Object.assign(window, { HomeRing, HomePath, HomeFocus, HOME_VARIANTS, BeltStrip, Greeting });
