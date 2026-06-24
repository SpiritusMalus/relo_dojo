import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { ACHIEVEMENTS, DEFAULT_STEERING, levelFor, useProgress, XP_PER_LEVEL, xpInLevel } from "../../store/progress";
import { applySteeringAction, type SwerveAction } from "../../store/adaptive";
import { weakestTopic } from "../../store/greeting";
import { voiceFeatureEnabled } from "../../services/voice";
import { useVoiceConsent } from "../../store/voiceConsent";
import { useI18n } from "../../store/i18n";
import { RU_ACH, RU_TOPIC_LABELS } from "../../i18n/strings";
import { TOPIC_LABELS } from "../../store/onboarding";
import { SWERVE_FORMATS, FMT_LABEL_KEY } from "../../components/ui/SwerveSheet";
import { beltProgress, topicRows, type PathNode } from "../../store/dojo";
import { belts, useTheme } from "../../theme/theme";
import Screen from "../../components/ui/Screen";
import TopBar from "../../components/ui/TopBar";
import ActivationBanner from "../../components/ui/ActivationBanner";
import Card from "../../components/ui/Card";
import JourneyPath from "../../components/ui/JourneyPath";
import JourneyStageCard from "../../components/ui/JourneyStageCard";
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
  const { progress, setSteering } = useProgress();
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

      {/* Relocation journey — the niche arc (pre-move → arrived → settled). Shows only for learners
          on the niche; gently nudges them onward (the event-need → recurring-need retention hook). */}
      <JourneyStageCard goals={progress.profile?.goals} />

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

      {/* Your focus — the adaptive model made visible & editable (store/adaptive.ts steering). The
          learner can confirm/override the inferred weak topic and turn exercise formats on/off.
          Pronunciation is an inert placeholder owned by the voice-direction brief. */}
      {(() => {
        const steering = progress.steering;
        const focus = steering.pinnedFocusTopic ?? weakestTopic(progress);
        const focusLabel = focus
          ? lang === "ru"
            ? RU_TOPIC_LABELS[focus] ?? TOPIC_LABELS[focus] ?? focus
            : TOPIC_LABELS[focus] ?? focus
          : null;
        const active =
          !!steering.pinnedFocusTopic ||
          steering.mutedTopics.length > 0 ||
          steering.difficultyBias !== 0 ||
          Object.values(steering.formatPrefs).some((v) => v === false);
        const apply = (action: SwerveAction) => setSteering(applySteeringAction(steering, action));
        return (
          <Card>
            <View style={styles.rowBetween}>
              <Txt variant="label">{tr("focus.title")}</Txt>
              {active && (
                <Pressable onPress={() => setSteering(DEFAULT_STEERING)} hitSlop={8} accessibilityRole="button">
                  <Txt variant="caption" color={t.c.accent}>{tr("focus.reset")}</Txt>
                </Pressable>
              )}
            </View>

            {focus ? (
              <View style={{ marginTop: 8, gap: 10 }}>
                <Txt variant="body">
                  {steering.pinnedFocusTopic
                    ? tr("focus.pinned", { topic: focusLabel! })
                    : tr("focus.weak", { topic: focusLabel! })}
                </Txt>
                {!steering.pinnedFocusTopic && (
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button label={tr("focus.confirm")} onPress={() => apply({ kind: "pinTopic", topic: focus })} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button variant="ghost" label={tr("focus.notProblem")} onPress={() => apply({ kind: "muteTopic", topic: focus })} />
                    </View>
                  </View>
                )}
              </View>
            ) : (
              <Txt variant="secondary" color={t.c.ink3} style={{ marginTop: 8 }}>
                {tr("focus.none")}
              </Txt>
            )}

            <Txt variant="label" style={{ marginTop: 18 }}>{tr("focus.formats")}</Txt>
            <Txt variant="caption" color={t.c.ink3} style={{ marginTop: 2, marginBottom: 10 }}>
              {tr("focus.formatsSub")}
            </Txt>
            <View style={styles.fmtWrap}>
              {SWERVE_FORMATS.map((f) => {
                const on = steering.formatPrefs[f] !== false;
                return (
                  <Pressable
                    key={f}
                    onPress={() => apply({ kind: "toggleFormat", type: f })}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={tr(FMT_LABEL_KEY[f])}
                    style={({ pressed }) => [
                      styles.fmtChip,
                      {
                        backgroundColor: on ? t.c.accentSoft : t.c.surface2,
                        borderColor: on ? t.c.accent : t.c.line,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Txt variant="caption" color={on ? t.c.accent : t.c.ink3}>{tr(FMT_LABEL_KEY[f])}</Txt>
                  </Pressable>
                );
              })}
              {/* Pronunciation: an inert placeholder until EXPO_PUBLIC_VOICE_ENABLED is flipped (voice-
                  direction). When the flag is on it becomes a real opt-in toggle (consent-gated). */}
              {voiceFeatureEnabled() ? (
                <PronunciationToggle
                  on={progress.steering.formatPrefs.pronunciation === true}
                  onToggle={() => apply({ kind: "toggleFormat", type: "pronunciation" })}
                />
              ) : (
                <View style={[styles.fmtChip, { backgroundColor: t.c.surface2, borderColor: t.c.line, opacity: 0.45 }]}>
                  <Txt variant="caption" color={t.c.ink3}>{tr("focus.pronun")}</Txt>
                </View>
              )}
            </View>
          </Card>
        );
      })()}

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

// Opt-in pronunciation toggle (only mounted when EXPO_PUBLIC_VOICE_ENABLED). It is "on" only when the
// learner enabled the pref AND granted voice consent; enabling without consent requests it first.
function PronunciationToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { granted, accept } = useVoiceConsent();
  const active = on && granted;
  const press = async () => {
    if (!granted) await accept(); // separate voice consent (draft copy pending legal sign-off)
    onToggle();
  };
  return (
    <Pressable
      onPress={press}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={tr("focus.pronunOn")}
      style={({ pressed }) => [
        styles.fmtChip,
        {
          backgroundColor: active ? t.c.accentSoft : t.c.surface2,
          borderColor: active ? t.c.accent : t.c.line,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Txt variant="caption" color={active ? t.c.accent : t.c.ink3}>{tr("focus.pronunOn")}</Txt>
    </Pressable>
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
  fmtWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fmtChip: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
});
