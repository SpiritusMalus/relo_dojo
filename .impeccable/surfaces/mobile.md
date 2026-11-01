# Native learning screens

Mode: Operate. Platform: adaptive Expo/React Native; current acceptance target Android phone.
Scope: an approved refinement of the established dojo world, not an identity replacement.
Audience/task: a learner returning for a short English practice session and useful feedback.

## Direction contract

THESIS: make the daily learning ritual immediately available, with progression supporting it.
OWN-WORLD: warm paper, bamboo actions, ink, existing Sensei, belts and drawn scrolls.
STORY: know where practice stands → train → understand feedback → save → return.
FIRST VIEWPORT: native top bar, modest belt summary, one filled Daily Mix action; long
paths, optional goals/reward panels and promotions follow. Train offers selectable modes
before its long topic catalogue. Progress labels estimates and leaves unstarted stats empty.
Warm-up completion states a preliminary estimate alongside a neutral white-belt Sensei;
it does not award the estimated belt. Worn progression remains subject to the earned-belt cap.
FORM: refine the incumbent native three-tab arrangement; no replacement-world seed applies.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Review evidence

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
