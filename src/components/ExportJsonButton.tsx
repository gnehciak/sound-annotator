import { Braces } from 'lucide-react'
import type { Project } from '../types'
import { downloadProjectJson } from '../lib/projectJson'

/**
 * Sub-bar control that downloads the track as a portable JSON file (title,
 * source, notes, settings — see lib/projectJson.ts), re-importable from the
 * home page. Styled to match the neighbouring PDF and Share buttons.
 */
export default function ExportJsonButton({ project }: { project: Project }) {
  return (
    <button
      type="button"
      onClick={() => downloadProjectJson(project)}
      title="Export this track (source + notes) as a JSON file you can re-import"
      className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-line-strong hover:text-fg"
    >
      <Braces size={12} />
      <span className="hidden sm:inline">JSON</span>
    </button>
  )
}
