# Handoff: Grammar Dojo — Visual Redesign (Belts + Mascot, gamified)

## Overview
This is a full visual redesign of **Grammar Dojo**, the existing Expo / React Native app
that teaches English grammar to developers through short daily adaptive exercises.

The redesign keeps **all existing functionality and data models** (XP, levels, streaks,
per-topic CEFR levels, adaptive engine, onboarding survey, achievements) and re-skins the
app around a friendly, gamified **dojo / martial-arts belt** concept:

- A **belt system (white → yellow → orange → green → blue → black)** mapped on top of the
  existing CEFR levels (A1 → C2).
- A friendly **mascot "sensei"** whose headband takes the colour of the user's current belt.
- A warmer, rounded, "Duolingo-friendly" visual language: rounded cards, chunky 3D buttons,
  progress rings, confetti on success, streak flames.
- **Light + dark** themes.

The chosen primary screens/decisions for this build:
- **Home layout = "Belt journey"** (a vertical path of grammar nodes leading to a belt test).
- **Accent colour = Dojo green `#0E8A30`** (the project's existing brand green, refined).
- **Default theme = Light.**

> The prototype also contains two alternative Home layouts (`ring`, `focus`) and Tweak toggles
> (theme / accent / font / density / device). Those are exploration aids — for production,
> ship **Belt journey + green + light** as the default. The other Home variants and tweaks are
> optional and can be dropped.

---

## About the Design Files
The files in `reference/` are **design references authored in HTML/React-DOM** — interactive
prototypes that show the intended look, layout, copy, and behaviour. **They are not production
code to copy directly.**

Your task is to **recreate these designs inside the existing Expo / React Native codebase**
(`mobile/`), using its established patterns:
- Screens live in `mobile/app/` (expo-router): `(tabs)/index.tsx`, `(tabs)/progress.tsx`,
  `practice.tsx`, `onboarding.tsx`, `topics.tsx`, `login.tsx`, plus `(tabs)/_layout.tsx`.
- Exercise components live in `mobile/components/` (`BuildSentence.tsx`, `MultipleChoice.tsx`, …).
- State lives in `mobile/store/` (`progress.tsx`, `adaptive.ts`, `onboarding.ts`).

Re-implement the visuals with React Native primitives (`View`, `Text`, `Pressable`,
`StyleSheet`) — **not** the HTML/CSS verbatim. See **"React Native implementation notes"** below
for the mapping (CSS → RN equivalents, SVG, gradients, fonts, animations).

The HTML reference (`reference/Grammar Dojo.html`) can be opened in any browser to click through
the full flow. The per-screen `.jsx` files are organised so each maps to a screen/component in
the RN app (see **Files**).

---

## Fidelity
**High-fidelity (hifi).** Colours, typography, spacing, radii, copy, and interactions are final.
Recreate the UI to match. Where a value isn't specified, derive it from the **Design Tokens**
section, which is the single source of truth (the HTML uses CSS `color-mix()`/variables; this
README lists the resolved hex values so you don't need to compute them).

---

## Design Tokens

### Brand / accent (light)
| Token | Hex | Use |
|---|---|---|
| `accent` | `#0E8A30` | Primary green — buttons, active states, progress fills |
| `accentPress` | `#0B6E26` | Pressed button face / bottom "3D" edge |
| `accentInk` | `#FFFFFF` | Text/icons on accent |
| `accentSoft` | `#E0F0E4` | Tinted backgrounds (active tab pill, soft chips, success panel) |
| `accentSoft2` | `#C0E1C9` | Slightly stronger tint (rings, borders on current node) |

### Accent (dark theme overrides)
| Token | Hex |
|---|---|
| `accentInk` | `#06140B` |
| `accentSoft` | `#0D2B16` |
| `accentSoft2` | `#0D3E1B` |
(`accent` and `accentPress` stay the same in dark.)

### Semantic
| Token | Hex (light) | Hex (dark) | Use |
|---|---|---|---|
| `fire` | `#F0801F` | `#F0801F` | Streak flame, "best run" |
| `fireSoft` | `#FDECDD` | `#2C1D10` | Streak badge background |
| `gold` | `#E3A52C` | `#E3A52C` | XP, level bar |
| `bad` | `#D8493A` | `#D8493A` | Wrong answers, "focus"/weak topic |
| `badSoft` | `#FCEAE7` | `#2E1714` | Wrong-answer panel bg |

### Neutrals (light)
| Token | Hex | Use |
|---|---|---|
| `bg` | `#EEF2EE` | App backdrop (behind device) |
| `screen` | `#FBFDFB` | Screen canvas |
| `surface` | `#FFFFFF` | Cards, inputs |
| `surface2` | `#F2F7F3` | Secondary surfaces, prompt blocks |
| `surface3` | `#EAF1EC` | Tracks, disabled fills, code chips |
| `ink` | `#15201A` | Primary text |
| `ink2` | `#586A60` | Secondary text |
| `ink3` | `#8A988F` | Tertiary / captions / placeholders |
| `line` | `#E7EDE8` | Hairline borders |
| `line2` | `#DDE6E0` | Stronger borders, button edges |

### Neutrals (dark)
| Token | Hex |
|---|---|
| `bg` | `#080B09` |
| `screen` | `#0D130F` |
| `surface` | `#141C16` |
| `surface2` | `#1A241D` |
| `surface3` | `#212D24` |
| `ink` | `#E9F1EB` |
| `ink2` | `#9AAB9F` |
| `ink3` | `#6C7D71` |
| `line` | `#243029` |
| `line2` | `#2C3A31` |

### Spacing & shape (default "cozy" density)
| Token | Value |
|---|---|
| `pad` (screen/card padding) | `20` |
| `gap` (list gaps) | `14` |
| `radius` (cards) | `20` |
| `radiusSm` (buttons, chips inner) | `12` |
| `radiusLg` (hero blocks) | `28` |
| pill radius | `999` |

(Compact density = pad15/gap10/r14/rlg20; Comfy = pad24/gap18/r26/rlg34. Optional — ship "cozy".)

### Shadows (light)
- `sm`: y1 blur2 rgba(20,40,28,.06) + y2 blur6 rgba(20,40,28,.05)
- `md`: y6 blur16 rgba(20,40,28,.08)
- `lg`: y18 blur40 rgba(20,40,28,.14)
- Primary button uses a **solid offset edge** (not a blur): a `#0B6E26` block 4px below the
  face; on press the face moves down 3px and the edge shrinks to 1px (chunky "3D" feel).

In dark theme shadows are `rgba(0,0,0,.4–.55)`.

### Typography
Three families (load via `expo-font` / `@expo-google-fonts`):
| Role | Family | Weights | Notes |
|---|---|---|---|
| Brand / headings | **Zen Maru Gothic** | 500, 700 | Rounded, subtle Japanese character. `lineHeight ≈ 1.2× fontSize`. Used for titles, screen headers, mascot speech, belt names. Apply via a `brand` text style. |
| UI / body | **Hanken Grotesk** | 400, 500, 600, 700, 800 | Default text everywhere. |
| Code | **JetBrains Mono** | 400, 600 | Exercise word tiles, inline code chips (`in / on / at`), dev-flavoured answers. |

Type scale actually used (px):
- Hero title 30–34/700 brand; screen title 24–27/700 brand; card title 16–19/700 brand
- Body 14–15/500–600; secondary 13–13.5; caption 11–12.5/700; label 12/800 uppercase, letterSpacing ~0.09em
- Minimum interactive hit target: **44px**.

---

## The Belt System (core concept)

Belts map 1:1 onto CEFR levels. Store the CEFR value as today; **derive the belt for display.**

| Belt | CEFR | `color` (cloth) | `edge` (border/shadow) | `knot` (folds) | `ink` (text on belt) |
|---|---|---|---|---|---|
| White | A1 | `#E9EBE6` | `#CDD3CB` | `#B7BFB4` | `#3A443C` |
| Yellow | A2 | `#F6C945` | `#D8A82A` | `#C79C22` | `#5A4708` |
| Orange | B1 | `#EF8A36` | `#CF6F22` | `#BB6420` | `#5E2C08` |
| Green | B2 | `#39A85C` | `#2C8748` | `#247A3E` | `#0C3A1D` |
| Blue | C1 | `#3F86C9` | `#2F6AA6` | `#295F93` | `#0C2F4D` |
| Black | C2 | `#2B3037` | `#14171B` | `#0B0D10` | `#E7EBEF` |

**Important:** the belt green `#39A85C` is **not** the same as the accent green `#0E8A30`.
Accent = UI/brand actions. Belt green = the B2 belt swatch. Keep them distinct.

Helper to implement: `beltByCefr(cefr) -> belt` and `beltByIndex(i) -> belt`.

### "Your belt" hero colouring (explicit requirement)
The Home belt-hero block background **must be the colour of the user's current belt** — a linear
gradient `150deg from belt.color → belt.edge`, with all text/progress drawn in `belt.ink`.
So a green-belt user sees a green hero, a yellow-belt user a yellow hero, etc. The mascot's
headband and the small belt-knot icons follow the same `belt.color`/`belt.edge`/`belt.knot`.

---

## The Mascot ("Sensei")
A friendly, geometric SVG character (not an illustration asset) — implement with
`react-native-svg`. Reference: `Sensei` in `reference/dojo-core.jsx` (full SVG path data there).

- ~100×100 viewBox, scalable via a `size` prop.
- A round skin-tone head (`#F4D9B8`, edge `#E7C39A`), dark hair (`#2B2B30`) with a top-knot,
  and a **headband in the current belt colour** with a knot + two tails on the right side.
- Four moods (swap eyes + mouth): `happy` (default), `cheer` (open smile, used on success/path
  current node), `think` (used on wrong answer / coach prompt), `sad`.
- Optional gentle idle bob animation (`translateY 0 → -5 → 0`, ~3.2s loop). Respect
  `prefers-reduced-motion` / a "reduce motion" setting.

Also implement `BeltKnot` (a folded-belt icon, used in lists/tab/top bar) and `BeltTag`
(swatch + "Green belt · B2" pill).

---

## Screens / Views

Coordinates below are described relative to a ~390–402px-wide phone screen. All screens sit on
`screen` background, with top/bottom safe-area insets respected (status bar / home indicator).

### 1. Login  (`mobile/app/login.tsx`)
- **Purpose:** sign in / sign up entry.
- **Layout:** vertically centred hero (mascot `cheer` ~120px, brand title "Grammar Dojo" 34/700,
  subtitle 15/`ink2` max-width ~280, centred). Bottom block: Email + Password fields, primary
  button "ENTER THE DOJO" (uppercase, full-width, chunky), an "OR" divider, two ghost buttons
  (GitHub / Google) side by side with `gap:10`, and a "New here? Create an account" line.
- **Field style:** `surface` bg, 2px `line2` border, radius `radiusSm` (12), 14–15px text,
  border turns `accent` on focus. Label above in 12/800 uppercase `ink3`.

### 2. Onboarding  (`mobile/app/onboarding.tsx`)  — preserves existing survey + seeding logic
A 7-step wizard with a top progress bar (filled `accent`), a Back chevron (hidden on step 0),
and a Skip affordance. Sticky bottom primary button whose label changes per step.
Steps (keep wired to `store/onboarding.ts` seeding):
0. **Welcome** — mascot `happy` ~110px + "Let's tune your dojo" 26/700 brand + subtitle.
1. **Goals** (multi-select chips): Read docs & code reviews / Write better PRs / Pass tech
   interviews / Talk with my team / Conference talks.
2. **Hard topics** (multi-select chips): Prepositions / Conditionals / Verb tenses / Articles /
   Modal verbs / Phrasal verbs / Word order.
3. **Self-rated level** (3 cards): Beginner / Intermediate / Advanced.
4. **Daily time** (chips): 5 / 10 / 15 / 30 / 60 min.
5. **Calibration** — a real sample MCQ ("The CI pipeline depends `___` the test stage" →
   on/of/from/to) styled as selectable cards. (Hook to the existing adaptive calibration.)
6. **Belt reveal** — confetti + a big `BeltKnot` (pop-in animation) + "White/Yellow… belt",
   "CEFR Ax · keeps adjusting", and a summary card (Difficulty / Hard topics / Daily goal).
   Map seeded level → starting belt via `beltByCefr`.

**Chip style:** pill, 2px `line2` border, `surface` bg; selected = `accent` border, `accentSoft`
bg, `accent` text.

### 3. Home — "Belt journey"  (`mobile/app/(tabs)/index.tsx`)  ← PRIMARY
Top bar (all tabbed screens): left = `BeltKnot` + CEFR label (tap → Belt picker sheet);
right = streak badge (🔥 + count, `fire` on `fireSoft`) + XP badge (✦ + number, `gold`).

Body, top → bottom:
1. **Belt hero** (radius `radiusLg` 28) — background = current belt gradient (`belt.color` →
   `belt.edge`), text in `belt.ink`. Content: "YOUR BELT" label, belt name 30/700 brand,
   "CEFR B2 · 64% to Blue belt", and a progress bar (track `rgba(0,0,0,.16)`, fill `belt.ink`).
   A mascot peeks from the top-right corner.
2. **Daily mix** button (full-width, chunky `accent`, radius `radius`) — lightning icon tile,
   "Daily mix" / "Adaptive — across all your topics", chevron. → starts adaptive practice.
3. **"Today's path"** header row + "2 of 6 done".
4. **The path** — a vertical rail of nodes (each = a grammar topic), connected by a 3px line
   (filled `accent` for completed segments, `line2` otherwise). Each node = a 44px circle on the
   rail + a tappable card:
   - `done`: green circle w/ check; card shows "Mastered · <Belt> belt" + topic accuracy %.
   - `current`: green circle w/ bolt, 3px `accentSoft2` ring + 3D edge; card border `accent`,
     "Continue →", mascot `cheer` on the right. → resumes practice.
   - `next`: grey circle w/ bolt; "Up next · tap to start", chevron. → starts that topic.
   - `locked`: grey circle w/ lock; dimmed (opacity .6), not tappable.
   - `test` (last node): belt-knot icon in `belt.knot` circle; "Belt test — Earn your next belt".
   Each non-test node shows a small topic-belt swatch (`tb.color`/`tb.edge`) at the card's left.
5. **"Browse all topics"** ghost button → Topics screen.

Node→topic mapping uses the topic list in **State / Data** below; tapping routes to Practice
filtered to that topic (current/test → adaptive/test session).

### 4. Topics  (`mobile/app/topics.tsx`)
Back header "Topics". A featured **Daily mix** button (as on Home), then "ALL GRAMMAR TOPICS"
label and a list of topic cards: `BeltKnot` (topic's belt) + name (brand 16/700) + hint as a
code chip + a thin accuracy bar (`bad` colour if weak, else `accent`) + right-side CEFR + acc%.
Tap → Practice for that topic.

### 5. Practice — "Build the sentence"  (`mobile/components/BuildSentence.tsx` + `app/practice.tsx`)
The hero exercise type (RU → EN sentence assembly). Other existing exercise types
(MultipleChoice, MatchPairs, TapError, MultipleBlanks, OrderDialog) should be re-skinned with the
same tokens but are not redesigned screen-by-screen here.

Layout:
- **Header:** close (✕) button, a session progress bar (filled `accent`, e.g. step/10), streak 🔥.
- **Prompt card:** small mascot (mood reflects state) + "TRANSLATE TO ENGLISH" label + the RU
  sentence (brand 21/700) + a mute/listen icon.
- **Answer track:** a min-96px dashed-border drop area (`surface2` bg, `line2` dashed). Tapped
  word tiles appear here (mono font tiles, `surface` bg, pop-in). Tapping a placed tile removes it.
  Empty state shows "Tap the words below to build it…".
- **Word bank:** remaining shuffled tiles (mono, `surface`, 2px edge shadow).
- **Sticky bottom:** "CHECK" primary button, disabled until all tiles placed.

**Result (inline reveal, same screen):**
- On **correct:** answer track + tiles turn green (`accent`/`accentSoft`), **confetti** bursts,
  a success panel rises: green check, "Clean strike!", "+12 XP", and a 💡 explanation note, plus
  "🔥 N correct in a row!". Bottom button becomes "NEXT EXERCISE".
- On **wrong:** track shakes (horizontal shake anim), turns `bad`/`badSoft`, panel shows ✕,
  "Not quite", the correct answer in mono, and the 💡 grammar note. Bottom → "NEXT EXERCISE".

Sample content (5 dev-flavoured items) is in `reference/dojo-core.jsx` → `BUILD` (RU prompt,
shuffled tiles, correct answer, explanation, topic, CEFR). Use your real exercise data; this
shows tone (e.g. "The server returned a 500 error", "You should review this pull request").

### 6. Progress  (`mobile/app/(tabs)/progress.tsx`)
- **Belt showcase card:** mascot, current belt name + "Overall level · CEFR B2", and a **belt
  rack** — all six belts as bars (earned = full colour, current = taller with 3D edge, locked =
  greyed), CEFR label under each.
- **Level + XP card:** "Level 9", XP total in `gold`, a gold progress bar, "N XP to level 10".
- **Two stat tiles:** 🔥 day streak, ⚡ best run.
- **"Belts by topic"** list: per topic a swatch + name (red if weak/"focus") + thin accuracy bar
  + CEFR + acc%.
- **Achievements** grid (2-col): earned = colour glyph on `accentSoft`; locked = 🔒 greyed, with
  an optional progress bar toward unlock. Sample set in `reference/dojo-core.jsx` → `ACHIEVEMENTS`.
- **Account** list: email (muted), "Redo onboarding" (→ onboarding), "Log out" (`bad`).

### Belt picker sheet (overlay, from top-bar belt tap)
A bottom sheet (`surface`, top radius 26, slide-up) listing all six belts (knot + name + CEFR);
current is highlighted with `accent` border + check. In the prototype it previews a belt's theme;
in production this is the natural place to **show belt progression / requirements** (read-only is
fine for v1).

### Bottom tab bar
Three tabs: **Home**, **Train** (Practice/Topics), **Progress**. Active = `accent` icon+label
with an `accentSoft` rounded highlight behind the icon; inactive = `ink3`. Matches existing
`(tabs)/_layout.tsx` — just restyle.

---

## Interactions & Behavior
- **Navigation:** unchanged from current app (expo-router). Home nodes / Daily mix / Topics cards
  route into Practice; Practice ✕ returns; onboarding completes → tabs.
- **Buttons:** chunky press — primary buttons translate down 3px and their bottom edge shrinks
  4px→1px on `pressed`. Use `Pressable` with a pressed style.
- **Tile place/remove:** immediate, with a small pop-in (scale .6→1.08→1, ~0.42s) on place.
- **Correct answer:** confetti (≈26 small coloured rects falling/rotating ~1.1–2s), success panel
  fade/slide-up, tiles recolour green.
- **Wrong answer:** horizontal shake (~0.45s) on the answer track.
- **Progress ring / bars:** animate fill on mount (ring stroke ~0.9s ease-out; bars ~0.5s).
- **Mascot:** idle bob loop; mood changes by context.
- **Reduced motion:** disable confetti/bob/shake/pop and just show end states. (The CSS gates all
  of these behind `prefers-reduced-motion`; mirror with a setting or `AccessibilityInfo`.)

## State Management
Reuse the existing stores — the redesign is presentational. Map as follows:
- `store/progress.tsx` — XP, level, streak ("best run"), per-topic CEFR + accuracy + attempts,
  achievements. The redesign needs, per topic: `label`, `hint`, `cefr`, `accuracy%`, `attempts`,
  `done`, and a `weak` flag (lowest-accuracy topics) to drive "focus"/red styling and the path
  node states (`done`/`current`/`next`/`locked`).
- `store/adaptive.ts` — chooses next exercises for "Daily mix" and per-topic sessions; also the
  onboarding calibration.
- `store/onboarding.ts` — survey answers → seeded level; the **belt reveal** derives the starting
  belt from the seeded CEFR (`beltByCefr`).
- New (derive, don't store): `belt = beltByCefr(overallCefr)`; "% to next belt" from XP/level.

Topic list used by the prototype (replace with real data; this defines the fields):
`{ id, label, hint, cefr, acc, attempts, done, weak? }` — e.g. Prepositions/`in · on · at`/B1/74%,
Conditionals/`if … then …`/A2/58%/weak, Verb tenses/B2/81%, Articles/`a · an · the`/B1/69%,
Modal verbs/A2/63%, Phrasal verbs/A2/47%/weak, Gerunds & infinitives/B2/78%, Word order/C1/88%.

---

## React Native implementation notes (CSS → RN)
- **No CSS** — translate the reference styles to `StyleSheet`. Centralise tokens in a
  `theme.ts` (export `light`/`dark` objects + `belts` + `spacing`), and a `useTheme()` hook
  for light/dark. The reference `theme.css` is the spec; this README lists resolved hex so you
  don't need `color-mix`.
- **Fonts:** `@expo-google-fonts/zen-maru-gothic`, `@expo-google-fonts/hanken-grotesk`,
  `@expo-google-fonts/jetbrains-mono` (or bundle the TTFs); load with `useFonts`. Make a `<Brand>`
  / `<UIText>` / `<Mono>` text wrapper or a `variant` prop.
- **Gradients:** `expo-linear-gradient` for the belt hero (`belt.color`→`belt.edge`, 150°).
- **SVG:** `react-native-svg` for `Sensei`, `BeltKnot`, the progress `Ring` (two `<Circle>` with
  `strokeDasharray`/`strokeDashoffset`), and the small line icons (`home/practice/chart/check/x/
  chevron/bolt/lock/target/sound/...`). Path data is in `reference/dojo-core.jsx`.
- **Chunky button edge:** emulate the CSS `box-shadow: 0 4px 0` with a darker `borderBottomWidth`/
  `borderBottomColor` (`accentPress`) or an absolutely-positioned offset layer; on `pressed`
  reduce it and translate the content down.
- **Animations:** `react-native-reanimated` (or `Animated`) for ring/bar fills, tile pop, shake,
  mascot bob. Confetti: a handful of absolutely-positioned animated `View`s, or
  `react-native-confetti-cannon`.
- **Lists:** the path and topic lists are short and fixed-height per item — `View`/`map` or
  `FlatList`; never nest a `height:100%`+scroll inside a card.
- **Shadows:** iOS `shadowColor/opacity/radius/offset`; Android `elevation`. Use the `sm/md/lg`
  values above.
- **Safe areas:** `react-native-safe-area-context` (the prototype fakes status-bar/home-indicator
  insets of ~50/22 on iOS, ~30/26 on Android).

---

## Assets
No external image assets. Everything is vector (SVG) or text:
- Mascot, belt knots, progress ring, UI icons → SVG (path data in `reference/dojo-core.jsx`).
- Streak/achievement glyphs use **emoji** (🔥 ⚡ ✦ 💯 🌙 📅 🏆 🥋 🟢 💡) — matches the existing app's
  vocabulary; keep as text, or swap for SVG if you prefer cross-platform consistency.
- Fonts: Zen Maru Gothic, Hanken Grotesk, JetBrains Mono (Google Fonts, OFL).

---

## Screenshots (in `screenshots/`)
Visual targets for each screen (hifi). Note: these are captured via a DOM-rasteriser that can
mis-wrap very wide Zen Maru Gothic headings onto two lines — in the real prototype/app those
titles are single-line; trust this README's typography + the live HTML over any heading wrap you
see in a PNG.
- `01-login.png`
- `02-onboarding-welcome.png`
- `03-home-belt-journey.png` ← primary Home
- `04-topics.png`
- `05-practice-build-sentence.png`
- `06-progress.png`

## Files (in `reference/`)
| File | What it covers → target in `mobile/` |
|---|---|
| `Grammar Dojo.html` | Open in a browser to click the whole flow (use the top buttons + Tweaks). |
| `theme.css` | All design tokens, light/dark, animations → `theme.ts` |
| `dojo-core.jsx` | Belts, topic/exercise/achievement sample data, `Sensei`, `BeltKnot`, `BeltTag`, `Ring`, icons, confetti → shared `components/` + `theme.ts` |
| `dojo-shell.jsx` | Top bar, tab bar, streak/XP badges → `(tabs)/_layout.tsx` + shared chrome |
| `dojo-home.jsx` | **Belt journey** (primary) + 2 alt Home layouts → `(tabs)/index.tsx` |
| `dojo-practice.jsx` | Build-the-sentence + inline result → `components/BuildSentence.tsx`, `practice.tsx` |
| `dojo-progress.jsx` | Belt rack, level/XP, belts-by-topic, achievements → `(tabs)/progress.tsx` |
| `dojo-flows.jsx` | Login, Onboarding (7 steps), Topics → `login.tsx`, `onboarding.tsx`, `topics.tsx` |
| `dojo-app.jsx` | Prototype shell only (device frame, nav, Tweaks) — **not** for production |

## Build defaults to ship
- Home = **Belt journey**, theme = **Light**, accent = **`#0E8A30`**, font = Hanken Grotesk
  (brand = Zen Maru Gothic), density = "cozy".
- The Tweak toggles (accent picker, density, mono font, device, alt Home layouts) are prototype
  exploration only — not required in the app.
