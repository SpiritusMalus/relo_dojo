import { useI18n } from "../../store/i18n";
import ModeButton from "./ModeButton";

export default function ChallengeButton({ onPress }: { onPress: () => void }) {
  const { t: tr } = useI18n();
  return <ModeButton title={tr("btn.challenge.title")} subtitle={tr("btn.challenge.sub")} icon="flame" onPress={onPress} />;
}
