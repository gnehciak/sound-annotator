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

**Who the admin is: `ADMIN_EMAILS`**, a comma-separated allowlist checked
server-side by `isAdmin` (`api/_lib/auth.ts`), by *email* so it survives the
dev→production Clerk move that mints new uids. Unset means nobody, which is the
right default for a role that can hard-delete other people's work. The console
(`?admin=1`) has two tabs, both 404 rather than 403 for everyone else:
`api/admin/projects.ts` (every live project, guests included) and
`api/admin/users.ts` (every Clerk account, with the project counts stitched on
from Postgres — the only place the two stores are joined). Guests can never
appear as users, so that endpoint reports them as a separate tally, and
surfaces owner ids whose account is gone; both exist so the numbers on the two
tabs reconcile instead of quietly disagreeing. **`ADMIN_EMAILS` is a
`sensitive` env var in Vercel — write-only.** Neither the API nor `vercel env
pull` will read it back (both answer `""`), so never treat an empty read as
"unset": setting it overwrites whatever was there, unseen.

**The 12-function ceiling is gone — the team is on Pro (verified 2026-09-07),
where "Functions Created per Deployment" is unlimited.** It bound us on Hobby,
which is why restore/purge are query verbs on `[id]/index.ts` and the Drive byte
proxy a query verb on `browse.ts` rather than routes of their own — and `/api`
sits at 14 function files. Keep that shape where it reads well (the verbs
are genuinely about the same resource), but a new endpoint no longer *has* to be
folded into an existing function. If this ever drops back to Hobby, the symptom
returns as a `patchBuild` failure
(`exceeded_serverless_functions_per_deployment`) whose build log looks
*successful* — the error lives only in the deployment's API record.

**Guests** (students, who have no accounts) are the third kind of caller: the
landing page's paste field (`src/components/LandingPage.tsx`) mints one project
whose *key is its URL* — a capability token, SHA-256 at rest, owner
`guest:<uuid>`, rate-limited per hashed IP (`api/_lib/guest.ts`,
`src/lib/guest.ts`; the cap is loose because a school NATs a whole class behind
one address). A guest writes content **and** their own `source`/`settings` —
never sharing/publishing/ownership — so unlike a link editor they can load the
video they came to annotate, and pick either project kind (listening notes or a
song-section board) before they start.

One thing a guest deliberately can't reach: **source is video only** (YouTube
or Drive). The landing offers no blank start, so App passes no `onAudioUrl` to
`SourcePicker` — otherwise a sourceless guest row (they predate this) would be
a door into a source kind nothing else in their flow produces.

**Guests upload note images too** (since 2026-09-07). Their key authorizes it:
`@vercel/blob/client` carries no custom headers, so the key travels in the
SDK's `clientPayload` and `api/blobs/upload.ts` verifies it against the row
exactly as `projects/[id]` does, then pins the path to that one project. Their
token is narrower than a teacher's — images only, 8 MB, no overwrite. Images
land under `users/guest:<uuid>/images/{projectId}/`, the *same* shape as
everyone else (a colon is legal in a Blob pathname, `%3A` in the public URL),
which is what makes the existing purge sweeps collect them for free — so keep
using `users/{owner_id}/…` rather than inventing a guest prefix. `blobs/gc`
takes a guest key for the same reason. Note images are still the only bytes we
host, and the editor's `allowImages={false}` switch survives so that "images
are impossible here" can never silently become "base64 them into
`annotations`". **Detect sections is hidden
too**, though no longer for a guest-specific reason: `api/projects/[id]/analyze.ts`
is now **admin-only** (owner *and* `ADMIN_EMAILS`), because each press is a paid
Replicate run plus ~130 MB of stem WAVs. It answers 404 to everyone else, guests
and ordinary owners alike, and App hides the button behind `useIsAdmin()`
(`src/lib/admin.ts`) — a display hint fetched from
`/api/admin/projects?whoami=1`, never the security. Their project is born `shared`, so the `?view=`
link they hand in is the existing read-only viewer. **Ids are short and opaque.** Project/note/folder ids are 12 base64url
characters (9 random bytes, 72 bits) from `src/lib/ids.ts`, not uuids — a
project id is the whole credential for a `?view=` link, and a uuid spent 36
characters carrying it, which pushed share links to ~69 characters and guest
links to ~118 and got them flagged as tracking payloads by ad blockers. Guest
keys are 22 characters for the same reason. Both are minted client-side into a
`text` column, so **existing uuid rows and every link already handed out keep
working** — never parse an id or assume its shape.

