import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import { translate as apiTranslate } from "../../services/api";
import Txt from "./Txt";

// Tap-to-translate. One shared popover for every word inside the provider: long-press an English word
// anywhere in the exercise and its meaning (in the current UI language) appears in a small bubble
// anchored to where you pressed. Tapping outside dismisses it. Requests are de-duped/cached in the
// api layer, so tapping the same word twice is instant.

type Anchor = { x: number; y: number };
type Status = "loading" | "done" | "error";
type Ctx = { translateAt: (word: string, anchor: Anchor, context?: string) => void };

const NO_OP: Ctx = { translateAt: () => {} };
const TranslationContext = createContext<Ctx | null>(null);

// Strip surrounding punctuation ("deployment." → "deployment", "(often)" → "often") so the tapped
// token translates cleanly; the original label is still what the learner sees on the tile.
function cleanWord(raw: string): string {
  return raw.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "") || raw.trim();
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const MARGIN = 8; // keep the bubble this far from screen edges

export function useTranslator(): Ctx {
  // No provider in the tree (a component rendered outside ExerciseCard) → translation is a no-op,
  // so callers can wire in the long-press unconditionally without crashing.
  return useContext(TranslationContext) ?? NO_OP;
}

export function TranslationProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { t: tr } = useI18n();

  const [open, setOpen] = useState<{ word: string; anchor: Anchor } | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [result, setResult] = useState("");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Guards against a slow earlier request landing after a newer tap.
  const reqId = useRef(0);

  const translateAt = useCallback(
    (rawWord: string, anchor: Anchor, context?: string) => {
      const word = cleanWord(rawWord);
      if (!word) return;
      const id = ++reqId.current;
      setOpen({ word, anchor });
      setStatus("loading");
      setResult("");
      setSize(null); // re-measure for the new word's width/height
      apiTranslate(word, context)
        .then((translation) => {
          if (id !== reqId.current) return;
          setResult(translation);
          setStatus(translation ? "done" : "error");
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setStatus("error");
        });
    },
    []
  );

  const dismiss = useCallback(() => {
    reqId.current++; // ignore any in-flight response
    setOpen(null);
  }, []);

  const onBubbleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (!size || Math.abs(size.w - width) > 0.5 || Math.abs(size.h - height) > 0.5) {
        setSize({ w: width, h: height });
      }
    },
    [size]
  );

  // Position the bubble centered over the touch point, above it when there's room, otherwise below.
  // Hidden (opacity 0) for the first frame until we've measured its real size, so it never flashes
  // at the wrong spot.
  let bubbleStyle: { left: number; top: number; opacity: number } = { left: MARGIN, top: MARGIN, opacity: 0 };
  if (open && size) {
    const screen = Dimensions.get("window");
    const left = clamp(open.anchor.x - size.w / 2, MARGIN, screen.width - size.w - MARGIN);
    const above = open.anchor.y - size.h - 16;
    const top = above > MARGIN ? above : open.anchor.y + 28;
    bubbleStyle = { left, top: clamp(top, MARGIN, screen.height - size.h - MARGIN), opacity: 1 };
  }

  return (
    <TranslationContext.Provider value={{ translateAt }}>
      {children}
      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={dismiss}>
        <Pressable style={styles.backdrop} onPress={dismiss} accessibilityRole="button">
          <View
            onLayout={onBubbleLayout}
            // Stop the press from bubbling to the backdrop so tapping the bubble itself doesn't dismiss.
            onStartShouldSetResponder={() => true}
            style={[
              styles.bubble,
              t.shadows.lg,
              {
                backgroundColor: t.c.surface,
                borderColor: t.c.line2,
                position: "absolute",
                left: bubbleStyle.left,
                top: bubbleStyle.top,
                opacity: bubbleStyle.opacity,
              },
            ]}
          >
            {open && (
              <>
                <Txt variant="mono" color={t.c.ink3} style={{ fontSize: 13 }}>
                  {open.word}
                </Txt>
                {status === "loading" ? (
                  <View style={styles.row}>
                    <ActivityIndicator size="small" color={t.c.accent} />
                    <Txt variant="body" color={t.c.ink2}>
                      {tr("ex.translating")}
                    </Txt>
                  </View>
                ) : status === "error" ? (
                  <Txt variant="body" color={t.c.ink3}>
                    {tr("ex.translateFail")}
                  </Txt>
                ) : (
                  <Txt variant="cardTitle" style={{ fontSize: 18, lineHeight: 24 }}>
                    {result}
                  </Txt>
                )}
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </TranslationContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  bubble: {
    maxWidth: 280,
    minWidth: 96,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
