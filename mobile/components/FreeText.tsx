import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import type { ExerciseProps } from "./types";
import DataGuard from "./ui/DataGuard";
import FontScaleText from "./ui/FontScaleText";

// The one typing exercise (rare/advanced). LLM-graded via the parent.
export default function FreeText({ exercise, locked, onChange }: ExerciseProps) {
  const [value, setValue] = useState("");

  function change(text: string) {
    setValue(text);
    const trimmed = text.trim();
    onChange(trimmed ? trimmed : null, trimmed);
  }

  return (
    <View style={styles.wrap}>
      <FontScaleText style={styles.sentence}>{exercise.text ?? ""}</FontScaleText>
      <TextInput
        style={styles.input}
        placeholder="Your answer"
        value={value}
        onChangeText={change}
        editable={!locked}
        autoCapitalize="none"
      />
      <DataGuard />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  sentence: { fontSize: 19, lineHeight: 26, color: "#111" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
});
