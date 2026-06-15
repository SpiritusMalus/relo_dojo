import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../store/auth";
import { useI18n } from "../store/i18n";
import { isBlockedEmail } from "../services/email";
import { useTheme } from "../theme/theme";
import Sensei from "../components/ui/Sensei";
import Button from "../components/ui/Button";
import Txt from "../components/ui/Txt";

export default function LoginScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login, register, token } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === "register";
  // Gmail is blocked for NEW sign-ups only; existing accounts must still be able to log in.
  const gmailBlocked = isRegister && isBlockedEmail(email);
  const canSubmit = email.includes("@") && password.length >= 8 && !busy && !gmailBlocked;

  async function onSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register(email, password);
      else await login(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.c.screen }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        {/* Hero */}
        <View style={styles.hero}>
          <Sensei size={120} mood="cheer" bob />
          <Txt variant="hero" style={{ fontSize: 34, marginTop: 8 }}>
            Relo Dojo
          </Txt>
          <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center", maxWidth: 280 }}>
            {tr("login.tagline")}
          </Txt>
        </View>

        {/* Form */}
        <View style={{ gap: 14 }}>
          <Field label={tr("login.email")} value={email} onChangeText={setEmail} placeholder="you@example.com" editable={!busy} keyboardType="email-address" />
          <Field label={tr("login.password")} value={password} onChangeText={setPassword} placeholder={tr("login.passwordHint")} editable={!busy} secureTextEntry />

          {gmailBlocked && (
            <View style={[styles.banner, { backgroundColor: t.c.badSoft, borderColor: t.c.bad, borderRadius: t.spacing.radiusSm }]}>
              <Txt variant="secondary" color={t.c.bad} style={{ textAlign: "center" }}>
                {tr("login.gmailBlocked")}
              </Txt>
            </View>
          )}

          {!!error && (
            <Txt variant="secondary" color={t.c.bad} style={{ textAlign: "center" }} accessibilityRole="alert">
              {error}
            </Txt>
          )}

          <Button label={busy ? "…" : isRegister ? tr("login.create") : tr("login.enter")} onPress={onSubmit} disabled={!canSubmit} />

          <Pressable
            onPress={() => {
              setMode(isRegister ? "login" : "register");
              setError(null);
            }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            style={{ alignItems: "center", paddingVertical: 8 }}
          >
            <Txt variant="bodyStrong" color={t.c.accent}>
              {isRegister ? tr("login.haveAccount") : tr("login.newHere")}
            </Txt>
          </Pressable>

          {/* Anon-first: registration is optional. Let anonymous users keep learning without it. */}
          {!token && (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={tr("login.skip")}
              style={{ alignItems: "center", paddingVertical: 6 }}
            >
              <Txt variant="secondary" color={t.c.ink3}>
                {tr("login.skip")}
              </Txt>
            </Pressable>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  editable,
  secureTextEntry,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  editable?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: "email-address";
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="label">{label}</Txt>
      <TextInput
        style={{
          backgroundColor: t.c.surface,
          borderWidth: 2,
          borderColor: focused ? t.c.accent : t.c.line2,
          borderRadius: t.spacing.radiusSm,
          paddingHorizontal: 14,
          paddingVertical: 13,
          fontFamily: t.fonts.ui500,
          fontSize: 15,
          color: t.c.ink,
        }}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={t.c.ink3}
        editable={editable}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 28 },
  hero: { alignItems: "center", gap: 6 },
  banner: { borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12 },
});
