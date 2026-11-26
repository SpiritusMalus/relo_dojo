// Listening cards (аудирование в ежедневке): listen-and-answer (hear a passage → tap the fact) and
// listen-and-retell (hear a passage → retell it in your own words; LLM-graded on content coverage).
// The passage lives in `exercise.speak`. A listening answer can be submitted only after
// playback completed. If speech is unavailable the learner can retry or skip.
//
// The retell can also be SPOKEN: a mic button records the learner, /voice/transcribe turns it into
// text, and the transcript lands in the same editable input → the same /check-retell grader. The mic
// is DOUBLE-GATED like every capture surface (EXPO_PUBLIC_VOICE_ENABLED build flag + the separate
// voice consent, services/voice.ts) and dormant while the legal gate is closed — the card stays a
// typed retell. expo-av loads lazily on first use, so the dormant modality adds nothing to the graph.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, TextInput, View } from "react-native";
import * as Speech from "expo-speech";
import type { ExerciseProps } from "./types";
import MultipleChoice from "./MultipleChoice";
import { transcribeAudio } from "../services/api";
import { canUseVoice, voiceFeatureEnabled } from "../services/voice";
import type { RecordingHandle } from "../services/voiceCapture";
import { useVoiceConsent } from "../store/voiceConsent";
import { useI18n } from "../store/i18n";
import { exerciseCopy } from "../i18n/exerciseCopy";
import { useTheme } from "../theme/theme";
import Button from "./ui/Button";
import Card from "./ui/Card";
import DataGuard from "./ui/DataGuard";
import Txt from "./ui/Txt";
import VoiceConsentSheet from "./ui/VoiceConsentSheet";

// Once-per-session gate for the at-a-glance voice cross-border reminder (shown before first capture
// on this surface — mirrors PronunciationCard's own flag).
let retellGuardShownThisSession = false;

// Lazy capture module: expo-av joins the module graph only when the mic is actually tapped, so the
// dormant modality (flag off) costs nothing at startup and stays out of non-voice jest suites.
function loadCapture(): typeof import("../services/voiceCapture") {
  return require("../services/voiceCapture");
}

type VoicePhase = "idle" | "recording" | "transcribing" | "error";
type AudioPhase = "playing" | "ready" | "unavailable";
const RETELL_MAX = 2000;

function stopSpeech() {
  void Promise.resolve().then(() => Speech.stop()).catch(() => {});
}

