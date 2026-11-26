import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import { exerciseCopy } from "../i18n/exerciseCopy";
import Txt from "./ui/Txt";
import { useTranslator } from "./ui/TranslationPopover";

// Tap the single wrong word in the sentence. Response is the tapped token index.
export default function TapError({ exercise, locked, onChange, feedback }: ExerciseProps) {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const copy = exerciseCopy(lang);
  const { translateAt } = useTranslator();
  const tokens = exercise.tokens ?? [];
  const sentence = tokens.join(" ");
  const [selected, setSelected] = useState<number | null>(null);

  function tap(i: number) {
    if (locked) return;
    setSelected(i);
    onChange(i, tokens[i]);
  }

  return (
    <View style={styles.wrap}>
      <Txt variant="body" color={t.c.ink2}>
        {exercise.instruction || tr("ex.tapError")}
      </Txt>
      <View style={styles.sentence}>
        {tokens.map((word, i) => {
          const on = selected === i;
          const bad = on && feedback?.correct === false;
          const emphasis = bad ? t.c.bad : t.c.accent;
          return (
            <Pressable
              key={`${i}-${word}`}
              onPress={() => tap(i)}
              onLongPress={(e) =>
                translateAt(word, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, sentence)
              }
              disabled={locked}
              accessibilityRole="button"
              accessibilityLabel={copy.word(word)}
              accessibilityHint={copy.pickWord}
              accessibilityState={{ selected: on, disabled: locked }}
              style={{
                borderWidth: on ? 2 : 1,
                borderColor: on ? emphasis : t.c.line2,
                backgroundColor: bad ? t.c.badSoft : on ? t.c.accentSoft : t.c.surface,
                borderRadius: 8,
                paddingVertical: 8,
                paddingHorizontal: 11,
                minHeight: 44,
                justifyContent: "center",
              }}
            >
              <Txt variant="mono" color={on ? emphasis : t.c.ink}>
                {word}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  sentence: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
});
