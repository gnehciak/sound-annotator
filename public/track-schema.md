# Sound Annotator — track file schema (v1)

This document is the complete, self-contained specification of the JSON file
that Sound Annotator's **Import** button reads and its **Export** button
writes. Hand this whole page to an AI assistant along with a listening guide
and a video link, and it has everything it needs to produce a valid track.

A track file is a **document, not a database row**: it carries a title, a
source, notes, and display settings. It carries no identity, ownership, or
sharing state — importing always mints a brand-new track owned by whoever
imported it.

---

## 1. Prompt to give an assistant

> Read <https://annotated.lkcs.app/track-schema.md>. Using that schema,
> turn the listening guide below into a Sound Annotator track file. The video is
> `<paste the YouTube or Google Drive link>`. Give me the finished `.json` as a
> downloadable file.
>
> ```
> 0:00  Intro — solo piano, sparse pedal
> 0:42  Verse 1 — bass enters, drums half-time
> ...
> ```

Then save the file and use **Import** on the Sound Annotator home page. The
picker takes several files at once, so a whole set of tracks imports in one
go.

---

## 2. The envelope

Every field below is required. `format` is checked exactly; a file whose
`format` differs is rejected outright.

```json
{
  "format": "sound-annotator-project",
  "version": 1,
  "exportedAt": 1757203200000,
  "project": { "...": "see §3" }
}
```

| field | type | notes |
| --- | --- | --- |
| `format` | string | Must be the literal `"sound-annotator-project"`. |
| `version` | number | Currently `1`. A file with a *higher* version than the app knows is refused; lower versions keep importing forever. |
| `exportedAt` | number | Epoch milliseconds. Informational only — use `Date.now()`, or any plausible timestamp. |
| `project` | object | The track itself. |

---

## 3. `project`

<!-- fields: Project -->

| field | type | required | notes |
| --- | --- | --- | --- |
| `title` | string | yes | Shown on the track tile and in the editor. Blank or missing becomes `"Untitled track"`. |
| `source` | object | no | The audio/video the notes are pinned to — see §4. A file with no source imports fine; the track just opens on the source picker. |
| `annotations` | array | yes | The notes, in any order — see §5. Use `[]` for an empty track. |
| `settings` | object | no | Presentation preferences that travel with the track — see §7. |

<!-- /fields -->

### Fields that are deliberately **not** in the file

These are properties of the row in the database, not of the document. Writing
them into a file has no effect: the importer ignores every one.

<!-- fields: Project.excluded -->

| field | why it's excluded |
| --- | --- |
| `id` | The import mints a fresh id. Inheriting one would point two tracks at a single share link. |
| `alias` | Server-assigned short id for tracks that predate short ids. Never travels. |
| `ownerId` | The importer owns the imported track. |
| `updatedAt` | Stamped on save. |
| `shared` | Sharing is a decision made per copy, in the Share panel. |
| `editableByLink` | Same — never inherited from a file. |
| `published` | Publishing to the public gallery is never implied by an import. |
| `publishedByName` | Server-stamped byline. |
| `folderId` | The import lands in whichever folder is open. |
| `stems` | Separated audio written only by AI section detection; bytes, not document content. |
| `deletedAt` | Trash state. Server-set only. |
| `myRole` | What the *current caller* may do here, stamped on every read. A property of who is asking, not of the track. |

<!-- /fields -->

---

## 4. `project.source`

<!-- fields: ProjectSource -->

