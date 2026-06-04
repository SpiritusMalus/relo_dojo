import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../store/auth";

export default function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === "register";
  const canSubmit = email.includes("@") && password.length >= 8 && !busy;

  async function onSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register(email, password);
      else await login(email, password);
      // Navigation happens via the auth gate in app/_layout.tsx once the token is set.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Grammar Dojo</Text>
        <Text style={styles.subtitle}>{isRegister ? "Create an account" : "Welcome back"}</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
          editable={!busy}
        />
        <TextInput
          style={styles.input}
          placeholder="Password (min 8 chars)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          editable={!busy}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.primaryBtn, !canSubmit && styles.btnDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>{isRegister ? "Sign up" : "Log in"}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toggle}
          onPress={() => {
            setMode(isRegister ? "login" : "register");
            setError(null);
          }}
          disabled={busy}
        >
          <Text style={styles.toggleText}>
            {isRegister ? "Have an account? Log in" : "New here? Create an account"}
          </Text>
        </TouchableOpacity>
      </View>
      <StatusBar style="auto" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  content: { flex: 1, justifyContent: "center", padding: 24, gap: 14 },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center", color: "#0a7d28" },
  subtitle: { fontSize: 16, textAlign: "center", color: "#555", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    fontSize: 16,
  },
  error: { color: "#c0392b", fontSize: 14, textAlign: "center" },
  primaryBtn: { backgroundColor: "#0a7d28", borderRadius: 10, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  btnDisabled: { backgroundColor: "#9bbfa5" },
  toggle: { alignItems: "center", paddingVertical: 8 },
  toggleText: { color: "#0a7d28", fontWeight: "600", fontSize: 15 },
});
