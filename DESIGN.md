---
name: Relo Dojo
description: Calm native dojo with earned game progression
colors:
  bamboo: "#376347"
  bamboo-pressed: "#284B34"
  on-bamboo: "#FFFFFF"
  bamboo-soft: "#E6ECDF"
  paper: "#F6F3EB"
  parchment: "#FFFCF5"
  paper-secondary: "#EEEBDD"
  paper-track: "#E5E2D6"
  ink: "#253328"
  secondary-ink: "#566053"
  muted-ink: "#666F61"
  outline: "#DDDDCF"
  outline-strong: "#C9CEBD"
  amber-ink: "#896421"
  rust: "#9E592D"
  error: "#AE463B"
  night-paper: "#171D18"
  night-surface: "#202821"
  night-bamboo: "#8EBA9A"
  night-bamboo-pressed: "#679474"
  night-bamboo-soft: "#253C2C"
  night-on-bamboo: "#102416"
  night-ink: "#F0EEE3"
  night-secondary-ink: "#C4C6B8"
  night-muted-ink: "#A0AA99"
  night-outline: "#3D483A"
typography:
  display:
    fontFamily: Zen Maru Gothic
    fontSize: "32px"
    lineHeight: "38px"
    fontWeight: 700
  headline:
    fontFamily: Zen Maru Gothic
    fontSize: "25px"
    lineHeight: "30px"
    fontWeight: 700
  title:
    fontFamily: Zen Maru Gothic
    fontSize: "17px"
    lineHeight: "21px"
    fontWeight: 700
  body:
    fontFamily: Hanken Grotesk
    fontSize: "16px"
    lineHeight: "23px"
    fontWeight: 500
  body-strong:
    fontFamily: Hanken Grotesk
    fontSize: "16px"
    lineHeight: "23px"
    fontWeight: 600
  control:
    fontFamily: Hanken Grotesk
    fontSize: "16px"
    lineHeight: "23px"
    fontWeight: 700
  secondary:
    fontFamily: Hanken Grotesk
    fontSize: "14px"
    lineHeight: "20px"
    fontWeight: 500
  caption:
    fontFamily: Hanken Grotesk
    fontSize: "12px"
    lineHeight: "17px"
    fontWeight: 600
  label:
    fontFamily: Hanken Grotesk
    fontSize: "13px"
    lineHeight: "18px"
    fontWeight: 700
  mono:
    fontFamily: JetBrains Mono
    fontSize: "15px"
    lineHeight: "21px"
    fontWeight: 400
rounded:
  control: "12px"
  surface: "16px"
  showcase: "20px"
  pill: "999px"
spacing:
  page: "20px"
  stack: "14px"
  target: "48px"
components:
  button-primary:
    backgroundColor: "{colors.bamboo}"
    textColor: "{colors.on-bamboo}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "15px 18px"
  button-ghost:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "13px 18px"
  card:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "20px"
  chip:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  chip-selected:
    backgroundColor: "{colors.bamboo-soft}"
    textColor: "{colors.bamboo}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
---

# Design System: Relo Dojo

## Overview

**Creative North Star: "A calm dojo with game progression"**

Warm paper and readable ink support a short, focused learning ritual. The owner
selected graphite and light watercolor study 1 as the working art direction on
2026-11-02, with loose ink study 3 as a secondary reference. The warmth and layout
of concept A remain useful; its glossy generated imagery was rejected.

The room, adult mentor and collectible desk objects use uneven graphite contours,
sparse watercolor washes and open paper. They sit beside real native text and
controls. The filled bamboo action leads to practice; earned belts and confirmed
items give progress a recognisable physical form. This document records the
implemented source contract; current native finish acceptance is tracked separately
in `.impeccable/surfaces/mobile.md`.

**Key Characteristics:**

- Airy graphite and watercolor art, with an ordinary adult mentor and restrained expressions.
- Warm native surfaces, legible ink and bamboo actions surrounding the painting.
- Earned belts and separately placed objects reflect actual progression.
- Standard native navigation, spacious controls and clear recovery states.
- Rewards acknowledge practice without competing with the lesson.

## Colors

The light palette is paper, parchment and ink, with bamboo for primary actions and
current selection. Rust and amber serve supporting status; red identifies errors.
Use `mobile/theme/theme.ts` as the executable source, including its complete dark
scheme. Dark mode uses warm charcoal with lighter bamboo and dark on-primary ink;
it is a separately resolved palette. The frontmatter records reused primitives;
the complete theme also owns soft status fills and the remaining surface steps.

The room is deliberately an opaque ivory-paper painting in both themes. Its paper
and painted light do not become a dark scene. Surrounding native text, navigation,
rows, controls and feedback use the selected theme. Transparent item and mentor
edges allow the surrounding scene or native surface to show through; do not add
white rectangles behind these cutouts.

Light ink on paper measures 11.96:1, secondary ink 5.93:1 and muted ink 4.72:1.
White on the light primary is 6.91:1. Dark on-primary ink measures 7.50:1. These are
recorded token-pair checks, not acceptance of the current composed native screens.

