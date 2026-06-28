// Level Test — the full, retakeable English placement (store/levelTest.ts). Adaptive and OFFLINE:
// items come from the curated bank and are graded locally against the known answer (no LLM). The
// estimate stops once it settles; the result re-seeds the skill estimate and raises the worn belt,
// and — unlike the onboarding warm-up (capped at B2) — it can place at C1.
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { assessWriting, type ResponseValue } from "../services/api";
import { itemToExercise, pickWritingPrompt, type CalItem } from "../store/calibrationBank";
import {
  combineLevels,
  isDone,
  levelTestResult,
  nextItem,
  recordAnswer,
  startLevelTest,
  LT_MAX_ITEMS,
  type LevelTestResult,
  type LevelTestState,
} from "../store/levelTest";
import { isoDay } from "../store/adaptive";
import { beltProgress } from "../store/dojo";
import { seedSkillFromLevel } from "../store/onboarding";
import { useProgress } from "../store/progress";
import { useI18n } from "../store/i18n";
import { beltByCefr, useTheme } from "../theme/theme";
import ExerciseCard from "../components/ExerciseCard";
import BeltKnot from "../components/ui/BeltKnot";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Confetti from "../components/ui/Confetti";
import Icon from "../components/ui/Icon";
import ProgressBar from "../components/ui/ProgressBar";
import Sensei from "../components/ui/Sensei";
import Txt from "../components/ui/Txt";

type Phase = "intro" | "solving" | "feedback" | "writing" | "scoring" | "done";

