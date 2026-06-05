import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/theme";
import Txt from "./Txt";

// Chunky 3D button. Primary has a solid offset bottom edge (accentPress) that shrinks 4→1px on
// press while the face translates down — the "press into the mat" feel from the reference.
export default function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  fullWidth = true,
  uppercase,
  left,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  fullWidth?: boolean;
  uppercase?: boolean;
  left?: ReactNode;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const primary = variant === "primary";
  const isUpper = uppercase ?? primary;

  const faceColor = disabled ? t.c.surface3 : primary ? t.c.accent : t.c.surface;
  const edgeColor = disabled ? t.c.line2 : primary ? t.c.accentPress : t.c.line2;
  const textColor = disabled ? t.c.ink3 : primary ? t.c.accentInk : t.c.ink;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        {
          alignSelf: fullWidth ? "stretch" : "flex-start",
          backgroundColor: pressed && !primary ? t.c.surface2 : faceColor,
          borderRadius: t.spacing.radiusSm,
          borderBottomWidth: primary ? (pressed ? 1 : 4) : 2,
          borderColor: edgeColor,
          borderWidth: primary ? undefined : 2,
          borderBottomColor: edgeColor,
          paddingVertical: primary ? 15 : 13,
          transform: primary && pressed ? [{ translateY: 3 }] : undefined,
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {left}
        <Txt
          variant={primary ? "bodyStrong" : "bodyStrong"}
          color={textColor}
          style={{ fontFamily: t.fonts.ui700, letterSpacing: isUpper ? 0.5 : 0, textTransform: isUpper ? "uppercase" : "none", fontSize: 16 }}
        >
          {label}
        </Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 44, justifyContent: "center", paddingHorizontal: 18 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
});
