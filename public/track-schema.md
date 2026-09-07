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

Then save the file and use **Import** on the Sound Annotator home page.

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
| `blocks` | array | Typed content blocks (§8). **Omit this**: the importer builds a text block from `contentHtml` automatically. |
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

**Images:** don't write `<img>` tags. Note images are hosted by the app under
the importer's own storage; a file can't bring its own bytes. Add images in the
editor after importing.

---

## 7. `project.settings`

<!-- fields: ProjectSettings -->

| field | type | notes |
| --- | --- | --- |
| `kind` | string | Omit for a normal annotated track. `"structure"` opens the track as a **song-structure board** — a visual section timeline where every annotation is a section, so each one should carry `start`, `end`, `sectionName`, and usually `color`. |
| `noteOrder` | string | Default ordering of the notes list: `"timeline"`, `"auto"`, or `"live"`. Any other value is dropped. |
| `overviewOpen` | boolean | Whether the overview timeline strip opens by default. |
| `playOnce` | boolean | When on, a note's Play chip plays just that passage and pauses at its end. |

<!-- /fields -->

Settings are lenient by design: **any** key holding a string, finite number, or
boolean passes through, so a knob added to the app later still round-trips
through older files. Nested objects and arrays are dropped.

---

## 8. `blocks` (advanced — you almost certainly want to skip this)

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

## 9. A complete, valid file

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

## 10. Checklist before importing

- `format` is exactly `"sound-annotator-project"` and `version` is `1`.
- Every note has a numeric `start` in **seconds** — `2:14` must become `134`,
  `1:03:20` must become `3800`.
- `end`, where present, is greater than `start`.
- No `clipStart` unless the timestamps were written relative to it.
- `videoId` (YouTube) or `driveFileId` (Drive) is present.
- Note text is HTML wrapped in `<p>`, not raw prose or Markdown.
- No `id` fields, no `<img>` tags, no ownership or sharing fields.

---

*This file is generated-adjacent: `scripts/check-schema-doc.mjs` runs during
`npm run build` and fails the build if any field on `Project`,
`ProjectSource`, `Annotation`, `NoteBlock`, or `ProjectSettings` in
`src/types.ts` is missing from the tables above, so the schema and this
document cannot drift apart. The tables' `<!-- fields: … -->` markers are what
that check reads — keep them.*
