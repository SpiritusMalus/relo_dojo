import { useProgress } from "../../store/progress";
import { useAuth } from "../../store/auth";
import { beltProgress } from "../../store/dojo";
import Screen from "../../components/ui/Screen";
import TopBar from "../../components/ui/TopBar";
import ActivationBanner from "../../components/ui/ActivationBanner";
import LockGate from "../../components/ui/LockGate";
import TopicsBody from "../../components/ui/TopicsBody";

// "Train" tab — self-directed topic picker. Locked until the account is verified (the starter
// Daily Mix on Home stays open).
export default function TrainScreen() {
  const { progress } = useProgress();
  const { user } = useAuth();
  const bp = beltProgress(progress);
  const locked = !!user && !user.is_verified;
  return (
    <Screen>
      <TopBar belt={bp.belt} streak={progress.dailyStreak} xp={progress.xp} />
      <ActivationBanner />
      <LockGate locked={locked}>
        <TopicsBody />
      </LockGate>
    </Screen>
  );
}
