# Sound Annotator

A web app for time-anchored music annotation in the classroom: load a video
(YouTube or a Google Drive file) or link a direct audio-file URL, then attach
timestamped rich-text notes that seek the player when clicked. **Audio is never
uploaded** — a track's sound is always a link, and wavesurfer streams it from
wherever it lives, so the host's CORS policy decides whether it loads (see
`src/components/AudioUrlForm.tsx`). Note images are the only bytes we host.

**Three source kinds, two of them videos.** `youtube` and `drive` behave
identically everywhere outside their own player — 16:9 frame, clip window,
poster thumbnail, an "open the original" link — so ask `src/lib/source.ts`
(`isVideoSource` / `videoIdOf` / `sourceLabel` / `sourceLinkUrl` /
`sourceThumbUrl` / `parseVideoLink`) rather than spreading
`type === 'youtube' || type === 'drive'` around. Drive has no scriptable embed,
so `DrivePlayer` streams the file's bytes into a plain `<video>` — but **never
from Drive**: Drive answers any browser subresource (`Sec-Fetch-Site:
cross-site`) with 403, and any non-Google `Referer` with its virus-scan HTML,
neither of which page JS can suppress, and both of which reach the element as
`MEDIA_ELEMENT_ERROR: Format error`. So the bytes come through
`GET /api/browse?drive=<fileId>`, a server-side Range proxy: the file must
still be shared **Anyone with the link** (the proxy holds no Drive
credentials), the upstream URL needs `confirm=t` past ~100 MB, the proxy serves
~8 MB per request and only for ids a live project points at, and every play
spends our own bandwidth. See `src/lib/drive.ts`. Vite + React 19 + TypeScript + Tailwind + TipTap +
wavesurfer.js. Backed by Vercel: sign-in via Clerk's prebuilt card (Google *or*
email + password, with verification and reset — themed from our tokens in
`src/lib/clerkAppearance.ts`, which must hand Clerk hex: its JS color parser
rejects the space-separated `rgb()` that `cssRgb` emits). Projects/notes in
Neon Postgres (one row per project, notes inline in `annotations` jsonb),
note images in Vercel Blob (`users/{uid}/images/{projectId}/…` — the only
path `api/blobs/upload.ts` still accepts; legacy `users/{uid}/audio/…` objects
are served and deleted but never written). The SPA calls Vercel Functions in `/api`
(Web signature), which enforce all authorization — owner-only access,
share-by-unguessable-id for `?view=` links, link-editor field clipping, and
the server-stamped edit lock (see `api/projects/[id]/index.ts`).

**Deleting is a trash, not a delete.** `DELETE /api/projects/:id` only stamps
`deleted_at`; the row stays whole (notes, images, `shared`/`published`) so
restore is exact, and every read filters on `deleted_at IS NULL` rather than
clearing those flags — so a trashed track's `?view=` links and gallery card go
dark and come back on restore. The two ways out are query verbs on the same
route: `POST …?restore=1` (owner only), and `DELETE …?purge=1`, **the app's
only hard delete** — an owner may purge only their own row and only out of the
trash, while an admin may purge any row, live or trashed (the console's
permanent delete, which tears down the bytes client-side first).
`api/cron/purge-trash.ts` hard-deletes anything past `TRASH_TTL_MS` (30 days,
`api/_lib/db.ts`) plus **every** blob prefix a project owns (images, legacy
audio, stems, analysis — keep it in step with App's `purgeProject`, since a
prefix only one of them knows is bytes nobody collects). Daily, and gated on a
`CRON_SECRET` env var it refuses to run without. Blobs are torn down **only at
purge**, never at trash. The trash rides its own listing (`?trash=1`) into its
own App state, never `projects` — a trashed track must never reach search,
folder tallies, or the undo history.

Note the split: plain `DELETE /api/projects/:id` trashes and has **no admin
branch**, because the admin is an account holder too and such a branch would
silently opt them out of their own trash. Permanence is always asked for
explicitly, never inferred from who is calling. `api/admin/projects.ts` lists
live rows only.

**The Hobby plan caps a deployment at 12 Serverless Functions, and `/api` is at
exactly 12.** That's why restore/purge are query verbs on `[id]/index.ts`, and
the Drive byte proxy a query verb on `browse.ts`, rather than routes of their
own. Adding any new `/api/*` file fails the
deploy at `patchBuild` (`exceeded_serverless_functions_per_deployment`, and the
build log looks *successful* — the error is only in the deployment's API
record); fold new endpoints into an existing function, or upgrade to Pro.

