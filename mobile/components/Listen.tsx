// Listening cards (аудирование в ежедневке): listen-and-answer (hear a passage → tap the fact) and
// listen-and-retell (hear a passage → retell it in your own words; LLM-graded on content coverage).
// The passage lives in `exercise.speak` and is READ ALOUD via on-device TTS, never shown — except
// as a graceful degrade: on a client built before expo-speech was added the native call throws, and
// a listening card with no audio is unsolvable, so we reveal the transcript (it becomes a reading
// card rather than a dead one).
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

export default function Listen({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { granted, accept } = useVoiceConsent();
  const [revealed, setRevealed] = useState(false); // TTS unavailable → transcript shown instead
  const [retell, setRetell] = useState("");
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [askConsent, setAskConsent] = useState(false);
  const [showGuard, setShowGuard] = useState(false);
  const recRef = useRef<RecordingHandle | null>(null);
  const voiceFlag = voiceFeatureEnabled();

  const play = useCallback(() => {
    if (!exercise.speak) return;
    try {
      Speech.stop();
      Speech.speak(exercise.speak, { language: "en-US", rate: 0.95 });
    } catch {
      setRevealed(true); // un-rebuilt client: no audio module — degrade to a visible transcript
    }
  }, [exercise.speak]);

  // Auto-play once when the card lands (replayable via the button); stop any in-flight speech when
  // the card unmounts so audio can't bleed into the next exercise.
  useEffect(() => {
    play();
    return () => {
      try {
        Speech.stop();
      } catch {
        // noop — nothing to stop on clients without the module
      }
    };
  }, [play]);

  // Release the mic if the card unmounts mid-recording (the next card must be able to record).
  useEffect(
    () => () => {
      const rec = recRef.current;
      recRef.current = null;
      if (rec) void loadCapture().stopRecording(rec).catch(() => {});
    },
    []
  );

  function changeRetell(text: string) {
    setRetell(text);
    const trimmed = text.trim();
    onChange(trimmed ? trimmed : null, trimmed);
  }

  // Mic tap #1: pass the gate (flag + consent; missing consent → the specific voice consent sheet),
  // then start capturing. expo-av enters the module graph only here — the dormant path never loads it.
  async function beginRecord() {
    if (!voiceFlag) return;
    if (!granted) {
      setAskConsent(true);
      return;
    }
    if (!retellGuardShownThisSession) {
      retellGuardShownThisSession = true;
      setShowGuard(true);
    }
    try {
      const cap = loadCapture();
      if (!(await cap.requestMicPermission())) return;
      recRef.current = await cap.startRecording();
      setVoicePhase("recording");
    } catch {
      setVoicePhase("error");
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
      const said = transcript.trim();
      const base = retell.trim();
      if (said) changeRetell(base ? `${base} ${said}` : said);
      setVoicePhase("idle");
    } catch {
      setVoicePhase("error");
    }
  }

  return (
    <View style={styles.wrap}>
      <Card style={{ backgroundColor: t.c.surface2, alignItems: "center", gap: 8 }}>
        <Txt variant="secondary" color={t.c.ink3}>{tr("lt.listenHint")}</Txt>
        <Button label={tr("lt.playAudio")} variant="ghost" onPress={play} />
        {revealed && !!exercise.speak && (
          <View style={{ gap: 4, alignSelf: "stretch" }}>
            <Txt variant="caption" color={t.c.ink3}>{tr("ex.transcriptShown")}</Txt>
            <Txt variant="body" color={t.c.ink}>{exercise.speak}</Txt>
          </View>
        )}
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
            editable={!locked}
            multiline
            textAlignVertical="top"
            accessibilityLabel={tr("ex.retellPrompt")}
            style={[styles.input, { color: t.c.ink, backgroundColor: t.c.surface, borderColor: t.c.line2 }]}
          />
          {/* Voice retell: dormant unless the build flag is on; consent is asked on first tap. */}
          {canUseVoice(voiceFlag, true) && !locked && (
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
        <MultipleChoice exercise={exercise} locked={locked} onChange={onChange} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
  voiceRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 10 },
});
