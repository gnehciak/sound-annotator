---
name: Sound Annotator
description: A time-anchored music annotation tool for the classroom, built like an audio analysis bench.
colors:
  ink: "#161618"
  panel: "#1e1e22"
  raised: "#28282d"
  inset: "#0f0f12"
  border: "#36363d"
  border-strong: "#4e4e57"
  text: "#ececf0"
  muted: "#a4a4ae"
  accent: "#ff6a3d"
  meter: "#ffce33"
  note-red: "#ff5252"
  note-orange: "#ff9f2e"
  note-yellow: "#ffd633"
  note-green: "#3ddc74"
  note-teal: "#2dd4bf"
  note-sky: "#5aa8ff"
  note-pink: "#f472b6"
  note-violet: "#a06bff"
typography:
  display:
    fontFamily: "'IBM Plex Sans', system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "'IBM Plex Sans', system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.2em"
  mono:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  none: "0px"
  sm: "5px"
  DEFAULT: "6px"
  md: "8px"
  lg: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-play:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.DEFAULT}"
    padding: "6px 12px"
    typography: "{typography.body}"
  button-transport:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.muted}"
    rounded: "{rounded.DEFAULT}"
    padding: "6px 8px"
    typography: "{typography.mono}"
  button-capture:
    textColor: "{colors.accent}"
    rounded: "{rounded.DEFAULT}"
    padding: "6px 10px"
    typography: "{typography.label}"
  title-bar:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.muted}"
    rounded: "{rounded.none}"
    padding: "0 14px"
    height: "40px"
    typography: "{typography.label}"
  input-field:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.text}"
    rounded: "{rounded.DEFAULT}"
    padding: "8px 12px"
    typography: "{typography.body}"
  readout-led:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.accent}"
    rounded: "{rounded.DEFAULT}"
    padding: "4px 8px"
    typography: "{typography.mono}"
---

# Design System: Sound Annotator

## 1. Overview

**Creative North Star: "The Listening Station"** — restaged 2026-07-17 under
the **Color-As-Accent doctrine**: *color as accent, never as canvas*.

Sound Annotator is built like an audio analysis bench, not a web app. The
stage is one untinted neutral — quiet graphite in dark, pure white end to end
in light — so the eye rests on the recording and the notes, not the chrome.
Everything reads like instrument output: timecodes and counts are monospace,
the transport carries an LED clock and a level meter, panels are flush with
softly squared corners. It is dense by intent, optimized for a teacher who
returns to it daily and knows it cold.

Color is treated as data and signal, not decoration — and it is *playful*
where it appears: a juicy selectable signal hue (Tangerine by default), a
sunshine meter, and a full crayon-box note palette. The surfaces themselves
never take a tint; the one exception is the selected note row, which wears a
faint wash of the signal. The signal means *now*: the playhead, the active
note, the primary action. The note hues encode *identity* (which note is
which), never mood, and they are always paired with a monospace timecode so
meaning survives a projector or a colorblind viewer.

This system explicitly rejects the generic. No rounded cards floating on soft
drop shadows. No indigo "friendly SaaS" accent. No gray-on-gray enterprise
clutter where fourteen controls compete in every corner. And no retro
skeuomorphism: the instrument feel comes from layout, type, and restraint, never
from fake metal or glossy bevels.

**Key Characteristics:**
- One untinted neutral stage (graphite dark / pure-white light), four-step
  tonal ramp; depth from tone and hairlines, not shadow.
- Color only as accent: one signal hue meaning "now", a meter hue, and the
  crayon-box note data. Surfaces never take a tint.
- Monospace tabular numerics for every timecode, count, and micro-label.
- Softly squared corners (chips 5px · controls 6px · grouped containers 8px ·
  panels 10px), flush panels, hairline dividers; zero card-gaps.
- Secondary controls hidden at rest, revealed on hover or focus.

## 2. Colors

