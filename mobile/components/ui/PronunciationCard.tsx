import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { transcribeAudio } from "../../services/api";
import { useI18n } from "../../store/i18n";
import { useVoiceConsent } from "../../store/voiceConsent";
import { canUseVoice, gradeReadAloud, voiceFeatureEnabled } from "../../services/voice";
import { requestMicPermission, startRecording, stopRecording } from "../../services/voiceCapture";
import { openLiveSession, type LiveSession } from "../../services/geminiLive";
import { useTheme } from "../../theme/theme";
import Button from "./Button";
import Card from "./Card";
import Txt from "./Txt";
import VoiceConsentSheet from "./VoiceConsentSheet";

// Once-per-session gate for the at-a-glance voice cross-border reminder (shown before first capture).
let guardShownThisSession = false;

type Phase = "idle" | "recording" | "checking" | "correct" | "retry";

// Opt-in pronunciation practice (voice direction). Two modes: (a) read-aloud → binary correct/try-
// again, (b) a conversational Gemini Live turn with the sensei. DOUBLE-GATED: nothing captures audio
// unless EXPO_PUBLIC_VOICE_ENABLED && voice consent. A lenient nudge, never a progression gate.
export default function PronunciationCard({ target, lang }: { target: string; lang?: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { granted, accept } = useVoiceConsent();
  const flag = voiceFeatureEnabled();

  const [askConsent, setAskConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [showGuard, setShowGuard] = useState(false);
  const [talking, setTalking] = useState(false);
  const recRef = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const liveRef = useRef<LiveSession | null>(null);

  // Read a captured file URI as base64 (RN globals; no extra native dep).
  const uriToBase64 = useCallback(async (uri: string): Promise<string> => {
    const blob = await (await fetch(uri)).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.readAsDataURL(blob);
    });
  }, []);

  // Guard: never proceed without flag + consent. Missing consent → prompt; flag off → unavailable.
  const ensureGate = useCallback((): boolean => {
    if (!flag) return false;
    if (!granted) {
      setAskConsent(true);
      return false;
    }
    if (!guardShownThisSession) {
      guardShownThisSession = true;
      setShowGuard(true);
    }
    return true;
  }, [flag, granted]);

  const beginRecord = useCallback(async () => {
    if (!ensureGate()) return;
    if (!(await requestMicPermission())) return;
    recRef.current = await startRecording();
    setPhase("recording");
  }, [ensureGate]);

  const finishRecord = useCallback(async () => {
    if (!recRef.current) return;
    setPhase("checking");
    try {
      const { uri } = await stopRecording(recRef.current);
      recRef.current = null;
      const audio = await uriToBase64(uri);
      const { transcript } = await transcribeAudio(audio, "audio/m4a", lang);
      setPhase(gradeReadAloud(target, transcript).correct ? "correct" : "retry");
    } catch {
      setPhase("retry");
    }
  }, [lang, target, uriToBase64]);

  const toggleTalk = useCallback(async () => {
    if (talking) {
      liveRef.current?.close();
      liveRef.current = null;
      setTalking(false);
      return;
    }
    if (!ensureGate()) return;
    try {
      liveRef.current = await openLiveSession({ onClose: () => setTalking(false) });
      setTalking(true);
    } catch {
      setTalking(false);
    }
  }, [talking, ensureGate]);

  // Flag off → render nothing (the modality is dormant). canUseVoice keeps the gate explicit.
  if (!canUseVoice(flag, true)) return null;

  return (
    <Card>
      <Txt variant="label" style={{ marginBottom: 6 }}>{tr("voice.readAloudPrompt")}</Txt>
      <Txt variant="bodyStrong" style={{ marginBottom: 12 }}>{target}</Txt>

      {showGuard && (
        <Txt variant="caption" color={t.c.ink3} style={{ marginBottom: 10 }}>{tr("voice.guard")}</Txt>
      )}

      {phase === "checking" ? (
        <View style={styles.row}><ActivityIndicator color={t.c.accent} /><Txt variant="secondary" color={t.c.ink2}>{tr("voice.checking")}</Txt></View>
      ) : (
        <Pressable
          onPress={phase === "recording" ? finishRecord : beginRecord}
          accessibilityRole="button"
          style={({ pressed }) => [styles.mic, { borderColor: phase === "recording" ? t.c.bad : t.c.accent, opacity: pressed ? 0.7 : 1 }]}
        >
          <Txt variant="bodyStrong" color={phase === "recording" ? t.c.bad : t.c.accent}>
            {tr(phase === "recording" ? "voice.recording" : "voice.record")}
          </Txt>
        </Pressable>
      )}

      {phase === "correct" && <Txt variant="body" color={t.c.accent} style={{ marginTop: 10 }}>{tr("voice.correct")}</Txt>}
      {phase === "retry" && <Txt variant="body" color={t.c.ink2} style={{ marginTop: 10 }}>{tr("voice.tryAgain")}</Txt>}

      <Button
        variant="ghost"
        label={tr(talking ? "voice.endTalk" : "voice.talk")}
        onPress={toggleTalk}
        style={{ marginTop: 12 }}
      />

      <VoiceConsentSheet
        visible={askConsent}
        onAccept={() => {
          setAskConsent(false);
          void accept();
        }}
        onDecline={() => setAskConsent(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  mic: { borderWidth: 2, borderRadius: 16, paddingVertical: 16, alignItems: "center" },
});
