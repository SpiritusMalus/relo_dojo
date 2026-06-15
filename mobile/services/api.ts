// API client for the Relo Dojo backend.
//
// The backend runs on the same machine (Mac) that serves the Expo bundle, on port 8000.
// To avoid hardcoding the Mac's LAN IP (it changes between networks), we derive it from the
// Expo dev host (the address Metro is served from) and just swap the port.
//
// Fallback IP is used if the host can't be detected (e.g. tunnel mode or a production build) —
// update it, or set EXPO_PUBLIC_API_URL, when needed.
import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import type { Progress } from "../store/progress";

const FALLBACK_HOST = "192.168.1.9";
const PORT = 8000;

function resolveBaseUrl(): string {
  // Explicit override always wins (handy for tunnel / staging / prod).
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override;

  // e.g. "192.168.1.9:8081" — the LAN IP Metro is served from.
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(":")[0];
  // Only use it if it looks like an IP/host, not a tunnel URL.
  if (host && /^[\d.]+$/.test(host)) {
    return `http://${host}:${PORT}`;
  }
  return `http://${FALLBACK_HOST}:${PORT}`;
}

export const BASE_URL = resolveBaseUrl();

// Bearer token for authenticated calls. Held in a module var and set by the auth store.
let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
}

// UI language ("ru" | "en"), set by the i18n store. Sent to LLM endpoints so explanations/feedback
// come back in the learner's language. Held in a module var so non-React callers (this file) can read it.
let apiLang: string = "ru";
export function setApiLang(lang: string): void {
  apiLang = lang;
}

type Method = "GET" | "POST" | "PUT";

// Error that carries the HTTP status + an optional machine-readable code so callers can route UI
// (e.g. 403 "starter_limit" → activation prompt; 403 "daily_limit" → limit sheet with the upsell).
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// Classify a failed load by gate type so every mode (Practice, Challenge, Story) routes the same
// way: "limit" = verified free tier hit the daily cap (→ LimitSheet upsell); "gated" = any other
// 403 (starter limit / unverified account → activation prompt); null = not a gate (real error).
export type GateKind = "limit" | "gated" | null;
export function gateKind(e: unknown): GateKind {
  if (!(e instanceof ApiError) || e.status !== 403) return null;
  return e.code === "daily_limit" ? "limit" : "gated";
}

// LLM calls (/explain) can be slow on a cold model, but never hang forever — fail clearly instead.
const REQUEST_TIMEOUT_MS = 90000;
// A mini-story generates 3 exercises in sequence (each may retry), so it needs more headroom.
const STORY_TIMEOUT_MS = 180000;

async function request<T>(
  path: string,
  body?: unknown,
  method: Method = "POST",
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("The server took too long to respond. Is the backend running?");
    }
    throw new Error("Can't reach the backend. Check it's running and on the same network.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Errors carry {detail: "..."} (string), {detail: {code, message, ...}} (structured gating),
    // or, for 422 validation, {detail: [{msg, ...}]}.
    let detail = `Backend error ${res.status}`;
    let code: string | undefined;
    try {
      const data = (await res.json()) as { detail?: unknown };
      const d = data?.detail;
      if (typeof d === "string") {
        detail = d;
      } else if (Array.isArray(d)) {
        detail = d.map((e) => (e && typeof e === "object" && "msg" in e ? (e as any).msg : String(e))).join("; ");
      } else if (d && typeof d === "object") {
        const obj = d as { code?: unknown; message?: unknown };
        if (typeof obj.message === "string") detail = obj.message;
        if (typeof obj.code === "string") code = obj.code;
      }
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(detail, res.status, code);
  }
  return (await res.json()) as T;
}

export type MatchItem = { id: number; text: string };

export type ExerciseType =
  | "multiple-choice"
  | "build-the-sentence"
  | "match-pairs"
  | "tap-the-error"
  | "odd-one-out"
  | "multiple-blanks"
  | "order-the-dialog"
  | "free-text";

export type Exercise = {
  type: ExerciseType;
  topic: string;
  level: string; // effective CEFR served (A1..C1); drives difficulty-aware scoring
  text: string;
  prompt: string; // source line for translation exercises (e.g. the Russian sentence)
  options: string[];
  tiles: string[];
  tokens: string[];
  left: MatchItem[];
  right: MatchItem[];
  blankOptions: string[][]; // multiple-blanks: choices per blank, left-to-right
  token: string | null; // sealed answer for interactive types; null for free-text
};

