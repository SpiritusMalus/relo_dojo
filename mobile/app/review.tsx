// Review mistakes: replay the exact items the learner missed (stored in store/mistakes.ts) and let
// them fix each one. Same check / grade / result flow as Practice (useExerciseCheck + ResultPanel),
// so a fixed item still feeds XP and the adaptive model.
//
// Spaced repetition: the session serves only items that are DUE (Leitner ladder in mistakes.ts) —
// a correct answer climbs the item one box (next review in 1/3/7/21 days; past the ladder it
// graduates off the deck), a miss resets it to the learning phase. Missing it again keeps it for
// next time; stale/unusable items can be removed manually.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type ResponseValue } from "../services/api";
import ExerciseCard from "../components/ExerciseCard";
import ResultPanel from "../components/ResultPanel";
import { useProgress } from "../store/progress";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { useI18n } from "../store/i18n";
import { dueMistakes, loadMistakes, nextDueAt, promoteMistakeStored, resolveMistake, type Mistake } from "../store/mistakes";
import { loadingMessageFor } from "../i18n/loading";
import { useTheme } from "../theme/theme";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";
import Sensei from "../components/ui/Sensei";
import ProgressBar from "../components/ui/ProgressBar";
import Confetti from "../components/ui/Confetti";

export default function ReviewScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress } = useProgress();
  const { t: tr } = useI18n();
  const { result, checking, error: checkError, levelUp, explained, explainLoading, check, doExplain, reset } =
    useExerciseCheck();

  const [items, setItems] = useState<Mistake[] | null>(null); // null = still loading
  const [nextDue, setNextDue] = useState<string | null>(null); // earliest upcoming review (empty state)
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [responseDisplay, setResponseDisplay] = useState("");
  const [fixed, setFixed] = useState(0);
  const [finished, setFinished] = useState(false);

  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Snapshot the DUE items at mount (SRS: not-yet-due items wait for their date); promoting
    // updates storage but we iterate the snapshot.
    loadMistakes().then((list) => {
      const now = new Date().toISOString();
      setItems(dueMistakes(list, now));
      setNextDue(nextDueAt(list, now));
    });
  }, []);

  function onChange(value: ResponseValue | null, display: string) {
    setResponse(value);
    setResponseDisplay(display);
  }

  function runShake() {
    if (t.reduceMotion) return;
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: -7, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -4, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 3, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  const current = items?.[index];
  const total = items?.length ?? 0;
  const isLast = index >= total - 1;

  async function onCheck() {
    if (!current || response === null || checking) return;
    const res = await check(current.exercise, response, runShake);
    if (res?.correct) {
      setFixed((n) => n + 1);
      await promoteMistakeStored(current.id); // climb the SRS ladder (or graduate off the deck)
    }
    // A miss needs no handling here: useExerciseCheck re-captures it → box 0, due immediately.
  }

  function onExplain() {
    if (current) doExplain(current.exercise, responseDisplay);
  }

  function onAdvance() {
    reset();
    setResponse(null);
    setResponseDisplay("");
    if (isLast) setFinished(true);
    else setIndex((i) => i + 1);
  }

  async function onRemove() {
    if (!current) return;
    await resolveMistake(current.id); // stale/unusable token — drop without crediting
    onAdvance();
  }

  const canSubmit = response !== null && !checking;
  const answered = index + (result ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />

      {/* Header: close, progress, streak */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
          <Icon name="x" size={24} color={t.c.ink2} />
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 14 }}>
          <ProgressBar pct={total ? (Math.min(answered, total) / total) * 100 : 0} height={10} />
        </View>
        <Txt variant="caption" color={t.c.fire}>{`🔥 ${progress.dailyStreak}`}</Txt>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {items === null && (
          <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
            <ActivityIndicator color={t.c.accent} />
            <Txt variant="secondary" color={t.c.ink2}>{loadingMessageFor(0)}</Txt>
          </View>
        )}

        {/* Empty state: nothing due — the schedule is working, say when to come back */}
        {items !== null && total === 0 && !finished && (
          <View style={{ alignItems: "center", gap: 12, marginTop: 32 }}>
            <Sensei size={104} mood="happy" bob />
            <Txt variant="cardTitle" color={t.c.accent} style={{ textAlign: "center" }}>{tr("review.empty")}</Txt>
            <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
              {nextDue ? tr("review.nextDue", { date: new Date(nextDue).toLocaleDateString() }) : tr("review.emptySub")}
            </Txt>
          </View>
        )}

        {/* Completion */}
        {finished && (
          <View style={{ alignItems: "center", gap: 14, marginTop: 24 }}>
            <Sensei size={108} mood="cheer" bob />
            <Txt variant="cardTitle" color={t.c.accent}>{tr("review.done")}</Txt>
            <Txt variant="bodyStrong">{tr("review.fixedOfTotal", { c: fixed, t: total })}</Txt>
          </View>
        )}

        {/* Active item */}
        {current && !finished && (
          <>
            <Txt variant="label">{tr("review.progress", { n: index + 1, total })}</Txt>
            <Animated.View style={{ transform: [{ translateX: shake }], gap: t.spacing.gap }}>
              <ExerciseCard key={current.id} exercise={current.exercise} locked={!!result} onChange={onChange} />
            </Animated.View>

            {result && (
              <ResultPanel
                result={result}
                exercise={current.exercise}
                levelUp={levelUp}
                explained={explained}
                explainLoading={explainLoading}
                onExplain={onExplain}
              />
            )}

            {!!checkError && (
              <View style={{ gap: 8 }}>
                <Txt variant="secondary" color={t.c.bad} style={{ textAlign: "center" }}>{checkError}</Txt>
                <Button label={tr("review.remove")} variant="ghost" onPress={onRemove} />
              </View>
            )}
          </>
        )}
      </ScrollView>

      {result?.correct && <Confetti />}

      {/* Sticky bottom action */}
      {items !== null && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          {finished || total === 0 ? (
            <Button label={tr("review.backHome")} onPress={() => router.back()} />
          ) : result ? (
            <Button label={isLast ? tr("action.finish") : tr("action.continue")} onPress={onAdvance} />
          ) : (
            <Button label={checking ? tr("action.checking") : tr("action.check")} onPress={onCheck} disabled={!canSubmit} />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
});
