import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/plugins/regions'
import type { PlayerHandle } from '../types'
import { colorForId } from '../lib/noteColors'
import { useThemeKey, cssRgb } from '../lib/theme'

export interface RegionSpec {
  id: string
  start: number
  end?: number
  color: string
}

interface Props {
  url: string
  regionSpecs: RegionSpec[]
  playbackRate: number
  /** 0–1, passed straight to wavesurfer's setVolume. */
  volume: number
  readOnly?: boolean
  onTime: (t: number) => void
  onDuration: (d: number) => void
  onPlayingChange: (playing: boolean) => void
  onSeek: (t: number) => void
  onCreateRange: (id: string, start: number, end: number) => void
  onUpdateRegion: (id: string, start: number, end: number) => void
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const AudioPlayer = forwardRef<PlayerHandle, Props>(function AudioPlayer(
  props,
  ref,
) {
  const { url } = props
  const themeKey = useThemeKey()
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<RegionsPlugin | null>(null)
  const timeRef = useRef(0)
  const readyRef = useRef(false)
  const managedIds = useRef<Set<string>>(new Set())

  // Latest props/callbacks, read without re-creating the player.
  const cb = useRef(props)
  cb.current = props

  // Make the waveform regions match the annotation list (add/update/remove).
  function reconcile() {
    const regions = regionsRef.current
    if (!regions || !readyRef.current) return
    const specs = cb.current.regionSpecs
    const existing = regions.getRegions()
    const byId = new Map(existing.map((r) => [r.id, r]))
    const wanted = new Set(specs.map((s) => s.id))
    for (const r of existing) {
      if (!wanted.has(r.id)) {
        managedIds.current.delete(r.id)
        r.remove()
      }
    }
    const locked = cb.current.readOnly
    for (const s of specs) {
      const isRange = s.end != null
      const r = byId.get(s.id)
      if (!r) {
        managedIds.current.add(s.id)
        regions.addRegion({
          id: s.id,
          start: s.start,
          end: isRange ? s.end : undefined,
          color: rgba(s.color, isRange ? 0.2 : 0.85),
          drag: isRange && !locked,
          resize: isRange && !locked,
          minLength: 0.25,
        })
      } else if (r.start !== s.start || (isRange && r.end !== s.end)) {
        r.setOptions({ start: s.start, end: isRange ? s.end : undefined })
      }
    }
  }

  useEffect(() => {
    if (!containerRef.current) return
    readyRef.current = false
    managedIds.current = new Set()

    const ws = WaveSurfer.create({
      container: containerRef.current,
      url,
      height: 88,
      // Canvas colors are read from the live theme tokens (a separate effect
      // re-paints them when the theme flips, since canvas ignores CSS vars).
      waveColor: cssRgb('--border-strong'),
      progressColor: cssRgb('--accent'),
      cursorColor: cssRgb('--text'),
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
    })
    wsRef.current = ws
    const regions = ws.registerPlugin(RegionsPlugin.create())
    regionsRef.current = regions
    // Drag-to-create selection is enabled/disabled by the readOnly effect below.

    ws.on('ready', () => {
      cb.current.onDuration(ws.getDuration())
      readyRef.current = true
      // preservePitch: slowing the audio keeps it in tune (music analysis).
      ws.setPlaybackRate(cb.current.playbackRate, true)
      ws.setVolume(cb.current.volume)
      reconcile()
    })
    ws.on('timeupdate', (t: number) => {
      timeRef.current = t
      cb.current.onTime(t)
    })
    ws.on('play', () => cb.current.onPlayingChange(true))
    ws.on('pause', () => cb.current.onPlayingChange(false))
    ws.on('finish', () => cb.current.onPlayingChange(false))

    regions.on('region-created', (region: Region) => {
      // Ignore regions we added programmatically; only react to user drags.
      if (managedIds.current.has(region.id)) return
      managedIds.current.add(region.id)
      const { start, end } = region
      if (end == null || end - start < 0.25) {
        managedIds.current.delete(region.id)
        region.remove()
        cb.current.onSeek(start)
        return
      }
      region.setOptions({ color: rgba(colorForId(region.id), 0.2) })
      cb.current.onCreateRange(region.id, start, end)
    })
    regions.on('region-updated', (region: Region) => {
      cb.current.onUpdateRegion(region.id, region.start, region.end)
    })
    regions.on('region-clicked', (region: Region, e: MouseEvent) => {
      e.stopPropagation()
      cb.current.onSeek(region.start)
    })

    return () => {
      regionsRef.current = null
      wsRef.current = null
      readyRef.current = false
      ws.destroy()
    }
  }, [url])

  // Re-sync when the set of ranges/markers changes (ignores note text edits).
  const signature = props.regionSpecs
    .map((s) => `${s.id}:${s.start}:${s.end ?? ''}`)
    .join('|')
  useEffect(() => {
    reconcile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Apply live speed changes (the 'ready' handler covers the initial rate and
  // any url remount). preservePitch keeps slowed-down audio in tune.
  useEffect(() => {
    wsRef.current?.setPlaybackRate(props.playbackRate, true)
  }, [props.playbackRate])

  // Apply live volume changes (the 'ready' handler covers the initial level).
  useEffect(() => {
    wsRef.current?.setVolume(props.volume)
  }, [props.volume])

  // Re-paint the waveform when the theme OR palette flips: the canvas was
  // drawn with the old token colors and won't follow the CSS vars on its own.
  useEffect(() => {
    wsRef.current?.setOptions({
      waveColor: cssRgb('--border-strong'),
      progressColor: cssRgb('--accent'),
      cursorColor: cssRgb('--text'),
    })
  }, [themeKey])

  // View-only locks the waveform: no drag-to-create, and existing ranges can't
  // be moved or resized. Re-runs after the player (re)mounts on a url change.
  const { readOnly } = props
  useEffect(() => {
    const regions = regionsRef.current
    if (!regions) return
    for (const r of regions.getRegions()) {
      const isRange = r.end != null && r.end !== r.start
      r.setOptions({ drag: isRange && !readOnly, resize: isRange && !readOnly })
    }
    if (readOnly) return
    const disable = regions.enableDragSelection(
      { color: cssRgb('--accent', 0.25) },
      5,
    )
    return () => {
      try {
        disable?.()
      } catch {
        /* plugin already destroyed on unmount */
      }
    }
  }, [readOnly, url])

  useImperativeHandle(
    ref,
    () => ({
      play: () => void wsRef.current?.play(),
      pause: () => wsRef.current?.pause(),
      seekTo: (s: number) => wsRef.current?.setTime(s),
      getCurrentTime: () => timeRef.current,
    }),
    [],
  )

  return (
    <div className="rounded border border-line bg-inset p-3">
      <div ref={containerRef} className="w-full cursor-pointer" />
      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted">
        Click the waveform to jump
        {!readOnly && ' · drag across it to note a section'}
      </p>
    </div>
  )
})

export default AudioPlayer
