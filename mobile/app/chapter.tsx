import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CHAPTER_TEXT_LIMIT, ChapterPendingError, createChapterSession, isChapterId, type ChapterId, type ChapterRun, type ChapterSessionState } from "../services/chapters";
import type { ResponseValue } from "../services/api";
import { chapterCopy } from "../i18n/chapterCopy";
import { useAccountScope } from "../store/useAccountScope";
import { isCurrentAccountScope, type AccountScope } from "../store/accountScope";
import { useAuth } from "../store/auth";
import { useI18n } from "../store/i18n";
import { useProgress } from "../store/progress";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { useDojoRoom } from "../store/dojoRoom";
import { dojoItemName } from "../store/dojoRoomCopy";
import { beltProgress } from "../store/dojo";
import { useTheme } from "../theme/theme";
import ExerciseCard from "../components/ExerciseCard";
import ResultPanel from "../components/ResultPanel";
import Button from "../components/ui/Button";
import DojoItemArtwork from "../components/ui/DojoItemArtwork";
import Icon from "../components/ui/Icon";
import ProgressBar from "../components/ui/ProgressBar";
import Sensei from "../components/ui/Sensei";
import Txt from "../components/ui/Txt";

export default function ChapterScreen() {
  const scope = useAccountScope();
  const { lang } = useI18n();
  const params = useLocalSearchParams<{ id?: string }>();
  const chapterId = isChapterId(params.id) ? params.id : null;
  return <ChapterExperience key={`${scope.epoch}:${lang}:${chapterId ?? "unavailable"}`} scope={scope} lang={lang} chapterId={chapterId} />;
}

