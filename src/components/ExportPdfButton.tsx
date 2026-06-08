import { FileDown } from 'lucide-react'
import type { Project } from '../types'
import { exportProjectPdf } from '../lib/exportPdf'

/**
 * Sub-bar control that exports the project to a print-ready report in a new
 * tab, saved as a PDF from there (see {@link exportProjectPdf}). Styled to
 * match the neighbouring Share button.
 */
export default function ExportPdfButton({ project }: { project: Project }) {
  return (
    <button
      type="button"
      onClick={() => exportProjectPdf(project)}
      title="Export this track's notes to a PDF (opens in a new tab)"
      className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-line-strong hover:text-fg"
    >
      <FileDown size={12} />
      <span className="hidden sm:inline">PDF</span>
    </button>
  )
}
