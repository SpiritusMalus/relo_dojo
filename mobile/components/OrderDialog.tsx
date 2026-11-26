import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import { exerciseCopy } from "../i18n/exerciseCopy";
import Icon from "./ui/Icon";
import Txt from "./ui/Txt";

// Reorder shuffled dialog lines. Tap a bank line to append (numbered); tap a placed line to remove.
// When `anchor` is present the opening line is given (fixed at position 1) and the learner only
// orders the remaining tiles — the submitted order is [anchor, ...their picks].
export default function OrderDialog({ exercise, locked, onChange, feedback }: ExerciseProps) {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const copy = exerciseCopy(lang);
  const tiles = exercise.tiles ?? [];
  const anchor = exercise.anchor?.trim() ? exercise.anchor : null;
  const base = anchor ? 1 : 0; // positions occupied before the learner's first placed line
  const [order, setOrder] = useState<number[]>([]);

  function report(next: number[]) {
    const complete = next.length === tiles.length;
    const picks = next.map((i) => tiles[i]);
    const lines = anchor ? [anchor, ...picks] : picks;
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
  function moveUp(position: number) {
    if (locked || position === 0) return;
    const next = order.slice();
    [next[position - 1], next[position]] = [next[position], next[position - 1]];
    setOrder(next);
    report(next);
  }
  const available = tiles.map((_, i) => i).filter((i) => !order.includes(i));

  return (
    <View style={{ gap: 14 }}>
      <Txt variant="label">{tr("ex.orderDialog")}</Txt>

      <View style={{ gap: 8, minHeight: 52 }}>
        {/* Given opening line — fixed at position 1, not removable. */}
        {anchor && (
          <View style={[styles.placed, { backgroundColor: t.c.surface2, borderColor: t.c.line2 }]}>
            <View style={[styles.num, { backgroundColor: t.c.ink3 }]}>
              <Txt variant="caption" color={t.c.surface}>
                1
              </Txt>
            </View>
            <Txt variant="bodyStrong" color={t.c.ink2} style={{ flex: 1 }}>
              {anchor}
            </Txt>
            <Txt variant="caption" color={t.c.ink3}>
              {tr("ex.orderDialogGiven")}
            </Txt>
          </View>
        )}
        {order.length === 0 ? (
          <Txt variant="body" color={t.c.ink3} style={{ fontStyle: "italic" }}>
            {tr("ex.orderDialogHint")}
          </Txt>
        ) : (
          order.map((i, pos) => {
            const marks = feedback?.per_item;
            const mark = marks?.[marks.length === tiles.length + base ? pos + base : pos];
            const color = mark === false ? t.c.bad : t.c.accent;
            return (
              <View key={i} style={[styles.placed, { backgroundColor: mark === false ? t.c.badSoft : t.c.accentSoft, borderColor: color }]}>
                <Pressable
                  onPress={() => remove(i)}
                  disabled={locked}
                  accessibilityRole="button"
                  accessibilityLabel={copy.position(pos + 1 + base, tiles[i])}
                  accessibilityHint={mark === undefined ? copy.removeLine : mark ? copy.correct : copy.wrong}
                  accessibilityState={{ disabled: locked }}
                  style={styles.line}
                >
                  <View style={[styles.num, { backgroundColor: t.c.accent }]}>
                    <Txt variant="caption" color={t.c.accentInk}>{pos + 1 + base}</Txt>
                  </View>
                  <Txt variant="bodyStrong" color={color} style={{ flex: 1 }}>
                    {tiles[i]}
                  </Txt>
                </Pressable>
                {!locked && pos > 0 && (
                  <Pressable
                    onPress={() => moveUp(pos)}
                    accessibilityRole="button"
                    accessibilityLabel={copy.moveLine}
                    accessibilityHint={tiles[i]}
                    style={styles.move}
                  >
                    <View style={styles.up}>
                      <Icon name="chevron" size={20} color={t.c.accent} />
                    </View>
                  </Pressable>
                )}
              </View>
            );
          })
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
  line: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  move: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  up: { transform: [{ rotate: "-90deg" }] },
  bank: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 44, justifyContent: "center" },
});
