/* ============================================================
   dojo-core.jsx — data, mascot, shared UI primitives
   Exports to window (see Object.assign at bottom)
   ============================================================ */

/* ---------- belts (judo/karate, mapped over CEFR) ---------- */
const BELTS = [
  { id: "white",  cefr: "A1", name: "White belt",  color: "#e9ebe6", edge: "#cdd3cb", knot: "#b7bfb4", ink: "#3a443c" },
  { id: "yellow", cefr: "A2", name: "Yellow belt", color: "#f6c945", edge: "#d8a82a", knot: "#c79c22", ink: "#5a4708" },
  { id: "orange", cefr: "B1", name: "Orange belt", color: "#ef8a36", edge: "#cf6f22", knot: "#bb6420", ink: "#5e2c08" },
  { id: "green",  cefr: "B2", name: "Green belt",  color: "#39a85c", edge: "#2c8748", knot: "#247a3e", ink: "#0c3a1d" },
  { id: "blue",   cefr: "C1", name: "Blue belt",   color: "#3f86c9", edge: "#2f6aa6", knot: "#295f93", ink: "#0c2f4d" },
  { id: "black",  cefr: "C2", name: "Black belt",  color: "#2b3037", edge: "#14171b", knot: "#0b0d10", ink: "#e7ebef" },
];
const beltByCefr = (c) => BELTS.find((b) => b.cefr === c) || BELTS[0];
const beltByIndex = (i) => BELTS[Math.max(0, Math.min(BELTS.length - 1, i))];

/* ---------- grammar topics (mock progress) ---------- */
const TOPICS = [
  { id: "prepositions", label: "Prepositions", hint: "in / on / at", cefr: "B1", acc: 74, attempts: 41, done: 30 },
  { id: "conditionals", label: "Conditionals", hint: "if … then …", cefr: "A2", acc: 58, attempts: 33, done: 19, weak: true },
  { id: "tenses", label: "Verb tenses", hint: "tense agreement", cefr: "B2", acc: 81, attempts: 52, done: 42 },
  { id: "articles", label: "Articles", hint: "a / an / the", cefr: "B1", acc: 69, attempts: 28, done: 19 },
  { id: "modals", label: "Modal verbs", hint: "can / must / should", cefr: "A2", acc: 63, attempts: 22, done: 14 },
  { id: "phrasal", label: "Phrasal verbs", hint: "roll back, spin up", cefr: "A2", acc: 47, attempts: 18, done: 8, weak: true },
  { id: "gerunds", label: "Gerunds & infinitives", hint: "to do / doing", cefr: "B2", acc: 78, attempts: 24, done: 19 },
  { id: "wordorder", label: "Word order", hint: "subject · verb · object", cefr: "C1", acc: 88, attempts: 30, done: 26 },
];

/* ---------- build-the-sentence bank (RU → EN, dev flavored) ---------- */
const BUILD = [
  { topic: "Articles", cefr: "B1", ru: "Сервер вернул ошибку 500.",
    tiles: ["The", "server", "returned", "a", "500", "error"], answer: "The server returned a 500 error",
    note: "Countable singular noun → needs an article. “a 500 error”." },
  { topic: "Modal verbs", cefr: "A2", ru: "Тебе следует отревьюить этот пул-реквест.",
    tiles: ["You", "should", "review", "this", "pull", "request"], answer: "You should review this pull request",
    note: "“should” is followed by the bare infinitive — review, not to review." },
  { topic: "Tenses", cefr: "B2", ru: "Билд падает с прошлого вторника.",
    tiles: ["The", "build", "has", "been", "failing", "since", "Tuesday"], answer: "The build has been failing since Tuesday",
    note: "Ongoing since a point in time → present perfect continuous." },
  { topic: "Prepositions", cefr: "B1", ru: "Я закоммитил исправление в ветку main.",
    tiles: ["I", "pushed", "the", "fix", "to", "the", "main", "branch"], answer: "I pushed the fix to the main branch",
    note: "Direction toward a target → “to”, not “in”." },
  { topic: "Conditionals", cefr: "A2", ru: "Если тесты пройдут, мы зарелизим.",
    tiles: ["If", "the", "tests", "pass", "we", "will", "ship"], answer: "If the tests pass we will ship",
    note: "First conditional: if + present, … will + verb." },
];