export default function Listen({ exercise, locked, onChange, onSkip, feedback }: ExerciseProps) {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const copy = exerciseCopy(lang);
  const { granted, accept } = useVoiceConsent();
  const [audio, setAudio] = useState<AudioPhase>("playing");
  const [heard, setHeard] = useState(false);
  const speechGeneration = useRef(0);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retell, setRetell] = useState("");
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [askConsent, setAskConsent] = useState(false);
  const [showGuard, setShowGuard] = useState(false);
  const recRef = useRef<RecordingHandle | null>(null);
  const mounted = useRef(false);
  const startingRecording = useRef(false);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const voiceFlag = voiceFeatureEnabled();

  const play = useCallback(() => {
    const passage = exercise.speak?.trim();
    const generation = ++speechGeneration.current;
    if (speechTimer.current) clearTimeout(speechTimer.current);
    if (!passage) {
      setAudio("unavailable");
      return;
    }
    let settled = false;
    const settle = (state: AudioPhase) => {
      if (settled || generation !== speechGeneration.current) return;
      settled = true;
      if (speechTimer.current) clearTimeout(speechTimer.current);
      speechTimer.current = null;
      if (state === "ready") setHeard(true);
      setAudio(state);
    };
    setAudio("playing");
    speechTimer.current = setTimeout(() => {
      settle("unavailable");
      stopSpeech();
    }, Math.min(60_000, 15_000 + passage.split(/\s+/).length * 700));
    void (async () => {
      try {
        await Speech.stop();
        if (settled || generation !== speechGeneration.current) return;
        Speech.speak(passage, {
          language: "en-US",
          rate: 0.95,
          onDone: () => settle("ready"),
          onError: () => settle("unavailable"),
          onStopped: () => settle("unavailable"),
        });
      } catch {
        settle("unavailable");
      }
    })();
  }, [exercise.speak]);

  // Auto-play once when the card lands (replayable via the button); stop any in-flight speech when
  // the card unmounts so audio can't bleed into the next exercise.
  useEffect(() => {
    setHeard(false);
    play();
    return () => {
      speechGeneration.current++;
      if (speechTimer.current) clearTimeout(speechTimer.current);
      stopSpeech();
    };
  }, [play]);

  // Release the mic if the card unmounts mid-recording (the next card must be able to record).
  useEffect(
    () => {
      mounted.current = true;
      return () => {
        mounted.current = false;
        const rec = recRef.current;
        recRef.current = null;
        if (rec) void loadCapture().stopRecording(rec).catch(() => {});
      };
    },
    []
  );

  function changeRetell(text: string) {
    if (lockedRef.current || !heard) return;
    const capped = text.slice(0, RETELL_MAX);
    setRetell(capped);
    const trimmed = capped.trim();
    onChange(trimmed ? trimmed : null, trimmed);
  }

  // Mic tap #1: pass the gate (flag + consent; missing consent → the specific voice consent sheet),
  // then start capturing. expo-av enters the module graph only here — the dormant path never loads it.
  async function beginRecord() {
    if (!voiceFlag || locked || !heard || audio === "playing" || startingRecording.current || recRef.current) return;
    if (!granted) {
      setAskConsent(true);
      return;
    }
    if (!retellGuardShownThisSession) {
      retellGuardShownThisSession = true;
      setShowGuard(true);
    }
    startingRecording.current = true;
    try {
      const cap = loadCapture();
      if (!(await cap.requestMicPermission()) || !mounted.current || lockedRef.current) return;
      const rec = await cap.startRecording();
      if (!mounted.current || lockedRef.current) {
        await cap.stopRecording(rec);
        return;
      }
      recRef.current = rec;
      setVoicePhase("recording");
    } catch {
      if (mounted.current) setVoicePhase("error");
    } finally {
      startingRecording.current = false;
    }
  }

  // Mic tap #2: stop → transcribe → merge into the editable retell (appending, so the learner can
  // record in takes and still fix any word by keyboard before checking — same grader either way).
  async function finishRecord() {
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    setVoicePhase("transcribing");
    try {
      const cap = loadCapture();
      const { uri } = await cap.stopRecording(rec);
      const audio = await cap.uriToBase64(uri);
      // The retelling is spoken in English (same contract as the typed path) — hint STT accordingly.
      const { transcript } = await transcribeAudio(audio, "audio/m4a", "en");
      if (!mounted.current) return;
      const said = transcript.trim();
      const base = retell.trim();
      if (said) changeRetell(base ? `${base} ${said}` : said);
      setVoicePhase("idle");
    } catch {
      if (mounted.current) setVoicePhase("error");
    }
  }

  return (
    <View style={styles.wrap}>
      <Card style={{ backgroundColor: t.c.surface2, alignItems: "center", gap: 8 }}>
        <Txt variant="secondary" color={t.c.ink3}>{tr("lt.listenHint")}</Txt>
        <Button
          label={audio === "playing" ? copy.listening : audio === "unavailable" ? tr("action.tryAgain") : copy.audioAgain}
          variant="ghost"
          onPress={play}
          disabled={audio === "playing" || voicePhase === "recording" || voicePhase === "transcribing"}
          left={audio === "playing" ? <ActivityIndicator color={t.c.accent} /> : undefined}
        />
        {audio === "unavailable" ? (
          <View style={{ gap: 8, alignSelf: "stretch" }}>
            <Txt variant="secondary" color={t.c.ink2}>{copy.audioFailed}</Txt>
            {!locked && !heard && onSkip && <Button label={copy.skipAudio} variant="ghost" onPress={onSkip} />}
          </View>
        ) : !heard && <Txt variant="secondary" color={t.c.ink2}>{copy.listenFirst}</Txt>}
      </Card>

      {exercise.type === "listen-and-retell" ? (
        <View style={styles.wrap}>
          <Txt variant="cardTitle" style={{ fontSize: 19, lineHeight: 26 }}>
            {tr("ex.retellPrompt")}
          </Txt>
          <TextInput
            value={retell}
            onChangeText={changeRetell}
            placeholder={tr("ex.retellPlaceholder")}
            placeholderTextColor={t.c.ink3}
            editable={!locked && heard}
            maxLength={RETELL_MAX}
            multiline
            textAlignVertical="top"
            accessibilityLabel={tr("ex.retellPrompt")}
            style={[styles.input, { color: t.c.ink, backgroundColor: t.c.surface, borderColor: t.c.line2 }]}
          />
          {/* Voice retell: dormant unless the build flag is on; consent is asked on first tap. */}
          {canUseVoice(voiceFlag, true) && !locked && heard && (
            <View style={{ gap: 6 }}>
              {showGuard && (
                <Txt variant="caption" color={t.c.ink3}>{tr("voice.guard")}</Txt>
              )}
              {voicePhase === "transcribing" ? (
                <View style={styles.voiceRow}>
                  <ActivityIndicator color={t.c.accent} />
                  <Txt variant="secondary" color={t.c.ink2}>{tr("voice.transcribing")}</Txt>
                </View>
              ) : (
                <Button
                  label={tr(voicePhase === "recording" ? "voice.recording" : "ex.retellSpeak")}
                  variant="ghost"
                  onPress={voicePhase === "recording" ? finishRecord : beginRecord}
                />
              )}
              {voicePhase === "error" && (
                <Txt variant="caption" color={t.c.bad}>{tr("voice.sttFailed")}</Txt>
              )}
            </View>
          )}
          <DataGuard />
          <VoiceConsentSheet
            visible={askConsent}
            onAccept={() => {
              setAskConsent(false);
              void accept();
            }}
            onDecline={() => setAskConsent(false)}
          />
        </View>
      ) : (
        // listen-and-answer: the question + options are a plain multiple-choice interaction.
        <MultipleChoice exercise={exercise} locked={locked || !heard} onChange={onChange} feedback={feedback} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
  voiceRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 10 },
});
