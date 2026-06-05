import Svg, { Circle, G, Path, Rect } from "react-native-svg";

// Tiny line icons (24×24), recreated from reference/dojo-core.jsx. Colour via `color`.
export type IconName =
  | "home"
  | "practice"
  | "chart"
  | "check"
  | "x"
  | "chevron"
  | "back"
  | "plus"
  | "lock"
  | "target"
  | "bolt"
  | "gear"
  | "sound"
  | "star"
  | "flame";

export default function Icon({
  name,
  size = 24,
  color = "#15201A",
  sw = 2,
}: {
  name: IconName;
  size?: number;
  color?: string;
  sw?: number;
}) {
  const p = {
    fill: "none" as const,
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {renderPaths(name, p)}
    </Svg>
  );
}

function renderPaths(name: IconName, p: object) {
  switch (name) {
    case "home":
      return (
        <G {...p}>
          <Path d="M4 11l8-6 8 6" />
          <Path d="M6 10v9h12v-9" />
        </G>
      );
    case "practice":
      return (
        <G {...p}>
          <Path d="M4 9v6M20 9v6M7 7v10M17 7v10" />
          <Path d="M7 12h10" />
        </G>
      );
    case "chart":
      return (
        <G {...p}>
          <Path d="M5 19V10M12 19V5M19 19v-6" />
        </G>
      );
    case "check":
      return (
        <G {...p}>
          <Path d="M5 13l4 4L19 7" />
        </G>
      );
    case "x":
      return (
        <G {...p}>
          <Path d="M6 6l12 12M18 6L6 18" />
        </G>
      );
    case "chevron":
      return (
        <G {...p}>
          <Path d="M9 6l6 6-6 6" />
        </G>
      );
    case "back":
      return (
        <G {...p}>
          <Path d="M15 6l-6 6 6 6" />
        </G>
      );
    case "plus":
      return (
        <G {...p}>
          <Path d="M12 5v14M5 12h14" />
        </G>
      );
    case "lock":
      return (
        <G {...p}>
          <Rect x="5" y="11" width="14" height="9" rx="2" />
          <Path d="M8 11V8a4 4 0 018 0v3" />
        </G>
      );
    case "target":
      return (
        <G {...p}>
          <Circle cx="12" cy="12" r="8" />
          <Circle cx="12" cy="12" r="3" />
        </G>
      );
    case "bolt":
      return (
        <G {...p}>
          <Path d="M13 3L5 13h6l-1 8 8-11h-6z" />
        </G>
      );
    case "gear":
      return (
        <G {...p}>
          <Circle cx="12" cy="12" r="3" />
          <Path d="M12 4v2M12 18v2M4 12h2M18 12h2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18" />
        </G>
      );
    case "sound":
      return (
        <G {...p}>
          <Path d="M5 9v6h4l5 4V5L9 9z" />
          <Path d="M16 9a4 4 0 010 6" />
        </G>
      );
    case "star":
      return (
        <G {...p}>
          <Path d="M12 4l2.4 5 5.6.6-4 3.8 1 5.6-5-2.8-5 2.8 1-5.6-4-3.8 5.6-.6z" />
        </G>
      );
    case "flame":
      return (
        <G {...p}>
          <Path d="M12 3c2 3 5 5 5 9a5 5 0 01-10 0c0-2 1-3 2-4 0 1 1 2 2 2 0-3-1-5-1-7z" />
        </G>
      );
  }
}
