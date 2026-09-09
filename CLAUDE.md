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
wavesurfer.js. Backed by Vercel: **Sign in with Google, and nothing else** —
our own OAuth 2.0 + PKCE flow straight to Google (`api/auth/[action].ts`), with
the session as an HS256 JWT in an httpOnly `SameSite=Lax` cookie
(`api/_lib/session.ts`). There is no identity provider in front of it and no
password anywhere: accounts are rows in the `users` table, and `users.id` is
what every `owner_id` and Blob path points at. The client holds no auth
config and cannot read the cookie — it asks `GET /api/auth/me` who it is —
which is why `SameSite=Lax` is the CSRF defence and **no state-changing route
in `/api` may ever be a GET**. Projects/notes in
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
server-side by `isAdmin` (`api/_lib/auth.ts`), by *email* so it survives a
change of uid — which has already earned its keep once, at the move off Clerk.
Unset means nobody, which is the right default for a role that can hard-delete
other people's work. The console
(`?admin=1`) has two tabs, both 404 rather than 403 for everyone else:
`api/admin/projects.ts` (every live project, guests included) and
`api/admin/users.ts` (every account, with its project counts). Guests can never
appear as users, so that endpoint reports them as a separate tally, and
surfaces owner ids whose account is gone; both exist so the numbers on the two
tabs reconcile instead of quietly disagreeing. **`ADMIN_EMAILS` is a
`sensitive` env var in Vercel — write-only.** Neither the API nor `vercel env
pull` will read it back (both answer `""`), so never treat an empty read as
"unset": setting it overwrites whatever was there, unseen.

