import { useProgress } from "../../store/progress";
import { beltProgress } from "../../store/dojo";
import Screen from "../../components/ui/Screen";
import TopBar from "../../components/ui/TopBar";
import TopicsBody from "../../components/ui/TopicsBody";

// "Train" tab — Daily mix + all topics.
export default function TrainScreen() {
  const { progress } = useProgress();
  const bp = beltProgress(progress);
  return (
    <Screen>
      <TopBar belt={bp.belt} streak={progress.dailyStreak} xp={progress.xp} />
      <TopicsBody />
    </Screen>
  );
}
