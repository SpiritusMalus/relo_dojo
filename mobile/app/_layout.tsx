import { useEffect } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import { AuthProvider, useAuth } from "../store/auth";
import { ProgressProvider, useProgress } from "../store/progress";
import { WalletProvider } from "../store/wallet";
import { CosmeticsProvider } from "../store/cosmeticsStore";
import { I18nProvider, useI18n } from "../store/i18n";
import { localDate } from "../store/streak";
import { ensurePermission, rescheduleAll } from "../services/notifications";
import { postEvents } from "../services/api";
import * as analytics from "../services/analytics";
import { ThemeProvider, fontMap } from "../theme/theme";

// Stable anonymous id for pre-login retention attribution (persisted across launches).
const ANON_KEY = "gd.analytics.anon";
function newAnonId(): string {
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Redirect between login, onboarding, and the tabs based on auth + onboarding state.
function RootNav() {
  const { ready: authReady, token } = useAuth();
  const { ready: progressReady, synced, progress } = useProgress();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!authReady) return;
    const onLogin = segments[0] === "login";
    const onOnboarding = segments[0] === "onboarding";

    if (!token) {
      if (!onLogin) router.replace("/login");
      return;
    }
    if (onLogin) {
      router.replace("/");
      return;
    }
    // Decide onboarding only once progress is loaded AND the post-login server snapshot has merged
    // in — otherwise an existing account briefly shows onboarding on the reset local default.
    if (!progressReady || !synced) return;
    if (!progress.onboarded && !onOnboarding) {
      router.replace("/onboarding");
    } else if (progress.onboarded && onOnboarding) {
      router.replace("/");
    }
  }, [authReady, token, progressReady, synced, progress.onboarded, segments, router]);

  // Trigger layer: once onboarded, keep the notification plan in sync with today's state.
  // Re-runs when training happens (cancels today's nags) or the streak/language changes.
  const { lang } = useI18n();
  const trainedToday = progress.lastActiveDate === localDate(new Date());
  useEffect(() => {
    if (!authReady || !progressReady || !token || !progress.onboarded) return;
    const timer = setTimeout(() => {
      void (async () => {
        if (!(await ensurePermission())) return;
        await rescheduleAll({
          lang,
          trainedToday,
          dailyStreak: progress.dailyStreak,
          remindHour: progress.profile?.remindHour,
          recap: progress.profile?.diary?.last,
        });
      })();
    }, 2000); // debounce: recordAnswer fires per card; one re-plan per burst is plenty
    return () => clearTimeout(timer);
  }, [authReady, progressReady, token, progress.onboarded, trainedToday, progress.dailyStreak, lang, progress.profile?.remindHour, progress.profile?.diary?.last]);

  // Analytics: wire the buffered tracker once (north-star = Day-7 retention). The bearer token,
  // when present, attributes events to the account server-side; the anon id covers pre-login.
  // Flush when the app leaves the foreground so buffered events aren't lost.
  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    void (async () => {
      let id = await AsyncStorage.getItem(ANON_KEY).catch(() => null);
      if (!id) {
        id = newAnonId();
        AsyncStorage.setItem(ANON_KEY, id).catch(() => {});
      }
      analytics.configure({
        sender: (batch) => postEvents(batch.anon_id, batch.events).then(() => {}),
        anonId: id,
      });
      analytics.track("app_open");
      void analytics.flush();
      sub = AppState.addEventListener("change", (state) => {
        if (state !== "active") void analytics.flush();
      });
    })();
    return () => sub?.remove();
  }, []);

  if (!authReady) return null; // brief splash while we read stored token

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="practice" options={{ headerShown: false }} />
      <Stack.Screen name="story" options={{ headerShown: false }} />
      <Stack.Screen name="challenge" options={{ headerShown: false }} />
      <Stack.Screen name="review" options={{ headerShown: false }} />
      <Stack.Screen name="shop" options={{ headerShown: false }} />
      <Stack.Screen name="wardrobe" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
      <Stack.Screen name="premium" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Load the three brand/UI/mono families before rendering UI that uses them.
  const [fontsLoaded, fontError] = useFonts(fontMap);
  if (!fontsLoaded && !fontError) return null; // brief splash while fonts load

  // ThemeProvider (light/dark + reduce-motion) wraps everything so any screen can useTheme().
  // AuthProvider wraps ProgressProvider so progress sync can read the auth token.
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <WalletProvider>
            <CosmeticsProvider>
              <ProgressProvider>
                <RootNav />
              </ProgressProvider>
            </CosmeticsProvider>
          </WalletProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