export default function LevelTestScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress, applyLevelTest } = useProgress();
  const { t: tr } = useI18n();

  // Seed from the learner's current overall skill so a returning user converges fast (the adaptive
  // selection corrects from anywhere — this just starts nearer).
  const seed = beltProgress(progress).overallSkill;
  const stRef = useRef<LevelTestState>(startLevelTest(seed));

  const [phase, setPhase] = useState<Phase>("intro");
  const [item, setItem] = useState<CalItem | null>(null);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [result, setResult] = useState<{ correct: boolean; answer: string } | null>(null);
  const [count, setCount] = useState(0); // answered so far (for the progress header)
  const [done, setDone] = useState<LevelTestResult | null>(null);
  // Writing section (productive skill): runs after the adaptive MCQ part, then folds into the level.
  const receptiveRef = useRef(0); // the MCQ-section estimate, blended with the writing score
  const [writingPrompt, setWritingPrompt] = useState("");
  const [writingText, setWritingText] = useState("");

  const exercise = useMemo(() => (item ? itemToExercise(item) : null), [item]);

  // The MCQ section is done → hand off to the writing task (prompt chosen at the placed level).
  const toWriting = useCallback(() => {
    receptiveRef.current = stRef.current.theta;
    setWritingPrompt(pickWritingPrompt(stRef.current.theta).prompt);
    setWritingText("");
    setPhase("writing");
  }, []);

  const loadNext = useCallback(() => {
    const next = nextItem(stRef.current);
    if (!next) {
      toWriting();
      return;
    }
    setItem(next);
    setResponse(null);
    setResult(null);
    setPhase("solving");
  }, [toWriting]);

  const start = useCallback(() => {
    stRef.current = startLevelTest(seed);
    setCount(0);
    loadNext();
  }, [seed, loadNext]);

  const onCheck = useCallback(() => {
    if (!item || response === null || phase !== "solving") return;
    const correct = response === item.answer;
    stRef.current = recordAnswer(stRef.current, item, correct);
    setCount(stRef.current.answered);
    setResult({ correct, answer: item.answer });
    setPhase("feedback");
  }, [item, response, phase]);

  const onNext = useCallback(() => {
    if (isDone(stRef.current)) toWriting();
    else loadNext();
  }, [loadNext, toWriting]);

  // Submit the writing task → CEFR-score it server-side → blend into the level. On any failure
  // (offline / LLM down) or skip, fall back gracefully to the receptive-only placement.
  const finishWithReceptiveOnly = useCallback(() => {
    setDone(levelTestResult(stRef.current));
    setPhase("done");
  }, []);

  const onSubmitWriting = useCallback(async () => {
    setPhase("scoring");
    try {
      const w = await assessWriting(writingText.trim(), writingPrompt);
      setDone(combineLevels(receptiveRef.current, w.score));
      setPhase("done");
    } catch {
      finishWithReceptiveOnly();
    }
  }, [writingText, writingPrompt, finishWithReceptiveOnly]);

  const onSave = useCallback(() => {
    if (!done) return;
    const skill = seedSkillFromLevel(done.level, progress.profile?.focusTopics ?? []);
    applyLevelTest(skill, done.beltIdx, isoDay(new Date()));
    router.back();
  }, [done, progress.profile, applyLevelTest, router]);

  if (phase === "intro") {
    return (
      <Centered insets={insets} onClose={() => router.back()}>
        <Sensei size={96} mood="think" bob />
        <Txt variant="hero" style={{ textAlign: "center" }}>{tr("lt.title")}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("lt.intro")}</Txt>
        <Button label={tr("lt.start")} onPress={start} style={{ alignSelf: "stretch" }} />
      </Centered>
    );
  }

  if (phase === "scoring") {
    return (
      <Centered insets={insets}>
        <Sensei size={96} mood="think" bob />
        <ActivityIndicator color={t.c.accent} />
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("lt.scoring")}</Txt>
      </Centered>
    );
  }

  if (phase === "writing") {
    return (
      <Centered insets={insets} onClose={() => router.back()}>
        <Sensei size={80} mood="think" />
        <Txt variant="hero" style={{ textAlign: "center" }}>{tr("lt.writingTitle")}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("lt.writingIntro")}</Txt>
        <Card style={{ alignSelf: "stretch", backgroundColor: t.c.surface2 }}>
          <Txt variant="bodyStrong" color={t.c.ink}>{writingPrompt}</Txt>
        </Card>
        <TextInput
          value={writingText}
          onChangeText={setWritingText}
          placeholder={tr("lt.writingPlaceholder")}
          placeholderTextColor={t.c.ink3}
          multiline
          textAlignVertical="top"
          style={[styles.input, { color: t.c.ink, backgroundColor: t.c.surface, borderColor: t.c.line2 }]}
        />
        <Button label={tr("lt.writingSubmit")} onPress={onSubmitWriting} disabled={writingText.trim().length < 15} style={{ alignSelf: "stretch" }} />
        <Button label={tr("lt.writingSkip")} variant="ghost" onPress={finishWithReceptiveOnly} />
      </Centered>
    );
  }

  if (phase === "done" && done) {
    const belt = beltByCefr(done.cefr);
    return (
      <Centered insets={insets}>
        <Sensei size={112} mood="cheer" bob />
        <BeltKnot belt={belt} size={96} />
        <Txt variant="hero" style={{ textAlign: "center" }}>{tr("lt.resultTitle", { cefr: done.cefr })}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("lt.resultSub", { n: count })}</Txt>
        <Button label={tr("lt.save")} onPress={onSave} style={{ alignSelf: "stretch" }} />
        <Confetti />
      </Centered>
    );
  }

  // --- solving / feedback ---
  const verdictColor = result?.correct ? t.c.accent : t.c.bad;
  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
          <Icon name="x" size={24} color={t.c.ink2} />
        </Pressable>
        <Txt variant="bodyStrong">{tr("lt.question", { n: count + (phase === "feedback" ? 0 : 1) })}</Txt>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <ProgressBar pct={(count / LT_MAX_ITEMS) * 100} height={10} color={t.c.accent} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {/* Reading items carry a passage shown above the question; other skills have none. */}
        {item?.passage && (
          <Card style={{ backgroundColor: t.c.surface2 }}>
            <Txt variant="body" color={t.c.ink}>{item.passage}</Txt>
          </Card>
        )}
        {exercise && (
          <ExerciseCard key={item!.id} exercise={exercise} locked={phase === "feedback"} onChange={(v) => setResponse(v)} />
        )}

        {phase === "feedback" && result && (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, borderColor: verdictColor, borderWidth: 2 }}>
            <Sensei size={40} mood={result.correct ? "cheer" : "think"} />
            <View style={{ flex: 1 }}>
              <Txt variant="cardTitle" color={verdictColor}>
                {result.correct ? tr("ob.correct") : tr("ob.notQuite")}
              </Txt>
              {!result.correct && <Txt variant="mono" color={t.c.ink2}>{result.answer}</Txt>}
            </View>
          </Card>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
        {phase === "solving" ? (
          <Button label={tr("action.check")} onPress={onCheck} disabled={response === null} />
        ) : (
          <Button label={tr("action.continue")} onPress={onNext} />
        )}
      </View>
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
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, gap: 8 },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  input: { alignSelf: "stretch", minHeight: 120, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
});
