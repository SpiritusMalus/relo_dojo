// The feedback panel shown after an answer is checked — shared by the Practice and Story screens.
// Pure presentation over the state produced by useExerciseCheck; the only side effect it triggers
// is the on-demand "Explain" request via onExplain.
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { Exercise, ExplainResult } from "../services/api";
import { useProgress, XP_PER_CORRECT } from "../store/progress";
import { useI18n } from "../store/i18n";
import type { Result } from "../store/useExerciseCheck";
import { useTheme } from "../theme/theme";
import Txt from "./ui/Txt";
import Sensei from "./ui/Sensei";

type Props = {
  result: Result;
  exercise: Exercise;
  levelUp: string | null;
  explained: ExplainResult | null;
  explainLoading: boolean;
  onExplain: () => void;
};

export default function ResultPanel({ result, exercise, levelUp, explained, explainLoading, onExplain }: Props) {
  const t = useTheme();
  const { progress } = useProgress();
  const { t: tr } = useI18n();
  const canExplain = !result.correct && !result.explanation && !explained && !!exercise.token;

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: result.correct ? t.c.accentSoft : t.c.badSoft,
          borderColor: result.correct ? t.c.accent : t.c.bad,
          borderRadius: t.spacing.radius,
        },
      ]}
    >
      <View style={styles.panelHead}>
        <Sensei size={44} mood={result.correct ? "cheer" : "think"} />
        <View style={{ flex: 1 }}>
          <Txt variant="cardTitle" color={result.correct ? t.c.accent : t.c.bad}>
            {result.correct ? tr("result.correct") : tr("result.wrong")}
          </Txt>
          {result.correct ? (
            <Txt variant="bodyStrong" color={t.c.gold}>{tr("result.xp", { n: XP_PER_CORRECT })}</Txt>
          ) : (result.score ?? 0) > 0 && !!result.detail ? (
            <Txt variant="bodyStrong" color={t.c.fire}>{tr("result.almost", { detail: result.detail })}</Txt>
          ) : null}
        </View>
      </View>

      {!result.correct && <CorrectAnswer result={result} />}
      {result.correct && progress.currentCorrectRun >= 3 && (
        <Txt variant="bodyStrong" color={t.c.fire}>{tr("result.streak", { n: progress.currentCorrectRun })}</Txt>
      )}
      {/* Server-awarded koku bonuses (engagement v2): celebrate the daily first win and combo milestones. */}
      {result.correct && (result.first_win_bonus ?? 0) > 0 && (
        <Txt variant="bodyStrong" color={t.c.gold}>{tr("result.firstWin", { n: result.first_win_bonus ?? 0 })}</Txt>
      )}
      {result.correct && (result.combo_bonus ?? 0) > 0 && (
        <Txt variant="bodyStrong" color={t.c.gold}>{tr("result.combo", { n: result.combo_bonus ?? 0 })}</Txt>
      )}
      {!!levelUp && <Txt variant="bodyStrong" color={t.c.accent}>{`⬆ ${levelUp}`}</Txt>}
      {!!result.explanation && <Txt variant="body" color={t.c.ink2}>{`💡 ${result.explanation}`}</Txt>}
      {!!result.tip && <Txt variant="secondary" color={t.c.ink2}>{result.tip}</Txt>}

      {canExplain && (
        <Pressable onPress={onExplain} disabled={explainLoading} accessibilityRole="button" accessibilityLabel={tr("result.explain")} accessibilityState={{ disabled: explainLoading, busy: explainLoading }} style={{ paddingVertical: 6 }}>
          {explainLoading ? (
            <ActivityIndicator color={t.c.accent} />
          ) : (
            <Txt variant="bodyStrong" color={t.c.accent}>{tr("result.explain")}</Txt>
          )}
        </Pressable>
      )}
      {explained && (
        <>
          <Txt variant="body" color={t.c.ink2}>{`💡 ${explained.explanation}`}</Txt>
          {!!explained.tip && <Txt variant="secondary" color={t.c.ink2}>{explained.tip}</Txt>}
        </>
      )}
    </View>
  );
}

// The correct-answer reveal. Multi-line answers (one element per line — match-pairs sends
// "left → right" rows) render as a list; when the server's per-element marks line up, each row
// gets its ✓/✗ so the learner sees WHICH rows went wrong, not just "2/4". Single-line answers
// keep the compact mono style.
function CorrectAnswer({ result }: { result: Result }) {
  const t = useTheme();
  const lines = result.correct_answer.split("\n").filter((l) => l.trim());
  if (lines.length < 2) {
    return (
      <Txt variant="mono" color={t.c.ink} style={{ marginTop: 4 }}>
        {result.correct_answer}
      </Txt>
    );
  }
  const marks = result.per_item && result.per_item.length === lines.length ? result.per_item : null;
  return (
    <View style={styles.answerList}>
      {lines.map((line, i) => (
        <View key={i} style={styles.answerRow}>
          {marks && (
            <Txt variant="bodyStrong" color={marks[i] ? t.c.accent : t.c.bad}>
              {marks[i] ? "✓" : "✗"}
            </Txt>
          )}
          <Txt variant="body" color={t.c.ink} style={{ flex: 1 }}>
            {line}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 2, padding: 16, gap: 8 },
  panelHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  answerList: { marginTop: 4, gap: 6 },
  answerRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
});
