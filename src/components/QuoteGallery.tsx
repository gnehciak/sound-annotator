import { quotePageOf } from '../lib/overlays'
import { useQuotePreview } from '../lib/quotePreview'
import type { NoteQuote } from '../types'

/**
 * One score quote, drawn.
 *
 * A quote is a rectangle, never an image (see NoteQuote in ../types), so the
 * pixels are cut out of the score every time one is shown — `useQuotePreview`
 * shares the document, the page raster and the crops across every thumbnail on
 * screen, which is what makes a list of galleries affordable. The hook is per
 * quote, so this component exists to *be* the per-quote thing a gallery can
 * map over.
 */
export function QuoteThumb({
  quote,
  maxHeight,
  /**
   * What to draw while the crop isn't ready. Nothing, on a list row: a score
   * that never loads would otherwise leave a permanent grey box on every note
   * that quotes it. The inspector says so instead, because there the box is
   * the control and an empty row would read as a lost quote.
   */
  placeholder,
}: {
  quote: NoteQuote
  maxHeight: number
  placeholder?: boolean
}) {
  const preview = useQuotePreview(quote)
  if (!preview && !placeholder) return null
  return (
    <div className="grid place-items-center overflow-hidden rounded-md bg-white ring-1 ring-line">
      {preview ? (
        <img
          src={preview.src}
          alt={`The quoted region of page ${quotePageOf(quote)} of the score`}
          style={{ maxHeight }}
          className="mx-auto w-auto max-w-full object-contain"
        />
      ) : (
        // Not "loading": a score that won't load never resolves, and a spinner
        // that spins for ever says less than this does.
        <span
          style={{ height: maxHeight / 2 }}
          className="grid place-items-center px-3 text-[11px] text-black/40"
        >
          Drawing page {quotePageOf(quote)}…
        </span>
      )}
    </div>
  )
}

/**
 * A note's quotes, side by side — the gallery it carries into the notes list.
 *
 * Horizontal because a quote is a *system of music*: wide, short, and read
 * left to right, so several of them stack into a strip that stays the shape of
 * the thing it holds. Stacked vertically they would push the note's own words
 * off the row, which is the wrong way round — the pictures are what the note
 * is about, not what it says.
 *
 * A single quote gets the full width, exactly as it did when a note could only
 * have one; several share the row and scroll sideways rather than shrinking
 * until none of them is legible.
 */
export default function QuoteGallery({
  quotes,
  maxHeight = 176,
  placeholders,
}: {
  quotes: NoteQuote[]
  maxHeight?: number
  placeholders?: boolean
}) {
  if (quotes.length === 0) return null
  const many = quotes.length > 1
  return (
    <div
      className={
        many
          ? // `-mb-0.5 pb-0.5` keeps the scrollbar off the pictures' ring.
            'flex snap-x gap-2 overflow-x-auto -mb-0.5 pb-0.5'
          : 'flex'
      }
    >
      {quotes.map((quote, i) => (
        <div
          key={`${quotePageOf(quote)}:${quote.x},${quote.y},${quote.w},${quote.h}:${i}`}
          className={many ? 'shrink-0 snap-start' : 'min-w-0 flex-1'}
        >
          <QuoteThumb
            quote={quote}
            maxHeight={many ? Math.min(maxHeight, 132) : maxHeight}
            placeholder={placeholders}
          />
        </div>
      ))}
    </div>
  )
}
