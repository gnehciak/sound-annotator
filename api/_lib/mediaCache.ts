// The clip export's audio cache in Blob (api/_lib/media.ts): one object per
// YouTube video id, shared by every project that points at that video, so a
// recording is fetched from YouTube once and never per project or per
// server instance. Kept out of media.ts so the purge cron can import the
// prefix without dragging the child-process tooling into its bundle.
//
// It lives under its own prefix rather than any `users/{uid}/…` one on
// purpose: no project owns it, so no project's purge may sweep it. The cron
// ages it out instead (api/cron/purge-trash.ts).
export const MEDIA_CACHE_PREFIX = 'cache/youtube/'
/**
 * The downloaded *video* cache (api/projects/[id]/video.ts), the sibling of the
 * audio one above: one merged mp4 per YouTube video id, shared by every project
 * that points at that video, so the whole picture is fetched from YouTube once
 * and then played from our own origin. Its own prefix for the same reason — no
 * project owns it, so no project's purge may sweep it; the cron ages it out.
 *
 * Unlike the audio cache it is **not** served from the private store: a
 * `<video>` element seeks by Range, which the proxy answers by fetching the
 * object's own URL with the client's Range header, so the object needs a
 * fetchable (public, random-suffix) URL. That URL is unguessable — the same
 * credential every share link and note image already rests on — and the proxy
 * never hands it to the client, gating playback by project read-access instead.
 */
export const VIDEO_CACHE_PREFIX = 'cache/youtube-video/'
/** A cached recording older than this is dropped by the cron; the next clip
 *  fetches it again. Age rather than last use — Blob records only the upload
 *  time — so a class favourite is refetched twice a year, which is nothing. */
export const MEDIA_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000

// Two tokens may reach it: `BLOB_CACHE_READ_WRITE_TOKEN` for a dedicated
// private store (preferred — no URL to a whole song then exists), else the
// app's `BLOB_READ_WRITE_TOKEN`, where objects get a random suffix and stay
// unguessable. media.ts's `store()` makes the choice; the cron mirrors it.
