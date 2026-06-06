// Firestore-backed home-page folders, scoped per signed-in user. One document
// per folder under the top-level `folders` collection; membership lives on
// each project's `folderId` (see projectStore.ts), so a folder doc is just its
// name. Folders are flat (no nesting) and never shared.
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
import type { Folder } from '../types'

const foldersCol = () => collection(db, 'folders')

/** Shape a raw Firestore document into a Folder. */
function toFolder(id: string, data: Record<string, unknown>): Folder {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : 'Untitled folder',
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
  }
}

/** Load every folder owned by this user, sorted by name (createdAt tiebreak). */
export async function fetchFolders(uid: string): Promise<Folder[]> {
  const snap = await getDocs(query(foldersCol(), where('ownerId', '==', uid)))
  return snap.docs
    .map((d) => toFolder(d.id, d.data()))
    .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt)
}

/** Create or overwrite a single folder document (create and rename alike). */
export async function saveFolder(uid: string, f: Folder): Promise<void> {
  await setDoc(doc(foldersCol(), f.id), {
    ownerId: uid,
    name: f.name,
    createdAt: f.createdAt,
  })
}

export async function deleteFolderDoc(id: string): Promise<void> {
  await deleteDoc(doc(foldersCol(), id))
}
