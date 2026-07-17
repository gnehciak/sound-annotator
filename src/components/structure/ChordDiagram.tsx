import { memo } from 'react'
import type { ChordShape } from '../../lib/chords'

/**
 * A guitar chord box: name above a 6-string / 4-fret grid with the standard
 * chart vocabulary — thick nut (or an "Nfr" position label when the window
 * starts higher), numbered finger dots, rounded barre pills, ×/○ markers for
 * muted/open strings, EADGBE letters along the base. Pure SVG on the design
 * tokens: hairlines for the grid, `fg` for the fingering (the data), muted
 * for the furniture — so it reads on both themes and every palette.
 *
 * A null shape (an unparseable symbol) still draws the frame with a "?" —
 * the label is shown, the fingering is honestly unknown.
 */

// Grid geometry, in viewBox units.
const XS = [10, 24.8, 39.6, 54.4, 69.2, 84] // string x positions
const GRID_TOP = 16
const ROW_H = 19
const ROWS = 4
const GRID_BOTTOM = GRID_TOP + ROW_H * ROWS
const DOT_R = 6.6

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'E']

// Memoized: the rail re-renders every animation frame while the song plays,
// but a diagram's props (name + cached shape identity) only change on a
// chord change — the SVG subtree can sit the frames out.
export default memo(ChordDiagram)

function ChordDiagram({
  name,
  shape,
  className = '',
}: {
  name: string
  shape: ChordShape | null
  className?: string
}) {
  const label = shape
    ? `${name} chord${shape.position > 1 ? `, played at fret ${shape.position}` : ''}`
    : `${name} chord — no diagram for this symbol`

  /** Absolute fret → vertical center of its display row. */
  const rowY = (fret: number) =>
    GRID_TOP + (fret - (shape?.position ?? 1)) * ROW_H + ROW_H / 2

  const covered = (s: number, fret: number) =>
    shape?.barres.some((b) => b.fret === fret && s >= b.from && s <= b.to) ??
    false

  return (
    <figure aria-label={label} className={`m-0 ${className}`}>
      <figcaption className="mb-1 truncate text-center font-mono text-[15px] font-semibold leading-none text-fg">
        {name}
      </figcaption>
      <svg
        viewBox="0 0 112 112"
        aria-hidden
        className="block w-full select-none"
      >
        {/* Frets (horizontal) + strings (vertical). */}
        {Array.from({ length: ROWS + 1 }, (_, i) => (
          <line
            key={`f${i}`}
            x1={XS[0]}
            x2={XS[5]}
            y1={GRID_TOP + i * ROW_H}
            y2={GRID_TOP + i * ROW_H}
            strokeWidth={1}
            className="stroke-muted/70"
          />
        ))}
        {XS.map((x, i) => (
          <line
            key={`s${i}`}
            x1={x}
            x2={x}
            y1={GRID_TOP}
            y2={GRID_BOTTOM}
            strokeWidth={1}
            className="stroke-muted/70"
          />
        ))}

        {shape && shape.position === 1 && (
          // The nut — a thick bar where the strings end.
          <rect
            x={XS[0] - 1}
            y={GRID_TOP - 4}
            width={XS[5] - XS[0] + 2}
            height={4}
            rx={1}
            className="fill-fg"
          />
        )}
        {shape && shape.position > 1 && (
          <text
            x={110}
            y={GRID_TOP + ROW_H / 2 + 3}
            fontSize={8}
            textAnchor="end"
            className="fill-muted font-mono"
          >
            {shape.position}fr
          </text>
        )}

        {/* ×/○ — muted and open strings, above the nut. */}
        {shape?.frets.map((f, s) => {
          if (f === null)
            return (
              <g key={`x${s}`} className="stroke-muted" strokeWidth={1.3}>
                <line x1={XS[s] - 3} x2={XS[s] + 3} y1={4.5} y2={10.5} />
                <line x1={XS[s] - 3} x2={XS[s] + 3} y1={10.5} y2={4.5} />
              </g>
            )
          if (f === 0)
            return (
              <circle
                key={`o${s}`}
                cx={XS[s]}
                cy={7.5}
                r={3.4}
                fill="none"
                strokeWidth={1.3}
                className="stroke-muted"
              />
            )
          return null
        })}

        {/* Barres — rounded pills with the finger number at their center. */}
        {shape?.barres.map((b, i) => {
          const y = rowY(b.fret)
          return (
            <g key={`b${i}`}>
              <rect
                x={XS[b.from] - DOT_R}
                y={y - DOT_R}
                width={XS[b.to] - XS[b.from] + DOT_R * 2}
                height={DOT_R * 2}
                rx={DOT_R}
                className="fill-fg"
              />
              <text
                x={(XS[b.from] + XS[b.to]) / 2}
                y={y + 3}
                fontSize={8.5}
                fontWeight={600}
                textAnchor="middle"
                className="fill-ink font-mono"
              >
                {b.finger}
              </text>
            </g>
          )
        })}

        {/* Finger dots. */}
        {shape?.frets.map((f, s) => {
          if (f == null || f === 0 || covered(s, f)) return null
          const y = rowY(f)
          return (
            <g key={`d${s}`}>
              <circle cx={XS[s]} cy={y} r={DOT_R} className="fill-fg" />
              {shape.fingers[s] > 0 && (
                <text
                  x={XS[s]}
                  y={y + 3}
                  fontSize={8.5}
                  fontWeight={600}
                  textAnchor="middle"
                  className="fill-ink font-mono"
                >
                  {shape.fingers[s]}
                </text>
              )}
            </g>
          )
        })}

        {!shape && (
          <text
            x={(XS[0] + XS[5]) / 2}
            y={GRID_TOP + (ROW_H * ROWS) / 2 + 5}
            fontSize={17}
            textAnchor="middle"
            className="fill-muted font-mono"
          >
            ?
          </text>
        )}

        {/* String letters. */}
        {XS.map((x, i) => (
          <text
            key={`n${i}`}
            x={x}
            y={GRID_BOTTOM + 11}
            fontSize={7}
            textAnchor="middle"
            className="fill-muted font-mono"
          >
            {STRING_NAMES[i]}
          </text>
        ))}
      </svg>
    </figure>
  )
}
