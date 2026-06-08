import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useProgress } from "../../store/progress";
import { beltProgress, buildPath, type NodeState, type PathNode } from "../../store/dojo";
import { useTheme, type Belt } from "../../theme/theme";
import Screen from "../../components/ui/Screen";
import TopBar from "../../components/ui/TopBar";
import DailyMixButton from "../../components/ui/DailyMixButton";
import StoryButton from "../../components/ui/StoryButton";
import Sensei from "../../components/ui/Sensei";
import BeltKnot from "../../components/ui/BeltKnot";
import Icon from "../../components/ui/Icon";
import ProgressBar from "../../components/ui/ProgressBar";
import Button from "../../components/ui/Button";
import Txt from "../../components/ui/Txt";

export default function HomeScreen() {
  const router = useRouter();
  const t = useTheme();
  const { progress } = useProgress();

  const bp = beltProgress(progress);
  const { nodes, doneCount, total } = buildPath(progress, 6);

  const goPractice = (topic?: string) =>
    router.push(topic ? { pathname: "/practice", params: { topic } } : "/practice");

  return (
    <Screen>
      <TopBar belt={bp.belt} streak={progress.dailyStreak} xp={progress.xp} />

      {/* Belt hero — background is the current belt colour */}
      <LinearGradient
        colors={[bp.belt.color, bp.belt.edge]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.hero, { borderRadius: t.spacing.radiusLg }]}
      >
        <View style={styles.heroMascot}>
          <Sensei belt={bp.belt} size={92} mood="cheer" bob />
        </View>
        <Txt variant="label" color={bp.belt.ink} style={{ opacity: 0.8 }}>
          Your belt
        </Txt>
        <Txt variant="hero" color={bp.belt.ink} style={{ marginTop: 2 }}>
          {bp.belt.name}
        </Txt>
        <Txt variant="bodyStrong" color={bp.belt.ink} style={{ opacity: 0.9, marginTop: 4, marginBottom: 12 }}>
          {bp.atMax ? `CEFR ${bp.cefr} · top belt` : `CEFR ${bp.cefr} · ${bp.pctToNext}% to ${bp.nextBelt.name}`}
        </Txt>
        <ProgressBar pct={bp.atMax ? 100 : bp.pctToNext} color={bp.belt.ink} track="rgba(0,0,0,0.16)" />
      </LinearGradient>

      <DailyMixButton onPress={() => goPractice()} />
      <StoryButton onPress={() => router.push("/story")} />

      {/* Today's path */}
      <View style={styles.pathHeader}>
        <Txt variant="cardTitle">Today's path</Txt>
        <Txt variant="secondary" color={t.c.ink3}>{`${doneCount} of ${total} done`}</Txt>
      </View>

      <View>
        {nodes.map((node, i) => (
          <PathRow
            key={i}
            node={node}
            isFirst={i === 0}
            isLast={i === nodes.length - 1}
            prevDone={nodes[i - 1]?.state === "done"}
            belt={bp.belt}
            onPress={() => {
              if (node.state === "locked") return;
              if (node.state === "test") return goPractice();
              goPractice(node.topic?.id);
            }}
          />
        ))}
      </View>

      <Button label="Browse all topics" variant="ghost" onPress={() => router.push("/topics")} />
    </Screen>
  );
}

function PathRow({
  node,
  isFirst,
  isLast,
  prevDone,
  belt,
  onPress,
}: {
  node: PathNode;
  isFirst: boolean;
  isLast: boolean;
  prevDone: boolean;
  belt: Belt;
  onPress: () => void;
}) {
  const t = useTheme();
  const accent = t.c.accent;
  const line = t.c.line2;
  const topDone = prevDone;
  const bottomDone = node.state === "done";

  return (
    <View style={styles.row}>
      {/* rail */}
      <View style={styles.rail}>
        {!isFirst && <View style={[styles.connector, styles.connectorTop, { backgroundColor: topDone ? accent : line }]} />}
        {!isLast && <View style={[styles.connector, styles.connectorBottom, { backgroundColor: bottomDone ? accent : line }]} />}
        <NodeCircle state={node.state} belt={belt} />
      </View>

      {/* card */}
      <Pressable
        onPress={onPress}
        disabled={node.state === "locked"}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: t.c.surface,
            borderColor: node.state === "current" ? accent : t.c.line,
            borderWidth: node.state === "current" ? 2 : 1,
            opacity: node.state === "locked" ? 0.6 : pressed ? 0.85 : 1,
            ...t.shadows.sm,
          },
        ]}
      >
        <NodeCard node={node} />
      </Pressable>
    </View>
  );
}

