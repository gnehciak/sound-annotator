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
/** A cached recording older than this is dropped by the cron; the next clip
 *  fetches it again. Age rather than last use — Blob records only the upload
 *  time — so a class favourite is refetched twice a year, which is nothing. */
export const MEDIA_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000

// Two tokens may reach it: `BLOB_CACHE_READ_WRITE_TOKEN` for a dedicated
// private store (preferred — no URL to a whole song then exists), else the
// app's `BLOB_READ_WRITE_TOKEN`, where objects get a random suffix and stay
// unguessable. media.ts's `store()` makes the choice; the cron mirrors it.
