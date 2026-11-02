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
compact My Dojo row with collectible artwork and a matching status. A quiet Chapters row and the native
Daily Mix/all-mode text actions follow; longer paths, goals and rewards stay below. Train offers selectable modes before its
long topic catalogue. Progress labels estimates and leaves unstarted stats empty.
FORM: retain the native three-tab arrangement and real text/controls. The room is a composed
painting with independent object layers; do not replace the app with a flattened mockup.
FINISH: current native review and functional acceptance must identify the final build and
captures. Earlier screenshot verdicts do not accept this art change. Shipping raster provenance
must retain exact generation prompts, reference roles and atlas mappings.

## Home, completion and My Dojo

Home places the current learning goal directly on the warm native page: heading, description
and one filled bamboo action, without an outlined hero card. Alternate modes remain secondary.
A compact native row follows the action and opens My Dojo. Its 68-unit artwork matches
the next milestone and confirmed progress; without a milestone it shows the equipped scroll
and its name. The row grows with localized text and font scale.

My Dojo holds the full room, with the scroll centered and larger than the lamp and plant.
The mentor stays out of the desk scene so earned objects lead the composition. The opaque ivory room base remains identical in
light and dark mode, deliberately like a painting; surrounding labels, controls, rows and status
use the active native theme. `DojoScene` scales a 360 × 270 composition. Full framing is 4:3;
compact framing is 1.8:1 with a 28-unit top crop. Both use the same independently equipped objects; belts remain in their existing native controls.

There are three fixed places and eleven catalog items. Equipment replaces an object,
not the room layout. `DojoItemArtwork` selects these equal-cell atlas positions:

| Slot | Atlas cells, left to right |
| --- | --- |
| Light, row 1 | `dojo_light_paper`, `dojo_light_lantern`, `dojo_light_sunset` |
| Display, row 2 | `dojo_display_blank`, `dojo_display_first_scroll`, `dojo_display_wave` |
| Plant, row 3 | `dojo_plant_seedling`, `dojo_plant_bamboo`, empty |

The separate 3 × 1 `chapters-atlas.png` supplies three more display variants, left to right:
`dojo_display_introduction` (open window), `dojo_display_experience` (winding path), and
`dojo_display_clarification` (two cups). Each uses the existing display placement. The native
item names are Open window, The path and Conversation, localized into Russian.

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

## Practical chapters

Home keeps the existing review/course action first. A quiet Chapters row follows the room;
Train and My Dojo also open the chapter list. Three separated, illustrated rows explain
the situations and show server-returned not-started, in-progress or completed status.
Each keepsake name has an explicit localized Reward label. All
three situations are selectable. The artwork is the actual collectible, not a generic badge.

Inside a chapter, three authored preparation cards reuse the native exercise and feedback
components. The final task has a plain multiline English editor, themed paper, native font
scaling, keyboard avoidance and explicit checking/recovery actions. Missing meaning gets
specific feedback and an example; minor grammar slips do not impose an exam. A completed
screen uses the confirmed keepsake and its real collection name. It opens My Dojo for placing
the item with a matching owned chapter reward preselected. Place/Placed sits directly
below the main scene; a preview never equips automatically. Unknown/unowned IDs and stale
account epochs cannot create a selected reward. No XP, belt, currency or achievement is inferred from a local completion event.

An account-scoped local draft is distinct from server progress. An uncertain final request
checks saved server state before retrying the same identity/body. Switching account, chapter
or interface language remounts the presentation. An offline draft remains readable without
claiming unverified progress. Account deletion removes the new raw chapter drafts.

Chapter keepsakes show their required chapter in the collection and open that chapter while
locked. They never display a zero-koku purchase. After the day7 lantern, chapters supply the
next purposeful scroll choices. Chapter completion shares the existing one-per-UTC-day
practice calendar; the meaning and the ownership of the older 1/3/7 items stay intact.

## Mentor and lesson feedback

`Sensei` is the single appearance entry point for meaningful feedback and Wardrobe previews.
Standard Build/Transform instruction headers use text only, avoiding a repeated portrait
when the result appears.
`WatercolorSensei` uses Classic, Sage and Ronin columns of the original 4 × 4 transparent
portrait atlas, with happy, cheer, think and sad rows. Sakura now uses the separate flowerless
2 × 2 spring atlas (happy/cheer, think/sad): ordinary hair and a light linen overshirt. The old
fourth column is unused. `SenseiVisual.accessory` remains the catalog variant dispatch key;
an explicit Wardrobe visual override follows
the same mapping as equipped cosmetics.

The mentor portrait has no student belt ribbon. Belt state lives in separate native knots,
names and progress controls, independent of mentor skin and expression. Warm-up completion
shows a preliminary estimate without awarding the estimated belt; worn progression remains
subject to the earned-belt cap.

ResultPanel shows a 72-unit mentor beside native feedback: cheer for correct, think for incorrect.
The correct answer, explanation, XP and recovery actions remain readable native content. Keep
exercise reading space plain. Item changes fade and settle for 240ms; newly earned artwork has
a 240ms settle. Reduced motion displays these immediately. Sensei rests by default; optional
bobbing stops and returns to rest when reduced motion is enabled.

