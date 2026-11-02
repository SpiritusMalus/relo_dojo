# Native learning screens

Mode: Operate. Platform: adaptive Expo/React Native; current acceptance target Android phone.
Scope: owner-authorized graphite and watercolor implementation of the established dojo world.
Audience/task: a learner returning for a short English practice session and useful feedback.

## Direction contract — 2026-11-02

THESIS: make the daily learning ritual immediately available, with progression supporting it.
OWN-WORLD: airy graphite and sparse watercolor on ivory paper, an approachable adult mentor,
bamboo native actions, real earned belts and separately placed desk objects. The owner chose
study 1 as the working art basis and liked loose ink study 3 too. Concept A supplies warmth
and layout; its glossy generated art is rejected.
STORY: know where practice stands → train → understand feedback → save → return.
FIRST VIEWPORT: native top bar, learning heading and one filled next-learning action, then the
compact painted room. The scene contains the mentor. Native Daily Mix and all-mode text actions
follow; longer paths, goals and rewards stay below. Train offers selectable modes before its
long topic catalogue. Progress labels estimates and leaves unstarted stats empty.
FORM: retain the native three-tab arrangement and real text/controls. The room is a composed
painting with independent object and portrait layers; do not replace the app with a flattened mockup.
FINISH: current native review and functional acceptance must identify the final build and
captures. Earlier screenshot verdicts do not accept this art change. Shipping raster provenance
must retain exact generation prompts, reference roles and atlas mappings.

## Home, completion and My Dojo

Home places the current learning goal directly on the warm native page: heading, description
and one filled bamboo action, without an outlined hero card. Alternate modes remain secondary.
The edge-to-edge compact room follows the action and opens My Dojo. Its native caption shows
confirmed progress toward the next item, with the actual item artwork when a milestone exists.

My Dojo uses the same room in full framing. The opaque ivory room base remains identical in
light and dark mode, deliberately like a painting; surrounding labels, controls, rows and status
use the active native theme. `DojoScene` scales a 360 × 270 composition. Full framing is 4:3;
compact framing is 1.8:1 with a 28-unit top crop. Both use the same equipment and earned belt.

There are three fixed places and eight existing catalog items. Equipment replaces an object,
not the room layout. `DojoItemArtwork` selects these equal-cell atlas positions:

| Slot | Atlas cells, left to right |
| --- | --- |
| Light, row 1 | `dojo_light_paper`, `dojo_light_lantern`, `dojo_light_sunset` |
| Display, row 2 | `dojo_display_blank`, `dojo_display_first_scroll`, `dojo_display_wave` |
| Plant, row 3 | `dojo_plant_seedling`, `dojo_plant_bamboo`, empty |

Below the room, show one next item with its requirement and a practice action before the
collection. Slot tabs and quiet native rows distinguish selected preview, placed, owned and
locked items. A selected unplaced item also gets a compact scene above its action. Requirements,
price and an unavailable balance appear at the point of choice. Previewing does not change
confirmed equipment; successful equipment confirmation updates Home and My Dojo. Invalid item
IDs fall back to the appropriate starter rather than showing another slot's object.

Practice completion leads with actual session results, then the practice-day save state. Only
a confirmed saved receipt supplies the newly earned item ID. Its actual artwork and localized
name appear before the My Dojo action. Finishing for today and the next useful learning step
remain available; the existing random scroll follows. Pending saves offer recovery without
presenting an unconfirmed item as earned. Russian and English copy includes item names,
requirements and koku balances. Existing rewards, prices and account-scoped state stay unchanged.

## Mentor and lesson feedback

`Sensei` is the single appearance entry point for room, feedback and Wardrobe previews.
`WatercolorSensei` crops the 4 × 4 transparent portrait atlas: Classic, Sage, Ronin and Sakura
columns; happy, cheer, think and sad rows. `SenseiVisual.accessory` maps the catalog appearance,
including painted hair, complexion and accessory; an explicit Wardrobe visual override follows
the same mapping as equipped cosmetics.

A native cloth ribbon at the portrait's lower right uses the passed earned belt's cloth, edge,
knot and ink values. Its width is 21% of the portrait; it stays away from the painted face.
The painting contains no synthetic headband. Belt state remains separate from skin and expression.
Warm-up completion still presents a preliminary estimate with a white-belt mentor; it does not
award the estimated belt, and worn progression remains subject to the earned-belt cap.

