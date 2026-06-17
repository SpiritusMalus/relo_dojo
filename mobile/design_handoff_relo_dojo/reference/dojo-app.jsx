/* dojo-app.jsx — stage: device frame, navigation, tweaks, controls */

const ACCENTS = [
  { id: "dojo", val: "#0e8a30", name: "Dojo green" },
  { id: "teal", val: "#0a8f74", name: "Bamboo teal" },
  { id: "blue", val: "#2f6bd6", name: "Indigo" },
  { id: "violet", val: "#7a4fd0", name: "Sakura violet" },
];

function Stage() {
  const [t, setTweak] = window.useTweaks ? window.useTweaks({
    theme: "light", accent: "#0e8a30", font: "rounded", density: "cozy",
    device: "ios", home: "path",
  }) : [{ theme: "light", accent: "#0e8a30", font: "rounded", density: "cozy", device: "ios", home: "path" }, () => {}];

  // app navigation state
  const [belt, setBelt] = React.useState(BELTS[3]);          // green / B2
  const [screen, setScreen] = React.useState("login");       // login|onboarding|app|topics|practice
  const [tab, setTab] = React.useState("home");
  const [activeTopic, setActiveTopic] = React.useState(null);
  const [beltSheet, setBeltSheet] = React.useState(false);
  const streak = 4, xp = 1840;

  const HomeComp = (HOME_VARIANTS.find((v) => v.id === t.home) || HOME_VARIANTS[0]).Comp;

  // ---- screen router (content inside the phone) ----
  let content;
  if (screen === "login") {
    content = <Login belt={belt} onEnter={() => setScreen("onboarding")} />;
  } else if (screen === "onboarding") {
    content = <Onboarding belt={belt} onDone={(b) => { setBelt(b); setScreen("app"); setTab("home"); }} />;
  } else if (screen === "topics") {
    content = <Topics belt={belt} onBack={() => setScreen("app")} onDaily={() => setScreen("practice")} onTopic={(tp) => { setActiveTopic(tp); setScreen("practice"); }} />;
  } else if (screen === "practice") {
    content = <Practice belt={belt} headerStreak={streak} onExit={() => { setScreen("app"); setActiveTopic(null); }} />;
  } else {
    // tabbed app
    let tabView;
    if (tab === "home") {
      tabView = <HomeComp belt={belt} streak={streak} xp={xp}
        goal={{ done: 3, target: 6 }}
        onBelt={() => setBeltSheet(true)}
        onStart={() => setScreen("practice")}
        onTopics={() => setScreen("topics")}
        onTopic={(tp) => { setActiveTopic(tp); setScreen("practice"); }} />;
    } else if (tab === "practice") {
      tabView = <Topics belt={belt} onBack={() => setTab("home")} onDaily={() => setScreen("practice")} onTopic={(tp) => { setActiveTopic(tp); setScreen("practice"); }} />;
    } else {
      tabView = <Progress belt={belt} streak={streak} xp={xp} onBelt={() => setBeltSheet(true)} />;
    }
    content = (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{tabView}</div>
        <TabBar tab={tab} onTab={(x) => { setTab(x); }} />
      </div>
    );
  }

  // ---- the app surface (themed) ----
  const isAndroid = t.device === "android";
  const App = (
    <div className="dojo" data-theme={t.theme} data-font={t.font === "mono" ? "mono" : "rounded"} data-density={t.density}
      style={{ "--accent": t.accent, "--sat": isAndroid ? "30px" : "50px", "--sab": isAndroid ? "26px" : "22px",
        position: "relative", height: "100%", width: "100%", background: "var(--screen)", display: "flex", flexDirection: "column", overflow: "hidden",
        paddingTop: "var(--sat)", paddingBottom: "var(--sab)", boxSizing: "border-box" }}>
      {content}
      {beltSheet && <BeltSheet belt={belt} onClose={() => setBeltSheet(false)} onPick={(b) => { setBelt(b); setBeltSheet(false); }} />}
    </div>
  );

  // ---- device frame ----
  const dark = t.theme === "dark";
  const framed = isAndroid
    ? <window.AndroidDevice dark={dark}>{App}</window.AndroidDevice>
    : <window.IOSDevice dark={dark}>{App}</window.IOSDevice>;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "22px 16px 60px", gap: 16 }}>
      <TopControls t={t} set={setTweak} screen={screen} setScreen={setScreen} setTab={setTab} />
      <div>{framed}</div>
      {window.TweaksPanel ? <TweaksUI t={t} set={setTweak} /> : null}
    </div>
  );
}

