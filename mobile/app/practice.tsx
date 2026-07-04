import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { gateKind, postSessionSummary, type Exercise, type ResponseValue, type SessionAnswer } from "../services/api";
import { track, trackExerciseAnswered } from "../services/analytics";
import { createExerciseQueue, type ExerciseQueue } from "../services/exerciseQueue";
import ActivationBanner from "../components/ui/ActivationBanner";
import LimitSheet from "../components/ui/LimitSheet";
import { beltProgress } from "../store/dojo";
import ExerciseCard from "../components/ExerciseCard";
import ResultPanel from "../components/ResultPanel";
import { useProgress, mergeSteering, DEFAULT_STEERING, type Steering } from "../store/progress";
import { effectiveSkill, levelToCefr, selectNext, applySteeringAction, type SwerveAction } from "../store/adaptive";
import SwerveSheet, { type SwerveScope } from "../components/ui/SwerveSheet";
import RuleSheet from "../components/ui/RuleSheet";
import { masteryOf, RULE_CARDS } from "../store/curriculum";
import PronunciationCard from "../components/ui/PronunciationCard";
import { canServePronunciation, voiceFeatureEnabled } from "../services/voice";
import { useVoiceConsent } from "../store/voiceConsent";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { useI18n } from "../store/i18n";
import { loadMistakes, mistakeHintsForTopic, type Mistake } from "../store/mistakes";
import { loadingMessageFor } from "../i18n/loading";
import { RU_TOPIC_LABELS } from "../i18n/strings";
import { buildContext, TOPIC_LABELS } from "../store/onboarding";
import { useTheme } from "../theme/theme";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";
import ProgressBar from "../components/ui/ProgressBar";
import Card from "../components/ui/Card";
import Confetti from "../components/ui/Confetti";
import Scroll from "../components/ui/Scroll";
import { boostActive } from "../store/progress";
import { ensureOffer } from "../store/offers";
import { useWallet } from "../store/wallet";
import { useCosmetics } from "../store/cosmeticsStore";
import { firstAffordableUnowned } from "../store/cosmetics";
import { useAuth } from "../store/auth";
import { recordLessonFinished } from "../store/registerWall";
import { recordJourneySession, loadJourney, stageFromGoals, STAGE_GOAL } from "../store/journey";
import { consumeGuestExercise } from "../store/guestLimit";
import { localDate } from "../store/streak";
import RegisterWall from "../components/ui/RegisterWall";

const SESSION_LEN = 10;

