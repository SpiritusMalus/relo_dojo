/* dojo-shell.jsx — shared chrome: top bar, tab bar, badges, back bar */

function StreakBadge({ n = 4, soft }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 800, fontSize: 14,
      color: "var(--fire)", background: soft ? "var(--fire-soft)" : "transparent",
      padding: soft ? "5px 10px" : 0, borderRadius: 999 }}>
      <span className="dj-flicker" style={{ fontSize: 15 }}>🔥</span>{n}
    </span>
  );
}

function XPBadge({ xp = 1840 }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 800, fontSize: 14,
      color: "var(--gold)", background: "var(--surface-2)", border: "1px solid var(--line)",
      padding: "5px 11px 5px 9px", borderRadius: 999 }}>
      <span style={{ width: 16, height: 16, borderRadius: 999, background: "var(--gold)", color: "#fff",
        display: "grid", placeItems: "center", fontSize: 11, fontWeight: 900 }}>✦</span>
      {xp.toLocaleString()}
    </span>
  );
}

/* top status row used on tabbed screens */
function TopBar({ belt, streak = 4, xp = 1840, onBelt }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 var(--pad)", height: 44 }}>
      <button onClick={onBelt} style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
        <BeltKnot belt={belt} size={26} />
        <span style={{ fontWeight: 800, fontSize: 15, color: belt.id === "white" ? "var(--ink)" : belt.knot }}>{belt.cefr}</span>
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StreakBadge n={streak} soft />
        <XPBadge xp={xp} />
      </div>
    </div>
  );
}

/* simple back header for pushed screens */
function BackBar({ title, onBack, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 var(--pad)", height: 48 }}>
      <button onClick={onBack} aria-label="Back" style={{ all: "unset", cursor: "pointer", width: 38, height: 38, borderRadius: 12,
        display: "grid", placeItems: "center", background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)" }}>
        <Icon name="back" size={20} />
      </button>
      <div className="brand" style={{ fontSize: 19, fontWeight: 700, flex: 1 }}>{title}</div>
      {right}
    </div>
  );
}

/* bottom tab bar */
function TabBar({ tab, onTab }) {
  const tabs = [
    { id: "home", label: "Home", icon: "home" },
    { id: "practice", label: "Train", icon: "practice" },
    { id: "progress", label: "Progress", icon: "chart" },
  ];
  return (
    <div style={{ display: "flex", padding: "8px 10px 6px", background: "var(--surface)", borderTop: "1px solid var(--line)", gap: 4 }}>
      {tabs.map((t) => {
        const on = tab === t.id;
        return (
          <button key={t.id} onClick={() => onTab(t.id)} style={{ all: "unset", cursor: "pointer", flex: 1,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 0", borderRadius: 14,
            color: on ? "var(--accent)" : "var(--ink-3)" }}>
            <div style={{ position: "relative" }}>
              {on && <div style={{ position: "absolute", inset: -7, background: "var(--accent-soft)", borderRadius: 12 }} />}
              <div style={{ position: "relative" }}><Icon name={t.icon} size={24} sw={on ? 2.4 : 2} /></div>
            </div>
            <span style={{ fontSize: 11, fontWeight: on ? 800 : 600 }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* the scrollable body wrapper (keeps padding consistent, clears safe areas) */
function Body({ children, top = 8, style }) {
  return <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingTop: top, ...style }}>{children}</div>;
}

Object.assign(window, { StreakBadge, XPBadge, TopBar, BackBar, TabBar, Body });
