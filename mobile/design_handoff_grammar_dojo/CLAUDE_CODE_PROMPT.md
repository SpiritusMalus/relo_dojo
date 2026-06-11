# Claude Code prompt — Grammar Dojo redesign

Paste the prompt below into Claude Code, run from the repo root (the folder that contains
`mobile/`). Keep `design_handoff_grammar_dojo/` committed in the repo so Claude can read it.

---

## ▶︎ COPY FROM HERE

You are implementing a visual redesign of our Expo / React Native app in `mobile/`.

**Source of truth:** `design_handoff_grammar_dojo/README.md`. Read it fully before writing code.
Visual targets are in `design_handoff_grammar_dojo/screenshots/` (01–06). The HTML/JSX in
`design_handoff_grammar_dojo/reference/` are design references — recreate them with React Native
primitives, do NOT copy the HTML/CSS verbatim and do NOT change any app logic, data, or routes.

**Scope:** presentation only. Reuse all existing state, navigation (expo-router), the adaptive
engine, and the stores in `mobile/store/`. Do not rename routes or change data models. If a screen
needs a derived value (e.g. current belt, "% to next belt", per-topic `weak` flag), derive it from
existing state — don't persist new data.

**Concept:** a friendly gamified "dojo" — a belt system (white→yellow→orange→green→blue→black)
mapped onto the existing CEFR levels (A1→C2), a mascot "sensei" whose headband is the current belt
colour, rounded cards, chunky 3D buttons, progress rings, streak flames, confetti on success.

**Ship these defaults:** Home layout = **Belt journey**; theme = **Light** (also implement Dark
using the dark tokens, switchable, but default Light); accent = **`#0E8A30`**; brand font = Zen
Maru Gothic, UI font = Hanken Grotesk, code font = JetBrains Mono; density = "cozy".
The "Your belt" hero block background MUST equal the user's current belt colour (gradient
`belt.color → belt.edge`, text in `belt.ink`). Ignore the prototype's Tweak panel and the two
alternate Home layouts (`ring`, `focus`) — Belt journey only.

**Dependencies (install if missing):** `expo-linear-gradient`, `react-native-svg`,
`react-native-reanimated`, `react-native-safe-area-context`, and the Google fonts
`@expo-google-fonts/zen-maru-gothic`, `@expo-google-fonts/hanken-grotesk`,
`@expo-google-fonts/jetbrains-mono` (or bundle the TTFs).

**Implement in this order; pause for my review after each step:**

1. **`mobile/theme/theme.ts`** — export `light` and `dark` token objects (colours, spacing, radii,
   shadows) using the resolved hex in the README, a `belts` array `{id,cefr,color,edge,knot,ink}`
   with helpers `beltByCefr()` / `beltByIndex()`, plus a `useTheme()` hook for light/dark. Add
   typography helpers (Brand / UIText / Mono or a `variant` prop) and load the three fonts.

2. **Shared components** (`mobile/components/ui/`): `Sensei` (SVG mascot, `belt` + `mood`
   happy|cheer|think|sad + `size`, headband = belt colour; idle bob optional), `BeltKnot`,
   `BeltTag`, `Ring` (SVG progress ring), `IconName` line icons, `Button` (primary chunky + ghost),
   `Chip`, `Card`, `ProgressBar`, `Confetti`. Path/SVG data is in `reference/dojo-core.jsx`.

3. **Home — Belt journey** → `mobile/app/(tabs)/index.tsx` (+ top bar with belt/CEFR, streak, XP;
   belt hero; "Daily mix" button; vertical path of topic nodes with done/current/next/locked/test
   states; "Browse all topics"). Wire node taps + Daily mix into the existing practice routes.

4. **Practice — Build the sentence** → re-skin `mobile/components/BuildSentence.tsx` and the
   `practice.tsx` shell: prompt card with mascot, dashed answer track with tappable mono tiles,
   word bank, sticky Check, and the inline correct/wrong result panel (confetti + "+XP" + 💡 note
   on correct; shake + correct answer + note on wrong). Then apply the same tokens to the other
   exercise components without changing their behaviour.

5. **Progress** → `mobile/app/(tabs)/progress.tsx` (belt showcase + belt rack, Level/XP, streak
   tiles, belts-by-topic, achievements grid, account list).

6. **Onboarding** → `mobile/app/onboarding.tsx` (7 steps incl. the belt-reveal with confetti),
   keeping the existing survey + level-seeding logic; map seeded CEFR → starting belt.

7. **Topics** → `mobile/app/topics.tsx`, **Login** → `mobile/app/login.tsx`, and the bottom tab
   bar restyle in `mobile/app/(tabs)/_layout.tsx`.

**Quality bar:** match the screenshots and the README's tokens/typography/spacing precisely.
Respect 44px min hit targets. Gate all animations behind a reduced-motion check. Verify it builds
and runs on iOS and Android before declaring a step done.

Start with step 1 and show me `theme.ts` for review.

## ◀︎ COPY TO HERE
