import { View, type ViewProps, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/theme";

// Rounded surface card with hairline border + soft shadow.
export default function Card({
  style,
  padded = true,
  ...rest
}: ViewProps & { padded?: boolean }) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.c.surface,
    borderRadius: t.spacing.radius,
    borderWidth: 1,
    borderColor: t.c.line,
    padding: padded ? t.spacing.pad : 0,
    ...t.shadows.sm,
  };
  return <View {...rest} style={[base, style]} />;
}
