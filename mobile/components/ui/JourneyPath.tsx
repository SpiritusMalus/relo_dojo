import { Pressable, StyleSheet, View } from "react-native";
import { useProgress } from "../../store/progress";
import { useI18n } from "../../store/i18n";
import { beltProgress, buildPath, type NodeState, type PathNode } from "../../store/dojo";
import { useTheme, type Belt } from "../../theme/theme";
import BeltKnot from "./BeltKnot";
import Icon from "./Icon";
import Sensei from "./Sensei";
import Txt from "./Txt";

// The belt "journey" map: a sequence of topic nodes ending in a belt test. Read-only by default (a
// progress visualization in the Progress tab); pass `onSelect` to make nodes launch practice.
export default function JourneyPath({
  count = 6,
  onSelect,
}: {
  count?: number;
  onSelect?: (node: PathNode) => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { progress } = useProgress();
  const bp = beltProgress(progress);
  const { nodes, doneCount, total } = buildPath(progress, count);

  return (
    <View>
      <View style={styles.header}>
        <Txt variant="cardTitle">{tr("prog.journey")}</Txt>
        <Txt variant="secondary" color={t.c.ink3}>{tr("home.ofDone", { done: doneCount, total })}</Txt>
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
            onPress={onSelect && node.state !== "locked" ? () => onSelect(node) : undefined}
          />
        ))}
      </View>
    </View>
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
  onPress?: () => void;
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
        disabled={!onPress}
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
        <NodeCard node={node} interactive={!!onPress} />
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

function NodeCard({ node, interactive }: { node: PathNode; interactive: boolean }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  if (node.state === "test") {
    return (
      <View style={styles.cardInner}>
        <View style={{ flex: 1 }}>
          <Txt variant="cardTitle">{tr("home.beltTest")}</Txt>
          <Txt variant="secondary" color={t.c.ink3}>
            {tr("home.beltTestSub")}
          </Txt>
        </View>
        {interactive && <Icon name="chevron" size={22} color={t.c.ink3} />}
      </View>
    );
  }
  const topic = node.topic!;
  const sub: Record<Exclude<NodeState, "test">, string> = {
    done: `Mastered · ${topic.belt.name}`,
    current: interactive ? "Continue →" : "In progress",
    next: interactive ? "Up next · tap to start" : "Up next",
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
        interactive && <Icon name="chevron" size={22} color={t.c.ink3} />
      )}
    </View>
  );
}

const CIRCLE = 44;
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  row: { flexDirection: "row", gap: 14, alignItems: "stretch", minHeight: 72 },
  rail: { width: CIRCLE, alignItems: "center", justifyContent: "center" },
  connector: { position: "absolute", width: 3, left: CIRCLE / 2 - 1.5 },
  connectorTop: { top: 0, height: "50%" },
  connectorBottom: { bottom: 0, height: "50%" },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: "center", justifyContent: "center" },
  card: { flex: 1, borderRadius: 16, padding: 14, marginBottom: 10 },
  cardInner: { flexDirection: "row", alignItems: "center", gap: 12 },
});
