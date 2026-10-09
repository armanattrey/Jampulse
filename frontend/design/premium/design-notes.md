# Premium visual direction

Generated with the built-in image generation tool before implementation. Reference images are saved beside this file.

## Hero reference

Prompt: A premium JamPulse musician-community hero with a slim charcoal sidebar, off-white canvas, very large grotesk headline “Good music. Better company.”, an acid-lime record sleeve containing a black vinyl record, simple exploration and hosting actions, generous spacing, and no fabricated statistics or distracting effects.

Extraction: roughly 200px sidebar; 40px main gutters; left-aligned three-line headline; black primary CTA; understated secondary action; lime artwork with concentric record grooves; consistent 8–12px control radii. The implementation keeps this composition, scales the headline for laptops, and rebuilds the vinyl as native CSS so it stays sharp and lightweight.

## Discovery reference

Prompt: A standalone premium JamPulse discovery section with off-white, charcoal, and lime; “Find your next jam.” heading; genre/distance/sort filters; record-sleeve posters on muted sage and mauve; readable event details; contact/join actions; and a Gurugram map.

Extraction: clear category lettering, dark record motifs, fine outlines, minimal elevation, readable dates and locations, and a map occupying about one third of the desktop width. Filters and map geometry use the app's actual data. Dates and counts come from sessions, rather than copying the illustrative reference.

## User-supplied interaction

The supplied TiltedGridHero provides the curved-cylinder image treatment. Its 16-slice geometry remains intact. It is extended with selection, previous/next, swipe, keyboard support, pause, reduced motion, and existing session actions. Record sleeves are generated from actual jam categories as code-native graphics. The list remains available for scanning and as a fallback if the React bundle fails to load.

## Verification

The TypeScript and production build passes. All 18 existing backend checks pass. Browser verification covered 27 session-flow checks, five additional reel and responsive checks, and sticky desktop navigation. Viewports checked: 320, 390, 768, 1024, and 1440px. Sample-mode actions and API failure/recovery were verified without sending real messages or RSVPs. Live provider delivery and authenticated account flows were not exercised. Website and Capacitor copies are synchronized.

## Interactive swipe update

The curved reel now tracks horizontal pointer movement directly, using the same cylinder geometry. Releasing a drag or swipe advances one session; short or cancelled gestures settle back. Pointer capture preserves dragging outside the stage. Native touch capture transfers from a sleeve to the stage without cancelling the gesture, and post-swipe compatibility clicks are suppressed. Vertical touch scrolling, sleeve taps, arrows, and contact actions remain functional. The production build and 13 mouse/native-touch browser checks pass.

## Dark bento experiment

The user-supplied FUIBentoGridDark and BentoCard structure is integrated in `components/ui/bento.tsx`, with Framer Motion hover states, graphic fades, and dark card surfaces. Actual JamPulse categories, dates, locations, host information, and instruments replace the sample sales content. Bento view is the default; the interactive curved reel and full session list remain available. Actions use the existing session bridge. Production build and 15 browser flow/layout checks pass; a separate check verifies that hover animation responds immediately to live reduced-motion preference changes. The earlier backup-2.zip was independently verified and is unchanged.
