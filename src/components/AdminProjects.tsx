import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { deleteProjectDoc, saveProject } from '../lib/projectStore'
import { deleteAudioCloud } from '../lib/audioCloud'
import { deleteProjectImages } from '../lib/imageCloud'
import type { Project } from '../types'

interface AdminProject extends Project {
  noteCount: number
  kind: 'guest' | 'account'
  mine: boolean
}

type Filter = 'all' | 'guest' | 'account'

/**
 * Every project in the database — students' guest work and account libraries
 * alike. No other screen can show this: guest owners are synthetic, and an
 * account's library is otherwise visible only to that account.
 *
 * Reached at `?admin=1`, but the URL is not the security: /api/admin/projects
 * checks an ADMIN_EMAILS allowlist server-side on every call and answers 404 to
 * everyone else. This page renders "Not found" in that case rather than
 * "Forbidden" — a stranger learns nothing, and the honest error is what the
 * network tab shows the admin anyway.
 */
export default function AdminProjects() {
  const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading')
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setProjects(await api<AdminProject[]>('/api/admin/projects'))
      setState('ok')
    } catch (e) {
      // 404 is the deliberate answer to a non-admin (see the endpoint).
      setState(e instanceof ApiError && e.status === 404 ? 'denied' : 'error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(
    () => (filter === 'all' ? projects : projects.filter((p) => p.kind === filter)),
    [projects, filter],
  )
  const counts = useMemo(
    () => ({
      all: projects.length,
      guest: projects.filter((p) => p.kind === 'guest').length,
      account: projects.filter((p) => p.kind === 'account').length,
    }),
    [projects],
  )

  const rename = async (p: AdminProject) => {
    const title = window.prompt('Rename this project', p.title)
    if (title == null || title.trim() === '' || title === p.title) return
    setBusyId(p.id)
    try {
      // ownerId is carried through untouched — the API refuses to reassign it,
      // so the project stays whosever it was.
      await saveProject(p.ownerId ?? '', { ...p, title, updatedAt: Date.now() })
      setProjects((ps) => ps.map((x) => (x.id === p.id ? { ...x, title } : x)))
    } catch (e) {
      alert(`Rename failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (p: AdminProject) => {
    const ok = window.confirm(
      `Delete "${p.title}" permanently?\n\n` +
        `${p.noteCount} note${p.noteCount === 1 ? '' : 's'} will be destroyed, ` +
        `along with any audio and images it owns. ` +
        `${p.kind === 'guest' ? "The student's link will stop working. " : ''}` +
        `This cannot be undone.`,
    )
    if (!ok) return
    setBusyId(p.id)
    try {
      // Bytes first, row second. The row is the only way to find these blobs
      // again, so dropping it first would strand them forever; failing here
      // leaves the project intact and the delete retryable instead.
      // Guest projects own no blobs (uploads are signed-in only).
      if (p.ownerId && p.kind === 'account') {
        await Promise.all([
          deleteAudioCloud(p.ownerId, p.id),
          deleteProjectImages(p.ownerId, p.id),
        ])
      }
      await deleteProjectDoc(p.id)
      setProjects((ps) => ps.filter((x) => x.id !== p.id))
    } catch (e) {
      alert(
        `Delete failed: ${e instanceof Error ? e.message : 'unknown error'}\n\n` +
          `The project was left alone.`,
      )
    } finally {
      setBusyId(null)
    }
  }

  if (state === 'loading') return <Centered>Loading…</Centered>
  if (state === 'denied') return <Centered>Not found.</Centered>
  if (state === 'error')
    return <Centered>Couldn’t load projects. Check the console.</Centered>

  return (
    <div className="h-full overflow-y-auto bg-ink text-fg">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_9px_rgb(var(--accent)/0.55)]" />
          <h1 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em]">
            All projects
          </h1>
          <div className="flex items-center gap-1">
            {(['all', 'account', 'guest'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`press rounded border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] ${
                  filter === f
                    ? 'border-accent/70 bg-accent/15 text-accentink'
                    : 'border-line bg-raised text-muted hover:text-fg'
                }`}
              >
                {f} ({counts[f]})
              </button>
            ))}
          </div>
          <button
            onClick={() => void load()}
            className="press ml-auto inline-flex items-center gap-1.5 rounded border border-line bg-raised px-2.5 py-1 font-mono text-[11px] text-fg hover:brightness-110"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="rounded border border-line bg-panel p-8 text-center text-sm text-muted">
            Nothing here.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-panel text-left font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  <th className="px-3 py-2 font-semibold">Title</th>
                  <th className="px-3 py-2 font-semibold">Owner</th>
                  <th className="px-3 py-2 font-semibold">Notes</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Last edited</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="border-t border-line bg-note/40">
                    <td className="max-w-[20rem] truncate px-3 py-2" title={p.title}>
                      {p.title}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                          p.kind === 'guest'
                            ? 'bg-accent/15 text-accentink'
                            : 'bg-raised text-muted'
                        }`}
                        title={p.ownerId ?? ''}
                      >
                        {p.kind === 'guest' ? 'guest' : p.mine ? 'you' : 'account'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] text-muted">
                      {p.noteCount}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] uppercase text-muted">
                      {p.source?.type ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted">
                      {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`/?view=${p.id}`}
                          className="press inline-flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 font-mono text-[11px] text-fg hover:brightness-110"
                          title="Open read-only"
                        >
                          <Eye size={12} /> View
                        </a>
                        <a
                          href={`/?track=${p.id}&admin=1`}
                          className="press inline-flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 font-mono text-[11px] text-fg hover:brightness-110"
                          title="Open in the editor — changes write to this project"
                        >
                          <Pencil size={12} /> Edit
                        </a>
                        <button
                          onClick={() => void rename(p)}
                          disabled={busyId === p.id}
                          className="press inline-flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 font-mono text-[11px] text-fg hover:brightness-110 disabled:opacity-50"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => void remove(p)}
                          disabled={busyId === p.id}
                          className="press inline-flex items-center gap-1 rounded border border-danger/50 bg-danger/10 px-2 py-1 font-mono text-[11px] text-danger hover:bg-danger/20 disabled:opacity-50"
                        >
                          {busyId === p.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Trash2 size={12} />
                          )}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">
          Editing writes straight into the project — on a guest’s track, they’ll
          see your changes. To mark without touching their work, use View, then
          “Make a copy”. Deleting also removes that project’s audio and images
          from storage.
        </p>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-ink text-sm text-muted">
      {children}
    </div>
  )
}
