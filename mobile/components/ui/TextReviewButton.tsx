import { useI18n } from "../../store/i18n";
import ModeButton from "./ModeButton";

export default function TextReviewButton({ onPress }: { onPress: () => void }) {
  const { t: tr } = useI18n();
  return <ModeButton title={tr("btn.textReview.title")} subtitle={tr("btn.textReview.sub")} icon="target" onPress={onPress} />;
}