One untinted neutral stage carrying a single playful signal, with a crayon-box
data palette reserved for note identity. **Color as accent, never as canvas**
(2026-07-17): the neutrals are shared by every palette and never move; only
the accents change.

### Primary
- **Signal Tangerine** (#ff6a3d dark / #e04e1a light): The only voice color.
  Marks the present moment and the primary action: the playhead, the active
  ("now playing") note, the Play button, the active track's spine, the LED
  readout glow. Used sparingly by design. The signal *hue* is user-selectable
  (see "Themes & Palettes" below): Tangerine is the default of four palettes
  (Tangerine / Bubblegum / Limeade / Crayon). Everything said about the signal
  holds for whichever hue is active.

### Secondary
- **Meter** (Tangerine palette: sunshine #ffce33 dark / #b98600 light):
  Reserved for the output level meter, reading like an instrument's
  signal-present indicator. Each palette brings its own meter hue as the one
  supporting act; never used as a general accent.

### Tertiary (Note Data Palette)
Reserved exclusively for distinguishing notes. Never used as UI accents.
Full crayon-box saturation — on the neutral stage, the note data carries the
playfulness:
- **Red** (#ff5252), **Orange** (#ff9f2e), **Yellow** (#ffd633),
  **Green** (#3ddc74), **Teal** (#2dd4bf), **Sky** (#5aa8ff),
  **Pink** (#f472b6), **Violet** (#a06bff). Each is assigned
  deterministically from the note id (`src/lib/noteColors.ts`); the same hues
  serve the tag and element palettes.

### Neutral (shared by every palette)
Dark — untinted graphite:
- **Ink** (#161618): App background, the deepest surface.
- **Panel** (#1e1e22): Standard panel fill (sidebar, transport strip).
- **Raised** (#28282d): Lifted controls and panel title bars.
- **Inset** (#0f0f12): Recessed "screens": LED readouts, the level meter well,
  text inputs, the waveform/editor canvas.
- **Border** (#36363d) / **Border Strong** (#4e4e57): Hairline dividers and
  hover/active edges. Borders carry structure here, not shadows.
- **Text** (#ececf0). **Muted** (#a4a4ae): labels, secondary text, inactive.

### Named Rules
**The Accent-Not-Canvas Rule.** Surfaces are neutral in both modes — untinted
graphite in dark, pure white in light. Color arrives only as the signal, the
meter, the note data, and the faint signal wash on the selected row
(`--row-sel`). If a background is carrying a hue anywhere else, it's wrong.

**The Signal-Is-Now Rule.** The active palette's signal color means the
present moment or the primary action, nothing else. It is forbidden as a
decorative fill. If more than roughly 10% of a screen is the signal color,
something non-temporal has stolen it.

**The Color-Is-Data Rule.** Hue only ever encodes identity (which note), never
emotion or hierarchy. Any color-coded element must also carry a text label
(timecode), so it reads correctly on a dim projector and for colorblind users.

### Themes & Palettes (Dark / Light × Tangerine / Bubblegum / Limeade / Crayon)

The theme has **two axes** off one set of CSS variables: the **mode** (dark,
default, described above; or light) and the **signal palette** (which hue plays
the "now" role). Both are picked from the header theme dropdown; `System`
follows the OS for the mode. The axes are `data-theme` and `data-palette` on
`<html>` (a boot script in `index.html` paints both before first render, so
there's no flash); tokens live in `src/index.css`, the runtime in
`src/lib/theme.ts`. Because the neutral canvas is shared, palette blocks
redefine only the accent family — `--accent` / `--accent-ink` / `--on-accent`,
the meter, the `--row-sel` wash, and (where the signal would collide with
delete affordances) danger. Bevels, LED glow, and motion inherit from the mode
blocks (the glow auto-follows the palette because it reads
`var(--accent-ink)`).

The four palettes (signal fill, dark / light):

- **Tangerine** (default) — `#ff6a3d` / `#e04e1a`, sunshine meter. One juicy
  orange does all the talking.
- **Bubblegum** — `#ff4fd1` / `#d61fae`, aqua meter (`#2ee6c8` / `#0d9488`).
  The hottest voice; still reads like a record light. **Danger shifts to plain
  red** (`#ff5c5c` dark / `#b91c1c` light) in this palette only, so delete
  affordances never read as the pink signal.
- **Limeade** — lime `#c0f03c` on dark, deepened to emerald `#16a34a` in light
  so text and fills stay AA on white; violet meter (`#b497ff` / `#7c58e8`) as
  the wink.
- **Crayon** — cobalt `#4f8bff` / `#335df0`, green meter (`#3ddc74` /
  `#1e9e4e`). The chrome stays quietest here and the note data carries the
  playfulness. Crayon light is the one place `--on-accent` (text on the signal
  fill: Play, sign-in, copy) diverges from `--on-bright` (text on data-hue
  chips, always dark): the cobalt fill carries white text.

The note **data palette** (red/orange/yellow/green/teal/sky/pink/violet) is
palette-independent: hue-as-identity must stay stable when the signal hue
changes. (Known softness: an orange note spine sits near the Tangerine signal,
pink notes near Bubblegum, green near Limeade, sky near Crayon — the playing
state never relies on hue alone, the dot + row wash + chip carry it.)

Light is **pure white end to end** — the page, panels, chrome, and masthead
are all `#ffffff`; structure comes from hairlines and two shallow neutral
wells. Light surface ramp (all palettes; see `src/index.css`):
**ink / panel / note** `#ffffff` · **raised** `#f2f2f5` (title bars, hover,
lifted controls) · **inset** `#e8e8ec` (readouts, inputs, the player screen) ·
**border** `#d4d4d9` · **border-strong** `#a0a0a8` · **text** `#1d1d21` ·
**muted** `#62626b`.

Three light-specific rules, all WCAG-AA verified:

- **The White-Sheet Rule** (supersedes the White-Page and Dark-Masthead rules,
  2026-07-17). The whole light theme is one clean white sheet — including the
  global header, which previously kept dark chrome (the retired `.chrome-dark`
  zone). Nothing is tinted; the selected/active note row alone takes
  `--row-sel`, a 7–8% wash of the signal over white. (History: the tinted-
  chrome "Daylit Station" and its dark masthead were replaced when the user
  chose color-as-accent-only — see the palette-mockups artifact.)
- **The Two-Signal Rule.** The signal stays singular, but splits by job in
  every palette: `--accent` is the signal for **fills and graphics** (Play,
  spines, dots, progress; e.g. `#e04e1a` in tangerine light), and
  `--accent-ink` is the contrast-safe variant for **text, the LED readout,
  links, and the focus ring** (e.g. `#a63a10` in tangerine light). They are
  **identical in dark**; the split only exists where a fill-strength signal
  would fail AA as text on white. Every light accent fill is also tuned so its
  `--on-accent` text (the Play button) clears 4.5:1 while the fill itself
  holds ≥3:1 on white.
- **The Hue-As-Data-Holds Rule.** The note/tag/element hues stay raw as
  **fills** in both themes; used as **text or a 1px border** on the white page
  they are mixed toward ink for AA (`src/lib/noteColors.ts` → `hueText`). The
  LED glow is dropped in light (a glow is a dark-screen affordance).

## 3. Typography

**Display / Body Font:** IBM Plex Sans (with system-ui, 'Segoe UI', Roboto fallbacks)
**Label / Mono Font:** IBM Plex Mono (with ui-monospace, SFMono-Regular, Menlo, Consolas fallbacks)

**Character:** The interface speaks in two voices. A quiet humanist-technical
sans (IBM Plex Sans) carries all prose (notes, titles, helper text); its
matching mono (IBM Plex Mono) carries every number and every micro-label, the
way a piece of gear silkscreens its panel. The contrast between the two is the
type system; there is no third face.

### Hierarchy
- **Display** (700, 1.125rem, 1.2): The editable track title in the sub-bar. The
  largest prose on screen; this is a tool, so nothing shouts.
- **Body** (400, 0.8125rem, 1.6): Note content in the TipTap editor and general
  UI copy. Cap reading measure around 65–75ch inside a note.
- **Label** (600, 0.625rem/10px, +0.2em, UPPERCASE): Panel title bars, source
  badges, "live" indicators, the ⤓-set control. Monospace, always uppercase.
- **Mono Readout** (500, 1rem, +0.08em, tabular): The LED transport/header clock
  and every timecode tag. Signal-colored, with a soft glow on the primary clock
  in dark.

### Named Rules
**The Monospace-Numerics Rule.** Every timecode, duration, and count is monospace
and tabular-figure. Numbers must never reflow or jitter as they tick. Prose is
never monospace; numerics are never proportional.

**The No-Shouting Rule.** This is product UI: display type stays ≤1.25rem. There
is no hero type. Hierarchy comes from weight, case, and the mono/sans split, not
from size.

## 4. Elevation

Flat by doctrine. Depth is built from the four-step tonal ramp
(ink → panel → raised → inset), not from drop shadows. A panel is "above" the
background because it is lighter, and a readout is "below" the panel because it is
darker. The only shadows in the system are 1px bevels used to make a handful of
*controls* feel physical: an inset shadow on recessed screens (LED readout, meter
well, inputs) and a subtle raised highlight on the primary Play button.

### Shadow Vocabulary
Both bevels are **theme-tuned tokens** (`--bevel-inset` / `--bevel-raised`):
heavy on dark, whisper-soft on light so a black inset shadow never dirties a pale
surface. Values below are the dark theme.
- **Inset bevel** (`box-shadow: inset 0 1px 3px rgb(0 0 0 / 0.6)`): Recessed
  screens only: LED readouts, the meter well, text inputs, the editor canvas.
- **Raised bevel** (`box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25), inset 0 -2px 3px rgb(0 0 0 / 0.32)`):
  The primary Play button only. A hint of a physical key, not a gel button.

### Named Rules
**The Tonal-Depth Rule.** Reach for the surface ramp before any shadow. If two
surfaces need separating, change their tone or draw a hairline; do not float one
on a shadow.

**The Bevel-Restraint Rule.** Bevels are 1px lighting hints on interactive
controls only. Textures, gradients on surfaces, gloss, and faux-material finishes
are forbidden. The moment a bevel looks like brushed metal, it has failed.

## 5. Components

### Buttons
- **Shape:** Softly squared (6px radius; tiny chips 5px, segmented/grouped
  containers 8px). No pills beyond dots, toggle knobs, and scrubber handles;
  no fully-rounded buttons.
- **Primary (Play):** Solid signal fill (`--accent`), `--on-accent` text, the
  raised bevel, padding 6px 12px. Brightens slightly on hover. The one filled
  button in the transport.
- **Transport (±5s):** Ghost. Transparent fill, 1px Border, Muted text,
  monospace. Hover lifts text to Text and border to Border Strong.
- **Capture (Note @):** Signal outline. Translucent signal fill
  (`--accent` at 0.1), 1px signal border at 70%, signal uppercase mono label.
  Fill deepens to 0.2 on hover. Signals the primary creative action without a
  second solid-signal element competing with Play.

### Inputs / Fields
- **Style:** Inset. Inset (#0f0f12 dark / #e8e8ec light) fill, 1px Border, Text
  color, 6px radius.
- **Focus:** Border shifts to the signal. No glow ring, no box-shadow halo.
- **Placeholder:** Muted; never lighter (keep ≥4.5:1).

### Title Bars
- Filled panel headers (40px tall): Raised fill, 1px bottom Border, Muted
  uppercase mono label (+0.25em), optional right-aligned mono stat. Every panel
  (Tracks, Viewer, Annotations) wears one. This is the load-bearing "instrument
  panel" device of the whole UI.

### Readouts (LED) & Level Meter
- **LED readout:** Inset well, signal-colored monospace with a soft
  text-shadow glow in dark (`--led-glow`, reads `var(--accent-ink)`), tabular
  figures. The transport and header clock.
- **Level meter:** 16 thin segments in an inset well; the palette's meter hue
  low, signal mid, red (`--peak`) peak. Animates while playing, dim at rest.

### Note Rows (Signature Component)
The note list is a flush cue list, not a stack of cards. Each note is a
full-width row separated by hairline dividers, with a full-height colored spine
(3px) on the left edge encoding its identity. The header line carries a colored
monospace timecode tag (click to seek); a ranged note shows `start–end` plus its
length. The active note takes the `--row-sel` signal wash and shows a signal
"playing" dot. Secondary
controls (Set start / Set end / Clear end, delete, and the formatting toolbar)
are hidden at rest and revealed on hover or focus, keeping the resting state
quiet.

### Navigation (Library) — "Station Cards"
The signed-in landing view. Still flat Panel tiles (hairline border, softly
squared corners — no soft cards), grouped into folders with Drive semantics (folder
cards at the root, drill in to see a folder's tracks), but the surface warmed
for a wider audience (2026-06-08) without leaving the system:

- **Cover-led tiles.** Every track leads with its cover in an inset "viewer
  screen" well (hairline below): the YouTube thumbnail, or — for audio files,
  sourceless tracks, and dead thumbs — a deterministic waveform mark generated
  from the track id in the id's note hue (`hueText`-mixed in light).
- **The cue line.** Under each cover, a slim strip draws every note as a tick
  at its real position in the track, in the note's own colour (positions
  normalise against the last note; hues `hueText`-mixed in light). Colour
  stays data — the line is the track's annotation fingerprint at a glance.
- **Hue-coded folder cards** (id-derived hue icon, track + note tallies) plus
  a dashed New-folder card; a time-of-day greeting and a prominent inset
  search well sit above. Inside a folder the greeting yields to the Library
  crumb (also the unfile drop target).
- Meta lines stay monospace Label style; a glyph (▶ / ♪) still marks the
  source; per-tile controls (move to folder, delete) stay hidden at rest and
  revealed on hover/focus. The signal appears only on the primary New-track
  action, the Shared chip, and the drag-and-drop drop highlight. The wordmark
  and a Home button return here from the editor.

## 6. Do's and Don'ts

### Do:
- **Do** build depth from the tonal ramp (ink → panel → raised → inset) and
  hairline dividers. Flush panels, softly squared corners (5–10px).
- **Do** keep numerics monospace and tabular: timecodes, counts, durations.
- **Do** keep the canvas neutral (untinted graphite / pure white) and reserve
  the signal for "now" and the primary action; keep it under ~10% of any screen.
- **Do** pair every color-coded note with its timecode label, so identity never
  depends on hue alone (projector + colorblind safe).
- **Do** hide secondary controls until hover/focus; let the resting UI stay calm.

### Don't:
- **Don't** ship the **generic AI / shadcn dashboard** look: rounded cards, soft
  drop shadows, indigo accent, evenly padded "friendly SaaS" whitespace. This is
  the primary anti-reference.
- **Don't** drift into **heavy enterprise SaaS clutter**: gray-on-gray toolbars,
  competing controls, data-grid busyness. Density is welcome; clutter is not.
- **Don't** use **retro skeuomorphism**: fake wood or metal textures, glossy
  bevels, brushed-aluminum. Bevels stay 1px and only on controls.
- **Don't** let color carry meaning alone, and **don't** add a second face to the
  type system. Two voices (sans + mono) only.
- **Don't** introduce a second solid-signal control next to Play, tint a
  surface with the signal (beyond `--row-sel`), or round a corner past the
  lg=10px panel radius. If it looks like a card with a shadow, it's wrong.
