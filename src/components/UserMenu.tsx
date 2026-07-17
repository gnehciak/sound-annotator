import { useRef, useState } from 'react'
import { LogOut } from 'lucide-react'
import Popover from './Popover'
import type { AppUser } from '../lib/auth'

/**
 * Header account control: the avatar itself is the button, opening a small
 * menu with who's signed in and Sign out. Replaces the old avatar + always-on
 * sign-out icon pair, so the header ends on one quiet identity mark.
 */
export default function UserMenu({
  user,
  onSignOut,
}: {
  user: AppUser
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={user.displayName ?? user.email ?? 'Account'}
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="press shrink-0 rounded-full"
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt=""
            referrerPolicy="no-referrer"
            className={`h-7 w-7 rounded-full border transition-colors ${
              open ? 'border-accent' : 'border-line-strong hover:border-accent/60'
            }`}
          />
        ) : (
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full border bg-raised text-xs font-semibold uppercase text-fg transition-colors ${
              open ? 'border-accent' : 'border-line-strong hover:border-accent/60'
            }`}
          >
            {(user.displayName ?? user.email ?? '?').slice(0, 1)}
          </span>
        )}
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={208}
        className="rounded border border-line bg-panel py-1 shadow-lg"
      >
        <div className="border-b border-line px-2.5 pb-2 pt-1.5">
          <p className="truncate text-[12px] font-semibold text-fg">
            {user.displayName ?? 'Signed in'}
          </p>
          {user.email && (
            <p className="truncate text-[11px] text-muted">{user.email}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            onSignOut()
          }}
          className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] text-muted hover:bg-raised hover:text-fg"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </Popover>
    </>
  )
}
