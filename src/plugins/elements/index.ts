import { Layers } from 'lucide-react'
import { registerPlugin } from '../../lib/notePlugins'
import { summarizeElements, type ElementsData } from '../../lib/musicElements'
import ElementsEditor from './ElementsEditor'
import ElementsSummary from './ElementsSummary'

/** Register the "musical elements" plugin (a window-surfaced note block). */
export function registerElementsPlugin(): void {
  registerPlugin({
    type: 'elements',
    label: 'Musical elements',
    icon: Layers,
    surface: 'window',
    createData: (): ElementsData => ({ fields: {} }),
    Summary: ElementsSummary,
    Editor: ElementsEditor,
    summarize: (d) => summarizeElements(d as ElementsData),
  })
}
