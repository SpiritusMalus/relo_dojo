import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ResponseValue } from "../services/api";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import Txt from "./ui/Txt";

// Two columns. Tap a left item, then a right item, to link them (one-to-one).
export default function MatchPairs({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const left = exercise.left ?? [];
  const right = exercise.right ?? [];
  const [map, setMap] = useState<Record<number, number>>({});
  const [pendingLeft, setPendingLeft] = useState<number | null>(null);

  const rightText = (id: number) => right.find((r) => r.id === id)?.text ?? "";

  function report(next: Record<number, number>) {
    const complete = Object.keys(next).length === left.length;
    const value: ResponseValue = Object.fromEntries(Object.entries(next).map(([k, v]) => [String(k), v]));
    const display = left.map((l) => (next[l.id] != null ? `${l.text} → ${rightText(next[l.id])}` : "")).filter(Boolean).join("; ");
    onChange(complete ? value : null, display);
  }

  function tapLeft(id: number) {
    if (locked) return;
    setPendingLeft(id === pendingLeft ? null : id);
  }
  function tapRight(rightId: number) {
    if (locked || pendingLeft == null) return;
    const next: Record<number, number> = {};
    for (const [k, v] of Object.entries(map)) if (v !== rightId) next[Number(k)] = v;
    next[pendingLeft] = rightId;
    setMap(next);
    setPendingLeft(null);
    report(next);
  }

  const usedRight = new Set(Object.values(map));

  const itemStyle = (active: boolean, linked: boolean) => ({
    borderWidth: active ? 2 : 1,
    borderColor: active || linked ? t.c.accent : t.c.line2,
    backgroundColor: linked ? t.c.accentSoft : t.c.surface,
    borderRadius: t.spacing.radiusSm,
    padding: 12,
    minHeight: 48,
    justifyContent: "center" as const,
  });

  return (
    <View style={styles.wrap}>
      <Txt variant="body" color={t.c.ink2}>
        {tr("ex.matchPairs")}
      </Txt>
      <View style={styles.columns}>
        <View style={styles.col}>
          {left.map((l) => {
            const linked = map[l.id] != null;
            const active = pendingLeft === l.id;
            return (
              <Pressable
                key={l.id}
                style={itemStyle(active, linked)}
                onPress={() => tapLeft(l.id)}
                disabled={locked}
                accessibilityRole="button"
                accessibilityLabel={l.text}
                accessibilityState={{ selected: active, disabled: locked }}
              >
                <Txt variant="bodyStrong">{l.text}</Txt>
                {linked && (
                  <Txt variant="secondary" color={t.c.accent}>{`→ ${rightText(map[l.id])}`}</Txt>
                )}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.col}>
          {right.map((r) => {
            const used = usedRight.has(r.id);
            return (
              <Pressable
                key={r.id}
                style={itemStyle(false, used)}
                onPress={() => tapRight(r.id)}
                disabled={locked || pendingLeft == null}
                accessibilityRole="button"
                accessibilityLabel={r.text}
                accessibilityState={{ selected: used, disabled: locked || pendingLeft == null }}
              >
                <Txt variant="bodyStrong">{r.text}</Txt>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  columns: { flexDirection: "row", gap: 12 },
  col: { flex: 1, gap: 10 },
});