## Shipping artwork and provenance

The source uses five production PNGs, separate from the earlier concept studies:

| Asset | Actual file | Runtime use |
| --- | --- | --- |
| Room | `mobile/assets/sketch/room.png`, 1448 × 1086, opaque RGB | Shared 4:3 base; no removable objects or mentor baked in |
| Items | `mobile/assets/sketch/items-atlas.png`, 1263 × 1245, RGBA | Equal normalized 3 × 3 crop; eight items and one unused cell |
| Chapter scrolls | `mobile/assets/sketch/chapters-atlas.png`, 2172 × 724, RGBA | Equal normalized 3 × 1 crop; introduction, experience and clarification |
| Mentor | `mobile/assets/sketch/sensei-atlas.png`, 1254 × 1254, RGBA | Equal normalized 4 × 4 crop; first three columns and all four moods |
| Spring mentor | `mobile/assets/sketch/spring-sensei-atlas.png`, 1254 × 1254, RGBA | Flowerless 2 × 2 happy/cheer, think/sad; same catalog identity |

Adjacent JSON manifests record provenance and mapping for all five assets.
The room, item, chapter and spring atlases also retain exact `.prompt.txt` companions. All five PNGs have
embedded `impeccable:prompt` entries matching their exact generation prompts; the mentor
prompt is additionally preserved in its JSON manifest. All five were produced with
OpenAI's built-in image generation.
Do not describe these generated assets as manually drawn originals.

The source dimensions differ from requested generation sizes: crop by equal normalized cells,
using the runtime map. Do not derive IDs from filenames or assume a requested 2048-pixel atlas
was delivered. The room's opaque paper is intentional; object and mentor atlases have real alpha.
Their irregular edges are part of the art, not UI borders or rectangular white backgrounds.

## Flowerless spring correction — 1.3.1

The owner rejected the flower in the mentor's hair. Sakura now wears a pale linen overshirt
and ordinary dark hair; its existing ID, price, season and ownership remain unchanged. Only
this portrait set and its truthful localized description change. The original other three
skins, belts, mood API and equipped/explicit preview behavior remain intact.

Independent finish review returned **ship** for two native 1080 × 2400 captures, light/dark,
showing all four spring expressions at 148 and 44 units plus Classic/Spring comparison.
No clipping, hair ornament or material visual fix remained. The private proof route was
removed before delivery. TypeScript and 616 tests in 73 suites pass. Final public-API APK
and integrated commit are identified by the owner-held flowerless-release receipt; this
portrait review does not extend device, iOS, store or gameplay acceptance.

## Watercolor release acceptance — 1.3.0

Independent finish review returned **ship**, with no material fixes remaining, for the
supplied Android 1.3.0/code 4 capture set and sampled source. The packet contains 37 captures:
18 native full/compact room combinations, 16 mentor states at large/small sizes, all six
belt colours, and real Home, practice, feedback, completion, collection and preview states.
The six-belt proof alone used a temporary taller viewport; app-state acceptance used
1080 × 2400 Android 14. The private proof route is excluded from shipping source.

Russian light and English dark screens were checked; Home/Dojo at font scales 1.3 and 2.0,
and practice at 2.0, retain readable text and reachable actions. Real isolated interaction
acceptance completed ten graded cards, displayed the confirmed first-scroll reward, placed
it, retained it after restart, bought/equipped the wave, and recovered the cached room offline.
The initial QA balance was explicitly synthetic. Server receipts separately confirm actual
grades, ownership, practice day, acknowledgement and balance; screenshots alone prove none
of those writes. Existing account-isolation tests pass; the second fixture stayed unchanged.

Reduced-motion handling has unit coverage and native immediate equipment rendering. Original
AVD data and settings were restored after acceptance; task-owned QA services were stopped.
All PNG prompts decode as exact Unicode iTXt metadata and their manifest hashes match.
The metadata correction leaves compressed image pixels unchanged from the reviewed artwork.

The owner-held `sketch-release` packet retains the finish verdict and functional receipts.
Final public-API APK delivery and integrated revision are recorded in the release receipt.
This review does not establish physical-device, iOS, tablet, audio or performance acceptance.

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


## Live Android font changes — 2026-11-02

The Android config plugin handles fontScale without recreating MainActivity. The callback refreshes
native metrics and synchronously measures the existing root at its actual current viewport before
DeviceInfo notifies JS. RN0.81.5's intended font-layout flag supplies the real surface multiplier.
Android display-only Text leaves refresh by that real scale, entering the normal React layout path;
the engine can otherwise leave its root clean after dirtying measurable descendants. Inputs,
providers, screen state and navigation stay mounted. Text selection in a replaced display label
may reset; editable TextInput selection/focus is preserved and is checked natively.

The pinned initializer preserves SoLoader, native libraries, private architecture flags, Stable
provider values and edge-to-edge order. Version/source guards reject silent SDK drift. No artificial
cache salt, manual font multiplication, disabled scaling or root/provider/navigation remount is used.
Native acceptance covers foreground scale changes in both directions, Settings/background return,
input draft/caret/focus, Back behavior and cold startup before release.
