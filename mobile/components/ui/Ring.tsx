import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTheme } from "../../theme/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Progress ring (two circles, dash-offset). Animates the stroke fill on mount.
export default function Ring({
  pct,
  size = 120,
  stroke = 12,
  color,
  track,
  children,
}: {
  pct: number; // 0..100
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const t = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct / 100));
  const target = c * (1 - clamped);

  const offset = useRef(new Animated.Value(t.reduceMotion ? target : c)).current;
  useEffect(() => {
    if (t.reduceMotion) {
      offset.setValue(target);
      return;
    }
    const anim = Animated.timing(offset, {
      toValue: target,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [target, t.reduceMotion, offset]);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track ?? t.c.surface3} strokeWidth={stroke} />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color ?? t.c.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </Svg>
      <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        {children}
      </View>
    </View>
  );
}
