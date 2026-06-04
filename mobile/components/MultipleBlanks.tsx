import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ExerciseProps } from "./types";

// Sentence with several '___' blanks; pick one option per blank from its own choice set.
// Submittable once every blank is filled. Response is the picks in left-to-right order (string[]).
export default function MultipleBlanks({ exercise, locked, onChange }: ExerciseProps) {
  const blanks = exercise.blankOptions;
  const segments = exercise.text.split("___"); // segments.length === blanks.length + 1 (validated server-side)
  const [picks, setPicks] = useState<(string | null)[]>(() => blanks.map(() => null));

  function choose(blankIdx: number, opt: string) {
    if (locked) return;
    const next = picks.slice();
    next[blankIdx] = opt;
    setPicks(next);
    const complete = next.every((p) => p !== null);
    const display = next.map((p) => p ?? "___").join(" / ");
    onChange(complete ? (next as string[]) : null, display);
  }

  return (
    <View style={styles.wrap}>
      {/* Sentence with the current fills shown inline */}
      <Text style={styles.sentence}>
        {segments.map((seg, i) => (
          <Text key={i}>
            {seg}
            {i < blanks.length && (
              <Text style={picks[i] ? styles.filled : styles.blank}>{picks[i] ?? "_____"}</Text>
            )}
          </Text>
        ))}
      </Text>

      {/* One option row per blank */}
      {blanks.map((opts, bi) => (
        <View key={bi} style={styles.blankRow}>
          <Text style={styles.blankLabel}>Blank {bi + 1}</Text>
          <View style={styles.options}>
            {opts.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.option, picks[bi] === opt && styles.optionSelected]}
                onPress={() => choose(bi, opt)}
                disabled={locked}
              >
                <Text style={[styles.optionText, picks[bi] === opt && styles.optionTextSelected]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  sentence: { fontSize: 19, lineHeight: 28, color: "#111" },
  blank: { color: "#aaa", fontWeight: "600" },
  filled: { color: "#0a7d28", fontWeight: "700" },
  blankRow: { gap: 8 },
  blankLabel: { fontSize: 13, color: "#888", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  optionSelected: { borderColor: "#0a7d28", backgroundColor: "#eaf7ee" },
  optionText: { fontSize: 16, color: "#111" },
  optionTextSelected: { color: "#0a7d28", fontWeight: "600" },
});
