// Mini-story screen: a themed set of linked exercises played as a short narrative arc.
//
// The whole set is fetched up front (the backend generates the beats in sequence), then the learner
// steps through one narration + exercise at a time. The check / grade / record / level-up flow and
// the result panel are the exact same ones the Practice screen uses (useExerciseCheck + ResultPanel),
// so a story answer counts toward XP, streaks and the adaptive model just like a normal card.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  buyContent,
  gateKind,
  getStory,
  getStoryCatalog,
  retryStoryBeat,
  type ResponseValue,
  type StoryArc,
  type StorySet,
} from "../services/api";
import { useWallet } from "../store/wallet";
import { captureAccountScope, isCurrentAccountScope } from "../store/accountScope";
import ActivationBanner from "../components/ui/ActivationBanner";
import ExerciseCard from "../components/ExerciseCard";
import ResultPanel from "../components/ResultPanel";
import { useProgress } from "../store/progress";
import { learningLoopCopy } from "../i18n/learningLoopCopy";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { useI18n } from "../store/i18n";
import { buildContext } from "../store/onboarding";
import { loadingMessageFor } from "../i18n/loading";
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
  const latestProgress = useRef(progress);
  latestProgress.current = progress;
  const { t: tr, lang } = useI18n();
  const copy = learningLoopCopy(lang);
  const ownerScope = useRef(captureAccountScope()).current;
  const activeRef = useRef(true);
  const storyRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; storyRequest.current?.abort(); storyRequest.current = null; };
  }, []);
  const current = useCallback(() => activeRef.current && isCurrentAccountScope(ownerScope), [ownerScope]);
  const { result, checking, submissionLocked, error: checkError, checkErrorKey, explainError, levelUp, explained, explainLoading, check, doExplain, reset, beginAttempt, markHintUsed } =
    useExerciseCheck();

  const { coins, refresh: refreshWallet } = useWallet();
  const [story, setStory] = useState<StorySet | null>(null);
  const [arcs, setArcs] = useState<StoryArc[] | null>(null); // chooser list (null until fetched)
  const [buying, setBuying] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gated, setGated] = useState(false); // 403: account gate → activation prompt, not an error
  const [beatIndex, setBeatIndex] = useState(0);
  const [retryingBeat, setRetryingBeat] = useState(false);
  const [beatError, setBeatError] = useState(false);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [responseDisplay, setResponseDisplay] = useState("");
  const [correctCount, setCorrectCount] = useState(0);
  const [sessionXp, setSessionXp] = useState(0);
  const [unaidedCount, setUnaidedCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const submitting = useRef(false);
  const buyingRef = useRef(false);
  const catalogRequest = useRef(false);
  const lastStory = useRef<{ id?: string } | null>(null);
  const advancedBeat = useRef(-1);

  const shake = useRef(new Animated.Value(0)).current;

  const loadStory = useCallback(async (id?: string) => {
    if (!current() || storyRequest.current) return;
    const controller = new AbortController();
    storyRequest.current = controller;
    lastStory.current = { id };
    setLoading(true);
    setLoadError(null);
    setGated(false);
    reset();
    setResponse(null);
    setResponseDisplay("");
    setBeatIndex(0);
    setBeatError(false);
    advancedBeat.current = -1;
    setSkipped(0);
    setCorrectCount(0);
    setSessionXp(0);
    setUnaidedCount(0);
    setFinished(false);
    setStory(null);
    try {
      // Lock the whole set to the learner's current overall CEFR; flavor exercises to their field
      // (universal story frame, field-specific examples). Empty context falls back to the scenario.
      const level = beltProgress(latestProgress.current).cefr;
      const context = buildContext(latestProgress.current.profile);
      const set = await getStory({ level, context, id }, controller.signal);
      if (!current()) return;
      // A story with no beats has nothing to play — the Check button would be permanently dead. Treat
      // an empty/malformed set as a load failure so the retry/error state shows instead of a stuck screen.
      if (!set.beats?.length) throw new Error("The story came back empty. Try again.");
      setStory(set);
    } catch (e) {
      if (!current()) return;
      // Stories are verified-only on the server; any 403 here is an account gate, not an error.
      if (gateKind(e)) setGated(true);
      else setLoadError(e instanceof Error ? e.message : "Failed to load the story");
    } finally {
      if (storyRequest.current === controller) {
        storyRequest.current = null;
        if (current()) setLoading(false);
      }
    }
  }, [reset, current]);

  // Show the arc chooser first ("today's different" + unlockable premium arcs). Falls back to a
  // straight random story if the catalog can't be fetched (offline / old backend).
  const loadCatalog = useCallback(async () => {
    if (!current() || catalogRequest.current) return;
    catalogRequest.current = true;
    setLoading(true);
    setLoadError(null);
    setGated(false);
    try {
      const catalog = await getStoryCatalog();
      if (current()) setArcs(catalog.arcs);
    } catch {
      if (current()) await loadStory(); // Older servers still support the ordinary story.
    } finally {
      catalogRequest.current = false;
      if (current()) setLoading(false);
    }
  }, [loadStory, current]);

  function retryLoad() {
    if (lastStory.current) void loadStory(lastStory.current.id);
    else void loadCatalog();
  }

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Unlock a premium arc with koku, then start it.
  async function unlockAndPlay(arc: StoryArc) {
    if (buyingRef.current || !current()) return;
    buyingRef.current = true;
    setBuying(arc.id);
    try {
      await buyContent(arc.id);
      if (!current()) return;
      await refreshWallet();
      if (!current()) return;
      await loadStory(arc.id);
    } catch (e) {
      if (!current()) return;
      setLoadError(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      buyingRef.current = false;
      if (current()) setBuying(null);
    }
  }

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

  const beat = story?.beats[beatIndex];
  useEffect(() => { if (beat?.exercise) beginAttempt(beat.exercise); }, [beat?.exercise, beginAttempt]);
  const isLast = !!story && beatIndex >= story.beats.length - 1;

  async function onCheck() {
    if (!current() || !beat?.exercise || response === null || checking || result || submitting.current) return;
    submitting.current = true;
    try {
      const res = await check(beat.exercise, response, runShake, responseDisplay);
      if (!res || !current()) return;
      setSessionXp((n) => n + (res.xpEarned ?? 0));
      if (res.correct) setCorrectCount((c) => c + 1);
      if (res.correct && !res.hintUsed) setUnaidedCount((c) => c + 1);
    } finally {
      submitting.current = false;
    }
  }

  function onExplain() {
    if (current() && beat?.exercise) void doExplain(beat.exercise, responseDisplay);
  }

  async function retryBeat() {
    const resumeToken = story?.resume_token;
    if (!current() || !resumeToken || !beat || beat.exercise || storyRequest.current) return;
    const controller = new AbortController();
    const index = beatIndex;
    storyRequest.current = controller;
    setRetryingBeat(true);
    setBeatError(false);
    try {
      const exercise = await retryStoryBeat(resumeToken, index, controller.signal);
      if (!current() || storyRequest.current !== controller) return;
      setStory((previous) => previous?.resume_token === resumeToken ? {
        ...previous,
        beats: previous.beats.map((item, i) => i === index ? { ...item, exercise } : item),
      } : previous);
    } catch {
      if (current() && !controller.signal.aborted) setBeatError(true);
    } finally {
      if (storyRequest.current === controller) {
        storyRequest.current = null;
        if (current()) setRetryingBeat(false);
      }
    }
  }

  function onAdvance(skip = false) {
    if (!current() || !beat || storyRequest.current || submitting.current || advancedBeat.current >= beatIndex || (skip && submissionLocked)) return;
    advancedBeat.current = beatIndex;
    if (skip) setSkipped((n) => n + 1);
    setBeatError(false);
    reset();
    setResponse(null);
    setResponseDisplay("");
    if (isLast) {
      setFinished(true);
    } else {
      setBeatIndex((i) => i + 1);
    }
  }

  function leave() {
    if (!current()) return;
    activeRef.current = false;
    storyRequest.current?.abort();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/train");
  }

  // X mid-story: confirm once at least one beat is answered (otherwise nothing is lost).
  function onClose() {
    if (!current()) return;
    const started = !!story && !finished && (beatIndex > 0 || !!result);
    if (!started) {
      leave();
      return;
    }
    Alert.alert(tr("exit.title"), tr("exit.msgStory"), [
      { text: tr("exit.stay"), style: "cancel" },
      { text: tr("exit.leave"), style: "destructive", onPress: leave },
    ]);
  }

  const canSubmit = response !== null && !checking;
  const total = story?.beats.length ?? 0;
  // Header progress: count answered beats (the current one once it's been checked).
  const answered = finished ? total : beatIndex + (result ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />

      {/* Header: close, set progress, streak */}
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel={tr("common.close")} accessibilityRole="button">
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
        {loading && (
          <View style={{ alignItems: "center", gap: 12, marginTop: 40 }}>
            <Sensei size={88} mood="think" bob />
            <ActivityIndicator color={t.c.accent} />
            <Txt variant="secondary" color={t.c.ink2}>{loadingMessageFor(0, lang)}</Txt>
          </View>
        )}

        {gated && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <ActivationBanner />
            <Txt variant="secondary" color={t.c.ink3} style={{ textAlign: "center" }}>
              {tr("activate.lockedMsg")}
            </Txt>
            <Button label={tr("action.tryAgain")} variant="ghost" onPress={retryLoad} />
          </View>
        )}

        {loadError && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <Txt variant="bodyStrong" accessibilityRole="alert" style={{ textAlign: "center" }}>
              {tr("story.loadError")}
            </Txt>
            <Button label={tr("action.tryAgain")} variant="ghost" onPress={retryLoad} />
          </View>
        )}

        {/* Arc chooser — "today's different" featured pick + free/premium arcs. */}
        {arcs && !story && !loading && !gated && !loadError && (
          <View style={{ gap: 10, marginTop: 8 }}>
            <Txt variant="cardTitle">{tr("story.chooseTitle")}</Txt>
            {[...arcs].sort((a, b) => Number(b.featured) - Number(a.featured)).map((arc) => (
              <Pressable
                key={arc.id}
                onPress={() => (arc.owned ? loadStory(arc.id) : unlockAndPlay(arc))}
                disabled={buying !== null || (!arc.owned && coins < arc.price)}
                accessibilityRole="button"
                accessibilityState={{ disabled: buying !== null || (!arc.owned && coins < arc.price), busy: buying === arc.id }}
              >
                <Card>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Txt variant="bodyStrong">{arc.title}</Txt>
                        {arc.featured && <Txt variant="caption" color={t.c.gold}>{tr("story.featured")}</Txt>}
                      </View>
                      <Txt variant="secondary" color={t.c.ink2} numberOfLines={2}>{arc.intro}</Txt>
                    </View>
                    {!arc.owned && (
                      <Txt variant="bodyStrong" color={coins >= arc.price ? t.c.gold : t.c.ink3}>
                        {buying === arc.id ? "…" : `🔒 ${arc.price} 🌾`}
                      </Txt>
                    )}
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}

        {/* Completion summary */}
        {finished && story && !loading && (
          <View style={{ alignItems: "center", gap: 14, marginTop: 24 }}>
            <Sensei size={104} mood="cheer" bob />
            <Txt variant="cardTitle" color={t.c.accent}>{tr("story.done", { title: story.title })}</Txt>
            <Txt variant="bodyStrong">{tr("story.correctOfTotal", { c: correctCount, t: total - skipped })}</Txt>
            <Txt variant="bodyStrong" color={t.c.gold}>{tr("result.xp", { n: sessionXp })}</Txt>
            <Txt variant="secondary" color={t.c.ink2}>{copy.unassisted(unaidedCount, total - skipped)}</Txt>
            {skipped > 0 && <Txt variant="secondary" color={t.c.ink2}>{tr("exercise.skipped", { n: skipped })}</Txt>}
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

            {beat.exercise ? (
              <>
                <Animated.View style={{ transform: [{ translateX: shake }], gap: t.spacing.gap }}>
                  <ExerciseCard onHint={markHintUsed} key={beatIndex} exercise={beat.exercise} feedback={result ?? undefined}
                    locked={checking || submissionLocked || !!result} onChange={onChange} onSkip={() => onAdvance(true)} />
                </Animated.View>
                {checkError && !result && (
                  <Txt variant="secondary" color={t.c.bad} accessibilityRole="alert">{tr(checkErrorKey ?? "err.check")}</Txt>
                )}
                {result && (
                  <ResultPanel result={result} exercise={beat.exercise} levelUp={levelUp}
                    explained={explained} explainLoading={explainLoading} explainError={explainError} onExplain={onExplain} />
                )}
              </>
            ) : (
              <Card style={{ gap: 8 }}>
                <Txt variant="bodyStrong" accessibilityLiveRegion="polite">
                  {tr(retryingBeat ? "story.preparingBeat" : beatError ? "story.retryBeatError" : "story.beatUnavailable")}
                </Txt>
                {!!story.resume_token && !retryingBeat && (
                  <Button label={tr("story.skipBeat")} variant="ghost" onPress={() => onAdvance(true)} />
                )}
              </Card>
            )}
          </>
        )}
      </ScrollView>

      {result?.correct && <Confetti />}

      {/* Sticky bottom action */}
      {story && !loading && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          {finished ? (
            <Button label={tr("story.backHome")} onPress={leave} />
          ) : beat && !beat.exercise ? (
            story.resume_token ? (
              <Button label={tr(retryingBeat ? "story.preparingBeat" : "action.tryAgain")} onPress={retryBeat}
                disabled={retryingBeat} left={retryingBeat ? <ActivityIndicator color={t.c.ink3} size="small" /> : undefined} />
            ) : <Button label={tr("story.skipBeat")} onPress={() => onAdvance(true)} />
          ) : result ? (
            <Button label={isLast ? tr("action.finish") : tr("action.continue")} onPress={() => onAdvance()} />
          ) : (
            <Button label={tr(checking ? "action.checking" : checkError ? "action.tryAgain" : "action.check")} onPress={onCheck} disabled={!canSubmit} />
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
