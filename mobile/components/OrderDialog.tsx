import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import Txt from "./ui/Txt";

// Reorder shuffled dialog lines. Tap a bank line to append (numbered); tap a placed line to remove.
export default function OrderDialog({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const tiles = exercise.tiles;
  const [order, setOrder] = useState<number[]>([]);

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
    <View style={{ gap: 14 }}>
      <Txt variant="label">{exercise.text}</Txt>

      <View style={{ gap: 8, minHeight: 52 }}>
        {order.length === 0 ? (
          <Txt variant="body" color={t.c.ink3} style={{ fontStyle: "italic" }}>
            Tap lines below in order…
          </Txt>
        ) : (
          order.map((i, pos) => (
            <Pressable
              key={i}
              onPress={() => remove(i)}
              disabled={locked}
              accessibilityRole="button"
              accessibilityLabel={`Position ${pos + 1}: ${tiles[i]}`}
              accessibilityHint="Tap to remove this line from your order"
              accessibilityState={{ disabled: locked }}
              style={[styles.placed, { backgroundColor: t.c.accentSoft, borderColor: t.c.accent }]}
            >
              <View style={[styles.num, { backgroundColor: t.c.accent }]}>
                <Txt variant="caption" color={t.c.accentInk}>
                  {pos + 1}
                </Txt>
              </View>
              <Txt variant="bodyStrong" color={t.c.accent} style={{ flex: 1 }}>
                {tiles[i]}
              </Txt>
            </Pressable>
          ))
        )}
      </View>

      <View style={{ gap: 8 }}>
        {available.map((i) => (
          <Pressable
            key={i}
            onPress={() => place(i)}
            disabled={locked}
            accessibilityRole="button"
            accessibilityLabel={tiles[i]}
            accessibilityHint="Tap to add this line next in the order"
            accessibilityState={{ disabled: locked }}
            style={[styles.bank, { backgroundColor: t.c.surface, borderColor: t.c.line2 }]}
          >
            <Txt variant="body">{tiles[i]}</Txt>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placed: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 44 },
  num: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  bank: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 44, justifyContent: "center" },
});
