import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../../store/i18n";
import { useProgress } from "../../store/progress";
import { masteryOf, unitFor, MASTERY_MIN_CORRECT, MASTERY_MIN_HARD, RULE_CARDS } from "../../store/curriculum";
import { TOPIC_LABELS } from "../../store/onboarding";
import { RU_TOPIC_LABELS } from "../../i18n/strings";
import { beltByCefr, useTheme } from "../../theme/theme";
import Button from "./Button";
import ProgressBar from "./ProgressBar";
import Txt from "./Txt";

// The Presentation step of the course (PPP): a short learner-facing rule + worked examples for one
// unit, shown BEFORE drilling (path node tap) and on demand mid-session (the 📖 pill in practice).
// Below the rule: the unit's mastery meter, so "what unlocks the next topic" is always explicit.
export default function RuleSheet({
  topic,
  visible,
  onTrain,
  onClose,
}: {
  topic: string;
  visible: boolean;
  /** Present = show the train CTA (path entry); absent = reference view (already in a session). */
  onTrain?: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const { progress } = useProgress();

  const card = RULE_CARDS[topic];
  const unit = unitFor(topic);
  if (!card) return null; // off-syllabus topic (defensive) — nothing to present
  const label = (lang === "ru" ? RU_TOPIC_LABELS[topic] : TOPIC_LABELS[topic]) ?? TOPIC_LABELS[topic] ?? topic;
  const band = unit ? beltByCefr(unit.band) : null;
  const mastery = masteryOf(progress.course?.history[topic]);
  const mastered = (progress.course?.mastered ?? []).includes(topic);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={tr("course.close")} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: t.c.surface, paddingBottom: insets.bottom + 16, borderColor: t.c.line },
        ]}
      >
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
          {/* Header: unit title + CEFR band chip */}
          <View style={styles.headRow}>
            <Txt variant="cardTitle" style={{ flex: 1 }}>{`📖 ${label}`}</Txt>
            {unit && band && (
              <View style={[styles.bandChip, { backgroundColor: band.color, borderColor: band.edge }]}>
                <Txt variant="caption" color={band.ink}>{unit.band}</Txt>
              </View>
            )}
          </View>

          {/* The rule */}
          <Txt variant="body" color={t.c.ink} style={{ marginTop: 10, lineHeight: 22 }}>
            {lang === "ru" ? card.rule.ru : card.rule.en}
          </Txt>

          {/* Worked examples */}
          <Txt variant="label" style={{ marginTop: 14 }}>{tr("course.examples")}</Txt>
          <View style={{ gap: 8, marginTop: 6 }}>
            {card.examples.map((ex, i) => (
              <View
                key={i}
                style={[styles.example, { backgroundColor: t.c.surface2, borderColor: t.c.line }]}
              >
                <Txt variant="bodyStrong">{ex.en}</Txt>
                <Txt variant="secondary" color={t.c.ink2}>{ex.ru}</Txt>
              </View>
            ))}
          </View>

          {/* Mastery meter: the explicit gate to the next unit */}
          <View style={{ marginTop: 14, gap: 6 }}>
            {mastered ? (
              <Txt variant="secondary" color={t.c.accent}>{`✓ ${tr("jp.mastered")}`}</Txt>
            ) : (
              <>
                <Txt variant="secondary" color={t.c.ink2}>
                  {tr("course.meter", {
                    c: mastery.correct,
                    t: MASTERY_MIN_CORRECT,
                    h: mastery.hard,
                    ht: MASTERY_MIN_HARD,
                  })}
                </Txt>
                <ProgressBar pct={mastery.pct} height={8} />
                <Txt variant="caption" color={t.c.ink3}>{tr("course.meterHint")}</Txt>
              </>
            )}
          </View>
        </ScrollView>

        <View style={{ gap: 8, marginTop: 14 }}>
          {onTrain && <Button label={tr(mastered ? "course.review" : "course.train")} onPress={onTrain} />}
          <Button label={tr("course.close")} variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    padding: 18,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bandChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1.5 },
  example: { borderRadius: 12, borderWidth: 1, padding: 10, gap: 2 },
});
