// Belt exam: the promotion ritual. EXAM_ITEMS exercises at the TARGET belt's CEFR, at most
// EXAM_MAX_MISSES misses. Cards come from the adaptive queue (topic/type adapt; difficulty is
// pinned to the target belt) and every answer goes through useExerciseCheck, so XP / streak /
// the learner model update like normal practice. Pass → ceremony (the worn belt changes —
// store/exam.ts holds the rules); fail → no loss, but the retry waits until tomorrow.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { gateKind, type Exercise, type ResponseValue } from "../services/api";
import { createExerciseQueue, type ExerciseQueue, type FetchParams } from "../services/exerciseQueue";
import ActivationBanner from "../components/ui/ActivationBanner";
import LimitSheet from "../components/ui/LimitSheet";
import ExerciseCard from "../components/ExerciseCard";
import ResultPanel from "../components/ResultPanel";
import { beltProgress } from "../store/dojo";
import { canAttemptToday, examFailedNow, examOffer, examPassed, EXAM_ITEMS, EXAM_MAX_MISSES } from "../store/exam";
import { isoDay, LISTENING_FORMATS, selectNext } from "../store/adaptive";
import { useProgress } from "../store/progress";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { useExerciseQueueLifetime } from "../store/useExerciseQueueLifetime";
import { useI18n } from "../store/i18n";
import { loadingMessageFor } from "../i18n/loading";
import { beltName } from "../i18n/strings";
import { buildContext } from "../store/onboarding";
import { beltByIndex, useTheme } from "../theme/theme";
import BeltKnot from "../components/ui/BeltKnot";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Confetti from "../components/ui/Confetti";
import Icon from "../components/ui/Icon";
import ProgressBar from "../components/ui/ProgressBar";
import Sensei from "../components/ui/Sensei";
import Txt from "../components/ui/Txt";

type Phase = "intro" | "solving" | "feedback" | "passed" | "failed";

