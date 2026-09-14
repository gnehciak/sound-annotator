/**
 * The Drive download origin — the only URL the server ever fetches a Drive
 * file from. `confirm=t` skips the "can't scan for viruses" interstitial that
 * Drive puts in front of anything over ~100 MB; harmless below that. Shared by
 * the byte proxy (api/browse.ts) and the clip export
 * (api/projects/[id]/clip.ts), which hands it to ffmpeg. See src/lib/drive.ts
 * for why a browser can never fetch this itself.
 */
export const driveOriginUrl = (fileId: string) =>
  `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
    fileId,
  )}&export=download&confirm=t`
