import type { ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Animated, Image, StyleSheet } from "react-native";
import DojoScene from "../ui/DojoScene";
import DojoItemArtwork from "../ui/DojoItemArtwork";

let mockReduceMotion = false;
jest.mock("../../theme/theme", () => ({
  ...jest.requireActual("../../theme/theme"),
  useTheme: () => ({ reduceMotion: mockReduceMotion }),
}));

const LIGHTS = ["dojo_light_paper", "dojo_light_lantern", "dojo_light_sunset"];
const DISPLAYS = ["dojo_display_blank", "dojo_display_first_scroll", "dojo_display_wave"];
const PLANTS = ["dojo_plant_seedling", "dojo_plant_bamboo"];
const STARTERS = [LIGHTS[0], DISPLAYS[0], PLANTS[0]];
type UpdatingRenderer = ReactTestRenderer & { update(element: ReactElement): void };

function render(node: ReactElement): UpdatingRenderer {
  let screen!: UpdatingRenderer;
  act(() => { screen = TestRenderer.create(node) as UpdatingRenderer; });
  return screen;
}
function layout(screen: ReactTestRenderer, width = 360) {
  const scene = screen.root.findAll(node => node.props.testID === "dojo-scene" && typeof node.props.onLayout === "function")[0];
  act(() => scene.props.onLayout({ nativeEvent: { layout: { width, height: width * 0.75, x: 0, y: 0 } } }));
}
const artwork = (screen: ReactTestRenderer) => screen.root.findAll(node => node.type === DojoItemArtwork);
const selectedIds = (screen: ReactTestRenderer) => artwork(screen).map(node => node.props.itemId);
const imageStyle = (node: { props: { [key: string]: any } }) => StyleSheet.flatten(node.props.style);

beforeEach(() => { mockReduceMotion = false; });
afterEach(() => jest.restoreAllMocks());

test("room waits for layout and scales the painted room and collection together", () => {
  const screen = render(<DojoScene />);
  expect(screen.root.findAll(node => node.type === Image)).toHaveLength(0);
  layout(screen, 720);
  const images = screen.root.findAll(node => node.type === Image);
  expect(images).toHaveLength(4);
  expect(imageStyle(images[0])).toMatchObject({ width: 720, height: 540, top: -0 });
  expect(artwork(screen).map(node => node.props.size)).toEqual([248, 292, 216]);
  act(() => screen.update(<DojoScene compact />));
  expect(imageStyle(screen.root.findAll(node => node.type === Image)[0]).top).toBe(-56);
  const scene = screen.root.findAll(node => node.props.testID === "dojo-scene")[0];
  expect(imageStyle(scene).aspectRatio).toBe(1.8);
  act(() => screen.unmount());
});

test("all 18 known room combinations preserve all three correct native crops", () => {
  let combinations = 0;
  for (const [lightColumn, light] of LIGHTS.entries()) {
    for (const [displayColumn, display] of DISPLAYS.entries()) {
      for (const [plantColumn, plant] of PLANTS.entries()) {
        const screen = render(<DojoScene equipped={{ dojo_light: light, dojo_display: display, dojo_plant: plant }} />);
        layout(screen);
        expect(selectedIds(screen)).toEqual([light, display, plant]);
        const columns = [lightColumn, displayColumn, plantColumn];
        for (const [row, item] of artwork(screen).entries()) {
          const image = item.findAll(node => node.type === Image)[0];
          const size = item.props.size;
          expect(imageStyle(image)).toMatchObject({ width: size * 3, height: size * 3, left: -columns[row] * size, top: -row * size });
        }
        combinations += 1;
        act(() => screen.unmount());
      }
    }
  }
  expect(combinations).toBe(18);
});

test("the eight catalog objects use eight distinct frames with a transparent square viewport", () => {
  const frames = new Set<string>();
  for (const id of [...LIGHTS, ...DISPLAYS, ...PLANTS]) {
    const screen = render(<DojoItemArtwork itemId={id} size={64} />);
    const image = screen.root.findAll(node => node.type === Image)[0];
    expect(image).toBeDefined();
    const crop = imageStyle(image);
    frames.add(`${crop.left}:${crop.top}`);
    expect(crop).toMatchObject({ width: 192, height: 192 });
    expect(screen.root.findAll(node => imageStyle(node)?.overflow === "hidden").some(node => {
      const style = imageStyle(node);
      return style.width === 64 && style.height === 64 && !style.backgroundColor;
    })).toBe(true);
    act(() => screen.unmount());
  }
  expect(frames.size).toBe(8);
});

test("missing equipment, unknown IDs and misassigned objects retain the correct slot's starter", () => {
  const screen = render(<DojoScene />);
  layout(screen);
  expect(selectedIds(screen)).toEqual(STARTERS);
  const equipped = { dojo_light: LIGHTS[2], dojo_display: DISPLAYS[2], dojo_plant: PLANTS[1] };
  const slots = ["dojo_light", "dojo_display", "dojo_plant"] as const;
  const wrongSlotItems = [PLANTS[1], LIGHTS[2], DISPLAYS[2]];
  for (const [index, slot] of slots.entries()) {
    for (const invalid of ["retired-or-unknown-item", wrongSlotItems[index]]) {
      act(() => screen.update(<DojoScene equipped={{ ...equipped, [slot]: invalid }} />));
      const expected = [equipped.dojo_light, equipped.dojo_display, equipped.dojo_plant];
      expected[index] = STARTERS[index];
      expect(selectedIds(screen)).toEqual(expected);
      expect(artwork(screen).every(item => item.findAll(node => node.type === Image).length === 1)).toBe(true);
    }
  }
  act(() => screen.unmount());
});

test("Reduce Motion suppresses the equipment-change entrance while keeping every object visible", () => {
  const timing = jest.spyOn(Animated, "timing").mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
  const screen = render(<DojoScene />);
  layout(screen);
  expect(timing).not.toHaveBeenCalled();
  act(() => screen.update(<DojoScene equipped={{ dojo_light: LIGHTS[1] }} />));
  expect(timing).toHaveBeenCalledTimes(1);
  timing.mockClear();
  mockReduceMotion = true;
  act(() => screen.update(<DojoScene equipped={{ dojo_light: LIGHTS[2], dojo_plant: PLANTS[1] }} />));
  expect(timing).not.toHaveBeenCalled();
  expect(selectedIds(screen)).toEqual([LIGHTS[2], DISPLAYS[0], PLANTS[1]]);
  const objects = screen.root.findAll(node => node.type === Animated.View);
  expect(objects).toHaveLength(3);
  for (const object of objects) {
    const opacity = imageStyle(object).opacity as Animated.Value & { __getValue(): number };
    expect(opacity.__getValue()).toBe(1);
  }
  act(() => screen.unmount());
});
