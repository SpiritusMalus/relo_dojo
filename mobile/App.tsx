import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { postChat } from "./services/api";

type Role = "user" | "assistant" | "error";
type Message = { id: string; role: Role; text: string };

export default function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  async function onSend() {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: "user", text }]);
    setInput("");
    setLoading(true);
    try {
      const reply = await postChat(text);
      setMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "assistant", text: reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setMessages((prev) => [...prev, { id: `${Date.now()}-e`, role: "error", text: msg }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Grammar Dojo — Chat</Text>

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <View style={[styles.bubble, BUBBLE[item.role]]}>
            <Text style={item.role === "error" ? styles.errorText : styles.bubbleText}>
              {item.text}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.hint}>Ask the model something…</Text>}
      />

      {loading && (
        <View style={styles.thinking}>
          <ActivityIndicator />
          <Text style={styles.hint}>  model is thinking…</Text>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Type a message"
            value={input}
            onChangeText={setInput}
            editable={!loading}
            onSubmitEditing={onSend}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (loading || !input.trim()) && styles.sendBtnDisabled]}
            onPress={onSend}
            disabled={loading || !input.trim()}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const BUBBLE: Record<Role, object> = {
  user: { alignSelf: "flex-end", backgroundColor: "#0a7d28" },
  assistant: { alignSelf: "flex-start", backgroundColor: "#eee" },
  error: { alignSelf: "flex-start", backgroundColor: "#fdecea" },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 8, textAlign: "center" },
  list: { flex: 1 },
  listContent: { gap: 8, paddingVertical: 8 },
  bubble: { maxWidth: "85%", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  bubbleText: { fontSize: 16, color: "#111" },
  errorText: { fontSize: 15, color: "#c0392b" },
  hint: { color: "#888", textAlign: "center", marginTop: 16 },
  thinking: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 6 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendBtn: { backgroundColor: "#0a7d28", borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 },
  sendBtnDisabled: { backgroundColor: "#9bbfa5" },
  sendText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
