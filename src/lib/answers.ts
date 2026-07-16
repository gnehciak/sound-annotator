// A student's work-in-progress on a listening task, kept on their own device.
// Students open the `?view=` link with no account, so answers never touch the
// project row — localStorage (per project id) makes the work refresh-proof
// through a lesson, and the exported PDF answer sheet (lib/answerSheet.ts) is
// the deliverable that travels back to the teacher.

export interface TaskResponse {
  /** The student's name as typed in the worksheet strip (stamped on the PDF). */
  name: string
  /** Answer text keyed by question note id. */
  answers: Record<string, string>
  updatedAt: number
}

const keyFor = (projectId: string) => `sound-annotator:task:${projectId}`

/** The stored response for a project, or a blank one. Every field re-checked —
 *  a hand-edited or truncated entry degrades to blank, never a crash. */
export function loadTaskResponse(projectId: string): TaskResponse {
  try {
    const raw = localStorage.getItem(keyFor(projectId))
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TaskResponse>
      const answers: Record<string, string> = {}
      if (parsed.answers && typeof parsed.answers === 'object') {
        for (const [id, text] of Object.entries(parsed.answers)) {
          if (typeof text === 'string' && text) answers[id] = text
        }
      }
      return {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        answers,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      }
    }
  } catch {
    /* unreadable entry — start blank */
  }
  return { name: '', answers: {}, updatedAt: 0 }
}

export function saveTaskResponse(
  projectId: string,
  r: { name: string; answers: Record<string, string> },
): void {
  try {
    const value: TaskResponse = { ...r, updatedAt: Date.now() }
    localStorage.setItem(keyFor(projectId), JSON.stringify(value))
  } catch {
    /* storage full or blocked — typing continues, the PDF export still works */
  }
}

/** Wipe the device's response for a project — the "new student" reset. */
export function clearTaskResponse(projectId: string): void {
  try {
    localStorage.removeItem(keyFor(projectId))
  } catch {
    /* ignore */
  }
}
