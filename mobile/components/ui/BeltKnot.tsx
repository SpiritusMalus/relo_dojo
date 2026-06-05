import Svg, { Path, Rect } from "react-native-svg";
import type { Belt } from "../../theme/theme";

// Folded-belt icon used in lists, the top bar, and the path's belt-test node.
export default function BeltKnot({ belt, size = 34 }: { belt: Belt; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Rect x="3" y="15" width="34" height="10" rx="2" fill={belt.color} stroke={belt.edge} strokeWidth="1.2" />
      <Rect x="14" y="11" width="12" height="18" rx="2.5" fill={belt.color} stroke={belt.edge} strokeWidth="1.2" />
      <Path d="M14 25 l-5 11 5 -2 3 3 2 -10z" fill={belt.knot} stroke={belt.edge} strokeWidth="1" />
      <Path d="M26 25 l5 11 -5 -2 -3 3 -2 -10z" fill={belt.knot} stroke={belt.edge} strokeWidth="1" />
    </Svg>
  );
}
