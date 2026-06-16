// "Review my text" (Praktika adoption Stage 3 — our differentiator).
//
// The learner pastes a REAL text of their own (an email, a message, a post) and gets a graded
// breakdown: each issue quoted, rephrased correctly, tied to a grammar topic, with a short note in
// the UI language. Server-side the findings also update the learner profile's weak-spot memory, so
// future feedback remembers what tripped them here. Open to everyone (anonymous included); findings
// are only persisted to the learner profile when signed in.
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { reviewText, type ReviewResult } from "../services/api";
import { trackReviewSubmitted } from "../services/analytics";
import { useI18n } from "../store/i18n";
import { loadingMessageFor } from "../i18n/loading";
import { RU_TOPIC_LABELS } from "../i18n/strings";
import { TOPIC_LABELS } from "../store/onboarding";
import { useTheme } from "../theme/theme";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Icon from "../components/ui/Icon";
import Sensei from "../components/ui/Sensei";
import Txt from "../components/ui/Txt";

const MAX_LEN = 2000; // mirrors the backend's MAX_TEXT (422 beyond it)

export default function TextReviewScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t: tr, lang } = useI18n();

  const [text, setText] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topicLabel = (topic: string) =>
    lang === "ru" ? RU_TOPIC_LABELS[topic] ?? topic : TOPIC_LABELS[topic] ?? topic;

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await reviewText(trimmed);
      setResult(r);
      trackReviewSubmitted({ chars: trimmed.length, issues: r.issues?.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to review the text");
    } finally {
      setLoading(false);
    }
  }, [text, loading]);

  const restart = () => {
    setResult(null);
    setText("");
    setError(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top + 8 }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <Icon name="back" size={24} color={t.c.ink2} />
        </Pressable>
        <Txt variant="screenTitle">{tr("trev.title")}</Txt>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: t.spacing.pad, paddingBottom: insets.bottom + 24, gap: t.spacing.gap }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!result && (
          <Card>
            <View style={{ alignItems: "center", marginBottom: 10 }}>
              <Sensei size={72} mood="happy" />
            </View>
            <Txt variant="body" color={t.c.ink2} style={{ marginBottom: 10, textAlign: "center" }}>
              {tr("trev.intro")}
            </Txt>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={tr("trev.placeholder")}
              placeholderTextColor={t.c.ink3}
              multiline
              maxLength={MAX_LEN}
              style={{
                borderWidth: 1,
                borderColor: t.c.line2,
                borderRadius: t.spacing.radiusSm,
                padding: 12,
                minHeight: 140,
                textAlignVertical: "top",
                color: t.c.ink,
                marginBottom: 10,
              }}
            />
            {!!error && (
              <Txt variant="secondary" color={t.c.bad} style={{ marginBottom: 8 }}>
                {error}
              </Txt>
            )}
            {loading ? (
              <View style={{ alignItems: "center", gap: 8, paddingVertical: 8 }}>
                <ActivityIndicator color={t.c.accent} />
                <Txt variant="secondary" color={t.c.ink3}>
                  {loadingMessageFor(0)}
                </Txt>
              </View>
            ) : (
              <Button label={tr("trev.submit")} onPress={submit} disabled={!text.trim()} />
            )}
          </Card>
        )}

        {result && (
          <>
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Sensei size={56} mood={result.issues.length === 0 ? "cheer" : "happy"} />
                <Txt variant="body" style={{ flex: 1 }}>
                  {result.summary}
                </Txt>
              </View>
            </Card>

            {result.issues.length === 0 && (
              <Card>
                <Txt variant="bodyStrong" style={{ textAlign: "center" }}>
                  {tr("trev.clean")}
                </Txt>
              </Card>
            )}

            {result.issues.map((issue, i) => (
              <Card key={i}>
                <Txt variant="caption" color={t.c.ink3} style={{ marginBottom: 6 }}>
                  {topicLabel(issue.topic)}
                </Txt>
                <Txt variant="body" color={t.c.bad} style={{ textDecorationLine: "line-through", marginBottom: 4 }}>
                  {issue.quote}
                </Txt>
                <Txt variant="bodyStrong" color={t.c.accent} style={{ marginBottom: 6 }}>
                  {issue.better}
                </Txt>
                {!!issue.note && (
                  <Txt variant="secondary" color={t.c.ink2}>
                    {issue.note}
                  </Txt>
                )}
              </Card>
            ))}

            <Button label={tr("trev.again")} onPress={restart} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 44 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