// The user's answer, shape depends on the exercise type:
//  - multiple-choice / build-the-sentence / odd-one-out / free-text: string
//  - tap-the-error: number (tapped index)
//  - match-pairs: { [leftId]: rightId }
//  - multiple-blanks: string[] (pick per blank); order-the-dialog: string[] (lines in chosen order)
export type ResponseValue = string | number | Record<string, number> | string[];

export type CheckResult = {
  correct: boolean;
  correct_answer: string;
  score?: number; // fraction right (0..1); partial credit for multi-element types
  detail?: string; // e.g. "2/3" for multi-element answers; "" otherwise
  coins_earned?: number; // koku earned for this answer (authenticated + correct only)
  coins?: number | null; // new server balance after the award; null/absent for anonymous
  first_win_bonus?: number; // portion of coins_earned that was the once-per-day first-win bonus
  combo_bonus?: number; // portion of coins_earned from the consecutive-correct combo
};
export type ExplainResult = { explanation: string; tip: string };
export type TextCheckResult = CheckResult & ExplainResult;

// Optional adaptive steering: topic / CEFR level / exercise type (all optional; backend falls back).
// `mistakes` = recent items the learner got wrong on this topic, to personalize generation.
export function getExercise(params?: {
  topic?: string;
  level?: string;
  type?: string;
  context?: string;
  mistakes?: string[];
}): Promise<Exercise> {
  return request<Exercise>("/exercise", params ?? {});
}

// A themed mini-story: a curated narrative wrapping a sequence of linked exercises.
export type StoryBeat = { narration: string; exercise: Exercise };
export type StorySet = {
  id: string;
  title: string;
  intro: string;
  level: string; // effective CEFR served across the set
  beats: StoryBeat[];
};

// Generate a mini-story. `level` locks CEFR across the set; `context` overrides scenario flavor;
// `id` selects a specific arc (premium arcs require an unlock → 403). Three exercises are generated
// server-side in sequence, so this needs a longer timeout.
export function getStory(params?: { level?: string; context?: string; id?: string }): Promise<StorySet> {
  return request<StorySet>("/story", params ?? {}, "POST", STORY_TIMEOUT_MS);
}

// --- story arcs / content unlocks (engagement v2 Phase 3) ---
export type StoryArc = {
  id: string;
  title: string;
  intro: string;
  locked: boolean;
  owned: boolean;
  price: number;
  featured: boolean;
};
export type StoryCatalog = { featured_id: string; arcs: StoryArc[] };

export function getStoryCatalog(): Promise<StoryCatalog> {
  return request<StoryCatalog>("/story/catalog", undefined, "GET");
}

// Unlock premium content (e.g., a story arc) with koku. Throws ApiError 409 (not enough) / 400.
export function buyContent(id: string): Promise<{ owned: string[]; coins: number }> {
  return request<{ owned: string[]; coins: number }>("/content/buy", { id });
}

// Goal intake: map a free-text goal / "what's hard for me" to canonical grammar topics.
// For authenticated callers the backend ALSO persists the goal into the learner profile
// (saved: true) — both onboarding and "change my goal" in settings flow through here.
export function analyzePain(text: string): Promise<{ topics: string[]; saved?: boolean }> {
  return request<{ topics: string[]; saved?: boolean }>("/profile/analyze", { text });
}

// --- "Review my text" (Stage 3): graded breakdown of the user's own real text ---
export type ReviewIssue = { quote: string; better: string; topic: string; note: string };
export type ReviewResult = { summary: string; issues: ReviewIssue[]; topics: string[] };

// Verified accounts only (403 otherwise — route via gateKind like /story). Notes come back in
// the UI language; findings also update the server-side weak-spot memory.
export function reviewText(text: string): Promise<ReviewResult> {
  return request<ReviewResult>("/review-text", { text, lang: apiLang });
}

// --- Stage 2 agents: Progress Agent (post-session) + Planner (trigger-based) ---
export type SessionAnswer = { topic: string; correct: boolean; level: string };
export type ProgressAgentResult = { weakSpots: string; wins: string };
export type PlanResult = { topicWeights: Record<string, number>; note: string; date: string; goal: string };
export type TopicStats = Record<string, { attempts: number; correct: number; skill: number }>;

// Post-session memory update (auth required; fire-and-forget from the summary screen).
export function postSessionSummary(answers: SessionAnswer[]): Promise<ProgressAgentResult> {
  return request<ProgressAgentResult>("/agent/progress", { answers, lang: apiLang });
}

// Build a fresh week plan (auth required; called when store/planner.ts says the plan is stale).
export function requestPlan(stats: TopicStats): Promise<PlanResult> {
  return request<PlanResult>("/agent/plan", { stats, lang: apiLang });
}

