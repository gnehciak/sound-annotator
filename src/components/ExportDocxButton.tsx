import { FileText } from 'lucide-react'
import type { Project } from '../types'
import { exportProjectDocx } from '../lib/exportDocx'
import ExportProgressButton from './ExportProgressButton'

/**
 * Sub-bar control that exports the track's notes as a Word document (see
 * {@link exportProjectDocx}) — the same study-notes grid the PDF carries, in
 * the format the analysis gets *finished* in: the app fills where, what was
 * quoted and what the teacher wrote, and "Why (effect)" is typed in Word.
 */
export default function ExportDocxButton({
  project,
  small,
}: {
  project: Project
  small?: boolean
}) {
  return (
    <ExportProgressButton
      label="Word"
      icon={<FileText size={12} />}
      title="Export this track's notes as a Word document"
      small={small}
      run={(onProgress) => exportProjectDocx(project, onProgress)}
    />
  )
}
