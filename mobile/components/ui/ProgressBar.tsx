import { useEffect, useRef } from "react";
import { Animated, View, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/theme";

// Rounded progress track + fill. Animates the fill width on mount (unless reduce-motion).
export default function ProgressBar({
  pct,
  height = 10,
  color,
  track,
  style,
}: {
  pct: number; // 0..100
  height?: number;
  color?: string;
  track?: string;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const clamped = Math.max(0, Math.min(100, pct));
  const w = useRef(new Animated.Value(t.reduceMotion ? clamped : 0)).current;

  useEffect(() => {
    if (t.reduceMotion) {
      w.setValue(clamped);
      return;
    }
    const anim = Animated.timing(w, { toValue: clamped, duration: 500, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [clamped, t.reduceMotion, w]);

  return (
    <View
      style={[
        { height, backgroundColor: track ?? t.c.surface3, borderRadius: 999, overflow: "hidden" },
        style,
      ]}
    >
      <Animated.View
        style={{
          height: "100%",
          borderRadius: 999,
          backgroundColor: color ?? t.c.accent,
          width: w.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }),
        }}
      />
    </View>
  );
}
