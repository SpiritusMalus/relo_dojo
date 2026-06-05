import { Text, type TextProps } from "react-native";
import { useTheme, type TypeVariant } from "../../theme/theme";

// Typed text wrapper. `variant` picks the font face + metrics from the theme; colour defaults to the
// theme's primary ink (or ink3 for labels) and can be overridden via `color`.
export default function Txt({
  variant = "body",
  color,
  style,
  ...rest
}: TextProps & { variant?: TypeVariant; color?: string }) {
  const t = useTheme();
  const defaultColor = variant === "label" || variant === "secondary" ? t.c.ink2 : t.c.ink;
  return <Text {...rest} style={[t.type[variant], { color: color ?? defaultColor }, style]} />;
}
