import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import type { ExerciseProps } from "./types";
import DataGuard from "./ui/DataGuard";
import FontScaleText from "./ui/FontScaleText";
import { useI18n } from "../store/i18n";
import { exerciseCopy } from "../i18n/exerciseCopy";
import { useTheme } from "../theme/theme";

// The one typing exercise (rare/advanced). LLM-graded via the parent.
export default function FreeText({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const { lang } = useI18n();
  const copy = exerciseCopy(lang);
  const [value, setValue] = useState("");

  function change(text: string) {
    if (locked) return;
    const capped = text.slice(0, 2000);
    setValue(capped);
    const trimmed = capped.trim();
    onChange(trimmed ? trimmed : null, trimmed);
  }

  return (
    <View style={styles.wrap}>
      <FontScaleText style={[styles.sentence, { color: t.c.ink }]}>{exercise.text ?? ""}</FontScaleText>
      <TextInput
        style={[styles.input, { color: t.c.ink, backgroundColor: t.c.surface, borderColor: t.c.line2 }]}
        placeholder={copy.freeText}
        placeholderTextColor={t.c.ink3}
        accessibilityLabel={copy.freeText}
        value={value}
        onChangeText={change}
        editable={!locked}
        autoCapitalize="sentences"
        multiline
        maxLength={2000}
      />
      <DataGuard />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  sentence: { fontSize: 19, lineHeight: 26 },
  input: {
    borderWidth: 1,
    minHeight: 96,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
});
