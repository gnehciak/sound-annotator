// Firestore-backed project persistence, scoped per signed-in user.
// One document per project under the top-level `projects` collection; notes
// live inline in the `annotations` array (kept small — images go to Storage).
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Project } from '../types'

const projectsCol = () => collection(db, 'projects')

/** Load every project owned by this user, newest first. */
export async function fetchProjects(uid: string): Promise<Project[]> {
  // Filter by owner only (no composite index needed); sort client-side.
  const snap = await getDocs(query(projectsCol(), where('ownerId', '==', uid)))
  return snap.docs
    .map((d) => {
      const data = d.data()
      return {
        id: d.id,
        title: data.title ?? 'Untitled track',
        source: data.source,
        annotations: Array.isArray(data.annotations) ? data.annotations : [],
        updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
      } as Project
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Create or overwrite a single project document. */
export async function saveProject(uid: string, p: Project): Promise<void> {
  await setDoc(doc(projectsCol(), p.id), {
    ownerId: uid,
    title: p.title,
    source: p.source,
    annotations: p.annotations,
    updatedAt: p.updatedAt,
  })
}

export async function deleteProjectDoc(id: string): Promise<void> {
  await deleteDoc(doc(projectsCol(), id))
}