// --- learner profile (server-side memory layer: tone, goal, weak spots) ---
export type LearnerProfileData = {
  goal: string;
  goalTopics: string[];
  sphere: string;
  domains: string[];
  interests: string[];
  tone: string; // soft | balanced | strict
  weakSpots: string;
  goalHistory: { text: string; date: string; topics: string[] }[];
};

export function getLearnerProfile(): Promise<LearnerProfileData> {
  return request<LearnerProfileData>("/profile", undefined, "GET");
}

export function putLearnerProfile(p: LearnerProfileData): Promise<LearnerProfileData> {
  return request<LearnerProfileData>("/profile", p, "PUT");
}

// Merge a partial update into the server profile (fetch → patch → put). Best-effort:
// silently no-ops when logged out / offline — the local snapshot still syncs via /progress.
export async function syncLearnerProfile(patch: Partial<LearnerProfileData>): Promise<void> {
  if (!authToken) return;
  try {
    const current = await getLearnerProfile();
    await putLearnerProfile({ ...current, ...patch });
  } catch {
    // best-effort
  }
}

// Deterministic, instant grade for interactive exercises (no LLM).
export function checkInteractive(token: string, response: ResponseValue): Promise<CheckResult> {
  return request<CheckResult>("/check", { token, response });
}

// LLM grade for free-text answers (includes an explanation, in the learner's language).
export function checkFreeText(text: string, userAnswer: string): Promise<TextCheckResult> {
  return request<TextCheckResult>("/check-answer", { text, user_answer: userAnswer, lang: apiLang });
}

// On-demand teaching note for an interactive miss.
export function explain(
  text: string,
  correctAnswer: string,
  userResponse: string
): Promise<ExplainResult> {
  return request<ExplainResult>("/explain", {
    text,
    correct_answer: correctAnswer,
    user_response: userResponse,
    lang: apiLang,
  });
}

// Minimal reader shape (a ReadableStream<Uint8Array> default reader) so this is testable with a fake.
type Uint8StreamReader = { read(): Promise<{ done: boolean; value?: Uint8Array }> };

// Drain a plain-text byte stream, invoking `onText` with the FULL accumulated text on every chunk
// (so callers just render the latest string). Returns the final text. Throws on an empty stream or
// the backend's inline "[unavailable: …]" failure marker, so the caller can fall back to /explain.
// Exported for unit testing; the global TextDecoder exists on Hermes (RN) and Node (jest).
export async function consumeTextStream(
  reader: Uint8StreamReader,
  onText: (full: string) => void
): Promise<string> {
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) {
      full += decoder.decode(value, { stream: true });
      onText(full);
    }
  }
  full += decoder.decode(); // flush any trailing multi-byte sequence
  if (!full.trim()) throw new Error("Empty explanation stream");
  if (full.includes("[unavailable:")) throw new Error("Explanation unavailable");
  return full;
}

