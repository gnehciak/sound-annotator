# 🎵 Sound Annotator

A web app for annotating music in the classroom. Load a **YouTube video** or an
**audio file**, then attach **timestamped rich-text notes** — bold/lists/headings
plus pasted or uploaded screenshots — that jump the player to the right moment
when you click them.

Accounts and sync run on **Vercel**: Google sign-in via Clerk, projects in
Neon Postgres, audio and note images in Vercel Blob. The browser talks to
Vercel Functions in `/api`, which enforce all access control (owner-only
data, unguessable-id share links, the one-editor-at-a-time lock).

## Run it

```bash
npm install          # first time only
vercel env pull      # first time only — syncs .env.local from the linked project
npm run dev:full     # app + /api functions (vercel dev) — http://localhost:3000
```

`npm run dev` (plain Vite) still works for UI-only tinkering, but every data
call needs the functions, so `dev:full` is the one you want day-to-day.

Build for production: `npm run build`. Deploy with `vercel deploy` (preview)
or `vercel deploy --prod`.

## Backend

- **Schema** — `scripts/schema.sql`; apply with
  `node --env-file=.env.local scripts/apply-schema.mjs` (idempotent).
- **Authorization** — lives entirely in the `/api` functions:
  `api/projects/[id]/index.ts` (owner/link-editor rules + the edit lock),
  `api/projects/[id]/lock.ts` (claim/heartbeat/release),
  `api/blobs/*.ts` (uploads pinned to `users/{uid}/…`, 60 MB cap).
- **Env vars** — provisioned by the Vercel integrations (Neon, Clerk, Blob);
  `vercel env pull` refreshes `.env.local`. The client only ever sees
  `VITE_CLERK_PUBLISHABLE_KEY`.

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
    api.ts                 Fetch helper for /api (attaches the Clerk session token)
    auth.tsx               Google sign-in via Clerk behind the app's useAuth()
    youtube.ts             Parse video id from any YT URL + load the IFrame API
    format.ts              seconds -> "m:ss"
    image.ts               Downscale a pasted image to a small JPEG blob
    projectStore.ts        Projects + notes  <-> /api/projects (incl. shared-link read)
    audioCloud.ts          Audio file blobs  <-> Vercel Blob (client uploads)
    imageCloud.ts          Note image blobs  <-> Vercel Blob (client uploads + GC)
    editLock.ts            One-editor-at-a-time lock (poll + heartbeat)
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

- **Vercel** backend, per user (Google sign-in via Clerk). The browser calls
  the `/api` Vercel Functions; they hold the only credentials to Neon/Blob.
- Project metadata + note HTML → **Neon Postgres**, one row per project (notes
  inline in the `annotations` jsonb), saved debounced on change.
- Audio files → **Vercel Blob** at `users/{uid}/audio/{projectId}`, uploaded
  straight from the browser with a server-minted token and streamed back via
  their public-but-unguessable URL. If the file is missing, the notes are kept
  and the app asks you to re-open the file.
- Pasted/inserted note images are downscaled, uploaded to **Vercel Blob**
  (`users/{uid}/images/{projectId}/…`), and referenced by URL in the note HTML —
  keeping the base64 bytes out of the project row. (If an upload fails it falls
  back to an inline data URL so the image isn't lost.) Images are **resizable**
  by dragging a corner handle; the width persists in the note HTML.
- **Read-only sharing.** A project can be flagged shared, which mints a
  `?view={id}` link anyone can open read-only with no sign-in (the random row id
  is the share token). The API only serves a project to a stranger when it's
  flagged shared; only the owner can flip that flag. Audio rides along on its
  unguessable Blob URL, so shared audio tracks play too.

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
- **Teacher/student roles** on top of the existing backend (named
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