ResultPanel shows a 72-unit mentor beside native feedback: cheer for correct, think for incorrect.
The correct answer, explanation, XP and recovery actions remain readable native content. Keep
exercise reading space plain. Item changes fade and settle for 240ms; newly earned artwork has
a 240ms settle. Reduced motion displays these immediately. Sensei rests by default; optional
bobbing stops and returns to rest when reduced motion is enabled.

## Shipping artwork and provenance

The source uses three production PNGs, separate from the earlier concept studies:

| Asset | Actual file | Runtime use |
| --- | --- | --- |
| Room | `mobile/assets/sketch/room.png`, 1448 × 1086, opaque RGB | Shared 4:3 base; no removable objects or mentor baked in |
| Items | `mobile/assets/sketch/items-atlas.png`, 1263 × 1245, RGBA | Equal normalized 3 × 3 crop; eight items and one unused cell |
| Mentor | `mobile/assets/sketch/sensei-atlas.png`, 1254 × 1254, RGBA | Equal normalized 4 × 4 crop; all four skins and moods |

Adjacent `room.json`, `items-atlas.json` and `sensei-atlas.json` record provenance and mapping.
The room and item atlas also retain exact `.prompt.txt` companions. All three PNGs have
embedded `impeccable:prompt` entries matching their exact generation prompts; the mentor
prompt is additionally preserved in its JSON manifest. All three were produced with
OpenAI's built-in image generation.
Do not describe these generated assets as manually drawn originals.

The source dimensions differ from requested generation sizes: crop by equal normalized cells,
using the runtime map. Do not derive IDs from filenames or assume a requested 2048-pixel atlas
was delivered. The room's opaque paper is intentional; object and mentor atlases have real alpha.
Their irregular edges are part of the art, not UI borders or rectangular white backgrounds.

## Current acceptance — pending

This pass checked the component source, current theme, manifests and PNG metadata. Initial
native Home and My Dojo previews (`preview-home.png` and `preview-dojo.png` in the sketch-release
capture set) show an earlier, larger ribbon. They are useful composition evidence, but do not
prove the final 21% ribbon, all catalog variants or current finish acceptance.

Final captures, independent finish verdict and real interaction acceptance remain pending.
Repeat both room frames, light/dark, Russian/English, enlarged type, all 18 equipment combinations,
preview versus equip, purchase and earned-item display, persistence/offline/account isolation,
all four skins and moods, earned belt colours and reduced motion. Record results against the
actual tested APK; unit checks and source inspection do not establish native acceptance.

## Historical review evidence — 2026-10-31

Initial native entry and Home captures confirmed clipped bottom action risk, an
unfindable Daily Mix, English belt/topic labels in Russian UI, and noisy repeated
raised cards. The implemented refinement preserves the dojo identity, moves Daily Mix
before the long path, quiets mode rows, localizes progression chrome and makes tab height
follow font scale plus the bottom safe-area inset.

Six submitted Android phone captures are retained at:

- `.impeccable/review/phone-android.png`
- `.impeccable/review/phone-android-train.png`
- `.impeccable/review/phone-android-placement.png`
- `.impeccable/review/phone-android-result.png`
- `.impeccable/review/phone-android-dark.png`
- `.impeccable/review/phone-android-font130.png`

The independent review in `.context/release-20261031/native-finish-review.md` accepted
the six captures as valid for its screenshot scope and returned **fix** for the coloured
emoji flame in the lesson header. Practice, Story and Review now use the shared drawn
flame; boost uses the drawn bolt and the streak has a localized accessible label.
The same result path was recaptured from the final standalone APK in dark mode at
font scale 1.3. The reviewer scored the sole flame fix **resolved** and returned
**ship**, covering that scored screenshot fix only. Functional acceptance remains
separate. An additional enlarged exercise capture is retained as
`.impeccable/review/phone-android-font130-exercise.png`.

The real interaction record is
`.context/vault/Relo Dojo/QA-2026-10-31-test-release.md`. It separately records observed
Android journeys, persistence, theme and enlarged-type checks, failures, corrections
and pending repeats. Its font-scale evidence includes the corrected main-tab layout
at 1.3; this does not establish enlarged-type acceptance for every lesson/result state.
The earlier frozen QA run's unearned-belt failure remains historical evidence.
Its actual native repeat after the fix retained 110 XP and ten answers, displayed
White with qualified Yellow exam eligibility, and awarded no Green belt.

This documentation pass checks source and recorded evidence. Functional release
acceptance, physical-device audio/performance, iOS and tablet acceptance are not
established by the screenshot review.

No reward rates, prices, paid features or earned-progression rules are defined here.
