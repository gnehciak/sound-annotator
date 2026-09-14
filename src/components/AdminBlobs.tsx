import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  FileAudio,
  FileImage,
  FileText,
  File as FileIcon,
  Folder,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { api, ApiError } from '../lib/api'

interface BlobFolder {
  name: string
  bytes: number
  count: number
  newest: number
}
interface BlobFile {
  name: string
  pathname: string
  url: string
  size: number
  uploadedAt: number
}
interface BlobListing {
  path: string
  folders: BlobFolder[]
  files: BlobFile[]
  bytes: number
  count: number
  truncated: boolean
  labels: Record<string, string>
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

const when = (t: number) => new Date(t).toLocaleDateString()

const IMAGE = /\.(png|jpe?g|webp|gif|avif|svg)$/i
const AUDIO = /\.(m4a|mp3|wav|webm|opus|ogg|flac|aac|mp4)$/i
const DOC = /\.(pdf|json|txt|md)$/i

function FileGlyph({ name }: { name: string }) {
  const cls = 'shrink-0 text-muted'
  if (IMAGE.test(name)) return <FileImage size={14} className={cls} />
  if (AUDIO.test(name)) return <FileAudio size={14} className={cls} />
  if (DOC.test(name)) return <FileText size={14} className={cls} />
  return <FileIcon size={14} className={cls} />
}

/**
 * The Blob store as a file explorer: one folder per screen, its subfolders
 * sized by everything beneath them (the number an admin comes here for —
 * which prefix is eating the store), its files openable and copyable.
 *
 * The folder is a route (`?admin=1&tab=storage&path=…`), so Back climbs out
 * of a folder rather than out of the console, and a deep prefix can be sent
 * as a link. Read-only on purpose: the two purge paths (App's purgeProject
 * and the cron) are the only things that delete from the store, and a delete
 * key beside every note image would be a way to break a live track by one
 * stray click. Gating is the server's (`/api/admin/blobs` 404s a non-admin);
 * this renders whatever it is given.
 */
export default function AdminBlobs({
  path,
  onOpen,
}: {
  /** The folder shown, `''` for the root; always ends in `/` otherwise. */
  path: string
  onOpen: (path: string) => void
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading')
  const [data, setData] = useState<BlobListing | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ path })
      setData(await api<BlobListing>(`/api/admin/blobs?${q}`))
      setState('ok')
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? 'denied' : 'error')
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  const copy = async (f: BlobFile) => {
    try {
      await navigator.clipboard.writeText(f.url)
      setCopied(f.pathname)
      setTimeout(() => setCopied((c) => (c === f.pathname ? null : c)), 1500)
    } catch {
      window.prompt('Copy the URL', f.url)
    }
  }

  // Breadcrumb: the root, then each folder of the path, each a link up.
  const crumbs = path.split('/').filter(Boolean)
  const crumbPath = (i: number) => crumbs.slice(0, i + 1).join('/') + '/'

  // Loading is derived, not set: the first read, or a listing for a folder
  // other than the one the route now names (a click, or Back).
  const loading = state === 'loading' || (state === 'ok' && data != null && data.path !== path)

  if (state === 'denied') return <p className="empty text-sm text-muted">Not found.</p>

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[12px]">
          <button
            type="button"
            onClick={() => onOpen('')}
            disabled={!path}
            className="press rounded px-1 text-fg-strong hover:bg-fg/[0.05] disabled:pointer-events-none"
          >
            store
          </button>
          {crumbs.map((c, i) => (
            <span key={crumbPath(i)} className="flex items-center gap-1">
              <span className="text-muted">/</span>
              <button
                type="button"
                onClick={() => onOpen(crumbPath(i))}
                disabled={i === crumbs.length - 1}
                className="press max-w-[24ch] truncate rounded px-1 text-fg-strong hover:bg-fg/[0.05] disabled:pointer-events-none disabled:text-muted"
                title={c}
              >
                {c}
              </button>
            </span>
          ))}
        </nav>
        <span className="flex-1" />
        {data && state === 'ok' && !loading && (
          <span className="text-[12px] tabular-nums text-muted">
            {data.count.toLocaleString()} {data.count === 1 ? 'file' : 'files'},{' '}
            {formatBytes(data.bytes)}
            {data.truncated && ' (at least — the listing was cut short)'}
          </span>
        )}
        <button onClick={() => void load()} className="btn-ghost btn-sm press">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="empty flex items-center gap-2 text-sm text-muted">
          <Loader2 size={13} className="animate-spin" /> Reading the store…
        </p>
      ) : state === 'error' || !data ? (
        <p className="empty text-sm text-muted">Couldn’t read the store.</p>
      ) : data.folders.length === 0 && data.files.length === 0 ? (
        <p className="empty text-sm text-muted">Nothing here.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line/70">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="strip text-left font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 text-right font-semibold">Files</th>
                <th className="px-3 py-2 text-right font-semibold">Size</th>
                <th className="px-3 py-2 font-semibold">Newest</th>
                <th className="px-3 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {data.folders.map((f) => (
                <tr key={`d:${f.name}`} className="border-t border-line bg-fg/[0.02]">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpen(`${path}${f.name}/`)}
                      className="press flex max-w-full items-center gap-2 rounded text-left font-mono text-[12.5px] text-fg-strong hover:underline"
                      title={`Open ${path}${f.name}/`}
                    >
                      <Folder size={14} className="shrink-0 text-accent-ink" />
                      <span className="truncate">{f.name}/</span>
                    </button>
                    {data.labels[f.name] && (
                      <span className="mt-0.5 block truncate pl-[22px] text-[11.5px] text-muted">
                        {data.labels[f.name]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{f.count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBytes(f.bytes)}</td>
                  <td className="px-3 py-2 text-muted">{when(f.newest)}</td>
                  <td className="px-3 py-2" />
                </tr>
              ))}
              {data.files.map((f) => (
                <tr key={`f:${f.pathname}`} className="border-t border-line">
                  <td className="px-3 py-2">
                    <span className="flex max-w-full items-center gap-2 font-mono text-[12.5px]">
                      <FileGlyph name={f.name} />
                      <span className="truncate" title={f.pathname}>
                        {f.name}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">{formatBytes(f.size)}</td>
                  <td className="px-3 py-2 text-muted">{when(f.uploadedAt)}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center justify-end gap-1">
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in a new tab"
                        aria-label={`Open ${f.name}`}
                        className="btn-icon press"
                      >
                        <ExternalLink size={13} />
                      </a>
                      <button
                        type="button"
                        onClick={() => void copy(f)}
                        title="Copy the URL"
                        aria-label={`Copy the URL of ${f.name}`}
                        className="btn-icon press"
                      >
                        {copied === f.pathname ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
