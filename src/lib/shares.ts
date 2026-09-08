// The invite list for a project — who, by email, may open it and with what
// power. Owner-only on both sides: these calls 404 for anyone else, and the
// server is what enforces that (api/projects/[id]/shares.ts). See
// {@link ProjectShare} for why sharing has two independent halves.
//
// Every call answers with the whole list, so the panel never has to guess what
// the server now believes — an add, a role change and a removal all land as
// one replacement of local state.
import { api } from './api'
import type { ProjectShare } from '../types'

function sane(list: unknown): ProjectShare[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((r) => {
    const s = r as Partial<ProjectShare>
    if (typeof s.email !== 'string') return []
    return [
      {
        email: s.email,
        role: s.role === 'editor' ? 'editor' : 'viewer',
        invitedAt: typeof s.invitedAt === 'number' ? s.invitedAt : 0,
      },
    ]
  })
}

export async function listShares(projectId: string): Promise<ProjectShare[]> {
  return sane(await api<unknown>(`/api/projects/${projectId}/shares`))
}

/** Invite an address, or change the role of one already invited (the server
 *  upserts, so the panel needs no separate "change role" call). */
export async function setShare(
  projectId: string,
  email: string,
  role: ProjectShare['role'],
): Promise<ProjectShare[]> {
  return sane(
    await api<unknown>(`/api/projects/${projectId}/shares`, {
      method: 'POST',
      json: { email, role },
    }),
  )
}

export async function removeShare(
  projectId: string,
  email: string,
): Promise<ProjectShare[]> {
  return sane(
    await api<unknown>(
      `/api/projects/${projectId}/shares?email=${encodeURIComponent(email)}`,
      { method: 'DELETE' },
    ),
  )
}
