import type { ReactNode } from "react";
import { ScrollView, View, type ViewStyle } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme/theme";

// Standard screen canvas: theme `screen` background, safe-area insets, optional scroll.
export default function Screen({
  children,
  scroll = true,
  contentStyle,
  topInset = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
  topInset?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pad: ViewStyle = {
    paddingTop: topInset ? insets.top + 8 : 0,
    paddingBottom: insets.bottom + 16,
    paddingHorizontal: t.spacing.pad,
  };
  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[pad, { gap: t.spacing.gap }, contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad, { gap: t.spacing.gap }, contentStyle]}>{children}</View>
      )}
    </View>
  );
}
