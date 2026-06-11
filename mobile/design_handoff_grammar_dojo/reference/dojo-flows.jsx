/* dojo-flows.jsx — Login, Onboarding, Topics */

/* ================= LOGIN ================= */
function Login({ belt, onEnter }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 var(--pad)" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", gap: 6 }}>
        <span className="dj-bob"><Sensei belt={belt} size={120} mood="cheer" /></span>
        <div className="brand" style={{ fontSize: 34, fontWeight: 700, marginTop: 8 }}>Grammar Dojo</div>
        <div style={{ fontSize: 15, color: "var(--ink-2)", maxWidth: 280, lineHeight: 1.45 }}>
          Earn your belt in English grammar — one short drill a day, from a dev’s world.
        </div>
      </div>
      <div style={{ paddingBottom: 22, display: "flex", flexDirection: "column", gap: 11 }}>
        <Field placeholder="you@dev.io" label="Email" />
        <Field placeholder="••••••••" label="Password" />
        <button onClick={onEnter} className="btn btn-primary" style={{ width: "100%", marginTop: 4 }}>Enter the dojo</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0", color: "var(--ink-3)", fontSize: 12.5, fontWeight: 700 }}>
          <div style={{ flex: 1, height: 1, background: "var(--line)" }} /> OR <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onEnter} className="btn btn-ghost" style={{ flex: 1 }}> GitHub</button>
          <button onClick={onEnter} className="btn btn-ghost" style={{ flex: 1 }}>Google</button>
        </div>
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>New here? <b style={{ color: "var(--accent)" }}>Create an account</b></div>
      </div>
    </div>
  );
}
function Field({ label, placeholder }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-3)", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
      <input placeholder={placeholder} style={{ width: "100%", boxSizing: "border-box", padding: "14px 15px", borderRadius: "var(--r-sm)",
        border: "2px solid var(--line-2)", background: "var(--surface)", color: "var(--ink)", fontSize: 15, fontFamily: "var(--font-ui)", outline: "none" }}
        onFocus={(e) => (e.target.style.borderColor = "var(--accent)")} onBlur={(e) => (e.target.style.borderColor = "var(--line-2)")} />
    </label>
  );
}

/* ================= ONBOARDING ================= */
const OB_GOALS = ["Read docs & code reviews", "Write better PRs", "Pass tech interviews", "Talk with my team", "Conference talks"];
const OB_TOPICS = ["Prepositions", "Conditionals", "Verb tenses", "Articles", "Modal verbs", "Phrasal verbs", "Word order"];
const OB_LEVELS = [["Beginner", "I rely on a dictionary"], ["Intermediate", "I read docs okay"], ["Advanced", "I’m fairly comfortable"]];
const OB_MIN = [5, 10, 15, 30, 60];