export default function PracticeScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress, updateProfile, setSteering } = useProgress();
  const { token } = useAuth();
  // Opt-in pronunciation (voice-direction): dormant unless the build flag + voice consent + the
  // learner's pronunciation pref all hold. Off by default → this never renders today.
  const { granted: voiceGranted } = useVoiceConsent();
  const showPronun = canServePronunciation(voiceFeatureEnabled(), voiceGranted, progress.steering.formatPrefs.pronunciation);
  const { t: tr, lang } = useI18n();
  // Stage 2 Progress Agent: every answer of this session, pushed once at the summary screen.
  const sessionAnswersRef = useRef<SessionAnswer[]>([]);
  const summarySentRef = useRef(false);
  const { result, checking, error: checkError, levelUp, explained, explainLoading, check, doExplain, reset } =
    useExerciseCheck();
  const params = useLocalSearchParams<{ topic?: string }>();
  const routeTopic = typeof params.topic === "string" ? params.topic : undefined;
  // A mid-session topic swerve outranks the route's drilled topic: selectNext lets forcedTopic win
  // unconditionally, so without this override "switch topic" silently never applied in a drilled
  // session. undefined = untouched (follow the route), string = re-drilled onto that topic,
  // null = drill released (the learner muted the drilled topic).
  const [steeredTopic, setSteeredTopic] = useState<string | null | undefined>(undefined);
  const forcedTopic = steeredTopic === undefined ? routeTopic : steeredTopic ?? undefined;
  // Latest progress/topic for selecting/grading without stale closures.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const forcedTopicRef = useRef(forcedTopic);
  forcedTopicRef.current = forcedTopic;
  // Current relocation-journey emphasis (a journey goal id) → biases generated scenarios toward the
  // learner's stage. Loaded once; seeded from goals until a journey is persisted. Ref keeps
  // selectParams sync.
  const journeyGoalRef = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    loadJourney().then((j) => {
      if (!active) return;
      const stage = j?.stage ?? stageFromGoals(progressRef.current.profile?.goals);
      journeyGoalRef.current = STAGE_GOAL[stage];
    });
    return () => {
      active = false;
    };
  }, []);

  // Pre-generation buffer: while the learner solves a card, the next ones are fetched in the
  // background so "Next" is instant. Params are resolved from the freshest learner model per fetch.
  // Recent misses (per device), refreshed on each load; fed back to the generator to target weak
  // points in a fresh sentence (personalized practice). Kept in a ref so selectParams stays sync.
  const mistakesRef = useRef<Mistake[]>([]);
  // "Just now" swerve overlay: tweaks the live queue without persisting (the persisted slice lives in
  // progress.steering). Merged on top of it per fetch so a session nudge layers over the saved one.
  const sessionSteeringRef = useRef<Steering | null>(null);
  const queueRef = useRef<ExerciseQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = createExerciseQueue({
      selectParams: () => {
        const steering = mergeSteering(progressRef.current.steering, sessionSteeringRef.current ?? DEFAULT_STEERING);
        const { topic, cefr, type } = selectNext(progressRef.current, forcedTopicRef.current, steering);
        return {
          topic,
          level: cefr,
          type,
          context: buildContext(progressRef.current.profile, undefined, journeyGoalRef.current),
          mistakes: mistakeHintsForTopic(mistakesRef.current, topic),
        };
      },
    });
  }
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [round, setRound] = useState(0); // bumps to remount ExerciseCard on each new exercise
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [responseDisplay, setResponseDisplay] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gated, setGated] = useState(false); // 403: account not activated / starter limit reached
  const [limited, setLimited] = useState(false); // 403 "daily_limit": free-tier cap → upsell sheet
  const [guestLimited, setGuestLimited] = useState(false); // anon hit today's client-side cap → register wall
  const [solved, setSolved] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [showScroll, setShowScroll] = useState(false); // end-of-session summary + reward scroll
  const [swerveOpen, setSwerveOpen] = useState(false); // learner's "steer the lesson" sheet
  const [ruleOpen, setRuleOpen] = useState(false); // 📖 rule card for the current card's topic
  const { isPremium, coins } = useWallet();
  const { owned: ownedCosmetics } = useCosmetics();
  // XP at session start — the summary shows the delta (combo/boost included automatically).
  const startXpRef = useRef<number | null>(null);
  if (startXpRef.current === null) startXpRef.current = progress.xp;
  const error = loadError ?? checkError;

  const shake = useRef(new Animated.Value(0)).current;

  const loadExercise = useCallback(async (replace = false) => {
    setLoading(true);
    setLoadError(null);
    setGated(false);
    setLimited(false);
    setGuestLimited(false);
    reset();
    setResponse(null);
    setResponseDisplay("");
    setExercise(null);
    // Guests get the same daily allowance as a free account (store/guestLimit.ts). On exhaustion we
    // show the register wall instead of fetching — registering lifts the cap and adds sync. (The
    // server doesn't meter anonymous callers; this is the client-side incentive fix.)
    // `replace` (a swerve swapping the current card) reuses the slot already counted — no re-charge.
    if (!replace && !token && !(await consumeGuestExercise(localDate(new Date())))) {
      setGuestLimited(true);
      setLoading(false);
      return;
    }
    try {
      // Refresh the local miss list so freshly-refilled cards can target the latest weak points.
      mistakesRef.current = await loadMistakes();
      // Pull from the buffer (instant if prefetched); the queue handles adaptive selection and
      // refills itself in the background.
      setExercise(await queueRef.current!.next());
      setRound((r) => r + 1);
    } catch (e) {
      // 403 routes by gate kind: "limit" → limit sheet with the upsell; "gated" → the activation
      // prompt. Never a raw error.
      const gate = gateKind(e);
      if (gate === "limit") {
        setLimited(true);
        // Trigger: first limit hit ever → open the one-shot 48h double-pack offer.
        void ensureOffer("limit48");
      } else if (gate === "gated") setGated(true);
      else setLoadError(e instanceof Error ? e.message : "Failed to load exercise");
    } finally {
      setLoading(false);
    }
  }, [reset, token]);

  useEffect(() => {
    // On mount, or when the ROUTE's drilled topic changes, drop any buffered cards (they may be
    // off-topic) and load fresh. Keyed on routeTopic, not the merged forcedTopic: a swerve-driven
    // change refetches inside applySwerve already — reacting here too would double-fetch and
    // double-charge the guest slot. clear() on an empty queue is a no-op.
    setSteeredTopic(undefined);
    queueRef.current!.clear();
    loadExercise();
  }, [routeTopic, loadExercise]);

  // Apply a swerve from the sheet. "remember" persists to the steering slice (adaptive.ts honors it
  // next time); "just now" layers a session-only overlay. Either way we drop the buffer and, if the
  // learner hasn't answered the current card yet, swap it for one chosen under the new steering.
  const applySwerve = useCallback(
    (action: SwerveAction, scope: SwerveScope) => {
      if (scope === "remember") {
        const next = applySteeringAction(progressRef.current.steering, action);
        // setSteering is async state — but the swap fetch below reads progressRef synchronously,
        // so the fresh steering must land in the ref NOW or the new card is chosen under the OLD
        // rules (the "remember" swerve sometimes visibly not applying). The ref realigns with the
        // store on the next render either way.
        progressRef.current = { ...progressRef.current, steering: next };
        setSteering(next);
      } else {
        sessionSteeringRef.current = applySteeringAction(sessionSteeringRef.current ?? DEFAULT_STEERING, action);
      }
      // Topic gestures also override the route's drilled topic — selectNext lets forcedTopic win,
      // so without this "switch topic" never applies in a drilled session, and muting the drilled
      // topic would keep serving it. Ref first (the swap fetch is synchronous), state second
      // (re-render + header).
      if (action.kind === "pinTopic") {
        forcedTopicRef.current = action.topic;
        setSteeredTopic(action.topic);
      } else if (action.kind === "muteTopic" && action.topic === forcedTopicRef.current) {
        forcedTopicRef.current = undefined;
        setSteeredTopic(null);
      }
      queueRef.current!.clear();
      if (!result) void loadExercise(true); // reuse the already-counted slot — no extra guest charge
    },
    [setSteering, result, loadExercise]
  );

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

  async function onCheck() {
    if (!exercise || response === null || checking) return;
    const res = await check(exercise, response, runShake);
    if (res) {
      setSolved((s) => s + 1);
      if (res.correct) setSessionCorrect((c) => c + 1);
      sessionAnswersRef.current.push({ topic: exercise.topic, correct: res.correct, level: exercise.level });
      trackExerciseAnswered({ topic: exercise.topic, correct: res.correct, level: exercise.level, mode: "practice" });
    }
  }

  // Fire-and-forget memory update (auth required server-side; anonymous callers just 401 → ignored).
  // The agent's "wins" line comes back for the Progress tab; weak-spot memory updates server-side.
  function pushSessionSummary() {
    if (summarySentRef.current || sessionAnswersRef.current.length === 0) return;
    summarySentRef.current = true;
    // North-star instrumentation: a completed practice session is the core retention signal.
    track("session_complete", {
      items: sessionAnswersRef.current.length,
      correct: sessionCorrect,
      mode: "practice",
    });
    postSessionSummary(sessionAnswersRef.current)
      .then((r) => {
        if (r.wins) updateProfile({ wins: r.wins });
      })
      .catch(() => {}); // best-effort: offline / logged out / model down
  }

  function onExplain() {
    if (!exercise) return;
    doExplain(exercise, responseDisplay);
  }

  const canSubmit = response !== null && !checking;
  // The header names what's ACTUALLY on screen: the current card's topic (it can never lie, and it
  // follows a mid-session swerve the moment the new card lands). Before the first card: the drilled
  // topic if any, else the mix title. Lang-aware, same labels the swerve sheet shows.
  const labelFor = (id: string) => (lang === "ru" ? RU_TOPIC_LABELS[id] : TOPIC_LABELS[id]) ?? TOPIC_LABELS[id] ?? id;
  const headerTopic = exercise?.topic ?? forcedTopic;
  const topicLabel = headerTopic ? labelFor(headerTopic) : tr("btn.mix.title");

  // X mid-session: confirm before discarding answered cards and the end-of-session scroll.
  // Free exit before the first answer and once the summary is showing (nothing left to lose).
  function onClose() {
    if (solved === 0 || showScroll) {
      router.back();
      return;
    }
    Alert.alert(tr("exit.title"), tr("exit.msg"), [
      { text: tr("exit.stay"), style: "cancel" },
      { text: tr("exit.leave"), style: "destructive", onPress: () => router.back() },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />

      {/* Header: close, session progress, streak */}
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
          <Icon name="x" size={24} color={t.c.ink2} />
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 14 }}>
          <ProgressBar pct={(Math.min(solved, SESSION_LEN) / SESSION_LEN) * 100} height={10} />
        </View>
        <Txt variant="caption" color={t.c.fire}>
          {`${boostActive(progress) ? "⚡x2 " : ""}🔥 ${progress.dailyStreak}`}
        </Txt>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <Txt variant="label" style={{ flex: 1 }}>
            {topicLabel}
            {exercise ? `  ·  ${levelToCefr(effectiveSkill(progress, exercise.topic))}` : ""}
          </Txt>
          {/* 📖 the unit's rule card, one tap away mid-drill (the Presentation step stays reachable) */}
          {exercise && !showScroll && RULE_CARDS[exercise.topic] && (
            <Pressable
              onPress={() => setRuleOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={tr("course.rule")}
              style={({ pressed }) => [
                styles.swerveBtn,
                { borderColor: t.c.line, backgroundColor: t.c.surface2, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Txt variant="caption" color={t.c.ink2}>{`📖 ${tr("course.rule")}`}</Txt>
            </Pressable>
          )}
          {exercise && !showScroll && (
            <Pressable
              onPress={() => setSwerveOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={tr("swerve.open")}
              style={({ pressed }) => [
                styles.swerveBtn,
                { borderColor: t.c.line, backgroundColor: t.c.surface2, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Txt variant="caption" color={t.c.ink2}>{`↪ ${tr("swerve.open")}`}</Txt>
            </Pressable>
          )}
        </View>

        {loading && (
          <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
            <ActivityIndicator color={t.c.accent} />
            <Txt variant="secondary" color={t.c.ink2}>{loadingMessageFor(round)}</Txt>
          </View>
        )}

        {limited && !loading && (
          <View style={{ marginTop: 20 }}>
            <LimitSheet belt={beltProgress(progress).belt} onUnlocked={() => loadExercise()} />
          </View>
        )}

        {guestLimited && !loading && (
          <View style={{ marginTop: 20 }}>
            <RegisterWall
              reason="limit"
              onCreate={() => router.push("/login")}
              onDismiss={() => router.back()}
            />
          </View>
        )}

        {gated && !loading && (
          <View style={{ marginTop: 20, gap: 12 }}>
            <ActivationBanner />
            <Txt variant="secondary" color={t.c.ink3} style={{ textAlign: "center" }}>
              {tr("activate.lockedMsg")}
            </Txt>
            <Button label={tr("action.tryAgain")} variant="ghost" onPress={() => loadExercise()} />
          </View>
        )}

        {error && !gated && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            {/* Human words first (a raw provider line like "OpenRouter refused this request (PII
                detected)" means nothing to a learner); the technical cause stays visible below,
                small and dim — it's the only clue we get back in a bug-report screenshot. */}
            <Txt variant="bodyStrong" style={{ textAlign: "center" }}>
              {tr("err.exercise.title")}
            </Txt>
            <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
              {tr("err.exercise.hint")}
            </Txt>
            <Txt variant="caption" color={t.c.ink3} style={{ textAlign: "center" }}>
              {error}
            </Txt>
            <Button label={tr("action.tryAgain")} variant="ghost" onPress={() => loadExercise()} />
          </View>
        )}

        {showScroll && (
          <View style={{ marginTop: 20, gap: 14 }}>
            {/* Session summary — the peak-end beat: stats, then the scroll, then the pitch. */}
            <Card>
              <View style={{ alignItems: "center", gap: 6, paddingVertical: 4 }}>
                <Txt variant="bodyStrong">{tr("summary.title")}</Txt>
                <Txt variant="body" color={t.c.ink2}>
                  {tr("summary.stats", { correct: sessionCorrect, total: solved })}
                </Txt>
                <Txt variant="bodyStrong" color={t.c.gold}>
                  {tr("summary.xp", { n: progress.xp - (startXpRef.current ?? progress.xp) })}
                </Txt>
              </View>
            </Card>
            <Scroll onDone={() => router.back()} />
            {(() => {
              // Peak-end pitch: at the emotional high, surface a reachable cosmetic reward.
              const pick = firstAffordableUnowned(coins, ownedCosmetics);
              if (!pick) return null;
              const name = lang === "ru" ? pick.name.ru : pick.name.en;
              return (
                <Card>
                  <Txt variant="secondary" color={t.c.ink2} style={{ textAlign: "center", marginBottom: 8 }}>
                    {tr("ward.pitch", { name })}
                  </Txt>
                  <Button label={tr("ward.open")} variant="ghost" onPress={() => router.push("/wardrobe")} />
                </Card>
              );
            })()}
            {!isPremium && (
              <Button label={tr("limit.premium")} variant="ghost" onPress={() => router.push("/premium")} />
            )}
          </View>
        )}

        {exercise && !loading && !showScroll && (
          <Animated.View style={{ transform: [{ translateX: shake }], gap: t.spacing.gap }}>
            <ExerciseCard key={round} exercise={exercise} locked={!!result} onChange={onChange} />
          </Animated.View>
        )}

        {showPronun && exercise && !loading && !showScroll && (
          <PronunciationCard target={exercise.text} lang={lang} />
        )}

        {/* Mastery-gate moment: the evidence meter for this unit is full — the checkpoint (зачёт)
            is open. Persistent nudge on every result until the quiz is passed. */}
        {(() => {
          if (!exercise || !result || showScroll) return null;
          const mastered = (progress.course?.mastered ?? []).includes(exercise.topic);
          if (mastered || !RULE_CARDS[exercise.topic]) return null;
          if (!masteryOf(progress.course?.history[exercise.topic]).met) return null;
          return (
            <Card>
              <View style={{ alignItems: "center", gap: 6, paddingVertical: 6 }}>
                <Txt variant="bodyStrong" color={t.c.gold}>{`⭐ ${tr("course.ready")}`}</Txt>
                <Txt variant="secondary" color={t.c.ink2} style={{ textAlign: "center" }}>
                  {tr("course.readySub")}
                </Txt>
                <Button
                  label={tr("course.takeCheckpoint")}
                  onPress={() => router.push({ pathname: "/checkpoint", params: { topic: exercise.topic } })}
                />
              </View>
            </Card>
          );
        })()}

        {result && exercise && !showScroll && (
          <ResultPanel
            result={result}
            exercise={exercise}
            levelUp={levelUp}
            explained={explained}
            explainLoading={explainLoading}
            onExplain={onExplain}
          />
        )}
      </ScrollView>

      {exercise && (
        <SwerveSheet
          visible={swerveOpen}
          topic={exercise.topic}
          format={exercise.type}
          onApply={applySwerve}
          onClose={() => setSwerveOpen(false)}
        />
      )}

      {/* Rule reference (📖): no train CTA — the learner is already training. */}
      {exercise && <RuleSheet topic={exercise.topic} visible={ruleOpen} onClose={() => setRuleOpen(false)} />}

      {result?.correct && <Confetti />}

      {/* Sticky bottom action */}
      {exercise && !loading && !showScroll && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          {result ? (
            // Session complete → the reward scroll is the closing beat; otherwise next card.
            solved >= SESSION_LEN ? (
              <Button
                label={tr("action.finish")}
                onPress={() => {
                  pushSessionSummary();
                  // Anon-first funnel: count finished lessons so Home can surface the soft
                  // save-progress wall after a few. No-op effect for signed-in users.
                  if (!token) void recordLessonFinished();
                  // Relocation journey: count a finished session so we can nudge to the next stage.
                  void recordJourneySession(progressRef.current.profile?.goals);
                  setShowScroll(true);
                }}
              />
            ) : (
              <Button label={tr("action.next")} onPress={() => loadExercise()} />
            )
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
  swerveBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
});
