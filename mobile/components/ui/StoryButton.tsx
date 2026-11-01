import { useI18n } from "../../store/i18n";
import ModeButton from "./ModeButton";

export default function StoryButton({ onPress, subtitle }: { onPress: () => void; subtitle?: string }) {
  const { t: tr } = useI18n();
  return <ModeButton title={tr("btn.story.title")} subtitle={subtitle || tr("btn.story.sub")} icon="star" onPress={onPress} />;
}
