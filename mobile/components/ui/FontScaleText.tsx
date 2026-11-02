import { forwardRef } from "react";
import { Platform, Text, useWindowDimensions, type TextProps } from "react-native";

// Paired with the pinned native font-layout adapter: replace only display text to dirty
// the normal React layout path after a scale change. Screen state and inputs stay mounted.
// Provider-independent so the error boundary can use it too.
const FontScaleText = forwardRef<Text, TextProps>(function FontScaleText(props, ref) {
  const { fontScale } = useWindowDimensions();
  return <Text {...props} ref={ref} key={Platform.OS === "android" ? fontScale : "text"} />;
});
export default FontScaleText;