function NodeCircle({ state, belt }: { state: NodeState; belt: Belt }) {
  const t = useTheme();
  if (state === "test") {
    return (
      <View style={[styles.circle, { backgroundColor: t.c.surface, borderWidth: 2, borderColor: belt.edge }]}>
        <BeltKnot belt={belt} size={26} />
      </View>
    );
  }
  const done = state === "done";
  const active = state === "current";
  const greenBg = done || active;
  return (
    <View
      style={[
        styles.circle,
        {
          backgroundColor: greenBg ? t.c.accent : t.c.surface3,
          borderWidth: active ? 3 : 0,
          borderColor: t.c.accentSoft2,
        },
      ]}
    >
      {done && <Icon name="check" size={22} color={t.c.accentInk} />}
      {active && <Icon name="bolt" size={22} color={t.c.accentInk} />}
      {state === "next" && <Icon name="bolt" size={22} color={t.c.ink3} />}
      {state === "locked" && <Icon name="lock" size={20} color={t.c.ink3} />}
    </View>
  );
}

function NodeCard({ node }: { node: PathNode }) {
  const t = useTheme();
  if (node.state === "test") {
    return (
      <View style={styles.cardInner}>
        <View style={{ flex: 1 }}>
          <Txt variant="cardTitle">Belt test</Txt>
          <Txt variant="secondary" color={t.c.ink3}>
            Earn your next belt
          </Txt>
        </View>
        <Icon name="chevron" size={22} color={t.c.ink3} />
      </View>
    );
  }
  const topic = node.topic!;
  const sub: Record<Exclude<NodeState, "test">, string> = {
    done: `Mastered · ${topic.belt.name}`,
    current: "Continue →",
    next: "Up next · tap to start",
    locked: "Locked",
  };
  return (
    <View style={styles.cardInner}>
      <View style={{ width: 16, height: 16, borderRadius: 5, backgroundColor: topic.belt.color, borderWidth: 1.5, borderColor: topic.belt.edge }} />
      <View style={{ flex: 1 }}>
        <Txt variant="cardTitle">{topic.label}</Txt>
        <Txt variant="secondary" color={node.state === "current" ? t.c.accent : t.c.ink3}>
          {sub[node.state as Exclude<NodeState, "test">]}
          {node.state === "done" ? `  ·  ${topic.acc}%` : ""}
        </Txt>
      </View>
      {node.state === "current" ? (
        <Sensei belt={topic.belt} size={40} mood="cheer" />
      ) : (
        <Icon name="chevron" size={22} color={t.c.ink3} />
      )}
    </View>
  );
}

const CIRCLE = 44;
const styles = StyleSheet.create({
  hero: { padding: 20, overflow: "hidden" },
  heroMascot: { position: "absolute", top: 6, right: 10 },
  pathHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  row: { flexDirection: "row", gap: 14, alignItems: "stretch", minHeight: 72 },
  rail: { width: CIRCLE, alignItems: "center", justifyContent: "center" },
  connector: { position: "absolute", width: 3, left: CIRCLE / 2 - 1.5 },
  connectorTop: { top: 0, height: "50%" },
  connectorBottom: { bottom: 0, height: "50%" },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: "center", justifyContent: "center" },
  card: { flex: 1, borderRadius: 16, padding: 14, marginBottom: 10 },
  cardInner: { flexDirection: "row", alignItems: "center", gap: 12 },
});
