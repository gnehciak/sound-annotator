import { parseTime } from './format'

/** The two clip fields as typed — raw text, validated only on commit. */
export interface ClipDraft {
  start: string
  end: string
}

/** A clip window in seconds of the source video. See ProjectSource.clipStart. */
export interface ClipWindow {
  start?: number
  end?: number
}

/**
 * Read a draft (see components/ClipFields) into a clip window. Blank fields
 * mean "no bound" — the video's own start / end — so a wholly blank draft is
 * the whole video. Invalid or inverted input comes back as a message to show
 * rather than a thrown error: both callers commit on a user action and want to
 * keep the bad text in the field to be fixed.
 */
export function readClipFields(
  draft: ClipDraft,
): { clip: ClipWindow } | { error: string } {
  const read = (raw: string, label: string) => {
    if (!raw.trim()) return undefined
    const secs = parseTime(raw)
    if (secs == null || secs < 0)
      throw new Error(`${label} time should look like 1:30 (or 90).`)
    return secs
  }
  let start: number | undefined
  let end: number | undefined
  try {
    start = read(draft.start, 'Start')
    end = read(draft.end, 'End')
  } catch (e) {
    return { error: (e as Error).message }
  }
  if (start != null && end != null && end <= start)
    return { error: 'The end time has to come after the start time.' }
  // A window starting at 0 is just the whole video's start — store nothing.
  return { clip: { start: start || undefined, end } }
}
