# Sound Annotator

A web app for time-anchored music annotation in the classroom: load a YouTube
video or an audio file, then attach timestamped rich-text notes that seek the
player when clicked. Vite + React 19 + TypeScript + Tailwind + TipTap +
wavesurfer.js. Backed by Firebase: Google sign-in (Auth), projects/notes in
Firestore (one doc per project, notes inline), audio blobs in Cloud Storage
(`users/{uid}/audio/{projectId}`). Config is in `.env.local` (`VITE_FIREBASE_*`);
security rules live in `firestore.rules` / `storage.rules`, bucket CORS in
`cors.json`. Per-user data; the browser talks straight to Firebase (no server).

## Design Context

This project uses **impeccable** for design work. Two root docs hold the
strategic and visual system; read them before any UI change:

- **PRODUCT.md** — register (`product`), users (teacher/power-user first),
  purpose, brand personality (*precise · technical · pro-tool*), anti-references,
  and design principles.
- **DESIGN.md** — the visual system (Stitch format): normative tokens, palette,
  typography, components. Creative North Star: **"The Listening Station."**
  Machine-readable extensions live in `.impeccable/design.json`.

Design tokens are defined as CSS variables in `src/index.css` and mapped to
semantic Tailwind colors in `tailwind.config.js` (`ink / panel / raised / inset /
note / line / line-strong / fg / fg-strong / muted / accent / accentink / meter /
peak / danger / onbright / rowsel`). Per-note colors live in
`src/lib/noteColors.ts`. Retune the whole theme from those files.

**Themes** flow off that one token set, on two axes: `data-theme` (mode:
dark, the default, or light — white-page: literal-white page/canvas framed by
tinted chrome; the light ramp inverts so raised shades below panel; the global
header keeps dark chrome via the `.chrome-dark` zone class — the "dark
masthead") and
`data-palette` (signal hue: amber default / cyan / vermilion / violet / mono),
both on `<html>`. A boot script in `index.html` paints both flash-free before render;
`src/lib/theme.ts` is the runtime (`useTheme` controller, `useResolvedTheme`
mode subscriber, `useThemeKey` mode+palette key for canvas painters, `cssRgb`
reader). The signal splits into `--accent` (fills) and `--accent-ink` (AA text)
— identical in dark, divergent in light. See DESIGN.md §2 "Themes & Palettes".
When adding a token, set it in the two mode blocks and audit the six palette
blocks (they inherit anything not redefined); AA-verify any new light pair.

For design tasks, invoke the impeccable skill (e.g. `/impeccable critique`,
`/impeccable audit`, `/impeccable polish`, `/impeccable live`). It reads
PRODUCT.md and DESIGN.md first.
