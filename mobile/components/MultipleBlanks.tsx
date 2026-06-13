import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ExerciseProps } from "./types";
import { useTheme } from "../theme/theme";
import Txt from "./ui/Txt";

// Sentence with several '___' blanks; pick one option per blank. Response is the picks in order.
export default function MultipleBlanks({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const blanks = exercise.blankOptions;
  const segments = exercise.text.split("___");
  const [picks, setPicks] = useState<(string | null)[]>(() => blanks.map(() => null));

  function choose(blankIdx: number, opt: string) {
    if (locked) return;
    const next = picks.slice();
    next[blankIdx] = opt;
    setPicks(next);
    const complete = next.every((p) => p !== null);
    onChange(complete ? (next as string[]) : null, next.map((p) => p ?? "___").join(" / "));
  }

  return (
    <View style={{ gap: 16 }}>
      <Txt variant="cardTitle" style={{ fontSize: 19, lineHeight: 27 }}>
        {segments.map((seg, i) => (
          <Txt key={i} variant="cardTitle" style={{ fontSize: 19, lineHeight: 27 }}>
            {seg}
            {i < blanks.length ? (
              <Txt variant="mono" color={picks[i] ? t.c.accent : t.c.ink3}>
                {picks[i] ?? " _____ "}
              </Txt>
            ) : null}
          </Txt>
        ))}
      </Txt>

      {blanks.map((opts, bi) => (
        <View key={bi} style={{ gap: 8 }}>
          <Txt variant="label">{`Blank ${bi + 1}`}</Txt>
          <View style={styles.opts}>
            {opts.map((opt) => {
              const on = picks[bi] === opt;
              return (
                <Pressable
                  key={opt}
                  onPress={() => choose(bi, opt)}
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
