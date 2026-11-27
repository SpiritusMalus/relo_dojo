import { useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import Screen from "../components/ui/Screen";
import Txt from "../components/ui/Txt";
import { conversationEnabled } from "../services/conversation";
import { useAuth } from "../store/auth";
import { useI18n } from "../store/i18n";
import { useLiveConversation } from "../store/useLiveConversation";
import { useTheme } from "../theme/theme";

const ru = {
  title: "Голосовая практика",
  intro: "Говори по-английски. После паузы наставник ответит голосом и покажет ошибки с объяснениями по-русски.",
  prompt: "Tell me what you did yesterday.",
  notice: "При запуске твой голос передаётся сервисам распознавания и озвучки через сервер Relo Dojo. Запись разговора в приложении не сохраняется.",
  start: "Разрешить и начать",
  restart: "Начать разговор",
  end: "Завершить",
  cancel: "Отменить запуск",
  pauseReply: "Прервать и говорить",
  close: "Закрыть разговор",
  login: "Войти",
  loginHint: "Войди в аккаунт, чтобы открыть голосовую практику.",
  unavailable: "Голосовая практика пока недоступна в этой сборке.",
  idle: "Готов к разговору",
  permission: "Проверяем доступ к микрофону…",
  connecting: "Подключаемся…",
  preparing: "Включаем микрофон…",
  listening: "Слушаю. Говори по-английски",
  capturing: "Слышу тебя…",
  thinking: "Проверяю фразу…",
  speaking: "Наставник отвечает",
  interrupting: "Останавливаем ответ…",
  ended: "Разговор завершён",
  error: "Разговор остановился",
  errors: "Что поправить",
  correct: "Фраза целиком",
  original: "Как распозналась фраза",
  clean: "Грамматических ошибок не заметил.",
  answer: "Ответ наставника",
  retry: "Попробовать ещё раз",
  networkError: "Не удалось продолжить разговор. Проверь связь и попробуй снова.",
  offline: "Нет интернета. Восстанови связь и начни разговор снова.",
  microphone: "Разреши доступ к микрофону для Relo Dojo в настройках Android.",
  playback: "Не получилось воспроизвести ответ. Начни новый разговор.",
  consent: "Проверь, что в аккаунте принято согласие на обработку данных.",
  startupTimeout: "Не успели запустить разговор. Можно попробовать ещё раз.",
  permissionTimeout: "Подтверди доступ к микрофону и попробуй ещё раз.",
  busy: "Сейчас все голосовые места заняты. Попробуй через несколько секунд.",
  anotherSession: "Другой разговор ещё открыт. Закрой его или подожди несколько секунд.",
  signedOut: "Вход в аккаунт истёк. Войди снова через настройки приложения.",
  limit: "Достигнут лимит голосовой практики. Попробуй позже.",
  connectionLimit: "Слишком много попыток подключения. Подожди немного.",
  sessionLimit: "Этот разговор закончился. Можно начать новый.",
  idleLimit: "Разговор завершился после паузы. Можно начать снова.",
  retryAfter: "Повторить через",
};

const en: typeof ru = {
  title: "Voice practice",
  intro: "Speak English. After a pause, your tutor replies aloud and shows corrections with short explanations in Russian.",
  prompt: "Tell me what you did yesterday.",
  notice: "Starting sends your voice to speech providers through the Relo Dojo server. The app does not save a recording of the conversation.",
  start: "Allow and start",
  restart: "Start a conversation",
  end: "End conversation",
  cancel: "Cancel start",
  pauseReply: "Interrupt and speak",
  close: "Close conversation",
  login: "Sign in",
  loginHint: "Sign in to use voice practice.",
  unavailable: "Voice practice is unavailable in this build.",
  idle: "Ready to talk",
  permission: "Checking microphone permission…",
  connecting: "Connecting…",
  preparing: "Starting the microphone…",
  listening: "Listening. Speak English",
  capturing: "I can hear you…",
  thinking: "Checking your sentence…",
  speaking: "Your tutor is replying",
  interrupting: "Stopping the reply…",
  ended: "Conversation ended",
  error: "Conversation stopped",
  errors: "What to correct",
  correct: "Full sentence",
  original: "Heard sentence",
  clean: "I didn't notice any grammar mistakes.",
  answer: "Tutor's reply",
  retry: "Try again",
  networkError: "The conversation stopped. Check your connection and try again.",
  offline: "You're offline. Reconnect and start the conversation again.",
  microphone: "Allow microphone access for Relo Dojo in Android settings.",
  playback: "The reply couldn't play. Start a new conversation.",
  consent: "Check that your account has accepted the data-processing consent.",
  startupTimeout: "The conversation couldn't start in time. You can try again.",
  permissionTimeout: "Allow microphone access and try again.",
  busy: "Voice practice is busy. Try again in a few seconds.",
  anotherSession: "Another conversation is still open. Close it or wait a few seconds.",
  signedOut: "Your sign-in expired. Sign in again from app settings.",
  limit: "Voice practice limit reached. Try again later.",
  connectionLimit: "Too many connection attempts. Wait a moment.",
  sessionLimit: "This conversation ended. You can start a new one.",
  idleLimit: "The conversation ended after a pause. You can start again.",
  retryAfter: "Try again in",
};

function errorText(copy: typeof ru, code: string) {
  switch (code) {
    case "microphone": return copy.microphone;
    case "offline": return copy.offline;
    case "playback": return copy.playback;
    case "consent":
    case "consent_required": return copy.consent;
    case "auth_required": return copy.signedOut;
    case "startup_timeout": return copy.startupTimeout;
    case "permission_timeout": return copy.permissionTimeout;
    case "voice_busy": return copy.busy;
    case "voice_already_active": return copy.anotherSession;
    case "connection_rate_limit": return copy.connectionLimit;
    case "session_limit": return copy.sessionLimit;
    case "idle_timeout": return copy.idleLimit;
    case "turn_rate_limit":
    case "turn_limit":
    case "rate_limit": return copy.limit;
    default: return copy.networkError;
  }
}

export default function ConversationScreen() {
  const router = useRouter();
  const t = useTheme();
  const { lang } = useI18n();
  const { token } = useAuth();
  const copy = lang === "ru" ? ru : en;
  const enabled = conversationEnabled();
  const voice = useLiveConversation(enabled ? token : null);
  const transcript = useRef<ScrollView>(null);
  const active = !["idle", "ended", "error"].includes(voice.phase);
  const canInterrupt = voice.phase === "speaking" || voice.phase === "thinking";
  const starting = voice.phase === "permission" || voice.phase === "connecting" || voice.phase === "preparing";
  const wait = voice.retrySeconds;
  const waitTime = `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}`;
  const startLabel = wait > 0 ? `${copy.retryAfter} ${waitTime}`
    : voice.phase === "idle" ? copy.start : voice.phase === "error" ? copy.retry : copy.restart;

  const close = () => {
    if (active) voice.stop();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const card = {
    backgroundColor: t.c.surface,
    borderRadius: t.spacing.radius,
    borderWidth: 1,
    borderColor: t.c.line,
  };

  return (
    <Screen scroll={false} contentStyle={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={copy.close} hitSlop={8} onPress={close} style={styles.close}>
          <Icon name="x" color={t.c.ink2} />
        </Pressable>
        <Txt variant="screenTitle" style={styles.title}>{copy.title}</Txt>
      </View>

      {!enabled || !token ? (
        <View style={styles.empty}>
          <Txt variant="body" color={t.c.ink2}>{enabled ? copy.loginHint : copy.unavailable}</Txt>
          {enabled && <Button label={copy.login} onPress={() => router.push("/login")} />}
        </View>
      ) : (
        <>
          <View style={[styles.status, { borderColor: t.c.line }]}>
            {starting || voice.phase === "thinking" || voice.phase === "interrupting"
              ? <ActivityIndicator color={t.c.accent} size="small" />
              : <Icon name="sound" color={active ? t.c.accent : t.c.ink2} size={21} />}
            <Txt accessibilityLiveRegion="polite" variant="bodyStrong" color={active ? t.c.accent : t.c.ink}>
              {copy[voice.phase]}
            </Txt>
          </View>
          <ScrollView
            ref={transcript}
            style={styles.transcript}
            contentContainerStyle={styles.transcriptContent}
            onContentSizeChange={() => {
              if (voice.turns.length > 1) transcript.current?.scrollToEnd({ animated: false });
            }}
            showsVerticalScrollIndicator
          >
            {voice.turns.length === 0 && (
              <View style={styles.empty}>
                <Txt variant="body" color={t.c.ink2}>{copy.intro}</Txt>
                <View style={[styles.card, card]}>
                  <Txt variant="bodyStrong">{copy.prompt}</Txt>
                </View>
              </View>
            )}
            {voice.turns.map((turn) => (
              <View key={turn.id} style={[styles.card, card]}>
                <Txt variant="label" color={t.c.ink2}>{copy.errors}</Txt>
                {turn.corrections.length > 0 ? turn.corrections.map((correction, index) => (
                  <View key={`${turn.id}-${index}`} style={styles.correction}>
                    <Txt variant="bodyStrong">
                      <Txt variant="bodyStrong" color={t.c.fire}>{correction.original}</Txt>
                      {" → "}
                      <Txt variant="bodyStrong" color={t.c.accent}>{correction.replacement}</Txt>
                    </Txt>
                    <Txt variant="secondary" color={t.c.ink2}>{correction.explanation}</Txt>
                  </View>
                )) : <Txt variant="body" color={t.c.ink2}>{copy.clean}</Txt>}
                <View style={[styles.full, { borderTopColor: t.c.line }]}>
                  <Txt variant="caption" color={t.c.ink2}>{copy.correct}</Txt>
                  <Txt variant="bodyStrong">{turn.corrected || turn.transcript}</Txt>
                  {turn.transcript !== turn.corrected && (
                    <Txt variant="caption" color={t.c.ink2}>{copy.original} · {turn.transcript}</Txt>
                  )}
                </View>
                {turn.reply && (
                  <View style={[styles.full, { borderTopColor: t.c.line }]}>
                    <Txt variant="caption" color={t.c.ink2}>{copy.answer}</Txt>
                    <Txt variant="body">{turn.reply}</Txt>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
          <View style={styles.footer}>
            {voice.phase === "error" && <Txt variant="secondary" color={t.c.fire}>{errorText(copy, voice.error)}</Txt>}
            {!active && (
              <Txt variant="caption" color={t.c.ink2}>{copy.notice}</Txt>
            )}
            {canInterrupt && <Button label={copy.pauseReply} onPress={voice.interrupt} />}
            {active
              ? <Button label={starting ? copy.cancel : copy.end} variant="ghost" onPress={voice.stop} />
              : <Button label={startLabel} disabled={wait > 0} onPress={() => { void voice.start(); }} />}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  title: { flexShrink: 1 },
  status: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
  transcript: { flex: 1 },
  transcriptContent: { paddingBottom: 8, gap: 12 },
  empty: { gap: 14, paddingTop: 4 },
  card: { padding: 15, gap: 9 },
  correction: { gap: 3 },
  full: { borderTopWidth: 1, paddingTop: 8, gap: 4 },
  footer: { gap: 9 },
});
