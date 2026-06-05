import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { belts, useTheme, type Belt } from "../../theme/theme";

// Friendly geometric mascot. Headband = current belt colour. Recreated from reference/dojo-core.jsx.
export type Mood = "happy" | "cheer" | "think" | "sad";

const AnimatedSvg = Animated.createAnimatedComponent(Svg);

export default function Sensei({
  belt = belts[3],
  size = 88,
  mood = "happy",
  bob = false,
}: {
  belt?: Belt;
  size?: number;
  mood?: Mood;
  bob?: boolean;
}) {
  const { reduceMotion } = useTheme();
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!bob || reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -5, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bob, reduceMotion, y]);

  const band = belt.color;
  const knot = belt.knot;
  const skin = "#F4D9B8";
  const skinEdge = "#E7C39A";
  const hair = "#2B2B30";
  const eye = "#23302A";

  return (
    <AnimatedSvg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ transform: [{ translateY: y }], overflow: "visible" }}
    >
      {/* topknot */}
      <Circle cx="50" cy="17" r="8" fill={hair} />
      <Rect x="47" y="20" width="6" height="8" rx="3" fill={hair} />
      {/* head */}
      <Circle cx="50" cy="54" r="33" fill={skin} stroke={skinEdge} strokeWidth="1.5" />
      {/* hair sides */}
      <Path d="M18 50 q3 -22 32 -23 q29 1 32 23 q-10 -10 -32 -10 q-22 0 -32 10z" fill={hair} />
      {/* headband */}
      <Path d="M17 44 q33 -11 66 0 l0 9 q-33 -10 -66 0 z" fill={band} stroke={belt.edge} strokeWidth="1.2" />
      {/* knot + tails on the right */}
      <Circle cx="84" cy="48" r="5.5" fill={knot} />
      <Path d="M86 50 l12 7 -3 5 -11 -8z" fill={band} stroke={belt.edge} strokeWidth="1" />
      <Path d="M86 53 l9 11 -5 3 -7 -11z" fill={knot} stroke={belt.edge} strokeWidth="1" />
      {/* eyes per mood */}
      <Eyes mood={mood} eye={eye} />
      {/* rosy cheeks */}
      <Circle cx="33" cy="60" r="4" fill="#F3A98F" opacity={0.5} />
      <Circle cx="67" cy="60" r="4" fill="#F3A98F" opacity={0.5} />
      {/* mouth per mood */}
      <Mouth mood={mood} eye={eye} />
    </AnimatedSvg>
  );
}

function Eyes({ mood, eye }: { mood: Mood; eye: string }) {
  const s = { stroke: eye, strokeWidth: 3.2, fill: "none" as const, strokeLinecap: "round" as const };
  switch (mood) {
    case "cheer":
      return (
        <G>
          <Path d="M33 51 q5 -6 9 0" {...s} />
          <Path d="M58 51 q5 -6 9 0" {...s} />
        </G>
      );
    case "think":
      return (
        <G>
          <Circle cx="39" cy="51" r="2.6" fill={eye} />
          <Circle cx="62" cy="51" r="2.6" fill={eye} />
          <Path d="M56 44 q5 -2 9 1" stroke={eye} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </G>
      );
    case "sad":
      return (
        <G>
          <Circle cx="39" cy="52" r="2.6" fill={eye} />
          <Circle cx="62" cy="52" r="2.6" fill={eye} />
        </G>
      );
    case "happy":
    default:
      return (
        <G>
          <Path d="M34 50 q4 -5 8 0" {...s} />
          <Path d="M58 50 q4 -5 8 0" {...s} />
        </G>
      );
  }
}

function Mouth({ mood, eye }: { mood: Mood; eye: string }) {
  switch (mood) {
    case "cheer":
      return <Path d="M43 59 q7 11 14 0 z" fill="#C2543F" stroke={eye} strokeWidth="2.4" strokeLinejoin="round" />;
    case "think":
      return <Path d="M44 62 h12" stroke={eye} strokeWidth="3" fill="none" strokeLinecap="round" />;
    case "sad":
      return <Path d="M42 64 q8 -7 16 0" stroke={eye} strokeWidth="3" fill="none" strokeLinecap="round" />;
    case "happy":
    default:
      return <Path d="M42 60 q8 7 16 0" stroke={eye} strokeWidth="3" fill="none" strokeLinecap="round" />;
  }
}
