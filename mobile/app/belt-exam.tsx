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
import { createExerciseQueue, type ExerciseQueue } from "../services/exerciseQueue";
import ActivationBanner from "../components/ui/ActivationBanner";
import LimitSheet from "../components/ui/LimitSheet";
import ExerciseCard from "../components/ExerciseCard";
import { beltProgress } from "../store/dojo";
import { canAttemptToday, examFailedNow, examOffer, examPassed, EXAM_ITEMS, EXAM_MAX_MISSES } from "../store/exam";
import { isoDay, selectNext } from "../store/adaptive";
import { useProgress } from "../store/progress";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { useI18n } from "../store/i18n";
import { loadingMessageFor } from "../i18n/loading";
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
const FEEDBACK_MS = 1200;

export default function BeltExamScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress, recordExamResult } = useProgress();
  const { t: tr } = useI18n();
  const { result, checking, error: checkError, check, reset } = useExerciseCheck();

  // The offer is read once at mount: mid-exam skill changes must not move the goalposts.
  const offerRef = useRef(examOffer(progress));
  const offer = offerRef.current;
  const targetBelt = beltByIndex(offer?.target ?? 0);
  const attemptAllowed = canAttemptToday(progress, isoDay(new Date()));

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const queueRef = useRef<ExerciseQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = createExerciseQueue({
      selectParams: () => {
        const { topic, type } = selectNext(progressRef.current);
        // Difficulty pinned to the TARGET belt — the whole point of the trial.
        return { topic, level: targetBelt.cefr, type, context: buildContext(progressRef.current.profile) };
      },
    });
  }

  const [phase, setPhase] = useState<Phase>("intro");
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [round, setRound] = useState(0);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const [gated, setGated] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [misses, setMisses] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous in-flight guard: `checking` flips one render late, so a fast double-tap could submit
  // twice before it takes effect. This ref bails immediately.
  const submittingRef = useRef(false);

  // The advance timer is otherwise only cleared inside finish(); mirror challenge.tsx and clear it on
  // unmount so a pending setTimeout can't fire (and load / mutate) after the screen is gone.
  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    []
  );

  const loadExercise = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLimited(false);
    setGated(false);
    reset();
    setResponse(null);
    setExercise(null);
    try {
      setExercise(await queueRef.current!.next());
      setRound((r) => r + 1);
      setPhase("solving");
    } catch (e) {
      const gate = gateKind(e);
      if (gate === "limit") setLimited(true);
      else if (gate === "gated") setGated(true);
      else setError(e instanceof Error ? e.message : "Failed to load exercise");
    } finally {
      setLoading(false);
    }
  }, [reset]);

  function finish(passedRun: boolean) {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    recordExamResult(passedRun, offer!.target, isoDay(new Date()));
    setPhase(passedRun ? "passed" : "failed");
  }

  function start() {
    setAnswered(0);
    setMisses(0);
    queueRef.current!.clear();
    loadExercise();
  }

  async function onCheck() {
    if (!exercise || response === null || checking || phase !== "solving" || submittingRef.current) return;
    submittingRef.current = true;
    try {
      const res = await check(exercise, response);
      if (!res) return;
      const newAnswered = answered + 1;
      const newMisses = misses + (res.correct ? 0 : 1);
      setAnswered(newAnswered);
      setMisses(newMisses);
      setPhase("feedback");
      advanceTimer.current = setTimeout(() => {
        if (examFailedNow(newMisses)) finish(false);
        else if (newAnswered >= EXAM_ITEMS) finish(examPassed(newMisses));
        else loadExercise();
      }, FEEDBACK_MS);
    } finally {
      submittingRef.current = false;
    }
  }

  // No exam on offer (deep link / state changed) — bounce home gracefully.
  if (!offer) {
    return (
      <Centered insets={insets}>
        <Sensei size={96} mood="happy" />
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("exam.none")}</Txt>
        <Button label={tr("ch.backHome")} onPress={() => router.back()} />
      </Centered>
    );
  }

  if (phase === "intro") {
    return (
      <Centered insets={insets} onClose={() => router.back()}>
        <BeltKnot belt={targetBelt} size={84} />
        <Txt variant="hero" style={{ textAlign: "center" }}>
          {tr(offer.confirm ? "exam.confirmTitle" : "exam.title", { belt: targetBelt.name })}
        </Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
          {tr("exam.rules", { items: EXAM_ITEMS, misses: EXAM_MAX_MISSES })}
        </Txt>
        {attemptAllowed ? (
          <Button label={tr("exam.start")} onPress={start} style={{ alignSelf: "stretch" }} />
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
        <Txt variant="hero" style={{ textAlign: "center" }}>{tr("exam.passed", { belt: targetBelt.name })}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("exam.passedSub")}</Txt>
        <Button label={tr("ch.backHome")} onPress={() => router.back()} style={{ alignSelf: "stretch" }} />
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
          {tr("exam.failedSub", { belt: targetBelt.name })}
        </Txt>
        <Button label={tr("ch.backHome")} onPress={() => router.back()} style={{ alignSelf: "stretch" }} />
      </Centered>
    );
  }

  // --- solving / feedback ---
  const verdictColor = result?.correct ? t.c.accent : t.c.bad;
  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Txt variant="bodyStrong">{tr("exam.progress", { n: Math.min(answered + 1, EXAM_ITEMS), total: EXAM_ITEMS })}</Txt>
        <View style={{ flex: 1, marginHorizontal: 14 }}>
          <ProgressBar pct={(answered / EXAM_ITEMS) * 100} height={10} color={targetBelt.color} />
        </View>
        <Txt variant="bodyStrong" color={misses > 0 ? t.c.bad : t.c.ink3}>
          {`✖ ${misses}/${EXAM_MAX_MISSES}`}
        </Txt>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {loading && (
          <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
            <ActivityIndicator color={t.c.accent} />
            <Txt variant="secondary" color={t.c.ink2}>{loadingMessageFor(round)}</Txt>
          </View>
        )}
        {limited && !loading && <LimitSheet belt={beltProgress(progress).belt} onUnlocked={loadExercise} />}
        {gated && !loading && <ActivationBanner />}
        {error && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <Txt variant="body" color={t.c.bad} style={{ textAlign: "center" }}>{error}</Txt>
            <Button label={tr("action.tryAgain")} variant="ghost" onPress={loadExercise} />
          </View>
        )}
        {checkError && !error && (
          <Txt variant="secondary" color={t.c.bad} style={{ textAlign: "center" }}>{checkError}</Txt>
        )}

        {exercise && !loading && (
          <ExerciseCard key={round} exercise={exercise} locked={phase === "feedback"} onChange={(v) => setResponse(v)} />
        )}

        {phase === "feedback" && result && (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, borderColor: verdictColor, borderWidth: 2 }}>
            <Sensei size={40} mood={result.correct ? "cheer" : "think"} />
            <View style={{ flex: 1 }}>
              <Txt variant="cardTitle" color={verdictColor}>
                {result.correct ? tr("ch.strike") : tr("ch.miss")}
              </Txt>
              {!result.correct && <Txt variant="mono" color={t.c.ink2}>{result.correct_answer}</Txt>}
            </View>
          </Card>
        )}
      </ScrollView>

      {phase === "solving" && exercise && !loading && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          <Button label={checking ? tr("action.checking") : tr("action.check")} onPress={onCheck} disabled={response === null || checking} />
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
  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
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