function Onboarding({ belt, onDone }) {
  const [step, setStep] = React.useState(0);
  const [goals, setGoals] = React.useState([]);
  const [hard, setHard] = React.useState(["Conditionals"]);
  const [lvl, setLvl] = React.useState(1);
  const [min, setMin] = React.useState(10);
  const [calPick, setCalPick] = React.useState(null);
  const total = 7;
  const tog = (v, set, arr) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const resultBelt = beltByCefr(lvl === 0 ? "A1" : lvl === 2 ? "B2" : "A2");

  const Steps = [
    /* 0 welcome */
    <Center key="w">
      <span className="dj-bob"><Sensei belt={belt} size={110} mood="happy" /></span>
      <div className="brand" style={{ fontSize: 26, fontWeight: 700, marginTop: 10 }}>Let’s tune your dojo</div>
      <div style={{ fontSize: 15, color: "var(--ink-2)", maxWidth: 270, lineHeight: 1.5, marginTop: 6 }}>A few quick questions, then a short warm-up to find your belt.</div>
    </Center>,
    /* 1 goals */
    <Q key="g" title="Why are you learning English?" sub="Pick any that apply.">
      <Chips opts={OB_GOALS} val={goals} on={(v) => tog(v, setGoals, goals)} />
    </Q>,
    /* 2 hard */
    <Q key="h" title="What feels hard right now?" sub="We’ll surface these more often.">
      <Chips opts={OB_TOPICS} val={hard} on={(v) => tog(v, setHard, hard)} />
    </Q>,
    /* 3 level */
    <Q key="l" title="How would you rate your English?">
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {OB_LEVELS.map((o, i) => (
          <button key={i} onClick={() => setLvl(i)} className="card" data-on={lvl === i}
            style={{ textAlign: "left", cursor: "pointer", padding: "15px 16px", borderColor: lvl === i ? "var(--accent)" : "var(--line)", background: lvl === i ? "var(--accent-soft)" : "var(--surface)" }}>
            <div className="brand" style={{ fontSize: 16, fontWeight: 700, color: lvl === i ? "var(--accent)" : "var(--ink)" }}>{o[0]}</div>
            <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{o[1]}</div>
          </button>
        ))}
      </div>
    </Q>,
    /* 4 minutes */
    <Q key="m" title="How much time per day?">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {OB_MIN.map((m) => (
          <button key={m} onClick={() => setMin(m)} className="chip" data-on={min === m} style={{ fontSize: 15, padding: "13px 18px" }}>{m} min</button>
        ))}
      </div>
    </Q>,
    /* 5 calibration */
    <Q key="c" title="Quick level check" sub="1 of 8 · finding your belt">
      <div className="card" style={{ padding: "var(--pad)" }}>
        <Label style={{ marginBottom: 8 }}>Choose the correct word</Label>
        <div style={{ fontSize: 18, lineHeight: 1.5, marginBottom: 16 }}>The CI pipeline depends <span className="code">___</span> the test stage.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {["on", "of", "from", "to"].map((o) => (
            <button key={o} onClick={() => setCalPick(o)} className="card" style={{ textAlign: "left", cursor: "pointer", padding: "13px 15px", fontFamily: "var(--font-mono)", fontWeight: 600,
              borderColor: calPick === o ? "var(--accent)" : "var(--line)", background: calPick === o ? "var(--accent-soft)" : "var(--surface)", color: calPick === o ? "var(--accent)" : "var(--ink)" }}>{o}</button>
          ))}
        </div>
      </div>
    </Q>,
    /* 6 belt reveal */
    <Center key="r">
      <Confetti />
      <Label>Your starting belt</Label>
      <div className="dj-pop" style={{ margin: "10px 0 4px" }}><BeltKnot belt={resultBelt} size={92} /></div>
      <div className="brand" style={{ fontSize: 28, fontWeight: 700 }}>{resultBelt.name}</div>
      <div style={{ fontSize: 14, color: "var(--ink-2)", marginBottom: 18 }}>CEFR {resultBelt.cefr} · keeps adjusting as you train</div>
      <div className="card" style={{ width: "100%", padding: "16px var(--pad)", textAlign: "left" }}>
        {[["Difficulty", "set from your level"], ["Hard topics", hard.join(", ") || "—"], ["Daily goal", `~${Math.round(min * 1.5)} cards`]].map((r) => (
          <div key={r[0]} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", gap: 12 }}>
            <span style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: 13.5 }}>{r[0]}</span>
            <span style={{ fontWeight: 700, fontSize: 13.5, textAlign: "right", flex: 1 }}>{r[1]}</span>
          </div>
        ))}
      </div>
    </Center>,
  ];

  const canNext = step !== 1 || goals.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px var(--pad) 10px", height: 52 }}>
        {step > 0 ? (
          <button onClick={() => setStep((s) => s - 1)} style={{ all: "unset", cursor: "pointer", color: "var(--ink-2)" }}><Icon name="back" size={22} /></button>
        ) : <div style={{ width: 22 }} />}
        <div style={{ flex: 1, height: 10, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden" }}>
          <div className="fill" style={{ width: ((step + 1) / total) * 100 + "%" }} />
        </div>
        <button onClick={() => onDone(resultBelt)} style={{ all: "unset", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--ink-3)" }}>{step < 6 ? "Skip" : ""}</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 var(--pad)" }} key={step}>
        <div>{Steps[step]}</div>
      </div>

      <div style={{ padding: "10px var(--pad) 16px" }}>
        <button className="btn btn-primary" style={{ width: "100%" }} disabled={!canNext}
          onClick={() => (step < 6 ? setStep((s) => s + 1) : onDone(resultBelt))}>
          {step === 0 ? "Get started" : step === 5 ? "See my belt" : step === 6 ? "Start training" : "Continue"}
        </button>
      </div>
    </div>
  );
}
function Center({ children }) { return <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "20px 0", position: "relative" }}>{children}</div>; }
function Q({ title, sub, children }) {
  return (
    <div style={{ paddingTop: 10 }}>
      <div className="brand" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
      {sub && <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 6 }}>{sub}</div>}
      <div style={{ marginTop: 18 }}>{children}</div>
    </div>
  );
}
function Chips({ opts, val, on }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{opts.map((o) => <button key={o} className="chip" data-on={val.includes(o)} onClick={() => on(o)}>{o}</button>)}</div>;
}

/* ================= TOPICS ================= */
function Topics({ belt, onBack, onTopic, onDaily }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <BackBar title="Topics" onBack={onBack} />
      <Body style={{ padding: "0 var(--pad)" }}>
        {/* daily mix feature */}
        <button onClick={onDaily} className="btn" style={{ width: "100%", padding: 0, borderRadius: "var(--r)", overflow: "hidden", boxShadow: "0 5px 0 var(--accent-press)", background: "var(--accent)", color: "var(--accent-ink)", textTransform: "none", marginTop: 6 }}>
          <div style={{ width: "100%", padding: "16px 18px", display: "flex", alignItems: "center", gap: 13, textAlign: "left" }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: "rgba(255,255,255,.18)", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name="bolt" size={24} stroke="#fff" /></div>
            <div style={{ flex: 1 }}>
              <div className="brand" style={{ fontSize: 17, fontWeight: 700 }}>Daily mix</div>
              <div style={{ fontSize: 12.5, opacity: .9 }}>Adaptive across all your topics</div>
            </div>
            <Icon name="chevron" size={20} stroke="#fff" />
          </div>
        </button>

        <Label style={{ margin: "20px 0 12px" }}>All grammar topics</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 11, paddingBottom: 22 }}>
          {TOPICS.map((t) => {
            const tb = beltByCefr(t.cefr);
            return (
              <button key={t.id} onClick={() => onTopic(t)} className="card" style={{ textAlign: "left", cursor: "pointer", padding: "14px 16px", display: "flex", alignItems: "center", gap: 13 }}>
                <BeltKnot belt={tb} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="brand" style={{ fontSize: 16, fontWeight: 700 }}>{t.label}</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}><span className="code">{t.hint}</span></div>
                  <div className="track" style={{ height: 6, marginTop: 8 }}><div className="fill" style={{ width: t.acc + "%", background: t.weak ? "var(--bad)" : "var(--accent)" }} /></div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>{tb.cefr}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 700 }}>{t.acc}%</div>
                </div>
              </button>
            );
          })}
        </div>
      </Body>
    </div>
  );
}

Object.assign(window, { Login, Onboarding, Topics });
