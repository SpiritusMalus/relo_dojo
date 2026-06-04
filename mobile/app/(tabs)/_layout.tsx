import { Tabs } from "expo-router";

// Practice / Progress tabs (shown only when authenticated; the gate lives in app/_layout.tsx).
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: "#0a7d28" }}>
      <Tabs.Screen name="index" options={{ title: "Practice" }} />
      <Tabs.Screen name="progress" options={{ title: "Progress" }} />
    </Tabs>
  );
}
