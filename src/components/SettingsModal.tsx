import { useEffect, useState } from 'react'
import { Brackets, Eye, ListOrdered, X } from 'lucide-react'
import type { NoteOrder } from '../lib/storage'
import ClipFields from './ClipFields'
import { readClipFields, type ClipDraft } from '../lib/clip'
import { formatTime } from '../lib/format'

/**
 * Centralised settings modal — surfaces a handful of cross-cutting preferences
 * in one place instead of scattering them across the chrome. These are global
 * (per-browser) prefs persisted to localStorage; the modal mirrors the live
 * values so toggles take effect immediately.
 */
export default function SettingsModal({
  playOnce,
  onPlayOnce,
  overviewOpen,
  onOverviewOpen,
  noteOrder,
  onNoteOrder,
  clip,
  onClip,
  onClose,
}: {
  playOnce: boolean
  onPlayOnce: (on: boolean) => void
  overviewOpen: boolean
  onOverviewOpen: (on: boolean) => void
  noteOrder: NoteOrder
  onNoteOrder: (mode: NoteOrder) => void
  /** The YouTube clip window, or null when the track isn't a clippable one. */
  clip: { start?: number; end?: number } | null
  onClip: (next: { start?: number; end?: number }) => void
  onClose: () => void
}) {
  const [clipDraft, setClipDraft] = useState<ClipDraft>({
    start: clip?.start ? formatTime(clip.start) : '',
    end: clip?.end ? formatTime(clip.end) : '',
  })
  const [clipError, setClipError] = useState<string | null>(null)

  const commitClip = () => {
    const parsed = readClipFields(clipDraft)
    if ('error' in parsed) {
      setClipError(parsed.error)
      return
    }
    setClipError(null)
    if (parsed.clip.start !== clip?.start || parsed.clip.end !== clip?.end)
      onClip(parsed.clip)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Settings"
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line-strong bg-panel"
      >
        <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line bg-raised px-3.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
            Settings
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            className="press grid h-[26px] w-[26px] place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-6 px-5 py-5">
          {clip && (
            <Section title="Clip">
              <div className="min-w-0">
                <div className="mb-2.5 text-[11.5px] leading-snug text-muted">
                  Trim the track to part of the video. Notes move with the clip,
                  so they stay on the same music.
                </div>
                <ClipFields
                  value={clipDraft}
                  onChange={(d) => {
                    setClipDraft(d)
                    setClipError(null)
                  }}
                  onCommit={commitClip}
                  error={clipError}
                />
              </div>
            </Section>
          )}

          <Section title="Playback">
            <ToggleRow
              icon={<Brackets size={14} strokeWidth={2.4} />}
              label="Play once"
              hint="Each Play action pauses at the end of the current note."
              checked={playOnce}
              onChange={onPlayOnce}
            />
          </Section>

          <Section title="View">
            <ToggleRow
              icon={<Eye size={14} />}
              label="Overview open"
              hint="Show the timeline strip below the player by default."
              checked={overviewOpen}
              onChange={onOverviewOpen}
            />
            <div className="flex items-start gap-3">
              <span className="mt-[6px] grid h-[18px] w-[18px] shrink-0 place-items-center text-muted">
                <ListOrdered size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-fg">
                      Notes order
                    </div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-muted">
                      How the notes list arranges itself by default.
                    </div>
                  </div>
                  <div
                    role="group"
                    aria-label="Default notes order"
                    className="flex shrink-0 items-center gap-[2px] rounded-[7px] border border-line bg-inset p-[2px]"
                  >
                    {ORDERS.map((opt) => {
                      const active = noteOrder === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => onNoteOrder(opt.value)}
                          aria-pressed={active}
                          title={opt.title}
                          className={`press flex h-[22px] items-center rounded-sm px-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] transition-colors duration-150 ${
                            active
                              ? 'bg-raised text-accentink'
                              : 'text-muted hover:text-fg'
                          }`}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accentink">
        {title}
      </div>
      {children}
    </div>
  )
}

function ToggleRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="press flex items-start gap-3 rounded text-left transition-colors hover:bg-raised/40"
    >
      <span className="mt-[6px] grid h-[18px] w-[18px] shrink-0 place-items-center text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-fg">{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
          {hint}
        </span>
      </span>
      <span
        className={`mt-[3px] relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border transition-colors ${
          checked ? 'border-accent bg-accent' : 'border-line bg-inset'
        }`}
      >
        <span
          className={`absolute top-1/2 h-[12px] w-[12px] -translate-y-1/2 rounded-full transition-all ${
            checked ? 'left-[16px] bg-onaccent' : 'left-[2px] bg-muted'
          }`}
        />
      </span>
    </button>
  )
}

const ORDERS: { value: NoteOrder; label: string; title: string }[] = [
  {
    value: 'timeline',
    label: 'Timeline',
    title: 'Always chronological — stable list, click leaves the playhead alone',
  },
  {
    value: 'auto',
    label: 'Auto',
    title: 'Chronological when paused, pins the playing note while playing',
  },
  {
    value: 'live',
    label: 'Live',
    title: 'Always reorders around the playhead',
  },
]
