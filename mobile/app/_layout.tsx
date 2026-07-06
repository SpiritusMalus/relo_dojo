import { useEffect, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import { AuthProvider, useAuth } from "../store/auth";
import { ProgressProvider, useProgress } from "../store/progress";
import { WalletProvider } from "../store/wallet";
import { CosmeticsProvider } from "../store/cosmeticsStore";
import { ConsentProvider, useConsent } from "../store/consent";
import { VoiceConsentProvider } from "../store/voiceConsent";
import { I18nProvider, useI18n } from "../store/i18n";
import { localDate } from "../store/streak";
import { migrateStorageKeys } from "../store/migrateStorageKeys";
import { ensurePermission, rescheduleAll } from "../services/notifications";
import { getContracts, postEvents } from "../services/api";
import * as analytics from "../services/analytics";
import { ThemeProvider, fontMap } from "../theme/theme";

// Global crash screen: expo-router renders this whenever a render throws anywhere in the tree
// below the root layout, instead of leaving a blank white screen with no recovery.
export { RootErrorBoundary as ErrorBoundary } from "../components/RootErrorBoundary";

// Stable anonymous id for pre-login retention attribution (persisted across launches).
const ANON_KEY = "gd.analytics.anon";
function newAnonId(): string {
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Foreground flush cadence. Server-counted features — daily contracts count progress from the
// events table — must reflect a just-finished session without waiting for the app to background.
// flush() no-ops on an empty queue, so an idle tick costs nothing.
const FLUSH_INTERVAL_MS = 30000;

// Redirect between login, onboarding, and the tabs based on auth + onboarding state.
function RootNav() {
  const { ready: authReady, token } = useAuth();
  const { ready: progressReady, synced, progress } = useProgress();
  const { ready: consentReady, accepted: consentAccepted } = useConsent();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!authReady) return;
    const onLogin = segments[0] === "login";
    const onOnboarding = segments[0] === "onboarding";
    const onConsent = segments[0] === "consent";

    // 152-ФЗ gate: the standalone cross-border consent comes BEFORE onboarding/tabs. Until the
    // current version is accepted, the only screen reachable is /consent (its "I agree" routes on).
    // We only ever push TO consent here — never auto-pop — so opening it from Settings (review mode)
    // after acceptance stays put.
    if (consentReady && !consentAccepted) {
      if (!onConsent) router.replace("/consent");
      return;
    }

    // Anonymous-first funnel (P1): a missing token no longer forces /login. Anonymous and
    // authenticated users both flow onboarding → tabs; the account ask is deferred to the soft
    // save-progress wall (store/registerWall.ts). /login is reachable on demand ("Save progress").
    if (token && onLogin) {
      router.replace("/");
      return;
    }
    // Decide onboarding only once progress is loaded AND the post-login server snapshot has merged
    // in — otherwise an existing account briefly shows onboarding on the reset local default. For
    // anonymous users there's nothing to reconcile, so `synced` settles immediately (progress store).
    if (!progressReady || !synced) return;
    if (!progress.onboarded && !onOnboarding && !onLogin) {
      router.replace("/onboarding");
    } else if (progress.onboarded && onOnboarding) {
      router.replace("/");
    }
  }, [authReady, token, progressReady, synced, progress.onboarded, consentReady, consentAccepted, segments, router]);

  // Trigger layer: once onboarded, keep the notification plan in sync with today's state.
  // Re-runs when training happens (cancels today's nags) or the streak/language changes.
  const { lang } = useI18n();
  const trainedToday = progress.lastActiveDate === localDate(new Date());
  useEffect(() => {
    if (!authReady || !progressReady || !token || !progress.onboarded) return;
    const timer = setTimeout(() => {
      void (async () => {
        if (!(await ensurePermission())) return;
        // Best-effort: count today's open contracts so the daily nudge can name them.
        let contractsLeft: number | undefined;
        try {
          const c = await getContracts();
          contractsLeft = c.contracts.filter((x) => !x.done).length;
        } catch {
          // offline / old backend — fall back to the generic gentle line
        }
        await rescheduleAll({
          lang,
          trainedToday,
          dailyStreak: progress.dailyStreak,
          remindHour: progress.profile?.remindHour,
          recap: progress.profile?.diary?.last,
          contractsLeft,
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
    let flushTimer: ReturnType<typeof setInterval> | undefined;

    // Catch uncaught JS errors that the render ErrorBoundary can't see (async callbacks, event
    // handlers). Chain RN's default handler so the dev red box / prod fatal behaviour is preserved;
    // we only add a best-effort analytics breadcrumb on top.
    const errorUtils = (globalThis as { ErrorUtils?: {
      getGlobalHandler: () => (e: unknown, isFatal?: boolean) => void;
      setGlobalHandler: (h: (e: unknown, isFatal?: boolean) => void) => void;
    } }).ErrorUtils;
    if (errorUtils && !(globalThis as { __reloErrHooked?: boolean }).__reloErrHooked) {
      (globalThis as { __reloErrHooked?: boolean }).__reloErrHooked = true;
      const prev = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((e, isFatal) => {
        try {
          const err = e as { message?: unknown } | undefined;
          analytics.track("app_error", { message: String(err?.message ?? e), fatal: !!isFatal });
          void analytics.flush();
        } catch {
          // never let the handler itself throw
        }
        prev?.(e, isFatal);
      });
    }

    void (async () => {
      let id = await AsyncStorage.getItem(ANON_KEY).catch(() => null);
      if (!id) {
        id = newAnonId();
        // Await the write (best-effort) so the persisted id is settled before configure(): otherwise
        // a crash/relaunch between generating and persisting could split one user across two anon
        // cohorts. configure() already uses this generated id even while the write is in flight.
        await AsyncStorage.setItem(ANON_KEY, id).catch(() => {});
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
      // Periodic foreground flush: buffered events (e.g. exercise_answered) reach the server during
      // a session, so daily-contract progress advances without the app having to be backgrounded.
      flushTimer = setInterval(() => void analytics.flush(), FLUSH_INTERVAL_MS);
    })();
    return () => {
      sub?.remove();
      if (flushTimer) clearInterval(flushTimer);
    };
  }, []);

  if (!authReady) return null; // brief splash while we read stored token

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="consent" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="practice" options={{ headerShown: false }} />
      <Stack.Screen name="story" options={{ headerShown: false }} />
      <Stack.Screen name="challenge" options={{ headerShown: false }} />
      <Stack.Screen name="review" options={{ headerShown: false }} />
      <Stack.Screen name="shop" options={{ headerShown: false }} />
      <Stack.Screen name="wardrobe" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
      <Stack.Screen name="premium" options={{ headerShown: false }} />
      <Stack.Screen name="level-test" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Load the three brand/UI/mono families before rendering UI that uses them.
  const [fontsLoaded, fontError] = useFonts(fontMap);

  // One-time storage-key migration (brand rename grammar-dojo → relo_dojo). Runs ONCE, behind the
  // splash gate, BEFORE the provider tree mounts — so AuthProvider / ProgressProvider / I18nProvider
  // / ThemeProvider all read the already-migrated keys on their first mount and existing installs
  // keep their saved session, progress, language, and theme. Idempotent + never-throws (see
  // store/migrateStorageKeys.ts), so a slow/failed run can't deadlock boot.
  const [migrated, setMigrated] = useState(false);
  useEffect(() => {
    let active = true;
    migrateStorageKeys().finally(() => {
      if (active) setMigrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!fontsLoaded && !fontError) return null; // brief splash while fonts load
  if (!migrated) return null; // brief splash while the one-time key migration runs (then mounts)

  // ThemeProvider (light/dark + reduce-motion) wraps everything so any screen can useTheme().
  // AuthProvider wraps ProgressProvider so progress sync can read the auth token.
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <WalletProvider>
            <CosmeticsProvider>
              <ProgressProvider>
                <ConsentProvider>
                  <VoiceConsentProvider>
                    <RootNav />
                  </VoiceConsentProvider>
                </ConsentProvider>
              </ProgressProvider>
            </CosmeticsProvider>
          </WalletProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