| field | type | applies to | notes |
| --- | --- | --- | --- |
| `type` | string | all | One of `"youtube"`, `"drive"`, `"audio"`. Anything else drops the whole source. |
| `youtubeUrl` | string | youtube | The link as pasted. Powers "open the original". |
| `videoId` | string | youtube | The 11-character id (`dQw4w9WgXcQ`). **Set this** — the player loads the id, not the URL. A source with neither `videoId` nor `youtubeUrl` is dropped. |
| `driveUrl` | string | drive | The Google Drive share link as pasted. |
| `driveFileId` | string | drive | The Drive file id. If you omit it but supply `driveUrl`, the importer extracts it; if it can't, the source is dropped. The file must be shared **Anyone with the link** to play. |
| `clipStart` | number | youtube, drive | Seconds into the video where this track begins. See the warning below. Dropped unless > 0. |
| `clipEnd` | number | youtube, drive | Seconds into the video where it ends. Dropped unless > `clipStart`. |
| `fileName` | string | audio | Display name for a linked audio file. |
| `audioUrl` | string | audio | Direct URL to an audio file. Audio is never uploaded — it streams from wherever it lives, so the host's CORS policy decides whether it loads. |

<!-- /fields -->

```json
{ "type": "youtube", "youtubeUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "videoId": "dQw4w9WgXcQ" }
```

```json
{ "type": "drive", "driveUrl": "https://drive.google.com/file/d/1AbC.../view", "driveFileId": "1AbC..." }
```

> ### ⚠ Clip windows shift every timestamp
>
> When `clipStart` is set, the track **is** the excerpt: the rest of the app
> sees an ordinary track that starts at zero and runs `clipEnd - clipStart`
> seconds. Note times are therefore **clip-relative**.
>
> If your listening guide's timecodes are read off the full video and you also
> set `clipStart: 90`, every note must be written as `videoSeconds - 90`.
>
> When in doubt, omit `clipStart` / `clipEnd` entirely and write note times as
> plain seconds into the video. That is always correct.

---

## 5. `project.annotations` — the notes

Order in the array doesn't matter; the app sorts by `start`.

**`start` is the only required field.** A note without a valid, non-negative
`start` is dropped; every other malformed field is dropped on its own, leaving
the note intact. So a minimal note is:

```json
{ "start": 42, "contentHtml": "<p>Harp enters under the strings.</p>" }
```

<!-- fields: Annotation -->

| field | type | notes |
| --- | --- | --- |
| `start` | number | **Required.** Seconds from the start of the track (see the clip warning in §4). Fractions are fine: `92.5`. |
| `end` | number | Makes the note cover a span rather than a moment. Ignored unless > `start`. |
| `contentHtml` | string | The note's rich text as HTML — see §6. Defaults to `""`. |
| `blocks` | array | Typed content blocks (§9). **Omit this**: the importer builds a text block from `contentHtml` automatically. |
| `id` | string | Omit it. The importer mints one, and duplicates are re-minted. Note colours are derived from the id, so a hand-written id changes nothing but the hue. |
| `createdAt` | number | Epoch ms. Defaults to import time. Only used as the tiebreaker between notes sharing a `start`. |
| `tags` | string[] | Category chips. Preset ids: `pitch`, `rhythm`, `duration`, `dynamics`, `harmony`, `form`, `timbre`, `comment`. Any other string is a custom tag and is shown verbatim, so keep custom tags short and consistent. |
| `tag` | string | Legacy single tag. Don't write it — use `tags`. Read only for notes that predate the array. |
| `color` | string | Hex colour override for the note's spine and timecode, e.g. `"#5aa8ff"`. Without it the colour is derived from the id, which is fine and looks deliberate. |
| `bar` | string | Free text for a bar number or rehearsal mark — `"24"`, `"bb. 12–16"`, `"reh. B"`. Rendered as a chip beside the timecode. |
| `order` | number | Manual sort position **among notes that share the same `start`** only. Not a global ordering — leave it out. |
| `question` | boolean | `true` turns the note into a listening-task question: its text is the prompt, and a shared `?view=` link opens as a worksheet with an answer box under each question and a PDF answer sheet at the end. |
| `structure` | boolean | `true` marks the note as a structural section, drawing a bracket down the overview timeline beside its span. Give it an `end`. |
| `sectionName` | string | The label on that bracket. Only meaningful with `structure: true`, or on a song-structure board (§7). |
| `lyrics` | string | Plain-text lyrics for a section, shown in the structure board's Lyrics panel. Whole-section granularity — not line-synced. Structure sections only. |
| `overlay` | object | Puts the note **on the video** for its moment — a pinned caption, and/or a cover image. Video tracks only. See §9; you can hand-write the pin, but not the cover. |