function ChapterExperience({ scope, lang, chapterId }: { scope: AccountScope; lang: string; chapterId: ChapterId | null }) {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { progress } = useProgress();
  const room = useDojoRoom();
  const copy = chapterCopy(lang);
  const chapter = chapterId ? copy.chapter(chapterId) : null;
  const guest = !token || !scope.owner || scope.owner === "guest";
  const session = useMemo(() => !guest && chapterId ? createChapterSession(scope, chapterId, lang) : null, [scope, guest, chapterId, lang]);
  const presented = useRef(session);
  const active = useRef(true);
  const busyRef = useRef(false);
  const [run, setRun] = useState<ChapterRun | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(!!session);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState(false);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [responseDisplay, setResponseDisplay] = useState("");
  const scroll = useRef<ScrollView>(null);
  const { result, checking, error: checkError, levelUp, explained, explainLoading, check, doExplain, reset, beginAttempt, markHintUsed } = useExerciseCheck();
  const roomRef = useRef(room);
  roomRef.current = room;
  const current = useCallback(() => active.current && presented.current === session && isCurrentAccountScope(scope), [session, scope]);
  const adopt = useCallback((state: ChapterSessionState) => {
    if (!current()) return;
    setRun(state.run); setText(state.draft.text);
    setPending(!!state.draft.pending || !!state.run.pending_submission_id);
    if (state.run.completed) void roomRef.current.refresh();
  }, [current]);
  const load = useCallback(async () => {
    if (!session || !current()) return;
    setLoading(true); setError(null);
    try { adopt(await session.open()); }
    catch {
      if (current()) {
        const draft = session.draftSnapshot();
        setText(draft?.text ?? ""); setPending(!!draft?.pending); setError(copy.offline);
      }
    } finally { if (current()) setLoading(false); }
  }, [session, current, adopt, copy.offline]);
  useEffect(() => {
    active.current = true; presented.current = session;
    setRun(null); setText(""); setPending(false); setError(null); setDraftError(false);
    setResponse(null); setResponseDisplay(""); reset();
    if (session) void load(); else setLoading(false);
    return () => {
      active.current = false; presented.current = null;
      void Promise.resolve().then(() => { if (presented.current !== session) session?.dispose(); });
    };
  }, [session, load, reset]);
  useEffect(() => { if (run?.exercise) beginAttempt(run.exercise); }, [run?.exercise, beginAttempt]);

  async function advance() {
    if (!session || !current() || busyRef.current) return;
    busyRef.current = true; setSaving(true); setError(null);
    try {
      const next = await session.refresh();
      if (!current()) return;
      adopt(next); reset(); setResponse(null); setResponseDisplay("");
      scroll.current?.scrollTo({ y: 0, animated: !t.reduceMotion });
    } catch { if (current()) setError(copy.offline); }
    finally { if (current()) { busyRef.current = false; setSaving(false); } }
  }
  async function checkPreparation() {
    const exercise = run?.exercise;
    if (!exercise || response === null || checking || busyRef.current || !session || !current()) return;
    const before = run!.graded_count;
    const graded = await check(exercise, response);
    if (!current() || graded) return;
    // The grade may have committed before a response was lost. Resume from server evidence;
    // do not fabricate XP or a replacement preparation card.
    try {
      const canonical = await session.refresh();
      if (!current()) return;
      const renewed = canonical.run.exercise?.token !== exercise.token;
      if (canonical.run.graded_count <= before && !renewed) return;
      adopt(canonical); reset(); setResponse(null); setResponseDisplay("");
    } catch { /* The current card keeps its check error and retry action. */ }
  }
  function changeText(value: string) {
    if (!session || !current() || pending || saving) return;
    setText(value); setDraftError(false);
    void session.saveText(value).catch(() => { if (current()) setDraftError(true); });
  }
  async function submitFinal() {
    if (!session || !current() || busyRef.current) return;
    busyRef.current = true; setSaving(true); setError(null); Keyboard.dismiss();
    try {
      if (!pending) await session.saveText(text);
      const outcome = await session.submit();
      if (!current()) return;
      const state = session.snapshot(); if (state) adopt(state);
      if (outcome.dojo) roomRef.current.acceptSnapshot(outcome.dojo, scope);
      if (outcome.run.completed) void roomRef.current.refresh();
      scroll.current?.scrollTo({ y: 0, animated: !t.reduceMotion });
    } catch (problem) {
      if (!current()) return;
      const state = session.snapshot(); if (state) adopt(state);
      setError(problem instanceof ChapterPendingError ? copy.pending : copy.sendFailed);
    } finally { if (current()) { busyRef.current = false; setSaving(false); } }
  }
  async function checkSaved() {
    if (!session || !current() || busyRef.current) return;
    // A local pending request can retry the same id/body after GET. Another device's request
    // can only be observed here; its body must never be reconstructed from a newer draft.
    if (session.draftSnapshot()?.pending) { await submitFinal(); return; }
    busyRef.current = true; setSaving(true); setError(null);
    try { adopt(await session.refresh()); }
    catch { if (current()) setError(copy.offline); }
    finally { if (current()) { busyRef.current = false; setSaving(false); } }
  }
  const completed = !!run?.completed;
  const final = !!run && run.graded_count >= run.preparation_count && !completed;
  const itemId = chapterId ? `dojo_display_${chapterId}` : "";
  const feedback = run?.feedback;
  const displayError = error === copy.pending ? null : error ?? (!result ? checkError : null);

  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.c.screen }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={copy.back}
          style={({ pressed }) => [styles.back, { backgroundColor: pressed ? t.c.surface2 : "transparent" }]}>
          <Icon name="back" color={t.c.ink2} />
        </Pressable>
        <Txt variant="cardTitle" style={{ flex: 1 }}>{chapter?.title ?? copy.title}</Txt>
      </View>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: t.spacing.pad, paddingTop: 16, paddingBottom: insets.bottom + 28, gap: 20 }}>
        {!chapter ? <Txt variant="body">{copy.unavailable}</Txt> : guest ? <View style={{ gap: 18 }}>
          <Txt variant="hero">{chapter.title}</Txt>
          <Txt variant="body" color={t.c.ink2}>{chapter.goal}</Txt>
          <View style={{ alignItems: "center", paddingVertical: 16 }}><DojoItemArtwork itemId={itemId} size={136} /></View>
          <Txt variant="secondary" color={t.c.ink2}>{copy.guest}</Txt>
          <Button label={copy.login} onPress={() => router.push("/login")} />
        </View> : loading ? <View style={styles.loading}>
          <ActivityIndicator color={t.c.accent} />
          <Txt variant="body" color={t.c.ink2}>{copy.loading}</Txt>
        </View> : completed ? <View style={{ gap: 20 }}>
          <View style={{ alignItems: "center", gap: 12 }}>
            <DojoItemArtwork itemId={itemId} size={150} />
            <Txt variant="hero" style={{ textAlign: "center" }}>{copy.done}</Txt>
          </View>
          <Txt variant="cardTitle">{dojoItemName(itemId, lang)}</Txt>
          <Txt variant="body" color={t.c.ink2}>{copy.saved}</Txt>
          <Button label={copy.openDojo} onPress={() => {
            if (current()) router.push({ pathname: "/dojo", params: { reward: itemId, epoch: String(scope.epoch) } });
          }} />
          <Button label={copy.otherChapters} variant="ghost" onPress={() => router.replace("/chapters")} />
        </View> : <>
          {run?.exercise && <>
            <View style={{ gap: 10 }}>
              <Txt variant="secondary" color={t.c.ink2}>{copy.preparation(run.graded_count + 1, run.preparation_count)}</Txt>
              <ProgressBar pct={run.graded_count / (run.preparation_count + 1) * 100} height={6} />
            </View>
            <ExerciseCard key={run.exercise.token ?? String(run.graded_count)} exercise={run.exercise}
              onChange={(value, display) => { setResponse(value); setResponseDisplay(display); }} locked={!!result || checking || saving} onHint={markHintUsed} />
            {result && <ResultPanel result={result} exercise={run.exercise} levelUp={levelUp} explained={explained}
              explainLoading={explainLoading} onExplain={() => { if (current()) void doExplain(run.exercise!, responseDisplay); }} />}
            <Button label={saving ? copy.loading : result ? copy.next : checking ? copy.checking : copy.check}
              disabled={saving || checking || !result && response === null} onPress={() => void (result ? advance() : checkPreparation())} />
          </>}
          {(final || !run && !!text) && <>
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
                <Sensei belt={beltProgress(progress).belt} size={64} mood="happy" />
                <Txt variant="screenTitle" style={{ flex: 1 }}>{final ? copy.finalTask : copy.draft}</Txt>
              </View>
              <Txt variant="body" color={t.c.ink2}>{chapter.final}</Txt>
            </View>
            {!!feedback && !pending && <View style={[styles.feedback, { borderColor: t.c.line }]}>
              <Txt variant="body">{feedback.explanation}</Txt>
              {!!feedback.example && <View style={{ gap: 6 }}>
                <Txt variant="secondary" color={t.c.ink2}>{copy.example}</Txt>
                <Txt variant="body">{feedback.example}</Txt>
              </View>}
            </View>}
            <TextInput accessibilityLabel={copy.finalTask} value={text} onChangeText={changeText} placeholder={chapter.placeholder}
              placeholderTextColor={t.c.ink3} editable={!pending && !saving} multiline maxLength={CHAPTER_TEXT_LIMIT}
              textAlignVertical="top" autoCapitalize="sentences" selectionColor={t.c.accent}
              style={[styles.input, { color: t.c.ink, backgroundColor: t.c.surface, borderColor: t.c.line2, fontFamily: t.fonts.ui500 }]} />
            {draftError && <Txt variant="secondary" color={t.c.bad}>{copy.draftFailed}</Txt>}
            {final && <>
              {pending && <Txt variant="body" color={t.c.ink2}>{copy.pending}</Txt>}
              <Button label={saving ? copy.checking : pending ? copy.checkSaved : copy.check} disabled={saving || !pending && !text.trim()}
                onPress={() => void (pending ? checkSaved() : submitFinal())} />
            </>}
          </>}
          {!!displayError && <Txt variant="body" color={t.c.bad}>{displayError}</Txt>}
          {!run && !loading && <Button label={copy.tryAgain} variant="ghost" onPress={() => void load()} />}
        </>}
      </ScrollView>
    </View>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 48 },
  back: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  loading: { minHeight: 160, justifyContent: "center", alignItems: "center", gap: 16 },
  input: { minHeight: 172, borderWidth: 1, borderRadius: 12, padding: 16, fontSize: 17, lineHeight: 25 },
  feedback: { gap: 12, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 16 },
});