Belts retain their existing white/yellow/orange/green/blue/black swatches. The mentor portrait carries no student belt indicator. Earned belt names, knots and
progress remain separate native controls. The launcher retains the
existing torii vector with a flat bamboo ground and gold step.

**The Painting Rule.** The room keeps its ivory paper in light and dark mode;
readable app chrome follows the active theme.

## Typography

Zen Maru Gothic carries the rounded display voice. Hanken Grotesk carries body and
controls; JetBrains Mono is reserved for English examples/code or measured values.
Font weights are encoded in the loaded font family; do not add `fontWeight` to a
custom family. Native text retains React Native font scaling and OS glyph fallbacks,
including Cyrillic fallback where the selected face has no glyph. Android keeps the current
activity during font-scale changes and refreshes native Fabric text layout. For the pinned
RN0.81.5 build, the app delegates to the exact Stable feature provider and enables only the
native font-scale layout-update flag before runtime startup, with strict version/source guards.
The configuration callback synchronously measures the existing root at its actual viewport before
notifying JS. Android display-only Text leaves then refresh by the real font scale to enter the normal
React layout path; RN0.81.5 can otherwise leave the root clean after dirtying text descendants.
Inputs, providers and navigation remain mounted; native font scaling and caps are retained.

The frontmatter maps native `hero` to display, `screenTitle` to headline and
`cardTitle` to title. Body strong uses the semibold face; shared Button labels use
the bold UI face. Button labels default to normal case, with uppercase an explicit
caller option. Exercise text, answer feedback, item names, prices and progress are
real native text, never lettering baked into an illustration. Do not substitute a
handwriting face for instructional reading.

**The Encoded Weight Rule.** Native custom-font families already encode weight.
The frontmatter records the portable family and weight; native components select
the corresponding named face from `fonts` instead of adding `fontWeight`.

## Layout

Use the existing Expo Router tabs and native navigation stack. Page padding is
20 logical units, standard vertical gap 14, control target at least 48 on Android.
Preserve safe-area and keyboard insets. Scroll content must leave space below the
last action; the consent route includes its bottom safe area explicitly. Frontmatter
pixel strings represent the source's logical native units, not physical pixels.

Home places the learning heading, description and one filled next action directly
on the page, without an outlined hero card. A compact native My Dojo row follows the action, with a 68-unit collectible thumbnail
and its matching next-goal progress or equipped-item name. The full painting belongs in
My Dojo, followed by the next item, practice action and collection. Chapter completion
opens the earned item selected, with Place/Placed directly beneath the main painting. Keep these screen-specific details
in `.impeccable/surfaces/mobile.md`; they do not require every screen to use a room.

The three-tab bar height is `ceil(48 + 16 × fontScale) + bottomInset`. Its active
highlight surrounds the icon (52 × 32), while the label remains below it. Preserve
the scaling formula and safe-area padding rather than fixing a screenshot height.

Practical chapters extend the same native world: collectible art beside separated list rows,
ordinary preparation cards and a plain multiline English editor for the final reply. Keep
the learner's answer and feedback in native text. The three chapter scrolls reuse the existing
display position and collection; their art adds no fourth room slot. Paid access uses a neutral
Plus sign, distinct from the earned belt ribbon.

## Elevation & Depth

Ordinary cards and mode rows use one quiet outline and tonal surface, with no
shadow. The shared Button and Daily Mix retain a two-unit lower border that becomes
one unit during a one-unit downward press. The translation popover uses the theme's
large overlay shadow; light and dark resolve it separately. Graphite overlaps and
light watercolor supply depth inside the artwork; do not put raised cards or heavy
frames around each painted object.

**The Quiet Surface Rule.** Ordinary cards and mode rows separate content with tone
and an outline. Do not spread the overlay shadow across those rows.

## Shapes

Controls use 12-unit corners, cards 16 and the belt summary 20. Pills identify small
chips or badges. The torii and scroll remain established domain shapes. Native icons
use the shared two-unit rounded line system. These precise control shapes coexist
with irregular painted contours; the room and mentor are raster artwork, not an
SVG scene or a new geometric mascot.

## Components

The sidecar's existing self-contained HTML/CSS samples translate native primitives
for the design panel. Browser hover and focus-visible rules belong to that preview;
React Native components remain the authority for shipped interaction states.

- **Primary Button:** filled bamboo, contrasting on-primary text, minimum target 48,
  default normal case, bold UI label and explicit disabled/loading text supplied by
  its caller. Disabled colours use the surface track, strong outline and muted ink.
- **Ghost Button:** parchment with a strong outline; pressed state uses the
  secondary paper surface. It shares the primary control's bold label and target.
- **Daily Mix:** filled bamboo action in Train, drawn bolt, title/subtitle and drawn
  chevron. It uses the card radius and 16-unit padding. Home presents its current
  learning goal as the filled action and offers other modes as secondary text actions.
- **Mode row:** quiet outlined native row, one consistent icon, readable title and
  subtitle, chevron. It is secondary to Daily Mix.
