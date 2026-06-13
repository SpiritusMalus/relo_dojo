import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import Sensei from "./ui/Sensei";
import Icon from "./ui/Icon";
import Txt from "./ui/Txt";

// Build-the-sentence (RU → EN). Prompt card (mascot + RU) → dashed answer track → word bank.
// Tap a bank tile to place it; tap a placed tile to remove. Submittable once every tile is placed.
export default function BuildSentence({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const tiles = exercise.tiles;
  const [order, setOrder] = useState<number[]>([]);

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
    <View style={{ gap: t.spacing.gap }}>
      {/* Prompt card */}
      <View style={[styles.prompt, { backgroundColor: t.c.surface2, borderColor: t.c.line, borderRadius: t.spacing.radius }]}>
        <Sensei size={48} mood="think" />
        <View style={{ flex: 1 }}>
          <Txt variant="label">Translate to English</Txt>
          <Txt variant="cardTitle" style={{ fontSize: 21, lineHeight: 27, marginTop: 4 }}>
            {exercise.prompt || exercise.text}
          </Txt>
        </View>
        <Icon name="sound" size={22} color={t.c.ink3} />
      </View>

      {/* Answer track (dashed drop area) */}
      <View
        style={[
          styles.track,
          { backgroundColor: t.c.surface2, borderColor: t.c.line2, borderRadius: t.spacing.radiusSm },
        ]}
      >
        {order.length === 0 ? (
          <Txt variant="body" color={t.c.ink3} style={{ fontStyle: "italic" }}>
            Tap the words below to build it…
          </Txt>
        ) : (
          order.map((i) => (
            <Tile key={i} label={tiles[i]} onPress={() => remove(i)} disabled={locked} placed />
          ))
        )}
      </View>

      {/* Word bank */}
      <View style={styles.bank}>
        {available.map((i) => (
          <Tile key={i} label={tiles[i]} onPress={() => place(i)} disabled={locked} />
        ))}
      </View>
    </View>
  );
}

function Tile({
  label,
  onPress,
  disabled,
  placed = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  placed?: boolean;
}) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(t.reduceMotion || !placed ? 1 : 0.6)).current;
  useEffect(() => {
    if (!placed || t.reduceMotion) return;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 140 }).start();
  }, [placed, scale, t.reduceMotion]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={placed ? "Tap to remove this word from your answer" : "Tap to add this word to your answer"}
        accessibilityState={{ disabled: !!disabled }}
        style={{
          backgroundColor: placed ? t.c.accentSoft : t.c.surface,
          borderWidth: placed ? 1 : 2,
          borderColor: placed ? t.c.accent : t.c.line2,
          borderRadius: 10,
          paddingVertical: 10,
          paddingHorizontal: 13,
          minHeight: 44,
          justifyContent: "center",
        }}
      >
        <Txt variant="mono" color={placed ? t.c.accent : t.c.ink}>
          {label}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  prompt: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderWidth: 1 },
  track: {
    minHeight: 96,
    borderWidth: 2,
    borderStyle: "dashed",
    padding: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  bank: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
