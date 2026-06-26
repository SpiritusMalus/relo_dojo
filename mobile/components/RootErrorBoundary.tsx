// Global crash screen. expo-router renders this (via the `ErrorBoundary` export in app/_layout.tsx)
// whenever a render throws anywhere in the tree. In a release build an uncaught error would otherwise
// leave a blank white screen with no recovery and no signal to us.
//
// HARD RULE: this component must NOT depend on any app provider (Theme / I18n / Auth / SafeArea …) —
// a provider's own failure is exactly when it renders, so it uses the static `light` palette + fonts
// directly and bilingual literal copy (no t()). Keep it dependency-light and never let it throw.
import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import * as analytics from "../services/analytics";
import { fonts, light } from "../theme/theme";

export function RootErrorBoundary({ error, retry }: ErrorBoundaryProps): React.JSX.Element {
  // Report once through the existing /events pipe (buffered, never throws). flush() is best-effort:
  // it no-ops until the app root has wired the sender, then the next successful flush ships it.
  useEffect(() => {
    try {
      analytics.track("app_crash", {
        message: String(error?.message ?? error),
        stack: typeof error?.stack === "string" ? error.stack.slice(0, 2000) : undefined,
        fatal: true,
      });
      void analytics.flush();
    } catch {
      // never let the crash screen itself crash
    }
    // eslint-disable-next-line no-console
    console.error("[RootErrorBoundary] uncaught render error:", error);
  }, [error]);

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.emoji} accessibilityElementsHidden>
          🥋
        </Text>
        <Text style={styles.title}>Что-то пошло не так</Text>
        <Text style={styles.body}>
          Приложение наткнулось на ошибку. Попробуй ещё раз — твой прогресс сохранён.
        </Text>
        <Text style={styles.bodyEn}>Something went wrong. Please try again — your progress is safe.</Text>

        {__DEV__ ? (
          <ScrollView style={styles.devBox} contentContainerStyle={styles.devBoxInner}>
            <Text style={styles.devText}>{String(error?.stack ?? error?.message ?? error)}</Text>
          </ScrollView>
        ) : null}

        <Pressable
          onPress={() => void retry()}
          accessibilityRole="button"
          accessibilityLabel="Попробовать снова"
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        >
          <Text style={styles.btnText}>Попробовать снова</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: light.screen,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
  },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: {
    fontFamily: fonts.brand,
    fontSize: 25,
    lineHeight: 30,
    color: light.ink,
    textAlign: "center",
    marginBottom: 10,
  },
  body: {
    fontFamily: fonts.ui500,
    fontSize: 15,
    lineHeight: 21,
    color: light.ink2,
    textAlign: "center",
  },
  bodyEn: {
    fontFamily: fonts.ui500,
    fontSize: 13,
    lineHeight: 18,
    color: light.ink3,
    textAlign: "center",
    marginTop: 6,
  },
  devBox: {
    maxHeight: 180,
    alignSelf: "stretch",
    marginTop: 16,
    backgroundColor: light.surface2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: light.line,
  },
  devBoxInner: { padding: 12 },
  devText: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16, color: light.bad },
  btn: {
    marginTop: 24,
    minHeight: 44,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: light.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPressed: { backgroundColor: light.accentPress },
  btnText: { fontFamily: fonts.ui700, fontSize: 15, color: light.accentInk },
});
