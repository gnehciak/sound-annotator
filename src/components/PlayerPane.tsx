import { forwardRef, type ReactNode } from 'react'
import type { PlayerHandle, ProjectSource } from '../types'
import YouTubePlayer from './YouTubePlayer'
import DrivePlayer from './DrivePlayer'
import AudioPlayer, { type RegionSpec } from './AudioPlayer'

interface Props {
  source?: ProjectSource
  audioUrl: string | null
  regionSpecs: RegionSpec[]
  playbackRate: number
  /** 0–1 playback volume, applied to whichever player loads. */
  volume: number
  readOnly?: boolean
  /**
   * Rendered inside the video frame (YouTube / Drive), above the picture —
   * the floating transport. Ignored for audio, whose waveform is the picture
   * and must stay uncovered; the host docks the transport beneath it instead.
   */
  overlay?: ReactNode
  onTime: (t: number) => void
  onDuration: (d: number) => void
  onPlayingChange: (playing: boolean) => void
  onSeek: (t: number) => void
  onCreateRange: (id: string, start: number, end: number) => void
  onUpdateRegion: (id: string, start: number, end: number) => void
}

/** Picks the right player for the project's source and forwards the imperative ref. */
const PlayerPane = forwardRef<PlayerHandle, Props>(function PlayerPane(
  props,
  ref,
) {
  const { source, audioUrl } = props
  if (source?.type === 'youtube' && source.videoId) {
    return (
      <YouTubePlayer
        ref={ref}
        videoId={source.videoId}
        clipStart={source.clipStart}
        clipEnd={source.clipEnd}
        playbackRate={props.playbackRate}
        volume={props.volume}
        overlay={props.overlay}
        onTime={props.onTime}
        onDuration={props.onDuration}
        onPlayingChange={props.onPlayingChange}
      />
    )
  }
  if (source?.type === 'drive' && source.driveFileId) {
    return (
      <DrivePlayer
        ref={ref}
        fileId={source.driveFileId}
        clipStart={source.clipStart}
        clipEnd={source.clipEnd}
        playbackRate={props.playbackRate}
        volume={props.volume}
        overlay={props.overlay}
        onTime={props.onTime}
        onDuration={props.onDuration}
        onPlayingChange={props.onPlayingChange}
      />
    )
  }
  if (source?.type === 'audio' && audioUrl) {
    return (
      <AudioPlayer
        ref={ref}
        url={audioUrl}
        regionSpecs={props.regionSpecs}
        playbackRate={props.playbackRate}
        volume={props.volume}
        readOnly={props.readOnly}
        onTime={props.onTime}
        onDuration={props.onDuration}
        onPlayingChange={props.onPlayingChange}
        onSeek={props.onSeek}
        onCreateRange={props.onCreateRange}
        onUpdateRegion={props.onUpdateRegion}
      />
    )
  }
  return null
})

export default PlayerPane