<!-- /fields -->

### Worked example — a listening-guide note

```json
{
  "start": 128,
  "end": 164,
  "contentHtml": "<p>The <strong>second subject</strong> arrives in the relative major.</p><ul><li>Clarinet carries the tune</li><li>Strings drop to pizzicato</li></ul>",
  "bar": "bb. 44–58",
  "tags": ["harmony", "timbre"],
  "color": "#2dd4bf"
}
```

### Worked example — a worksheet question

```json
{
  "start": 71,
  "contentHtml": "<p>What happens to the tempo here, and how does it change the mood?</p>",
  "question": true,
  "tags": ["comment"]
}
```

---

## 6. `contentHtml` — what HTML survives

The editor is TipTap with StarterKit. Stick to this subset; anything outside it
is stripped when the note is opened for editing.

| use | markup |
| --- | --- |
| paragraph | `<p>…</p>` — wrap every note's text in at least one |
| bold / italic | `<strong>`, `<em>` |
| strikethrough / inline code | `<s>`, `<code>` |
| headings | `<h1>`–`<h6>` (rarely worth it inside a note) |
| bullet / numbered list | `<ul><li>…</li></ul>`, `<ol><li>…</li></ol>` |
| quote | `<blockquote><p>…</p></blockquote>` |
| line break | `<br>` |
| rule | `<hr>` |

Escape `&`, `<`, `>` in text as `&amp;`, `&lt;`, `&gt;`. Curly quotes, dashes
and accented characters are fine as literal UTF-8.

**Images:** a track file can carry its own pictures — score excerpts, diagrams,
a photo of a page — as a base64 `data:` URI:

```html
<p>The second subject, in the relative major:</p>
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg…">
```

`png`, `jpeg`, `gif` and `webp` are accepted. On import each one is uploaded
into the importer's own image storage and the tag is rewritten to point there,
so the inline copy exists only in transit — the imported track holds ordinary
note images, and a later export writes them back out as links, not base64.

Keep them lean: base64 inflates bytes by about a third, and the whole file
passes through the browser in one piece. Downscale to roughly the width a note
displays (~1000px is generous) before encoding. A handful of images per note
is fine; a hundred full-page scans in one file is not.

---

## 7. `project.settings`

<!-- fields: ProjectSettings -->

