import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { AuthProvider, useAuth } from "../store/auth";
import { ProgressProvider } from "../store/progress";

// Redirect between the auth screen and the tabs based on login state.
function RootNav() {
  const { ready, token } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === "login";
    if (!token && !onLogin) router.replace("/login");
    else if (token && onLogin) router.replace("/");
  }, [ready, token, segments, router]);

  if (!ready) return null; // brief splash while we read stored token

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
    </Stack>
  );
}

export default function RootLayout() {
  // AuthProvider wraps ProgressProvider so progress sync can read the auth token.
  return (
    <AuthProvider>
      <ProgressProvider>
        <RootNav />
      </ProgressProvider>
    </AuthProvider>
  );
}
