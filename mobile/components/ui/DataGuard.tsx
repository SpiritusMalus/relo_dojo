import { View, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import Txt from "./Txt";

// Point-of-input cross-border guardrail (152-ФЗ): a short, calm note shown right at every free-text
// field that gets sent to the AI model abroad — "your text goes to Google (USA), don't enter
// personal/other-people's data". Not a modal; it sits inline next to the input. The standalone
// consent (store/consent) is the legal act; this is the at-a-glance reminder at the moment of typing.
export default function DataGuard({ style }: { style?: ViewStyle }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View style={style}>
      <Txt variant="caption" color={t.c.ink3}>
        {tr("guard.crossBorder")}
      </Txt>
    </View>
  );
}
