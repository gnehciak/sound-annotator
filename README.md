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
    youtube.ts             Parse video id from any YT URL + load the IFrame API
    format.ts              seconds -> "m:ss"
    image.ts               Downscale pasted images so they fit in localStorage
    storage.ts             Projects + notes  -> localStorage
    audioStore.ts          Audio file blobs  -> IndexedDB (too big for localStorage)
  components/
    PlayerPane.tsx         Chooses the right player, forwards the imperative ref
    YouTubePlayer.tsx      YouTube IFrame API  -> PlayerHandle
    AudioPlayer.tsx        wavesurfer.js waveform -> PlayerHandle
    SourcePicker.tsx       YouTube URL / audio file entry
    AnnotationEditor.tsx   TipTap rich-text editor + image paste/upload
    AnnotationItem.tsx     One timestamped note (seek / re-anchor / delete)
    AnnotationList.tsx     Sorts notes by time, highlights the active one
```

**Persistence model**

- Project metadata + note HTML → `localStorage` (debounced on every keystroke).
- Audio files → `IndexedDB`, keyed by project id (survives reload). If the file
  is ever missing, the notes are kept and the app asks you to re-open the file.
- Pasted images are stored as downscaled data URLs inline in the note HTML.

## Known limitations (by design, for the MVP)

- **No YouTube frame capture.** Browsers can't read pixels from a cross-origin
  YouTube iframe, so "screenshots" means paste/upload an image — not auto-grab a
  video frame.
- **localStorage is ~5 MB.** Lots of large pasted images can fill it; images are
  downscaled to help, but heavy use wants real file storage (see roadmap).
- Single-user, single-browser. No sharing or login yet.

## Roadmap

- **Time-range notes** ("1:10–1:35") with draggable **wavesurfer regions**.
- **Export to PDF** (timestamps + notes + screenshots) for handouts.
- **Note templates** (form analysis, instrumentation, dynamics map).
- **Supabase** backend: logins, saved projects, image upload, teacher/student
  roles, share-by-link — the natural "classroom-ready" next step.
- Optional migration to **Next.js** once there's a backend.

## Theming

The look is a dark **"Console / DAW"** theme. All colors are CSS-variable tokens
in **`src/index.css`** (`:root`), mapped to semantic Tailwind names
(`ink / panel / raised / inset / line / fg / muted / accent / meter`) in
**`tailwind.config.js`**. Retune the whole app from those two files; per-note
note colors live in `src/lib/noteColors.ts`.

## Stack

Vite · React 19 · TypeScript · Tailwind CSS · TipTap (ProseMirror) ·
wavesurfer.js · YouTube IFrame Player API
