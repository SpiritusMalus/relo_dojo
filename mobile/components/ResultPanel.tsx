// The feedback panel shown after an answer is checked — shared by the Practice and Story screens.
// Pure presentation over the state produced by useExerciseCheck; the only side effect it triggers
// is the on-demand "Explain" request via onExplain.
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { Exercise, ExplainResult } from "../services/api";
import { useProgress } from "../store/progress";
import { learningLoopCopy } from "../i18n/learningLoopCopy";
import { exerciseCopy } from "../i18n/exerciseCopy";
import { useI18n } from "../store/i18n";
import type { Result } from "../store/useExerciseCheck";
import { useTheme } from "../theme/theme";
import Txt from "./ui/Txt";

type Props = {
  result: Result;
  exercise: Exercise;
  levelUp: string | null;
  explained: ExplainResult | null;
  explainLoading: boolean;
  explainError?: string | null;
  onExplain?: () => void;
};

export default function ResultPanel({ result, exercise, levelUp, explained, explainLoading, explainError, onExplain }: Props) {
  const t = useTheme();
  const { progress } = useProgress();
  const { t: tr, lang } = useI18n();
  const copy = learningLoopCopy(lang);
  const canExplain = !!onExplain && !result.correct && !result.explanation && !explained && !!exercise.token;
  const explainLabel = tr(explainError ? "action.tryAgain" : "result.explain");

  return (
    <View
      style={[
        styles.panel,
        {
          borderColor: t.c.line,
        },
      ]}
    >
      <View style={styles.panelHead}>
        <Txt variant="cardTitle" color={result.correct ? t.c.accent : t.c.bad}>
          {result.correct ? tr("result.correct") : tr("result.wrong")}
        </Txt>
        {result.correct && typeof result.xpEarned === "number" && (
          <Txt variant="bodyStrong" color={t.c.gold}>{tr("result.xp", { n: result.xpEarned })}</Txt>
        )}
      </View>

      {!result.correct && (result.score ?? 0) > 0 && !!result.detail && (
        <Txt variant="bodyStrong" color={t.c.fire}>{tr("result.almost", { detail: result.detail })}</Txt>
      )}
      {!result.correct && <CorrectAnswer result={result} exercise={exercise} />}
      {result.correct && result.hintUsed && <Txt variant="secondary" color={t.c.ink2}>{copy.withHint}</Txt>}
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
      {!!levelUp && <Txt variant="bodyStrong" color={t.c.accent}>{tr("result.levelUp", { level: levelUp })}</Txt>}
      {!!result.explanation && <Txt variant="body" color={t.c.ink2}>{result.explanation}</Txt>}
      {!!result.tip && <Txt variant="secondary" color={t.c.ink2}>{result.tip}</Txt>}

      {canExplain && (
        <>
          {!!explainError && <Txt variant="secondary" color={t.c.bad}>{exerciseCopy(lang).explanationFailed}</Txt>}
          <Pressable onPress={onExplain} disabled={explainLoading} accessibilityRole="button" accessibilityLabel={explainLabel} accessibilityState={{ disabled: explainLoading, busy: explainLoading }} style={{ paddingVertical: 12, minHeight: 48, justifyContent: "center" }}>
            {explainLoading ? <ActivityIndicator color={t.c.accent} /> : (
              <Txt variant="bodyStrong" color={t.c.accent}>{explainLabel}</Txt>
            )}
          </Pressable>
        </>
      )}
      {explained && (
        <>
          <Txt variant="body" color={t.c.ink2}>{explained.explanation}</Txt>
          {!!explained.tip && <Txt variant="secondary" color={t.c.ink2}>{explained.tip}</Txt>}
        </>
      )}
    </View>
  );
}

// The correct-answer reveal. Multi-line answers (one element per line — match-pairs sends
// "left → right" rows) render as a list; when the server's per-element marks line up, each row
// gets its ✓/✗ so the learner sees WHICH rows went wrong, not just "2/4". Single-line answers
// keep the answer in the same readable body face as the exercise.
function CorrectAnswer({ result, exercise }: { result: Result; exercise: Exercise }) {
  const t = useTheme();
  const { lang } = useI18n();
  const copy = exerciseCopy(lang);
  const lines = result.answer_items?.length
    ? result.answer_items
    : result.correct_answer.split("\n").filter((l) => l.trim());
  const marks = result.per_item?.length === lines.length ? result.per_item : null;
  if (lines.length < 2 && !marks) {
    return (
      <Txt variant="bodyStrong" color={t.c.ink} style={{ marginTop: 4, fontSize: 18, lineHeight: 26 }}>
        {result.correct_answer}
      </Txt>
    );
  }
  return (
    <View style={styles.answerList}>
      {lines.map((line, i) => {
        const label = exercise.type === "multiple-blanks" ? `${copy.blank(i + 1)}. ` : "";
        const status = !marks ? undefined : marks[i] ? copy.correct : copy.correction;
        return (
          <View key={i} style={styles.answerRow} accessible={!!marks} accessibilityLabel={status ? `${label}${status}. ${line}` : undefined}>
            {marks && (
              <Txt variant="bodyStrong" color={marks[i] ? t.c.accent : t.c.bad}>
                {marks[i] ? "✓" : "✗"}
              </Txt>
            )}
            <View style={{ flex: 1 }}>
              {marks?.[i] === false && <Txt variant="label" color={t.c.ink2}>{copy.correction}</Txt>}
              <Txt variant="body" color={t.c.ink}>{line}</Txt>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderTopWidth: 1, paddingTop: 18, paddingBottom: 12, gap: 12 },
  panelHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 12, rowGap: 4 },
  answerList: { marginTop: 4, gap: 6 },
  answerRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
});