/* segmented device + flow jumper above the phone */
function TopControls({ t, set, screen, setScreen, setTab }) {
  const jumps = [
    { id: "login", label: "Login" },
    { id: "onboarding", label: "Onboarding" },
    { id: "home", label: "Home" },
    { id: "topics", label: "Topics" },
    { id: "practice", label: "Practice" },
    { id: "progress", label: "Progress" },
  ];
  const cur = screen === "app" ? "home" : screen;
  function go(id) {
    if (id === "home") { setScreen("app"); setTab("home"); }
    else if (id === "progress") { setScreen("app"); setTab("progress"); }
    else setScreen(id);
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 560 }}>
      {jumps.map((j) => {
        const on = cur === j.id;
        return (
          <button key={j.id} onClick={() => go(j.id)} style={{ all: "unset", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif",
            fontSize: 13, fontWeight: 700, padding: "8px 14px", borderRadius: 999,
            background: on ? "#15201a" : "#fff", color: on ? "#fff" : "#5b6a60", border: "1px solid " + (on ? "#15201a" : "#dde6e0"),
            boxShadow: on ? "0 4px 12px rgba(0,0,0,.18)" : "none" }}>{j.label}</button>
        );
      })}
    </div>
  );
}

/* belt picker bottom-sheet — lets you preview every belt theme live */
function BeltSheet({ belt, onClose, onPick }) {
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(8,16,11,.5)", display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} className="dj-rise" style={{ width: "100%", background: "var(--surface)", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: "10px var(--pad) 24px", borderTop: "1px solid var(--line)" }}>
        <div style={{ width: 40, height: 5, borderRadius: 999, background: "var(--line-2)", margin: "4px auto 14px" }} />
        <div className="brand" style={{ fontSize: 20, fontWeight: 700, marginBottom: 3 }}>Belt ranks</div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 16 }}>White to black — mapped over CEFR A1–C2. Tap to preview a rank.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {BELTS.map((b) => {
            const on = b.id === belt.id;
            return (
              <button key={b.id} onClick={() => onPick(b)} className="card" style={{ textAlign: "left", cursor: "pointer", padding: "11px 13px", display: "flex", alignItems: "center", gap: 12,
                borderColor: on ? "var(--accent)" : "var(--line)", background: on ? "var(--accent-soft)" : "var(--surface)" }}>
                <BeltKnot belt={b} size={30} />
                <div style={{ flex: 1 }}>
                  <div className="brand" style={{ fontSize: 15, fontWeight: 700 }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 700 }}>CEFR {b.cefr}</div>
                </div>
                {on && <div style={{ width: 22, height: 22, borderRadius: 999, background: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name="check" size={15} sw={3} stroke="#fff" /></div>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* Tweaks panel contents */
function TweaksUI({ t, set }) {
  const { TweaksPanel, TweakSection, TweakRadio, TweakColor } = window;
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme">
        <TweakRadio label="Mode" value={t.theme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={(v) => set("theme", v)} />
        <TweakColor label="Accent" value={t.accent} options={ACCENTS.map((a) => a.val)} onChange={(v) => set("accent", v)} />
      </TweakSection>
      <TweakSection label="Type & density">
        <TweakRadio label="UI font" value={t.font} options={[{ value: "rounded", label: "Grotesk" }, { value: "mono", label: "Mono" }]} onChange={(v) => set("font", v)} />
        <TweakRadio label="Density" value={t.density} options={[{ value: "compact", label: "Compact" }, { value: "cozy", label: "Cozy" }, { value: "comfy", label: "Comfy" }]} onChange={(v) => set("density", v)} />
      </TweakSection>
      <TweakSection label="Frame & layout">
        <TweakRadio label="Device" value={t.device} options={[{ value: "ios", label: "iOS" }, { value: "android", label: "Android" }]} onChange={(v) => set("device", v)} />
        <TweakRadio label="Home layout" value={t.home} options={HOME_VARIANTS.map((v) => ({ value: v.id, label: v.name }))} onChange={(v) => set("home", v)} />
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Stage />);
