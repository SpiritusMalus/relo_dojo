import { Pressable, StyleSheet } from "react-native";
import { useTheme } from "../../theme/theme";
import Txt from "./Txt";

// Pill chip with a selected state (multi/single-select surveys, calibration cards).
export default function Chip({
  label,
  selected = false,
  onPress,
  disabled = false,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? t.c.accent : t.c.line2,
          backgroundColor: selected ? t.c.accentSoft : pressed ? t.c.surface2 : t.c.surface,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Txt variant="bodyStrong" color={selected ? t.c.accent : t.c.ink}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
});
