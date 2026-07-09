import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import Txt from "./ui/Txt";
import TranslatableText from "./ui/TranslatableText";
import { useTranslator } from "./ui/TranslationPopover";

// Sentence with a blank + tap one option (also used for odd-one-out).
export default function MultipleChoice({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { translateAt } = useTranslator();
  // Track selection by index (not string): two options with identical text must be distinguishable.
  const [selected, setSelected] = useState<number | null>(null);
  const options = exercise.options ?? [];
  // For odd-one-out the backend `text` is a fixed English instruction and the options carry the
  // content; show a localized instruction instead. For multiple-choice `text` is the content sentence.
  const isOddOneOut = exercise.type === "odd-one-out";
  const prompt = isOddOneOut ? tr("ex.oddOneOut") : exercise.text;

  function pick(i: number, opt: string) {
    if (locked) return;
    setSelected(i);
    onChange(opt, opt);
  }

  return (
    <View style={styles.wrap}>
      {isOddOneOut ? (
        // Localized instruction, not English content — nothing to translate.
        <Txt variant="cardTitle" style={{ fontSize: 19, lineHeight: 26 }}>
          {prompt}
        </Txt>
      ) : (
        <TranslatableText text={prompt} variant="cardTitle" style={{ fontSize: 19, lineHeight: 26 }} />
      )}
      <View style={{ gap: 10 }}>
        {options.map((opt, i) => {
          const on = selected === i;
          return (
            <Pressable
              key={`${i}-${opt}`}
              onPress={() => pick(i, opt)}
              onLongPress={(e) =>
                translateAt(opt, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, exercise.text)
              }
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
