# PROMPT 2 — The design round. Paste after Prompt 1 (or any time you want fresh directions)

New design round for JamPulse's landing / discovery page.

**Deliver 5 genuinely different directions**, each as its own standalone file set (new HTML + its own CSS + optional JS, names your choice), all opening on their own with fake-but-realistic Delhi NCR jam data and no backend. Do not touch `index.html`, `style.css` or `app.js` yet.

## What every direction must contain
1. **A landing hero** with the promise — *"Find your people. Find your sound."* — that earns the scroll: headline, subline, a primary "Find jams near you" action, a secondary "Host a jam" action, and a live-feeling sign that jams are happening nearby right now.
2. **A discovery section** that carries the real product: a radius control (5 / 10 / 25 km + custom up to Any distance), a genre filter, a sort control, and a grid of 5+ jam cards. Cards must show: poster art, title, vibe/genre tag, distance, venue, start time, instruments needed, host, and Save + Contact + Ask-to-join actions — all with working hover/press states and at least one interactive in-page filter that actually filters the fake data.
3. **A map moment.** An illustrated or SVG/CSS map (no real map library needed) with pins, a radius ring, and a caption — or, if you prefer, a real Leaflet map if you keep it self-contained.
4. **One "why musicians love this" or social-proof band** (a marquee, a stats strip, testimonials as small cards — your call).
5. **A closing CTA** and a footer.

## Art direction
Give each direction a real identity, not a palette swap. Choose from: editorial print / brutalist terminal / neo-Victorian stage-playbill / cinematic night-venue / brutal Swiss grid / soft neo-morphism / liquid chrome / film-grain documentary / risograph punk zine — pick five that are far apart from each other.

## The effects bar
Each direction must include something that makes me say *"how did you do that"*:
- real 3D (perspective + preserve-3d, tilt cards, depth layers, mouse-tracked camera)
- cursor-reactive lighting, spotlight borders, magnetic buttons
- scroll-driven storytelling (sticky pinning, scroll-linked transforms, kinetic type)
- shader or canvas texture used *for a reason*
- at minimum 3 of these per direction, and none of them in more than one direction — I want to see different machinery, not the same trick five times.

## Quality gates
- Mobile-first: 380px must be beautiful, not merely functional. Tablet and 1440px+ too.
- Accessibility if it is cheap: real contrast, real focus rings, real labels.
- No autoplaying audio. No layout shift. No text over busy art without a treatment.
- Each direction gets its own empty state for "no jams found nearby".
- If you use a font pairing, say why in one clause.

## Output format, per direction
```
DIRECTION 1 — <NAME>
Concept: one line.
Machinery: bullets of the actual techniques used.
Files: <name>.html / <name>.css / optional <name>.js
<full code blocks>
Open: <name>.html
```
End with a short comparison table: direction, feel, best for, heaviest effect, device risk. Then stop and wait for me to pick.
