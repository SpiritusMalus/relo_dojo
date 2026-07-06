import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import Txt from "./ui/Txt";

// Tap the single wrong word in the sentence. Response is the tapped token index.
export default function TapError({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const tokens = exercise.tokens ?? [];
  const [selected, setSelected] = useState<number | null>(null);

  function tap(i: number) {
    if (locked) return;
    setSelected(i);
    onChange(i, tokens[i]);
  }

  return (
    <View style={styles.wrap}>
      <Txt variant="body" color={t.c.ink2}>
        {tr("ex.tapError")}
      </Txt>
      <View style={styles.sentence}>
        {tokens.map((word, i) => {
          const on = selected === i;
          return (
            <Pressable
              key={`${i}-${word}`}
              onPress={() => tap(i)}
              disabled={locked}
              accessibilityRole="button"
              accessibilityLabel={`Word: ${word}`}
              accessibilityHint="Tap if this word is the mistake"
              accessibilityState={{ selected: on, disabled: locked }}
              style={{
                borderWidth: on ? 2 : 1,
                borderColor: on ? t.c.bad : t.c.line2,
                backgroundColor: on ? t.c.badSoft : t.c.surface,
                borderRadius: 8,
                paddingVertical: 8,
                paddingHorizontal: 11,
                minHeight: 44,
                justifyContent: "center",
              }}
            >
              <Txt variant="mono" color={on ? t.c.bad : t.c.ink}>
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
