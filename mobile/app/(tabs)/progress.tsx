import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { ACHIEVEMENTS, levelFor, useProgress, XP_PER_LEVEL, xpInLevel } from "../../store/progress";
import { useI18n } from "../../store/i18n";
import { RU_ACH, RU_TOPIC_LABELS } from "../../i18n/strings";
import { TOPIC_LABELS } from "../../store/onboarding";
import { beltProgress, topicRows, type PathNode } from "../../store/dojo";
import { belts, useTheme } from "../../theme/theme";
import Screen from "../../components/ui/Screen";
import TopBar from "../../components/ui/TopBar";
import ActivationBanner from "../../components/ui/ActivationBanner";
import Card from "../../components/ui/Card";
import JourneyPath from "../../components/ui/JourneyPath";
import Button from "../../components/ui/Button";
import Sensei from "../../components/ui/Sensei";
import ProgressBar from "../../components/ui/ProgressBar";
import Txt from "../../components/ui/Txt";

// Emoji glyph + one-line sub per stored achievement id (presentational only).
const ACH_META: Record<string, { glyph: string; sub: string }> = {
  "first-correct": { glyph: "🥋", sub: "First correct answer" },
  "ten-correct": { glyph: "⚡", sub: "10 correct answers" },
  "fifty-correct": { glyph: "💯", sub: "50 correct answers" },
  "streak-3": { glyph: "🔥", sub: "3-day streak" },
  "streak-7": { glyph: "📅", sub: "7-day streak" },
  "run-5": { glyph: "🏆", sub: "5 in a row" },
  "level-5": { glyph: "🟢", sub: "Reached level 5" },
};

