import { Tabs } from "expo-router";
import { ProgressProvider } from "../store/progress";

// Two-tab shell. ProgressProvider wraps the tabs so Practice and Progress share one reactive store.
export default function RootLayout() {
  return (
    <ProgressProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: "#0a7d28",
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Practice" }} />
        <Tabs.Screen name="progress" options={{ title: "Progress" }} />
      </Tabs>
    </ProgressProvider>
  );
}