// Streaming variant of /explain: the teaching note arrives token-by-token (plain text) for perceived
// speed. Uses expo/fetch (SDK 54) which exposes a real ReadableStream body in RN. `onText` fires with
// the full text so far on every chunk. Returns the final text. Throws on transport/stream failure —
// useExerciseCheck catches it and falls back to the non-streaming explain().
export async function explainStream(
  text: string,
  correctAnswer: string,
  userResponse: string,
  onText: (full: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await expoFetch(`${BASE_URL}/explain/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text, correct_answer: correctAnswer, user_response: userResponse, lang: apiLang }),
    signal,
  });
  if (!res.ok) throw new ApiError(`Backend error ${res.status}`, res.status);
  const body = res.body;
  if (!body || typeof body.getReader !== "function") throw new Error("Streaming not supported");
  return consumeTextStream(body.getReader(), onText);
}

// --- accounts & progress sync (Phase 4) ---
export type AuthUser = {
  id: string;
  email: string;
  is_verified: boolean;
  is_premium?: boolean;
  coins?: number;
  freezes?: number;
  // Cosmetics (engagement v2): owned ids (incl. implicit starters) + equipped id per slot.
  cosmetics?: string[];
  equipped?: Record<string, string>;
  // Feature capability map (services/access.py). The client mirror in store/access.ts is the
  // fallback for anonymous/offline; when present this is the server-authoritative truth.
  access?: Record<string, boolean>;
};
type TokenResp = { access_token: string; token_type: string };

export function register(email: string, password: string): Promise<TokenResp> {
  return request<TokenResp>("/auth/register", { email, password });
}

export function login(email: string, password: string): Promise<TokenResp> {
  return request<TokenResp>("/auth/login", { email, password });
}

export function getMe(): Promise<AuthUser> {
  return request<AuthUser>("/auth/me", undefined, "GET");
}

// Resend the account-activation email to the logged-in user.
export function requestVerification(): Promise<{ message: string }> {
  return request<{ message: string }>("/auth/request-verification", {}, "POST");
}

// --- economy: koku wallet (server-authoritative) ---
// left_today: exercises remaining on the free tier today; null = unlimited (premium).
export type Wallet = { coins: number; freezes: number; is_premium: boolean; left_today?: number | null };
// Catalog item ids understood by POST /wallet/spend (must match backend services/wallet.py).
export type SpendItem =
  | "omamori"
  | "omamori_promo"
  | "use_freeze"
  | "extra_pack"
  | "extra_pack_promo"
  | "streak_repair";

export function getWallet(): Promise<Wallet> {
  return request<Wallet>("/wallet", undefined, "GET");
}

// Buy/consume a catalog item. Throws ApiError 409 when the balance is insufficient.
export function spendItem(item: SpendItem, qty = 1): Promise<Wallet> {
  return request<Wallet>("/wallet/spend", { item, qty });
}

// --- cosmetics (engagement v2): koku desire sink ---
// Server-authoritative ownership. owned = implicit starters + purchased; equipped = id per slot.
export type Cosmetics = { owned: string[]; equipped: Record<string, string> };

export function getCosmetics(): Promise<Cosmetics> {
  return request<Cosmetics>("/cosmetics", undefined, "GET");
}

// Buy a cosmetic with koku. Throws ApiError 409 (not enough koku) / 400 (unknown / not for sale).
export function buyCosmetic(id: string): Promise<Cosmetics> {
  return request<Cosmetics>("/cosmetics/buy", { id });
}

// Equip an owned cosmetic into its slot. Throws ApiError 409 (not owned) / 400 (unknown).
export function equipCosmetic(id: string): Promise<Cosmetics> {
  return request<Cosmetics>("/cosmetics/equip", { id });
}

// --- daily contracts (engagement v2, Phase 2): server-verified koku earning ---
export type Contract = {
  id: string;
  metric: string;
  target: number;
  reward: number;
  progress: number;
  done: boolean;
  claimed: boolean;
};
export type Contracts = { day: string; contracts: Contract[]; coins: number };
export type ContractClaim = { claimed: boolean; reward: number; coins: number };

export function getContracts(): Promise<Contracts> {
  return request<Contracts>("/contracts", undefined, "GET");
}

// Claim a completed contract's koku. Throws ApiError 409 if not completed.
export function claimContract(id: string): Promise<ContractClaim> {
  return request<ContractClaim>("/contracts/claim", { id });
}

// --- scroll rewards (variable reinforcement) ---
// One opened scroll: what dropped + post-credit balances. kind "kensei" = client-side x2-XP timer.
export type ScrollReward = { kind: "koku" | "omamori" | "kensei"; amount: number; coins: number; freezes: number };

// Open one end-of-session reward scroll (server-rolled; 403 "scroll_limit" past the daily cap).
export function openScroll(): Promise<ScrollReward> {
  return request<ScrollReward>("/rewards/scroll", {});
}

// --- rewarded ads (koku grant; server-authoritative, daily-capped) ---
export type AdReward = { amount: number; coins: number; left_today: number };

// Credit koku for a completed rewarded ad. Requires an account. 403 "ads_disabled" until the
// feature is enabled server-side (ADS_REWARDS_PER_DAY > 0); 403 "ads_limit" past the daily cap.
export function postAdReward(): Promise<AdReward> {
  return request<AdReward>("/ads/reward", {});
}

// --- analytics events (north-star Day-7 retention) ---
// Best-effort batch upload. Open to anonymous callers; the bearer token (if set) attributes the
// events to the account server-side. `anon_id` carries pre-login identity.
export type AnalyticsEventPayload = { name: string; props: Record<string, unknown>; ts: number };
export function postEvents(
  anonId: string | null,
  events: AnalyticsEventPayload[]
): Promise<{ accepted: number }> {
  return request<{ accepted: number }>("/events", { anon_id: anonId, events });
}

export function getProgress(): Promise<Progress> {
  return request<Progress>("/progress", undefined, "GET");
}

export function putProgress(p: Progress): Promise<Progress> {
  return request<Progress>("/progress", p, "PUT");
}
