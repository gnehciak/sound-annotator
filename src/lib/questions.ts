// Listening-task model helpers. A "listening task" is an ordinary annotated
// track whose owner marked some notes as questions (Annotation.question).
// Opened through its `?view=` share link, the track becomes a worksheet: each
// question note grows an answer box (answers live on the student's device —
// lib/answers.ts) and the student hands back a PDF answer sheet
// (lib/answerSheet.ts). Questions are numbered in listening order everywhere
// they appear: note-row chips, the worksheet, and the printed sheet.
import type { Annotation, Project } from '../types'
import { isStructureProject } from './sections'

/** Same-time tiebreak used by the notes list: manual order, then creation. */
function tie(a: Annotation, b: Annotation): number {
  if (a.order != null && b.order != null) return a.order - b.order
  if (a.order != null) return -1
  if (b.order != null) return 1
  return a.createdAt - b.createdAt
}

/** The track's questions in worksheet order (chronological, list tiebreak). */
export function questionsOf(annotations: Annotation[]): Annotation[] {
  return annotations
    .filter((a) => a.question)
    .sort((a, b) => a.start - b.start || tie(a, b))
}

/** Note id → 1-based question number ("Q3"), in worksheet order. */
export function questionNumbers(annotations: Annotation[]): Map<string, number> {
  const map = new Map<string, number>()
  questionsOf(annotations).forEach((a, i) => map.set(a.id, i + 1))
  return map
}

/** How many of the given questions carry a non-empty answer. */
export function countAnswered(
  questions: Annotation[],
  answers: Record<string, string>,
): number {
  return questions.filter((q) => answers[q.id]?.trim()).length
}

/**
 * True when a shared project opens as a listening task: it carries question
 * notes and isn't a structure board (whose share view is the section
 * timeline, not a notes list — nowhere to hang answer boxes).
 */
export function isListeningTask(project: Project): boolean {
  return (
    !isStructureProject(project) && project.annotations.some((a) => a.question)
  )
}
