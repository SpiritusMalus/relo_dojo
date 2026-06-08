import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import { AuthProvider, useAuth } from "../store/auth";
import { ProgressProvider, useProgress } from "../store/progress";
import { I18nProvider } from "../store/i18n";
import { ThemeProvider, fontMap } from "../theme/theme";

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

  if (!authReady) return null; // brief splash while we read stored token

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="practice" options={{ headerShown: false }} />
      <Stack.Screen name="story" options={{ headerShown: false }} />
      <Stack.Screen name="challenge" options={{ headerShown: false }} />
      <Stack.Screen name="topics" options={{ headerShown: false }} />
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
          <ProgressProvider>
            <RootNav />
          </ProgressProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