export default function ProgressScreen() {
  const t = useTheme();
  const router = useRouter();
  const { progress } = useProgress();
  const { t: tr, lang } = useI18n();

  const bp = beltProgress(progress);
  const rows = topicRows(progress);
  const level = levelFor(progress.xp);
  const inLevel = xpInLevel(progress.xp);

  return (
    <Screen>
      <TopBar belt={bp.belt} streak={progress.dailyStreak} xp={progress.xp} />

      <ActivationBanner />

      {/* Belt showcase */}
      <Card>
        <View style={styles.showcase}>
          <Sensei belt={bp.belt} size={72} mood="happy" bob />
          <View style={{ flex: 1 }}>
            <Txt variant="screenTitle">{bp.belt.name}</Txt>
            <Txt variant="secondary" color={t.c.ink3}>{tr("prog.overall", { cefr: bp.cefr })}</Txt>
          </View>
        </View>
        {/* belt rack */}
        <View style={styles.rack}>
          {belts.map((b) => {
            const earned = b.idx <= bp.belt.idx;
            const current = b.idx === bp.belt.idx;
            return (
              <View key={b.id} style={styles.rackCol}>
                <View
                  style={{
                    width: "100%",
                    height: current ? 46 : 34,
                    borderRadius: 6,
                    backgroundColor: earned ? b.color : t.c.surface3,
                    borderWidth: current ? 2 : 1,
                    borderColor: earned ? b.edge : t.c.line2,
                    borderBottomWidth: current ? 5 : 1,
                  }}
                />
                <Txt variant="caption" color={current ? t.c.ink : t.c.ink3} style={{ marginTop: 5 }}>
                  {b.cefr}
                </Txt>
              </View>
            );
          })}
        </View>
        {/* Wardrobe entry — the showcase is where you admire the Sensei, so dress it from here. */}
        <Button label={tr("ward.dress")} variant="ghost" onPress={() => router.push("/wardrobe")} />
      </Card>

      {/* Belt journey — interactive map: tap a node to train that topic, or the belt-test node to
          take the exam. Locked nodes (further along the path) stay non-tappable. */}
      <JourneyPath
        onSelect={(node: PathNode) => {
          if (node.state === "test") router.push("/belt-exam");
          else if (node.topic) router.push({ pathname: "/practice", params: { topic: node.topic.id } });
        }}
      />

      {/* Level + XP */}
      <Card>
        <View style={styles.rowBetween}>
          <Txt variant="cardTitle">{tr("prog.level", { n: level })}</Txt>
          <Txt variant="bodyStrong" color={t.c.gold}>{tr("prog.xp", { n: progress.xp })}</Txt>
        </View>
        <ProgressBar pct={(inLevel / XP_PER_LEVEL) * 100} color={t.c.gold} style={{ marginTop: 10 }} />
        <Txt variant="secondary" color={t.c.ink3} style={{ marginTop: 8 }}>
          {tr("prog.xpToNext", { n: XP_PER_LEVEL - inLevel, next: level + 1 })}
        </Txt>
      </Card>

      {/* Stat tiles */}
      <View style={styles.tiles}>
        <Card style={styles.tile}>
          <Txt variant="screenTitle">{`🔥 ${progress.dailyStreak}`}</Txt>
          <Txt variant="secondary" color={t.c.ink3}>{tr("prog.dayStreak")}</Txt>
        </Card>
        <Card style={styles.tile}>
          <Txt variant="screenTitle">{`⚡ ${progress.bestCorrectRun}`}</Txt>
          <Txt variant="secondary" color={t.c.ink3}>{tr("prog.bestRun")}</Txt>
        </Card>
      </View>

      {/* Sensei's notes (Stage 2): reframed stats — slips as material, the agent's win line,
          and the Planner's focus for the week. Errors are never shown as raw failure counts. */}
      {(() => {
        const slips = Object.values(progress.topics).reduce((n, s) => n + (s.attempts - s.correct), 0);
        const wins = progress.profile?.wins;
        const planNote = progress.profile?.planNote;
        if (!slips && !wins && !planNote) return null;
        return (
          <Card>
            <Txt variant="label" style={{ marginBottom: 8 }}>
              {tr("prog.senseiNotes")}
            </Txt>
            {!!wins && (
              <Txt variant="body" style={{ marginBottom: 6 }}>
                {wins}
              </Txt>
            )}
            {slips > 0 && (
              <Txt variant="secondary" color={t.c.ink2} style={{ marginBottom: planNote ? 6 : 0 }}>
                {tr("prog.reframe", { n: slips })}
              </Txt>
            )}
            {!!planNote && (
              <Txt variant="secondary" color={t.c.ink3}>
                {tr("prog.planFocus", { note: planNote })}
              </Txt>
            )}
          </Card>
        );
      })()}

      {/* Student diary: last finished week's recap (store/diary.ts; ticked from Home). */}
      {(() => {
        const recap = progress.profile?.diary?.last;
        if (!recap) return null;
        const top =
          recap.topTopic &&
          (lang === "ru" ? RU_TOPIC_LABELS[recap.topTopic] ?? recap.topTopic : TOPIC_LABELS[recap.topTopic] ?? recap.topTopic);
        return (
          <Card>
            <Txt variant="label" style={{ marginBottom: 8 }}>
              {`📖 ${tr("diary.title")}`}
            </Txt>
            <Txt variant="secondary" color={t.c.ink3} style={{ marginBottom: 6 }}>
              {tr("diary.range", { from: recap.from, to: recap.to })}
            </Txt>
            <Txt variant="body" style={{ marginBottom: 4 }}>
              {tr("diary.line", { correct: recap.correct, xp: recap.xp })}
            </Txt>
            {recap.slips > 0 && (
              <Txt variant="secondary" color={t.c.ink2} style={{ marginBottom: 4 }}>
                {tr("diary.slips", { n: recap.slips })}
              </Txt>
            )}
            {!!top && (
              <Txt variant="secondary" color={t.c.ink2}>
                {tr("diary.top", { topic: top })}
              </Txt>
            )}
          </Card>
        );
      })()}

      {/* Belts by topic */}
      <Card>
        <Txt variant="label" style={{ marginBottom: 12 }}>
          {tr("prog.beltsByTopic")}
        </Txt>
        <View style={{ gap: 14 }}>
          {rows.map((r) => (
            <View key={r.id} style={styles.topicRow}>
              <View style={{ width: 16, height: 16, borderRadius: 5, backgroundColor: r.belt.color, borderWidth: 1.5, borderColor: r.belt.edge }} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" color={r.weak ? t.c.bad : t.c.ink}>
                  {lang === "ru" ? RU_TOPIC_LABELS[r.id] ?? r.label : r.label}
                  {r.weak ? `  · ${tr("prog.focus")}` : ""}
                </Txt>
                <ProgressBar pct={r.acc} height={6} color={r.weak ? t.c.bad : t.c.accent} style={{ marginTop: 6 }} />
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Txt variant="caption" color={t.c.ink3}>{r.cefr}</Txt>
                <Txt variant="bodyStrong">{`${r.acc}%`}</Txt>
              </View>
            </View>
          ))}
        </View>
      </Card>

      {/* Achievements */}
      <Card>
        <Txt variant="label" style={{ marginBottom: 12 }}>
          {tr("prog.achievements")}
        </Txt>
        <View style={styles.achGrid}>
          {ACHIEVEMENTS.map((a) => {
            const got = progress.achievements.includes(a.id);
            const meta = ACH_META[a.id] ?? { glyph: "🏅", sub: "" };
            return (
              <View
                key={a.id}
                style={[
                  styles.ach,
                  { backgroundColor: got ? t.c.accentSoft : t.c.surface2, borderColor: t.c.line, opacity: got ? 1 : 0.6 },
                ]}
              >
                <Txt variant="screenTitle" style={{ fontSize: 26 }}>
                  {got ? meta.glyph : "🔒"}
                </Txt>
                <Txt variant="bodyStrong" color={got ? t.c.ink : t.c.ink3} numberOfLines={1}>
                  {lang === "ru" ? RU_ACH[a.id]?.label ?? a.label : a.label}
                </Txt>
                <Txt variant="secondary" color={t.c.ink3} numberOfLines={1}>
                  {lang === "ru" ? RU_ACH[a.id]?.sub ?? meta.sub : meta.sub}
                </Txt>
              </View>
            );
          })}
        </View>
      </Card>

    </Screen>
  );
}

const styles = StyleSheet.create({
  showcase: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  rack: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  rackCol: { flex: 1, alignItems: "center" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  tiles: { flexDirection: "row", gap: 14 },
  tile: { flex: 1, alignItems: "center", gap: 2 },
  topicRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  achGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  ach: { width: "47.5%", borderWidth: 1, borderRadius: 14, padding: 12, gap: 2 },
});
