# 🎵 Sound Annotator

A web app for annotating music in the classroom. Load a **YouTube video** or an
**audio file**, then attach **timestamped rich-text notes** — bold/lists/headings
plus pasted or uploaded screenshots — that jump the player to the right moment
when you click them.

This is the **local-only MVP**: no accounts, no server. Everything is saved in
your browser, so you can open it and start annotating immediately.

## Run it

```bash
npm install      # first time only
npm run dev      # http://localhost:5173
```

Build for production: `npm run build` then `npm run preview`.

## Deploying security rules

`firestore.rules` and `storage.rules` are checked into the repo but only take
effect once published to Firebase — editing the files (or merging a PR) does
**not** change the live project. `firebase.json` / `.firebaserc` wire them up so
a one-liner publishes both straight from the checked-in files:

```bash
npm i -g firebase-tools   # first time only
firebase login            # first time only — interactive
firebase deploy --only firestore:rules,storage
```

The project is pinned to `sound-annotator` in `.firebaserc`. No composite
indexes are needed (`fetchProjects` filters by a single field and sorts
client-side), so `firestore.indexes.json` is intentionally empty.

> If you change `firestore.rules` (e.g. the read-only share gate), the change is
> live for users only after this deploy runs.

## How to use

1. Click **+ New track**.
2. Paste a YouTube link **or** choose an audio file.
3. Press play. When you hear something worth noting, click **+ Note at m:ss**.
4. Type your note. Use the toolbar for **bold**, lists, headings, quotes, and to
   insert an image — or just **paste a screenshot** straight into the note.
5. Click any note's timestamp to jump the player back to that moment. The note
   playing right now is highlighted as the track moves.

## Architecture

The whole UI is **source-agnostic**: a single `PlayerHandle` interface
(`play / pause / seekTo / getCurrentTime`) is implemented twice, so YouTube and
audio behave identically to the rest of the app.

```
src/
  types.ts                 Project / Annotation / PlayerHandle types
  App.tsx                  State + persistence orchestrator, sidebar, transport
  lib/
    firebase.ts            Firebase app + Auth / Firestore / Storage singletons
    auth.tsx               Google sign-in context (useAuth)
    youtube.ts             Parse video id from any YT URL + load the IFrame API
    format.ts              seconds -> "m:ss"
    image.ts               Downscale a pasted image to a small JPEG blob
    projectStore.ts        Projects + notes  <-> Firestore (incl. shared-link read)
    audioCloud.ts          Audio file blobs  <-> Cloud Storage (download URLs)
    imageCloud.ts          Note image blobs  <-> Cloud Storage (download URLs)
    storage.ts             Local UI prefs (panel width, view mode) -> localStorage
  components/
    PlayerPane.tsx         Chooses the right player, forwards the imperative ref
    YouTubePlayer.tsx      YouTube IFrame API  -> PlayerHandle
    AudioPlayer.tsx        wavesurfer.js waveform -> PlayerHandle
    SourcePicker.tsx       YouTube URL / audio file entry
    AnnotationEditor.tsx   TipTap rich-text editor + image paste/upload
    AnnotationItem.tsx     One timestamped note (seek / re-anchor / delete)
    AnnotationList.tsx     Sorts notes by time, highlights the active one
    SharePanel.tsx         Toggle read-only sharing + copy the ?view= link
    ShareViewer.tsx        Read-only viewer rendered for a ?view= share link
    Gate.tsx               Auth gate: setup notice / sign-in / app
```

**Persistence model**

- **Firebase** backend, per user (Google sign-in via Auth). The browser talks
  straight to Firebase — no server of our own.
- Project metadata + note HTML → **Firestore**, one document per project (notes
  inline), saved debounced on change. An offline cache keeps it working without
  a connection.
- Audio files → **Cloud Storage** at `users/{uid}/audio/{projectId}`, streamed
  back via their download URL. If the file is missing, the notes are kept and
  the app asks you to re-open the file.
- Pasted/inserted note images are downscaled, uploaded to **Cloud Storage**
  (`users/{uid}/images/{projectId}/…`), and referenced by download URL in the
  note HTML — keeping the base64 bytes out of the Firestore doc. (If an upload
  fails it falls back to an inline data URL so the image isn't lost.) Images are
  **resizable** by dragging a corner handle; the width persists in the note HTML.
- **Read-only sharing.** A project can be flagged shared, which mints a
  `?view={id}` link anyone can open read-only with no sign-in (the random doc id
  is the share token). `firestore.rules` only serves a doc to a stranger when
  it's flagged shared; only the owner can flip that flag. Audio rides along on
  its tokenized Storage download URL, so shared audio tracks play too.

## Known limitations (by design)

- **No YouTube frame capture.** Browsers can't read pixels from a cross-origin
  YouTube iframe, so "screenshots" means paste/upload an image — not auto-grab a
  video frame.
- **Sharing is read-only.** A link lets others view and seek a track, not edit
  it — there's no live multi-user co-editing.

## Roadmap

- **Time-range notes** ("1:10–1:35") with draggable **wavesurfer regions**.
- **Export to PDF** (timestamps + notes + screenshots) for handouts.
- **Note templates** (form analysis, instrumentation, dynamics map).
- **Teacher/student roles** on top of the existing Firebase backend (named
  collaborators, not just an unlisted read-only link).
- Optional migration to **Next.js** for server-rendered share pages.

## Theming

The look is a dark **"Console / DAW"** theme. All colors are CSS-variable tokens
in **`src/index.css`** (`:root`), mapped to semantic Tailwind names
(`ink / panel / raised / inset / line / fg / muted / accent / meter`) in
**`tailwind.config.js`**. Retune the whole app from those two files; per-note
note colors live in `src/lib/noteColors.ts`.

## Stack

Vite · React 19 · TypeScript · Tailwind CSS · TipTap (ProseMirror) ·
wavesurfer.js · YouTube IFrame Player API
