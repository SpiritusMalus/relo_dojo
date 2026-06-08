// Mini-story screen: a themed set of linked exercises played as a short narrative arc.
//
// The whole set is fetched up front (the backend generates the beats in sequence), then the learner
// steps through one narration + exercise at a time. The check / grade / record / level-up flow and
// the result panel are the exact same ones the Practice screen uses (useExerciseCheck + ResultPanel),
// so a story answer counts toward XP, streaks and the adaptive model just like a normal card.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getStory, type ResponseValue, type StorySet } from "../services/api";
import ExerciseCard from "../components/ExerciseCard";
import ResultPanel from "../components/ResultPanel";
import { useProgress, XP_PER_CORRECT } from "../store/progress";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { beltProgress } from "../store/dojo";
import { useTheme } from "../theme/theme";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";
import Sensei from "../components/ui/Sensei";
import ProgressBar from "../components/ui/ProgressBar";
import Confetti from "../components/ui/Confetti";

export default function StoryScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress } = useProgress();
  const { result, checking, error: checkError, levelUp, explained, explainLoading, check, doExplain, reset } =
    useExerciseCheck();

  const [story, setStory] = useState<StorySet | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [beatIndex, setBeatIndex] = useState(0);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [responseDisplay, setResponseDisplay] = useState("");
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const error = loadError ?? checkError;

  const shake = useRef(new Animated.Value(0)).current;

  const loadStory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    reset();
    setResponse(null);
    setResponseDisplay("");
    setBeatIndex(0);
    setCorrectCount(0);
    setFinished(false);
    setStory(null);
    try {
      // Lock the whole set to the learner's current overall CEFR.
      const level = beltProgress(progress).cefr;
      setStory(await getStory({ level }));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load the story");
    } finally {
      setLoading(false);
    }
    // progress is intentionally read once at load; restarting a story re-reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reset]);

  useEffect(() => {
    loadStory();
  }, [loadStory]);

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

  const beat = story?.beats[beatIndex];
  const isLast = !!story && beatIndex >= story.beats.length - 1;

  async function onCheck() {
    if (!beat || response === null || checking) return;
    const res = await check(beat.exercise, response, runShake);
    if (res?.correct) setCorrectCount((c) => c + 1);
  }

  function onExplain() {
    if (beat) doExplain(beat.exercise, responseDisplay);
  }

  function onAdvance() {
    reset();
    setResponse(null);
    setResponseDisplay("");
    if (isLast) {
      setFinished(true);
    } else {
      setBeatIndex((i) => i + 1);
    }
  }

  const canSubmit = response !== null && !checking;
  const total = story?.beats.length ?? 0;
  // Header progress: count answered beats (the current one once it's been checked).
  const answered = beatIndex + (result ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />

      {/* Header: close, set progress, streak */}
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
        {loading && (
          <View style={{ alignItems: "center", gap: 12, marginTop: 40 }}>
            <Sensei size={88} mood="think" bob />
            <ActivityIndicator color={t.c.accent} />
            <Txt variant="secondary" color={t.c.ink2}>Writing your story…</Txt>
          </View>
        )}

        {error && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <Txt variant="body" color={t.c.bad} style={{ textAlign: "center" }}>
              {error}
            </Txt>
            <Button label="Try again" variant="ghost" onPress={loadStory} />
          </View>
        )}

        {/* Completion summary */}
        {finished && story && !loading && (
          <View style={{ alignItems: "center", gap: 14, marginTop: 24 }}>
            <Sensei size={104} mood="cheer" bob />
            <Txt variant="cardTitle" color={t.c.accent}>{story.title} — done!</Txt>
            <Txt variant="bodyStrong">{`${correctCount} / ${total} correct`}</Txt>
            <Txt variant="bodyStrong" color={t.c.gold}>{`+${correctCount * XP_PER_CORRECT} XP`}</Txt>
          </View>
        )}

        {/* Active beat */}
        {story && beat && !finished && !loading && (
          <>
            {beatIndex === 0 && !!story.intro && (
              <Card style={{ gap: 6 }}>
                <Txt variant="cardTitle">{story.title}</Txt>
                <Txt variant="body" color={t.c.ink2}>{story.intro}</Txt>
              </Card>
            )}

            {!!beat.narration && (
              <Card style={styles.narration}>
                <Sensei size={40} mood="happy" />
                <Txt variant="body" color={t.c.ink2} style={{ flex: 1 }}>{beat.narration}</Txt>
              </Card>
            )}

            <Animated.View style={{ transform: [{ translateX: shake }], gap: t.spacing.gap }}>
              <ExerciseCard key={beatIndex} exercise={beat.exercise} locked={!!result} onChange={onChange} />
            </Animated.View>

            {result && (
              <ResultPanel
                result={result}
                exercise={beat.exercise}
                levelUp={levelUp}
                explained={explained}
                explainLoading={explainLoading}
                onExplain={onExplain}
              />
            )}
          </>
        )}
      </ScrollView>

      {result?.correct && <Confetti />}

      {/* Sticky bottom action */}
      {story && !loading && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          {finished ? (
            <Button label="Back to home" onPress={() => router.back()} />
          ) : result ? (
            <Button label={isLast ? "Finish" : "Next"} onPress={onAdvance} />
          ) : (
            <Button label={checking ? "Checking…" : "Check"} onPress={onCheck} disabled={!canSubmit} />
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
  narration: { flexDirection: "row", alignItems: "center", gap: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
});