| field | type | notes |
| --- | --- | --- |
| `kind` | string | Omit for a normal annotated track. `"structure"` opens the track as a **song-structure board** — a visual section timeline where every annotation is a section, so each one should carry `start`, `end`, `sectionName`, and usually `color`. |
| `noteOrder` | string | Default ordering of the notes list: `"timeline"`, `"auto"`, or `"live"`. Any other value is dropped. |
| `overviewOpen` | boolean | Whether the overview timeline strip opens by default. |
| `playOnce` | boolean | When on, a note's Play chip plays just that passage and pauses at its end. |
| `score` | object | A PDF score for the track — see [§9](#9-score--the-printed-music). The one nested object settings accept. |

<!-- /fields -->

Settings are lenient by design: **any** key holding a string, finite number, or
boolean passes through, so a knob added to the app later still round-trips
through older files. Nested objects and arrays are dropped — `score` is the
single exception, and it is validated field by field.

---

## 8. `overlay` — putting a note on the video or the score

A note can take over the picture while it is on screen, and mark a place on the
page of the score. Three independent pieces, any or all, on the note's
`overlay` object:

<!-- fields: NoteOverlay -->

| field | type | notes |
| --- | --- | --- |
| `pinX` | number | The **video pin**: where its dot sits across the picture, `0`–`1` from the left. |
| `pinY` | number | And down it, `0`–`1` from the top. |
| `scorePinX` | number | The **score pin**: where its dot sits across the drawn page of the score, `0`–`1` from the left — see below. |
| `scorePinY` | number | And down the page, `0`–`1` from the top. |
| `scorePinPage` | number | Which score page that pin lives on, 1-based. Defaults to page 1. |
| `quote` | object | A **score quote**: the region of a page of the track's PDF score this note is about, which the note carries as a picture — on its row, and in the printed notes. See below. |
| `hold` | number | Seconds the layer stays up on a note with **no `end`**. Defaults to 4; a note with an `end` uses its own span instead. |
| `coverUrl` | string | A hosted cover image. **You can't write this** — see below. |
| `coverFit` | string | `"cover"` fills the frame and crops; omit for the default, which letterboxes the whole image. |
| `coverX` | number | Which part of a *filled* cover survives the crop, `0`–`1` across. Omit for centred. |
| `coverY` | number | And down. Omit for centred. |

<!-- /fields -->

Each pin's two coordinates only mean anything **together** — a pin with one of
them is dropped rather than pinned to a corner.

**The two pins are independent.** One note may carry both: a dot on the picture
at the moment something happens, and a dot on the bar it happens in. They are
not two settings for one pin, so neither replaces the other.

**The score pin is a fraction of the page, not of the frame.** `scorePinX` and
`scorePinY` are measured against the *drawn page* of the track's PDF score
(§9), so the pin holds its place in the music however the score is sized,
refitted, expanded or scrolled. It draws only while the score view is showing
its `scorePinPage`: on another page there is no page box for it to be a
fraction of. A score pin on a track with no `settings.score` simply never
appears. Either dot is captioned with the note's own text, clamped to three
lines on the frame, so a note that is also a pin wants a first sentence that
reads on its own.

Files exported before the score got its own view carry a single pin with a
`pinAnchor: "score"` switch instead. They still import: that pin lands on
whichever of the two it named.

### `overlay.quote` — the score quote

A rectangle, never an image. What it frames is cut out of the track's PDF score
wherever the note is shown — at the top of its row in the notes list, in the
editor's note panel, and as a cropped picture beside its text in the two
printed documents — so a handout carries the bars it is talking about instead
of a timecode the reader has to go and look up.

| field | type | notes |
| --- | --- | --- |
| `on` | string | `"score"`, the only surface a quote can be cut out of. Required. |
| `page` | number | Which page of the score, 1-based. Defaults to page 1. |
| `x` | number | The rectangle's left edge, `0`–`1` across the page. |
| `y` | number | Its top edge, `0`–`1` down. |
| `w` | number | Its width, as a fraction of the page. |
| `h` | number | Its height. |

All four numbers are needed together: a rectangle missing any of them is
dropped rather than guessed at, and one smaller than 5% of the page, or hanging
off an edge, is squared up on import. One quote per note — a note that is about
two places is two notes. A quote on a track with no `settings.score` (§9) has
nothing to cut and simply never appears.

**The pixels are found again every time, never stored.** The crop is made from
the PDF as it is *now*, so a Drive score that gains a new engraving quotes the
new engraving from then on, and a quote costs no upload and nothing to copy
when the track is.

Files exported when a quote could also name the *picture* (`"on": "video"`)
still import; that quote is dropped. The picture was never quotable in any
honest way — a YouTube player is a cross-origin iframe whose pixels the page
cannot read, so such a quote could only ever crop the note's own cover image.

**The cover is the `<img>` rule again.** A cover image is a note image: the app
hosts the bytes, and a file can't bring its own. `coverUrl` is a link, so a URL
pointing somewhere else will render — but nothing about it is yours: it breaks
the day that host changes it, it is fetched from the classroom on every play,
and importing the track again won't rescue it. Attach covers in the editor after
importing, which uploads them properly. A hand-written `overlay` is a pin.

```json
{
  "start": 92,
  "end": 118,
  "contentHtml": "<p>The timpanist changes the timbre by striking nearer the edge.</p>",
  "overlay": { "pinX": 0.62, "pinY": 0.44 }
}
```

---

## 9. `score` — the printed music

A track can carry the score it is about: a PDF read in its own view of the
player column, turning its own pages as the music plays. It lives on
`settings.score`.

| field | type | notes |
| --- | --- | --- |
| `kind` | string | `"drive"` for a Google Drive link, `"blob"` for a PDF the app hosts. |
| `driveFileId` | string | Drive only — the file id. Re-derived from `driveUrl` if absent. |
| `driveUrl` | string | Drive only — the link it was pasted from. |
| `url` | string | Hosted PDFs only. **You can't write this** — same rule as cover images. |
| `fileName` | string | Hosted PDFs only; what the score menu calls it. |
| `mode` | string | Which view the column opens on: `"view"` (default) the score, `"off"` the player. |
| `overVideo` | boolean | Also lay the score over the picture, dimmed, while the column is on the player. Off by default; video tracks only. |
| `opacity` | number | `0.2`–`1`, only with `overVideo`. Defaults to `0.85`. |
| `fit` | string | `"height"` (default) fits the whole page; `"width"` fills the width and scrolls. |
| `onTop` | boolean | With `overVideo`, paint the score in front of note covers and pins instead of behind them. Off by default. |
| `turns` | array | When the page turns — see below. |
| `marks` | array | What is drawn on the pages — see below. |

A score that names neither a `driveFileId` nor a `url` is dropped whole rather
than imported as an attachment that can never load.

Files written before the score got its own view use `mode: "score"` (the page
opaque over the video) and `mode: "overlay"` (dimmed over it). Both still
import: the first becomes the score view, the second the player view with
`overVideo`.

**Write a Drive link, not a hosted file.** `kind: "drive"` is the one you can
author: point it at a PDF shared **Anyone with the link** and the track will
load it. `kind: "blob"` describes bytes this installation hosts, and a `url`
copied from an export belongs to the account that uploaded it — it may go dark
without warning. Attach those in the editor, which uploads them properly.

### `turns` — the page changes

Each entry says that from second `t`, the score shows page `page`:

```json
"turns": [
  { "t": 57, "page": 2 },
  { "t": 89, "page": 3 },
  { "t": 125, "page": 4 }
]
```

Times are **track seconds**, on the same clock as the notes (so a `clipStart`
shifts them with everything else), and pages are 1-based. The list holds one
entry per *turn*, not one per page: the score shows the last turn at or before
the playhead, so a page nobody turns away from needs no second entry, and a
repeat can bring an earlier page back simply by naming it again later. Before
the first entry the score sits on the page that entry turns away from — a first
turn to page 2 means page 1 is what's read until then.

Entries missing a usable `t` or `page` are dropped individually, and the list
is re-sorted on import, so order in the file is a convenience rather than a
requirement.

### `marks` — what is drawn on the pages

Highlights, boxes, circles, arrows and freehand ink, drawn on the score in the
editor and carried with the track. Every coordinate is a **fraction of the
page**, `0`–`1`, so a mark holds its place however the page is sized, refitted
or expanded — the page box changes and the numbers don't.

| field | type | notes |
| --- | --- | --- |
| `id` | string | Minted if absent. |
| `page` | number | 1-based page this mark is drawn on. |
| `kind` | string | `"highlight"`, `"box"`, `"ellipse"`, `"arrow"` or `"ink"`. Anything else is dropped — there is no honest default shape. |
| `color` | string | CSS hex, e.g. `"#ff5252"`. |
| `x`, `y` | number | The mark's top-left corner as page fractions. For an arrow, its **tail**. |
| `w`, `h` | number | Its width and height as page fractions. For an arrow, the offset from tail to **head**, which may be negative. |
| `weight` | number | Stroke weight, `1` (fine) to `3` (broad). Defaults to `2`. Ignored by `"highlight"`, whose breadth is its box. |
| `points` | array | `"ink"` only — the stroke, flattened `[x0, y0, x1, y1, …]` in the same page fractions. Needs at least two points. |

```json
"marks": [
  { "id": "m1", "page": 1, "kind": "highlight", "color": "#ffd633",
    "x": 0.12, "y": 0.31, "w": 0.4, "h": 0.05 },
  { "id": "m2", "page": 1, "kind": "arrow", "color": "#ff5252", "weight": 2,
    "x": 0.6, "y": 0.2, "w": -0.12, "h": 0.09 }
]
```

An import carries at most 2000 marks, and an ink stroke at most 2000 points.

---

## 10. `blocks` (advanced — you almost certainly want to skip this)

A note's content is really a list of typed blocks, each rendered by a plugin.
Notes that carry only `contentHtml` are migrated to a single `text` block on
read, which is why authoring `contentHtml` is enough.

<!-- fields: NoteBlock -->

| field | type | notes |
| --- | --- | --- |
| `type` | string | Plugin key. `"text"` is the built-in rich-text block; its payload is `{ "html": "…" }`. |
| `data` | any | Plugin-specific payload. Not validated here — a block whose plugin isn't installed renders as unknown. |
| `id` | string | Minted if absent. |

<!-- /fields -->

---

## 11. A complete, valid file

```json
{
  "format": "sound-annotator-project",
  "version": 1,
  "exportedAt": 1757203200000,
  "project": {
    "title": "Debussy — Prélude à l'après-midi d'un faune",
    "source": {
      "type": "youtube",
      "youtubeUrl": "https://www.youtube.com/watch?v=EPGuCPUcezE",
      "videoId": "EPGuCPUcezE"
    },
    "settings": { "overviewOpen": true, "noteOrder": "timeline" },
    "annotations": [
      {
        "start": 0,
        "end": 21,
        "contentHtml": "<p>Solo flute, unaccompanied. A chromatic descent from C♯ to G and back — a tritone, deliberately unstable.</p>",
        "bar": "bb. 1–4",
        "tags": ["pitch", "timbre"],
        "structure": true,
        "sectionName": "Opening"
      },
      {
        "start": 21,
        "contentHtml": "<p>Harp glissando and horn answer. Listen for how little the texture weighs.</p>",
        "tags": ["timbre"]
      },
      {
        "start": 55,
        "contentHtml": "<p>What has happened to the pulse by this point? Can you still count a beat?</p>",
        "question": true
      }
    ]
  }
}
```

---

## 12. Checklist before importing

- `format` is exactly `"sound-annotator-project"` and `version` is `1`.
- Every note has a numeric `start` in **seconds** — `2:14` must become `134`,
  `1:03:20` must become `3800`.
- `end`, where present, is greater than `start`.
- No `clipStart` unless the timestamps were written relative to it.
- `videoId` (YouTube) or `driveFileId` (Drive) is present.
- Note text is HTML wrapped in `<p>`, not raw prose or Markdown.
- Any images are `data:` URIs on an `<img>` tag, downscaled first.
- No `id` fields, no `overlay.coverUrl`, no `score.url`, no ownership or
  sharing fields.
- A `score`, if any, is `kind: "drive"` with a `driveFileId`, and its `turns`
  are in track seconds with 1-based pages.

---

*This file is generated-adjacent: `scripts/check-schema-doc.mjs` runs during
`npm run build` and fails the build if any field on `Project`,
`ProjectSource`, `Annotation`, `NoteBlock`, or `ProjectSettings` in
`src/types.ts` is missing from the tables above, so the schema and this
document cannot drift apart. The tables' `<!-- fields: … -->` markers are what
that check reads — keep them.*
