import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import ContractsCard from "../ui/ContractsCard";
import Button from "../ui/Button";
import { claimContract, getContracts, type Contract, type Contracts, type ContractClaim } from "../../services/api";
import { trackContractClaimed } from "../../services/analytics";
import { setAccountToken } from "../../store/accountScope";

let mockToken: string | null = null;
const mockRefresh = jest.fn(async () => {});
jest.mock("../../services/api", () => ({ claimContract: jest.fn(), getContracts: jest.fn() }));
jest.mock("../../services/analytics", () => ({ trackContractClaimed: jest.fn() }));
jest.mock("../../store/auth", () => ({ useAuth: () => ({ token: mockToken }) }));
jest.mock("../../store/wallet", () => ({ useWallet: () => ({ refresh: mockRefresh }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, lang: "en" }) }));
jest.mock("expo-router", () => ({ useFocusEffect: jest.fn() }));
jest.mock("../../theme/theme", () => ({
  ...jest.requireActual("../../theme/theme"),
  useTheme: () => ({ ...jest.requireActual("../../theme/theme").makeTheme("light"), reduceMotion: true }),
}));

const token = (sub: string) => `header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature`;
const contract: Contract = { id: "a-private-contract", metric: "answers", target: 3, progress: 3, done: true, claimed: false, reward: 5 };
const contracts: Contracts = { day: "2026-11-01", contracts: [contract], coins: 30 };
const reward: ContractClaim = { claimed: true, reward: 5, coins: 35 };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
let screen: ReactTestRenderer | undefined;
async function render() {
  await act(async () => { screen = TestRenderer.create(<ContractsCard />); });
  return screen!;
}
function claimButton() {
  return screen!.root.findAll((node) => node.type === Button && node.props.label === "contract.claim")[0];
}
beforeEach(() => {
  jest.clearAllMocks();
  mockToken = token("a");
  setAccountToken(mockToken);
  jest.mocked(getContracts).mockResolvedValue(contracts);
  jest.mocked(claimContract).mockResolvedValue(reward);
  mockRefresh.mockResolvedValue();
});
afterEach(() => {
  if (screen) act(() => screen!.unmount());
  screen = undefined;
  setAccountToken(null);
});

it("current A can claim once, refresh its wallet, record its event and reload its contracts", async () => {
  await render();
  await act(async () => { await claimButton().props.onPress(); });
  expect(claimContract).toHaveBeenCalledTimes(1);
  expect(trackContractClaimed).toHaveBeenCalledWith({ id: contract.id, reward: 5 });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(getContracts).toHaveBeenCalledTimes(2);
});

it.each(["success", "failure"] as const)("A's late claim %s cannot emit B analytics, refresh B or start a B contracts reload", async (outcome) => {
  const old = deferred<ContractClaim>();
  jest.mocked(claimContract).mockReturnValueOnce(old.promise);
  await render();
  let pending!: Promise<void>;
  act(() => { pending = claimButton().props.onPress(); });
  setAccountToken(token("b"));
  await act(async () => {
    if (outcome === "success") old.resolve(reward);
    else old.reject(new Error("offline"));
    await pending;
  });
  expect(trackContractClaimed).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(getContracts).toHaveBeenCalledTimes(1);
});

it("a claim resolving after unmount has no local side effects", async () => {
  const old = deferred<ContractClaim>();
  jest.mocked(claimContract).mockReturnValueOnce(old.promise);
  await render();
  let pending!: Promise<void>;
  act(() => { pending = claimButton().props.onPress(); });
  act(() => screen!.unmount());
  screen = undefined;
  await act(async () => { old.resolve(reward); await pending; });
  expect(trackContractClaimed).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(getContracts).toHaveBeenCalledTimes(1);
});

it("an old A callback cannot start a claim using B's current bearer", async () => {
  await render();
  const press = claimButton().props.onPress;
  setAccountToken(token("b"));
  await act(async () => { await press(); });
  expect(claimContract).not.toHaveBeenCalled();
  expect(trackContractClaimed).not.toHaveBeenCalled();
});

it("a late A contract-list response stays hidden after account replacement", async () => {
  const old = deferred<Contracts>();
  jest.mocked(getContracts).mockReturnValueOnce(old.promise);
  await render();
  expect(screen!.toJSON()).toBeNull();
  setAccountToken(token("b"));
  await act(async () => { old.resolve(contracts); });
  expect(screen!.toJSON()).toBeNull();
});

it("does not load B contracts if the account changes while A's wallet refresh is pending", async () => {
  const old = deferred<void>();
  mockRefresh.mockReturnValueOnce(old.promise);
  await render();
  let pending!: Promise<void>;
  act(() => { pending = claimButton().props.onPress(); });
  await act(async () => { await Promise.resolve(); });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(trackContractClaimed).toHaveBeenCalledTimes(1); // Emitted while A was still current.
  setAccountToken(token("b"));
  await act(async () => { old.resolve(); await pending; });
  expect(getContracts).toHaveBeenCalledTimes(1);
});
