import { layerOf, summarizeElements, type ElementsData } from '../../lib/musicElements'
import type { PluginSummaryProps } from '../../lib/notePlugins'
import { hueText } from '../../lib/noteColors'
import { useResolvedTheme } from '../../lib/theme'

/** Compact, read-only render shown on the note at rest. */
export default function ElementsSummary({ data }: PluginSummaryProps) {
  const theme = useResolvedTheme()
  const value = (data as ElementsData | undefined) ?? { fields: {} }
  const layer = layerOf(value.layer)
  const summary = summarizeElements(value)

  if (!layer && !summary) {
    return <span className="font-mono text-[11px] text-muted">Empty — click to edit</span>
  }

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {layer && (
        <span
          className="inline-flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em]"
          style={{ color: hueText(layer.color, theme) }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: layer.color }} />
          {layer.label}
        </span>
      )}
      {summary && <span className="text-[12px] text-muted">{summary}</span>}
    </span>
  )
}
