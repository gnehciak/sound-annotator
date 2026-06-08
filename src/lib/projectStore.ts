// Firestore-backed project persistence, scoped per signed-in user.
// One document per project under the top-level `projects` collection; notes
// live inline in the `annotations` array (kept small — images go to Storage).
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import { withBlocks } from './noteBlocks'
import type { EditLockClaim } from './editLock'
import type { Annotation, Project } from '../types'

const projectsCol = () => collection(db, 'projects')

/**
 * Shape a raw Firestore document into a Project (shared by both fetchers and
 * the edit-lock snapshot stream). The `lock` field is deliberately *not* part
 * of Project — it lives outside React state (see lib/editLock.ts), so
 * heartbeats never mark a project dirty.
 */
export function toProject(id: string, data: Record<string, unknown>): Project {
  return {
    id,
    title: typeof data.title === 'string' ? data.title : 'Untitled track',
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : undefined,
    source: data.source as Project['source'],
    // Migrate legacy notes (contentHtml only) to the block model on read.
    annotations: Array.isArray(data.annotations)
      ? (data.annotations as Annotation[]).map(withBlocks)
      : [],
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    shared: data.shared === true,
    editableByLink: data.editableByLink === true,
    folderId: typeof data.folderId === 'string' ? data.folderId : null,
    settings:
      data.settings && typeof data.settings === 'object'
        ? (data.settings as Project['settings'])
        : undefined,
  }
}

/** Load every project owned by this user, newest first. */
export async function fetchProjects(uid: string): Promise<Project[]> {
  // Filter by owner only (no composite index needed); sort client-side.
  const snap = await getDocs(query(projectsCol(), where('ownerId', '==', uid)))
  return snap.docs
    .map((d) => toProject(d.id, d.data()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Load a single project by id for the share viewer / an editable link. No
 * owner filter and no auth required — firestore.rules only returns the doc if
 * it's `shared` (or `editableByLink`). Returns null when the project is
 * missing or not shared (read denied).
 */
export async function fetchSharedProject(id: string): Promise<Project | null> {
  try {
    const snap = await getDoc(doc(projectsCol(), id))
    if (!snap.exists()) return null
    return toProject(snap.id, snap.data())
  } catch {
    // Permission denied (not shared) surfaces as an error — treat as "missing".
    return null
  }
}

/**
 * Create or update a single project document.
 *
 * Written with `mergeFields` (not a blind overwrite) so the doc's `lock`
 * field — maintained out-of-band by the edit lock — survives every save.
 * When `lock` is passed, the save also stamps a fresh lock claim for that
 * session: firestore.rules refuses content writes that don't carry the
 * holder's claim, which is what stops a stale tab from clobbering the
 * current editor (see lib/editLock.ts).
 *
 * `ownerId` is preserved on foreign projects (editable links): the rules
 * reject any write that would reassign it.
 */
export async function saveProject(
  uid: string,
  p: Project,
  lock?: EditLockClaim,
): Promise<void> {
  const payload: Record<string, unknown> = {
    ownerId: p.ownerId ?? uid,
    title: p.title,
    source: p.source,
    annotations: p.annotations,
    updatedAt: p.updatedAt,
    shared: p.shared === true,
    editableByLink: p.editableByLink === true,
    folderId: p.folderId ?? null,
    settings: p.settings,
  }
  if (lock) payload.lock = { ...lock, at: serverTimestamp() }
  // An undefined source must drop out of mergeFields too (Firestore is set to
  // ignore undefined values, so naming a field the payload doesn't carry would
  // throw).
  const mergeFields = Object.keys(payload).filter(
    (k) => payload[k] !== undefined,
  )
  await setDoc(doc(projectsCol(), p.id), payload, { mergeFields })
}

export async function deleteProjectDoc(id: string): Promise<void> {
  await deleteDoc(doc(projectsCol(), id))
}
