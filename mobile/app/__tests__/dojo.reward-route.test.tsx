import type { ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import DojoScreen from "../dojo";
import Button from "../../components/ui/Button";
import DojoScene from "../../components/ui/DojoScene";
import { ThemeProvider } from "../../theme/theme";
import { setAuthToken } from "../../services/api";
import { captureAccountScope } from "../../store/accountScope";
import type { DojoCatalogItem } from "../../services/dojo";

const mockPush = jest.fn();
const mockEquip = jest.fn(async () => {});
const mockBuy = jest.fn(async () => {});
const mockTarget = jest.fn(async () => {});
const mockRefresh = jest.fn(async () => {});
let mockParams: Record<string, string | string[]> = {};
let mockToken: string | null = null;
let mockRoom: any;
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(effect, [effect]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en" }) }));
jest.mock("../../store/auth", () => ({ useAuth: () => ({ token: mockToken }) }));
jest.mock("../../store/wallet", () => ({ useWallet: () => ({ ready: true, coins: 20 }) }));
jest.mock("../../store/dojoRoom", () => ({ useDojoRoom: () => mockRoom }));
jest.mock("../../components/ui/DojoScene", () => ({ __esModule: true, default: jest.fn(() => null) }));
jest.mock("../../components/ui/DojoItemArtwork", () => () => null);

const reward = "dojo_display_introduction";
const other = "dojo_display_experience";
const catalog: DojoCatalogItem[] = [
  { id: "dojo_display_blank", slot: "dojo_display", gate: "starter", price: 0 },
  { id: reward, slot: "dojo_display", gate: "achievement", price: 0, chapter_id: "introduction" },
  { id: other, slot: "dojo_display", gate: "achievement", price: 0, chapter_id: "experience" },
];
const member = (id: string) => `header.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.signature`;
type UpdatingRenderer = ReactTestRenderer & { update(element: ReactElement): void };
let renderer: UpdatingRenderer | undefined;
const node = () => <ThemeProvider><DojoScreen /></ThemeProvider>;
async function mount() { await act(async () => { renderer = TestRenderer.create(node()) as UpdatingRenderer; }); }
async function rerender() { await act(async () => { renderer!.update(node()); }); }
const scenes = () => renderer!.root.findAll((item) => item.type === DojoScene);
const button = (label: string) => renderer!.root.findAll((item) => item.type === Button).find((item) => item.props.label === label);
const mutations = () => expect([mockEquip.mock.calls, mockBuy.mock.calls, mockTarget.mock.calls]).toEqual([[], [], []]);

beforeEach(() => {
  jest.clearAllMocks();
  mockToken = member("a"); setAuthToken(mockToken);
  mockParams = { reward, epoch: String(captureAccountScope().epoch) };
  mockRoom = {
    catalog, owned: [reward, other], equipped: { dojo_display: "dojo_display_blank" },
    snapshot: { selected_target: null, receipts: [] }, nextMilestone: null, practiceDays: 1,
    ready: true, busy: null, loading: false, source: "server", error: null,
    equip: mockEquip, buy: mockBuy, selectTarget: mockTarget, refresh: mockRefresh,
  };
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount()); renderer = undefined;
  mockToken = null; setAuthToken(null);
});

it("previews the earned completion item without equipping until Place, then shows confirmed Placed", async () => {
  await mount();
  expect(scenes()).toHaveLength(1); // The reward uses the main scene, not a second lower preview.
  expect(scenes()[0].props.equipped.dojo_display).toBe(reward);
  expect(button("Place")?.props.disabled).toBe(false);
  mutations();
  await act(async () => { await button("Place")!.props.onPress(); });
  expect(mockEquip).toHaveBeenCalledTimes(1); expect(mockEquip).toHaveBeenCalledWith(reward);
  expect(mockBuy).not.toHaveBeenCalled(); expect(mockTarget).not.toHaveBeenCalled();
  mockRoom = { ...mockRoom, equipped: { dojo_display: reward } }; await rerender();
  expect(button("Placed")?.props.disabled).toBe(true);
  expect(button("Place")).toBeUndefined();
});

it("waits for the matching catalog and owned snapshot instead of dropping or prematurely applying a reward link", async () => {
  mockRoom = { ...mockRoom, catalog: [], owned: [], snapshot: null, loading: true, ready: false };
  await mount(); expect(scenes()[0].props.equipped.dojo_display).toBe("dojo_display_blank"); mutations();
  mockRoom = { ...mockRoom, catalog, loading: false }; await rerender();
  expect(scenes()[0].props.equipped.dojo_display).toBe("dojo_display_blank"); mutations();
  mockRoom = { ...mockRoom, owned: [reward], ready: true, snapshot: { selected_target: null, receipts: [] } }; await rerender();
  expect(scenes()[0].props.equipped.dojo_display).toBe(reward); expect(button("Place")).toBeDefined(); mutations();
});

it.each(["unknown-item", other, [reward, other]])("ignores unknown, unowned or ambiguous reward parameters: %s", async (requested) => {
  mockParams = { ...mockParams, reward: requested };
  mockRoom = { ...mockRoom, owned: [reward] }; await mount();
  expect(scenes()[0].props.equipped.dojo_display).toBe("dojo_display_blank");
  expect(button("Place")).toBeUndefined(); mutations();
});

it("does not carry A's reward preview or an old Place callback into B, even if B owns the same item", async () => {
  await mount(); const oldPlace = button("Place")!.props.onPress;
  await act(async () => { mockToken = member("b"); setAuthToken(mockToken); });
  expect(scenes()[0].props.equipped.dojo_display).toBe("dojo_display_blank");
  expect(button("Place")).toBeUndefined();
  await act(async () => { await oldPlace(); }); mutations();
});

it("allows a manual collection choice to replace the completion preview", async () => {
  await mount();
  const choice = renderer!.root.findAll((item) => item.props.accessibilityLabel === "The path" && typeof item.props.onPress === "function")[0];
  act(() => choice.props.onPress());
  expect(scenes()[0].props.equipped.dojo_display).toBe(other);
  await act(async () => { await button("Place")!.props.onPress(); });
  expect(mockEquip).toHaveBeenCalledWith(other);
});

it("retains the preview offline with a disabled mutation and clear cached-state recovery", async () => {
  mockRoom = { ...mockRoom, source: "cache", ready: false };
  await mount();
  expect(scenes()[0].props.equipped.dojo_display).toBe(reward);
  expect(button("Place")?.props.disabled).toBe(true);
  expect(JSON.stringify(renderer!.toJSON())).toContain("Showing your saved dojo. Connect to make changes.");
  expect(button("Try again")).toBeDefined(); mutations();
});
