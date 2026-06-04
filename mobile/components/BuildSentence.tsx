import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ExerciseProps } from "./types";

// Word bank: tap a tile to add it to the answer row, tap a placed tile to send it back.
// Tiles are tracked by index (so duplicate words work). Submittable once every tile is placed.
export default function BuildSentence({ exercise, locked, onChange }: ExerciseProps) {
  const tiles = exercise.tiles;
  const [order, setOrder] = useState<number[]>([]); // indices placed in the answer, in order

  function report(next: number[]) {
    const complete = next.length === tiles.length;
    const sentence = next.map((i) => tiles[i]).join(" ");
    onChange(complete ? sentence : null, sentence);
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
      <Text style={styles.prompt}>{exercise.text}</Text>

      {/* Answer row */}
      <View style={styles.answerRow}>
        {order.length === 0 ? (
          <Text style={styles.placeholder}>Tap words to build the sentence…</Text>
        ) : (
          order.map((i) => (
            <TouchableOpacity key={i} style={styles.placedTile} onPress={() => remove(i)} disabled={locked}>
              <Text style={styles.placedText}>{tiles[i]}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Word bank */}
      <View style={styles.bank}>
        {available.map((i) => (
          <TouchableOpacity key={i} style={styles.bankTile} onPress={() => place(i)} disabled={locked}>
            <Text style={styles.bankText}>{tiles[i]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  prompt: { fontSize: 16, color: "#555" },
  answerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    minHeight: 52,
    borderBottomWidth: 2,
    borderColor: "#eaf7ee",
    paddingBottom: 10,
  },
  placeholder: { fontSize: 15, color: "#aaa", fontStyle: "italic", alignSelf: "center" },
  placedTile: { backgroundColor: "#eaf7ee", borderWidth: 1, borderColor: "#0a7d28", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  placedText: { fontSize: 16, color: "#0a7d28", fontWeight: "600" },
  bank: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bankTile: { backgroundColor: "#f3f3f3", borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  bankText: { fontSize: 16, color: "#111" },
});
