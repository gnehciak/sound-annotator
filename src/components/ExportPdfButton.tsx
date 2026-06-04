import { FileDown } from 'lucide-react'
import type { Project } from '../types'
import { exportProjectPdf } from '../lib/exportPdf'

/**
 * Sub-bar control that exports the project to a print-ready PDF (the browser's
 * "Save as PDF" via {@link exportProjectPdf}). Styled to match the neighbouring
 * Share button.
 */
export default function ExportPdfButton({ project }: { project: Project }) {
  return (
    <button
      type="button"
      onClick={() => exportProjectPdf(project)}
      title="Export this track's notes to a PDF"
      className="press inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted transition-colors hover:border-line-strong hover:text-fg"
    >
      <FileDown size={12} />
      <span className="hidden sm:inline">PDF</span>
    </button>
  )
}
