import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import Txt from "./ui/Txt";
import { useTranslator } from "./ui/TranslationPopover";

// Sentence with several '___' blanks; pick one option per blank. Response is the picks in order.
export default function MultipleBlanks({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const { translateAt } = useTranslator();
  const blanks = exercise.blankOptions ?? [];
  const sentence = exercise.text ?? "";
  const segments = sentence.split("___");

  // Render a prose segment as long-press-translatable word spans (the blanks between segments are
  // filled options, handled separately). Whitespace stays as plain strings to preserve the layout.
  const words = (seg: string) =>
    seg.split(/(\s+)/).map((part, wi) =>
      /\S/.test(part) ? (
        <Text
          key={wi}
          suppressHighlighting
          onLongPress={(e) =>
            translateAt(part, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, sentence)
          }
        >
          {part}
        </Text>
      ) : (
        part
      )
    );
  // Track the picked option index per blank (not the string): duplicate option texts within a blank
  // must be distinguishable. The value reported to the grader is still the picked strings, in order.
  const [picks, setPicks] = useState<(number | null)[]>(() => blanks.map(() => null));

  function choose(blankIdx: number, optIdx: number) {
    if (locked) return;
    const next = picks.slice();
    next[blankIdx] = optIdx;
    setPicks(next);
    const complete = next.every((p) => p !== null);
    const values = next.map((p, bi) => (p != null ? blanks[bi][p] : null));
    onChange(complete ? (values as string[]) : null, values.map((v) => v ?? "___").join(" / "));
  }

  return (
    <View style={{ gap: 16 }}>
      <Txt variant="cardTitle" style={{ fontSize: 19, lineHeight: 27 }}>
        {segments.map((seg, i) => (
          <Txt key={i} variant="cardTitle" style={{ fontSize: 19, lineHeight: 27 }}>
            {words(seg)}
            {i < blanks.length ? (
              <Txt variant="mono" color={picks[i] != null ? t.c.accent : t.c.ink3}>
                {picks[i] != null ? blanks[i][picks[i]!] : " _____ "}
              </Txt>
            ) : null}
          </Txt>
        ))}
      </Txt>

      {blanks.map((opts, bi) => (
        <View key={bi} style={{ gap: 8 }}>
          <Txt variant="label">{`Blank ${bi + 1}`}</Txt>
          <View style={styles.opts}>
            {opts.map((opt, oi) => {
              const on = picks[bi] === oi;
              return (
                <Pressable
                  key={`${oi}-${opt}`}
                  onPress={() => choose(bi, oi)}
                  onLongPress={(e) =>
                    translateAt(opt, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, sentence)
                  }
                  disabled={locked}
                  accessibilityRole="button"
                  accessibilityLabel={`Blank ${bi + 1}, option ${opt}`}
                  accessibilityState={{ selected: on, disabled: locked }}
                  style={{
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? t.c.accent : t.c.line2,
                    backgroundColor: on ? t.c.accentSoft : t.c.surface,
                    borderRadius: 10,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    minHeight: 44,
                    justifyContent: "center",
                  }}
                >
                  <Txt variant="mono" color={on ? t.c.accent : t.c.ink}>
                    {opt}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ opts: { flexDirection: "row", flexWrap: "wrap", gap: 8 } });
