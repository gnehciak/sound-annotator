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

Design tokens are defined as CSS variables in `src/index.css` (`:root`) and
mapped to semantic Tailwind colors in `tailwind.config.js`
(`ink / panel / raised / inset / line / line-strong / fg / muted / accent /
meter`). Per-note colors live in `src/lib/noteColors.ts`. Retune the
whole theme from those files.

For design tasks, invoke the impeccable skill (e.g. `/impeccable critique`,
`/impeccable audit`, `/impeccable polish`, `/impeccable live`). It reads
PRODUCT.md and DESIGN.md first.
