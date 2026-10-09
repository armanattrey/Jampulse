# JamPulse frontend

The website combines the existing app with a React session browser. Hosting, authentication, messaging, profiles, and map actions remain in `app.js`; the reel calls those shared actions through `window.jampulseUI`.

## Build

```sh
cd frontend
npm install
npm run build
```

The build checks TypeScript, creates `assets/jam-reel.js` and `assets/jam-reel.css`, and synchronizes the website and assets into Capacitor's `www` directory. The API server serves the website and `/assets` from the same origin. Start it with `npm start` from the repository root.

## Component structure

- `components/ui/bento.tsx`: the supplied dark bento card system adapted to real sessions and shared map, contact, save, and join actions.
- `components/ui/tilted-grid-hero.tsx`: the supplied curved-grid component, extended with selectable sessions and pause controls.
- `src/jam-reel.tsx`: session selection, previous/next controls, swipe and keyboard navigation, list switching, and shared session actions.
- `src/reel.css`: Tailwind v4 utilities and reel styles. Tailwind's global reset is omitted so the existing app forms retain their behavior.
- `lib/utils.ts`: the `cn` helper used by the component.
- `components.json`: shadcn-compatible component paths and TypeScript configuration.
- `style.css`: the website's premium theme and existing forms and profile styling.

The `components/ui` path keeps reusable UI separate from session-specific behavior. There is no need to migrate the entire website to React or run the shadcn CLI again.

## Browsing jams

Bento view is the default discovery layout. Curved reel and All sessions remain available in the view switcher. The curved reel starts paused. Drag with a mouse or swipe horizontally on a phone: the curved tiles follow the gesture and select the next or previous jam on release. Short drags and cancelled gestures settle back. Vertical swipes scroll the page. Tapping a sleeve, the previous/next buttons, and arrow keys also select sessions. Play enables the supplied looping cylinder animation. Hovering or focusing the reel pauses motion. Reduced-motion settings keep it still. All sessions opens the full list, with the same filters and saved state.

`?demo=1` provides clearly labeled sample sessions and simulated actions for local previews. Live authentication, messaging, calls, and hosting require the configured backend services.
