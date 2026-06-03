import { useState } from "react";
import {
  ActivityIndicator,
  Button,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { postEcho } from "./services/api";

export default function App() {
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSend() {
    setLoading(true);
    setError(null);
    setReply(null);
    try {
      const echoed = await postEcho(text);
      setReply(echoed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Grammar Dojo — Phase 0</Text>
      <Text style={styles.subtitle}>Send text to the backend and see it echoed back.</Text>

      <TextInput
        style={styles.input}
        placeholder="Type something, e.g. hello"
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
      />

      <Button title="Send" onPress={onSend} disabled={loading || text.length === 0} />

      <View style={styles.result}>
        {loading && <ActivityIndicator />}
        {reply !== null && <Text style={styles.reply}>Backend says: {reply}</Text>}
        {error !== null && <Text style={styles.error}>{error}</Text>}
      </View>

      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 24,
    justifyContent: "center",
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: "600" },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  result: { minHeight: 40, marginTop: 8 },
  reply: { fontSize: 16, color: "#0a7d28" },
  error: { fontSize: 16, color: "#c0392b" },
});
