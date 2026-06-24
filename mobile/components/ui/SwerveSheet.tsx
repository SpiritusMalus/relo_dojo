import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ExerciseType } from "../../services/api";
import type { SwerveAction } from "../../store/adaptive";
import { TOPIC_PRIORS } from "../../store/adaptive";
import { TOPIC_LABELS } from "../../store/onboarding";
import { useI18n } from "../../store/i18n";
import { RU_TOPIC_LABELS, type StringKey } from "../../i18n/strings";
import { useTheme } from "../../theme/theme";
import Txt from "./Txt";

// Where a swerve applies: "now" tweaks only the current queue; "remember" persists to steering.
export type SwerveScope = "now" | "remember";

// Served exercise formats (free-text is engine-disabled, so it's never offered as a toggle).
export const SWERVE_FORMATS: ExerciseType[] = [
  "multiple-choice",
  "build-the-sentence",
  "match-pairs",
  "tap-the-error",
  "odd-one-out",
  "multiple-blanks",
  "order-the-dialog",
  "transform-the-sentence",
];

export const FMT_LABEL_KEY: Record<ExerciseType, StringKey> = {
  "multiple-choice": "fmt.multiple-choice",
  "build-the-sentence": "fmt.build-the-sentence",
  "match-pairs": "fmt.match-pairs",
  "tap-the-error": "fmt.tap-the-error",
  "odd-one-out": "fmt.odd-one-out",
  "multiple-blanks": "fmt.multiple-blanks",
  "order-the-dialog": "fmt.order-the-dialog",
  "transform-the-sentence": "fmt.transform-the-sentence",
  "free-text": "fmt.free-text",
};

// Low-noise bottom sheet: the learner steers the lesson — easier/harder, switch/hide topic, drop the
// current format — and chooses whether it's just for now or remembered (a persistent override the
// adaptive model honors next time). Pure UI: it emits SwerveActions; practice.tsx applies them.
export default function SwerveSheet({
  visible,
  topic,
  format,
  onApply,
  onClose,
}: {
  visible: boolean;
  topic: string;
  format: ExerciseType;
  onApply: (action: SwerveAction, scope: SwerveScope) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [scope, setScope] = useState<SwerveScope>("now");

  const topicLabel = (id: string) => (lang === "ru" ? RU_TOPIC_LABELS[id] ?? id : TOPIC_LABELS[id] ?? id);
  const apply = (action: SwerveAction) => {
    onApply(action, scope);
    onClose();
  };

  const otherTopics = Object.keys(TOPIC_PRIORS).filter((id) => id !== topic);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr("consent.close")}>
        <Pressable
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: t.c.surface, paddingBottom: insets.bottom + 16, borderColor: t.c.line }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.grabber, { backgroundColor: t.c.line2 }]} />
          <Txt variant="cardTitle" style={{ marginBottom: 10 }}>
            {tr("swerve.title")}
          </Txt>

          {/* Scope: just-now vs remember (persist). */}
          <View style={[styles.segment, { borderColor: t.c.line, backgroundColor: t.c.surface2 }]}>
            {(["now", "remember"] as SwerveScope[]).map((s) => {
              const active = scope === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setScope(s)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.segBtn, active && { backgroundColor: t.c.accent }]}
                >
                  <Txt variant="bodyStrong" color={active ? t.c.accentInk : t.c.ink2}>
                    {tr(s === "now" ? "swerve.now" : "swerve.remember")}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          <Txt variant="caption" color={t.c.ink3} style={{ marginBottom: 14 }}>
            {tr("swerve.scopeHint")}
          </Txt>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Difficulty */}
            <Txt variant="label" style={styles.section}>
              {tr("swerve.difficulty")}
            </Txt>
            <View style={styles.row}>
              <Chip label={tr("swerve.easier")} onPress={() => apply({ kind: "difficulty", delta: -0.5 })} t={t} grow />
              <Chip label={tr("swerve.harder")} onPress={() => apply({ kind: "difficulty", delta: 0.5 })} t={t} grow />
            </View>

            {/* This exercise: drop the current format / hide the topic */}
            <Txt variant="label" style={styles.section}>
              {tr("swerve.format")}
            </Txt>
            <View style={styles.row}>
              <Chip label={tr("swerve.otherFormat")} onPress={() => apply({ kind: "toggleFormat", type: format })} t={t} grow />
              <Chip label={tr("swerve.hideTopic")} onPress={() => apply({ kind: "muteTopic", topic })} t={t} grow danger />
            </View>

            {/* Switch topic — same topic list as Train/Topics. */}
            <Txt variant="label" style={styles.section}>
              {tr("swerve.otherTopic")}
            </Txt>
            <View style={styles.wrap}>
              {otherTopics.map((id) => (
                <Chip key={id} label={topicLabel(id)} onPress={() => apply({ kind: "pinTopic", topic: id })} t={t} />
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Chip({
  label,
  onPress,
  t,
  grow,
  danger,
}: {
  label: string;
  onPress: () => void;
  t: ReturnType<typeof useTheme>;
  grow?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        grow && { flex: 1 },
        { backgroundColor: t.c.surface2, borderColor: danger ? t.c.bad : t.c.line, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Txt variant="bodyStrong" color={danger ? t.c.bad : t.c.ink} style={{ textAlign: "center" }}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 20, maxHeight: "82%" },
  grabber: { width: 44, height: 5, borderRadius: 999, alignSelf: "center", marginBottom: 14 },
  segment: { flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 3, gap: 3 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 11 },
  section: { marginTop: 16, marginBottom: 8 },
  row: { flexDirection: "row", gap: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center" },
});
