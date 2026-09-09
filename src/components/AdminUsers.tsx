import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '../lib/api'

interface AdminUserRow {
  uid: string
  email: string | null
  name: string | null
  imageUrl: string | null
  createdAt: number | null
  lastSignInAt: number | null
  projectCount: number
  lastProjectAt: number | null
  /** True for the admin viewing the page — the one account it can name as such. */
  isAdmin: boolean
}

interface UsersPayload {
  users: AdminUserRow[]
  guestProjects: number
  guestOwners: number
  orphaned: { ownerId: string; projectCount: number }[]
}

const when = (t: number | null) => (t ? new Date(t).toLocaleDateString() : '—')

/**
 * Every account that has ever signed in, with how much of the library each
 * one owns.
 *
 * Accounts and projects live in the same Postgres now, so this is the only
 * screen where the two are put side by side. Students never appear here: a
 * guest has no account, so their work is summarised as a tally underneath
 * rather than being silently dropped — otherwise the totals here would
 * disagree with the projects tab for no visible reason.
 *
 * Gating is the server's (`/api/admin/users` 404s a non-admin); this renders
 * whatever it is given.
 */
export default function AdminUsers() {
  const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading')
  const [data, setData] = useState<UsersPayload | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api<UsersPayload>('/api/admin/users'))
      setState('ok')
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? 'denied' : 'error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (state === 'loading')
    return (
      <p className="empty flex items-center gap-2 text-sm text-muted">
        <Loader2 size={13} className="animate-spin" /> Loading accounts…
      </p>
    )
  if (state === 'denied') return <p className="empty text-sm text-muted">Not found.</p>
  if (state === 'error' || !data)
    return <p className="empty text-sm text-muted">Couldn’t load accounts.</p>

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => void load()} className="btn-ghost btn-sm press ml-auto">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {data.users.length === 0 ? (
        <p className="empty text-sm text-muted">No accounts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line/70">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="strip text-left font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                <th className="px-3 py-2 font-semibold">Account</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Projects</th>
                <th className="px-3 py-2 font-semibold">Last project</th>
                <th className="px-3 py-2 font-semibold">Joined</th>
                <th className="px-3 py-2 font-semibold">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.uid} className="border-t border-line bg-fg/[0.02]">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {u.imageUrl ? (
                        <img
                          src={u.imageUrl}
                          alt=""
                          className="h-5 w-5 shrink-0 rounded-full"
                        />
                      ) : (
                        <span className="h-5 w-5 shrink-0 rounded-full bg-fg/10" />
                      )}
                      <span className="text-fg-strong">{u.name ?? '—'}</span>
                      {u.isAdmin && (
                        <span
                          className="chip chip-signal px-1.5 py-0.5 text-[10px]"
                          title="This account is on the ADMIN_EMAILS allowlist"
                        >
                          <ShieldCheck size={10} /> admin
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted">{u.email ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{u.projectCount}</td>
                  <td className="px-3 py-2 text-muted">{when(u.lastProjectAt)}</td>
                  <td className="px-3 py-2 text-muted">{when(u.createdAt)}</td>
                  <td className="px-3 py-2 text-muted">{when(u.lastSignInAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[12px] text-muted">
        {data.guestProjects} guest {data.guestProjects === 1 ? 'track' : 'tracks'} from{' '}
        {data.guestOwners} signed-out {data.guestOwners === 1 ? 'student' : 'students'} —
        they have no account, so they aren’t listed above.
        {data.orphaned.length > 0 && (
          <>
            {' '}
            {data.orphaned.length} owner
            {data.orphaned.length === 1 ? '' : 's'} no longer have an account but still
            own {data.orphaned.reduce((n, o) => n + o.projectCount, 0)} project
            {data.orphaned.reduce((n, o) => n + o.projectCount, 0) === 1 ? '' : 's'}.
          </>
        )}
      </p>
    </>
  )
}
