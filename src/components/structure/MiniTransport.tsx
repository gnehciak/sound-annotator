import type { ReactNode } from 'react'
import { Pause, Play } from 'lucide-react'
import { formatTime } from '../../lib/format'
import { VolumeControl } from '../Transport'

/**
 * The structure board's folded transport: one Play key, the LED clock, and
 * volume — nothing else. Seeking already lives in the board itself (ruler,
 * minimap, section chips, lyric headings), so the full transport's seek bar,
 * step keys, speed menu, and shortcut hints would all say things twice.
 *
 * `children` fold into the panel as a second, hairline-divided row — the stem
 * mixer lives here so parts-of-the-mix sit with the transport that plays them.
 */

interface Props {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  onPlayPause: () => void
  onSetVolume: (v: number) => void
  onToggleMute: () => void
  children?: ReactNode
}

export default function MiniTransport({
  isPlaying,
  currentTime,
  duration,
  volume,
  muted,
  onPlayPause,
  onSetVolume,
  onToggleMute,
  children,
}: Props) {
  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex items-center px-3 py-2">
        <div className="flex flex-1 items-baseline gap-1.5">
          <span className="led text-[15px] font-medium leading-none">
            {formatTime(currentTime)}
          </span>
          <span className="font-mono text-[10.5px] text-muted">
            / {formatTime(duration)}
          </span>
        </div>
        <button
          type="button"
          onClick={onPlayPause}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          className="press bevel-raised inline-flex w-[112px] items-center justify-center gap-[7px] rounded bg-accent py-[8px] text-[13.5px] font-bold text-onaccent hover:brightness-110"
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <div className="flex flex-1 items-center justify-end">
          <VolumeControl
            volume={volume}
            muted={muted}
            onSetVolume={onSetVolume}
            onToggleMute={onToggleMute}
          />
        </div>
      </div>
      {children && (
        <div className="border-t border-line px-3 py-[9px]">{children}</div>
      )}
    </div>
  )
}
