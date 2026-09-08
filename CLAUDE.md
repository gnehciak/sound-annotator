# Sound Annotator

A web app for time-anchored music annotation in the classroom: load a video
(YouTube or a Google Drive file) or link a direct audio-file URL, then attach
timestamped rich-text notes that seek the player when clicked. **Audio is never
uploaded** — a track's sound is always a link, and wavesurfer streams it from
wherever it lives, so the host's CORS policy decides whether it loads (see
`src/components/AudioUrlForm.tsx`). The only bytes we host are note images
and uploaded PDF scores.

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
note images and uploaded scores in Vercel Blob
(`users/{uid}/images/{projectId}/…` and `users/{uid}/scores/{projectId}/…` —
the paths `api/blobs/upload.ts` accepts, alongside the ephemeral
`analysis/`; legacy `users/{uid}/audio/…` objects are served and deleted but
never written). The SPA calls Vercel Functions in `/api`
(Web signature), which enforce all authorization — owner-only access,
share-by-unguessable-id for `?view=` links, link-editor field clipping, and
the server-stamped edit lock (see `api/projects/[id]/index.ts`).

**Sharing is two independent halves, and there is only ever one URL.** The
*link* (`shared` / `editable_by_link` / `published`) says what anyone holding
`?view=<publicId>` may do; the *people* list (`project_shares`, one row per
invited email) says what one named person may do on top of that. So a
read-only link handed to a class plus an `editor` invite sent to a colleague is
the ordinary shape — neither setting has to be weakened to express the other.
Publishing is **not** a second link: the Browse card opens that same `?view=`
address, so `published` implies `shared` and is refused while
`editable_by_link` is on (the PUT coerces the pair rather than trusting the
client). Invites are keyed by **email**, like `ADMIN_EMAILS` and for the same
reason — the row is written before the person has necessarily signed in, and it
survives a Clerk instance move. An `editor` invite carries exactly the link
editor's rights (content fields only, same edit lock); a `viewer` invite
carries exactly a view link's. Because none of that is legible from the project
row, every read stamps `myRole` on the response (`api/_lib/db.ts`) — that, not
a client guess, is what makes the share viewer offer an Edit button to an
invited editor. `api/projects/[id]/shares.ts` is owner-only on all three verbs,
deliberately including the admin: an allowlist that can hard-delete work has no
business quietly widening access to it.

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
`api/_lib/db.ts`) plus **every** blob prefix a project owns (images, scores,
legacy audio, stems, analysis — keep it in step with App's `purgeProject`,
since a prefix only one of them knows is bytes nobody collects) and its
`project_shares` rows, by the row's real id (an alias must never reach a delete
predicate, or the invite rows outlive the project they name). Daily, and gated on a
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
takes a guest key for the same reason. Guests never *upload* anything else —
their token is images-only, so the score they can attach is a Drive link, not
a PDF of their own — and the editor's `allowImages={false}` switch survives so that "images
are impossible here" can never silently become "base64 them into
`annotations`". **Detect sections is hidden
too**, though no longer for a guest-specific reason: `api/projects/[id]/analyze.ts`
is now **admin-only** (owner *and* `ADMIN_EMAILS`), because each press is a paid
Replicate run plus ~130 MB of stem WAVs. It answers 404 to everyone else, guests
and ordinary owners alike, and App hides the button behind `useIsAdmin()`
(`src/lib/admin.ts`) — a display hint fetched from
`/api/admin/projects?whoami=1`, never the security. Their project is born `shared`, so the `?view=`
link they hand in is the existing read-only viewer.

**Every place in the app is a URL** (`src/lib/nav.ts`). There's still no
`<Router>` — a project id *is* a share credential and `?view=` links are
already out in the world, so the route is a query param on one page: `?` the
library, `?folder=` a folder, `?trash=1` the trash, `?browse=1` the Browse
gallery, `?track=` the editor, plus the two pages that mount outside the app
shell (`?view=` and `?admin=1[&tab=users]`). The query is the *only* copy of
where you are — nothing mirrors it in React state — so anything that navigates
calls `navigate()` and anything that needs to know calls `useRoute()`. That's
what makes Back and a phone's edge-swipe work; App has one effect that
reconciles the open track to the route, and back/forward need no special case
because they're just another way the route changes. Only the three root shells
are a real page load (different chrome, different auth); everything inside the
app is client-side. When adding a place worth returning to, give it a route
rather than a `useState` — and resolve a project param with `resolveProject`,
never `p.id === param`, since the address bar may carry a legacy row's short
`alias` instead.

