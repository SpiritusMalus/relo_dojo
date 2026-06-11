/* dojo-progress.jsx — progress / profile screen */

function BeltRack({ current }) {
  const ci = BELTS.indexOf(current);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
      {BELTS.map((b, i) => {
        const earned = i <= ci, cur = i === ci;
        return (
          <div key={b.id} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ height: cur ? 30 : 22, borderRadius: 5, background: earned ? b.color : "var(--surface-3)",
              border: `1.5px solid ${earned ? b.edge : "var(--line-2)"}`, opacity: earned ? 1 : .55,
              boxShadow: cur ? "0 3px 0 " + b.edge : "none", transition: "all .3s" }} />
            <div style={{ fontSize: 9.5, fontWeight: 800, marginTop: 5, color: cur ? "var(--ink)" : "var(--ink-3)" }}>{b.cefr}</div>
          </div>
        );
      })}
    </div>
  );
}

function Progress({ belt, streak, xp, onTab, onBelt }) {
  const level = 9, inLevel = 640, perLevel = 1000;
  return (
    <>
      <TopBar belt={belt} streak={streak} xp={xp} onBelt={onBelt} />
      <Body>
        <div style={{ padding: "8px var(--pad) 0" }}>
          <div className="brand" style={{ fontSize: 25, fontWeight: 700 }}>Your dojo</div>
        </div>

        {/* belt showcase */}
        <div className="card" style={{ margin: "14px var(--pad) 0", padding: "var(--pad)", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}><Sensei belt={belt} size={84} mood="happy" /></div>
          <div className="brand" style={{ fontSize: 22, fontWeight: 700 }}>{belt.name}</div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 16 }}>Overall level · CEFR {belt.cefr}</div>
          <BeltRack current={belt} />
        </div>

        {/* level + xp */}
        <div className="card" style={{ margin: "12px var(--pad) 0", padding: "var(--pad)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
            <span className="brand" style={{ fontSize: 18, fontWeight: 700 }}>Level {level}</span>
            <span style={{ fontWeight: 800, color: "var(--gold)" }}>{xp.toLocaleString()} XP</span>
          </div>
          <div className="track" style={{ height: 12 }}><div className="fill" style={{ width: (inLevel / perLevel) * 100 + "%", background: "var(--gold)" }} /></div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 7 }}>{perLevel - inLevel} XP to level {level + 1}</div>
        </div>

        {/* streak tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "12px var(--pad) 0" }}>
          {[{ g: "🔥", v: streak, l: "day streak", c: "var(--fire)" }, { g: "⚡", v: 14, l: "best run", c: "var(--gold)" }].map((s) => (
            <div key={s.l} className="card" style={{ padding: "16px", textAlign: "center" }}>
              <div className="brand" style={{ fontSize: 30, fontWeight: 700 }}><span style={{ fontSize: 22 }}>{s.g}</span> {s.v}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)", marginTop: 2 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* per-topic belts */}
        <div style={{ padding: "20px var(--pad) 0" }}>
          <Label style={{ marginBottom: 12 }}>Belts by topic</Label>
          <div className="card" style={{ padding: "4px var(--pad)" }}>
            {TOPICS.map((t, i) => {
              const tb = beltByCefr(t.cefr);
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: i < TOPICS.length - 1 ? "1px solid var(--line)" : "none" }}>
                  <div style={{ width: 16, height: 16, borderRadius: 5, background: tb.color, border: `1.5px solid ${tb.edge}`, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: t.weak ? "var(--bad)" : "var(--ink)" }}>{t.label}{t.weak && <span style={{ fontSize: 11, fontWeight: 800, marginLeft: 8, color: "var(--bad)" }}>· focus</span>}</div>
                    <div className="track" style={{ height: 6, marginTop: 6 }}><div className="fill" style={{ width: t.acc + "%", background: t.weak ? "var(--bad)" : "var(--accent)" }} /></div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{tb.cefr}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600 }}>{t.acc}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* achievements */}
        <div style={{ padding: "20px var(--pad) 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <Label>Achievements</Label>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)" }}>4 / {ACHIEVEMENTS.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {ACHIEVEMENTS.map((a) => (
              <div key={a.id} className="card" style={{ padding: "14px", display: "flex", gap: 11, alignItems: "center", opacity: a.got ? 1 : .72 }}>
                <div style={{ width: 44, height: 44, borderRadius: 13, display: "grid", placeItems: "center", flexShrink: 0, fontSize: 22,
                  background: a.got ? "var(--accent-soft)" : "var(--surface-3)", filter: a.got ? "none" : "grayscale(1)" }}>
                  {a.got ? a.glyph : "🔒"}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.1 }}>{a.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{a.sub}</div>
                  {!a.got && a.pct != null && (
                    <div className="track" style={{ height: 5, marginTop: 6 }}><div className="fill" style={{ width: a.pct + "%" }} /></div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* account */}
        <div style={{ padding: "20px var(--pad) 0" }}>
          <Label style={{ marginBottom: 10 }}>Account</Label>
          <div className="card" style={{ padding: "4px var(--pad)" }}>
            <Row label="alex@dev.io" muted />
            <Row label="Redo onboarding" arrow />
            <Row label="Log out" danger last />
          </div>
        </div>
        <div style={{ height: 22 }} />
      </Body>
    </>
  );
}

function Row({ label, muted, arrow, danger, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "14px 0", borderBottom: last ? "none" : "1px solid var(--line)" }}>
      <span style={{ flex: 1, fontWeight: 600, fontSize: 15, color: danger ? "var(--bad)" : muted ? "var(--ink-2)" : "var(--ink)" }}>{label}</span>
      {arrow && <Icon name="chevron" size={18} stroke="var(--ink-3)" />}
    </div>
  );
}

Object.assign(window, { Progress, BeltRack });
