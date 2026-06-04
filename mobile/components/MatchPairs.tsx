import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ResponseValue } from "../services/api";
import type { ExerciseProps } from "./types";

// Two columns. Tap a left item, then a right item, to link them (one-to-one).
// Response is a { leftId: rightId } map; submittable once every left item is linked.
export default function MatchPairs({ exercise, locked, onChange }: ExerciseProps) {
  const { left, right } = exercise;
  const [map, setMap] = useState<Record<number, number>>({});
  const [pendingLeft, setPendingLeft] = useState<number | null>(null);

  const rightText = (id: number) => right.find((r) => r.id === id)?.text ?? "";

  function report(next: Record<number, number>) {
    const complete = Object.keys(next).length === left.length;
    const value: ResponseValue = Object.fromEntries(
      Object.entries(next).map(([k, v]) => [String(k), v])
    );
    const display = left
      .map((l) => (next[l.id] != null ? `${l.text} → ${rightText(next[l.id])}` : ""))
      .filter(Boolean)
      .join("; ");
    onChange(complete ? value : null, display);
  }

  function tapLeft(id: number) {
    if (locked) return;
    setPendingLeft(id === pendingLeft ? null : id);
  }

  function tapRight(rightId: number) {
    if (locked || pendingLeft == null) return;
    // Keep it a bijection: drop any left currently linked to this right.
    const next: Record<number, number> = {};
    for (const [k, v] of Object.entries(map)) {
      if (v !== rightId) next[Number(k)] = v;
    }
    next[pendingLeft] = rightId;
    setMap(next);
    setPendingLeft(null);
    report(next);
  }

  const usedRight = new Set(Object.values(map));

  return (
    <View style={styles.wrap}>
      <Text style={styles.prompt}>{exercise.text}</Text>
      <View style={styles.columns}>
        <View style={styles.col}>
          {left.map((l) => {
            const linked = map[l.id] != null;
            const active = pendingLeft === l.id;
            return (
              <TouchableOpacity
                key={l.id}
                style={[styles.item, linked && styles.itemLinked, active && styles.itemActive]}
                onPress={() => tapLeft(l.id)}
                disabled={locked}
              >
                <Text style={styles.itemText}>{l.text}</Text>
                {linked && <Text style={styles.linkHint}>→ {rightText(map[l.id])}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.col}>
          {right.map((r) => {
            const used = usedRight.has(r.id);
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.item, used && styles.itemUsed]}
                onPress={() => tapRight(r.id)}
                disabled={locked || pendingLeft == null}
              >
                <Text style={styles.itemText}>{r.text}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  prompt: { fontSize: 16, color: "#555" },
  columns: { flexDirection: "row", gap: 12 },
  col: { flex: 1, gap: 10 },
  item: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, minHeight: 48, justifyContent: "center" },
  itemActive: { borderColor: "#0a7d28", borderWidth: 2 },
  itemLinked: { backgroundColor: "#eaf7ee", borderColor: "#0a7d28" },
  itemUsed: { backgroundColor: "#eaf7ee", borderColor: "#0a7d28" },
  itemText: { fontSize: 15, color: "#111" },
  linkHint: { fontSize: 12, color: "#0a7d28", marginTop: 4 },
});
