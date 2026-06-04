import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ExerciseProps } from "./types";

// Tap the single wrong word in the sentence. Response is the tapped token index.
export default function TapError({ exercise, locked, onChange }: ExerciseProps) {
  const [selected, setSelected] = useState<number | null>(null);

  function tap(i: number) {
    if (locked) return;
    setSelected(i);
    onChange(i, exercise.tokens[i]);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.prompt}>{exercise.text}</Text>
      <View style={styles.sentence}>
        {exercise.tokens.map((word, i) => (
          <TouchableOpacity
            key={`${i}-${word}`}
            style={[styles.chip, selected === i && styles.chipSelected]}
            onPress={() => tap(i)}
            disabled={locked}
          >
            <Text style={[styles.chipText, selected === i && styles.chipTextSelected]}>{word}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  prompt: { fontSize: 16, color: "#555" },
  sentence: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  chipSelected: { borderColor: "#c0392b", backgroundColor: "#fdecea" },
  chipText: { fontSize: 18, color: "#111" },
  chipTextSelected: { color: "#c0392b", fontWeight: "700" },
});
