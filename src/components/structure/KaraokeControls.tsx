import { Maximize2, MicVocal, Minimize2 } from 'lucide-react'

/**
 * The Player title bar's karaoke keys, shared by the editor and the share
 * viewer so the stage is armed the same way for a teacher and for a class.
 * Fullscreen only appears once karaoke is on — it exists to project the
 * lyrics, and the windowed player has never asked for it.
 */

interface Props {
  karaoke: boolean
  fullscreen: boolean
  fullscreenSupported: boolean
  onToggleKaraoke: () => void
  onToggleFullscreen: () => void
}

const KEY =
  'press inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors'

export default function KaraokeControls({
  karaoke,
  fullscreen,
  fullscreenSupported,
  onToggleKaraoke,
  onToggleFullscreen,
}: Props) {
  return (
    <>
      {karaoke && fullscreenSupported && (
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-pressed={fullscreen}
          title={
            fullscreen
              ? 'Leave fullscreen (Esc)'
              : 'Fill the screen — for projecting to the room'
          }
          className={`${KEY} border-line text-muted hover:border-line-strong hover:text-fg`}
        >
          {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          {fullscreen ? 'Exit' : 'Fullscreen'}
        </button>
      )}
      <button
        type="button"
        onClick={onToggleKaraoke}
        aria-pressed={karaoke}
        title={
          karaoke
            ? 'Back to the player'
            : 'Karaoke — swap the player for the sounding section’s lyrics'
        }
        className={`${KEY} ${
          karaoke
            ? 'border-accent text-accentink'
            : 'border-line text-muted hover:border-line-strong hover:text-fg'
        }`}
      >
        <MicVocal size={12} />
        Karaoke
      </button>
    </>
  )
}
