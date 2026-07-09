import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import Sensei from "./ui/Sensei";
import Icon from "./ui/Icon";
import Txt from "./ui/Txt";
import TranslatableText from "./ui/TranslatableText";
import { useTranslator } from "./ui/TranslationPopover";

// Build-the-sentence (RU → EN). Prompt card (mascot + RU) → dashed answer track → word bank.
// Tap a bank tile to place it; tap a placed tile to remove. Submittable once enough tiles for the
// full answer are placed — the bank may hold distractor traps that are meant to stay unused.
// Reused for transform-the-sentence: same tile interaction + answer shape, only the prompt header
// differs (a grammar instruction + the English source instead of the RU translation prompt).
export default function BuildSentence({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const tiles = exercise.tiles ?? [];
  const answerLen = tiles.length;
  // Bank = answer tiles + server-sent traps (the word a transform removed, a broken verb form).
  // Without traps the bank IS the answer and assembling degenerates into using everything up —
  // a correction card arrives visibly pre-corrected. Merged + shuffled once per mount; with no
  // traps the server order is kept (it's already shuffled with a not-the-answer guarantee).
  const [bank] = useState<string[]>(() => {
    const traps = exercise.distractors ?? [];
    if (traps.length === 0) return tiles;
    const merged = [...tiles, ...traps];
    for (let i = merged.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [merged[i], merged[j]] = [merged[j], merged[i]];
    }
    return merged;
  });
  const [order, setOrder] = useState<number[]>([]);
  const { translateAt } = useTranslator();
  const isTransform = exercise.type === "transform-the-sentence";
  // The tiles (in answer order) form the English sentence — used only as sense context when a single
  // tile is translated (never shown to the learner, so it doesn't reveal the answer).
  const tileContext = tiles.join(" ");
  const translateTile = (word: string) => (e: GestureResponderEvent) =>
    translateAt(word, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, tileContext);

  function report(next: number[]) {
    // Enough words for the full answer = submittable; leftover bank tiles are (ideally) the traps.
    // Placing a trap instead of a real word is exactly the mistake being tested — still submittable.
    const complete = next.length >= answerLen;
    const sentence = next.map((i) => bank[i]).join(" ");
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
  const available = bank.map((_, i) => i).filter((i) => !order.includes(i));

  return (
    <View style={{ gap: t.spacing.gap }}>
      {/* Prompt card */}
      <View style={[styles.prompt, { backgroundColor: t.c.surface2, borderColor: t.c.line, borderRadius: t.spacing.radius }]}>
        <Sensei size={48} mood="think" />
        <View style={{ flex: 1 }}>
          <Txt variant="label">{isTransform ? exercise.instruction || tr("ex.rewrite") : tr("ex.translate")}</Txt>
          {isTransform ? (
            // Transform shows the English source sentence → make each word long-press-translatable.
            <TranslatableText
              text={exercise.prompt || exercise.text}
              variant="cardTitle"
              style={{ fontSize: 21, lineHeight: 27, marginTop: 4 }}
            />
          ) : (
            // Build shows the Russian source to translate INTO English — nothing to translate here.
            <Txt variant="cardTitle" style={{ fontSize: 21, lineHeight: 27, marginTop: 4 }}>
              {exercise.prompt || exercise.text}
            </Txt>
          )}
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
            {isTransform ? tr("ex.rewriteHint") : tr("ex.buildHint")}
          </Txt>
        ) : (
          order.map((i) => (
            <Tile
              key={i}
              label={bank[i]}
              onPress={() => remove(i)}
              onLongPress={translateTile(bank[i])}
              disabled={locked}
              placed
            />
          ))
        )}
      </View>

      {/* Word bank */}
      <View style={styles.bank}>
        {available.map((i) => (
          <Tile
            key={i}
            label={bank[i]}
            onPress={() => place(i)}
            onLongPress={translateTile(bank[i])}
            disabled={locked}
          />
        ))}
      </View>
    </View>
  );
}

function Tile({
  label,
  onPress,
  onLongPress,
  disabled,
  placed = false,
}: {
  label: string;
  onPress: () => void;
  onLongPress?: (e: GestureResponderEvent) => void;
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
        onLongPress={onLongPress}
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
