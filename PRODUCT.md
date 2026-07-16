# Product

## Register

product

## Users

Music educators, and secondarily their students, in a classroom setting. The
primary user is the **teacher / power user**: someone who uses the tool
repeatedly to prepare and present musical analysis and who values speed and
control over hand-holding. They work on a laptop, often mirrored to a classroom
projector, walking a class through a piece. The job to be done: load a recording
(a YouTube link or an audio file) and attach precise, timestamped, richly
formatted notes to specific moments, then replay those moments on demand.

## Product Purpose

Sound Annotator turns any track into a navigable, annotated analysis. Teachers
mark up music with time-anchored notes (form, instrumentation, dynamics,
harmony) that seek the player when clicked and highlight as the track plays. It
exists because generic note-taking and rich-text editors are not time-aware: the
value here is that every note is pinned to a moment and the tool behaves like
editing software rather than a document. Success looks like a teacher building a
full analysis of a piece in minutes and navigating it fluidly in front of a
class.

## Brand Personality

Precise, technical, pro-tool — with a playful signal. The interface should feel
like a piece of studio gear or an editing application (DAW / NLE), not a web
dashboard: confident, dense, instrument-like. One untinted neutral stage
(graphite dark default; a pure-white light theme where hairlines carry the
structure), IBM Plex type in two voices (a humanist-technical sans, its
matching mono for timecodes), softly squared corners, LED-style readouts, and
**color as accent, never as canvas**: one committed playful signal hue
(tangerine by default; the user can choose bubblegum, limeade, or crayon —
always a single signal) plus a crayon-box note-data palette. UI copy is terse
and functional (verb plus object on buttons, no marketing tone).

## Anti-references

- **Generic AI / shadcn dashboards**: rounded cards, soft drop shadows, indigo
  accent, evenly padded "friendly SaaS" whitespace. This is the primary thing to
  avoid; the design has deliberately moved to flush panels, hard dividers, and
  softly squared corners.
- **Heavy enterprise SaaS clutter**: gray-on-gray toolbars, competing controls,
  data-grid busyness. Density is welcome, clutter is not; every control must earn
  its place.
- **Retro skeuomorphism**: fake wood or metal textures, glossy bevels,
  brushed-aluminum. The "gear" feel comes from layout, type, and restraint, not
  from faux-physical texture. Keep depth cues subtle and flat.

## Design Principles

1. **Time is the spine.** Every annotation is anchored to a moment;
   navigation by time (click-to-seek, active-note highlighting) is the core
   interaction, not an add-on.
2. **An instrument, not a document.** Behave like editing software: panels,
   transport, readouts, keyboard-fast. Reach for tool conventions before web-app
   conventions.
3. **Dense but never cluttered.** Optimize for an expert who returns daily. Show
   what is useful at rest; reveal secondary controls on hover or focus rather
   than crowding them on screen or burying them in menus.
4. **Committed, not tasteful-by-default.** One untinted neutral canvas, one
   playful signal accent, softly squared corners (5–10px), monospace numerics.
   No hedging back toward the generic.
5. **Legible under classroom conditions.** It gets projected and read at a
   distance, so contrast and sizing must hold up on a dim display, and meaning
   must never depend on color alone.

## Accessibility & Inclusion

Target WCAG 2.1 AA (body text at least 4.5:1, large text at least 3:1, visible
focus, adequate target sizes). Two project-specific considerations, assumed from
the classroom context and open to correction: (1) **projector legibility**,
sizing and contrast must survive a dim, distant display; (2) **colorblind-safe
notes**, the notes are color-coded, so color must never be the only signal
(pair it with the timecode label and position). Full keyboard and screen-reader
support for the transport and editor is a desirable next step.
