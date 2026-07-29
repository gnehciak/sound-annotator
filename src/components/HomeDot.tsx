// The signal dot, as the way home.
//
// The accent dot is the app's identity mark: it opens the sign-in card, the
// landing page, the share viewer, the public gallery and the admin console,
// and it sits at the left of every masthead. It used to be decoration in all
// of those — so the one thing every visitor tries on a logo did nothing.
//
// One component so the destination and the affordance can't drift apart
// between six mastheads. The editor's own dot is NOT this: with a track open
// it means "back to this track's folder", which is a different journey, so
// App keeps its own (see the masthead in App.tsx).

import { homeHref } from '../lib/nav'

/**
 * The accent dot, wrapped in a link to the app's home page. `children` (a
 * wordmark, usually) rides inside the link so the whole lockup is one target;
 * pass none where the neighbouring text isn't the wordmark.
 */
export default function HomeDot({
  size = 9,
  children,
  className = '',
}: {
  /** Dot diameter in px — 9 in the 54px mastheads, 10 in centred cards. */
  size?: number
  children?: React.ReactNode
  className?: string
}) {
  return (
    <a
      href={homeHref()}
      title="Sound Annotator — home"
      aria-label="Sound Annotator — home"
      className={`press group flex shrink-0 items-center gap-[9px] rounded ${className}`}
    >
      {/* The lift is on the group, so hovering the wordmark answers too. */}
      <span
        aria-hidden
        style={{ height: size, width: size }}
        className="shrink-0 rounded-full bg-accent shadow-[0_0_9px_rgb(var(--accent)/0.55)] transition-transform duration-150 ease-instr group-hover:scale-110"
      />
      {children}
    </a>
  )
}
