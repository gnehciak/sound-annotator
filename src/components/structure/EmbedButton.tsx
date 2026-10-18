// The section footer's embed key: a confirm popover that builds the
// `<iframe>` for one section's audio (lib/embed.ts) — which stems to play,
// a live preview of the square, and the snippet to copy.
import { useRef, useState } from 'react'
import { Check, Code2, Copy } from 'lucide-react'
import Popover from '../Popover'
import { embedSnippet, embedUrl } from '../../lib/embed'
import { STEM_ORDER } from '../../lib/stems'

interface Props {
  /** The project's public id — what the embed URL carries. */
  projectId: string
  start: number
  end: number
  /** Stems this track can play; empty hides the stem row. */
  stems: string[]
  /** Whether anyone holding the link may read the track. An iframe on
   *  another site carries no session, so without it the embed can't play. */
  shared: boolean
}

export default function EmbedButton({ projectId, start, end, stems, shared }: Props) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const names = STEM_ORDER.filter((n) => stems.includes(n))
  const chosen = names.filter((n) => picked.includes(n))
  const spec = { id: projectId, start, end, stems: chosen }
  const snippet = embedSnippet(spec)

  const toggle = (n: string) =>
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Embed this section's audio on another page"
        aria-label="Embed this section"
        className="btn-icon press"
      >
        <Code2 size={13} />
      </button>
      <Popover open={open} anchorRef={anchor} onClose={() => setOpen(false)} width={300} className="p-3">
        <div className="flex flex-col gap-3 text-[12px]">
          <div className="flex items-start gap-3">
            {/* The real thing, at preview size — the iframe someone will see. */}
            <iframe
              key={embedUrl(spec)}
              src={embedUrl(spec)}
              title="Embed preview"
              className="h-20 w-20 shrink-0 rounded-xl border-0"
            />
            <p className="text-muted">
              A square play button for just this section. Paste it into any page that takes
              HTML.
            </p>
          </div>

          {names.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                Stems {chosen.length === 0 && '· full mix'}
              </span>
              <div className="flex flex-wrap gap-1">
                {names.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={picked.includes(n)}
                    onClick={() => toggle(n)}
                    className="chip chip-outline press capitalize"
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!shared && (
            <p className="text-danger">
              This track isn’t shared, so the embed won’t play. Turn on its share link first.
            </p>
          )}

          <textarea
            readOnly
            value={snippet}
            onFocus={(e) => e.currentTarget.select()}
            rows={3}
            className="field resize-none font-mono text-[10px] leading-snug"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(snippet).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
            className="btn-signal press justify-center"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy embed code'}
          </button>
        </div>
      </Popover>
    </>
  )
}