/* ---------- achievements (emoji glyphs, matching the app vocabulary) ---------- */
const ACHIEVEMENTS = [
  { id: "first", glyph: "🥋", label: "First steps", sub: "Finish your first drill", got: true },
  { id: "streak3", glyph: "🔥", label: "On a roll", sub: "3-day streak", got: true },
  { id: "combo", glyph: "⚡", label: "Combo master", sub: "10 correct in a row", got: true },
  { id: "green", glyph: "🟢", label: "Green belt", sub: "Reach B2 in any topic", got: true },
  { id: "hundred", glyph: "💯", label: "Centurion", sub: "100 exercises solved", got: false, pct: 64 },
  { id: "night", glyph: "🌙", label: "Night shift", sub: "Practice after midnight", got: false },
  { id: "streak7", glyph: "📅", label: "Full week", sub: "7-day streak", got: false, pct: 71 },
  { id: "perfect", glyph: "🏆", label: "Flawless", sub: "A perfect 20-card session", got: false },
];

/* ============================================================
   Sensei — friendly geometric mascot.
   Headband takes the current belt color. moods: happy|cheer|think|sad
   ============================================================ */
function Sensei({ belt = BELTS[3], size = 88, mood = "happy", bob = false }) {
  const band = belt.color, knot = belt.knot;
  const skin = "#f4d9b8", skinEdge = "#e7c39a";
  const hair = "#2b2b30";
  const eye = "#23302a";
  // eyes / mouth per mood
  const eyes = {
    happy: <g><path d="M34 50 q4 -5 8 0" stroke={eye} strokeWidth="3.2" fill="none" strokeLinecap="round"/><path d="M58 50 q4 -5 8 0" stroke={eye} strokeWidth="3.2" fill="none" strokeLinecap="round"/></g>,
    cheer: <g><path d="M33 51 q5 -6 9 0" stroke={eye} strokeWidth="3.2" fill="none" strokeLinecap="round"/><path d="M58 51 q5 -6 9 0" stroke={eye} strokeWidth="3.2" fill="none" strokeLinecap="round"/></g>,
    think: <g><circle cx="39" cy="51" r="2.6" fill={eye}/><circle cx="62" cy="51" r="2.6" fill={eye}/><path d="M56 44 q5 -2 9 1" stroke={eye} strokeWidth="2.4" fill="none" strokeLinecap="round"/></g>,
    sad:   <g><circle cx="39" cy="52" r="2.6" fill={eye}/><circle cx="62" cy="52" r="2.6" fill={eye}/></g>,
  }[mood];
  const mouth = {
    happy: <path d="M42 60 q8 7 16 0" stroke={eye} strokeWidth="3" fill="none" strokeLinecap="round"/>,
    cheer: <path d="M43 59 q7 11 14 0 z" fill="#c2543f" stroke={eye} strokeWidth="2.4" strokeLinejoin="round"/>,
    think: <path d="M44 62 h12" stroke={eye} strokeWidth="3" fill="none" strokeLinecap="round"/>,
    sad:   <path d="M42 64 q8 -7 16 0" stroke={eye} strokeWidth="3" fill="none" strokeLinecap="round"/>,
  }[mood];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={bob ? "dj-bob" : ""} style={{ display: "block", overflow: "visible" }}>
      {/* topknot */}
      <circle cx="50" cy="17" r="8" fill={hair}/>
      <rect x="47" y="20" width="6" height="8" rx="3" fill={hair}/>
      {/* head */}
      <circle cx="50" cy="54" r="33" fill={skin} stroke={skinEdge} strokeWidth="1.5"/>
      {/* hair sides */}
      <path d="M18 50 q3 -22 32 -23 q29 1 32 23 q-10 -10 -32 -10 q-22 0 -32 10z" fill={hair}/>
      {/* headband */}
      <path d="M17 44 q33 -11 66 0 l0 9 q-33 -10 -66 0 z" fill={band} stroke={belt.edge} strokeWidth="1.2"/>
      {/* knot + tails on the right */}
      <circle cx="84" cy="48" r="5.5" fill={knot}/>
      <path d="M86 50 l12 7 -3 5 -11 -8z" fill={band} stroke={belt.edge} strokeWidth="1"/>
      <path d="M86 53 l9 11 -5 3 -7 -11z" fill={knot} stroke={belt.edge} strokeWidth="1"/>
      {/* face */}
      {eyes}
      {/* rosy cheeks */}
      <circle cx="33" cy="60" r="4" fill="#f3a98f" opacity="0.5"/>
      <circle cx="67" cy="60" r="4" fill="#f3a98f" opacity="0.5"/>
      {mouth}
    </svg>
  );
}

/* ---------- belt knot icon (folded belt) ---------- */
function BeltKnot({ belt, size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: "block" }}>
      <rect x="3" y="15" width="34" height="10" rx="2" fill={belt.color} stroke={belt.edge} strokeWidth="1.2"/>
      <rect x="14" y="11" width="12" height="18" rx="2.5" fill={belt.color} stroke={belt.edge} strokeWidth="1.2"/>
      <path d="M14 25 l-5 11 5 -2 3 3 2 -10z" fill={belt.knot} stroke={belt.edge} strokeWidth="1"/>
      <path d="M26 25 l5 11 -5 -2 -3 3 -2 -10z" fill={belt.knot} stroke={belt.edge} strokeWidth="1"/>
    </svg>
  );
}