The 80 projects that predate short ids keep their uuid *key* (it's baked into
their Blob paths and into links already distributed) and carry a short `alias`
column alongside, backfilled by `scripts/backfill-aliases.mjs`. So a project
has a key and a public id: **build every user-facing URL through `publicId()`
(`alias ?? id`), never `p.id`**, or old projects keep emitting 69-character
links. `getProjectRow` resolves `id OR alias`, and every route that writes
canonicalises to the row's real id first — an alias must never reach a Blob
path or the purge sweeps would lose the bytes. Both identifiers are
unguessable, so neither is the weaker door. On load the app swaps a legacy uuid
in the address bar for the short form (`canonicalizeProjectParam`), which is
why no redirect route was needed. Schema lives
in `scripts/schema.sql` (apply with `node --env-file=.env.local
scripts/apply-schema.mjs`). Config comes from the linked Vercel project:
`vercel env pull` writes `.env.local` (client reads only
`VITE_CLERK_PUBLISHABLE_KEY`; functions read `DATABASE_URL`,
`CLERK_SECRET_KEY`, `BLOB_READ_WRITE_TOKEN`, and `REPLICATE_API_TOKEN` —
the last powers AI song-section detection, `api/projects/[id]/analyze.ts`). Local dev with API:
`npm run dev:full` (vercel dev); UI-only: `npm run dev`.

**Note properties come in two shapes.** The `elements` *block*
(`src/plugins/elements/`, the "+ Property" menu, `lib/notePlugins.ts`) collects
the whole concept grid into one panel under the note. **Inline property tags**
put a single value in the prose instead — a coloured token that reads as part
of the sentence (the concept itself is the tooltip, and a print-only suffix in
the two PDFs), draggable anywhere in the text. Two ways in: the `@` menu, which
still lists note cross-references below the properties so there is one trigger
key rather than two (`src/components/noteMention.ts`), and **typing the term in
ordinary prose** — an input rule on `PropertyTag` tags an unmistakable word the
moment it ends, and Backspace puts the plain word straight back. Which words
qualify is `AUTO_TERMS` in `lib/propertyTags.ts`: an allowlist on purpose, and
a narrow one, because "even", "light", "clear" and "major" are ordinary English
several times a paragraph and a chip must not land in the middle of one.

**The `@` menu narrows like an editor's completion list**, which is what the
420-word vocabulary needs: `searchProperties` (`src/lib/propertyTags.ts`) reads
a leading run of words as a *scope* and matches the rest inside it, so
"@timbre bright" is Bright within Timbre — and then, deliberately, every other
word in Bright's field follows it down the list, because "what could I say
instead of bright?" is the question the menu exists to answer. That needs
`allowSpaces` on the suggestion, which would otherwise match `@` plus the whole
paragraph; a four-word cap and a menu that *hides* itself when nothing matches
are what bound it. **The vocabulary is synced from Notion, not hand-written.** The words live in
the owner's "Concept vocabulary" database (HSC & Trial marking guidelines);
`npm run sync:vocab` (`scripts/sync-vocabulary.mjs`) pulls them and rewrites
`src/lib/vocabulary.generated.ts`, which is the only place `ELEMENTS` is
defined — never edit it by hand. **Notion owns the words; the script owns the
shape.** Its `CATEGORIES` config decides which concept a Notion category lands
in, the field order, and the eight hues (matched to the owner's concept nav,
where Dynamics/Expression and Performing media/Timbre are paired, so each pair
shares a colour family — AA-verified in both themes). `OWN` holds the lists the
bank has no equivalent for (performing media, the ppp–fff ladder, Layer role,
and the Italian markings split by concept). A new *category* in Notion is
reported as unmapped rather than guessed at. `--check` fails when the file is
stale, and the run flags any `AUTO_TERMS` entry the vocabulary no longer has.
**A button in the Notion page pushes it.** `npm run build` runs the sync first
(the `prebuild` script, `--soft`), so the deploy reads Notion and the words ship
inside the bundle; `POST|GET /api/sync-vocab?key=…` fires the project's Vercel
deploy hook, and the Notion page's button block calls that. So the press costs a
rebuild, not a runtime dependency: nothing in the running app ever reaches
Notion, and an outage or a revoked token costs a stale word list rather than an
empty `@` menu (`--soft` falls back to the committed file and never fails a
build). Three env vars, all Vercel-side: `NOTION_TOKEN` (build), plus
`VOCAB_SYNC_SECRET` and `VERCEL_DEPLOY_HOOK_URL` for the endpoint, which refuses
to run unless both are set. The secret rides in the query string because a
Notion webhook action sends no custom headers — the whole URL is the credential,
like a guest link.

**Field ids are stored data** (the keys of `ElementsData.fields`, the
`data-field` of every chip), so relabel freely and rename an id only after
checking the database says nothing stores it.

The chip is a TipTap inline atom (`src/components/propertyTag.ts`, view in
`PropertyTagView.tsx`) that lives **inside the note's rich-text HTML** — no new
field on `Annotation`, so it needs no schema, no API whitelist entry and no
line in `projectJson.ts`; it travels wherever `contentHtml` travels, and
`propertyTagsInHtml()` reads the values back out structured. Its markup carries
its own colours: `--hue` for fills on either theme, and `--hue-ink` (an
`hueText`-darkened hue) for text on white paper, because the two print
documents that inject note HTML raw — `lib/exportPdf.ts` and
`lib/answerSheet.ts` — have no React to resolve a theme and share
`PROPERTY_TAG_PRINT_CSS`. Add a category to `lib/musicElements.ts` and it
appears in the `@` menu, the elements grid and both PDFs at once.

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