- **Card:** parchment, one outline, 20 padding and 16 corners.
- **Choice chip:** pill with 48-unit minimum target; selected state uses soft bamboo
  with bamboo ink and outline. Disabled opacity is 0.5.
- **Account field:** visible label, parchment fill, strong two-unit outline and
  12-unit corners. Focus changes the outline to bamboo; entry text uses the medium
  UI face at 15 units and placeholder text uses muted ink.
- **Navigation:** Home, Train and Progress use the shared drawn icons, a soft bamboo
  icon highlight, active bamboo text and inactive muted ink. Labels are 12/16 with
  the semibold UI face.
- **Belt controls:** names localize to Russian/English; the sheet explains practice
  progression. Warm-up completion presents a preliminary estimate and a white-belt
  Sensei, while the worn belt follows the earned-belt cap. A starting belt does not
  claim measured CEFR mastery.
- **Topic rows:** unstarted topics show a dash and explanatory text, without invented
  accuracy. Display skill estimates as estimates.
- **Painted room:** `DojoScene` composes `mobile/assets/sketch/room.png` and three independently
  equipped item layers. The central enlarged scroll leads the collection; no mentor
  portrait is placed on the desk. It scales a 360 × 270
  composition; full framing is 4:3 and compact framing is 1.8:1 with a 28-unit top
  crop. The light, display and plant slots retain their eight original catalog IDs
  and add three chapter-earned display variants in the same display position.
  Selection previews do not alter confirmed equipment. Unknown IDs fall back to
  that slot's starter item. `DojoItemArtwork` crops equal cells of the transparent
  3 × 3 `items-atlas.png`; the final cell is unused. The three chapter scrolls use
  equal cells of the separate 3 × 1 `chapters-atlas.png`.
- **Sensei:** `WatercolorSensei` uses the first three columns of the transparent
  4 × 4 `sensei-atlas.png` for Classic, Sage and Ronin; rows are happy, cheer, think
  and sad. Sakura uses the separate 2 × 2 `spring-sensei-atlas.png`, ordered
  happy/cheer then think/sad. This spring portrait has ordinary hair and a light
  linen overshirt, with no flower or substitute hair ornament. The historical
  fourth column is unused. Equipped cosmetics and explicit Wardrobe previews
  use the same `SenseiVisual` contract. The portrait carries no student belt ribbon. The learner's earned belt remains
  in the separate native belt controls; changing mentor cosmetics cannot claim a rank.
- **Answer feedback:** standard Build/Transform instructions contain native text only,
  leaving the mentor for meaningful feedback. The shared ResultPanel uses a 72-unit mentor, cheer for a
  correct answer and think for an incorrect answer. The native heading, correct
  answer, XP and explanation carry the meaning. The portrait never replaces them.
- **Earned item:** completion shows the exact item ID from a confirmed save receipt
  through `DojoItemArtwork`, its localized name and a direct My Dojo action. Saving,
  pending and expired states remain distinct; a preview is not an award.
- **Scroll:** server-authoritative result, 220ms reveal; reduced motion reveals
  immediately. Distinguish the exact daily-cap code from network uncertainty. Never
  automatically retry a possibly credited reward.
- **Motion:** item changes use a 240ms fade and four-unit settle; completion artwork
  uses a 240ms settle. Reduced motion shows both immediately. Sensei rests by
  default; explicit bobbing remains optional and stops with reduced motion.

The shipping art lives in `mobile/assets/sketch/`: room, item atlas, chapter
scroll atlas, mentor atlas and flowerless spring mentor atlas, with adjacent JSON manifests.
The room, item, chapter and spring atlases have exact companion `.prompt.txt` files;
all five PNGs retain an embedded `impeccable:prompt` entry. The mentor
manifest records its exact generation prompt, reference role, cell mapping and
alpha verification. These are generated assets made with OpenAI's built-in image
generation; the graphite and watercolor descriptions specify their visual medium.
Preserve this provenance when replacing or copying artwork, and verify the actual
file and atlas map rather than the requested output size alone.

**The State Stays Native Rule.** Paint the setting and objects, never ownership,
prices, player identity, progress numbers or reward claims. Native state selects
individual artwork layers and native text explains the current result.

## Do's and Don'ts

### Do

- **Do** keep the next useful learning action findable before the room.
- **Do** preserve the airy graphite and watercolor treatment, transparent cutout edges and adult mentor proportions.
- **Do** use existing belt, equipment and scroll state without inventing mastery or reward claims.
- **Do** verify light, dark and enlarged type in a native emulator or device.
- **Do** preserve native Back, safe areas, keyboard access and clear loading/error states.
- **Do** retain exact generation provenance and atlas mappings alongside shipping art.

### Don't

- **Don't** return to the rejected glossy, smooth 3D or geometric mascot treatment.
- **Don't** bake UI text, earned objects, belt progression or account state into a room painting.
- **Don't** put promotions, reward pressure or a long catalogue ahead of the daily practice action.
- **Don't** replace quiet training-mode surfaces with saturated fills, gradients or repeated shadows.
- **Don't** present estimated skill or unstarted topics as earned proficiency.
- **Don't** replace the established dojo with generic emoji icons or a handwriting reading face.
