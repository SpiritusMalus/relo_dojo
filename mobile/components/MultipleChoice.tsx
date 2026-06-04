import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ExerciseProps } from "./types";

// Sentence with a blank + tap one option. (Evolves the Phase-2 choose-the-word UI.)
export default function MultipleChoice({ exercise, locked, onChange }: ExerciseProps) {
  const [selected, setSelected] = useState<string | null>(null);

  function pick(opt: string) {
    if (locked) return;
    setSelected(opt);
    onChange(opt, opt);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.sentence}>{exercise.text}</Text>
      <View style={styles.options}>
        {exercise.options.map((opt) => (
          <TouchableOpacity
            key={opt}
            style={[styles.option, selected === opt && styles.optionSelected]}
            onPress={() => pick(opt)}
            disabled={locked}
          >
            <Text style={[styles.optionText, selected === opt && styles.optionTextSelected]}>
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  sentence: { fontSize: 19, lineHeight: 26, color: "#111" },
  options: { gap: 10 },
  option: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 14 },
  optionSelected: { borderColor: "#0a7d28", backgroundColor: "#eaf7ee" },
  optionText: { fontSize: 16, color: "#111" },
  optionTextSelected: { color: "#0a7d28", fontWeight: "600" },
});
