import { View } from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import Card from "./Card";
import Button from "./Button";
import Txt from "./Txt";
import Sensei from "./Sensei";

// Soft save-progress prompt (anon-first funnel, P2). Shown on Home after a few anonymous lessons.
// It sells the account on syncing progress — never blocks content. "Maybe later" dismisses it.
export default function RegisterWall({
  onCreate,
  onDismiss,
}: {
  onCreate: () => void;
  onDismiss: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <Card>
      <View style={{ alignItems: "center", gap: 6, paddingVertical: 2 }}>
        <Sensei size={64} mood="cheer" />
        <Txt variant="cardTitle" style={{ textAlign: "center" }}>
          {tr("wall.title")}
        </Txt>
        <Txt variant="secondary" color={t.c.ink2} style={{ textAlign: "center", marginBottom: 6 }}>
          {tr("wall.body")}
        </Txt>
        <Button label={tr("wall.create")} onPress={onCreate} />
        <Button label={tr("wall.later")} variant="ghost" onPress={onDismiss} />
      </View>
    </Card>
  );
}
