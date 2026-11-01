import { useI18n } from "../../store/i18n";
import ModeButton from "./ModeButton";

export default function ReviewButton({ count, onPress }: { count: number; onPress: () => void }) {
  const { t: tr } = useI18n();
  return <ModeButton title={tr("btn.review.title")} subtitle={tr("btn.review.sub", { n: count })} icon="target" onPress={onPress} />;
}
