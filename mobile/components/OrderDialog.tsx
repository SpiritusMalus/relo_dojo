import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ExerciseProps } from "./types";

// Reorder shuffled dialog lines into a coherent conversation. Tap a bank line to append it to the
// answer (numbered), tap a placed line to send it back. Submittable once every line is placed.
// Response is the lines in the chosen order (string[]).
export default function OrderDialog({ exercise, locked, onChange }: ExerciseProps) {
  const tiles = exercise.tiles;
  const [order, setOrder] = useState<number[]>([]); // tile indices in chosen order

  function report(next: number[]) {
    const complete = next.length === tiles.length;
    const lines = next.map((i) => tiles[i]);
    onChange(complete ? lines : null, lines.join(" → "));
  }

  function place(i: number) {
    if (locked || order.includes(i)) return;
    const next = [...order, i];
    setOrder(next);
    report(next);
  }

  function remove(i: number) {
    if (locked) return;
    const next = order.filter((x) => x !== i);
    setOrder(next);
    report(next);
  }

  const available = tiles.map((_, i) => i).filter((i) => !order.includes(i));

  return (
    <View style={styles.wrap}>
      <Text style={styles.instruction}>{exercise.text}</Text>

      {/* Answer list (ordered) */}
      <View style={styles.answer}>
        {order.length === 0 ? (
          <Text style={styles.placeholder}>Tap lines below in order…</Text>
        ) : (
          order.map((i, pos) => (
            <TouchableOpacity key={i} style={styles.placedLine} onPress={() => remove(i)} disabled={locked}>
              <Text style={styles.num}>{pos + 1}</Text>
              <Text style={styles.placedText}>{tiles[i]}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Shuffled bank */}
      <View style={styles.bank}>
        {available.map((i) => (
          <TouchableOpacity key={i} style={styles.bankLine} onPress={() => place(i)} disabled={locked}>
            <Text style={styles.bankText}>{tiles[i]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  instruction: { fontSize: 14, color: "#0a7d28", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  answer: { gap: 8, minHeight: 52 },
  placeholder: { fontSize: 15, color: "#aaa", fontStyle: "italic" },
  placedLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#eaf7ee",
    borderWidth: 1,
    borderColor: "#0a7d28",
    borderRadius: 8,
    padding: 12,
  },
  num: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
    backgroundColor: "#0a7d28",
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: "center",
    lineHeight: 24,
    overflow: "hidden",
  },
  placedText: { flex: 1, fontSize: 16, color: "#0a7d28", fontWeight: "600" },
  bank: { gap: 8 },
  bankLine: { backgroundColor: "#f3f3f3", borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12 },
  bankText: { fontSize: 16, color: "#111" },
});
