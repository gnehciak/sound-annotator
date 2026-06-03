import { forwardRef } from 'react'
import type { PlayerHandle, ProjectSource } from '../types'
import YouTubePlayer from './YouTubePlayer'
import AudioPlayer, { type RegionSpec } from './AudioPlayer'

interface Props {
  source?: ProjectSource
  audioUrl: string | null
  regionSpecs: RegionSpec[]
  playbackRate: number
  readOnly?: boolean
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
        playbackRate={props.playbackRate}
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
