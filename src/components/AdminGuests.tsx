import { useCallback, useEffect, useState } from 'react'
import { Eye, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { deleteProjectDoc, saveProject } from '../lib/projectStore'
import type { Project } from '../types'

interface GuestProject extends Project {
  noteCount: number
}

/**
 * The teacher's view of every guest project — students' work, which no other
 * screen can list (guest owners are synthetic and their ids key nothing).
 *
 * Reached at `?admin=1`, but the URL is not the security: /api/admin/guests
 * checks an ADMIN_EMAILS allowlist server-side on every call, and answers 404
 * to everyone else. This page renders "Not found" in that case rather than
 * "Forbidden" — a hidden page nobody can confirm exists is worth slightly more
 * than an honest error, and the honest error is what the network tab shows the
 * admin anyway.
 */
export default function AdminGuests() {
  const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading')
  const [projects, setProjects] = useState<GuestProject[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setProjects(await api<GuestProject[]>('/api/admin/guests'))
      setState('ok')
    } catch (e) {
      // 404 is the deliberate answer to a non-admin (see the endpoint).
      setState(e instanceof ApiError && e.status === 404 ? 'denied' : 'error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rename = async (p: GuestProject) => {
    const title = window.prompt('Rename this project', p.title)
    if (title == null || title.trim() === '' || title === p.title) return
    setBusyId(p.id)
    try {
      // ownerId is carried through untouched — the API refuses to reassign it,
      // and this project stays the student's.
      await saveProject(p.ownerId ?? '', { ...p, title, updatedAt: Date.now() })
      setProjects((ps) => ps.map((x) => (x.id === p.id ? { ...x, title } : x)))
    } catch (e) {
      alert(`Rename failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (p: GuestProject) => {
    // Deleting someone else's work: name it, and say what's lost. There is no
    // undo and no backup.
    const ok = window.confirm(
      `Delete "${p.title}" permanently?\n\n` +
        `${p.noteCount} note${p.noteCount === 1 ? '' : 's'} will be destroyed. ` +
        `The student's link will stop working. This cannot be undone.`,
    )
    if (!ok) return
    setBusyId(p.id)
    try {
      await deleteProjectDoc(p.id)
      setProjects((ps) => ps.filter((x) => x.id !== p.id))
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setBusyId(null)
    }
  }

  if (state === 'loading') return <Centered>Loading…</Centered>
  if (state === 'denied') return <Centered>Not found.</Centered>
  if (state === 'error')
    return <Centered>Couldn’t load guest projects. Check the console.</Centered>

  return (
    <div className="h-full overflow-y-auto bg-ink text-fg">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_9px_rgb(var(--accent)/0.55)]" />
          <h1 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em]">
            Guest projects
          </h1>
          <span className="font-mono text-[11px] text-muted">
            {projects.length} total
          </span>
          <button
            onClick={() => void load()}
            className="press ml-auto inline-flex items-center gap-1.5 rounded border border-line bg-raised px-2.5 py-1 font-mono text-[11px] text-fg hover:brightness-110"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {projects.length === 0 ? (
          <p className="rounded border border-line bg-panel p-8 text-center text-sm text-muted">
            No guest projects yet. They appear here as soon as a student starts
            one.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-panel text-left font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  <th className="px-3 py-2 font-semibold">Title</th>
                  <th className="px-3 py-2 font-semibold">Notes</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Last edited</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-t border-line bg-note/40">
                    <td className="max-w-[22rem] truncate px-3 py-2" title={p.title}>
                      {p.title}
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] text-muted">
                      {p.noteCount}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] uppercase text-muted">
                      {p.source?.type ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted">
                      {p.updatedAt
                        ? new Date(p.updatedAt).toLocaleString()
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`/?view=${p.id}`}
                          className="press inline-flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 font-mono text-[11px] text-fg hover:brightness-110"
                          title="Open read-only, exactly as the student handed it in"
                        >
                          <Eye size={12} /> View
                        </a>
                        <a
                          href={`/?track=${p.id}`}
                          className="press inline-flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 font-mono text-[11px] text-fg hover:brightness-110"
                          title="Open in the editor — your changes write to the student's project"
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
          Editing writes straight into the student’s project — they’ll see your
          changes. To mark without touching their work, use View, then “Make a
          copy”.
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