export default function BeltExamScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress, recordExamResult } = useProgress();
  const { t: tr, lang } = useI18n();
  const { result, checking, submissionLocked, error: checkError, check, reset, beginAttempt } = useExerciseCheck();

  // The offer is read once at mount: mid-exam skill changes must not move the goalposts.
  const offerRef = useRef(examOffer(progress));
  const offer = offerRef.current;
  const targetBelt = beltByIndex(offer?.target ?? 0);
  const attemptAllowed = canAttemptToday(progress, isoDay(new Date()));

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const exerciseSpec = useRef<FetchParams | null>(null);
  const queueRef = useRef<ExerciseQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = createExerciseQueue({
      prefetchOnServe: false,
      selectParams: () => {
        if (exerciseSpec.current) return exerciseSpec.current;
        const { topic, type } = selectNext(progressRef.current);
        // A belt exam uses direct evidence for the named skill.
        const unrelatedFormat = LISTENING_FORMATS.has(type) || type === "order-the-dialog";
        let format = type;
        if (topic === "punctuation" && (unrelatedFormat || type === "build-the-sentence" || type === "transform-the-sentence")) {
          format = "tap-the-error";
        } else if (unrelatedFormat || (topic === "word order" && (type === "tap-the-error" || type === "odd-one-out"))) {
          format = "build-the-sentence";
        }
        exerciseSpec.current = {
          topic, level: targetBelt.cefr, type: format, context: buildContext(progressRef.current.profile),
          practice_index: progressRef.current.topics[topic]?.attempts ?? 0, assessment: true,
        };
        return exerciseSpec.current;
      },
    });
  }

  useExerciseQueueLifetime(queueRef.current);
  const [phase, setPhase] = useState<Phase>("intro");
  const [exercise, setExercise] = useState<Exercise | null>(null);
  useEffect(() => { if (exercise) beginAttempt(exercise); }, [exercise, beginAttempt]);
  const [round, setRound] = useState(0);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const [gated, setGated] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [misses, setMisses] = useState(0);
  const active = useRef(true);
  const started = useRef(false);
  const loadingRef = useRef(false);
  const submittingRef = useRef(false);
  const advancedFrom = useRef(0);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const loadExercise = useCallback(async () => {
    if (!active.current || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setLimited(false);
    setGated(false);
    reset();
    setResponse(null);
    setExercise(null);
    try {
      const next = await queueRef.current!.next();
      if (!active.current) return;
      setExercise(next);
      setRound((r) => r + 1);
      setPhase("solving");
    } catch (e) {
      if (!active.current) return;
      const gate = gateKind(e);
      if (gate === "limit") setLimited(true);
      else if (gate === "gated") setGated(true);
      else setError(e instanceof Error ? e.message : "Failed to load exercise");
    } finally {
      loadingRef.current = false;
      if (active.current) setLoading(false);
    }
  }, [reset]);

  function start() {
    if (!active.current || started.current || !attemptAllowed) return;
    started.current = true;
    void loadExercise();
  }

  function close() {
    if (!active.current) return;
    active.current = false;
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }

  async function onCheck() {
    if (!active.current || !offer || !exercise || response === null || checking || phase !== "solving" || submittingRef.current) return;
    submittingRef.current = true;
    try {
      const res = await check(exercise, response);
      if (!res || !active.current) return;
      const newAnswered = answered + 1;
      const newMisses = misses + (res.correct ? 0 : 1);
      setAnswered(newAnswered);
      setMisses(newMisses);
      if (examFailedNow(newMisses) || newAnswered >= EXAM_ITEMS) {
        recordExamResult(examPassed(newMisses), offer.target, isoDay(new Date()));
      }
      setPhase("feedback");
    } finally {
      submittingRef.current = false;
    }
  }

  const examFinished = examFailedNow(misses) || answered >= EXAM_ITEMS;
  function advance() {
    if (!active.current || phase !== "feedback" || answered <= advancedFrom.current) return;
    advancedFrom.current = answered;
    if (examFinished) setPhase(examPassed(misses) ? "passed" : "failed");
    else {
      exerciseSpec.current = null;
      void loadExercise();
    }
  }

  // No exam on offer (deep link / state changed) — bounce home gracefully.
  if (!offer) {
    return (
      <Centered insets={insets}>
        <Sensei size={96} mood="happy" />
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("exam.none")}</Txt>
        <Button label={tr("ch.backHome")} onPress={close} />
      </Centered>
    );
  }

  const loadFailure = limited ? <LimitSheet belt={beltProgress(progress).belt} onUnlocked={loadExercise} />
    : gated || error ? (
      <View style={{ alignSelf: "stretch", gap: 12 }}>
        {gated && <ActivationBanner />}
        <Txt variant="body" color={t.c.ink2} accessibilityRole="alert" style={{ textAlign: "center" }}>
          {tr(gated ? "activate.lockedMsg" : "err.exercise.title")}
        </Txt>
        <Button label={tr("action.tryAgain")} variant="ghost" onPress={loadExercise} />
      </View>
    ) : null;

  if (phase === "intro") {
    return (
      <Centered insets={insets} onClose={close}>
        <BeltKnot belt={targetBelt} size={84} />
        <Txt variant="hero" style={{ textAlign: "center" }}>
          {tr(offer.confirm ? "exam.confirmTitle" : "exam.title", { belt: beltName(targetBelt, lang) })}
        </Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
          {tr("exam.rules", { items: EXAM_ITEMS, misses: EXAM_MAX_MISSES })}
        </Txt>
        {attemptAllowed ? (
          loadFailure ?? (
            <Button
              label={tr(loading ? "cp.starting" : "exam.start")}
              onPress={start}
              disabled={loading}
              left={loading ? <ActivityIndicator size="small" color={t.c.ink3} /> : undefined}
            />
          )
        ) : (
          <Card style={{ alignSelf: "stretch", alignItems: "center" }}>
            <Txt variant="bodyStrong">{tr("exam.tomorrow")}</Txt>
          </Card>
        )}
      </Centered>
    );
  }

  if (phase === "passed") {
    return (
      <Centered insets={insets}>
        <Sensei size={112} mood="cheer" bob />
        <BeltKnot belt={targetBelt} size={96} />
        <Txt variant="hero" style={{ textAlign: "center" }}>{tr("exam.passed", { belt: beltName(targetBelt, lang) })}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("exam.passedSub")}</Txt>
        <Button label={tr("ch.backHome")} onPress={close} style={{ alignSelf: "stretch" }} />
        <Confetti />
      </Centered>
    );
  }

  if (phase === "failed") {
    return (
      <Centered insets={insets}>
        <Sensei size={112} mood="think" />
        <Txt variant="hero" style={{ textAlign: "center" }}>{tr("exam.failed")}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
          {tr("exam.failedSub", { belt: beltName(targetBelt, lang) })}
        </Txt>
        <Button label={tr("ch.backHome")} onPress={close} style={{ alignSelf: "stretch" }} />
      </Centered>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable onPress={close} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={tr("common.close")}>
          <Icon name="x" size={24} color={t.c.ink2} />
        </Pressable>
        <Txt variant="bodyStrong">{tr("exam.progress", { n: Math.min(phase === "feedback" && !loading ? answered : answered + 1, EXAM_ITEMS), total: EXAM_ITEMS })}</Txt>
        <View style={{ flex: 1, marginHorizontal: 14 }}>
          <ProgressBar pct={(answered / EXAM_ITEMS) * 100} height={10} color={targetBelt.color} />
        </View>
        <Txt variant="bodyStrong" color={misses > 0 ? t.c.bad : t.c.ink3}>
          {`✖ ${misses}/${EXAM_MAX_MISSES}`}
        </Txt>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {loading && (
          <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
            <ActivityIndicator color={t.c.accent} />
            <Txt variant="secondary" color={t.c.ink2}>{loadingMessageFor(round, lang)}</Txt>
          </View>
        )}
        {!loading && loadFailure}
        {checkError && !error && (
          <Txt variant="secondary" color={t.c.bad} accessibilityRole="alert" style={{ textAlign: "center" }}>{tr("err.check")}</Txt>
        )}

        {exercise && !loading && (
          <ExerciseCard translationEnabled={false} key={round} exercise={exercise} feedback={result ?? undefined}
            locked={checking || submissionLocked || phase === "feedback"} onChange={(value) => {
              if (!submittingRef.current && !submissionLocked && !result) setResponse(value);
            }} />
        )}
        {phase === "feedback" && result && exercise && (
          <ResultPanel result={result} exercise={exercise} levelUp={null} explained={null} explainLoading={false} />
        )}
      </ScrollView>

      {exercise && !loading && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          {phase === "feedback" ? (
            <Button label={tr(examFinished ? "action.finish" : "action.continue")} onPress={advance} />
          ) : (
            <Button label={tr(checking ? "action.checking" : checkError ? "action.tryAgain" : "action.check")} onPress={onCheck} disabled={response === null || checking} />
          )}
        </View>
      )}
    </View>
  );
}

function Centered({
  children,
  insets,
  onClose,
}: {
  children: React.ReactNode;
  insets: { top: number; bottom: number };
  onClose?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={tr("common.close")}>
            <Icon name="x" size={24} color={t.c.ink2} />
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={[styles.content, { alignItems: "center", gap: 16, paddingBottom: insets.bottom + 40, paddingTop: 24 }]}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, minHeight: 44 },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
});
