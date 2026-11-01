import { useI18n } from "../../store/i18n";
import ModeButton from "./ModeButton";

export default function ShopButton({ onPress }: { onPress: () => void }) {
  const { t: tr } = useI18n();
  return <ModeButton title={tr("btn.shop.title")} subtitle={tr("btn.shop.sub")} icon="star" onPress={onPress} />;
}
