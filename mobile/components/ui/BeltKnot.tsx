import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import type { Belt } from "../../theme/theme";
import { useEquippedKnotVisual } from "../../store/cosmeticsStore";
import type { KnotVisual } from "../../store/cosmetics";

// Folded-belt icon used in lists, the top bar, and the path's belt-test node.
// A cosmetic (engagement v2) can restyle the fold accent + add an ornament; when no `visual` prop
// is passed it reads the equipped knot from context (classic when none / logged out).
export default function BeltKnot({
  belt,
  size = 34,
  visual,
}: {
  belt: Belt;
  size?: number;
  visual?: KnotVisual;
}) {
  const equipped = useEquippedKnotVisual();
  const v = visual ?? equipped;
  const fold = v.foldColor ?? belt.knot;
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Rect x="3" y="15" width="34" height="10" rx="2" fill={belt.color} stroke={belt.edge} strokeWidth="1.2" />
      <Rect x="14" y="11" width="12" height="18" rx="2.5" fill={belt.color} stroke={belt.edge} strokeWidth="1.2" />
      <Path d="M14 25 l-5 11 5 -2 3 3 2 -10z" fill={fold} stroke={belt.edge} strokeWidth="1" />
      <Path d="M26 25 l5 11 -5 -2 -3 3 -2 -10z" fill={fold} stroke={belt.edge} strokeWidth="1" />
      {v.ornament && <Ornament kind={v.ornament} edge={belt.edge} />}
    </Svg>
  );
}

// Cosmetic knot ornaments (engagement v2).
function Ornament({ kind, edge }: { kind: "bead_gold" | "bead_jade" | "tassel"; edge: string }) {
  switch (kind) {
    case "bead_gold":
      return <Circle cx="20" cy="20" r="4" fill="#F6C945" stroke="#B8860B" strokeWidth="1" />;
    case "bead_jade":
      return <Circle cx="20" cy="20" r="4" fill="#4FB286" stroke="#2C7A57" strokeWidth="1" />;
    case "tassel":
      return (
        <G>
          <Circle cx="20" cy="20" r="3.2" fill="#C2543F" stroke={edge} strokeWidth="0.8" />
          <Path d="M20 23 l-2 9 m2 -9 l0 9 m0 -9 l2 9" stroke="#C2543F" strokeWidth="1.4" strokeLinecap="round" />
        </G>
      );
  }
}
