# Sound Annotator

A web app for time-anchored music annotation in the classroom: load a YouTube
video or an audio file, then attach timestamped rich-text notes that seek the
player when clicked. Vite + React 19 + TypeScript + Tailwind + TipTap +
wavesurfer.js. Backed by Vercel: Google sign-in via Clerk, projects/notes in
Neon Postgres (one row per project, notes inline in `annotations` jsonb),
audio/images in Vercel Blob (`users/{uid}/audio/{projectId}`,
`users/{uid}/images/{projectId}/…`). The SPA calls Vercel Functions in `/api`
(Web signature), which enforce all authorization — owner-only access,
share-by-unguessable-id for `?view=` links, link-editor field clipping, and
the server-stamped edit lock (see `api/projects/[id]/index.ts`). Schema lives
in `scripts/schema.sql` (apply with `node --env-file=.env.local
scripts/apply-schema.mjs`). Config comes from the linked Vercel project:
`vercel env pull` writes `.env.local` (client reads only
`VITE_CLERK_PUBLISHABLE_KEY`; functions read `DATABASE_URL`,
`CLERK_SECRET_KEY`, `BLOB_READ_WRITE_TOKEN`). Local dev with API:
`npm run dev:full` (vercel dev); UI-only: `npm run dev`.

**JSON import/export** (`src/lib/projectJson.ts`): tracks round-trip through a
versioned portable JSON envelope (export buttons in the editor sub-bar, share
viewer, and track-tile menu; Import on the home page). When adding or changing
any persisted field on `Project` / `Annotation` / `ProjectSource` /
`ProjectSettings` (in `src/types.ts`), update `projectJson.ts` in the same
change: add the field to the export envelope and the import sanitizer, or
imported files silently lose it. Primitive-valued `settings` keys (including
the project `kind`, e.g. song-structure boards) pass through automatically.
Bump `PROJECT_JSON_VERSION` only on breaking shape changes.

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
dark, the default — untinted graphite; or light — pure white end to end,
hairlines carry structure, no dark masthead) and `data-palette` (signal hue:
tangerine default / bubblegum / limeade / crayon), both on `<html>`.
**Color-as-accent doctrine (2026-07-17):** the neutral canvas is shared by
every palette and never tinted; color appears only as the signal, the meter,
the note data, and the faint `--row-sel` signal wash on the selected row. A
boot script in `index.html` paints both axes flash-free before render;
`src/lib/theme.ts` is the runtime (`useTheme` controller, `useResolvedTheme`
mode subscriber, `useThemeKey` mode+palette key for canvas painters, `cssRgb`
reader). The signal splits into `--accent` (fills) and `--accent-ink` (AA text)
— identical in dark, divergent in light. See DESIGN.md §2 "Themes & Palettes".
When adding a token, set it in the two mode blocks; palette blocks redefine
only the accent family. AA-verify any new light pair.

For design tasks, invoke the impeccable skill (e.g. `/impeccable critique`,
`/impeccable audit`, `/impeccable polish`, `/impeccable live`). It reads
PRODUCT.md and DESIGN.md first.
