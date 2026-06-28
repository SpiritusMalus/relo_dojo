import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import Txt from "./ui/Txt";

// Sentence with a blank + tap one option (also used for odd-one-out).
export default function MultipleChoice({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  // For odd-one-out the backend `text` is a fixed English instruction and the options carry the
  // content; show a localized instruction instead. For multiple-choice `text` is the content sentence.
  const prompt = exercise.type === "odd-one-out" ? tr("ex.oddOneOut") : exercise.text;

  function pick(opt: string) {
    if (locked) return;
    setSelected(opt);
    onChange(opt, opt);
  }

  return (
    <View style={styles.wrap}>
      <Txt variant="cardTitle" style={{ fontSize: 19, lineHeight: 26 }}>
        {prompt}
      </Txt>
      <View style={{ gap: 10 }}>
        {exercise.options.map((opt) => {
          const on = selected === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => pick(opt)}
              disabled={locked}
              accessibilityRole="button"
              accessibilityLabel={opt}
              accessibilityState={{ selected: on, disabled: locked }}
              style={{
                borderWidth: on ? 2 : 1,
                borderColor: on ? t.c.accent : t.c.line2,
                backgroundColor: on ? t.c.accentSoft : t.c.surface,
                borderRadius: t.spacing.radiusSm,
                padding: 14,
                minHeight: 48,
                justifyContent: "center",
              }}
            >
              <Txt variant="bodyStrong" color={on ? t.c.accent : t.c.ink}>
                {opt}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: 14 } });
