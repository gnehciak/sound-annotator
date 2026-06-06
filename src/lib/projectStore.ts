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
  setDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import { withBlocks } from './noteBlocks'
import type { Annotation, Project } from '../types'

const projectsCol = () => collection(db, 'projects')

/** Shape a raw Firestore document into a Project (shared by both fetchers). */
function toProject(id: string, data: Record<string, unknown>): Project {
  return {
    id,
    title: typeof data.title === 'string' ? data.title : 'Untitled track',
    source: data.source as Project['source'],
    // Migrate legacy notes (contentHtml only) to the block model on read.
    annotations: Array.isArray(data.annotations)
      ? (data.annotations as Annotation[]).map(withBlocks)
      : [],
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    shared: data.shared === true,
    folderId: typeof data.folderId === 'string' ? data.folderId : null,
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
 * Load a single project by id for the read-only share viewer. No owner filter
 * and no auth required — firestore.rules only returns the doc if it's `shared`.
 * Returns null when the project is missing or not shared (read denied).
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

/** Create or overwrite a single project document. */
export async function saveProject(uid: string, p: Project): Promise<void> {
  await setDoc(doc(projectsCol(), p.id), {
    ownerId: uid,
    title: p.title,
    source: p.source,
    annotations: p.annotations,
    updatedAt: p.updatedAt,
    shared: p.shared === true,
    folderId: p.folderId ?? null,
  })
}

export async function deleteProjectDoc(id: string): Promise<void> {
  await deleteDoc(doc(projectsCol(), id))
}