**Guests** (students, who have no accounts) are the third kind of caller: the
landing page's paste field (`src/components/LandingPage.tsx`) mints one project
whose *key is its URL* — a capability token, SHA-256 at rest, owner
`guest:<uuid>`, rate-limited per hashed IP (`api/_lib/guest.ts`,
`src/lib/guest.ts`; the cap is loose because a school NATs a whole class behind
one address). A guest writes content **and** their own `source`/`settings` —
never sharing/publishing/ownership — so unlike a link editor they can load the
video they came to annotate, and pick either project kind (listening notes or a
song-section board) before they start.

Two things a guest deliberately can't reach. **Source is video only** (YouTube
or Drive): the landing offers no blank start, so App passes no `onAudioUrl` to
`SourcePicker` — otherwise a sourceless guest row (they predate this) would be
a door into a source kind nothing else in their flow produces. **`allowImages={false}`** —
image upload is signed-in only, and merely omitting the uploader makes the
editor inline base64 into `annotations` instead. **Detect sections is hidden
too** (`!isGuest` in App): `api/projects/[id]/analyze.ts` is Clerk-only, so a
guest's press could only 401. Their project is born `shared`, so the `?view=`
link they hand in is the existing read-only viewer. Schema lives
in `scripts/schema.sql` (apply with `node --env-file=.env.local
scripts/apply-schema.mjs`). Config comes from the linked Vercel project:
`vercel env pull` writes `.env.local` (client reads only
`VITE_CLERK_PUBLISHABLE_KEY`; functions read `DATABASE_URL`,
`CLERK_SECRET_KEY`, `BLOB_READ_WRITE_TOKEN`, and `REPLICATE_API_TOKEN` —
the last powers AI song-section detection, `api/projects/[id]/analyze.ts`). Local dev with API:
`npm run dev:full` (vercel dev); UI-only: `npm run dev`.

**JSON import/export** (`src/lib/projectJson.ts`): tracks round-trip through a
versioned portable JSON envelope (exports live in the editor header's
share/export menu, the share viewer, and the track-tile menu; Import on the
home page). When adding or changing
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
dark, the default — near-black canvas; or light — pale grey canvas) and
`data-palette` (signal hue: tangerine default / bubblegum / limeade / crayon),
both on `<html>`. **Frosted glass (2026-09-05):** workspace columns, menus and
modals are translucent blurred panes (`.glass` / `.glass-pop` in
`src/index.css`) floating over an ambient bloom of the signal hue
(`--ambient`, painted by `body::before`). The `panel` / `raised` / `inset` /
`note` Tailwind colours are therefore full colour strings (white or black at
low alpha, `var(--panel)` etc.), **not** channel tokens — they take no
`/opacity` modifier; use `bg-fg/[0.03]`-style washes for ad-hoc tints.
**Component vocabulary (2026-09-05):** every button, chip, segmented
control, field, switch, menu, well, tile and empty state is a class from the
`@layer components` block in `src/index.css` (`btn-ghost` / `btn-signal` /
`btn-primary` / `btn-icon(-lg)`, `chip` + `chip-outline` / `chip-neutral` /
`chip-signal` / `chip-time` with a `--hue` custom property, `seg` / `seg-item`,
`field`, `switch`, `pop` / `pop-row`, `well`, `tile`, `empty`, `strip`).
`Popover.tsx` applies `pop` itself. Don't hand-roll a control from Tailwind
utilities; compose the class with `press` and only the site's own overrides
(a width, a hover colour). See DESIGN.md §5 "The Vocabulary".
**Color-as-accent doctrine (2026-07-17):** panes never carry a hue; color
appears only as the signal, the meter, the note data, the `--row-sel` wash on
the selected row, and the ambient bloom / transport glow behind and beneath
the glass. A boot script in `index.html` paints both axes flash-free before render;
`src/lib/theme.ts` is the runtime (`useTheme` controller, `useResolvedTheme`
mode subscriber, `useThemeKey` mode+palette key for canvas painters, `cssRgb`
reader). The signal splits into `--accent` (fills) and `--accent-ink` (AA text)
— identical in dark, divergent in light. See DESIGN.md §2 "Themes & Palettes".
When adding a token, set it in the two mode blocks; palette blocks redefine
only the accent family. AA-verify any new light pair.

For design tasks, invoke the impeccable skill (e.g. `/impeccable critique`,
`/impeccable audit`, `/impeccable polish`, `/impeccable live`). It reads
PRODUCT.md and DESIGN.md first.
