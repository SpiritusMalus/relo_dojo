import { Text, type StyleProp, type TextStyle } from "react-native";
import { useTheme, type TypeVariant } from "../../theme/theme";
import { useTranslator } from "./TranslationPopover";

// Inline English text whose every word is long-pressable → its translation pops up (see
// TranslationPopover). Drop-in for a <Txt> that renders an English sentence: same variant/color/style
// props. Whitespace is preserved so wrapping and spacing look identical to a plain <Txt>. Use this
// ONLY for English content — translating the RU prompt of a build-the-sentence task is pointless.
export default function TranslatableText({
  text,
  variant = "body",
  color,
  style,
}: {
  text: string;
  variant?: TypeVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  const { translateAt } = useTranslator();
  const defaultColor = variant === "label" || variant === "secondary" ? t.c.ink2 : t.c.ink;
  // Split into words + the whitespace between them; keeping the whitespace chunks as plain string
  // children preserves the original layout while only the word spans get a long-press handler.
  const parts = text.split(/(\s+)/);

  return (
    <Text style={[t.type[variant], { color: color ?? defaultColor }, style]}>
      {parts.map((part, i) =>
        /\S/.test(part) ? (
          <Text
            key={i}
            suppressHighlighting
            onLongPress={(e) =>
              translateAt(part, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, text)
            }
          >
            {part}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}
