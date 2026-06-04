import { Tabs } from "expo-router";

// Home / Progress tabs (shown only when authenticated; the gate lives in app/_layout.tsx).
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: "#0a7d28" }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="progress" options={{ title: "Progress" }} />
    </Tabs>
  );
}
