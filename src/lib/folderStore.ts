// Home-page folders over the /api layer, scoped per signed-in user. One row
// per folder; membership lives on each project's `folderId` (see
// projectStore.ts), so a folder row is just its name. Folders are flat (no
// nesting) and never shared.
import { api } from './api'
import type { Folder } from '../types'

/** Shape a raw API payload into a Folder. */
function toFolder(data: Record<string, unknown>): Folder {
  return {
    id: String(data.id),
    name: typeof data.name === 'string' ? data.name : 'Untitled folder',
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
  }
}

/** Load every folder owned by this user, sorted by name (createdAt tiebreak). */
export async function fetchFolders(_uid: string): Promise<Folder[]> {
  const rows = await api<Record<string, unknown>[]>('/api/folders')
  return rows
    .map(toFolder)
    .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt)
}

/** Create or overwrite a single folder (create and rename alike). */
export async function saveFolder(_uid: string, f: Folder): Promise<void> {
  await api(`/api/folders/${encodeURIComponent(f.id)}`, {
    method: 'PUT',
    json: { name: f.name, createdAt: f.createdAt },
  })
}

export async function deleteFolderDoc(id: string): Promise<void> {
  await api(`/api/folders/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
