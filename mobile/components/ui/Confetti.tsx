import { useEffect, useMemo, useRef } from "react";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";

// A burst of small coloured rects falling + rotating. Mounts when shown; respects reduce-motion
// (renders nothing). Place inside a relatively-positioned container (fills it, ignores touches).
export default function Confetti({ n = 26 }: { n?: number }) {
  const t = useTheme();
  const fall = Dimensions.get("window").height;
  const cols = [t.c.accent, t.c.fire, t.c.gold, "#3F86C9", "#EF8A36"];

  const pieces = useMemo(
    () =>
      Array.from({ length: n }).map((_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 400,
        dur: 1100 + Math.random() * 900,
        sz: 6 + Math.random() * 7,
        rot: Math.random() * 360,
        color: cols[i % cols.length],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n]
  );

  if (t.reduceMotion) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => (
        <Piece key={i} {...p} fall={fall} />
      ))}
    </View>
  );
}

function Piece({
  left,
  delay,
  dur,
  sz,
  rot,
  color,
  fall,
}: {
  left: number;
  delay: number;
  dur: number;
  sz: number;
  rot: number;
  color: string;
  fall: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: dur,
      delay,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, dur, delay]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: -16,
        left: `${left}%`,
        width: sz,
        height: sz * 0.55,
        borderRadius: 2,
        backgroundColor: color,
        opacity: progress.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, fall + 40] }) },
          {
            rotate: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [`${rot}deg`, `${rot + 540}deg`],
            }),
          },
        ],
      }}
    />
  );
}