/* ---------- belt tag (swatch + label pill) ---------- */
function BeltTag({ belt, size = "md", showCefr = true }) {
  const sm = size === "sm";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: sm ? 6 : 8,
      background: "var(--surface-2)", border: "1px solid var(--line)",
      borderRadius: 999, padding: sm ? "4px 9px 4px 5px" : "5px 12px 5px 6px",
      fontWeight: 700, fontSize: sm ? 12 : 13, color: "var(--ink)",
    }}>
      <span style={{ width: sm ? 14 : 18, height: sm ? 14 : 18, borderRadius: 5, background: belt.color, border: `1.5px solid ${belt.edge}`, display: "inline-block" }} />
      {belt.name}{showCefr ? <span style={{ color: "var(--ink-3)", fontWeight: 700 }}>· {belt.cefr}</span> : null}
    </span>
  );
}

/* ---------- progress ring ---------- */
function Ring({ pct = 0, size = 120, stroke = 12, color = "var(--accent)", track = "var(--surface-3)", children, animate = true }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct / 100)));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c}
          style={{ "--from": c, "--to": off, strokeDashoffset: off, animation: animate ? "dj-ring .9s cubic-bezier(.2,.8,.2,1) both" : "none" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        {children}
      </div>
    </div>
  );
}

/* ---------- tiny line icons ---------- */
function Icon({ name, size = 24, stroke = "currentColor", sw = 2 }) {
  const p = { fill: "none", stroke, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    home: <g {...p}><path d="M4 11l8-6 8 6" /><path d="M6 10v9h12v-9" /></g>,
    practice: <g {...p}><path d="M4 9v6M20 9v6M7 7v10M17 7v10" /><path d="M7 12h10" /></g>,
    chart: <g {...p}><path d="M5 19V10M12 19V5M19 19v-6" /></g>,
    check: <g {...p}><path d="M5 13l4 4L19 7" /></g>,
    x: <g {...p}><path d="M6 6l12 12M18 6L6 18" /></g>,
    chevron: <g {...p}><path d="M9 6l6 6-6 6" /></g>,
    back: <g {...p}><path d="M15 6l-6 6 6 6" /></g>,
    plus: <g {...p}><path d="M12 5v14M5 12h14" /></g>,
    lock: <g {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></g>,
    target: <g {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></g>,
    bolt: <g {...p}><path d="M13 3L5 13h6l-1 8 8-11h-6z" /></g>,
    gear: <g {...p}><circle cx="12" cy="12" r="3" /><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18" /></g>,
    sound: <g {...p}><path d="M5 9v6h4l5 4V5L9 9z" /><path d="M16 9a4 4 0 010 6" /></g>,
    star: <g {...p}><path d="M12 4l2.4 5 5.6.6-4 3.8 1 5.6-5-2.8-5 2.8 1-5.6-4-3.8 5.6-.6z" /></g>,
    flame: <g {...p}><path d="M12 3c2 3 5 5 5 9a5 5 0 01-10 0c0-2 1-3 2-4 0 1 1 2 2 2 0-3-1-5-1-7z" /></g>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>{paths[name]}</svg>;
}

/* ---------- section label ---------- */
function Label({ children, style }) {
  return <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--ink-3)", ...style }}>{children}</div>;
}

/* ---------- confetti burst ---------- */
function Confetti({ n = 26 }) {
  const cols = ["var(--accent)", "var(--fire)", "var(--gold)", "#3f86c9", "#ef8a36"];
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 30 }}>
      {Array.from({ length: n }).map((_, i) => {
        const left = Math.random() * 100, delay = Math.random() * 0.4, dur = 1.1 + Math.random() * 0.9;
        const sz = 6 + Math.random() * 7, rot = Math.random() * 360;
        return <div key={i} style={{
          position: "absolute", top: -16, left: left + "%", width: sz, height: sz * 0.55,
          background: cols[i % cols.length], borderRadius: 2, transform: `rotate(${rot}deg)`,
          animation: `dj-confetti ${dur}s ${delay}s ease-in forwards`,
        }} />;
      })}
    </div>
  );
}

Object.assign(window, {
  BELTS, beltByCefr, beltByIndex, TOPICS, BUILD, ACHIEVEMENTS,
  Sensei, BeltKnot, BeltTag, Ring, Icon, Label, Confetti,
});
