import { useI18n } from "../../store/i18n";
import ModeButton from "./ModeButton";

export default function ChaptersButton({ onPress }: { onPress: () => void }) {
  const { lang } = useI18n();
  return <ModeButton icon="scroll" onPress={onPress}
    title={lang === "ru" ? "Главы" : "Chapters"}
    subtitle={lang === "ru" ? "Познакомиться, рассказать об опыте, переспросить" : "Introduce yourself, share an experience, ask for clarity"} />;
}