**The 12-function ceiling is gone — the team is on Pro (verified 2026-09-07),
where "Functions Created per Deployment" is unlimited.** It bound us on Hobby,
which is why restore/purge are query verbs on `[id]/index.ts` and the Drive byte
proxy a query verb on `browse.ts` rather than routes of their own, and why
sign-in is four actions dispatched off one `api/auth/[action].ts`. Keep that
shape where it reads well (the verbs
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
`/api/admin/projects?whoami=1`, never the security. It is also **only offered on
the song-structure board**: what it produces is a span per section, which *is*
that board, and on a listening guide it would bury the teacher's own notes
under a dozen machine ones. Their project is born `shared`, so the `?view=`
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
`vercel env pull` writes `.env.local` (the client bundle reads **nothing**;
functions read `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, and `REPLICATE_API_TOKEN` — the last
powers AI song-section detection, `api/projects/[id]/analyze.ts`). The Google
OAuth client is the one thing Vercel doesn't provision: it lives in Google
Cloud console, and its registered redirect URI must match
`{origin}/api/auth/callback` byte for byte (`AUTH_ORIGIN` overrides the origin
when a deployment is reached on a hostname Google doesn't know). Local dev with API:
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
where it lands decides *which pin* it is, because the thing you dropped it on
*is* the answer. What you drag is the pin itself: a recessed round key in
the inspector holding the dot in the note's own hue, ringed white, exactly the
object `PinLayer` draws out there (`NoteOverlayControls`). A press that never
travels `DRAG_SLOP` is a click, which drops it dead centre — or takes a placed
pin off again; with two pins to choose between, a click means **the surface in
view** (the column is showing the picture or the score, and that is the honest
answer to which one you meant), and the arrows nudge that same one by 1% (5%
with ⇧), the one path to a position that needs no pointer.
`src/lib/pinTargets.ts` is a tiny registry the drop
boxes register themselves with (VideoOverlays the frame, each drawn page of
the score its own box — several are on screen at once now that the score
scrolls), so the drag can ask what it is over without refs being threaded up
through App and back down. Hit-testing is by rectangle rather than
`elementFromPoint`, deliberately: both layers are `pointer-events: none` so
they don't eat the player's clicks, and `elementFromPoint` skips exactly those.
The score is tested first because its page can sit *inside* the frame (the
`overVideo` overlay), so over the page both boxes contain the point and the
page is the more specific answer.
VideoOverlays therefore renders its (empty, inert) root even with nothing on
it — the moment you most want to drop a pin is when the note has none.

**A note has two pins, not one with a switch** — `pinX`/`pinY` on the picture,
`scorePinX`/`scorePinY`/`scorePinPage` on the drawn page of the score. They
answer different questions (where on the screen, where in the music), so a note
may carry one, the other, both or neither, and dropping one never disturbs the
other. The score pin's fractions are of the *page box*, so it keeps its place
through every rescale, refit, expand and scroll — which is not arithmetic
anyone maintains: the pin is a percentage inside the page box, and the page box
is what resizes. That is why `ScoreLayer` wraps its canvas in a sized
`relative` div, and why both kinds are drawn by one `PinLayer` — every position
in it is a percentage, so the same component serves two boxes. The choice of
which pin belongs to which box is made once, in `framePins` / `scorePinsOn`
(`src/lib/overlays.ts`), which hand `PinLayer` a `PlacedPin` — the note plus a
position — so nothing downstream knows a note can have two. A score pin whose
page isn't on screen isn't drawn at all: there is no page box for it to be a
fraction of. The one thing `PinLayer` needs told is `spill`, since a caption's
width cap is a percentage of its box — right for a wide frame, and a column of
one-word lines on a portrait page.

Notes written before the score view carried one pin plus a `pinAnchor: 'score'`
switch. `withMigratedOverlay` converts that on read (in `toProject`, beside
`withBlocks`) and the JSON importer does the same, so nothing downstream — and
no old export or `?view=` link — has to know the shape ever existed.

**A score quote is a rectangle, never an image** (`overlay.quotes`,
`components/QuoteFrame.tsx`, `components/QuoteGallery.tsx`,
`lib/quotePreview.ts`, `lib/quoteImages.ts`).
Where a pin says *where*, a quote says *what the note is about*: a region of a
page of the PDF score, which the note then **carries as a picture** — at the
top of its row in the notes list, like a card's cover; as a thumbnail in the
inspector; and beside its text in the exported documents, so a handout carries
the bars it is discussing instead of a timecode the reader has to go and look
up. Fractions of the page, like everything else aimed at one, and placed by the
same gesture as the pin: a third key in the inspector row, dragged onto the
page being quoted, then resized in place by its corners.

**A note carries several, as a gallery** — `overlay.quotes`, in the order they
were placed, capped at `MAX_QUOTES` (8) and free to sit on different pages. A
passage is often two places at once (the figure and the answer to it; the voice
and what is under it), and one rectangle per note filed that observation twice
and cued it to two moments. The gallery is **horizontal** wherever it is drawn
— the note's row, the inspector — because a quoted system is wide and short,
and stacking them would push the note's own words off the row; several scroll
sideways rather than shrinking until none is legible. In the printed documents
they stack down the Example column instead, where the column is narrow and the
page is tall, and the *whole stack* is scaled to `EXAMPLES_MAX_H` together
rather than each picture on its own — two systems off one page printed at two
magnifications stop being comparable. Notes written before this carry one
`quote`; `withMigratedOverlay` folds it in on read, and the importer does the
same, so nothing downstream knows that shape existed.

**The score is the only surface**, and that is a correction rather than a
limit. A quote could once be aimed at the *picture*, where it cropped the
note's **cover** — the only still of the frame this app can read, since a
YouTube player is a cross-origin iframe whose pixels are unreachable to page JS
at any moment, on any browser — so it printed nothing on the notes (most of
them) that carry no cover. So the frame is not a drop target for the quote key,
the key itself appears only once the track has a score, and a note written
before this has its video quote dropped on read (`withMigratedOverlay`,
`sanitizeQuote`). Note the gate the key inherits: the whole stage row is
rendered for video tracks only, so an audio track with a score can't quote it
yet.

Storing a rectangle rather than an image is the whole design, and it buys
three things: a quote costs no upload, it adds **nothing** to the blob sweeps or
to `copyProject` (the two places a stored image would have to be taught about),
and a Drive score whose file gains a new engraving quotes the new engraving
from then on. The pixels are cut out of a page pdf.js rasterises for the
purpose — twice over, and the two are worth keeping apart. `lib/quoteImages.ts`
is the **export** pass: every quote in the project at print resolution, under
one deadline and one progress arc, because a score is fetched over the network
and an export that waits forever on a Drive file nobody shares any more is
indistinguishable from a broken one. `lib/quotePreview.ts` is the **screen**
pass: small crops asked for one note at a time while a list scrolls, so it
shares one open document (released after a minute's quiet), one raster per page
and one cache of crops across every row, and renders them one at a time —
twenty notes mounting at once would otherwise start twenty pdf.js renders in
the same instant. Both go through `cropImage`, and every crop comes back as a
**JPEG**: the export's consumers are a PDF and a .docx, which want bytes rather
than a styled window, and the same bytes are what an `<img>` on a row takes.
Reading a note's own inline pictures that way is cross-origin — fine, since the
Blob store answers `access-control-allow-origin: *`, but the request has to ask
for CORS and a tainted canvas is caught rather than thrown.

**What is aimed at the score stays on the score** (`quotesOn`,
`scorePinsOn`). Quotes and score pins are **not time-bound**, unlike anything
on the picture: a cover or a video pin is one note taking over the frame for
its moment, but the score is a *document being read*, its marks are all there
at once, and a rectangle that came and went with the music would be missing
from the page exactly when someone turned back to it. So every page shows
everything aimed at it, editor and reader alike, and the clock decides nothing
there. Only the note open in the inspector can *move* its rectangles
(`readOnly || note.id !== selectedId`) — handles on all of them would make the
page a field of things to catch by accident. **Pressing a frame plays the
note** — a
rectangle is a region of the music, so the honest answer to a press on it is
to hear that music, and the note's row scrolls into view with it; a press that
travels `DRAG_SLOP` is the aiming drag instead, so the editor keeps both
gestures on one rectangle. Only where the score is *read* (`reading` — its own
view of the column, or expanded): over the video the layer is background, and
a rectangle that swallowed the picture's own click-to-pause would cost the
class more than it gave them. `hasOverlay` still doesn't count a quote — that
predicate decides who is on the *stage*, and the frames are drawn from the
quotes themselves — and the notes list still keeps the quote chip beside the
pictures: the pictures show the regions, the chip names the pages they came
from.

**The two exports write real files** — `lib/exportPdf.ts` (pdf-lib) and
`lib/exportDocx.ts` (OOXML by hand, zipped with `fflate`) — rather than opening
an HTML report with a "Save as PDF" button on it, which put a page between the
press and the document and left the result at the mercy of whatever the print
dialog was last set to. Both render **one model**, `lib/studyDoc.ts`. Every
decision about what the document *says* belongs in that model; the two
renderers know only about pages and columns, or about paragraphs and tables,
and the one thing they must never disagree on is the content.

The shape is the marking-guide grid a music teacher works in, **carrying this
app's own structure** rather than a blank template's. *Where* is the first
column, because a timecode is this app's primary coordinate — a study note
nobody can find in the recording is half a note — with the bar or rehearsal
mark under it. It is narrow, and deliberately narrower than a two-digit range
needs, since the analysis should not pay all year for a width `13:53–15:12`
wants: the PDF folds a range after its dash instead (`foldSpan`), the one place
it reads as continuing, rather than cutting it mid-number as plain wrapping
does. *Example* is the note's score quotes, stacked in the order it placed
them, each captioned with the page it was cut from — and captioned from the
note's own rectangles rather than by position, so a gallery that came back
short (one crop the score wouldn't give up) prints without captions instead of
with every later picture labelled the wrong page.

**One table, in time order.** The notes were filed under their first inline
property tag once (`Element(s) / Sub Element(s) — Timbre / Bright`, one table
each, `Ungrouped` last), and it cut the reading in two: a listener works
forwards through a recording, and a document that reorders the notes by topic
makes them hunt for the next one. The tags are still on every row, which is
where a reader wanting them by element can see them. Above the table,
**structure notes get their own and come out of the grid entirely** — a note
that brackets a span *is* the song-structure board, and printed among the rest
it would read as one more observation instead of the frame the others sit
inside. What is left over
rides as a strapline over the analysis, and only what the prose itself cannot
say: whether the note is a question, and its tags. The concepts the note names
were there too and are not any more — they were `propertyTagsInHtml` in
document order, so a thoroughly tagged note opened with forty badges naming the
same handful of concepts four and five times over, restating an inch above the
prose, stripped of the sentences that gave them their meaning, exactly what the
chips below say in place.

The analysis column is the note's own words **as they were written**. A note
is composed in a rich-text editor, and flattening it to a string on the way out
loses exactly the part the writer used to mean something — the emphasis, and
the coloured chips that say which concept a word is. So `studyDoc` carries
`DocRun`s (bold / italic / underline / strike / code, ink and ground) inside
`DocBlock`s (paragraph, heading, quote, list item), and each renderer maps a
run onto its own idea of a styled span: pdf-lib picks a face and paints a
ground, Word gets a `w:rPr`. A chip keeps the ground the app's own print
stylesheet gives it — the hue at 13% over white, AA-safe ink — and nothing
else. Not the weight, since three marks on one word is decoration and the
ground already says a claim is being made; and not the concept spelled out
after the value, which was tried and printed `(Duration)` eleven times in a
single cell, because a note tagged as thoroughly as this app invites is a
sentence with a parenthesis after every other word. The note's own hue rules
its row, as it does everywhere else in the app.

The PDF draws a line's grounds **before** any of its glyphs, in two passes over
the same pieces. A chip's ground is 1.5pt wider than its word on either side
(the bleed the app's print CSS gives it), so painting each piece in turn let
each chip rub out the tail of the character before it — "(theme" came out as a
chip with a stub of a bracket beside it.

The note's **own inline images** come too, at the width they were dragged to
(CSS pixels, so the PDF converts at ¾ to the point; the .docx goes through EMU
and gets it for free). They are fetched and re-encoded to JPEG in the same pass
as the quotes, since neither renderer takes a PNG or a WebP — hence
`collectPictures`, which returns quotes keyed by note and images keyed by URL
under one deadline and one progress arc. An image that can't be fetched leaves
*nothing* behind: a broken frame in a handout is worse than a paragraph that
reads without it.

Three consequences worth knowing. The PDF needs **run-aware line breaking**:
the appearance changes *inside* a line, so measuring a paragraph in one font
wraps it in the wrong place — the more so since the chips are the widest thing
in the prose. Lists are **marked paragraphs, not real lists** in both
renderers: Word's are a numbering part of their own to keep in step, and a
bullet that is simply there survives every copy-paste out of the file. And an
image is a **block**, even where the editor left it mid-sentence — a picture is
not a word, both renderers lay one out as a block anyway, and the spaces it
leaves on either side are closed rather than printed.

The analysis column is the note's own words and nothing else. The guide's
*What / Why* prompts were tried and dropped: the app has nothing to put under
either, so they printed as two labels around one paragraph and a gap —
scaffolding for writing that had already been done. The .docx is still where
the rest gets written, and a heading nobody asked for was not what made that
possible.

Three more things to know. **A PDF standard font can only carry cp1252**, and pdf-lib *throws* on anything else
rather than dropping it, so `encodable()` strips what it can't draw — one
pasted emoji would otherwise fail the entire export (the .docx has no such
limit and keeps them). **Rows are measured before any of them is drawn**, so a
group heading and its column headings are only placed where the first row can
follow them; taking the leading gap *after* the fit check rather than as part
of it is exactly how an orphaned heading ends up at the foot of a page. A row
taller than the page it starts on is **cut into slices** at a line boundary and
carried on under a repeated heading, since a long note is exactly the note
worth reading and drawing its tail past the bottom margin loses it silently;
only the analysis splits, while the *Where* and *Example* cells ride the first
slice and the note's hue rule runs down every one of them, which is what says
the cell overleaf is the same note. A row that could never fit a page is not
granted one of its own — it starts in the room that is left, or the heading
above it would sit alone over a blank half page. And
**the PDF's tab is opened before the document is built**, since a score has to
be fetched and rasterised first and a `window.open` on the far side of an
`await` has lost the user gesture pop-up blockers look for; a blocked pop-up
falls back to a download, which needs no such permission. The .docx is always a
download — no browser renders Word.

**Both report progress, and both waits are real.** Rasterising a quoted page at
print resolution is seconds each, so `collectQuoteImages` takes a `ProgressFn`
and names the page it is on; the PDF's waiting tab draws it as a bar, and
`ExportProgressButton` draws the same thing as a rule along the foot of the
button that was pressed — which is the *only* progress the .docx has, since it
never opens a tab. A spinner would say "something is happening"; what this
question needs answered is "is it stuck".

That last one is not hypothetical, and the reason is worth keeping. **pdf.js's
on-screen render path waits on `requestAnimationFrame`, which a browser does
not fire in a tab that isn't visible** — so a render started in the page that
has just opened a tab in front of itself never finishes. `lib/pdf.ts` takes
`RenderOptions.offscreen`, which switches to pdf.js's print intent and
schedules on a microtask instead; anything drawing into a file must set it, and
anything drawing for the reader must not (throttling a hidden reader is a
feature there).

Cover images arrive by clicking the inspector's cover slot — a 16:9 well beside
the pin key that echoes the frame's shape and *is* the thumbnail once set — *or*
by dropping a file anywhere on that row, and every one is downscaled to 1600px
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
mirror images, one lifting a hue toward white until it clears AA on a dark box,
the other saturating and darkening it until it clears AA on the white page.

The trap to remember: **a cover image is a note image that isn't in the note
HTML.** It lives under the same `users/{uid}/images/{projectId}/` prefix, so
purge sweeps collect it for free — but `api/blobs/gc.ts` decides what's an
orphan by matching blob URLs against the strings it's handed, and
`lib/copyProject.ts` re-uploads by scanning HTML. Both are fed
`coverUrls(annotations)` alongside the HTML; drop that and the GC deletes live
covers on the next project open. Anything else that walks a project's images
must read it too.

**PDF scores** (`src/lib/score.ts`, `src/components/ScoreLayer.tsx`): a track
can carry the printed music, read in **its own view of the player column** so
the page and the sound arrive together. It lives at `settings.score` — inside the existing jsonb, so
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
its worker. Renders are serialized **per canvas**: pdf.js refuses two renders
onto one canvas and cancelling isn't instant, which a zoom or a resize storm
produces immediately — but the stack below is a canvas per page, and those
don't contend, so one chain for the whole document would make scrolling past a
page cancel the page before it and leave a trail of blanks. An `<iframe>` of
the PDF would be free but exposes no page control, and turning the page is the
whole feature.

**The score is a view, not a layer.** `score.mode` is exactly the two states
the column's view switch offers — `'off'` the player, `'view'` the score — and
the score view is an opaque panel covering the whole player column
(`placement="pane"`), where a portrait page gets the room a 16:9 frame never
could and there is space at the foot for the drawing tools. It covers the
player rather than replacing it: **the player stays mounted and keeps
playing**, which is the point of reading along, and unmounting it would stop a
YouTube iframe dead. So never make the switch conditional-render the player —
it is a sibling `absolute inset-0 z-30` panel over it, above the video's own
floating transport, and it carries a transport of its own because it covers
that one. Edge to edge of the column, deliberately: inset inside the pane's
padding it read as a card inside a panel inside a pane, which is one frame too
many for something that *is* the panel's content.

**Chrome over the score is the app's own material, not video chrome.** The two
placements dress identically-shaped controls differently, and the rule is what
is *behind* them: over the picture they are white glyphs on a gradient,
palette-blind, because what is behind is anything at all; over the score they
are the app's own material with theme-aware glyphs, because what is behind is a
page and a black band across white paper reads as damage rather than as a
control surface.

Two shapes there, and the split is what the control *is*. The page nav and the
transport are the panel's furniture, so they are full-width `.glass-strip` bars
pinned to its edges — `.glass-strip` being the `.glass-pop` material minus its
drop shadow, since a bar spanning a whole edge sits on a hairline, not a halo.
Being opaque bars they take the pointer across their full width, or a click on
an empty half falls through and draws on the page behind. The drawing tools are
the thing in your hand rather than furniture, so they stay a floating
`.glass-pop` pill only as wide as the tools, inert outside itself — the music
shows either side of it and the page beside it is still the page. `ScoreChrome` takes a `tone`, `Transport` takes a `chrome` — and the
trap in the second is that the overlay bar had white hardcoded in half a dozen
places (the clock, the separator, the duration, the speed, the volume), each of
which simply vanishes on the light theme's near-white glass. The score's ground
is `bg-ink`, the canvas token, so a page is white paper on the app's own
surface in both themes; the page itself gets a hairline ring and a shallow
shadow, the lift a raised surface gets, not the deep halo of floating material.

**Laying the score over the picture is a separate switch** (`score.overVideo`,
`placement="frame"`) — the old overlay, kept because seeing the staves under
the moving picture is its own thing the view can't do. Only there does the
z-order matter: note covers and pins sit at `z-10` and the transport at `z-20`;
the score paints at `z-[5]`, just under the covers, or at `z-[15]` when
`onTop` is set, and never above the transport whatever the setting. That order
is a z-index rather than a position in the JSX so flipping it doesn't remount
the layer and re-fetch the PDF. Video tracks only — an audio track's waveform
is the picture and must stay uncovered, and it has the score view like
everything else. Legacy rows say `mode: 'score'` / `'overlay'`; `scoreView()`
maps them onto the pair on read, and `sanitizeScore` does the same for
imported files.

Either placement can go **expanded**: the same document drawn to the whole
viewport through a **portal**, which is required rather than stylistic —
`.glass` uses `backdrop-filter`, and that makes an ancestor the containing
block for `position: fixed`. The document is loaded once per placement and kept
across the move, so expanding costs a re-render, never a re-fetch. Expanded is
the score with *more room*, not a stripped-down version of it: the drawing
tools, the pins and the transport all come along, and `footTransport` is the
one rule behind that — this layer carries a transport wherever it covers the
player's own (its view, or full screen) and never in the video frame, where the
player already has one a few pixels away.

**The document scrolls; it is not a page at a time** (`ScoreSurface.tsx`).
Every page is stacked in one scroller, because that is how music is read — a
system runs off the foot of one page and onto the head of the next, and a
reader at the turn needs to see both. It is also what makes a page turn a
*scroll* rather than a cut: the next page is already there, below, and
following the music animates to it (`behavior: 'smooth'`, honouring
`prefers-reduced-motion`).

Three things that shape the implementation. **Every page's box is reserved from
its intrinsic size** (`pdf.pageSize`, which reads the page dictionary without
rasterising) before anything is drawn, so a fifty-page score has an honest
scrollbar on the first frame; only pages within `RENDER_MARGIN` of the viewport
are actually rasterised, and the rest are white paper of the right shape.
**Which pages to draw is derived from the scroll position**, and from a
*quantised* one (`SCROLL_BAND`): this component renders a page tree and nothing
in the app is auto-memoised, so re-rendering on every scroll event made the
very scroll that caused it stutter. Overlays (marks, pins) mount only on pages
that are actually drawn, for the same reason.

Two rules keep the scroll position and the followed page from fighting. **A
scroll this component started must not be read back as the reader choosing a
page** — a smooth scroll fires dozens of scroll events over as many pages — so
`settleAuto` suppresses reporting until the scroll settles (`scrollend`, with a
timer fallback) and then *reconciles*; suppressing without reconciling silently
loses a scroll the reader made mid-animation. And **the reader's own scroll
claims the page before the host hears about it** (`lastTarget` in
`reportPage`), or the two chase each other: you scroll into a page, it is
reported, it comes back down as the page to show, and the view snaps to its top
edge under your hands.

**Zoom is deferred at the raster, immediate at the layout.** A pinch is a
stream of events; re-rasterising per tick queues a pdf.js render per tick and
turns the gesture into a slideshow. The boxes resize at once and the browser
stretches the bitmap it has; the sharp redraw lands `ZOOM_SETTLE_MS` after the
gesture stops. `MAX_CANVAS_PIXELS` in lib/pdf.ts is the other half — zoom
multiplies the raster, and a page magnified far enough would otherwise hold
tens of megabytes of canvas each, with three of them in the window.

**Scrolling to a page is turning to it**, so a reader who scrolls away from the
music takes exactly the same peek the ‹ › buttons take (`showUserPage`), and it
expires at the next turn like any other.

**Zoom is a multiplier on the fitted size** (`MIN_ZOOM`–`MAX_ZOOM` in
lib/score.ts), and it is the reader's, never the track's — the same call as
which pen is in their hand. A trackpad pinch reaches the page as a `wheel`
event with `ctrlKey` set (there is no pinch event on the desktop web, and the
browser zooms the whole *page* if we don't take it, which is why that listener
is non-passive); touch is a real two-finger gesture tracked through pointer
events. Both zoom about the pointer, which needs the scroll offset corrected
in a layout effect *after* the relayout — the new scroll extent doesn't exist
until the pages have been re-sized. Changing the fit resets the zoom, since
"fit" that shows a corner of a page is not a fit.

**Drawing on the score** (`score.marks`, `src/components/ScoreMarks.tsx` +
`ScoreToolbar.tsx`): highlights, boxes, circles, arrows and freehand ink, in
`settings` with the rest of the score — so they belong to the *track*, and what
the teacher draws is what the class opens. Every coordinate is a fraction of
the page, like a score pin and for the same reason. Drawn in SVG at the page's
own pixel size rather than through a 0→1 `viewBox`, which would stretch circles
into ellipses and strokes into a different width along each axis. An arrow's
`w`/`h` are signed (tail→head), which is why `normalize` skips it. Freehand
points are dropped when closer than `INK_MIN_STEP` — a slow line emits hundreds
a frame apart, and all of it would ride in the project's jsonb on every save
from then on. The tools are offered in the pane and expanded but never in the
video frame (no room to aim) nor while syncing page turns (every press there is
meant to be a turn), and the surface is `pointer-events: none` with no tool
armed so the page scrolls and pins still catch their own drags. Which tool is
in your hand is *session* state, never saved: opening someone's shared score
must not hand you their highlighter.

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

Timing them is one button — or one key. Press play and hit **Turn here** (or
**`T`**, the same press, since a live pass is run with a hand on the keyboard
rather than hunting for a button between turns) at each turn and you've made a
live pass; pause, scrub, and hit it and you've placed one turn by hand — which
is also how a wrong one is fixed, since nobody should replay eight minutes to
move page 12. The **lead offset** (default 0.3 s) is what
makes the live pass usable: the press always lands after the moment it marks,
by roughly a constant, so the stamp goes in that much earlier. The workspace
stands **beside** the page rather than along its foot: a strip had to wrap its
turns, and a fifty-page score wrapped them into five rows that pushed the music
off the top of the screen exactly while it was being timed. A column holds one
turn per line, scrolls on its own and takes its width off room a portrait page
had spare — and stacks under the page only when the screen is too narrow for
that (`sm:`). A turn's ±0.5 s and delete controls ride **in** its row at a
fixed row height, so selecting one moves nothing under the pointer, and a
click on a turn always selects and seeks rather than toggling: clicking it
again is "take me back there", which is how you check a nudge landed.

**The arrows are the transport's everywhere, including full screen.** They were
the page keys there, which read well until you time a pass: what you are
steering is the recording, and a key meaning "back five seconds" in the pane
and "back one page" over the same score is one nobody can trust. Pages keep
PageUp/PageDown and the ‹ › buttons. Note a live
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
note's **record** is the fixed set of `chip-outline` switches — Section,
Question, Bar — each one's field revealed only when it is on; turning Bar off
clears the value, so what the panel hides is never data. The tags that *label*
the note ride the title bar instead (`PluginWindow`'s `meta` slot), beside its
colour and its name, where the old metadata row had them. What the note
puts **on the picture** is two objects rather than switches (the cover slot and
the pin key, above). The note's colour and its delete button live in the host's
title bar, which every presentation already pays for — `PluginWindow` takes
them as `leading` / `meta` / `actions`, and App supplies all three. That bar no
longer repeats the note's span (the time rail is right under it); it grows
rather than clips when the tags need a second line, since a tag the panel hides
is a tag nobody knows is there; and the two presentations share **one** key
rather than a two-button radio — it shows the view it will take you to, so
there is nothing to read to work out which is on. The window's keys sit as one
tight cluster with a single hairline fencing off the plugin's verbs: three
icons spaced like three separate controls read as a scattering, and put the
destructive one within a stray pixel of the others.

**A note's properties live in its prose.** An **inline property tag** is a
coloured token inside the note's own sentence (the concept itself is the
tooltip, and a print-only suffix in the two PDFs), draggable anywhere in the
text. The older `elements` *block* — a grid of dropdowns in a panel under the
note — is no longer offered: the "+ Property" menu is gone and
`notePlugins.ts` has no `addablePlugins`. `src/plugins/elements/` stays
**registered** so notes that already carry a block still render, edit and can
be removed; dropping the registration would take that data off the screen
without deleting it, which is the one outcome worth avoiding.

**Three ways a tag gets written**, and they are a deliberate ladder from
strictest to loosest:

1. **Typing the term.** An input rule on `PropertyTag` tags an unmistakable
   word the moment it ends, and Backspace puts the plain word straight back.
   Which words qualify is the **Auto-tag tick in Notion** (`AUTO_TERMS` in the
   generated file): an allowlist on purpose, and a narrow one (263 of 615),
   because "even", "light", "clear" and "major" are ordinary English several
   times a paragraph and a chip must not land in the middle of one. Matching
   is case-insensitive, and the chip keeps the case the sentence used. Note
   what else it can't catch — an
   input rule fires on the keystroke that *ends* the word, so a word with no
   trailing character, a word finished with Enter, and **anything pasted** all
   go untagged however unmistakable they are.
2. **The underline** (`src/components/propertySuggest.ts`), which is what
   catches all of that. A ProseMirror decoration marks every vocabulary word in
   the text that isn't already a tag; clicking one opens a card
   (`SuggestCard` in `AnnotationEditor.tsx`) offering the concept, or both
   concepts where two fields share the word ("thin" is Timbre *and* Texture).
   This side also matches **the other forms of the word**, which the exact side
   never does. Regular English ones are generated in `propertyTags.ts`
   (plurals, verb forms, `-ation`/`-ic`/`-y` pairs and the same read backwards,
   plus Italian plurals, hyphen variants and accent-stripped spellings) and are
   derived **only from words already ticked Auto-tag** — a term of art is one
   in every form, whereas deriving from "Even" would put "evening" in front of
   the reader. The irregular ones (`arpeggios`, `cadences`, `pizz.`, `cresc.`)
   are the `Aliases` column in Notion, which is a *recognition* list: aliases
   never appear in the `@` menu or the dictionary. This side carries the
   **whole** vocabulary rather than an allowlist, and the
   asymmetry with `AUTO_TERMS` is the point: being wrong here costs a dotted
   line someone ignores, not a mangled sentence. Nothing is stored — the
   underline is derived from the text on every keystroke and stops matching by
   itself once the word becomes an atom. Editable surfaces only; a read-only
   preview or view link shows the prose as written.
3. **The `@` menu**, which still lists note cross-references below the
   properties so there is one trigger key rather than two
   (`src/components/noteMention.ts`), and the **dictionary**
   (`src/components/ElementsDictionary.tsx`) — the vocabulary made browsable.
   It is search-first (through `searchProperties`, so it ranks identically to
   the `@` menu) with the concept chips as the way in when you can't name the
   word yet. **Clicking a word reads it rather than inserting it** — the entry
   below the list gives its `Definition` and its `Exemplar quote`, and the
   button in that panel is what writes it into the note. Both come from Notion
   through `GLOSSARY` (keyed `field:Term`, since "Thin" under Timbre and under
   Texture are two entries); a word with neither says so rather than showing an
   empty panel. It opens as a **modal**: 600 words do not fit in a column that is
   already scrolling, and the note is the thing you want to keep looking at
   while you choose. Picking a word writes it and leaves the modal open,
   because picking two or three in a row is the normal case. Its Escape
   listener is **capture-phase with `stopImmediatePropagation`**, or the same
   press would also reach App's own Escape handler and close the note behind
   it.

**Anything `position: fixed` rendered inside a pane must portal to `<body>`.**
`.glass` and `.glass-pop` carry `backdrop-filter`, and a backdrop-filter
ancestor becomes the containing block for fixed positioning — so `inset-0`
covers *that pane* rather than the viewport, the overlay lives inside the
pane's stacking context (so the pane's own chrome can paint over it), and a
frosted panel samples its ancestor instead of the page, which is why it comes
out looking transparent rather than blurred. Measured once as 510×443 inside
an 881×1057 window. The score's expanded view, `Popover`, `ElementsDictionary`
and `DetectSectionsButton` all portal for this reason. `SettingsModal`,
`ShortcutsOverlay` and `PluginWindow` do not need to, because they mount at
App level with no glass above them — check where a new overlay is *mounted*,
not how it is styled.

**Three actions sit under the note** (`NoteInspector`, driven through
`AnnotationEditorHandle`). *Template* lays out a bullet per concept, each
opening with that concept's own tag — real chips rather than bold words, so
the headings are the same data as everything else. *Dictionary* opens the
modal. *Tag underlined* accepts every underline in one chain, applied back to
front so earlier positions stay valid and the whole sweep is one undo step;
where a word names two concepts it takes the first, which is why the card
still exists.

**Untagging leaves the word.** The chip replaced a word when it was made, so
removing it puts that word back as plain text rather than deleting it —
otherwise "the texture is thin" quietly becomes "the texture is". Deleting the
word is what Backspace over the chip is for.

**The `@` menu narrows like an editor's completion list**, which is what the
600-word vocabulary needs: `searchProperties` (`src/lib/propertyTags.ts`) reads
a leading run of words as a *scope* and matches the rest inside it, so
"@timbre bright" is Bright within Timbre — and then, deliberately, every other
word in Bright's field follows it down the list, because "what could I say
instead of bright?" is the question the menu exists to answer. That needs
`allowSpaces` on the suggestion, which would otherwise match `@` plus the whole
paragraph; a four-word cap and a menu that *hides* itself when nothing matches
are what bound it.

**The vocabulary is synced from Notion, not hand-written**, and it lives in
**two related databases** under "Elements of Music — Vocabulary".
*Vocabulary Fields* is the shape: one row per sub-list, carrying the concept it
belongs to, its stable `Field ID`, and its `Order`. *Vocabulary Terms* is the
words: **one row is exactly one word**, spelled as the app shows it, related to
its field, ticked or not as a word that tags itself, and carrying any
`Aliases`. `npm run sync:vocab` (`scripts/sync-vocabulary.mjs`) pulls both and
rewrites `src/lib/vocabulary.generated.ts` — the only place `ELEMENTS`,
`AUTO_TERMS` and `ALIASES` are defined. Never edit it by hand.

That leaves the script three things a word bank has no business holding: which
concepts exist and in what order, the eight hues (matched to the owner's
concept nav, where Dynamics/Expression and Performing media/Timbre are paired
so each shares a colour family — AA-verified in both themes), and `LADDERS`,
the one field whose options are a sequence rather than a list (ppp–fff, where
alphabetical order would be musical nonsense). Everything else is a row someone
edits without touching code. A field whose `Concept` the app doesn't know is
reported rather than guessed at, and `--check` fails when the file is stale.

**Performing media is browsed by family.** Instruments live in `media.strings`
/ `.woodwind` / `.brass` / `.percussion` / `.keyboard` / `.voice`, so the
dictionary groups them and `@brass tr` narrows to Trumpet and Trombone;
`media.instrument` keeps the broad families and section names. Each concept
also opens with an `Element name` field holding its own word — "texture",
"tone colour", "instrumentation" — so a sentence can be tagged with the
concept it is about, not only with a value inside it. Time signatures (4/4,
7/8) sit in `duration.metre` and can only ever underline: the auto-tag input
rule matches a word beginning with a letter.

**Field ids and the `Auto-tag` tick are the two things to change carefully.**
An id is stored on every chip ever written; the tick decides which words
rewrite a sentence as you type, so it belongs only on words nobody uses in
their everyday sense.
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

**A chip carries two strings, and the split is load-bearing.** `data-value` is
the vocabulary's own spelling and is the *data* — search, the exports and
`propertyTagsInHtml()` all read it. `data-text` is the surface form as the
sentence actually spells it, written only when the two differ (so every chip
made before this, and every one whose word already matches, carries no such
attribute). That is what lets "the texture is monophonic" keep its lower-case
m: the chip shows what you wrote and files it under what it means, and the
tooltip still names the concept in its proper spelling. Picking a different
word from the chip's own menu clears `text`, because the old surface form was
a spelling of the *old* value.

The chip is a TipTap inline atom (`src/components/propertyTag.ts`, view in
`PropertyTagView.tsx`) that lives **inside the note's rich-text HTML** — no new
field on `Annotation`, so it needs no schema, no API whitelist entry and no
line in `projectJson.ts`; it travels wherever `contentHtml` travels, and
`propertyTagsInHtml()` reads the values back out structured. Its markup carries
its own colours: `--hue` for fills on either theme, and `--hue-ink` (an
`hueText`-darkened hue) for text on white paper, because `lib/answerSheet.ts`
injects note HTML raw into a printed sheet with no React around it to resolve a
theme, and reads `PROPERTY_TAG_PRINT_CSS`. The study-notes exports read the
tags *structured* instead (`propertyTagsInHtml`), which is what files each note
under its element. Add a category to `lib/musicElements.ts` and it appears in
the `@` menu, the elements grid, the answer sheet and both exports at once.

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
own `sanitizeScore` pass (which in turn sanitizes the `turns` and the `marks`,
both of them lists of geometry a hand-written file could make enormous, hence
the caps). An uploaded score is also re-hosted by
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
