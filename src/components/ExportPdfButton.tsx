import { FileDown } from 'lucide-react'
import type { Project } from '../types'
import { exportProjectPdf } from '../lib/exportPdf'
import ExportProgressButton from './ExportProgressButton'

/**
 * Sub-bar control that exports the track's notes as a PDF and opens the file
 * (see {@link exportProjectPdf}) — the document itself, not a page offering to
 * print one. Styled to match the neighbouring Share button.
 */
export default function ExportPdfButton({
  project,
  small,
}: {
  project: Project
  small?: boolean
}) {
  return (
    <ExportProgressButton
      label="PDF"
      icon={<FileDown size={12} />}
      title="Export this track's notes as a PDF and open it"
      small={small}
      run={(onProgress) => exportProjectPdf(project, onProgress)}
    />
  )
}