**There is one Browse gallery, not two.** `?browse=1` is the Browse *route*:
signed in it's the home page's Browse tab, signed out it's the landing page,
which already carries the same `BrowseGallery` under its paste field (and
scrolls to it when that's the route you arrived on). The standalone public
gallery page it used to open was the same list a second time, so it's gone —
old `?browse=1` links keep working because the spelling didn't change.

**Ids are short and opaque.** Project/note/folder ids are 12 base64url
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

**Notes can take over the picture** (`src/lib/overlays.ts`,
`src/components/VideoOverlays.tsx`). A note's optional `overlay` field carries
a **cover** (a full-frame image that stands in for the video while the audio
keeps playing) and/or a **pin** (a dot at `pinX`/`pinY`, 0–1 fractions of the
frame, captioned with the note's own text). Both are aimed **on the frame
itself**, by dragging: a pin goes where the pointer goes, and a `Fill` cover
slides under the window to choose which part survives the crop
(`coverX`/`coverY`, CSS `object-position`, absent meaning dead centre). Only
the note open in the inspector is draggable, and only then does the layer take
the pointer at all.

**A pin is placed by dragging it out of the inspector** onto the picture — and
where it lands decides what it is anchored to, because the thing you dropped it
on *is* the answer. What you drag is the pin itself: a recessed round key in
the inspector holding the dot in the note's own hue, ringed white, exactly the
object `PinLayer` draws out there (`NoteOverlayControls`). A press that never
travels `DRAG_SLOP` is a click, which drops it dead centre — or takes a placed
pin off again — so the key is still the on/off switch it replaced, and the
arrows nudge a placed pin by 1% (5% with ⇧), the one path to a position that
needs no pointer. `src/lib/pinTargets.ts` is a tiny registry the two drop
boxes register themselves with (VideoOverlays the frame, ScoreLayer the drawn
page), so the drag can ask what it is over without refs being threaded up
through App and back down. Hit-testing is by rectangle rather than
`elementFromPoint`, deliberately: both layers are `pointer-events: none` so
they don't eat the player's clicks, and `elementFromPoint` skips exactly those.
The score is tested first because its page sits *inside* the frame, so over the
page both boxes contain the point and the page is the more specific answer.
VideoOverlays therefore renders its (empty, inert) root even with nothing on
it — the moment you most want to drop a pin is when the note has none.

**A pin can be aimed at the score instead of the picture** (`pinAnchor:
'score'` + `pinPage`). Its fractions are then of the *drawn page* of the PDF
score, not of the frame, so it marks a place in the music and keeps it through
every rescale, refit, expand and scroll — which is not arithmetic anyone
maintains: the pin is a percentage inside the page box, and the page box is
what resizes. That is why `ScoreLayer` wraps its canvas in a sized `relative`
div, and why both kinds of pin are drawn by one `PinLayer` — every position in
it is a percentage, so the same component serves two boxes. VideoOverlays
draws `!isScorePin` and ScoreLayer draws the rest, filtered to the page on
screen: a score pin whose page isn't up, or whose score is off, isn't drawn at
all, because there is no page box for it to be a fraction of and a dot
floating over the video at those coordinates would mean nothing there. The one
thing `PinLayer` needs told is `spill`, since a caption's width cap is a
percentage of its box — right for a wide frame, and a column of one-word lines
on a portrait page. Cover images arrive by clicking the inspector's cover slot — a 16:9 well
beside the pin key that echoes the frame's shape and *is* the thumbnail once
set — *or* by dropping a file anywhere on that row, and every one is downscaled to 1600px
and re-encoded before upload (`fileToScaledBlob` — WebP where the source can
carry transparency, else JPEG at 0.85; measured 7× on a phone photo, 67× on a
PNG screen grab). Both show over the note's window —
its `start`→`end`, or `hold` seconds (default 4) from `start` for a point note
— *and* whenever the note is open in the inspector, so a cover can be composed
without scrubbing onto its moment. Video sources only, the same line
`clipStart`/`clipEnd` draw: an audio track's waveform is the picture. The layer
rides PlayerPane's existing `overlay` slot, painted *before* the transport so
the transport stays clickable over a cover; it is `pointer-events-none`
except where it has to take the pointer — the selected note's pin and filled
cover, and the caption cards, which need it to reveal their close control.
Because a card therefore covers the player's own click-to-pause catcher, it
does that job itself: `PinLayer` takes an `onTogglePlay` the hosts wire to the
same handler the transport uses. Closing a caption (the ✕ on hover) is a
*viewing* decision, never an edit — it lives in `PinLayer` state, saves
nothing, and lasts until the dot it leaves behind is clicked.

The layer is **always dark, in both themes** — it sits on the picture, where the
light page's surfaces mean nothing — so note hues on it go through
`hueOnDark()` rather than `hueText()` (`src/lib/noteColors.ts`); the two are
mirror images, one lifting a hue toward white for a dark box, the other mixing
it toward ink for the white page.

The trap to remember: **a cover image is a note image that isn't in the note
HTML.** It lives under the same `users/{uid}/images/{projectId}/` prefix, so
purge sweeps collect it for free — but `api/blobs/gc.ts` decides what's an
orphan by matching blob URLs against the strings it's handed, and
`lib/copyProject.ts` re-uploads by scanning HTML. Both are fed
`coverUrls(annotations)` alongside the HTML; drop that and the GC deletes live
covers on the next project open. Anything else that walks a project's images
must read it too.

**PDF scores** (`src/lib/score.ts`, `src/components/ScoreLayer.tsx`): a track
can carry the printed music, drawn over the picture so the page and the sound
arrive together. It lives at `settings.score` — inside the existing jsonb, so
it needs no schema or API change and an owner *and* a guest can set it (both
may write `settings`), exactly like the project `kind`.

Two ways in, and the difference is the point. A **Drive link** is a link: the
teacher annotates the same file in Drive and every reader picks up the new
version, no re-upload and no new link — but only while the annotation tool
writes back to the *same file id* ("Manage versions → Upload new version" is
the safe route; a tool that "saves a copy" mints a new id and silently strands
the link). Its bytes can't be fetched from Drive by a browser for the same two
reasons a Drive video can't, so they come through the same proxy with a second
verb: `GET /api/browse?drive=<id>&pdf=1`, which asserts a PDF, caps it at
30 MB, and — unlike the video path — is *shared*-cacheable (`s-maxage=300`),
which is what keeps a class of thirty opening one score down to one fetch from
Drive. The reader's Reload bumps a `&v=` that changes the cache key. Note the
proxy's live-project fence now matches `settings->'score'->>'driveFileId'` as
well as the source's id; a score whose track is trashed goes dark with it. An
**upload** is bytes we host (signed-in owners only — a guest's token is
images-only), fixed at upload time.

Rendering is pdf.js (`src/lib/pdf.ts`, the only file that knows it exists),
lazily imported so a track without a score never pays for the ~430 KB chunk or
its worker. Renders are serialized through a chain: pdf.js refuses two renders
onto one canvas and cancelling isn't instant, which a fast page-flip produces
immediately. An `<iframe>` of the PDF would be free but exposes no page
control, and turning the page is the whole feature.

The layer sits between the picture and the transport (PlayerPane's `score`
slot), so 'score' mode can be fully opaque with the transport still reachable;
'overlay' drops the ground and dims the *page* instead.

**Three layers share the video frame**, and the score is the one that moves.
Note covers and pins sit at `z-10` and the transport at `z-20`; the score
paints at `z-[5]` — just under the covers — or at `z-[15]` when the score's
`onTop` is set, and never above the transport whatever the setting. The order
is a z-index rather than a position in the JSX so that flipping it doesn't
remount the layer and re-fetch the PDF. Default off, because a note that takes
over the picture is a deliberate interruption and the score is the steady
background to the whole track; a track whose score is the point and whose
covers are asides turns it on. An audio track's
waveform is the picture and must stay uncovered, so its score takes its own
frame above — the same rule the transport follows. A 16:9 frame is a poor
window on a portrait page, hence the expand button: the same document and page
drawn to the whole viewport through a **portal**, which is required rather
than stylistic — `.glass` uses `backdrop-filter`, and that makes an ancestor
the containing block for `position: fixed`.

**Page turns** (`score.turns`, `ScoreSync.tsx`): a sorted `{ t, page }[]` in
clip time — the same clock the notes use, so App's `setClip` shifts it along
with them. A *list of turns*, not a time per page, because music repeats: a da
capo brings a page back at a later moment, which a page→time map can't say.
`pageAt` binary-searches it; before the first turn the score sits on the page
that turn leaves from.

A synced score turns its own pages, with one rule worth knowing: **a reader
who looks ahead is peeking**, and the peek remembers which followed page it
was taken from, so it expires by itself the moment the music reaches the next
turn. Nothing to time out, nothing to press to resume — though the chrome
offers a Follow chip for going back at once. The sync workspace suspends
following entirely: the page on screen is the one being timed and must not
move under the person timing it.

Timing them is one button. Press play and hit **Turn here** at each turn and
you've made a live pass; pause, scrub, and hit it and you've placed one turn
by hand — which is also how a wrong one is fixed, since nobody should replay
eight minutes to move page 12. The **lead offset** (default 0.3 s) is what
makes the live pass usable: the press always lands after the moment it marks,
by roughly a constant, so the stamp goes in that much earlier. Note a live
pass can't be run much faster than 2× on YouTube — the iframe API caps there
(`Transport`'s `RATES` already does) — while Drive and audio reach 4× before
Chrome mutes them, and you need the audio to know where you are.

**The note inspector is three groups, split by what they act on**
(`NoteInspector.tsx`). The note's **time** is a `well` — its own transport:
Begin, a scrubber through the note, End, and the length as an LED readout
flanked by − / +. The stepper moves *End* only, so trimming never loses the
moment the note is cued to; ⇧ steps 5s, a held key repeats, and stepping under
a second clears the end outright, which is how a range becomes a point note
again (and takes `structure` with it, since a section brackets a span). The
note's **record** — tags plus Section, Question and Bar — is a rail of
`chip-outline` switches, each one's field revealed only when it is on; turning
Bar off clears the value, so what the panel hides is never data. What the note
puts **on the picture** is two objects rather than switches (the cover slot and
the pin key, above). The note's colour and its delete button live in the host's
title bar, which every presentation already pays for — `PluginWindow` takes
them as `leading` / `actions`, and App supplies them.

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
are what bound it.

**The vocabulary is synced from Notion, not hand-written.** The words live in
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
the project `kind`, e.g. song-structure boards) pass through automatically;
object-valued ones do not — `score` is the only one so far, and it carries its
own `sanitizeScore` pass. An uploaded score is also re-hosted by
`copySharedProject`, like a note image: a copy pointing at the original's blob
would go blank the day that project is purged.
Bump `PROJECT_JSON_VERSION` only on breaking shape changes.

**The schema is published, so it can't be allowed to go stale.**
`public/track-schema.md` is the human- and LLM-readable spec of that envelope,
served raw at `/track-schema.md` (a `vercel.json` header — and a small dev
plugin in `vite.config.ts` — force `text/plain; charset=utf-8`, or the em
dashes come back as mojibake). The Import menu on the home page links it and
copies its URL, because the point of it is that a teacher with a listening
guide and no export to copy hands the link to an AI assistant and gets a
valid track file back. `scripts/check-schema-doc.mjs` runs as the first step
of `npm run build`, so a field added to `Project` / `ProjectSource` /
`Annotation` / `NoteBlock` / `ProjectSettings` without a row in that doc
fails the deploy. It also checks the reverse (a documented field that no
longer exists) and that every documented, exported field is actually named in
`projectJson.ts` — the maintenance contract, enforced rather than trusted.
The doc's `<!-- fields: X -->` markers are what the check reads.

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
