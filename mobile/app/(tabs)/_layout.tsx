import { View } from "react-native";
import { Tabs } from "expo-router";
import { useTheme } from "../../theme/theme";
import Icon, { type IconName } from "../../components/ui/Icon";

// Home / Train / Progress. Active tab = accent icon+label with an accentSoft rounded highlight.
export default function TabsLayout() {
  const t = useTheme();

  const tabIcon =
    (name: IconName) =>
    ({ focused, color }: { focused: boolean; color: string }) => (
      <View
        style={{
          width: 52,
          height: 32,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: focused ? t.c.accentSoft : "transparent",
        }}
      >
        <Icon name={name} size={24} color={color} />
      </View>
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.c.accent,
        tabBarInactiveTintColor: t.c.ink3,
        tabBarStyle: { backgroundColor: t.c.screen, borderTopColor: t.c.line },
        tabBarLabelStyle: { fontFamily: t.fonts.ui600, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon("home") }} />
      <Tabs.Screen name="train" options={{ title: "Train", tabBarIcon: tabIcon("practice") }} />
      <Tabs.Screen name="progress" options={{ title: "Progress", tabBarIcon: tabIcon("chart") }} />
    </Tabs>
  );
}
