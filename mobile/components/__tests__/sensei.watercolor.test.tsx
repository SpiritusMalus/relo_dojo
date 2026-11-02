import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import type { ReactElement } from "react";
import { Animated, Image, StyleSheet, View } from "react-native";
import { Path } from "react-native-svg";
import Sensei, { type Mood } from "../ui/Sensei";
import { belts } from "../../theme/theme";
import { CATALOG, type SenseiVisual } from "../../store/cosmetics";

let mockReduceMotion = false;
let mockEquipped: SenseiVisual = {};
jest.mock("../../theme/theme", () => ({
  ...jest.requireActual("../../theme/theme"),
  useTheme: () => ({ reduceMotion: mockReduceMotion }),
}));
jest.mock("../../store/cosmeticsStore", () => ({ useEquippedSenseiVisual: () => mockEquipped }));
jest.mock("../../assets/sketch/sensei-atlas.png", () => ({ uri: "sensei-atlas" }));
jest.mock("../../assets/sketch/spring-sensei-atlas.png", () => ({ uri: "spring-sensei-atlas" }));

// The local lightweight renderer declaration omits update; keep the extra method scoped here.
type UpdatingRenderer = ReactTestRenderer & { update(element: ReactElement): void };
function render(props: React.ComponentProps<typeof Sensei> = {}) {
  let screen!: UpdatingRenderer;
  act(() => { screen = TestRenderer.create(<Sensei {...props} />) as UpdatingRenderer; });
  return screen;
}
const portrait = (screen: ReactTestRenderer) => screen.root.findAll(node => node.type === Image)[0];
const cropStyle = (screen: ReactTestRenderer) => StyleSheet.flatten(portrait(screen).props.style);

beforeEach(() => {
  mockReduceMotion = false;
  mockEquipped = {};
});
afterEach(() => jest.restoreAllMocks());

test("every catalog skin and feedback mood selects its own complete, equally sized portrait", () => {
  const skins = ["sensei_classic", "sensei_sage", "sensei_ronin", "sensei_sakura"];
  const moods: Mood[] = ["happy", "cheer", "think", "sad"];
  const selected = new Set<string>();
  for (const [column, id] of skins.entries()) {
    for (const [row, mood] of moods.entries()) {
      const screen = render({ visual: CATALOG[id].visual, mood, size: 44 });
      const crop = cropStyle(screen);
      if (id === "sensei_sakura") {
        expect(portrait(screen).props.source).toEqual({ uri: "spring-sensei-atlas" });
        expect(crop).toMatchObject({ width: 88, height: 88, left: -(row % 2) * 44, top: -Math.floor(row / 2) * 44 });
      } else {
        expect(portrait(screen).props.source).toEqual({ uri: "sensei-atlas" });
        expect(crop).toMatchObject({ width: 176, height: 176, left: -column * 44, top: -row * 44 });
      }
      const viewport = screen.root.findAll(node => node.type === View).find(node => StyleSheet.flatten(node.props.style)?.overflow === "hidden");
      expect(StyleSheet.flatten(viewport?.props.style)).toMatchObject({ width: 44, height: 44 });
      selected.add(`${portrait(screen).props.source.uri}:${crop.left}:${crop.top}`);
      act(() => screen.unmount());
    }
  }
  expect(selected.size).toBe(16);
});

test("a portrait without an earned-belt override stays neutral white", () => {
  const screen = render();
  const ribbon = screen.root.findAll(node => node.type === Path);
  expect(ribbon[0].props.fill).toBe(belts[0].color);
  act(() => screen.unmount());
});

test("an explicit Wardrobe preview overrides the equipped portrait, including Classic", () => {
  mockEquipped = CATALOG.sensei_ronin.visual;
  const screen = render({ size: 132 });
  expect(cropStyle(screen).left).toBe(-264);
  act(() => screen.update(<Sensei size={132} visual={CATALOG.sensei_sage.visual} />));
  expect(cropStyle(screen).left).toBe(-132);
  act(() => screen.update(<Sensei size={132} visual={{}} />));
  expect(cropStyle(screen).left).toBe(-0);
  act(() => screen.unmount());
});

test("a Classic preview clears the equipped spring sheet and closing it restores the current mood", () => {
  mockEquipped = CATALOG.sensei_sakura.visual;
  const screen = render({ size: 132 });
  expect(portrait(screen).props.source).toEqual({ uri: "spring-sensei-atlas" });
  expect(cropStyle(screen)).toMatchObject({ width: 264, height: 264, left: -0, top: -0 });
  act(() => screen.update(<Sensei size={132} visual={{}} mood="think" />));
  expect(portrait(screen).props.source).toEqual({ uri: "sensei-atlas" });
  expect(cropStyle(screen)).toMatchObject({ width: 528, height: 528, left: -0, top: -264 });
  act(() => screen.update(<Sensei size={132} mood="sad" />));
  expect(portrait(screen).props.source).toEqual({ uri: "spring-sensei-atlas" });
  expect(cropStyle(screen)).toMatchObject({ width: 264, height: 264, left: -132, top: -132 });
  act(() => screen.unmount());
});

test("belt progression remains visible on every portrait through its cloth, edge and fold", () => {
  const screen = render({ size: 180, visual: CATALOG.sensei_sakura.visual });
  for (const belt of belts) {
    act(() => screen.update(<Sensei size={180} belt={belt} visual={CATALOG.sensei_sakura.visual} />));
    const ribbon = screen.root.findAll(node => node.type === Path);
    expect(ribbon[0].props).toMatchObject({ fill: belt.color, stroke: belt.edge });
    expect(ribbon[1].props.fill).toBe(belt.knot);
    expect(cropStyle(screen)).toMatchObject({ width: 360, height: 360, left: -0, top: -0 });
  }
  act(() => screen.unmount());
});

test("Reduce Motion stops an active bob and returns the portrait to its resting position", () => {
  const start = jest.fn();
  const stop = jest.fn();
  const timings = jest.spyOn(Animated, "timing");
  const loop = jest.spyOn(Animated, "loop").mockReturnValue({ start, stop, reset: jest.fn() });
  const screen = render({ bob: true });
  expect(start).toHaveBeenCalledTimes(1);
  expect(timings).toHaveBeenCalledTimes(2);
  for (const [, config] of timings.mock.calls) expect(config.isInteraction).toBe(false);
  const value = screen.root.findAll(node => node.type === Animated.View)[0].props.style.transform[0].translateY as Animated.Value;
  act(() => value.setValue(-5));
  mockReduceMotion = true;
  act(() => screen.update(<Sensei bob />));
  expect(stop).toHaveBeenCalledTimes(1);
  expect((value as Animated.Value & { __getValue(): number }).__getValue()).toBe(0);
  expect(loop).toHaveBeenCalledTimes(1);
  act(() => screen.update(<Sensei bob={false} />));
  expect(loop).toHaveBeenCalledTimes(1);
  act(() => screen.unmount());
});
