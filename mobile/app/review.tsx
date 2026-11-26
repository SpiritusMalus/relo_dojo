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
import { ApiError, renewReviewToken, type ResponseValue } from "../services/api";
import ExerciseCard from "../components/ExerciseCard";
import ResultPanel from "../components/ResultPanel";
import { useProgress } from "../store/progress";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { useI18n } from "../store/i18n";
import { useAccountScope } from "../store/useAccountScope";
import { isCurrentAccountScope } from "../store/accountScope";
import { dueMistakes, loadMistakes, nextDueAt, promoteMistakeStored, renewMistakeToken, type Mistake } from "../store/mistakes";
import { loadingMessageFor } from "../i18n/loading";
import { learningLoopCopy } from "../i18n/learningLoopCopy";
import { useTheme } from "../theme/theme";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";
import Sensei from "../components/ui/Sensei";
import ProgressBar from "../components/ui/ProgressBar";
import Confetti from "../components/ui/Confetti";

export default function ReviewScreen() {
  const scope = useAccountScope();
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress } = useProgress();
  const { t: tr, lang } = useI18n();
  const copy = learningLoopCopy(lang);
  const { result, checking, submissionLocked, error: checkError, errorCode, checkErrorKey, explainError, levelUp, explained, explainLoading, check, doExplain, reset, beginAttempt, markHintUsed } =
    useExerciseCheck();

  const [items, setItems] = useState<Mistake[] | null>(null); // null = still loading
  const [nextDue, setNextDue] = useState<string | null>(null); // earliest upcoming review (empty state)
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [responseDisplay, setResponseDisplay] = useState("");
  const [fixed, setFixed] = useState(0);
  const [sessionXp, setSessionXp] = useState(0);
  const [remainingDue, setRemainingDue] = useState(0);
  const [finished, setFinished] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [renewal, setRenewal] = useState<"idle" | "pending" | "failed" | "unrecoverable">("idle");
  const [submittingState, setSubmittingState] = useState(false);
  const submitting = useRef(false);
  const advancedIndex = useRef(-1);
  const renewedIds = useRef(new Set<string>());
  const hinted = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Snapshot the DUE items at mount (SRS: not-yet-due items wait for their date); promoting
    // updates storage but we iterate the snapshot.
    let active = true;
    setItems(null);
    setIndex(0);
    setFixed(0);
    setSkipped(0);
    setRenewal("idle");
    setSubmittingState(false);
    advancedIndex.current = -1;
    renewedIds.current.clear();
    hinted.current = false;
    setSessionXp(0);
    setRemainingDue(0);
    setFinished(false);
    setResponse(null);
    setResponseDisplay("");
    loadMistakes(scope).then((list) => {
      if (!active || !isCurrentAccountScope(scope)) return;
      const now = new Date().toISOString();
      setItems(dueMistakes(list, now));
      setNextDue(nextDueAt(list, now));
    });
    return () => { active = false; };
  }, [scope]);

  function onChange(value: ResponseValue | null, display: string) {
    if (submitting.current || submissionLocked || result) return;
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
  useEffect(() => { if (current) beginAttempt(current.exercise); }, [current, beginAttempt]);
  const total = items?.length ?? 0;
  const isLast = index >= total - 1;

  const expired = errorCode === "exercise_expired" || (!errorCode && /expired/i.test(checkError ?? ""));
  const canRecover = expired && renewal !== "unrecoverable" && !!current?.exercise.token
    && !renewedIds.current.has(current.id);
  const unrecoverable = expired && !canRecover && renewal !== "pending";
  const stillOpen = () => active.current && isCurrentAccountScope(scope);

  async function onCheck() {
    if (!current || response === null || checking || result || submitting.current || unrecoverable || !stillOpen()) return;
    submitting.current = true;
    setSubmittingState(true);
    try {
      let exercise = current.exercise;
      if (canRecover) {
        setRenewal("pending");
        try {
          const renewed = await renewReviewToken(exercise.token!);
          if (!stillOpen()) return;
          exercise = { ...exercise, token: renewed.review_token, review_token: undefined };
          renewedIds.current.add(current.id);
          setItems((list) => list?.map((item) => item.id === current.id ? { ...item, exercise } : item) ?? null);
          await renewMistakeToken(current.id, renewed.review_token, scope).catch(() => {});
          if (!stillOpen()) return;
          beginAttempt(exercise);
          if (hinted.current) markHintUsed();
        } catch (error) {
          const noRenewal = error instanceof ApiError &&
            (error.code === "review_unrecoverable" || error.status === 403 || error.status === 404);
          if (stillOpen()) setRenewal(noRenewal ? "unrecoverable" : "failed");
          return;
        }
      }
      const res = await check(exercise, response, runShake, responseDisplay);
      if (!res || !stillOpen()) return;
      setSessionXp((n) => n + (res.xpEarned ?? 0));
      if (res.correct && !res.hintUsed && !hinted.current) {
        setFixed((n) => n + 1);
        await promoteMistakeStored(current.id, scope);
      }
    } finally {
      submitting.current = false;
      if (stillOpen()) {
        setSubmittingState(false);
        setRenewal((state) => state === "pending" ? "idle" : state);
      }
    }
  }

  function onExplain() {
    if (current && stillOpen()) void doExplain(current.exercise, responseDisplay);
  }

  function onAdvance(skip = false) {
    if (!stillOpen() || !current || submitting.current || index <= advancedIndex.current || (skip && submissionLocked && !unrecoverable)) return;
    advancedIndex.current = index;
    if (skip) setSkipped((n) => n + 1);
    reset();
    setResponse(null);
    setResponseDisplay("");
    setRenewal("idle");
    hinted.current = false;
    if (isLast) {
      setFinished(true);
      void loadMistakes(scope).then((list) => {
        if (!stillOpen()) return;
        const now = new Date().toISOString();
        setNextDue(nextDueAt(list, now));
        setRemainingDue(dueMistakes(list, now).length);
      });
    } else setIndex((i) => i + 1);
  }

  const canSubmit = response !== null && !checking && !submittingState;
  const answered = finished ? total : index + (result ? 1 : 0);

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
        <View accessible accessibilityLabel={`${progress.dailyStreak} ${tr("prog.dayStreak")}`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="flame" size={16} color={t.c.fire} />
          <Txt variant="caption" color={t.c.fire}>{progress.dailyStreak}</Txt>
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {items === null && (
          <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
            <ActivityIndicator color={t.c.accent} />
            <Txt variant="secondary" color={t.c.ink2}>{loadingMessageFor(0, lang)}</Txt>
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
            <Txt variant="bodyStrong">{tr("review.fixedOfTotal", { c: fixed, t: total - skipped })}</Txt>
            <Txt variant="bodyStrong" color={t.c.gold}>{tr("result.xp", { n: sessionXp })}</Txt>
            {skipped > 0 && <Txt variant="secondary" color={t.c.ink2}>{tr("exercise.skipped", { n: skipped })}</Txt>}
            {remainingDue > 0 ? <Txt variant="secondary" color={t.c.ink2}>{copy.reviewReady(remainingDue)}</Txt> : nextDue && <Txt variant="secondary" color={t.c.ink2}>{copy.nextReview(new Date(nextDue).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US"))}</Txt>}
          </View>
        )}

        {/* Active item */}
        {current && !finished && (
          <>
            <Txt variant="label">{tr("review.progress", { n: index + 1, total })}</Txt>
            <Animated.View style={{ transform: [{ translateX: shake }], gap: t.spacing.gap }}>
              <ExerciseCard onHint={() => { hinted.current = true; markHintUsed(); }}
                key={current.id} exercise={current.exercise} feedback={result ?? undefined}
                locked={checking || submissionLocked || submittingState || !!result} onChange={onChange} onSkip={() => onAdvance(true)} />
            </Animated.View>

            {result && (
              <ResultPanel
                result={result}
                exercise={current.exercise}
                levelUp={levelUp}
                explained={explained}
                explainLoading={explainLoading}
                explainError={explainError}
                onExplain={onExplain}
              />
            )}
            {result?.correct && result.hintUsed && <Txt variant="secondary" color={t.c.ink2}>{copy.reviewHint}</Txt>}

            {checkError && !result && (
              <View style={{ gap: 8 }}>
                <Txt variant="secondary" color={t.c.bad} accessibilityRole="alert" style={{ textAlign: "center" }}>
                  {tr(unrecoverable ? "review.unrecoverable" : canRecover && renewal !== "failed" ? "review.expired" : (checkErrorKey ?? "err.check"))}
                </Txt>
                {unrecoverable && (
                  <Button label={tr("review.practiceTopic")} variant="ghost"
                    onPress={() => router.navigate({ pathname: "/practice", params: { topic: current.topic } })} />
                )}
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
            <Button label={copy.back} onPress={() => router.replace("/(tabs)")} />
          ) : result ? (
            <Button label={isLast ? tr("action.finish") : tr("action.continue")} disabled={submittingState} onPress={() => onAdvance()} />
          ) : (
            unrecoverable ? <Button label={tr("action.continue")} onPress={() => onAdvance(true)} /> : (
              <Button
                label={tr(renewal === "pending" ? "review.renewing" : checking ? "action.checking"
                  : canRecover ? "review.renew" : checkError ? "action.tryAgain" : "action.check")}
                onPress={onCheck} disabled={!canSubmit}
              />
            )
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
